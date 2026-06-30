// Supabase database layer (Phase 2). The server uses the SERVICE ROLE key (server-side only).
// Lazy init: env is read on first use, AFTER dotenv has loaded in server.js.
import { createClient } from '@supabase/supabase-js';

let _client = null;
let _initialized = false;

function init() {
  if (_initialized) return;
  _initialized = true;
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  _client =
    url && key
      ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;
}

export function dbEnabled() {
  init();
  return Boolean(_client);
}

export function getClient() {
  init();
  return _client;
}

// Lightweight connectivity + schema check (startup log and /api/admin/db-check).
export async function checkDb() {
  init();
  if (!_client) {
    return { ok: false, reason: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in .env' };
  }
  try {
    const { error } = await _client.from('pricing_settings').select('key').limit(1);
    if (error) {
      if (/relation .* does not exist|could not find the table/i.test(error.message)) {
        return {
          ok: false,
          reason: 'Connected, but tables are missing. Run supabase/schema.sql in the Supabase SQL editor.',
        };
      }
      return { ok: false, reason: error.message };
    }
    return { ok: true, reason: 'connected' };
  } catch (e) {
    return { ok: false, reason: e?.message || 'connection failed' };
  }
}

// Read all pricing/system settings as a plain object (used live by the app/admin).
export async function getSettings() {
  init();
  if (!_client) return {};
  const { data, error } = await _client.from('pricing_settings').select('key,value');
  if (error) return {};
  return Object.fromEntries(data.map((r) => [r.key, r.value]));
}

// Read one setting with a fallback. Values are stored as text.
export async function getSetting(key, fallback = null) {
  init();
  if (!_client) return fallback;
  const { data, error } = await _client
    .from('pricing_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error || !data) return fallback;
  return data.value;
}

// ===== Users =====

export async function getUserByGoogleSub(sub) {
  init();
  if (!_client) return null;
  const { data } = await _client.from('users').select('*').eq('google_sub', sub).maybeSingle();
  return data || null;
}

export async function getUserById(id) {
  init();
  if (!_client || !id) return null;
  const { data } = await _client.from('users').select('*').eq('id', id).maybeSingle();
  return data || null;
}

export async function getUserByReferralCode(code) {
  init();
  if (!_client || !code) return null;
  const { data } = await _client
    .from('users')
    .select('*')
    .eq('referral_code', code)
    .maybeSingle();
  return data || null;
}

// Generate a short, human-friendly invite code that isn't already taken.
async function generateUniqueReferralCode() {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusable chars (0/O, 1/I)
  for (let attempt = 0; attempt < 6; attempt++) {
    let code = '';
    for (let i = 0; i < 7; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    const existing = await getUserByReferralCode(code);
    if (!existing) return code;
  }
  // Extremely unlikely fallback: timestamp-based
  return 'R' + Date.now().toString(36).toUpperCase();
}

// Find-or-create a user on Google sign-in.
// On first sign-in: grants the new-user reply bonus, assigns a referral code, and — if they
// arrived via a valid invite code — links referred_by and opens a pending referral row.
// Returns { user, isNew }.
export async function loginOrCreateUser({ google_sub, email, name, picture, refCode }) {
  init();
  if (!_client) throw new Error('Database is not configured.');

  const existing = await getUserByGoogleSub(google_sub);
  if (existing) {
    // Returning user: refresh profile fields + last_active.
    const patch = { last_active: new Date().toISOString() };
    if (name && name !== existing.name) patch.name = name;
    if (picture && picture !== existing.picture) patch.picture = picture;
    if (email && email !== existing.email) patch.email = email;
    const { data } = await _client
      .from('users')
      .update(patch)
      .eq('id', existing.id)
      .select('*')
      .maybeSingle();
    return { user: data || existing, isNew: false };
  }

  // New user. Resolve the referrer (if any) before insert.
  let referrer = null;
  if (refCode) {
    const r = await getUserByReferralCode(String(refCode).trim().toUpperCase());
    // No self-referral possible here (the code belongs to an existing different user).
    if (r) referrer = r;
  }

  const newUserBonus = parseInt(await getSetting('free_new_user_replies', '20'), 10) || 0;
  const referralCode = await generateUniqueReferralCode();

  const { data: created, error } = await _client
    .from('users')
    .insert({
      google_sub,
      email,
      name: name || null,
      picture: picture || null,
      referral_code: referralCode,
      referred_by: referrer ? referrer.id : null,
      bonus_balance: newUserBonus,
      last_active: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);

  // Open a pending referral row so the engine (later step) can activate it on generate+copy.
  if (referrer) {
    await _client.from('referrals').insert({
      referrer_id: referrer.id,
      invited_user_id: created.id,
      status: 'pending',
    });
  }

  return { user: created, isNew: true };
}

// Append an activity event (login | generate | copy). Best-effort; never throws.
export async function logEvent(userId, type, meta = null) {
  init();
  if (!_client || !userId) return;
  try {
    await _client.from('events').insert({ user_id: userId, type, meta });
  } catch {
    /* analytics is best-effort */
  }
}
