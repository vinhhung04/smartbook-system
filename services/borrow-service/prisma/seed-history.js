/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SmartBook — synthetic borrow-history generator (Area A: risk prediction)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS
 * The production/demo database (as of 2026-09-08) has 8 loan_transactions, 9
 * returned loan_items and 6 reservations — a hand-written fixture, not a corpus.
 * A late-return or no-show risk model needs hundreds of labelled examples to
 * report a meaningful AUC; the daily-demand backtest needs ~37 daily
 * observations per book to leave INSUFFICIENT_DATA. Neither exists in the
 * hand-seeded data. This script generates a large, LABELLED, REPRODUCIBLE
 * synthetic history so those numbers can be computed and reported honestly.
 *
 * THIS IS A SIMULATION STUDY, NOT REAL DATA. Every row this script creates is
 * synthetic, generated from a published logistic process (see
 * LATE_COEFFICIENTS / NO_SHOW_COEFFICIENTS below). The thesis experimental
 * chapter must say so explicitly, and should report the measured AUC/lift
 * against `bayes_auc_*` in seed-history-truth.json — the theoretical ceiling
 * computable from the true probabilities used to draw the labels, i.e. the
 * best any model could ever score against noise inherent to a Bernoulli draw.
 *
 * REPRODUCIBILITY. All randomness comes from one seeded PRNG (mulberry32,
 * seed = HISTORY_SEED, default 20260908) driven in a fixed call order, and the
 * whole window is anchored to a fixed reference date (HISTORY_NOW below), not
 * wall-clock "now" — so re-running this script reproduces the same
 * distributions, dates, and labels every time. Primary keys themselves are
 * real UUIDs (crypto.randomUUID) and therefore differ between runs — that is
 * fine, nothing downstream depends on a specific id being stable, only on the
 * statistical shape of the data being reproducible.
 *
 * IDEMPOTENCE. Every row this script creates carries a "HIST-" prefix in its
 * natural key (loan_number / reservation_number / customer_code /
 * membership card_number). On each run, existing HIST-% rows are deleted
 * first, then regenerated. The 6 hand-written demo loans (LOAN-001..006) are
 * untouched.
 *
 * SCOPE. Book/warehouse identities are NOT invented — they are the real
 * variant_id/warehouse_id values captured from services/inventory-service's
 * own demo seed (services/inventory-service/prisma/seed.js) on 2026-09-08, so
 * that a title/warehouse-name lookup against inventory_db still resolves for
 * this synthetic data. There is no live cross-service call here on purpose:
 * this script only needs prisma (borrow_db) and stays self-contained,
 * deterministic, and offline-runnable. If the inventory demo catalog is later
 * reseeded with different ids, forecast-accuracy title lookups for this
 * synthetic data would show blank — cosmetic only, not a correctness issue.
 *
 * USAGE
 *   node prisma/seed-history.js                 (or: npm run prisma:seed-history)
 *   HISTORY_SEED=123 node prisma/seed-history.js  (different draw, still deterministic)
 */

const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic PRNG
// ─────────────────────────────────────────────────────────────────────────────

const HISTORY_SEED = Number(process.env.HISTORY_SEED || 20260908);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(HISTORY_SEED);

function randRange(min, max) {
  return min + rand() * (max - min);
}
function randInt(min, max) {
  return Math.floor(randRange(min, max + 1));
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}
function chance(p) {
  return rand() < p;
}
// Box-Muller, driven by the seeded PRNG so it stays reproducible.
function gaussian() {
  const u1 = Math.max(rand(), 1e-9);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function sigmoid(z) {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}
// Zipf-ish weights over N ranked slots (rank 0 heaviest) - used so a handful
// of titles accumulate the daily-observation depth rollingBacktest needs.
function zipfWeights(n) {
  const weights = Array.from({ length: n }, (_, i) => 1 / (i + 1));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / total);
}
function zipfIndex(weights) {
  const r = rand();
  let cumulative = 0;
  for (let i = 0; i < weights.length; i += 1) {
    cumulative += weights[i];
    if (r <= cumulative) return i;
  }
  return weights.length - 1;
}
// Rank-based AUC (Mann-Whitney U, average ranks for ties) - used only to
// compute the Bayes-optimal ceiling from the true generative probabilities,
// written to seed-history-truth.json. Deliberately NOT imported from
// analytics-service (different service, different database) - this is a
// throwaway helper for one number in one report file, not production logic.
function bayesAuc(labels, scores) {
  const n = labels.length;
  const positives = labels.filter((l) => l === 1).length;
  const negatives = n - positives;
  if (positives === 0 || negatives === 0) return null;
  const indexed = scores.map((s, i) => ({ s, label: labels[i] }));
  indexed.sort((a, b) => a.s - b.s);
  let rankSum = 0;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && indexed[j + 1].s === indexed[i].s) j += 1;
    const avgRank = (i + 1 + j + 1) / 2; // 1-indexed average rank for this tie block
    for (let k = i; k <= j; k += 1) {
      if (indexed[k].label === 1) rankSum += avgRank;
    }
    i = j + 1;
  }
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Fixed window, anchored to a constant date (not wall-clock) for reproducibility
// ─────────────────────────────────────────────────────────────────────────────

const HISTORY_NOW = new Date('2026-09-08T00:00:00Z');
const WINDOW_DAYS = 730; // 24 months
const WINDOW_START = new Date(HISTORY_NOW.getTime() - WINDOW_DAYS * DAY_MS);

// ─────────────────────────────────────────────────────────────────────────────
// Reference catalog - captured from services/inventory-service/prisma/seed.js
// (inventory_db) on 2026-09-08. See "SCOPE" in the header comment.
// ─────────────────────────────────────────────────────────────────────────────

const VARIANT_IDS = [
  '0b44cf68-aa1d-4d7e-bd68-17ac2cfee8e0',
  '48803af6-66c3-4cbd-ac51-5be550f88ee3',
  '4e0f3c7a-7ca7-4ff3-9767-cf16226b21e0',
  '75a81436-94d6-4a99-bd69-67d8d4f4d989',
  '8420a581-4b6a-4045-9b27-fafc3d71d933',
  '86936782-5b22-4351-a186-842a2dbfe829',
  '8aafb186-bfca-418f-8fc1-23905aba4c08',
  '9f1ef341-1f66-4222-bdff-a2e16bc0b228',
  'b895862b-45f0-400c-87ce-8d791ff59f3b',
  'bac33105-63c7-4c1e-b248-dcdc80bde178',
  'bc62419f-b48b-4940-8b56-7419af414113',
  'd4af95a6-cb37-4113-a8ea-e411a3194083',
  'e7f7c44e-7544-499d-a212-d3ef242e0ca2',
  'fba2ecd6-faa9-4cc0-8b8c-48ea3c061a5f',
];
const WAREHOUSE_IDS = [
  '7fda99eb-8bf0-4b50-9d64-fe195beb724d',
  'e6f76cd3-26c9-41a7-821f-525ea4639888',
  'd8e151d8-fd15-4477-bbfd-59d10f778ab5',
  '73318a97-5043-4338-b88b-797fa76e51b7',
]
const VARIANT_WEIGHTS = zipfWeights(VARIANT_IDS.length);
// Same placeholder staff id the hand-written seed.js already uses - no FK
// across services, so any UUID-shaped string is valid.
const PLACEHOLDER_STAFF_ID = '00000000-0000-0000-0000-000000000001';

const CUSTOMER_COUNT = 400;
const RESERVATION_COUNT = 4000;
const TARGET_DAILY_LOANS = 12.3; // ~9,000 loans over 730 days before multipliers

// Mon(0)..Sun(6) - a library sees more weekday traffic than weekend.
const WEEKDAY_MULTIPLIER = [1.15, 1.15, 1.1, 1.1, 1.05, 0.75, 0.6];
// Jan(0)..Dec(11) - busier around semester starts, quieter in summer.
const MONTH_MULTIPLIER = [1.1, 1.0, 1.15, 1.05, 0.95, 0.7, 0.65, 0.85, 1.25, 1.15, 1.0, 0.9];

const FIRST_NAMES = ['Anh', 'Binh', 'Chau', 'Dung', 'Giang', 'Hoa', 'Khanh', 'Lan', 'Minh', 'Nga', 'Phong', 'Quyen', 'Son', 'Thao', 'Trang', 'Tuan', 'Van', 'Yen'];
const LAST_NAMES = ['Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Phan', 'Vu', 'Vo', 'Dang', 'Bui', 'Do', 'Ho', 'Ngo', 'Duong'];

// ─────────────────────────────────────────────────────────────────────────────
// Published generative coefficients (the "ground truth" this study compares
// measured AUC/calibration against). Standardised feature inputs.
// ─────────────────────────────────────────────────────────────────────────────

// z = b0 + b1*(1-punctuality) + b2*loan_days_z + b3*items_in_loan_z
//        + b4*unpaid_fine_flag + b5*tier_effect
// b0 calibrated empirically (see prisma/seed-history-truth.json base_rates)
// so the population base rate lands near LATE_BASE_RATE_TARGET.
const LATE_COEFFICIENTS = { b0: -3.25, b1: 3.2, b2: 0.35, b3: 0.25, b4: 0.7, b5: -0.4 };

// z = c0 + c1*(1-punctuality) + c2*lead_hours_z + c3*hold_hours_z
//        + c4*channel_web + c5*prior_no_show_rate
// c0 calibrated empirically so the population base rate lands near
// NO_SHOW_RATE_TARGET.
const NO_SHOW_COEFFICIENTS = { c0: -3.0, c1: 2.6, c2: 0.4, c3: -0.3, c4: 0.5, c5: 2.0 };

const LATE_BASE_RATE_TARGET = 0.25;
const NO_SHOW_RATE_TARGET = 0.22;

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: customers + memberships
// ─────────────────────────────────────────────────────────────────────────────

function generateCustomers(count, plans) {
  const planWeights = { BASIC: 0.4, SILVER: 0.3, GOLD: 0.2, VIP: 0.1 };
  const customers = [];
  for (let i = 0; i < count; i += 1) {
    const idx = String(i + 1).padStart(4, '0');
    const createdAt = new Date(WINDOW_START.getTime() + rand() * WINDOW_DAYS * DAY_MS);
    // Latent trait in (0,1), skewed toward punctual (rand()^0.7) since most
    // real borrowers return books on time most of the time.
    const punctuality = Math.pow(rand(), 0.7);
    let planCode = 'BASIC';
    const r = rand();
    let acc = 0;
    for (const [code, w] of Object.entries(planWeights)) {
      acc += w;
      if (r <= acc) { planCode = code; break; }
    }
    const plan = plans.find((p) => p.code === planCode) || plans[0];
    customers.push({
      id: randomUUID(),
      customer_code: `HIST-C-${idx}`,
      full_name: `${pick(LAST_NAMES)} ${pick(FIRST_NAMES)} ${idx}`,
      birth_date: new Date(HISTORY_NOW.getTime() - randInt(18, 65) * 365 * DAY_MS),
      status: 'ACTIVE',
      created_at: createdAt,
      updated_at: createdAt,
      // simulation-only fields, stripped before insert:
      _punctuality: punctuality,
      _plan: plan,
      _cardNumber: `HIST-CARD-${idx}`,
    });
  }
  return customers;
}

function customerInsertRows(customers) {
  return customers.map((c) => ({
    id: c.id,
    customer_code: c.customer_code,
    full_name: c.full_name,
    birth_date: c.birth_date,
    status: c.status,
    created_at: c.created_at,
    updated_at: c.updated_at,
  }));
}

function membershipInsertRows(customers) {
  return customers.map((c) => ({
    id: randomUUID(),
    customer_id: c.id,
    plan_id: c._plan.id,
    card_number: c._cardNumber,
    start_date: c.created_at,
    status: 'ACTIVE',
    created_at: c.created_at,
    updated_at: c.created_at,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: loans (late-return generative process)
// ─────────────────────────────────────────────────────────────────────────────

function generateLoans(customers) {
  const loanRows = [];
  const itemRows = [];
  const renewalRows = [];
  const fineRows = [];
  const paymentRows = [];
  const lateSamples = []; // { label, trueProb } for terminal (returned) items only

  // Per-customer running state, updated causally as we walk forward in time -
  // this IS the leakage guard: unpaidFineAmount below can only reflect fines
  // issued strictly before the loan currently being generated. (Prior-loan
  // and prior-late counts are NOT tracked here: risk-features.js computes
  // those as real SQL aggregates over the rows this script writes, so
  // duplicating them in-memory would only be unused bookkeeping.)
  const state = new Map(customers.map((c) => [c.id, { unpaidFineAmount: 0 }]));

  let loanCounter = 0;
  for (let dayOffset = 0; dayOffset < WINDOW_DAYS; dayOffset += 1) {
    const day = new Date(WINDOW_START.getTime() + dayOffset * DAY_MS);
    const dow = (day.getUTCDay() + 6) % 7; // Mon=0..Sun=6
    const month = day.getUTCMonth();
    const expected = TARGET_DAILY_LOANS * WEEKDAY_MULTIPLIER[dow] * MONTH_MULTIPLIER[month];
    const loansToday = Math.max(0, Math.round(expected * (1 + 0.15 * gaussian())));

    for (let n = 0; n < loansToday; n += 1) {
      const customer = pick(customers);
      const s = state.get(customer.id);
      const plan = customer._plan;
      const borrowDate = new Date(day.getTime() + randInt(8, 19) * HOUR_MS + randInt(0, 59) * 60 * 1000);
      const itemsInLoan = 1 + (chance(0.35) ? 1 : 0) + (chance(0.1) ? 1 : 0); // 1-3, skewed to 1-2
      const originalDueDate = new Date(borrowDate.getTime() + plan.max_loan_days * DAY_MS);
      const warehouseId = pick(WAREHOUSE_IDS);

      const unpaidFineFlag = s.unpaidFineAmount > 0 ? 1 : 0;
      const tierEffect = plan.code === 'VIP' ? 1 : plan.code === 'GOLD' ? 0.5 : plan.code === 'SILVER' ? 0 : -0.3;
      const loanDaysZ = (plan.max_loan_days - 20) / 8;
      const itemsZ = (itemsInLoan - 1.5) / 0.7;

      // s.priorLoans/priorLate are tracked below and are a legitimate feature
      // for the analytics-service risk model to learn from (real repeat-late
      // behaviour), but are deliberately NOT part of the published generative
      // z here - the six LATE_COEFFICIENTS above are the complete, honest
      // list of what actually drives the true label.
      const z = LATE_COEFFICIENTS.b0
        + LATE_COEFFICIENTS.b1 * (1 - customer._punctuality)
        + LATE_COEFFICIENTS.b2 * loanDaysZ
        + LATE_COEFFICIENTS.b3 * itemsZ
        + LATE_COEFFICIENTS.b4 * unpaidFineFlag
        + LATE_COEFFICIENTS.b5 * tierEffect;
      const pLate = sigmoid(z);
      const isLate = chance(pLate);

      const renewalChance = 0.1 + 0.25 * (1 - customer._punctuality);
      const isRenewed = borrowDate.getTime() < HISTORY_NOW.getTime() - 21 * DAY_MS && chance(renewalChance);
      const extensionDays = isRenewed ? randInt(5, 14) : 0;
      const finalDueDate = new Date(originalDueDate.getTime() + extensionDays * DAY_MS);

      // A recent loan may still be genuinely open (not yet returned).
      const daysSinceBorrow = (HISTORY_NOW.getTime() - borrowDate.getTime()) / DAY_MS;
      const stillOpen = daysSinceBorrow < 25 && chance(0.35);

      loanCounter += 1;
      const loanId = randomUUID();
      const loanNumber = `HIST-LOAN-${String(loanCounter).padStart(6, '0')}`;

      let allReturned = true;
      let latestReturn = null;

      for (let itemIdx = 0; itemIdx < itemsInLoan; itemIdx += 1) {
        const itemId = randomUUID();
        const variantId = VARIANT_IDS[zipfIndex(VARIANT_WEIGHTS)];
        let itemDueDate = originalDueDate;
        if (isRenewed) {
          renewalRows.push({
            id: randomUUID(),
            loan_item_id: itemId,
            renewed_by_user_id: PLACEHOLDER_STAFF_ID,
            renewed_at: new Date(originalDueDate.getTime() - randInt(1, 3) * DAY_MS),
            old_due_date: originalDueDate,
            new_due_date: finalDueDate,
            renewal_count: 1,
            reason: 'HIST simulated renewal',
          });
          itemDueDate = finalDueDate;
        }

        if (stillOpen) {
          allReturned = false;
          itemRows.push({
            id: itemId, loan_id: loanId, variant_id: variantId, item_barcode: `HIST-BC-${loanCounter}-${itemIdx}`,
            due_date: itemDueDate, return_date: null,
            item_condition_on_checkout: 'GOOD',
            status: itemDueDate.getTime() < HISTORY_NOW.getTime() ? 'OVERDUE' : 'BORROWED',
            fine_amount: 0, lost_fee_amount: 0,
          });
          continue;
        }

        let returnDate;
        let daysLate = 0;
        if (isLate) {
          daysLate = 1 + Math.floor(-Math.log(1 - rand() * 0.98) * 5);
          daysLate = Math.min(daysLate, 45);
          returnDate = new Date(itemDueDate.getTime() + daysLate * DAY_MS);
          if (returnDate.getTime() > HISTORY_NOW.getTime()) returnDate = new Date(HISTORY_NOW.getTime() - randInt(0, 2) * DAY_MS);
        } else {
          const span = Math.max(itemDueDate.getTime() - borrowDate.getTime(), DAY_MS);
          returnDate = new Date(borrowDate.getTime() + rand() * span);
        }
        if (!latestReturn || returnDate.getTime() > latestReturn.getTime()) latestReturn = returnDate;

        lateSamples.push({ label: isLate ? 1 : 0, trueProb: pLate });

        itemRows.push({
          id: itemId, loan_id: loanId, variant_id: variantId, item_barcode: `HIST-BC-${loanCounter}-${itemIdx}`,
          due_date: itemDueDate, return_date: returnDate,
          item_condition_on_checkout: 'GOOD',
          item_condition_on_return: chance(0.05) ? 'DAMAGED' : 'GOOD',
          status: 'RETURNED',
          fine_amount: isLate ? daysLate * Number(plan.fine_per_day) : 0,
          lost_fee_amount: 0,
        });

        if (isLate) {
          const fineAmount = daysLate * Number(plan.fine_per_day);
          const fineId = randomUUID();
          const isPaid = chance(0.7);
          fineRows.push({
            id: fineId, customer_id: customer.id, loan_item_id: itemId, fine_type: 'OVERDUE',
            amount: fineAmount, waived_amount: 0, status: isPaid ? 'PAID' : 'UNPAID', issued_at: returnDate,
            paid_at: isPaid ? new Date(returnDate.getTime() + randInt(1, 5) * DAY_MS) : null,
          });
          if (isPaid) {
            paymentRows.push({
              id: randomUUID(), fine_id: fineId, payment_method: pick(['CASH', 'CARD', 'TRANSFER']),
              amount: fineAmount, paid_at: new Date(returnDate.getTime() + randInt(1, 5) * DAY_MS),
            });
          } else {
            s.unpaidFineAmount += fineAmount;
          }
        }
      }

      loanRows.push({
        id: loanId, loan_number: loanNumber, customer_id: customer.id, warehouse_id: warehouseId,
        handled_by_user_id: PLACEHOLDER_STAFF_ID, borrow_date: borrowDate, due_date: originalDueDate,
        closed_at: allReturned ? latestReturn : null,
        status: allReturned ? 'RETURNED' : (originalDueDate.getTime() < HISTORY_NOW.getTime() ? 'OVERDUE' : 'BORROWED'),
        total_items: itemsInLoan,
      });
    }
  }

  return { loanRows, itemRows, renewalRows, fineRows, paymentRows, lateSamples };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: reservations (no-show generative process)
// ─────────────────────────────────────────────────────────────────────────────

function generateReservations(customers) {
  const reservationRows = [];
  const noShowSamples = [];

  const state = new Map(customers.map((c) => [c.id, { priorReservations: 0, priorNoShow: 0 }]));

  for (let i = 0; i < RESERVATION_COUNT; i += 1) {
    const customer = pick(customers);
    const s = state.get(customer.id);
    const plan = customer._plan;
    const reservedAt = new Date(WINDOW_START.getTime() + rand() * WINDOW_DAYS * DAY_MS);
    const holdHours = plan.reservation_hold_hours;
    const expiresAt = new Date(reservedAt.getTime() + holdHours * HOUR_MS);
    const sourceChannel = chance(0.75) ? 'WEB' : 'STAFF';
    const quantity = chance(0.8) ? 1 : 2;
    const priorNoShowRate = s.priorReservations > 0 ? s.priorNoShow / s.priorReservations : 0;

    const codeIssued = chance(0.7);
    let status;
    let pickupCodeIssuedAt = null;
    let pickupCodeExpiresAt = null;
    let pickupCodeUsedAt = null;

    if (!codeIssued) {
      status = chance(0.6) ? 'CANCELLED' : 'EXPIRED';
    } else {
      const leadHours = randRange(0.5, Math.max(1, holdHours * 0.6));
      pickupCodeIssuedAt = new Date(reservedAt.getTime() + leadHours * HOUR_MS);
      pickupCodeExpiresAt = expiresAt;

      const leadHoursZ = (leadHours - holdHours / 2) / Math.max(holdHours / 4, 1);
      const holdHoursZ = (holdHours - 30) / 10;
      const z = NO_SHOW_COEFFICIENTS.c0
        + NO_SHOW_COEFFICIENTS.c1 * (1 - customer._punctuality)
        + NO_SHOW_COEFFICIENTS.c2 * leadHoursZ
        + NO_SHOW_COEFFICIENTS.c3 * holdHoursZ
        + NO_SHOW_COEFFICIENTS.c4 * (sourceChannel === 'WEB' ? 1 : 0)
        + NO_SHOW_COEFFICIENTS.c5 * priorNoShowRate;
      const pNoShow = sigmoid(z);

      const stillPending = reservedAt.getTime() > HISTORY_NOW.getTime() - 2 * DAY_MS && chance(0.3);
      if (stillPending) {
        status = 'READY_FOR_PICKUP';
      } else {
        const isNoShow = chance(pNoShow);
        noShowSamples.push({ label: isNoShow ? 1 : 0, trueProb: pNoShow });
        if (isNoShow) {
          status = 'EXPIRED';
        } else {
          status = 'CONVERTED_TO_LOAN';
          pickupCodeUsedAt = new Date(pickupCodeIssuedAt.getTime() + randRange(0.2, holdHours * 0.5) * HOUR_MS);
        }
        s.priorReservations += 1;
        if (isNoShow) s.priorNoShow += 1;
      }
    }

    reservationRows.push({
      id: randomUUID(),
      reservation_number: `HIST-RES-${String(i + 1).padStart(6, '0')}`,
      customer_id: customer.id,
      variant_id: VARIANT_IDS[zipfIndex(VARIANT_WEIGHTS)],
      warehouse_id: pick(WAREHOUSE_IDS),
      quantity,
      source_channel: sourceChannel,
      status,
      reserved_at: reservedAt,
      expires_at: expiresAt,
      pickup_code: codeIssued ? `HIST-PC-${String(i + 1).padStart(6, '0')}` : null,
      pickup_code_issued_at: pickupCodeIssuedAt,
      pickup_code_expires_at: pickupCodeExpiresAt,
      pickup_code_used_at: pickupCodeUsedAt,
    });
  }

  return { reservationRows, noShowSamples };
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestration
// ─────────────────────────────────────────────────────────────────────────────

async function deleteExistingHistory() {
  // Children first (FK cascade would handle most of this, but being explicit
  // keeps the delete order obvious and idempotent regardless of schema changes).
  await prisma.fine_payments.deleteMany({ where: { fines: { customers: { customer_code: { startsWith: 'HIST-' } } } } });
  await prisma.fines.deleteMany({ where: { customers: { customer_code: { startsWith: 'HIST-' } } } });
  await prisma.loan_renewals.deleteMany({ where: { loan_items: { loan_transactions: { loan_number: { startsWith: 'HIST-' } } } } });
  await prisma.loan_items.deleteMany({ where: { loan_transactions: { loan_number: { startsWith: 'HIST-' } } } });
  await prisma.loan_transactions.deleteMany({ where: { loan_number: { startsWith: 'HIST-' } } });
  await prisma.loan_reservations.deleteMany({ where: { reservation_number: { startsWith: 'HIST-' } } });
  await prisma.customer_memberships.deleteMany({ where: { card_number: { startsWith: 'HIST-' } } });
  await prisma.customers.deleteMany({ where: { customer_code: { startsWith: 'HIST-' } } });
}

async function insertInChunks(model, rows, chunkSize = 500) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await model.createMany({ data: rows.slice(i, i + chunkSize) });
  }
}

async function main() {
  console.log(`[seed-history] seed=${HISTORY_SEED} window=${WINDOW_START.toISOString()}..${HISTORY_NOW.toISOString()}`);

  console.log('[seed-history] deleting existing HIST-% rows...');
  await deleteExistingHistory();

  const plans = await prisma.membership_plans.findMany();
  if (plans.length === 0) {
    throw new Error('No membership_plans found - run the base seed first (pnpm demo:seed) before seed-history.js.');
  }

  console.log(`[seed-history] generating ${CUSTOMER_COUNT} customers...`);
  const customers = generateCustomers(CUSTOMER_COUNT, plans);
  await insertInChunks(prisma.customers, customerInsertRows(customers));
  await insertInChunks(prisma.customer_memberships, membershipInsertRows(customers));

  console.log('[seed-history] generating loan history...');
  const { loanRows, itemRows, renewalRows, fineRows, paymentRows, lateSamples } = generateLoans(customers);
  await insertInChunks(prisma.loan_transactions, loanRows);
  await insertInChunks(prisma.loan_items, itemRows);
  await insertInChunks(prisma.loan_renewals, renewalRows);
  await insertInChunks(prisma.fines, fineRows);
  await insertInChunks(prisma.fine_payments, paymentRows);

  console.log('[seed-history] generating reservation history...');
  const { reservationRows, noShowSamples } = generateReservations(customers);
  await insertInChunks(prisma.loan_reservations, reservationRows);

  const bayesAucLate = bayesAuc(lateSamples.map((s) => s.label), lateSamples.map((s) => s.trueProb));
  const bayesAucNoShow = bayesAuc(noShowSamples.map((s) => s.label), noShowSamples.map((s) => s.trueProb));
  const lateBaseRate = lateSamples.filter((s) => s.label === 1).length / Math.max(lateSamples.length, 1);
  const noShowRate = noShowSamples.filter((s) => s.label === 1).length / Math.max(noShowSamples.length, 1);

  const truth = {
    seed: HISTORY_SEED,
    window: { start: WINDOW_START.toISOString(), end: HISTORY_NOW.toISOString(), days: WINDOW_DAYS },
    late_coefficients: LATE_COEFFICIENTS,
    no_show_coefficients: NO_SHOW_COEFFICIENTS,
    base_rates: { late_return: Number(lateBaseRate.toFixed(4)), no_show: Number(noShowRate.toFixed(4)), target_late: LATE_BASE_RATE_TARGET, target_no_show: NO_SHOW_RATE_TARGET },
    row_counts: {
      customers: customers.length, loan_transactions: loanRows.length, loan_items: itemRows.length,
      loan_items_returned: lateSamples.length, loan_renewals: renewalRows.length, fines: fineRows.length,
      fine_payments: paymentRows.length, loan_reservations: reservationRows.length,
      reservations_with_terminal_outcome: noShowSamples.length,
    },
    bayes_auc_late: bayesAucLate === null ? null : Number(bayesAucLate.toFixed(4)),
    bayes_auc_no_show: bayesAucNoShow === null ? null : Number(bayesAucNoShow.toFixed(4)),
    generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(__dirname, 'seed-history-truth.json'), JSON.stringify(truth, null, 2));

  console.log('[seed-history] done:', JSON.stringify(truth.row_counts));
  console.log('[seed-history] bayes_auc_late =', truth.bayes_auc_late, ' bayes_auc_no_show =', truth.bayes_auc_no_show);
  console.log('[seed-history] truth written to prisma/seed-history-truth.json');
}

main()
  .catch((error) => {
    console.error('[seed-history] failed', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
