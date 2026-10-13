// Every primary key in the inventory schema is a UUID. A malformed id in the
// path otherwise reaches Prisma, which throws P2023 and the controller answers
// 500; reject it up front with a 400 instead.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UUID_PARAMS = [
  'id',
  'taskId',
  'reportId',
  'poId',
  'warehouseId',
  'receivingId',
  'lineId',
  'bookId',
  'variantId',
  'pickingTaskId',
  'compartmentId',
];

function rejectInvalidUuidParams(router) {
  for (const name of UUID_PARAMS) {
    router.param(name, (req, res, next, value) => {
      if (UUID_RE.test(String(value).trim())) return next();
      return res.status(400).json({ message: `Invalid ${name}` });
    });
  }
  return router;
}

module.exports = { rejectInvalidUuidParams };
