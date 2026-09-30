// Reconciles data/smartbook_catalog_enrichment_seed.sql with a database that
// already holds the base `prisma db seed` catalog.
//
// The dump re-includes rows the base seed creates (same authors, publishers,
// categories, books, variants) but under the ids of the database it was dumped
// from. Those tables have natural unique keys (authors.full_name, books.book_code,
// ...), so the parent INSERTs are skipped by ON CONFLICT DO NOTHING while the child
// rows (book_authors, book_categories, book_variants) still name the dump's ids and
// fail their foreign keys. remapCatalogIds rewrites the dump's ids to the ids that
// already exist, matched by natural key.

// Every column that is unique on its own in services/inventory-service/prisma/schema.prisma.
export const NATURAL_KEYS = {
  publishers: ["code", "name"],
  categories: ["slug"],
  authors: ["full_name"],
  books: ["book_code"],
  book_variants: ["sku", "isbn13", "isbn10", "internal_barcode"],
};

// One JSON document: { table: [{ id, ...naturalKeyColumns }] } for the live database.
export function existingRowsQuery() {
  const tables = Object.entries(NATURAL_KEYS).map(
    ([table, keys]) =>
      `'${table}', (SELECT coalesce(json_agg(t), '[]'::json) FROM (SELECT id, ${keys.join(", ")} FROM public.${table}) t)`,
  );
  return `SELECT json_build_object(${tables.join(", ")});`;
}

// Splits the inside of `VALUES (...)`: 'quoted' strings ('' escapes a quote), NULL, bare literals.
function splitValues(text) {
  const values = [];
  let current = "";
  let quoted = false;
  let wasQuoted = false;
  const push = () => {
    values.push(wasQuoted ? current : current.trim() === "NULL" ? null : current.trim());
    current = "";
    wasQuoted = false;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === "'" && text[i + 1] === "'") {
        current += "'";
        i++;
      } else if (char === "'") {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === "'") {
      quoted = true;
      wasQuoted = true;
      current = ""; // drop the space after the previous comma
    } else if (char === ",") {
      push();
    } else if (wasQuoted && char === " ") {
      // whitespace between a closing quote and the next comma
    } else {
      current += char;
    }
  }
  push();
  return values;
}

// The dump is one `INSERT INTO public.t (cols) VALUES (...) ON CONFLICT DO NOTHING;` per line.
export function parseInsertRows(sql) {
  const rows = [];
  for (const line of sql.split(/\r?\n/)) {
    const match = /^INSERT INTO public\.(\w+) \(([^)]*)\) VALUES \((.*)\) ON CONFLICT DO NOTHING;$/.exec(line);
    if (!match) continue;
    const columns = match[2].split(",").map((column) => column.trim());
    const values = splitValues(match[3]);
    rows.push({ table: match[1], values: Object.fromEntries(columns.map((column, i) => [column, values[i]])) });
  }
  return rows;
}

// existing: { table: [{ id, ...naturalKeyColumns }] } as returned by existingRowsQuery().
// Returns the rewritten SQL and a Map of dumpId -> existingId.
export function remapCatalogIds(sql, existing) {
  const rows = parseInsertRows(sql);
  const remapped = new Map();

  for (const [table, keys] of Object.entries(NATURAL_KEYS)) {
    const idByKey = new Map();
    for (const row of existing[table] ?? []) {
      for (const key of keys) {
        if (row[key] != null) idByKey.set(`${key}\0${row[key]}`, row.id);
      }
    }
    for (const row of rows) {
      if (row.table !== table) continue;
      for (const key of keys) {
        const existingId = row.values[key] != null && idByKey.get(`${key}\0${row.values[key]}`);
        if (!existingId) continue;
        if (existingId !== row.values.id) remapped.set(row.values.id, existingId);
        break;
      }
    }
  }

  let out = sql;
  for (const [dumpId, existingId] of remapped) out = out.split(dumpId).join(existingId);
  return { sql: out, remapped };
}
