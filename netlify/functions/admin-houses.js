// Per-house summary for the admin panel: today's occupancy (derived from
// bookings) plus a manually-toggled cleaned flag (its own blob, since
// cleaning happens on a schedule the booking data doesn't track).
// GET returns all 8 houses. PATCH { houseId, cleaned } toggles one.
// Env vars required: ADMIN_SESSION_SECRET

const { connectLambda, getStore } = require('@netlify/blobs');
const { requireSession } = require('./lib/auth');

const HOUSE_IDS = [1, 2, 3, 4, 5, 6, 7, 8];
const BOOKINGS_KEY = 'all';
const STATUS_KEY = 'all';
const MAX_RETRIES = 20;

exports.handler = async (event) => {
  connectLambda(event);

  const sessionSecret = process.env.ADMIN_SESSION_SECRET;
  if (!sessionSecret) {
    return json(500, { error: 'missing_config', message: 'ADMIN_SESSION_SECRET not set' });
  }
  if (!requireSession(event, sessionSecret)) {
    return json(401, { error: 'unauthorized' });
  }

  const bookingsStore = getStore('bookings');
  const statusStore = getStore('house-status');

  if (event.httpMethod === 'GET') {
    const bookingsEntry = await bookingsStore.getWithMetadata(BOOKINGS_KEY, { type: 'json' });
    const bookings = (bookingsEntry && bookingsEntry.data) || [];
    const statusEntry = await statusStore.getWithMetadata(STATUS_KEY, { type: 'json' });
    const cleanedMap = (statusEntry && statusEntry.data) || {};

    const today = new Date().toISOString().slice(0, 10);

    const houses = HOUSE_IDS.map((houseId) => {
      const current = bookings.find(
        (b) => b.houseId === houseId && b.status !== 'cancelled' && b.checkIn <= today && today < b.checkOut
      );
      return {
        houseId,
        occupied: Boolean(current),
        guest: current ? { firstName: current.firstName, lastName: current.lastName, checkOut: current.checkOut } : null,
        cleaned: cleanedMap[houseId] === undefined ? true : Boolean(cleanedMap[houseId])
      };
    });

    return json(200, { houses });
  }

  if (event.httpMethod === 'PATCH') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'invalid_json' });
    }

    const houseId = Number(body.houseId);
    if (!HOUSE_IDS.includes(houseId)) {
      return json(400, { error: 'invalid_input', message: 'invalid houseId' });
    }
    const cleaned = Boolean(body.cleaned);

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const entry = await statusStore.getWithMetadata(STATUS_KEY, { type: 'json' });
      const cleanedMap = (entry && entry.data) || {};
      const etag = entry && entry.etag;

      const next = { ...cleanedMap, [houseId]: cleaned };

      const writeOptions = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
      const { modified } = await statusStore.setJSON(STATUS_KEY, next, writeOptions);
      if (modified) return json(200, { houseId, cleaned });
      // Concurrent write — reread and retry.
    }

    return json(409, { error: 'conflict', message: 'Too many concurrent updates, please retry' });
  }

  return json(405, { error: 'method_not_allowed' });
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
