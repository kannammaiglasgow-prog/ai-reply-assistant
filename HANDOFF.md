# HANDOFF — AI Reply Assistant (for the next AI/dev to continue)

Read this file fully before changing anything, then continue the pending tasks at the bottom.

## What this app is
A personal MVP web app. User pastes a message / URL / image and gets AI-generated reply
suggestions, tuned by **perspective**, **reply style**, **language**, and **count**.
Heavily used for **Tamil** social-media replies (also English, Tanglish + 30+ languages).

## Stack
- **Backend:** Node.js + Express (ESM), single file `server.js`.
- **Frontend:** plain HTML/CSS/JS in `public/` (no framework, no build step).
- **AI providers:** Gemini (active) and OpenAI (switchable). No database — usage/feedback in
  JSONL files + browser localStorage.
- Run: `npm install` then `npm start` → http://localhost:3000  (dev: `npm run dev`).

## Files
```
ai-response-engine/
├── server.js            # all backend logic + endpoints
├── package.json
├── .env                 # SECRETS (gitignored) — real keys live here
├── .env.example         # documents every env var
├── public/
│   ├── index.html       # main single-page UI
│   ├── style.css        # light/dark theme (CSS vars), all styling
│   ├── app.js           # all frontend logic
│   ├── admin.html       # password-gated analytics page
│   └── admin.js
├── data/                # runtime logs (gitignored)
│   ├── feedback.jsonl   # 👍/👎/copy/save events
│   └── generations.jsonl# one line per generation (for analytics)
├── README.md  DESIGN.md  UI-BRIEF.md  HANDOFF.md
```

## Environment (.env)
```
PROVIDER=gemini                 # "gemini" or "openai"
GEMINI_API_KEY=AQ.********       # PAID tier enabled on the Google project
GEMINI_MODEL=gemini-2.5-flash    # has auto-fallback list in server.js
OPENAI_API_KEY=sk-...            # currently a placeholder (was overwritten); re-add for gpt-5.5
OPENAI_MODEL=gpt-5.5
ADMIN_PASSWORD=admin123          # CHANGE THIS — admin analytics login
YOUTUBE_API_KEY=                 # optional; empty = YouTube falls back to oEmbed (title+channel only)
PORT=3000
```
Note: dotenv is loaded with `{ override: true }` so .env always wins over stale system env vars.
The Gemini key starts with `AQ.` and works on the paid tier (free tier daily caps are tiny).

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
- **Daily free limit:** 10 free replies/day, counted by **replies generated** (not requests),
  stored in localStorage (`are.usage` = {date, used}), resets at local midnight. Counter shown near
  Generate; over-limit shows a warning and does NOT call the API; at 0 the button disables + Top Up
  placeholder ("Top-up feature coming soon."). Count options: 1/3/5/10/20 (default 1).
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
- **Step 3 (NEXT) — server-side usage.** Move daily/bonus counting into the DB
  (`daily_usage`/`monthly_usage` tables exist), have `/api/generate*` read the session, check &
  decrement (daily allowance first, then `bonus_balance`), and retire the localStorage limit once
  signed in. Then Step 4 events (generate/copy) → Step 5 referral engine → 6 dashboard → 7 admin.

## Pending / next tasks (in priority order)
1. **Off-topic / hallucination fix:** for poems, tributes, quotes the model sometimes invents
   unrelated context (e.g. a poetic tribute produced political party commentary not in the text).
   Tighten the prompt: do NOT add political parties / people / events that are not in the message;
   for a poem/tribute/quote, reply in the same tone.
2. **Deploy online** (Render / Railway free tier) so it has a permanent URL and doesn't need a local
   server. Set env vars in the host dashboard; note feedback/generations JSONL won't persist on
   ephemeral hosts (acceptable for MVP, or move to a DB).
3. **Settings page** (the nav "Settings" tab is currently a "coming soon" placeholder): UI to switch
   provider/model, theme, show API-key connection status (mock of the provided screen-3 design).
4. **Recent + Saved Replies pages** (nav tabs are placeholders). Save already writes to localStorage
   key `are.saved`; build the pages to list them. Recent = history of generations (would need to
   store them client-side).
5. Future: real login, paid top-up/credits + Stripe, server-side usage tracking, more platforms for
   fetch-context (Facebook/X/TikTok — currently return "paste manually").

## Important constraints (keep these)
- Do not invent facts; for controversial/political topics keep unverified claims as opinions.
- Originality & safety rules in the system prompt must stay.
- Keep API keys only in .env (never commit, never put in client code or chat).
- "No login" is intentional for the MVP; identify the browser via localStorage only.
