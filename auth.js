// Auth layer (Phase 2): verify Google ID tokens and issue/verify our own session cookies.
// We sign a compact session token with HMAC-SHA256 (no external JWT dependency) and store it
// in an httpOnly cookie so the browser can't read or tamper with it.
import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

const COOKIE_NAME = 'are_session';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

// IMPORTANT: env is read lazily (like db.js), NOT at module scope. ESM hoists imports, so this
// module is evaluated BEFORE server.js runs dotenv.config() — module-scope process.env reads here
// would always see the pre-dotenv (empty) values and silently disable login for local .env users.

// SESSION_SECRET signs session cookies. If unset we generate a random per-boot secret, which
// means sessions won't survive a server restart — fine for dev, but set it in .env for stability.
let _sessionSecret = null;
function sessionSecret() {
  if (_sessionSecret) return _sessionSecret;
  _sessionSecret = process.env.SESSION_SECRET || '';
  if (!_sessionSecret) {
    _sessionSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[auth] SESSION_SECRET not set — using a random per-boot secret (logins reset on restart).');
  }
  return _sessionSecret;
}

let _googleClient = null;
export function googleAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID);
}
export function getGoogleClientId() {
  return process.env.GOOGLE_CLIENT_ID || '';
}

// Verify a Google Identity Services ID token (the `credential` from the sign-in button).
// Returns the normalised profile, or throws on any verification failure.
export async function verifyGoogleCredential(credential) {
  const clientId = getGoogleClientId();
  if (!clientId) throw new Error('Google login is not configured (GOOGLE_CLIENT_ID missing).');
  if (!_googleClient) _googleClient = new OAuth2Client(clientId);
  const ticket = await _googleClient.verifyIdToken({ idToken: credential, audience: clientId });
  const p = ticket.getPayload();
  if (!p || !p.sub) throw new Error('Invalid Google token.');
  if (p.email_verified === false) throw new Error('Your Google email is not verified.');
  return {
    google_sub: p.sub,
    email: p.email || '',
    name: p.name || '',
    picture: p.picture || '',
  };
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
function sign(data) {
  return crypto.createHmac('sha256', sessionSecret()).update(data).digest('base64url');
}

// Create a signed session token for a user id. Format: base64url(payload).signature
export function createSessionToken(userId) {
  const payload = {
    uid: userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

// Verify a session token; returns the payload or null if missing/tampered/expired.
export function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  // constant-time compare
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload?.uid || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// --- Cookie helpers (Express has no cookie parser by default; we keep it tiny) ---
export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_SECONDS}; SameSite=Lax${secure}`
  );
}
export function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

// Read the current user id from the request's session cookie (or null).
export function getSessionUserId(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  const payload = verifySessionToken(token);
  return payload?.uid || null;
}

// --- Guest usage cookie ---
// Guests (not signed in) get a small number of free generations before login is required.
// We track that count in a signed, non-httpOnly-not-needed cookie so it survives page reloads
// and can't be trivially faked by editing a number in localStorage. It resets each local day.
// This is best-effort abuse-resistance — clearing cookies resets it, but login is the real gate.
const GUEST_COOKIE = 'are_guest';

function utcDay() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// Returns { day, used } for the current guest, resetting to 0 on a new day or bad signature.
export function readGuestUsage(req) {
  const raw = parseCookies(req)[GUEST_COOKIE];
  const today = utcDay();
  if (!raw || !raw.includes('.')) return { day: today, used: 0 };
  const [body, sig] = raw.split('.');
  if (!body || !sig || sign(body) !== sig) return { day: today, used: 0 };
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { day: today, used: 0 };
  }
  if (payload?.day !== today) return { day: today, used: 0 };
  return { day: today, used: Math.max(0, parseInt(payload.used, 10) || 0) };
}

export function setGuestUsage(res, used) {
  const body = b64url(JSON.stringify({ day: utcDay(), used: Math.max(0, used) }));
  const token = `${body}.${sign(body)}`;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  // 2-day Max-Age so it naturally clears; the day check inside handles the reset.
  res.append(
    'Set-Cookie',
    `${GUEST_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${2 * 24 * 60 * 60}; SameSite=Lax${secure}`
  );
}

export { COOKIE_NAME, GUEST_COOKIE };
