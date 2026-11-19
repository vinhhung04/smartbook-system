// ISBN-10 / ISBN-13 / retail EAN-13 classification through the live stack
// (browser path: gateway -> inventory-service / ai-service). Creates throw-away books
// with random, checksum-valid codes and deletes them at the end.
//
//   node scripts/isbn-ean-classification-integration.mjs
//
// The EAN -> ISBN cross lookup case is deterministic: the book is first saved with its
// ISBN and its EAN, so the library catalog (lookup source 0) states both codes. The
// rest of the lookup still asks the outside sources and can take up to ~45 s.
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
const ADMIN_IDENTIFIER = process.env.ADMIN_IDENTIFIER || 'hung';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';

let passed = 0;
const created = [];

function fail(message, context = {}) {
  throw new Error(`${message}\n${JSON.stringify(context, null, 2)}`);
}
function pass(label) { passed += 1; console.log(`PASS ${label}`); }
function check(condition, label, context) { if (!condition) fail(`FAIL ${label}`, context); pass(label); }

async function request(method, path, { token, body } = {}) {
  const response = await fetch(`${GATEWAY_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
function withEanCheck(twelve) {
  const sum = [...twelve].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
  return `${twelve}${(10 - (sum % 10)) % 10}`;
}
const badCheck = (code) => `${code.slice(0, 12)}${(Number(code[12]) + 1) % 10}`;

async function main() {
  const login = await request('POST', '/auth/login', { body: { identifier: ADMIN_IDENTIFIER, password: ADMIN_PASSWORD } });
  const token = login.data?.token;
  if (!token) fail('Login failed', login);
  const T = { token };

  const ean = withEanCheck(`893${digits(9)}`);
  const isbn = withEanCheck(`9798${digits(8)}`);
  const pairedEan = withEanCheck(`893${digits(9)}`);
  const pairedIsbn = withEanCheck(`9798${digits(8)}`);
  const stamp = Date.now();

  // 1. An EAN sent as isbn13 (the goods-receipt / catalog screens do) is stored as the barcode only.
  const eanBook = await request('POST', '/api/books/incomplete', { ...T, body: { isbn13: ean, title: `EAN only ${stamp}`, price: 0 } });
  check(eanBook.status === 201 && eanBook.data?.data?.isbn13 === null && eanBook.data?.data?.barcode === ean,
    'incomplete book from a retail EAN-13: internal_barcode = EAN, isbn13 = null', eanBook);
  created.push(eanBook.data.data.book_id);

  // 2. Scanning that EAN still finds the edition (web goods receipt + mobile).
  const byIsbn13Route = await request('GET', `/api/books/isbn13/${ean}`, T);
  check(byIsbn13Route.status === 200 && byIsbn13Route.data?.variant_id === eanBook.data.data.variant_id,
    'goods-receipt scan (/books/isbn13/:code) finds the EAN through internal_barcode', byIsbn13Route);
  const byBarcode = await request('GET', `/api/books/barcode/${ean}`, T);
  check(byBarcode.status === 200, 'barcode scan (/books/barcode/:code) finds the EAN', byBarcode);

  // 3. The same EAN again is the same variant, not a second book.
  const again = await request('POST', '/api/books/incomplete', { ...T, body: { barcode: ean, title: 'again', price: 0 } });
  check(again.status === 200 && again.data?.data?.created_new === false && again.data?.data?.variant_id === eanBook.data.data.variant_id,
    'the same EAN twice returns the existing variant (no duplicate)', again);

  // 4. Codes with a wrong check digit are refused.
  const badEan = await request('POST', '/api/books/incomplete', { ...T, body: { isbn13: badCheck(ean), title: 'bad', price: 0 } });
  check(badEan.status === 400, 'an EAN-13 with a wrong check digit is refused', badEan);
  const badIsbn = await request('POST', '/api/books/incomplete', { ...T, body: { isbn13: '9780132350885', title: 'bad', price: 0 } });
  check(badIsbn.status === 400, 'an ISBN-13 with a wrong check digit is refused', badIsbn);

  // 5. A book with its ISBN and its EAN: both stored, each in its own column.
  const paired = await request('POST', '/api/books/incomplete', { ...T, body: { isbn13: pairedIsbn, barcode: pairedEan, title: `Paired ${stamp}`, price: 0 } });
  check(paired.status === 201 && paired.data?.data?.isbn13 === pairedIsbn && paired.data?.data?.barcode === pairedEan,
    'ISBN + EAN of one edition: isbn13 = ISBN, internal_barcode = EAN', paired);
  created.push(paired.data.data.book_id);

  // 6. The catalog update refuses a code in a column of another kind.
  const id = eanBook.data.data.book_id;
  const eanAsIsbn = await request('PATCH', `/api/books/${id}`, { ...T, body: { title: `EAN only ${stamp}`, isbn13: ean } });
  check(eanAsIsbn.status === 400, 'PATCH isbn13 = retail EAN-13 is refused', eanAsIsbn);
  const badIsbn10 = await request('PATCH', `/api/books/${id}`, { ...T, body: { title: `EAN only ${stamp}`, isbn10: '0132350883' } });
  check(badIsbn10.status === 400, 'PATCH isbn10 with a wrong check digit is refused', badIsbn10);
  const badBarcode = await request('PATCH', `/api/books/${id}`, { ...T, body: { title: `EAN only ${stamp}`, internal_barcode: badCheck(ean) } });
  check(badBarcode.status === 400, 'PATCH internal_barcode with a wrong EAN-13 check digit is refused', badBarcode);
  const isbn10 = '080442957X';
  const goodIsbn = withEanCheck(`9798${digits(8)}`);
  const ok = await request('PATCH', `/api/books/${id}`, { ...T, body: { title: `EAN only ${stamp}`, isbn13: goodIsbn, isbn10: isbn10.toLowerCase() } });
  check(ok.status === 200, 'PATCH a valid ISBN-13 and an ISBN-10 with x check digit is accepted', ok);

  // 7. Duplicate check: the EAN matches as a barcode (SAME_EDITION), never as an ISBN.
  const dup = await request('POST', '/api/duplicate-intelligence/check', { ...T, body: { normalizedMetadata: { barcode: pairedEan, title: 'Something else' } } });
  const top = dup.data?.data?.candidates?.[0];
  check(dup.status === 201 && top?.bookId === paired.data.data.book_id && top?.classification === 'SAME_EDITION' && top?.signals?.isbnMatch === false,
    'duplicate check finds the edition by its EAN as a barcode match', dup.data?.data?.candidates?.slice(0, 2));

  // 8. AI lookup: classification before any source is asked.
  const invalid = await request('POST', '/ai/lookup-book-by-isbn', { ...T, body: { isbn: badCheck(ean) } });
  check(invalid.status === 200 && invalid.data?.found === false && invalid.data?.codeKind === 'INVALID' && !invalid.data?.verification,
    'lookup of an EAN with a wrong check digit asks no source', invalid.data);

  // 9. EAN -> ISBN cross lookup from the library's own record stating both codes.
  const cross = await request('POST', '/ai/lookup-book-by-isbn', { ...T, body: { isbn: pairedEan } });
  const c = cross.data?.crossLookup;
  check(cross.status === 200 && cross.data?.codeKind === 'EAN13' && cross.data?.isbn13 === null,
    'lookup of a retail EAN-13 reports it as EAN13 and never as isbn13', { codeKind: cross.data?.codeKind, isbn13: cross.data?.isbn13 });
  check(c?.direction === 'EAN_TO_ISBN' && c?.status === 'VERIFIED' && c?.value === pairedIsbn && c?.evidence?.some((e) => e.source === 'catalog'),
    'cross lookup links the EAN to its ISBN from the catalog record (VERIFIED, with evidence)', c);

  // 10. ISBN -> EAN: the same record offers the retail EAN for a scanned ISBN.
  const reverse = await request('POST', '/ai/lookup-book-by-isbn', { ...T, body: { isbn: pairedIsbn } });
  check(reverse.data?.codeKind === 'ISBN13' && reverse.data?.isbn13 === pairedIsbn && reverse.data?.crossLookup?.direction === 'ISBN_TO_EAN'
    && reverse.data?.crossLookup?.value === pairedEan, 'ISBN lookup offers the retail EAN the catalog record states', reverse.data?.crossLookup);
}

try {
  await main();
  console.log(`\n${passed} checks passed`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (created.length) {
    const login = await request('POST', '/auth/login', { body: { identifier: ADMIN_IDENTIFIER, password: ADMIN_PASSWORD } });
    for (const id of created) {
      const res = await request('DELETE', `/api/books/${id}`, { token: login.data?.token });
      if (res.status !== 200) console.warn(`cleanup: could not delete book ${id} (${res.status})`);
    }
  }
}
