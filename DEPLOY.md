# Deploying to Render (free tier)

This app is a plain Node + Express server. Render runs it directly from your GitHub repo.
`render.yaml` already tells Render how to build/start it — you just connect the repo and set secrets.

## Step 1 — Put the code on GitHub
The local git repo is already initialised and committed. Create an **empty** GitHub repo
(no README/.gitignore) at https://github.com/new — e.g. `ai-reply-assistant` — then run:

```bash
git remote add origin https://github.com/<your-username>/ai-reply-assistant.git
git branch -M main
git push -u origin main
```

(`.env` is gitignored, so your real API keys are NOT uploaded — that's intentional.)

## Step 2 — Create the Render service
1. Go to https://render.com → sign up / log in (GitHub login is easiest).
2. **New +** → **Blueprint** → connect GitHub → pick your `ai-reply-assistant` repo.
3. Render reads `render.yaml` and proposes the service. Click **Apply**.

## Step 3 — Set the secret env vars (Render dashboard → the service → Environment)
These are marked `sync:false` in `render.yaml`, so Render asks you to fill them:
- `GEMINI_API_KEY` — your paid Gemini key (starts with `AQ.`).
- `ADMIN_PASSWORD` — pick a strong password (this guards /admin.html).
- `OPENAI_API_KEY` — only if you switch `PROVIDER` to `openai` (optional).
- `YOUTUBE_API_KEY` — optional (richer URL context).
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID` — only when you enable Phase 2
  accounts. Leave blank for now → the app runs in Phase 1 mode (localStorage usage, no login).
- `SESSION_SECRET` — Render auto-generates this (`generateValue: true`); no action needed.

Click **Save** → Render redeploys.

## Step 4 — Open it
Render gives you a URL like `https://ai-reply-assistant.onrender.com`. Open it and test:
- Paste a message → Generate replies.
- `/admin.html` → log in with `ADMIN_PASSWORD`.

## Notes / gotchas
- **Free tier sleeps** after ~15 min idle; the first request after that takes ~30–50s to wake. Normal.
- **Logs don't persist:** `data/feedback.jsonl` and `data/generations.jsonl` are wiped on each deploy/
  restart (ephemeral disk). Fine for testing; move to the DB (Phase 2) if you need durable analytics.
- **Updating the live site:** just `git push` again — Render auto-deploys (`autoDeploy: true`).
- **Phase 2 Google login online:** in Google Cloud Console add your Render URL to the OAuth client's
  "Authorised JavaScript origins" before sign-in will work on the live site.
