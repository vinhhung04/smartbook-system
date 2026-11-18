// Outbound webhook policy (anti-SSRF). An administrator enters the URL, so it is
// untrusted input that this service will connect to from inside the VPS network.
//
// - https only, port 443, no userinfo
// - host allowlist per format (Slack/Discord); "generic" endpoints only when
//   MONITORING_WEBHOOK_ALLOW_PUBLIC=true, and then still never a private address
// - every resolved address must be public; the connection is pinned to the
//   address that was checked (no DNS rebinding between check and connect)
// - no redirects, 5s timeout, response body capped at 64 KB
const dns = require('node:dns');
const https = require('node:https');
const net = require('node:net');

const FORMATS = {
  slack: { hosts: ['hooks.slack.com'], path: /^\/services\// },
  discord: { hosts: ['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com'], path: /^\/api\/webhooks\// },
  generic: { hosts: null, path: /^\// },
};
const TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 64 * 1024;

class WebhookPolicyError extends Error {
  constructor(message) { super(message); this.statusCode = 400; this.expose = true; this.permanent = true; }
}

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const BLOCKED_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => ({ base: ipv4ToInt(base), mask: bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0 }));

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const value = ipv4ToInt(address);
    return !BLOCKED_V4.some(({ base, mask }) => ((value & mask) >>> 0) === ((base & mask) >>> 0));
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPublicAddress(mapped[1]);
    if (lower === '::' || lower === '::1') return false;
    // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast, 2001:db8::/32 documentation, 64:ff9b::/96 NAT64
    return !/^(f[cd]|fe[89ab]|ff|2001:0?db8:|64:ff9b:)/.test(lower);
  }
  return false;
}

/** Validates the URL shape and allowlist (no network). Returns a URL object. */
function validateWebhookUrl(raw, format, { allowPublic = process.env.MONITORING_WEBHOOK_ALLOW_PUBLIC === 'true' } = {}) {
  const rule = FORMATS[format];
  if (!rule) throw new WebhookPolicyError('Định dạng webhook không hỗ trợ (slack, discord, generic).');
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { throw new WebhookPolicyError('URL webhook không hợp lệ.'); }
  if (url.protocol !== 'https:') throw new WebhookPolicyError('Webhook phải dùng HTTPS.');
  if (url.username || url.password) throw new WebhookPolicyError('URL webhook không được chứa thông tin đăng nhập.');
  if (url.port && url.port !== '443') throw new WebhookPolicyError('Webhook chỉ được dùng cổng 443.');
  const host = url.hostname.toLowerCase();
  if (net.isIP(host.replace(/^\[|\]$/g, ''))) throw new WebhookPolicyError('Webhook phải dùng tên miền, không dùng địa chỉ IP.');
  if (rule.hosts && !rule.hosts.includes(host)) throw new WebhookPolicyError(`Webhook ${format} chỉ chấp nhận tên miền: ${rule.hosts.join(', ')}.`);
  if (!rule.hosts && !allowPublic) throw new WebhookPolicyError('Webhook tùy chỉnh đang bị tắt theo chính sách bảo mật (MONITORING_WEBHOOK_ALLOW_PUBLIC).');
  if (!rule.path.test(url.pathname)) throw new WebhookPolicyError(`Đường dẫn webhook ${format} không đúng định dạng.`);
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local') || !host.includes('.')) {
    throw new WebhookPolicyError('Không cho phép địa chỉ nội bộ.');
  }
  return url;
}

async function resolvePublicAddress(hostname, lookup = dns.promises.lookup) {
  let addresses;
  try { addresses = await lookup(hostname, { all: true, verbatim: true }); } catch {
    const error = new Error('Không phân giải được tên miền webhook.'); error.code = 'DNS_FAILURE'; throw error;
  }
  if (!addresses.length) { const error = new Error('Tên miền webhook không có địa chỉ.'); error.code = 'DNS_FAILURE'; throw error; }
  const blocked = addresses.find(entry => !isPublicAddress(entry.address));
  if (blocked) throw new WebhookPolicyError('Tên miền webhook trỏ tới địa chỉ nội bộ hoặc bị chặn.');
  return addresses[0];
}

/**
 * POSTs JSON to a validated URL. Resolves to { statusCode, durationMs } for any
 * HTTP response; rejects on network/policy errors (error.permanent for policy).
 */
async function postJson(url, payload, { lookup, request = https.request, timeoutMs = TIMEOUT_MS } = {}) {
  const pinned = await resolvePublicAddress(url.hostname, lookup);
  const body = Buffer.from(JSON.stringify(payload));
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const req = request({
      protocol: 'https:', hostname: url.hostname, servername: url.hostname, port: 443,
      path: `${url.pathname}${url.search}`, method: 'POST',
      // Connect to the address that was checked, keep SNI/Host on the hostname.
      lookup: (_host, options, callback) => {
        if (options?.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
        else callback(null, pinned.address, pinned.family);
      },
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, 'User-Agent': 'SmartBook-Monitoring/1.0' },
      timeout: timeoutMs,
    }, (res) => {
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_RESPONSE_BYTES) res.destroy();
      });
      res.on('close', () => resolve({ statusCode: res.statusCode, durationMs: Date.now() - startedAt }));
      res.on('error', () => resolve({ statusCode: res.statusCode, durationMs: Date.now() - startedAt }));
    });
    req.on('timeout', () => { req.destroy(Object.assign(new Error(`Webhook không phản hồi sau ${timeoutMs / 1000}s`), { code: 'TIMEOUT' })); });
    req.on('error', (error) => reject(Object.assign(error, { durationMs: Date.now() - startedAt })));
    req.end(body);
  });
}

/** "hooks.slack.com/…a1B2" — enough to recognise a channel, never the token. */
function webhookHint(url) {
  const tail = url.pathname.replace(/\/+$/, '').slice(-4);
  return `${url.hostname}/…${tail}`;
}

module.exports = { FORMATS, WebhookPolicyError, isPublicAddress, validateWebhookUrl, resolvePublicAddress, postJson, webhookHint };
