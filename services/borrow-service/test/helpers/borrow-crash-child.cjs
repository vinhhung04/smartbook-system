// A real subprocess dies at a mocked Inventory response boundary. Database
// intent/rollback/restart are real; this is not evidence of a live Inventory move.
const input = JSON.parse(process.argv[2]);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
function mock(path, exports) { const id = require.resolve(path); require.cache[id] = { id, filename: id, loaded: true, exports }; }
mock('../../src/lib/prisma', { prisma });
mock('../../src/lib/socket-emitter', { pushEvents: async () => {} });
mock('../../src/services/inventory-integration.service', {
  checkAvailability: async () => {}, reserveStock: async () => {}, reallocateReservationStock: async () => {},
  consumeReservation: async call => {
    const record = await prisma.integration_outbox.findFirst({ where: { event_type: 'BORROW_OPERATION',
      payload: { path: ['plan', 'loanId'], equals: call.loan_id } } });
    if (!record) throw new Error('Missing durable operation before remote boundary');
    process.send({ operation_id: record.id, loan_id: call.loan_id }, () => process.kill(process.pid, 'SIGKILL'));
    await new Promise(() => {});
  },
});
const controller = require('../../src/controllers/loan.controller');
const response = { status() { return this; }, json() { throw new Error('Expected process death at remote boundary'); } };
controller.createDirectLoan({ params: {}, body: input.body, headers: { 'idempotency-key': input.key }, user: input.actor }, response)
  .catch(() => process.exit(2));
