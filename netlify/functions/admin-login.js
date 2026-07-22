// Checks the admin username/password against env vars and issues a signed
// session cookie. Password is stored as a scrypt hash (never plaintext) —
// see .env.example for how to generate ADMIN_PASSWORD_HASH.
// Env vars required: ADMIN_USERNAME, ADMIN_PASSWORD_HASH, ADMIN_SESSION_SECRET

const crypto = require('crypto');
const { signSession, sessionCookieHeader, SESSION_TTL_MS } = require('./lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  const adminUsername = process.env.ADMIN_USERNAME;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH; // format: "salt:hexHash"
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;

  if (!adminUsername || !passwordHash || !sessionSecret) {
    return json(500, { error: 'missing_config', message: 'admin auth env vars not set' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const username = String(body.username || '');
  const password = String(body.password || '');

  const usernameOk = safeEqual(username, adminUsername);
  const passwordOk = checkPassword(password, passwordHash);

  if (!usernameOk || !passwordOk) {
    return json(401, { error: 'invalid_credentials' });
  }

  const token = signSession(adminUsername, sessionSecret);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookieHeader(token, SESSION_TTL_MS / 1000)
    },
    body: JSON.stringify({ ok: true })
  };
};

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Still hash-compare to keep timing roughly constant, then reject.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function checkPassword(password, storedHash) {
  const [salt, hashHex] = String(storedHash).split(':');
  if (!salt || !hashHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hashHex, 'hex');
  if (derived.length !== stored.length) return false;
  return crypto.timingSafeEqual(derived, stored);
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
