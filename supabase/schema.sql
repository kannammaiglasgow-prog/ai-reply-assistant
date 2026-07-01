-- ============================================================================
-- AI Reply Assistant — Phase 2 schema (Supabase / Postgres)
-- Run this in your Supabase project: SQL Editor → New query → paste → Run.
-- The Express server connects with the SERVICE ROLE key, which bypasses RLS.
-- ============================================================================

-- ---------- Users ----------
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  google_sub    text unique not null,         -- Google account id (one account per user)
  email         text unique not null,
  name          text,
  picture       text,
  country       text,
  role          text not null default 'free', -- free | premium | lifetime | admin
  plan_id       uuid,                          -- references plans.id (monthly plan), null = free
  status        text not null default 'active',-- active | disabled | suspended | deleted
  referral_code text unique,                   -- this user's own invite code
  referred_by   uuid references public.users(id),
  bonus_balance int not null default 0,        -- referral + top-up credits (on top of daily free)
  dev_mode      boolean not null default false,-- testing: ignore limits / simulate
  notes         text,
  created_at    timestamptz not null default now(),
  last_active   timestamptz
);
create index if not exists users_referred_by_idx on public.users (referred_by);

-- ---------- Daily / monthly usage ----------
create table if not exists public.daily_usage (
  user_id uuid not null references public.users(id) on delete cascade,
  day     date not null,                       -- user's local date (YYYY-MM-DD)
  used    int  not null default 0,
  primary key (user_id, day)
);
create table if not exists public.monthly_usage (
  user_id uuid not null references public.users(id) on delete cascade,
  period  text not null,                       -- 'YYYY-MM'
  used    int  not null default 0,
  primary key (user_id, period)
);

-- ---------- Referrals ----------
create table if not exists public.referrals (
  id              uuid primary key default gen_random_uuid(),
  referrer_id     uuid not null references public.users(id) on delete cascade,
  invited_user_id uuid unique references public.users(id) on delete cascade,
  status          text not null default 'pending', -- pending | active | reward_sent | rejected
  reward_amount   int not null default 0,
  created_at      timestamptz not null default now(),
  activated_at    timestamptz
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id);

-- ---------- Activity events (login / generate / copy) ----------
create table if not exists public.events (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.users(id) on delete cascade,
  type       text not null,                    -- login | generate | copy
  meta       jsonb,                            -- e.g. {style, language, count, device}
  created_at timestamptz not null default now()
);
create index if not exists events_user_type_idx on public.events (user_id, type);

-- ---------- Token ledger (every credit/debit to a user's token balance) ----------
-- The live balance is users.bonus_balance; this table is the auditable history behind it.
create table if not exists public.token_transactions (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.users(id) on delete cascade,
  delta         int  not null,                 -- negative = spent, positive = granted
  reason        text not null,                 -- generation | starter_bonus | referral_reward | admin_grant | purchase
  balance_after int,
  meta          jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists token_tx_user_idx on public.token_transactions (user_id, created_at);

-- ---------- Usage logs (one row per generation attempt that produced replies) ----------
create table if not exists public.usage_logs (
  id            bigint generated always as identity primary key,
  user_id       uuid references public.users(id) on delete set null, -- null = guest
  guest         boolean not null default false,
  action        text not null default 'generate', -- generate | regenerate
  tokens_spent  int  not null default 0,
  replies       int  not null default 0,
  language      text,
  meta          jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists usage_logs_user_idx on public.usage_logs (user_id, created_at);

-- ---------- Plans ----------
create table if not exists public.plans (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  monthly_price numeric(10,2) not null default 0,
  daily_limit   int,
  monthly_limit int,                            -- optional
  priority      int not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------- Top-up packages ----------
create table if not exists public.topup_packages (
  id      uuid primary key default gen_random_uuid(),
  name    text not null,
  price   numeric(10,2) not null,
  replies int not null,
  active  boolean not null default true
);

-- ---------- Subscriptions (membership — wired to Stripe in the payment phase) ----------
create table if not exists public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.users(id) on delete cascade,
  plan_id                uuid references public.plans(id),
  status                 text not null default 'active', -- active | expired | cancelled | failed | past_due
  monthly_token_grant    int,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  stripe_customer_id     text,
  stripe_subscription_id text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions (user_id);

-- ---------- Offers (limited-time promos) ----------
create table if not exists public.offers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  start_date  timestamptz,
  end_date    timestamptz,
  reward      numeric(10,2),                    -- amount or multiplier (admin's choice)
  active      boolean not null default true
);

-- ---------- Pricing / system settings (key-value, editable live by admin) ----------
create table if not exists public.pricing_settings (
  key   text primary key,
  value text
);

-- ---------- Admin audit log ----------
create table if not exists public.audit_log (
  id             bigint generated always as identity primary key,
  admin_id       uuid references public.users(id),
  admin_name     text,
  action         text not null,
  target_user_id uuid,
  detail         text,
  created_at     timestamptz not null default now()
);

-- ---------- RLS: lock everything; server uses the service-role key (bypasses RLS) ----------
alter table public.users            enable row level security;
alter table public.daily_usage      enable row level security;
alter table public.monthly_usage    enable row level security;
alter table public.referrals          enable row level security;
alter table public.events             enable row level security;
alter table public.token_transactions enable row level security;
alter table public.usage_logs         enable row level security;
alter table public.plans              enable row level security;
alter table public.topup_packages     enable row level security;
alter table public.subscriptions      enable row level security;
alter table public.offers             enable row level security;
alter table public.pricing_settings   enable row level security;
alter table public.audit_log          enable row level security;

-- ---------- Seed default settings (all admin-configurable from /admin.html → Settings) ----------
-- Every user-facing number lives here, NOT hardcoded in the app. Change them live in the
-- admin Settings panel; the server reads these on every request.
insert into public.pricing_settings (key, value) values
  -- Guest (pre-login) trial
  ('guest_free_generations',      '1'),      -- free replies a guest gets before login is required
  ('guest_trial_enabled',         'true'),   -- master on/off for the guest free trial
  -- Tokens
  ('starter_tokens',              '50'),     -- tokens granted on first Google login
  ('token_cost_per_generation',   '1'),      -- tokens spent per reply generated
  -- Referral
  ('referral_reward',             '10'),     -- tokens the referrer earns per successful referral
  ('referral_enabled',            'true'),
  ('referral_min_action',         'signup'), -- signup | first_generation | paid_membership
  ('max_referral_rewards_per_month','100'),
  -- Membership
  ('membership_enabled',          'true'),
  -- Default account statuses (per-user overrides live on users.status)
  ('free_user_default_status',    'active'), -- active | blocked
  ('paid_user_default_status',    'active'), -- active | expired | cancelled
  -- Legacy Phase-1 keys (kept so older code paths still resolve)
  ('free_new_user_replies',       '50'),
  ('daily_free_replies',          '1000')
on conflict (key) do nothing;

-- ---------- Seed default membership plans (Free / Basic / Pro / Business) ----------
-- Prices and limits are admin-editable in the membership phase; Stripe wiring comes later.
insert into public.plans (name, monthly_price, monthly_limit, priority, active) values
  ('Free',      0.00,   50, 0, true),
  ('Basic',     4.99,  500, 1, true),
  ('Pro',       9.99, 1500, 2, true),
  ('Business', 24.99, 5000, 3, true)
on conflict do nothing;

-- ---------- Seed default top-up packages ----------
insert into public.topup_packages (name, price, replies, active) values
  ('50 Tokens',  0.99,  50, true),
  ('100 Tokens', 1.99, 100, true),
  ('250 Tokens', 3.99, 250, true),
  ('500 Tokens', 6.99, 500, true)
on conflict do nothing;
