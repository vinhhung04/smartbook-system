const { prisma } = require('../lib/prisma');
const { runOverdueSweep } = require('../services/fine.service');

let timer = null;
let running = false;
let stopping = false;

async function executeOverdueSweep() {
  if (running || stopping) {
    return;
  }

  running = true;
  try {
    const result = await runOverdueSweep(prisma, {
      limit: Number(process.env.OVERDUE_SWEEP_BATCH_SIZE || 300),
    });
    console.log('[borrow-service][job] overdue sweep result', result);
  } catch (error) {
    console.error('[borrow-service][job] overdue sweep failed', error);
  } finally {
    running = false;
  }
}

function startOverdueSweepJob() {
  if (timer || stopping) return;
  const enabled = String(process.env.ENABLE_OVERDUE_SWEEP_JOB || 'true').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[borrow-service][job] overdue sweep disabled by env');
    return;
  }

  const intervalMs = Math.max(60_000, Number(process.env.OVERDUE_SWEEP_INTERVAL_MS || 5 * 60_000));
  timer = setInterval(() => {
    void executeOverdueSweep();
  }, intervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  console.log('[borrow-service][job] overdue sweep started', { intervalMs });
  void executeOverdueSweep();
}

function stopOverdueSweepJob() {
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
  startOverdueSweepJob,
  stopOverdueSweepJob,
  executeOverdueSweep,
};
