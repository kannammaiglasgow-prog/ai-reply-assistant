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

// Read one setting as an integer (with a numeric fallback).
export async function getSettingInt(key, fallback = 0) {
  const raw = await getSetting(key, null);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

// Read one setting as a boolean ('true'/'1'/'on' → true).
export async function getSettingBool(key, fallback = false) {
  const raw = await getSetting(key, null);
  if (raw == null) return fallback;
  return /^(true|1|on|yes)$/i.test(String(raw).trim());
}

// Upsert a batch of settings (admin Settings page). Values are coerced to text.
export async function updateSettings(patch) {
  init();
  if (!_client) throw new Error('Database is not configured.');
  const rows = Object.entries(patch || {}).map(([key, value]) => ({
    key,
    value: value == null ? '' : String(value),
  }));
  if (rows.length === 0) return {};
  const { error } = await _client.from('pricing_settings').upsert(rows, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  return getSettings();
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

  // Starter tokens are admin-configurable (pricing_settings.starter_tokens), never hardcoded.
  const newUserBonus = await getSettingInt('starter_tokens', 50);
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

  // Ledger entry for the starter grant (best-effort; the live balance is on the user row).
  if (newUserBonus > 0) {
    try {
      await _client.from('token_transactions').insert({
        user_id: created.id,
        delta: newUserBonus,
        reason: 'starter_bonus',
        balance_after: newUserBonus,
      });
    } catch { /* ledger is best-effort */ }
  }

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

// ===== Tokens =====

// Spend tokens for a user, writing a ledger row. Caller must have already checked the balance.
// Read-modify-write (Supabase has no cheap atomic decrement without an RPC) — acceptable for the
// current scale; a Postgres function can replace this later if concurrency becomes an issue.
// Returns the new balance, or null if the user is gone.
export async function spendTokens(userId, amount, reason = 'generation', meta = null) {
  init();
  if (!_client || !userId || amount <= 0) return null;
  const user = await getUserById(userId);
  if (!user) return null;
  const current = user.bonus_balance || 0;
  const next = Math.max(0, current - amount);
  const { data } = await _client
    .from('users')
    .update({ bonus_balance: next, last_active: new Date().toISOString() })
    .eq('id', userId)
    .select('bonus_balance')
    .maybeSingle();
  try {
    await _client.from('token_transactions').insert({
      user_id: userId,
      delta: -(current - next),
      reason,
      balance_after: next,
      meta,
    });
  } catch { /* ledger is best-effort */ }
  return data ? data.bonus_balance : next;
}

// Grant tokens to a user (referral reward, admin grant, purchase). Returns the new balance.
export async function grantTokens(userId, amount, reason = 'admin_grant', meta = null) {
  init();
  if (!_client || !userId || amount <= 0) return null;
  const user = await getUserById(userId);
  if (!user) return null;
  const next = (user.bonus_balance || 0) + amount;
  const { data } = await _client
    .from('users')
    .update({ bonus_balance: next })
    .eq('id', userId)
    .select('bonus_balance')
    .maybeSingle();
  try {
    await _client.from('token_transactions').insert({
      user_id: userId, delta: amount, reason, balance_after: next, meta,
    });
  } catch { /* ledger is best-effort */ }
  return data ? data.bonus_balance : next;
}

// ===== Referral engine (Phase B) =====
// Flow recap: signup captures the invite (referrals row, status 'pending', unique per invited
// user). This engine decides when the referrer actually gets paid, based on the admin setting
// referral_min_action: 'signup' | 'first_generation' | 'paid_membership'.
//
// Anti-fraud properties (per spec):
// - Rewards only fire from server-verified Google sign-ins — link clicks alone create nothing.
// - referrals.invited_user_id is UNIQUE → one referred user can ever reward one referrer, once.
// - status transitions one-way pending → reward_sent; we re-check status='pending' before paying.
// - Self-referral is impossible at capture (the code must belong to an existing, different user)
//   and is double-checked here (referrer_id !== invited_user_id).
// - max_referral_rewards_per_month caps payouts per referrer; a qualified referral past the cap
//   stays 'pending' and pays out on a later trigger once the month rolls over.

async function getPendingReferralByInvitedUser(invitedUserId) {
  init();
  if (!_client || !invitedUserId) return null;
  const { data } = await _client
    .from('referrals')
    .select('*')
    .eq('invited_user_id', invitedUserId)
    .eq('status', 'pending')
    .maybeSingle();
  return data || null;
}

async function countRewardsThisMonth(referrerId) {
  init();
  if (!_client) return 0;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count, error } = await _client
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_id', referrerId)
    .eq('status', 'reward_sent')
    .gte('activated_at', monthStart.toISOString());
  return error ? 0 : count || 0;
}

// Try to pay out the referral reward for an invited user, given what they just did.
// `trigger` is one of 'signup' | 'first_generation' | 'paid_membership'. Safe to call often:
// it exits fast when there is no pending referral. Never throws (called from hot paths).
export async function processReferralReward(invitedUserId, trigger) {
  init();
  if (!_client || !invitedUserId) return null;
  try {
    if (!(await getSettingBool('referral_enabled', true))) return null;

    const minAction = String(await getSetting('referral_min_action', 'signup'));
    // Triggers are ordered: a later action always satisfies an earlier requirement
    // (someone generating has necessarily signed up).
    const ORDER = { signup: 0, first_generation: 1, paid_membership: 2 };
    if (!(trigger in ORDER) || ORDER[trigger] < (ORDER[minAction] ?? 0)) return null;

    const referral = await getPendingReferralByInvitedUser(invitedUserId);
    if (!referral) return null; // no pending referral (or already rewarded) — the common case
    if (referral.referrer_id === referral.invited_user_id) return null; // self-referral guard

    const referrer = await getUserById(referral.referrer_id);
    if (!referrer || (referrer.status && referrer.status !== 'active')) return null;

    const reward = await getSettingInt('referral_reward', 10);
    const cap = await getSettingInt('max_referral_rewards_per_month', 100);
    if (cap > 0 && (await countRewardsThisMonth(referral.referrer_id)) >= cap) {
      return null; // over this month's cap — stays pending, pays on a later trigger next month
    }

    // Mark the row reward_sent FIRST (conditional on it still being pending) so a concurrent
    // duplicate trigger can't double-pay, then grant the tokens.
    const { data: updated } = await _client
      .from('referrals')
      .update({ status: 'reward_sent', reward_amount: reward, activated_at: new Date().toISOString() })
      .eq('id', referral.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (!updated) return null; // someone else got there first

    if (reward > 0) {
      await grantTokens(referral.referrer_id, reward, 'referral_reward', {
        invited_user_id: invitedUserId,
        trigger,
      });
    }
    logEvent(referral.referrer_id, 'referral_reward', { invited_user_id: invitedUserId, reward, trigger });
    return { referrerId: referral.referrer_id, reward };
  } catch (e) {
    console.error('referral engine failed:', e?.message || e);
    return null;
  }
}

// Referral stats for the signed-in user's referral page.
export async function getReferralStats(userId) {
  init();
  if (!_client || !userId) return null;
  const { data, error } = await _client
    .from('referrals')
    .select('status, reward_amount')
    .eq('referrer_id', userId);
  if (error) return { invited: 0, pending: 0, rewarded: 0, tokensEarned: 0 };
  const rows = data || [];
  const rewarded = rows.filter((r) => r.status === 'reward_sent');
  return {
    invited: rows.length,
    pending: rows.filter((r) => r.status === 'pending').length,
    rewarded: rewarded.length,
    tokensEarned: rewarded.reduce((s, r) => s + (r.reward_amount || 0), 0),
  };
}

// ===== Membership plans (Phase C) =====

// Active plans for the public membership page, cheapest first.
export async function getActivePlans() {
  init();
  if (!_client) return [];
  const { data, error } = await _client
    .from('plans')
    .select('id,name,monthly_price,monthly_limit,priority,active')
    .eq('active', true)
    .order('priority', { ascending: true });
  return error ? [] : data || [];
}

// All plans (admin editor), including inactive ones.
export async function getAllPlans() {
  init();
  if (!_client) return [];
  const { data, error } = await _client
    .from('plans')
    .select('id,name,monthly_price,monthly_limit,priority,active,created_at')
    .order('priority', { ascending: true });
  return error ? [] : data || [];
}

export async function getPlanById(id) {
  init();
  if (!_client || !id) return null;
  const { data } = await _client.from('plans').select('*').eq('id', id).maybeSingle();
  return data || null;
}

// Create (no id) or update (with id) one plan. Fields are validated by the caller.
export async function upsertPlan({ id, name, monthly_price, monthly_limit, priority, active }) {
  init();
  if (!_client) throw new Error('Database is not configured.');
  const row = { name, monthly_price, monthly_limit, priority, active };
  if (id) {
    const { data, error } = await _client.from('plans').update(row).eq('id', id).select('*').maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }
  const { data, error } = await _client.from('plans').insert(row).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

// ===== Subscriptions (Phase C — the seam Stripe's webhook will call on payment success) =====
// Records the subscription, points users.plan_id at the plan, and grants the plan's monthly
// token allowance up-front (tokens are the single spending currency; renewals re-grant).
export async function activateSubscription({ userId, planId, stripeCustomerId = null, stripeSubscriptionId = null }) {
  init();
  if (!_client) throw new Error('Database is not configured.');
  const plan = await getPlanById(planId);
  if (!plan || !plan.active) throw new Error('Plan not found or inactive.');

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const { data: sub, error } = await _client
    .from('subscriptions')
    .insert({
      user_id: userId,
      plan_id: planId,
      status: 'active',
      monthly_token_grant: plan.monthly_limit,
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscriptionId,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);

  await _client.from('users').update({ plan_id: planId, role: 'premium' }).eq('id', userId);
  if (plan.monthly_limit > 0) {
    await grantTokens(userId, plan.monthly_limit, 'purchase', { plan_id: planId, subscription_id: sub.id });
  }
  logEvent(userId, 'subscribe', { plan_id: planId, plan: plan.name });
  return sub;
}

// The user's latest subscription row (for dashboard payment status), or null.
export async function getLatestSubscription(userId) {
  init();
  if (!_client || !userId) return null;
  const { data } = await _client
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

// Recent usage rows for the dashboard's history list.
export async function getUserUsageHistory(userId, limit = 10) {
  init();
  if (!_client || !userId) return [];
  const { data, error } = await _client
    .from('usage_logs')
    .select('action,tokens_spent,replies,language,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return error ? [] : data || [];
}

// Append a usage-log row (one per successful generation). Best-effort; never throws.
export async function logUsage({ userId = null, guest = false, action = 'generate', tokensSpent = 0, replies = 0, language = null, meta = null }) {
  init();
  if (!_client) return;
  try {
    await _client.from('usage_logs').insert({
      user_id: userId, guest, action, tokens_spent: tokensSpent, replies, language, meta,
    });
  } catch { /* usage logging is best-effort */ }
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
