// Phase 5: every analytics answer says which population it covers, so a
// scoped manager (and the AI copilot) never reads a library-wide figure as a
// figure of their own warehouses - or the other way round.
//
//   SYSTEM            whole library: borrowing (loans are not tied to one
//                     warehouse), fines, catalog-level stock totals and the
//                     central purchasing list (reorder suggestions). Kept
//                     library-wide on purpose: scoping them would silently
//                     change what the number means.
//   WAREHOUSE_SCOPED  per-warehouse rows limited to the caller's warehouse
//                     scope (attachWarehouseScope).
//
// Added to the JSON body as meta.data_scope (additive) and as X-Data-Scope.
const DATA_SCOPES = new Set(['SYSTEM', 'WAREHOUSE_SCOPED']);

function declareDataScope(scope) {
  if (!DATA_SCOPES.has(scope)) throw new Error(`unknown data scope ${scope}`);
  return (req, res, next) => {
    res.setHeader('X-Data-Scope', scope);
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 400 && body && typeof body === 'object' && !Array.isArray(body) && 'data' in body) {
        return json({ ...body, meta: { ...(body.meta || {}), data_scope: scope } });
      }
      return json(body);
    };
    next();
  };
}

module.exports = { declareDataScope, DATA_SCOPES };
