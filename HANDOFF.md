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
  `responseMimeType: application/json`) or OpenAI (chat completions). Gemini has **auto model
  fallback** on 429 (quota) via `GEMINI_FALLBACKS`, and one transient-503 retry. OpenAI retries
  without `temperature` if a model rejects a custom value. Malformed-JSON gets one retry.
- **Prompt engine:** `buildSystemPrompt()` + `buildUserPrompt()` + `STYLE_HINTS`. 10 distinct
  style "engines": Comedy, Mass Hero, Smart, Professional, Friendly, Emotional, Debate, Savage,
  Meme, News — each with its own personality. Strong rules: respond directly to the message,
  natural Tamil with ONLY real correctly-spelled words (no invented/garbled words), originality &
  safety (NEVER imitate real people/celebrities/copyrighted dialogue), vary every reply.
- **Languages:** `LANGUAGES` array + `languageInstruction()` (Tamil/Tanglish special-cased, generic for rest).
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
