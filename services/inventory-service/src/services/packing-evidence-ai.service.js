const AI_SERVICE_URL = String(process.env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
const MATCH_TOLERANCE = 1;

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
// pack quantity, via ai-service's vision model. Never throws — a failed AI
// call must not block the packing flow, so callers get an UNAVAILABLE result
// instead of an exception.
async function verifyPackingPhoto(storageRef, expectedCount) {
  try {
    const { contentType, buffer } = await fetchImageBytes(storageRef);

    const formData = new FormData();
    formData.append('file', new Blob([buffer], { type: contentType }), 'evidence.jpg');

    const response = await fetch(`${AI_SERVICE_URL}/verify-packing-photo`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      console.warn(`[PackingEvidenceAI] ai-service returned ${response.status}`);
      return { status: 'UNAVAILABLE', result: null };
    }

    const data = await response.json();
    const itemCount = Number(data.item_count || 0);
    const status = Math.abs(itemCount - expectedCount) <= MATCH_TOLERANCE ? 'MATCH' : 'MISMATCH';

    return {
      status,
      result: {
        item_count: itemCount,
        expected_count: expectedCount,
        detected_titles: Array.isArray(data.detected_titles) ? data.detected_titles : [],
        checked_at: new Date().toISOString(),
      },
    };
  } catch (err) {
    console.warn('[PackingEvidenceAI] verify failed:', err.message);
    return { status: 'UNAVAILABLE', result: null };
  }
}

module.exports = { verifyPackingPhoto };
