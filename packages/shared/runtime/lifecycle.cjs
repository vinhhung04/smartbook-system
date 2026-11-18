// Shared bounded HTTP/worker drain. A timeout is an unsuccessful shutdown, never
// evidence that in-flight side effects completed; durable operations recover it.
function createServiceLifecycle({ server, stopWork = [], closeResources = [], timeoutMs = 35000, onExit = (code) => process.exit(code) }) {
  let ready = true;
  let shutdownPromise;
  const responses = new Set();
  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    ready = false;
    for (const response of responses) {
      response.shouldKeepAlive = false;
      if (!response.headersSent) response.setHeader('Connection', 'close');
    }
    shutdownPromise = (async () => {
      let timer;
      const drained = new Promise((resolve, reject) => {
        server.close((error) => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
        server.closeIdleConnections?.();
      });
      const work = (async () => {
        const stopped = await Promise.allSettled([drained, ...stopWork.map((stop) => Promise.resolve().then(stop))]);
        let failed = stopped.some(result => result.status === 'rejected');
        for (const close of closeResources) {
          try { await close(); } catch (_error) { failed = true; }
        }
        return { timedOut: false, ...(failed ? { failed: true } : {}) };
      })().catch(() => ({ timedOut: false, failed: true }));
      const deadline = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
      });
      const result = await Promise.race([work, deadline]);
      clearTimeout(timer);
      if (result.timedOut) { try { server.closeAllConnections?.(); } catch (_error) {} }
      onExit(result.timedOut || result.failed ? 1 : 0);
      return result;
    })();
    return shutdownPromise;
  }
  function middleware(_req, res, next) {
    responses.add(res);
    const finished = () => {
      responses.delete(res);
      // An active keep-alive response becomes idle after its finish callbacks.
      // The initial closeIdleConnections call cannot reap that later transition.
      if (!ready) setImmediate(() => { try { server.closeIdleConnections?.(); } catch (_error) {} });
    };
    res.once?.('finish', finished);
    res.once?.('close', finished);
    if (ready) return next();
    res.statusCode = 503;
    res.setHeader('Connection', 'close');
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ status: 'draining' }));
  }
  return { isReady: () => ready, shutdown, middleware };
}

module.exports = { createServiceLifecycle };
