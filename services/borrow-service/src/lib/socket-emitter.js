const GATEWAY_URL = process.env.GATEWAY_URL || 'http://api-gateway:3000';
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || 'smartbook_internal_key';

/**
 * Push a real-time event to the gateway's Socket.io server.
 * Fire-and-forget: failures are logged but never thrown.
 */
async function pushEvent({ room, event, data }) {
  try {
    const res = await fetch(`${GATEWAY_URL}/internal/push-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': INTERNAL_SERVICE_KEY,
      },
      body: JSON.stringify({ room, event, data }),
    });
    if (!res.ok) {
      console.warn(`[socket-emitter] push failed ${res.status}:`, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.warn('[socket-emitter] push error (gateway unreachable):', err.message);
  }
}

/**
 * Push multiple events in a single HTTP call.
 */
async function pushEvents(events) {
  try {
    const res = await fetch(`${GATEWAY_URL}/internal/push-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': INTERNAL_SERVICE_KEY,
      },
      body: JSON.stringify({ events }),
    });
    if (!res.ok) {
      console.warn(`[socket-emitter] batch push failed ${res.status}`);
    }
  } catch (err) {
    console.warn('[socket-emitter] batch push error:', err.message);
  }
}

module.exports = { pushEvent, pushEvents };
