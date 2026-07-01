# HANDOFF — AI Reply Assistant (for the next AI/dev to continue)

Read this file fully before changing anything, then continue the pending tasks at the bottom.

## What this app is
A personal MVP web app. User pastes a message / URL / image and gets AI-generated reply
suggestions, tuned by **perspective**, **reply style**, **language**, and **count**.
Heavily used for **Tamil** social-media replies (also English, Tanglish + 30+ languages).

## Stack
- **Backend:** Node.js + Express (ESM), single file `server.js`.
- **Frontend:** plain HTML/CSS/JS in `public/` (no framework, no build step).
- **AI providers:** Gemini (currently active), OpenAI, MiniMax, OpenRouter — switchable via
  `PROVIDER`. No database for usage/feedback — JSONL files + browser localStorage (Phase 2
  Supabase exists for accounts only, see below).
- Run: `npm install` then `npm start` → http://localhost:3000  (dev: `npm run dev`).
- **Live deployment:** https://ai-reply-assistant-i4mt.onrender.com/ (Render, free tier — see
  "Deployment" section below before touching hosting).

## Files
```
ai-response-engine/
├── server.js            # all backend logic + endpoints
├── db.js                # lazy Supabase client (Phase 2 accounts)
├── auth.js              # Google ID-token verify + signed session cookies (Phase 2)
├── package.json
├── vercel.json           # NOT currently working — see Deployment section
├── render.yaml           # Blueprint config (unused — live site was made as a manual Web Service)
├── .env                 # SECRETS (gitignored) — real keys live here
├── .env.example         # documents every env var
├── public/
│   ├── index.html       # main single-page UI
│   ├── style.css        # light/dark theme (CSS vars) + lang-picker + RTL styling
│   ├── app.js           # all frontend logic
│   ├── i18n.js           # UI-language engine (118 selectable, 10 with real translations)
│   ├── i18n/             # languages.json, output-languages.json, <code>.json per UI language
│   ├── lang-picker.js    # reusable searchable language dropdown (UI + output language)
│   ├── admin.html       # password-gated analytics page
│   └── admin.js
├── data/                # runtime logs (gitignored)
│   ├── feedback.jsonl   # 👍/👎/copy/save events
│   └── generations.jsonl# one line per generation (for analytics)
├── supabase/schema.sql   # Phase 2 DB schema (accounts/referrals/pricing — not yet wired to feedback/generations logging)
├── README.md  DESIGN.md  UI-BRIEF.md  PHASE2-SPEC.md  DEPLOY.md  WORK-LOG.md  HANDOFF.md
```

## Environment (.env)
```
PROVIDER=gemini                 # "gemini" | "openai" | "minimax" | "openrouter"
GEMINI_API_KEY=AQ.********       # PAID tier enabled on the Google project
GEMINI_MODEL=gemini-3.5-flash    # has auto-fallback list in server.js (GEMINI_FALLBACKS)
OPENAI_API_KEY=sk-...            # placeholder, not currently used (PROVIDER=gemini is active)
OPENAI_MODEL=gpt-5.5
MINIMAX_API_KEY=...              # works, but account has insufficient balance as of this write-up
MINIMAX_MODEL=MiniMax-Text-01
MINIMAX_BASE_URL=https://api.minimax.io/v1
OPENROUTER_API_KEY=sk-or-v1-...  # verified working (routes to minimax/minimax-01) — use this to
OPENROUTER_MODEL=minimax/minimax-01  # switch to MiniMax without needing direct MiniMax balance
ADMIN_PASSWORD=admin123          # CHANGE THIS — admin analytics login (same value is live on Render!)
YOUTUBE_API_KEY=                 # optional; empty = YouTube falls back to oEmbed (title+channel only)
PORT=3000                        # do NOT upload this one to Render — it assigns its own PORT
```
Note: dotenv is loaded with `{ override: true }` so .env always wins over stale system env vars.
The Gemini key starts with `AQ.` and works on the paid tier (free tier daily caps are tiny).
`gemini-3.5-flash` is real and working (confirmed live) despite not matching this assistant's
training-time knowledge of Gemini's naming — trust what's observed over prior knowledge here.

## Backend endpoints (server.js)
- `POST /api/generate` and `POST /api/generate-replies` (same handler) — body:
  `{ message?, image?(dataURL), perspective, styles[], language, count }` → `{ replies:[{style,perspective,text}] }`
- `POST /api/regenerate` — regenerate one reply for one style.
- `POST /api/fetch-context` — `{ url }` → public metadata. YouTube via Data API v3 (or oEmbed
  fallback). Instagram/others return `{ needsManual:true, message }`. NEVER downloads/transcribes video.
- `POST /api/feedback` — logs 👍/👎/copy/save to data/feedback.jsonl.
- `GET  /api/feedback/summary` — aggregates.
- `POST /api/admin/login` and `GET /api/admin/analytics` (header `x-admin-password`) — admin dashboard data.

## Key behaviours already built (do not regress)
- **Providers:** `generateJson(systemText,userText,temperature,image)` routes to Gemini (REST,
  `responseMimeType: application/json`), or one of three OpenAI-compatible gateways via the shared
  `callOpenAiCompatible()` helper — **OpenAI**, **MiniMax** (`https://api.minimax.io/v1`), or
  **OpenRouter** (`https://openrouter.ai/api/v1`, one key routes to many models incl. MiniMax).
  Gemini has **auto model fallback** on 429 (quota) via `GEMINI_FALLBACKS`, and one transient-503
  retry. `PROVIDER` env var picks one of `gemini | openai | minimax | openrouter`. The OpenAI-
  compatible path retries without `response_format`/`temperature` if a model rejects them, caps
  `max_tokens` at 4000 (some gateways price against the model's full default otherwise), and
  normalises gateways that return HTTP 200 with an `{ error: {...} }` body (seen on OpenRouter)
  into a real thrown error so the fallback logic engages. `tryParseJson()` also tolerates replies
  wrapped in a ```json fence (seen with MiniMax when it doesn't honour `response_format`).
  Malformed-JSON gets one retry.
- **Prompt engine:** `buildSystemPrompt()` + `buildUserPrompt()` + `STYLE_HINTS`. `buildUserPrompt()`
  opens with an explicit `User Question / Selected Reply Style / Selected Output Language /
  Instruction` summary block (on request), layered ON TOP OF — not replacing — the detailed
  style/language/perspective engineering below it. **20** distinct
  style "engines" (replaced the original 10 on request): Friend, Casual Chat, Angry, Comedy,
  Sarcastic, Savage, Troll, Respectful, Professional, Romantic, Cute, Emotional, Motivational,
  Mass Hero, Cinema Dialogue, Villain, Mystery, Punch Dialogue, SMS Short, AI Robot — each with its
  own personality in `STYLE_HINTS` (server.js), matching checkboxes+emoji in index.html, and a
  badge colour class in `STYLE_CLASS` (app.js) / style.css. The edgier styles (Angry, Sarcastic,
  Savage, Troll, Villain, Punch Dialogue) are explicitly allowed to be sharp in the system prompt,
  but the Hard Rules section still bans slurs/hate/threats/defamation/harassment for all of them.
  Strong rules: respond directly to the message, natural Tamil with ONLY real correctly-spelled
  words (no invented/garbled words), originality & safety (NEVER imitate real people/celebrities/
  copyrighted dialogue), vary every reply.
- **Two fully independent 100+-language systems** (do not conflate them):
  1. **Reply OUTPUT language** (what the AI writes) — `server.js` `LANGUAGES` array, **119 entries**,
     kept in sync with `public/i18n/output-languages.json` (verified 1:1 by name at build time — see
     `node -e` diff in HANDOFF history if it ever needs re-checking). `languageInstruction()` special-
     cases Tamil/English/Tanglish for extra-strict quality and falls back to a strong generic
     instruction for every other language, so any of the 119 (or any future addition) works without
     more code. Picked via the **searchable Output Language picker** (Step 2), persisted in
     `localStorage['are.outputLang']` (default `'Tamil'`), independent of the UI language below.
  2. **UI (interface) language** — `public/i18n/languages.json`, **118 entries** (code, name,
     nativeName, flag, `popular`, optional `dir:"rtl"`). Each language CAN have a
     `public/i18n/<code>.json` dictionary; **10 have full hand-written translations today** (en, ta,
     hi, te, ml, si, zh, ar, fr, es) — the other ~108 are already selectable/searchable and fully
     functional, just rendering in English until a dictionary file is added (see fallback below).
     Picked via the **searchable UI Language picker** (top bar), persisted in
     `localStorage['are.uiLang']`.
  - **`public/lang-picker.js`** — one reusable vanilla-JS searchable dropdown (`window.
    createLangPicker(container, opts)`), instantiated twice (UI + output) with different data/
    valueKey/storage. Search matches name/nativeName/code (prefix match ranks above substring
    match); "Popular" section shown first when the search box is empty, then the full A–Z list;
    each row shows flag + native name (`dir="auto"`, so RTL scripts render correctly even inside an
    LTR list) + English name. `setValue()` syncs it programmatically (e.g. auto-detected language
    from URL fetch); `setLabels()` re-translates the picker's own chrome live.
  - **`public/i18n.js`** — the UI-language engine. Loads `languages.json` + the saved/default
    dictionary, applies `data-i18n` / `data-i18n-placeholder` / `data-i18n-title` / `data-i18n-label`
    / `data-i18n-count` attributes in index.html, sets `<html lang>`/`dir` (`rtl` for Arabic, Urdu,
    Hebrew, Persian, Pashto, Kurdish, Sindhi, Kashmiri, Yiddish), exposes `window.i18n.t(key, vars)`
    + `i18n.onChange(cb)` + `i18n.ready` (a promise app.js awaits before building the UI picker).
    **Fallback is real, not cosmetic:** `loadDict()` never throws — a 404 for a language with no
    file yet resolves to `{}`, and `t()` already does `currentDict[key] ?? enDict[key] ?? key`, so
    every key silently reads as English. The language is still selected/persisted/applied (lang/dir
    attributes) even with zero real strings — the moment a `<code>.json` is added later, the exact
    same selection starts rendering real text with no other code changes.
  - app.js uses `i18n.t()` for every dynamically-generated string (toasts, status/error messages,
    card action labels, results title, style/perspective badge labels via `STYLE_I18N_KEY`/
    `PERSP_I18N_KEY`) and re-renders those + both pickers' chrome on `i18n.onChange`.
  - **Adding a new UI language with real text: zero code changes** — add one entry to
    `languages.json` and a matching `<code>.json` (same key shape as `en.json`). **Adding a new
    output language: zero code changes to the picker/UI** — add one entry to
    `output-languages.json` and the matching name to `server.js`'s `LANGUAGES` array (keep them in
    sync; `languageInstruction()` needs no change unless you want a hand-tuned instruction for it).
  - Scope note: a handful of secondary URL-context-preview strings (view/like counts, "Top
    comments") are intentionally left English-only; everything else (nav, buttons, labels,
    placeholders, all 20 style names, perspective names, errors, toasts, loading/result headings,
    footer, both language pickers' own chrome) is translated for the 10 languages with real files.
  - Verified in-browser end-to-end: 118-language searchable UI list renders/searches correctly
    (accessibility-tree checked), Swahili (no `sw.json` yet) selects + persists + falls back to
    English cleanly, Arabic UI still switches to `dir="rtl"`, and a real `/api/generate-replies`
    call with Output Language = Icelandic (previously unavailable) returned genuine Icelandic text —
    confirming the full 100+ output-language pipeline works, not just the picker UI.
- **Image (vision):** image attached as base64; sent inline to the model. Frontend resizes before upload.
- **Image paste:** Ctrl+V an image anywhere → auto-attaches (document `paste` listener in app.js).
- **URL context:** "Fetch Context" → preview card → fills the message box.
- **Daily free limit:** `FREE_LIMIT = 1000` (raised from 10 on request) free replies/day, counted
  by **replies generated** (not requests), stored in localStorage (`are.usage` = {date, used}),
  resets at local midnight. Same constant duplicated in `public/app.js` and `public/admin.js` —
  keep them in sync if changed again. Counter shown near Generate; over-limit shows a warning and
  does NOT call the API; at 0 the button disables + Top Up placeholder ("Top-up feature coming
  soon."). Count options: 1/3/5/10/20 (default 1).
- **UI order:** Paste Message/URL → Output Language → Number of Replies → Perspective → Reply Styles
  → Generate. Reply styles start **deselected**; must pick ≥1 or it asks. Inputs (message/URL/image)
  clear after a successful generate; selections persist.
- **Admin analytics:** /admin.html, login with ADMIN_PASSWORD; shows totals, feedback-by-style with
  satisfaction %, generations by language/day, recent feedback.
- **Theme:** light/dark toggle, saved in localStorage (`are.theme`). Fonts: Inter + Noto Sans Tamil.

## Verification habit
There is no automated test suite. Verify by running the server and exercising the real endpoints
(curl) and the browser UI. Tamil sent via shell/curl can get mangled (encoding) — test Tamil via the
browser, not curl. Each generation costs a real API call.

## BIG next phase — see `PHASE2-SPEC.md`
The user has requested a **Phase 2**: Google login + database + server-side usage, a **referral
reward system**, **admin pricing management**, and **admin user management**. This is a major
architecture change (the current app has no DB and no login). Full requirements, recommended
architecture, data model, and build order are in **`PHASE2-SPEC.md`** — start there for that work.

### Phase 2 progress
- **Step 1 — DB layer (DONE).** Chose **Supabase/Postgres**. `db.js` = lazy Supabase client
  (SERVICE ROLE key, server-only) + `dbEnabled()`, `checkDb()`, `getSettings()`, `getSetting()`.
  `supabase/schema.sql` = full schema + seeded settings/plans/top-ups (run it in the Supabase SQL
  editor). Admin probe: `GET /api/admin/db-check`. Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Step 2 — Google OAuth + sessions (DONE).** Uses **Google Identity Services** (frontend button)
  + `google-auth-library` (server verifies the ID token). `auth.js` = token verify + HMAC-signed
  httpOnly session cookie (`are_session`, no JWT dep) + tiny cookie parser. `db.js` gained
  `loginOrCreateUser()` (first sign-in grants `free_new_user_replies` bonus, assigns a unique
  `referral_code`, links `referred_by` from an invite code, opens a `pending` referral row),
  `getUserBy*`, `logEvent()`. Endpoints: `GET /api/config` (tells client if auth is on + the client
  id), `POST /api/auth/google`, `GET /api/auth/me`, `POST /api/auth/logout`, `GET /invite/:code`
  (→ `/?ref=CODE`). Frontend: GIS button + user chip + sign-out in the topbar; `initAuth()` in
  app.js restores the session, captures `?ref`, and shows a welcome toast on first sign-in.
  Env: `GOOGLE_CLIENT_ID`, `SESSION_SECRET`. **Everything degrades gracefully** — with no
  GOOGLE_CLIENT_ID/DB the login UI hides and the app runs exactly like Phase 1 (localStorage usage).
  **NOT YET TESTED end-to-end** — needs the user to add real Supabase creds + a Google OAuth Web
  Client ID and run `supabase/schema.sql`. Then verify sign-in creates a user row with +20 bonus.
- **Step 3 — server-side usage / TOKEN SYSTEM (DONE, 2026-07-01 session — "Phase A").** The user
  supplied a full spec (login gate + tokens + referral + membership + admin control). Phase A
  (core) is built; referral engine / membership+Stripe / user dashboard are the next phases.
  What exists now:
  - **Guest flow:** a guest gets N free generations (default 1, admin key `guest_free_generations`),
    tracked server-side in a signed `are_guest` cookie (auth.js `readGuestUsage`/`setGuestUsage`,
    resets per UTC day). When exhausted → 401 `{ needsLogin:true, error:"Please login with Google
    to continue." }` → frontend opens a **login modal** (`#loginModal` in index.html) with a GIS
    button. Verified end-to-end in the browser with fake creds (real Gemini reply on try 1, modal
    on try 2 — screenshot in session log).
  - **Token system:** first Google login grants `starter_tokens` (default 50, admin-configurable —
    NOT hardcoded; `loginOrCreateUser` reads it). Every generation costs
    `token_cost_per_generation` (default 1) × replies, deducted **server-side AFTER success**
    (`resolveGate()` + `gate.commit()` in server.js — check before the AI call, charge after).
    Balance lives on `users.bonus_balance`, audited in the new `token_transactions` ledger table;
    per-generation rows go to the new `usage_logs` table. Out of tokens → 402
    `{ needsTokens:true }` → frontend opens an **upgrade modal** (`#upgradeModal`, checkout TBD).
    Balance shown in a topbar badge (`#tokenBadge`) + usage counter line; `/api/generate*`
    responses include `tokenBalance` / `guestRemaining` so the UI stays in sync.
  - **Admin Settings page:** `/admin.html` now has a ⚙️ Settings panel (first panel) editing 11
    keys via `GET/PUT /api/admin/settings` (password-protected, `SETTINGS_SCHEMA` server-side
    validation): guest_free_generations, guest_trial_enabled, starter_tokens,
    token_cost_per_generation, referral_reward, referral_enabled, referral_min_action
    (signup|first_generation|paid_membership), max_referral_rewards_per_month,
    membership_enabled, free_user_default_status, paid_user_default_status.
  - **Schema additions** (`supabase/schema.sql` — re-run in Supabase SQL editor when activating):
    `token_transactions`, `usage_logs`, `subscriptions` tables; re-seeded `pricing_settings`
    (new keys above); plans re-seeded as Free/Basic/Pro/Business per the spec.
  - **Mode switch:** everything keys off `tokenSystemActive()` (= GOOGLE_CLIENT_ID **and**
    Supabase creds present). Without creds the app runs EXACTLY as Phase 1 (localStorage
    FREE_LIMIT) — verified before/after. `/api/config` now returns `tokenSystem`,
    `guestFreeGenerations`, `guestTrialEnabled`, `tokenCostPerGeneration`.
  - **BUG FIXED on the way:** auth.js used to read `GOOGLE_CLIENT_ID`/`SESSION_SECRET` at module
    scope — but ESM hoists imports above server.js's `dotenv.config()`, so values from a local
    `.env` were NEVER seen (login silently stayed off; Render worked only because its dashboard
    env vars are real process env). auth.js now reads env lazily like db.js. Don't regress this.
  - **NOT yet built (next phases):** membership purchase/Stripe (schema + admin toggles exist,
    no checkout), user dashboard page (profile/plan/usage history), admin per-user management UI.
    i18n: new keys (`login.*`, `upgrade.*`, `referral.*`,
    `generate.tokenBalance/guestLeft/loginToStart/outOfTokens`) exist in **en.json only** so far —
    other 9 dictionaries fall back to English until translated.

- **Phase B — referral reward engine (DONE, same 2026-07-01 session).**
  - **Engine:** `processReferralReward(invitedUserId, trigger)` in db.js — triggers are
    `signup` (fired in `/api/auth/google` on isNew) and `first_generation` (fired in the user
    `gate.commit` after each successful charge; exits instantly when no pending referral).
    `paid_membership` is defined in the trigger ordering but nothing fires it until the
    membership phase. A LATER action satisfies an EARLIER `referral_min_action` (ordering
    signup < first_generation < paid_membership).
  - **Anti-fraud (per spec):** clicks alone create nothing (reward only fires from verified
    Google sign-ins); `referrals.invited_user_id` UNIQUE → one referred user rewards one
    referrer once; one-way conditional update `pending → reward_sent` (`.eq('status','pending')`)
    blocks concurrent double-pay; self-referral double-checked; blocked/suspended referrers get
    nothing; `max_referral_rewards_per_month` cap — a qualified referral past the cap STAYS
    pending and pays on a later trigger (i.e. deferred to next month), by design.
  - **Reward amount** read live from `referral_reward` (default 10) — admin-configurable, and
    paid via `grantTokens(..., 'referral_reward')` so it lands in the token ledger.
  - **Routes:** `/ref/:code` added (spec URL shape) alongside legacy `/invite/:code` — both just
    redirect to `/?ref=CODE`. New `GET /api/referrals` (session required) → `{ enabled, reward,
    code, link, invited, pending, rewarded, tokensEarned }`; link is built from the request's own
    host so it's correct on any deployment. `/api/config` now also returns `referralEnabled`.
  - **UI:** 🎁 button in the topbar (visible only signed-in + referral system on) opens a
    **Refer & Earn modal** (`#referralModal`): shareable link + Copy, and Invited / Pending /
    Rewarded / Tokens-earned stat tiles. Signed-out access bounces to the login modal.
    `referralRewardLine` deliberately has NO data-i18n (JS injects the live reward amount).
  - Verified with fake creds: `/ref/X` → `/?ref=X`, `/api/referrals` 401 signed-out → login
    modal, modal layout screenshot-checked; legacy mode (no creds) re-verified untouched after.
    The reward path itself (real payout) still needs real Supabase + two Google accounts to test.

- **Phase C — membership plans + Stripe prep + user dashboard (DONE, same 2026-07-01 session).**
  - **Plans API:** public `GET /api/plans` → active plans (id, name, monthlyPrice, monthlyTokens),
    hidden entirely when `membership_enabled` is off or token system inactive. Admin editor:
    `GET /api/admin/plans` (all incl. inactive) + `PUT /api/admin/plans` (upsert ONE plan —
    no id = create; validates name/price/limit/priority/active). db.js: `getActivePlans`,
    `getAllPlans`, `getPlanById`, `upsertPlan`.
  - **Checkout seam (Stripe NOT wired):** `POST /api/checkout { planId }` — session required,
    validates the plan, then returns 503 `pendingPayment:true` "Payments are coming soon" while
    `STRIPE_SECRET_KEY` is unset (placeholders added to .env/.env.example). When implementing
    Stripe: create a Checkout Session in that handler and have the WEBHOOK call
    `db.activateSubscription({userId, planId, stripe*Ids})` — that helper already exists and
    does everything (subscriptions row status 'active' + 1-month period, users.plan_id + role
    'premium', grants monthly_limit tokens via the ledger, logs a 'subscribe' event). NEVER
    activate a plan from client input without payment verification.
  - **User dashboard:** click the signed-in user chip (name/avatar, `#dashboardBtn`) → dashboard
    modal: profile (picture/name/email), token balance, current plan + payment status
    (active|expired|cancelled|failed from the latest subscriptions row), referral link + copy,
    referral tokens earned, ⭐ Upgrade button (→ plans modal), last-10 usage history
    (`GET /api/me/summary` returns all of it in one call; db.js `getLatestSubscription`,
    `getUserUsageHistory`).
  - **Plans modal** (`#plansModal`): card per plan (name/price/tokens-per-month), Choose →
    `/api/checkout` (signed-out → login modal); opened from the out-of-tokens upgrade modal's
    CTA, the Top Up button, and the dashboard's Upgrade button.
  - **Admin page:** new "⭐ Membership plans" panel — editable table (name/price/monthly
    tokens/order/active) + "+ Add plan" + "Save plans" (each row PUT separately).
  - `/api/config` now also returns `membershipEnabled`.
  - Verified: legacy mode untouched (plans `{enabled:false}`, checkout/summary 503); token mode
    (fake creds): checkout + summary 401 signed-out; plans modal, dashboard modal, admin plan
    editor all layout-checked in-browser (screenshots in session). Real subscription activation
    needs Stripe keys + a real DB — deliberately unreachable until then.
  - **Remaining after Phase C:** actual Stripe Checkout + webhook, admin per-user management UI
    (block/grant tokens per user), user-facing "payment history", i18n translations of the new
    keys (`plans.*`, `dashboard.*`) beyond English.
  - **To activate:** fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + GOOGLE_CLIENT_ID +
    SESSION_SECRET in .env (and Render env), run the updated schema.sql, then test a real Google
    sign-in (should create the user with 50 tokens and show the badge).

## Deployment (DONE — read before redeploying)
- **GitHub:** https://github.com/kannammaiglasgow-prog/ai-reply-assistant, branch `main`. Always
  push here; `.env` is gitignored (never committed).
- **Live site: Render**, https://ai-reply-assistant-i4mt.onrender.com/ — a "Web Service" (not the
  `render.yaml` Blueprint path; the user created it manually via New → Web Service → connected the
  GitHub repo → Build Command `npm install` → Start Command `node server.js` → Free instance → env
  vars imported directly from the local `.env` file via Render's "Add from .env" button). Verified
  end-to-end: root page, `/api/config`, a real `/api/generate` call (Gemini), `/i18n/*.json`, and
  `/admin.html` all return correctly. Render auto-deploys on every push to `main` (confirmed).
- **Vercel — attempted and NOT working.** The user separately connected this repo to a Vercel
  project (`ai-reply-assistant-xi.vercel.app`, also a `-6bqqguokn-...` deployment alias). It
  crashes with `FUNCTION_INVOCATION_FAILED` on every request, including `/`. Two fixes were made
  and pushed but did NOT resolve it (~3.5 min of polling still showed 500 after both landed):
  1. `server.js` — guarded `app.listen()` behind `if (!process.env.VERCEL)` and added
     `export default app;` (Vercel's Node runtime needs a serverless-callable export, not a bound
     port) — commit `f0a3c7d`.
  2. `vercel.json` — was mixing the legacy `builds` key with the newer `rewrites` key (an
     unsupported combination); changed to the correct `builds` + `routes` pairing — commit
     `a9b5ae8`.
  **Do not assume Vercel works** — nobody has confirmed a 200 from it since. Diagnosing further
  needs the actual Vercel **Runtime Logs** (dashboard → the project → Logs tab, or click a failed
  invocation) — this assistant had no Vercel account/API access to pull them directly. If asked to
  fix Vercel again, ask the user to paste the exact log/stack-trace text rather than guessing
  blind a third time.
- **Standing instruction:** the user said (2026-07-01) that whenever they ask to "deploy" going
  forward, run an 11-step pipeline automatically (pull → fix → lint → typecheck → test → build →
  commit → push → deploy → verify → report the live URL) without asking at each step, UNLESS
  something genuinely needs manual intervention (missing deploy-target auth being the main one
  seen so far). This project has no lint/typecheck/test/build scripts configured — say so plainly
  rather than pretending they ran. Full detail saved in this assistant's persistent memory
  (`feedback_deploy_workflow.md` / `project_deploy_target.md`) — a fresh session should already
  have this via memory, but it's restated here in case that system isn't consulted.
- **`ADMIN_PASSWORD` is `admin123` on the live Render site right now** — same weak default as
  local `.env`. Worth changing in the Render dashboard's Environment tab (auto-redeploys on save).

## Pending / next tasks (in priority order)
1. **Off-topic / hallucination fix:** for poems, tributes, quotes the model sometimes invents
   unrelated context (e.g. a poetic tribute produced political party commentary not in the text).
   Tighten the prompt: do NOT add political parties / people / events that are not in the message;
   for a poem/tribute/quote, reply in the same tone.
2. **Fix Vercel** (see Deployment section above) if the user wants it working too — needs real
   runtime logs to diagnose, don't guess blind again.
3. **Rotate `ADMIN_PASSWORD`** away from the `admin123` default now that the site is public.
4. **Settings page** (the nav "Settings" tab is currently a "coming soon" placeholder): UI to switch
   provider/model, theme, show API-key connection status (mock of the provided screen-3 design).
5. **Recent + Saved Replies pages** (nav tabs are placeholders). Save already writes to localStorage
   key `are.saved`; build the pages to list them. Recent = history of generations (would need to
   store them client-side).
6. **More UI translation files:** 108 of the 118 listed UI languages have no `<code>.json` yet
   (gracefully fall back to English — see the i18n section above). Add more by copying `en.json`'s
   key shape.
7. Future: real login, paid top-up/credits + Stripe, server-side usage tracking, more platforms for
   fetch-context (Facebook/X/TikTok — currently return "paste manually"), Phase 2 Step 3 (move
   usage tracking server-side once Supabase creds + Google OAuth are configured).

## Important constraints (keep these)
- Do not invent facts; for controversial/political topics keep unverified claims as opinions.
- Originality & safety rules in the system prompt must stay.
- Keep API keys only in .env (never commit, never put in client code or chat).
- "No login" is intentional for the MVP; identify the browser via localStorage only.
