const { Readable } = require('node:stream');

// Proxy routes consume the raw request stream. Buffer only a bounded body before
// letting a downstream service see it; a chunked overflow cannot partially apply
// a business request or reach a multipart parser before being rejected.
function actualBodyLimit({ maxBytes = () => 16 * 1024 * 1024,
  maxConcurrent = () => Number(process.env.GATEWAY_BODY_MAX_CONCURRENT || 4),
  readTimeoutMs = () => Number(process.env.GATEWAY_BODY_READ_TIMEOUT_MS || 30_000) } = {}) {
  let activeBodies = 0;
  return (req, res, next) => {
    const limit = Number(maxBytes());
    if (!Number.isSafeInteger(limit) || limit <= 0) return res.status(503).json({ code: 'BODY_LIMIT_UNAVAILABLE' });
    const declared = req.headers['content-length'];
    const chunks = [];
    let permit = false, timer, stopped = false, readComplete = false;
    const release = () => {
      if (permit) { permit = false; activeBodies--; }
      clearTimeout(timer);
      chunks.length = 0;
    };
    const reject = (status = 413, code = 'PAYLOAD_TOO_LARGE') => {
      stopped = true;
      release();
      res.setHeader('Connection', 'close');
      res.once('finish', () => req.destroy());
      req.pause();
      return res.status(status).json({ message: status === 408 ? 'Tải dữ liệu quá thời gian cho phép' : status === 429 ? 'Đang có quá nhiều yêu cầu tải dữ liệu' : 'Dữ liệu gửi lên quá lớn', code, request_id: req.requestId || null });
    };
    if (declared !== undefined && Number(declared) > limit) return reject();
    if (!req.headers['transfer-encoding'] && (!declared || Number(declared) === 0)) return next();
    const slots = Number(maxConcurrent()), timeout = Number(readTimeoutMs());
    if (!Number.isSafeInteger(slots) || slots < 1 || !Number.isSafeInteger(timeout) || timeout < 1) {
      return reject(503, 'BODY_LIMIT_UNAVAILABLE');
    }
    if (activeBodies >= slots) return reject(429, 'BODY_UPLOAD_BUSY');
    activeBodies++; permit = true;
    timer = setTimeout(() => { if (!readComplete && !stopped) reject(408, 'BODY_READ_TIMEOUT'); }, timeout);
    timer.unref();
    res.once('finish', release);
    res.once('close', release);
    req.once('aborted', () => { stopped = true; release(); });
    let size = 0;
    req.on('data', chunk => {
      if (stopped) return;
      size += chunk.length;
      if (size > limit) {
        reject();
      } else chunks.push(chunk);
    });
    req.once('error', error => { if (!stopped) { stopped = true; release(); next(error); } });
    req.once('end', () => {
      if (stopped) return;
      readComplete = true;
      clearTimeout(timer);
      delete req.headers['transfer-encoding'];
      req.headers['content-length'] = String(size);
      // http-proxy's incoming pass pipes the request into its outgoing request.
      // Replay exactly the original bounded bytes after consuming the TCP body.
      req.pipe = (destination, options) => {
        destination.once('finish', release);
        destination.once('close', release);
        destination.once('error', release);
        return Readable.from(chunks).pipe(destination, options);
      };
      next();
    });
  };
}

module.exports = { actualBodyLimit };
