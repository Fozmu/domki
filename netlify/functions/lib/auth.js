// Shared session helpers for the admin panel. Not a function itself —
// netlify/functions/lib/ is a plain module directory, only files directly
// inside netlify/functions/ are deployed as endpoints.

const crypto = require('crypto');

const COOKIE_NAME = 'admin_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function signSession(username, secret) {
  const payload = base64url(Buffer.from(JSON.stringify({ u: username, exp: Date.now() + SESSION_TTL_MS })));
  const sig = base64url(crypto.createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

function verifySession(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;

  const expectedSig = base64url(crypto.createHmac('sha256', secret).update(payload).digest());
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const data = JSON.parse(base64urlDecode(payload).toString('utf8'));
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function sessionCookieHeader(token, maxAgeSeconds) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

// Verifies the session cookie on an incoming Lambda-compat event.
// Returns the session payload ({ u, exp }) or null.
function requireSession(event, secret) {
  const cookies = parseCookies(event.headers && (event.headers.cookie || event.headers.Cookie));
  return verifySession(cookies[COOKIE_NAME], secret);
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_MS,
  signSession,
  verifySession,
  parseCookies,
  sessionCookieHeader,
  requireSession
};
