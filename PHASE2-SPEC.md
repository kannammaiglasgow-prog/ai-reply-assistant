# PHASE 2 SPEC — Accounts, Referrals, Pricing & Admin

> This is a major upgrade. The current app (Phase 1) is a **no-login, no-database, localStorage**
> MVP. Phase 2 turns it into a **multi-user app** with Google login, a database, server-side usage
> tracking, a referral reward system, admin-managed pricing, and full admin user management.
>
> Read `HANDOFF.md` first for the existing architecture. Implement Phase 2 in the build order below.
> Do NOT keep usage in localStorage once accounts exist — it must move server-side (localStorage is
> trivially editable and cannot prevent referral fraud).

---

## 0. Architecture decisions (do these first)

- **Database:** add a real DB. Recommended: **SQLite** via `better-sqlite3` for a simple single-file
  DB (zero infra, persists across restarts), OR **Supabase/Postgres** if cloud + hosting is wanted
  (the user already uses Supabase elsewhere). Pricing/settings/users/referrals/audit all live here.
- **Auth:** **Google OAuth (Google Identity Services)**. Server verifies the Google ID token, then
  issues an app session (httpOnly cookie or signed JWT). Every account = one unique Google `sub`.
  No anonymous/guest earning.
- **Server-side usage:** all reply counting, daily reset, referral credits, plan limits move to the
  DB keyed by user id. The browser only displays balances returned by the API.
- **Roles:** `role` on user = `free | premium | lifetime | admin`. Admin pages require `role=admin`.
- **Config-driven:** pricing, limits, referral rules, offers are read from DB settings at request
  time so the admin can change them live (no restart, no code edit).

### Suggested tables
```
users(id, google_sub UNIQUE, email UNIQUE, name, picture, country, role,
      plan_id, status[active|disabled|suspended|deleted], created_at, last_active,
      referred_by(user_id), referral_code UNIQUE, notes, dev_mode(bool))
usage(user_id, date, daily_used, monthly_used, bonus_balance)   -- bonus_balance = referral/topup credits
referrals(id, referrer_id, invited_user_id, status[pending|active|reward_sent|rejected],
          created_at, activated_at, reward_amount)
plans(id, name, monthly_price, daily_limit, monthly_limit, priority, active)
topup_packages(id, name, price, replies, active)
pricing_settings(key, value)   -- free_new_user_replies, daily_free_replies, referral_reward,
                               -- referral_min_actions, daily_reset_basis, referral_enabled,
                               -- max_referral_rewards_per_month, free_plan_enabled ...
offers(id, name, start_date, end_date, reward_multiplier_or_amount, active)
audit_log(id, admin_id, admin_name, action, target_user_id, detail, created_at)
events(user_id, type[login|generate|copy], created_at)  -- for activity + fraud + analytics
```

---

## FEATURE A — Referral Reward System

### Auth & new-user reward
- Sign in with Google only. One unique Google account per user. No guest earning.
- On **first** sign-in: grant **20 free replies** (bonus_balance += 20).
  Toast: `🎉 Welcome! You have received 20 free AI replies.`

### Referral link
- Each user has a unique code → link `https://<host>/invite/<CODE>`.
- When a new user opens an invite link and signs in, store `referred_by` = referrer.

### Referral is "successful" ONLY if ALL are true
1. Invited user signed in with Google.
2. Invited user is a brand-new account.
3. Invited user generated ≥1 AI reply.
4. Invited user copied ≥1 generated reply.
5. Invited user is "active" (completed the above).

When all met → referrer gets **+20 free replies**.
Toast (to referrer): `🎉 Your referral is now active. You earned 20 free AI replies.`
(Drive this off the `events` table: when an invited user has both a `generate` and a `copy` event,
flip the referral `pending → active → reward_sent` and credit the referrer once.)

### Anti-abuse — do NOT reward when
- User only signs up / closes app immediately (no generate+copy).
- Duplicate Google account, self-referral, multiple fake accounts, reused referral.
- Enforce: unique google_sub & email; referrer ≠ invited; one reward per invited user;
  respect `max_referral_rewards_per_month`. Log suspicious attempts (fraud counter).

### Referral dashboard (user-facing)
Show: My Referral Link, Friends Invited, Successful Referrals, Pending Referrals,
Free Replies Earned, Remaining Free Replies.
Referral statuses: **Pending** (signed up, not active), **Active** (all actions done),
**Reward Sent** (credited).

### Daily free usage (server-side now)
- 10 free replies/day, reset at **local midnight** (store user timezone or compute from client date).
- Referral/top-up rewards (`bonus_balance`) are **on top** of the daily 10.
  e.g. Daily 10 + Referral 20 = 30 available today. Spend daily allowance first, then bonus.

---

## FEATURE B — Admin Pricing Management (admin only, live, DB-stored)

- **Free plan:** edit free_new_user_replies, daily_free_replies, referral_reward, daily_reset_time,
  enable/disable free plan.
- **Monthly plans:** CRUD + enable/disable. Fields: name, monthly_price, daily_limit,
  monthly_limit(optional), priority, active. (Examples: Starter £4.99/50, Standard £8.99/100,
  Pro £14.99/250, Unlimited £24.99 fair-usage.)
- **Top-up packages:** CRUD. name, price, replies, active. (50/£0.99, 100/£1.99, 250/£3.99, 500/£6.99.)
- **Referral settings:** reward amount, min actions required, enable/disable program,
  max referral rewards per month.
- **Offers:** limited-time promos (name, start, end, reward amount/multiplier) e.g. "Double Referral Rewards".
- **Analytics:** Total subscribers, Free users, Paid users, Monthly revenue, Today's API usage,
  Today's reply count, Avg cost/user, Avg revenue/user, Profit estimate.
- All changes take effect **immediately** (read settings from DB per request) and **persist**.

---

## FEATURE C — Admin User Management & Testing Controls (admin only)

- **User list** with: Name, Email, Google account, User ID, Country, Join date, Last active,
  Current plan, Account status, Total replies used, Remaining replies. Search by name/email/id.
- **User type** switch (Free / Premium / Lifetime / Admin) — applies immediately.
- **Reply usage:** edit remaining replies manually (0/10/50/100/500/Unlimited).
- **Reset:** Daily / Monthly / Lifetime / Everything.
- **Add replies:** +10/+20/+50/+100/+500/custom. **Remove replies:** deduct manually.
- **Subscription control:** Upgrade, Downgrade, Cancel, Give Lifetime, Restore Free.
- **Referral management:** Approve / Reject / Cancel reward / Add reward / Remove reward.
- **Account status:** Enable / Disable / Suspend / Delete.
- **Testing tools (dev mode):** ignore daily limits, ignore monthly limits, unlimited replies,
  disable API charging (simulation mode — skip the real model call, return placeholder), reset user.
- **User activity:** total logins, generated replies, copied replies, favourite style, favourite
  language, last login, device type. (From `events`.)
- **Internal notes** per user (e.g. "Beta Tester", "VIP", "Testing Account").
- **Audit log:** record every admin action (date, time, admin name, action, target, detail).

### Security
- Only `role=admin` can access B & C (enforce server-side on every admin endpoint, not just UI).
- All changes immediate, no restart. Keep existing `ADMIN_PASSWORD` analytics page or fold it into
  the new role-based admin.

---

## Suggested build order
1. DB layer + schema + settings seeding (migrate current behaviour: daily=10, new-user/referral=20).
2. Google OAuth + sessions; create user on first login; grant new-user replies; capture `referred_by`.
3. Move usage tracking server-side; `/api/generate*` checks & decrements DB balance (daily then bonus);
   keep the existing daily-reset semantics. Remove the localStorage limit logic once this works.
4. Log `events` (login/generate/copy) — copy event fires from the Copy button.
5. Referral engine: codes, invite route, status transitions, reward crediting, anti-abuse.
6. Referral dashboard (user UI).
7. Admin: role gating → Pricing Management (B) → User Management (C) → Audit log.
8. Admin analytics expansion (revenue/cost/profit). Payments (Stripe) is a later phase.

## Don't regress (Phase 1 features to preserve)
10 style engines & prompt rules, Gemini/OpenAI providers + fallback, 30+ languages, image upload &
paste, URL fetch-context, light/dark theme, feedback logging. See HANDOFF.md.
