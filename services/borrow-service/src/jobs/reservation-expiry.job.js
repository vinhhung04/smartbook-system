const { prisma } = require('../lib/prisma');
const { runExpiredReservationSweep } = require('../controllers/reservation.controller');

let timer = null;
let running = false;
let stopping = false;

async function executeReservationExpirySweep() {
  if (running || stopping) {
    return;
  }

  running = true;
  try {
    const result = await runExpiredReservationSweep(prisma, {
      limit: Number(process.env.RESERVATION_EXPIRY_BATCH_SIZE || 100),
    });
    console.log('[borrow-service][job] reservation expiry sweep result', result);
  } catch (error) {
    console.error('[borrow-service][job] reservation expiry sweep failed', error);
  } finally {
    running = false;
  }
}

function startReservationExpiryJob() {
  if (timer || stopping) return;
  const enabled = String(process.env.ENABLE_RESERVATION_EXPIRY_JOB || 'true').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[borrow-service][job] reservation expiry disabled by env');
    return;
  }

  const intervalMs = Math.max(60_000, Number(process.env.RESERVATION_EXPIRY_INTERVAL_MS || 5 * 60_000));
  timer = setInterval(() => {
    void executeReservationExpirySweep();
  }, intervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  console.log('[borrow-service][job] reservation expiry started', { intervalMs });
  void executeReservationExpirySweep();
}

function stopReservationExpiryJob() {
  stopping = true;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  return new Promise((resolve) => {
    const drained = () => running ? setTimeout(drained, 10) : resolve();
    drained();
  });
}

module.exports = {
  startReservationExpiryJob,
  stopReservationExpiryJob,
  executeReservationExpirySweep,
};
