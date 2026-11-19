// Prisma errors meaning "the database cannot be reached right now" (connect,
// timeout, closed connection, pool/transaction start timeout).
const DB_UNAVAILABLE = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028']);

function isDbUnavailable(error) {
  return Boolean(error) && (error.name === 'PrismaClientInitializationError'
    || DB_UNAVAILABLE.has(error.code) || DB_UNAVAILABLE.has(error.errorCode)
    || /Can't reach database server|Unable to start a transaction in the given time|Connection terminated|ECONNREFUSED/.test(String(error.message)));
}

module.exports = { isDbUnavailable };
