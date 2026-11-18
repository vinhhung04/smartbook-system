// AES-256-GCM for channel secrets (webhook URLs embed their token). The key comes
// from MONITORING_SECRET_KEY (64 hex chars); without it secrets cannot be stored.
const crypto = require('node:crypto');

function loadKey(raw = process.env.MONITORING_SECRET_KEY) {
  const value = String(raw || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(value)) return null;
  return Buffer.from(value, 'hex');
}

function seal(plaintext, key = loadKey()) {
  if (!key) throw Object.assign(new Error('MONITORING_SECRET_KEY chưa được cấu hình; không thể lưu bí mật của kênh.'), { statusCode: 503, expose: true });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

function open(sealed, key = loadKey()) {
  if (!key) throw Object.assign(new Error('MONITORING_SECRET_KEY missing'), { permanent: true });
  const [version, iv, tag, data] = String(sealed || '').split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw Object.assign(new Error('sealed secret is malformed'), { permanent: true });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { loadKey, seal, open };
