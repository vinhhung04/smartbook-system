const GATEWAY_URL = process.env.GATEWAY_URL || 'http://api-gateway:3000';
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || 'smartbook_internal_key';
const SERVICE_NAME = 'inventory-service';

async function pushEvent({ room, event, data }) {
  try {
    const res = await fetch(`${GATEWAY_URL}/internal/push-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': INTERNAL_SERVICE_KEY,
        'X-Service-Name': SERVICE_NAME,
      },
      body: JSON.stringify({ room, event, data }),
    });
    if (!res.ok) {
      console.warn(`[inv-socket-emitter] push failed ${res.status}:`, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.warn('[inv-socket-emitter] push error (gateway unreachable):', err.message);
  }
}

async function pushEvents(events) {
  try {
    const res = await fetch(`${GATEWAY_URL}/internal/push-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': INTERNAL_SERVICE_KEY,
        'X-Service-Name': SERVICE_NAME,
      },
      body: JSON.stringify({ events }),
    });
    if (!res.ok) {
      console.warn(`[inv-socket-emitter] batch push failed ${res.status}`);
    }
  } catch (err) {
    console.warn('[inv-socket-emitter] batch push error:', err.message);
  }
}

/**
 * Emit an event to multiple rooms in a single batch call.
 */
function pushToRooms(rooms, event, data) {
  const events = rooms.map((room) => ({ room, event, data }));
  return pushEvents(events);
}

module.exports = { pushEvent, pushEvents, pushToRooms };
