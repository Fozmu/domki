// Lists and updates reservations for the admin panel.
// GET  ?scope=today|upcoming|all (default all)
// PATCH { id, status?, depositPaid?, cleaned? }
// Env vars required: ADMIN_SESSION_SECRET

const { connectLambda, getStore } = require('@netlify/blobs');
const { requireSession } = require('./lib/auth');

const BLOB_KEY = 'all';
const MAX_RETRIES = 20;
const VALID_STATUS = ['pending', 'confirmed', 'cancelled'];

exports.handler = async (event) => {
  connectLambda(event);

  const sessionSecret = process.env.ADMIN_SESSION_SECRET;
  if (!sessionSecret) {
    return json(500, { error: 'missing_config', message: 'ADMIN_SESSION_SECRET not set' });
  }
  if (!requireSession(event, sessionSecret)) {
    return json(401, { error: 'unauthorized' });
  }

  const store = getStore('bookings');

  if (event.httpMethod === 'GET') {
    const entry = await store.getWithMetadata(BLOB_KEY, { type: 'json' });
    const bookings = (entry && entry.data) || [];
    const scope = (event.queryStringParameters && event.queryStringParameters.scope) || 'all';
    const today = new Date().toISOString().slice(0, 10);

    let filtered = bookings;
    if (scope === 'today') filtered = bookings.filter((b) => b.checkIn === today);
    else if (scope === 'upcoming') filtered = bookings.filter((b) => b.checkIn > today);

    filtered = [...filtered].sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    return json(200, { bookings: filtered });
  }

  if (event.httpMethod === 'PATCH') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'invalid_json' });
    }

    const id = String(body.id || '');
    if (!id) return json(400, { error: 'invalid_input', message: 'missing id' });
    if (body.status !== undefined && !VALID_STATUS.includes(body.status)) {
      return json(400, { error: 'invalid_input', message: 'invalid status' });
    }

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const entry = await store.getWithMetadata(BLOB_KEY, { type: 'json' });
      const bookings = (entry && entry.data) || [];
      const etag = entry && entry.etag;

      const idx = bookings.findIndex((b) => b.id === id);
      if (idx === -1) return json(404, { error: 'not_found' });

      const updated = { ...bookings[idx] };
      if (body.status !== undefined) updated.status = body.status;
      if (body.depositPaid !== undefined) updated.depositPaid = Boolean(body.depositPaid);
      if (body.cleaned !== undefined) updated.cleaned = Boolean(body.cleaned);

      const next = [...bookings];
      next[idx] = updated;

      const writeOptions = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
      const { modified } = await store.setJSON(BLOB_KEY, next, writeOptions);
      if (modified) return json(200, { booking: updated });
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
