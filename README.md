# AI Reply Assistant

A simple personal MVP web app. Paste any message, question, article, comment, or conversation, then generate AI reply suggestions tuned by **perspective**, **style**, **language**, and **count**.

- **Frontend:** plain HTML / CSS / JavaScript (single page)
- **Backend:** Node.js + Express
- **AI:** OpenAI API
- **No server database, no login** (Saved replies + theme are kept in the browser's `localStorage`)

## Features

- Large textarea (5000-char limit) with live count + Clear
- **Perspective:** All / Supporter / Opposition / Neutral
- **Reply styles** (multi-select): Funny, Smart, Professional, Friendly, Emotional, Mass, Debate, Savage + "More Styles" reveals Short & Long
- **Output language:** Tamil / English / Tanglish
- **Number of replies:** 5 / 10 / 20
- Replies shown as cards, each with style + perspective tags and **Copy**, **Regenerate**, **Save**, **👍 Useful**, **👎 Not useful**
- Results toolbar: search, filter by style, sort, plus **Copy All / Export TXT / Export CSV**
- **Light / Dark** theme toggle (remembered per browser)
- Guardrails: the model is instructed not to invent facts and not to present unverified claims as facts on controversial topics

### Built but not yet wired up
The top nav shows **Recent**, **Saved Replies**, and **Settings** tabs — these are placeholders for the next iteration (they currently show a "coming soon" note).

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or newer (`node -v` to check)
- An OpenAI API key — https://platform.openai.com/api-keys

## Setup

```bash
cd ai-response-engine
npm install
```

Create your environment file by copying the example:

```bash
# macOS / Linux / Git Bash
cp .env.example .env
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

Open `.env` and paste your real key:

```
OPENAI_API_KEY=sk-...your key...
OPENAI_MODEL=gpt-4o-mini   # optional, this is the default
PORT=3000                  # optional
```

> The `.env` file is git-ignored, so your key is never committed.

## Run

```bash
npm start
```

Then open **http://localhost:3000** in your browser.

For auto-restart while editing the backend:

```bash
npm run dev
```

## How it works

1. The browser collects your text and options and POSTs them to `/api/generate`.
2. The Express server builds a prompt (with the anti-hallucination rules) and calls the OpenAI Chat Completions API, requesting strict JSON.
3. The server validates and cleans the JSON, then returns the replies.
4. The frontend renders each reply as a card.

## Project structure

```
ai-response-engine/
├── server.js            # Express server + OpenAI call
├── package.json
├── .env.example         # copy to .env and add your key
├── .gitignore
├── README.md
└── public/
    ├── index.html       # the single page
    ├── style.css
    └── app.js           # frontend logic
```

## Notes / limitations

- Replies are AI-generated **suggestions** — always review before posting.
- "Useful" / "Not useful" votes are visual only (no database), since this is a personal MVP.
- API usage is billed to your OpenAI account.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `OPENAI_API_KEY is missing` on start | Create `.env` and add your key, then restart. |
| "OpenAI rejected the API key" | The key is wrong/expired — check it at platform.openai.com. |
| Port already in use | Set a different `PORT` in `.env`. |
| `node` not found (Windows) | Reopen your terminal so PATH refreshes after installing Node. |
