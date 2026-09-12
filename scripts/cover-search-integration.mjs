// Golden-path integration test for "Tim sach bang anh bia" (find book by cover
// photo). Mirrors scripts/ai-assistant-integration.mjs's conventions: real
// HTTP calls through the Gateway against a running docker compose stack, hard
// assertions on structure/permissions, soft (WARN, not FAIL) assertions on
// anything that depends on the LLM's own judgment.
//
// Slow by nature: the OCR leg (Ollama llava, CPU) can take up to ~90s per
// call (see services/ai-service/routes_cover_search.py's COVER_OCR_TIMEOUT_SECONDS),
// and the very first call after a cold start also pays the one-time cost of
// embedding the whole cover gallery (a few seconds per image). Run
// `POST /ai/find-book-by-cover/reindex` once beforehand (this script does it)
// so that cost is paid predictably instead of mid-assertion.
//
// Requires: a running stack with the `ai` profile up (Ollama + ai-service),
// and at least one seeded book_variants row with a real, fetchable
// cover_image_url (see data/smartbook_catalog_enrichment_seed.sql —
// `pnpm demo:seed` already applies it).

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const username = process.env.COVER_SEARCH_TEST_USERNAME || 'customer01';
const password = process.env.COVER_SEARCH_TEST_PASSWORD || '123456';

// A 1x1 transparent PNG — deliberately not a photo of anything, for the
// negative case. No network fetch needed to construct it.
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function login() {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: username, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.token) {
    throw new Error(`login failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body.token;
}

async function requestJson(path, token, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function requestPhoto(path, token, { buffer, filename, contentType }) {
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: contentType }), filename);
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function assertString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

async function findSeededCoverPhoto(token) {
  const { response, body } = await requestJson('/catalog/books', token);
  if (!response.ok) {
    throw new Error(`/catalog/books failed (${response.status}): ${JSON.stringify(body)}`);
  }
  const books = Array.isArray(body) ? body : [];
  const withCover = books.find(
    (book) => typeof book.cover_image_url === 'string' && /^https?:\/\//.test(book.cover_image_url),
  );
  if (!withCover) {
    throw new Error(
      'no seeded book has a real cover_image_url — run `pnpm demo:seed` (applies data/smartbook_catalog_enrichment_seed.sql) first',
    );
  }

  const imageResponse = await fetch(withCover.cover_image_url);
  if (!imageResponse.ok) {
    throw new Error(`could not download seeded cover image (${imageResponse.status}): ${withCover.cover_image_url}`);
  }
  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  return { book: withCover, buffer, contentType: imageResponse.headers.get('content-type') || 'image/jpeg' };
}

async function run() {
  const token = await login();
  let passed = 0;
  const total = 4;

  // 0. Warm the gallery on a predictable schedule instead of paying the cost
  //    mid-assertion (same operational advice as the README's demo runbook).
  {
    const { response, body } = await requestJson('/ai/find-book-by-cover/reindex', token, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`reindex failed (${response.status}): ${JSON.stringify(body)}`);
    }
    passed += 1;
    console.log(`PASS cover-search/reindex (indexed=${body.indexed} reused=${body.reused} removed=${body.removed})`);
  }

  // 1. Positive case: photograph a cover that IS in the gallery — the same
  //    image the gallery embedded, so the visual signal should score ~1.0.
  {
    const { book, buffer, contentType } = await findSeededCoverPhoto(token);
    const start = Date.now();
    const { response, body } = await requestPhoto('/ai/find-book-by-cover', token, {
      buffer,
      filename: 'cover.jpg',
      contentType,
    });
    const elapsedMs = Date.now() - start;
    if (!response.ok) {
      throw new Error(`find-book-by-cover failed (${response.status}): ${JSON.stringify(body)}`);
    }
    if (body.match_found !== true) {
      throw new Error(`expected match_found=true for a known cover, got: ${JSON.stringify(body)}`);
    }
    const top = body.candidates?.[0];
    if (!top || top.id !== book.id) {
      throw new Error(`expected "${book.title}" (${book.id}) to rank first, got: ${JSON.stringify(top)}`);
    }
    if (typeof top.confidence !== 'number' || top.confidence < 0.5) {
      throw new Error(`expected top candidate confidence >= 0.5, got ${top.confidence}`);
    }
    const hasVisualEvidence = Array.isArray(top.evidence) && top.evidence.some((item) => item.signal === 'visual');
    if (!hasVisualEvidence) {
      // Soft: OCR alone can also legitimately win this (see routes_cover_search.py's
      // fusion — a book can rank first on text evidence even without a visual hit),
      // but for the *exact same image the gallery embedded* the visual signal
      // should normally fire too.
      console.warn(`WARN cover-search/positive-match: no visual evidence in top candidate (best-effort check): ${JSON.stringify(top.evidence)}`);
    }
    passed += 1;
    console.log(`PASS cover-search/positive-match "${book.title}" confidence=${top.confidence} (${elapsedMs}ms)`);
  }

  // 2. Negative case: a blank image matches nothing — must not falsely claim
  //    a book with meaningful confidence, and must not hang past the server's
  //    own OCR timeout.
  {
    const start = Date.now();
    const { response, body } = await requestPhoto('/ai/find-book-by-cover', token, {
      buffer: BLANK_PNG,
      filename: 'blank.png',
      contentType: 'image/png',
    });
    const elapsedMs = Date.now() - start;
    if (!response.ok) {
      throw new Error(`find-book-by-cover (blank) failed (${response.status}): ${JSON.stringify(body)}`);
    }
    if (body.match_found !== false || (body.candidates?.length ?? 0) !== 0) {
      throw new Error(`expected no match for a blank image, got: ${JSON.stringify(body)}`);
    }
    passed += 1;
    console.log(`PASS cover-search/no-false-match (${elapsedMs}ms)`);
  }

  // 3. A non-image upload must be rejected before any AI work starts (fast,
  //    deterministic — no LLM/CLIP call involved).
  {
    const start = Date.now();
    const { response } = await requestPhoto('/ai/find-book-by-cover', token, {
      buffer: Buffer.from('not an image'),
      filename: 'notes.txt',
      contentType: 'text/plain',
    });
    const elapsedMs = Date.now() - start;
    if (response.status !== 400) {
      throw new Error(`expected 400 for a non-image upload, got ${response.status}`);
    }
    if (elapsedMs > 5000) {
      throw new Error(`expected the non-image rejection to be fast (no AI work), took ${elapsedMs}ms`);
    }
    passed += 1;
    console.log(`PASS cover-search/rejects-non-image (${elapsedMs}ms)`);
  }

  console.log(`PASS=${passed} TOTAL=${total}`);
}

run().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
