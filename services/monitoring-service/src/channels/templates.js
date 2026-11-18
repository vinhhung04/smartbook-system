// Notification content for every channel, from one incident view. Everything
// interpolated into HTML is escaped (alert text originates from labels/annotations).
const SEVERITY_LABEL = { CRITICAL: 'Nghiêm trọng', HIGH: 'Cao', WARNING: 'Cảnh báo', INFO: 'Thông tin' };
const CATEGORY_LABEL = { TECHNICAL: 'Sự cố kỹ thuật', BUSINESS: 'Cảnh báo nghiệp vụ', INFO: 'Sự kiện vận hành' };
const KIND_LABEL = { OPEN: 'Phát hiện sự cố', REOPENED: 'Sự cố tái diễn', RESOLVED: 'Đã phục hồi', TEST: 'Thông báo thử' };
const SEVERITY_COLOR = { CRITICAL: 0xb91c1c, HIGH: 0xc2410c, WARNING: 0xb45309, INFO: 0x2f5597 };
const RESOLVED_COLOR = 0x15803d;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function formatTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
}

function incidentLink(incident, publicWebUrl = process.env.PUBLIC_WEB_URL || 'http://localhost:5173') {
  return `${String(publicWebUrl).replace(/\/+$/, '')}/admin/monitor/incidents/${incident.id}`;
}

function view(incident, kind) {
  const resolved = kind === 'RESOLVED';
  const tag = resolved ? 'ĐÃ PHỤC HỒI' : incident.severity;
  return {
    resolved,
    subject: `[SmartBook][${tag}] ${incident.title} — ${incident.service_name}`,
    heading: `${KIND_LABEL[kind] || KIND_LABEL.OPEN}: ${incident.title}`,
    severity: SEVERITY_LABEL[incident.severity] || incident.severity,
    category: CATEGORY_LABEL[incident.category] || incident.category,
    description: incident.summary || incident.description || 'Không có mô tả.',
    link: incidentLink(incident),
  };
}

function emailContent(incident, kind) {
  const v = view(incident, kind);
  const rows = [
    ['Mức độ', v.severity], ['Phân loại', v.category], ['Dịch vụ', incident.service_name],
    ['Phát hiện lúc', formatTime(incident.first_seen_at)], ['Số lần xuất hiện', incident.occurrence_count],
    ...(v.resolved ? [['Phục hồi lúc', formatTime(incident.resolved_at)]] : []),
  ];
  const accent = v.resolved ? '#15803d' : incident.severity === 'CRITICAL' ? '#b91c1c' : '#2f5597';
  const runbook = incident.runbook_url
    ? `<p style="margin:16px 0 0;">Hướng dẫn xử lý: <a href="${escapeHtml(incident.runbook_url)}">${escapeHtml(incident.runbook_url)}</a></p>` : '';
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1f2937;">
  <div style="border-left:4px solid ${accent};padding:12px 16px;background:#f8fafc;">
    <p style="margin:0;font-size:12px;color:#475569;">SmartBook · Giám sát hệ thống</p>
    <h1 style="margin:4px 0 0;font-size:18px;">${escapeHtml(v.heading)}</h1>
  </div>
  <table style="border-collapse:collapse;margin:16px 0;font-size:14px;">
    ${rows.map(([k, val]) => `<tr><td style="padding:4px 16px 4px 0;color:#475569;">${escapeHtml(k)}</td><td style="padding:4px 0;"><strong>${escapeHtml(val)}</strong></td></tr>`).join('')}
  </table>
  <p style="margin:0;font-size:14px;line-height:1.5;">${escapeHtml(v.description)}</p>
  ${runbook}
  <p style="margin:24px 0;"><a href="${escapeHtml(v.link)}" style="background:${accent};color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">Mở sự cố trong trang quản trị</a></p>
  <p style="font-size:12px;color:#94a3b8;">Email tự động gửi tới quản trị viên giám sát. Không trả lời email này.</p>
</div>`;
  const textBody = [v.heading, ...rows.map(([k, val]) => `${k}: ${val}`), '', v.description,
    incident.runbook_url ? `Hướng dẫn xử lý: ${incident.runbook_url}` : null, `Mở sự cố: ${v.link}`].filter(line => line !== null).join('\n');
  return { subject: v.subject, html, text: textBody };
}

function webhookPayload(format, incident, kind) {
  const v = view(incident, kind);
  const line = `${v.resolved ? '✅' : incident.severity === 'CRITICAL' ? '🔴' : '🟠'} ${v.subject}`;
  if (format === 'slack') {
    return { text: `${line}\n${v.description}\n<${v.link}|Mở sự cố>` };
  }
  if (format === 'discord') {
    return {
      content: line.slice(0, 1900),
      allowed_mentions: { parse: [] },
      embeds: [{
        title: v.heading.slice(0, 250), url: v.link, description: v.description.slice(0, 2000),
        color: v.resolved ? RESOLVED_COLOR : SEVERITY_COLOR[incident.severity] || SEVERITY_COLOR.INFO,
        fields: [
          { name: 'Mức độ', value: v.severity, inline: true },
          { name: 'Dịch vụ', value: String(incident.service_name).slice(0, 100), inline: true },
          { name: 'Phát hiện lúc', value: formatTime(incident.first_seen_at), inline: true },
        ],
      }],
    };
  }
  return {
    event: v.resolved ? 'incident.resolved' : kind === 'TEST' ? 'incident.test' : 'incident.opened',
    incident: {
      id: incident.id, title: incident.title, severity: incident.severity, category: incident.category,
      status: incident.status, service: incident.service_name, first_seen_at: incident.first_seen_at,
      resolved_at: incident.resolved_at, occurrence_count: incident.occurrence_count, summary: incident.summary, url: v.link,
    },
  };
}

function inAppContent(incident, kind) {
  const v = view(incident, kind);
  return { title: `${v.resolved ? 'Đã phục hồi' : v.severity}: ${incident.title}`.slice(0, 250), body: `${incident.service_name} · ${v.description}`.slice(0, 1000) };
}

module.exports = { escapeHtml, emailContent, webhookPayload, inAppContent, incidentLink };
