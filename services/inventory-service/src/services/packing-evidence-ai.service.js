const AI_SERVICE_URL = String(process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');

// Counting stacked books from one photo is fuzzy, so a large pack may be off by
// one; a small pack must match exactly (1 expected vs 0 seen is a miss, not a match).
function countMatches(itemCount, expectedCount) {
  return itemCount > 0 && Math.abs(itemCount - expectedCount) <= (expectedCount > 3 ? 1 : 0);
}

function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Titles read off the photo that match no book in this order - a sign of a mixed-up pack. */
function findUnexpectedTitles(detectedTitles, expectedTitles) {
  const expected = expectedTitles.map(normalizeTitle).filter(Boolean);
  return detectedTitles.filter((detected) => {
    const title = normalizeTitle(detected);
    if (title.length < 3) return false;
    return !expected.some((exp) => exp.includes(title) || title.includes(exp));
  });
}

function decodeDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { contentType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

async function fetchImageBytes(storageRef) {
  if (storageRef.startsWith('data:')) {
    const decoded = decodeDataUrl(storageRef);
    if (!decoded) throw new Error('Invalid data URL for packing evidence');
    return decoded;
  }

  const response = await fetch(storageRef, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw new Error(`Failed to fetch evidence image: ${response.status}`);
  }
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await response.arrayBuffer());
  return { contentType, buffer };
}

// Verifies a PHOTO/LIVE_SNAPSHOT packing evidence image against the expected
// pack quantity and the order's book titles, via ai-service's vision model. Never throws — a failed AI
// call must not block the packing flow, so callers get an UNAVAILABLE result
// instead of an exception.
async function verifyPackingPhoto(storageRef, expectedCount, requestId, expectedTitles = []) {
  try {
    const { contentType, buffer } = await fetchImageBytes(storageRef);

    const formData = new FormData();
    formData.append('file', new Blob([buffer], { type: contentType }), 'evidence.jpg');

    const response = await fetch(`${AI_SERVICE_URL}/verify-packing-photo`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(20000),
      headers: { 'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY || '', ...(requestId ? { 'x-request-id': requestId } : {}) },
    });

    if (!response.ok) {
      console.warn(`[PackingEvidenceAI] ai-service returned ${response.status}`);
      return { status: 'UNAVAILABLE', result: null };
    }

    const data = await response.json();
    const itemCount = Number(data.item_count || 0);
    const detectedTitles = Array.isArray(data.detected_titles) ? data.detected_titles.map(String) : [];
    const unexpectedTitles = findUnexpectedTitles(detectedTitles, expectedTitles);
    const countOk = countMatches(itemCount, expectedCount);
    const status = countOk && unexpectedTitles.length === 0 ? 'MATCH' : 'MISMATCH';

    return {
      status,
      result: {
        item_count: itemCount,
        expected_count: expectedCount,
        detected_titles: detectedTitles,
        unexpected_titles: unexpectedTitles,
        count_matches: countOk,
        checked_at: new Date().toISOString(),
      },
    };
  } catch (err) {
    console.warn('[PackingEvidenceAI] verify failed:', err.message);
    return { status: 'UNAVAILABLE', result: null };
  }
}

module.exports = { verifyPackingPhoto, countMatches, findUnexpectedTitles };
