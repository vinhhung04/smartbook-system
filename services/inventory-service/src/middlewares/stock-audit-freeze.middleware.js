const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
const code = 'STOCK_AUDIT_LOCATION_FROZEN';

function observeStockAuditFreeze(error) {
  if (`${error?.message || ''} ${JSON.stringify(error?.meta || {})}`.includes(code)) {
    const request = context.getStore();
    if (request) request.frozen = true;
    return true;
  }
  return false;
}

// Existing controllers intentionally catch persistence errors themselves. Capture
// this central DB invariant in request context so every writer returns the same
// conflict contract even when its legacy catch would otherwise send generic500.
function stockAuditFreezeResponses(_req, res, next) {
  const send = res.json.bind(res);
  res.json = function(body) {
    if (context.getStore()?.frozen && res.statusCode >= 400) {
      res.status(409);
      return send({ code, message: 'Vị trí đang kiểm đếm; chốt số đếm hoặc hủy phiếu trước khi thay đổi tồn kho' });
    }
    return send(body);
  };
  return context.run({ frozen: false }, next);
}

module.exports = { observeStockAuditFreeze, stockAuditFreezeResponses };
