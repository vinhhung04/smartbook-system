// In-memory fake of the Prisma client, just rich enough for the procurement document workflow
// tests (where operators, relation includes, counts, createMany/updateMany). Each test builds its
// own instance, so no state leaks between tests.
const crypto = require('crypto');

const RELATIONS = {
  purchase_orders: {
    suppliers: { model: 'suppliers', local: 'supplier_id', foreign: 'id' },
    purchase_order_items: { model: 'purchase_order_items', local: 'id', foreign: 'purchase_order_id', many: true },
    supplier_order_dispatches: { model: 'supplier_order_dispatches', local: 'id', foreign: 'purchase_order_id', many: true },
  },
  procurement_documents: {
    purchase_orders: { model: 'purchase_orders', local: 'purchase_order_id', foreign: 'id' },
    suppliers: { model: 'suppliers', local: 'supplier_id', foreign: 'id' },
    goods_receipts: { model: 'goods_receipts', local: 'goods_receipt_id', foreign: 'id' },
    superseded_by: { model: 'procurement_documents', local: 'id', foreign: 'supersedes_document_id', many: true },
    procurement_document_lines: { model: 'procurement_document_lines', local: 'id', foreign: 'document_id', many: true },
    procurement_document_files: { model: 'procurement_document_files', local: 'id', foreign: 'document_id', many: true },
    procurement_document_shares: { model: 'procurement_document_shares', local: 'id', foreign: 'document_id', many: true },
  },
  procurement_document_lines: {
    book_variants: { model: 'book_variants', local: 'variant_id', foreign: 'id' },
  },
  goods_receipts: {
    goods_receipt_items: { model: 'goods_receipt_items', local: 'id', foreign: 'goods_receipt_id', many: true },
    supplier_delivery_invoices: { model: 'supplier_delivery_invoices', local: 'supplier_delivery_invoice_id', foreign: 'id' },
  },
  goods_receipt_items: {
    book_variants: { model: 'book_variants', local: 'variant_id', foreign: 'id' },
  },
  supplier_delivery_invoices: {
    supplier_delivery_invoice_items: { model: 'supplier_delivery_invoice_items', local: 'id', foreign: 'invoice_id', many: true },
    purchase_orders: { model: 'purchase_orders', local: 'purchase_order_id', foreign: 'id' },
  },
  supplier_shortage_reports: {
    supplier_shortage_report_items: { model: 'supplier_shortage_report_items', local: 'id', foreign: 'shortage_report_id', many: true },
  },
};

const DEFAULTS = {
  procurement_documents: () => ({ metadata: {}, status: 'DRAFT', created_at: new Date(), updated_at: new Date() }),
  procurement_document_shares: () => ({ shared_at: new Date(), updated_at: new Date(), delivered_at: null, acknowledged_at: null }),
  procurement_document_files: () => ({ created_at: new Date() }),
  goods_receipt_items: () => ({ actual_quantity: null, delivered_qty: null, damaged_qty: 0, rejected_qty: 0 }),
  supplier_shortage_reports: () => ({ status: 'OPEN', discrepancy_type: 'SHORTAGE', created_at: new Date(), updated_at: new Date() }),
  supplier_shortage_report_items: () => ({ discrepancy_type: 'SHORTAGE' }),
  purchase_order_supplier_responses: () => ({ review_status: 'NOT_REQUIRED', created_at: new Date() }),
  inventory_audit_logs: () => ({ created_at: new Date() }),
  goods_receipts: () => ({ created_at: new Date(), updated_at: new Date() }),
};

function eq(a, b) {
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  return a === b || (a != null && b != null && String(a) === String(b));
}

function createFakeDb(seed = {}) {
  const tables = {};
  const table = (name) => {
    if (!tables[name]) tables[name] = (seed[name] || []).map((row) => ({ ...row }));
    return tables[name];
  };
  Object.keys(seed).forEach(table);

  function matchValue(value, cond) {
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) return eq(value, cond);
    if ('equals' in cond) {
      return cond.mode === 'insensitive' ? String(value ?? '').toLowerCase() === String(cond.equals ?? '').toLowerCase() : eq(value, cond.equals);
    }
    if ('in' in cond) return cond.in.some((v) => eq(value, v));
    if ('notIn' in cond) return !cond.notIn.some((v) => eq(value, v));
    if ('not' in cond) return !matchValue(value, cond.not);
    if ('gt' in cond) return value != null && value > cond.gt;
    if ('lt' in cond) return value != null && value < cond.lt;
    return eq(value, cond);
  }

  function matches(modelName, row, where = {}) {
    return Object.entries(where).every(([key, cond]) => {
      if (key === 'AND') return cond.every((w) => matches(modelName, row, w));
      if (key === 'OR') return cond.some((w) => matches(modelName, row, w));
      const rel = RELATIONS[modelName]?.[key];
      if (rel && cond && typeof cond === 'object' && 'some' in cond) {
        return table(rel.model).some((other) => eq(other[rel.foreign], row[rel.local]) && matches(rel.model, other, cond.some));
      }
      return matchValue(row[key], cond);
    });
  }

  function hydrate(modelName, row, include, select) {
    if (!row) return null;
    let out = { ...row };
    if (select) {
      out = {};
      Object.entries(select).forEach(([key, val]) => {
        const rel = RELATIONS[modelName]?.[key];
        if (rel) Object.assign(out, hydrate(modelName, row, { [key]: val }));
        else if (val) out[key] = row[key];
      });
    }
    Object.entries(include || {}).forEach(([key, spec]) => {
      const rel = RELATIONS[modelName]?.[key];
      if (!rel || !spec) return;
      const nested = typeof spec === 'object' ? spec : {};
      if (rel.many) {
        let rows = table(rel.model).filter((other) => eq(other[rel.foreign], row[rel.local]));
        if (nested.where) rows = rows.filter((other) => matches(rel.model, other, nested.where));
        out[key] = rows.map((other) => hydrate(rel.model, other, nested.include, nested.select));
      } else {
        const other = table(rel.model).find((o) => eq(o[rel.foreign], row[rel.local]));
        out[key] = other ? hydrate(rel.model, other, nested.include, nested.select) : null;
      }
    });
    return out;
  }

  function sortRows(rows, orderBy) {
    if (!orderBy) return rows;
    const [[field, dir]] = Object.entries(Array.isArray(orderBy) ? orderBy[0] : orderBy);
    return [...rows].sort((a, b) => {
      const av = a[field] instanceof Date ? a[field].getTime() : a[field];
      const bv = b[field] instanceof Date ? b[field].getTime() : b[field];
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * (dir === 'desc' ? -1 : 1);
    });
  }

  function applyData(row, data) {
    Object.entries(data).forEach(([key, val]) => {
      if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
        if ('increment' in val) { row[key] = Number(row[key] || 0) + val.increment; return; }
        if ('decrement' in val) { row[key] = Number(row[key] || 0) - val.decrement; return; }
      }
      row[key] = val;
    });
  }

  function checkUnique(modelName, row) {
    const uniques = { goods_receipts: ['idempotency_key', 'receipt_number'], procurement_documents: ['document_number'] };
    for (const field of uniques[modelName] || []) {
      if (row[field] == null) continue;
      if (table(modelName).some((other) => other !== row && eq(other[field], row[field]))) {
        const error = new Error(`Unique constraint failed on ${field}`);
        error.code = 'P2002';
        throw error;
      }
    }
    if (modelName === 'procurement_document_files'
      && table(modelName).some((other) => other !== row && eq(other.document_id, row.document_id) && other.version_no === row.version_no)) {
      const error = new Error('Unique constraint failed on (document_id, version_no)');
      error.code = 'P2002';
      throw error;
    }
  }

  function model(modelName) {
    return {
      async findUnique({ where, include, select } = {}) {
        return hydrate(modelName, table(modelName).find((row) => matches(modelName, row, where)), include, select);
      },
      async findFirst({ where, include, select, orderBy } = {}) {
        const rows = sortRows(table(modelName).filter((row) => matches(modelName, row, where || {})), orderBy);
        return hydrate(modelName, rows[0], include, select);
      },
      async findMany({ where, include, select, orderBy, take } = {}) {
        let rows = sortRows(table(modelName).filter((row) => matches(modelName, row, where || {})), orderBy);
        if (take) rows = rows.slice(0, take);
        return rows.map((row) => hydrate(modelName, row, include, select));
      },
      async count({ where } = {}) {
        return table(modelName).filter((row) => matches(modelName, row, where || {})).length;
      },
      async create({ data, include }) {
        const row = { id: crypto.randomUUID(), ...(DEFAULTS[modelName]?.() || {}), ...data };
        table(modelName).push(row);
        try { checkUnique(modelName, row); } catch (error) { table(modelName).pop(); throw error; }
        return hydrate(modelName, row, include);
      },
      async createMany({ data }) {
        data.forEach((d) => table(modelName).push({ id: crypto.randomUUID(), ...(DEFAULTS[modelName]?.() || {}), ...d }));
        return { count: data.length };
      },
      async update({ where, data, include }) {
        const row = table(modelName).find((r) => matches(modelName, r, where));
        if (!row) throw new Error(`fake prisma: no ${modelName} row for update`);
        applyData(row, data);
        return hydrate(modelName, row, include);
      },
      async updateMany({ where, data }) {
        const rows = table(modelName).filter((r) => matches(modelName, r, where || {}));
        rows.forEach((row) => applyData(row, data));
        return { count: rows.length };
      },
    };
  }

  const client = new Proxy({}, {
    get(_target, prop) {
      if (prop === '$transaction') return async (fn) => fn(client);
      if (prop === 'then') return undefined;
      return model(prop);
    },
  });
  return { client, tables, table };
}

function installFakePrisma(client) {
  const prismaClientPath = require.resolve('@prisma/client');
  require.cache[prismaClientPath] = {
    id: prismaClientPath,
    filename: prismaClientPath,
    loaded: true,
    exports: { PrismaClient: function FakePrismaClient() { return client; } },
  };
}

function createFakeRes() {
  const chunks = [];
  const headers = {};
  return {
    statusCode: 200,
    body: undefined,
    headers,
    chunks,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    end() { this.ended = true; },
  };
}

module.exports = { createFakeDb, installFakePrisma, createFakeRes };
