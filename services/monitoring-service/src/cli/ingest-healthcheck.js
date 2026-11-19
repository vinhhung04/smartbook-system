// Used by deploy/scripts/healthcheck.sh through `dc exec -T monitoring-service`:
// reads {"problems": [...], "observed_at": "..."} on stdin and posts it to this
// container's own ingest endpoint. Exit 0 = accepted; anything else = not
// recorded (healthcheck.sh then keeps its direct webhook as the fallback path).
const http = require('node:http');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  if (input.length > 256 * 1024) { console.error('input too large'); process.exit(2); }
});
process.stdin.on('end', () => {
  const req = http.request({
    host: '127.0.0.1', port: Number(process.env.PORT || 3007), path: '/internal/alerts/healthcheck', method: 'POST', timeout: 10_000,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MONITORING_INGEST_TOKEN || ''}`, 'Content-Length': Buffer.byteLength(input) },
  }, (res) => {
    res.resume();
    res.on('end', () => process.exit(res.statusCode === 202 ? 0 : 1));
  });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', (error) => { console.error(`ingest failed: ${error.message}`); process.exit(1); });
  req.end(input);
});
