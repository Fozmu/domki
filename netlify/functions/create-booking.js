// Creates a reservation via the create_booking() RPC in Supabase, which
// atomically assigns the first free house for the date range.
// Env vars required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_STAY_NIGHTS = 2;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return json(500, { error: 'missing_config', message: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set' });
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
  const inDate = new Date(checkIn);
  const outDate = new Date(checkOut);
  const nights = (outDate - inDate) / 86400000;

  if (inDate < today) {
    return json(400, { error: 'invalid_input', message: 'check-in is in the past' });
  }
  if (nights < MIN_STAY_NIGHTS) {
    return json(400, { error: 'invalid_input', message: `minimum stay is ${MIN_STAY_NIGHTS} nights` });
  }

  try {
    const res = await fetch(`${url}/rest/v1/rpc/create_booking`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        p_first_name: firstName,
        p_last_name: lastName,
        p_email: email,
        p_phone: phone,
        p_check_in: checkIn,
        p_check_out: checkOut
      })
    });

    const data = await res.json();

    if (!res.ok) {
      const message = (data && data.message) || '';
      if (message.includes('no_availability')) {
        return json(409, { error: 'no_availability', message: 'Brak wolnych domków w tym terminie' });
      }
      return json(502, { error: 'supabase_error', message });
    }

    return json(201, {
      id: data.id,
      houseId: data.house_id,
      checkIn: data.check_in,
      checkOut: data.check_out,
      depositAmount: data.deposit_amount,
      status: data.status
    });
  } catch (err) {
    return json(502, { error: 'fetch_failed', message: String(err && err.message) });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
