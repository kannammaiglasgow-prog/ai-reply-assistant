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
alter table public.referrals        enable row level security;
alter table public.events           enable row level security;
alter table public.plans            enable row level security;
alter table public.topup_packages   enable row level security;
alter table public.offers           enable row level security;
alter table public.pricing_settings enable row level security;
alter table public.audit_log        enable row level security;

-- ---------- Seed default settings (matches the current Phase-1 behaviour) ----------
insert into public.pricing_settings (key, value) values
  ('free_new_user_replies', '20'),
  ('daily_free_replies', '10'),
  ('referral_reward', '20'),
  ('referral_min_actions', 'generate+copy'),
  ('referral_enabled', 'true'),
  ('max_referral_rewards_per_month', '100'),
  ('free_plan_enabled', 'true')
on conflict (key) do nothing;

-- ---------- Seed default monthly plans ----------
insert into public.plans (name, monthly_price, daily_limit, priority, active) values
  ('Starter',   4.99,  50, 1, true),
  ('Standard',  8.99, 100, 2, true),
  ('Pro',      14.99, 250, 3, true),
  ('Unlimited',24.99, null,4, true)
on conflict do nothing;

-- ---------- Seed default top-up packages ----------
insert into public.topup_packages (name, price, replies, active) values
  ('50 Replies',  0.99,  50, true),
  ('100 Replies', 1.99, 100, true),
  ('250 Replies', 3.99, 250, true),
  ('500 Replies', 6.99, 500, true)
on conflict do nothing;
