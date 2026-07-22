// Creates a reservation in Netlify Blobs, atomically assigning the first
// free house for the date range. No external DB — storage is a single JSON
// blob ("all") in the "bookings" store, updated via optimistic concurrency
// (ETag compare-and-swap) so concurrent requests can't double-book a house.

const { randomUUID } = require('crypto');
const { connectLambda, getStore } = require('@netlify/blobs');
const { sendBookingEmail } = require('./lib/email');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_STAY_NIGHTS = 2;
const MIN_LEAD_DAYS = 7;
const HOUSE_IDS = [1, 2, 3, 4, 5, 6, 7, 8];
const BLOB_KEY = 'all';
const MAX_RETRIES = 20;

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();
  const email = String(body.email || '').trim();
  const phone = String(body.phone || '').trim();
  const checkIn = String(body.checkIn || '').trim();
  const checkOut = String(body.checkOut || '').trim();

  if (!firstName || !lastName || !phone) {
    return json(400, { error: 'invalid_input', message: 'missing name or phone' });
  }
  if (!EMAIL_RE.test(email)) {
    return json(400, { error: 'invalid_input', message: 'invalid email' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
    return json(400, { error: 'invalid_input', message: 'dates must be YYYY-MM-DD' });
  }

  const today = new Date(new Date().toISOString().slice(0, 10));
  const minCheckIn = new Date(today);
  minCheckIn.setDate(minCheckIn.getDate() + MIN_LEAD_DAYS);
  const inDate = new Date(checkIn);
  const outDate = new Date(checkOut);
  const nights = (outDate - inDate) / 86400000;

  if (inDate < minCheckIn) {
    return json(400, { error: 'invalid_input', message: `check-in must be at least ${MIN_LEAD_DAYS} days from today` });
  }
  if (nights < MIN_STAY_NIGHTS) {
    return json(400, { error: 'invalid_input', message: `minimum stay is ${MIN_STAY_NIGHTS} nights` });
  }

  const store = getStore('bookings');

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const entry = await store.getWithMetadata(BLOB_KEY, { type: 'json' });
    const bookings = (entry && entry.data) || [];
    const etag = entry && entry.etag;

    const houseId = HOUSE_IDS.find((id) => !overlaps(bookings, id, checkIn, checkOut));
    if (!houseId) {
      return json(409, { error: 'no_availability', message: 'Brak wolnych domków w tym terminie' });
    }

    const booking = {
      id: randomUUID(),
      houseId,
      firstName,
      lastName,
      email,
      phone,
      checkIn,
      checkOut,
      status: 'pending',
      depositAmount: 500,
      depositPaid: false,
      cleaned: false,
      createdAt: new Date().toISOString()
    };

    const writeOptions = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
    const { modified } = await store.setJSON(BLOB_KEY, [...bookings, booking], writeOptions);

    if (modified) {
      await sendBookingEmail('received', booking);
      return json(201, {
        id: booking.id,
        houseId: booking.houseId,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        depositAmount: booking.depositAmount,
        status: booking.status
      });
    }
    // Someone else wrote in between — reread and retry.
  }

  return json(409, { error: 'conflict', message: 'Too many concurrent bookings, please retry' });
};

function overlaps(bookings, houseId, checkIn, checkOut) {
  return bookings.some(
    (b) => b.houseId === houseId && b.status !== 'cancelled' && checkIn < b.checkOut && checkOut > b.checkIn
  );
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
