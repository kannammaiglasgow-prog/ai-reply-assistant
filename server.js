import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';

// override:true so the key in .env always wins over any stale system env var
dotenv.config({ override: true });
import OpenAI from 'openai';
import { dbEnabled, checkDb, loginOrCreateUser, getUserById, logEvent } from './db.js';
import {
  googleAuthConfigured,
  getGoogleClientId,
  verifyGoogleCredential,
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  getSessionUserId,
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;

// Which AI generates replies: "openai", "gemini", "minimax", or "openrouter"
const PROVIDER = (process.env.PROVIDER || 'openai').toLowerCase();
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-pro';
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || 'MiniMax-Text-01';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'minimax/minimax-01';
const ACTIVE_MODEL =
  PROVIDER === 'gemini' ? GEMINI_MODEL
  : PROVIDER === 'minimax' ? MINIMAX_MODEL
  : PROVIDER === 'openrouter' ? OPENROUTER_MODEL
  : OPENAI_MODEL;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// MiniMax's chat API is OpenAI-compatible, so we reuse the OpenAI SDK with its base URL.
// International endpoint: https://api.minimax.io/v1 (mainland China accounts use api.minimaxi.com).
const minimax = new OpenAI({
  apiKey: process.env.MINIMAX_API_KEY,
  baseURL: process.env.MINIMAX_BASE_URL || 'https://api.minimax.io/v1',
});
// OpenRouter is also OpenAI-compatible — one key, many models (e.g. minimax/minimax-01).
const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

function activeKeyMissing() {
  if (PROVIDER === 'gemini') return !process.env.GEMINI_API_KEY;
  if (PROVIDER === 'minimax') return !process.env.MINIMAX_API_KEY;
  if (PROVIDER === 'openrouter') return !process.env.OPENROUTER_API_KEY;
  return !process.env.OPENAI_API_KEY;
}
if (activeKeyMissing()) {
  console.error(`\n[!] Missing API key for provider "${PROVIDER}". Add it to your .env file.\n`);
}

// Feedback log — one JSON object per line (JSONL). Not a database; just a file we can read & analyse.
const FEEDBACK_FILE = path.join(__dirname, 'data', 'feedback.jsonl');
// Generation usage log (for the admin analytics page).
const GENERATIONS_FILE = path.join(__dirname, 'data', 'generations.jsonl');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// Parse a model's JSON reply, tolerating providers that wrap it in a ```json ... ``` fence
// when they don't support a strict JSON response mode (seen with MiniMax via OpenRouter).
function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const match = String(raw).match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }
}

function appendJsonl(file, entry) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('log write failed:', e?.message || e);
  }
}
function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// Fallback Gemini models tried in order when the configured one is out of free-tier quota.
const GEMINI_FALLBACKS = [
  'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite',
  'gemini-flash-lite-latest', 'gemini-2.0-flash',
];

// Call one Gemini model. Retries once on a transient 503; throws Error with .status otherwise.
async function callGemini(model, systemText, userText, temperature, image) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=` +
    process.env.GEMINI_API_KEY;
  const parts = [{ text: userText }];
  if (image) parts.push({ inline_data: { mime_type: image.mimeType, data: image.data } });
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature, responseMimeType: 'application/json' },
  });

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const data = await r.json();
    if (r.ok) return data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const msg = data?.error?.message || 'Gemini request failed';
    lastErr = Object.assign(new Error(msg), { status: r.status });
    const retriable = r.status === 503 || /high demand|overload|try again/i.test(msg);
    if (!retriable || attempt === 1) throw lastErr;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw lastErr;
}

// Shared OpenAI-compatible chat-completion call (used for both OpenAI and MiniMax, which
// exposes an OpenAI-style /chat/completions endpoint). Retries without `response_format` if
// the model/provider rejects it, then retries without `temperature` if that's rejected too.
async function callOpenAiCompatible(client, model, systemText, userText, temperature, image) {
  const userContent = image
    ? [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } },
      ]
    : userText;
  const messages = [
    { role: 'system', content: systemText },
    { role: 'user', content: userContent },
  ];

  // Cap output tokens: reply JSON is always short, and some gateways (OpenRouter) price the
  // request against the model's full max_tokens by default, which can exceed account credits.
  const attempt = async (opts) => {
    const completion = await client.chat.completions.create({ model, messages, max_tokens: 4000, ...opts });
    // Some gateways (OpenRouter) respond HTTP 200 with an `{ error: {...} }` body instead of
    // throwing — normalise that into a real error so the fallback logic below can catch it.
    if (completion?.error) throw Object.assign(new Error(completion.error.message || 'Provider error'), { status: completion.error.code });
    return completion;
  };

  let completion;
  try {
    completion = await attempt({ response_format: { type: 'json_object' }, temperature });
  } catch (e) {
    const msg = String(e?.message || '').toLowerCase();
    if (msg.includes('response_format') || msg.includes('json_object')) {
      completion = await attempt({ temperature });
    } else if (msg.includes('temperature')) {
      completion = await attempt({ response_format: { type: 'json_object' } });
    } else {
      throw e;
    }
  }
  return completion.choices?.[0]?.message?.content || '{}';
}

// Ask the active provider for a JSON reply and return the raw JSON string.
// image (optional): { mimeType, data } where data is base64 (no data: prefix)
async function generateJson(systemText, userText, temperature, image) {
  if (PROVIDER === 'gemini') {
    // Try the configured model first, then fall back to others if one is out of quota (429).
    const candidates = [GEMINI_MODEL, ...GEMINI_FALLBACKS].filter((m, i, a) => a.indexOf(m) === i);
    let lastErr;
    for (const model of candidates) {
      try {
        return await callGemini(model, systemText, userText, temperature, image);
      } catch (e) {
        lastErr = e;
        if (e.status === 429 || e.status === 503) continue; // quota/busy → try next model
        throw e; // auth or other error → stop
      }
    }
    throw lastErr; // every model exhausted
  }

  if (PROVIDER === 'minimax') {
    return callOpenAiCompatible(minimax, MINIMAX_MODEL, systemText, userText, temperature, image);
  }

  if (PROVIDER === 'openrouter') {
    return callOpenAiCompatible(openrouter, OPENROUTER_MODEL, systemText, userText, temperature, image);
  }

  // default: OpenAI
  return callOpenAiCompatible(openai, OPENAI_MODEL, systemText, userText, temperature, image);
}

const app = express();
app.use(express.json({ limit: '12mb' })); // larger limit so uploaded images (base64) fit

// Invite links: /invite/<CODE> drops the code into the URL the SPA loads, so the sign-in
// flow can forward it as referred_by. Defined before static so it isn't shadowed by a file.
app.get('/invite/:code', (req, res) => {
  const code = String(req.params.code || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
  res.redirect(code ? `/?ref=${encodeURIComponent(code)}` : '/');
});

app.use(express.static(path.join(__dirname, 'public')));

// Shape the user row into the safe subset the browser is allowed to see.
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    picture: u.picture,
    role: u.role,
    status: u.status,
    referralCode: u.referral_code,
    bonusBalance: u.bonus_balance,
    devMode: u.dev_mode,
  };
}

// Tells the frontend whether login/DB are available and which Google client to use.
app.get('/api/config', (req, res) => {
  res.json({
    googleClientId: getGoogleClientId(),
    authEnabled: googleAuthConfigured() && dbEnabled(),
    dbEnabled: dbEnabled(),
  });
});

// Exchange a Google ID token for an app session. Creates the user on first sign-in,
// grants the new-user bonus, and captures the referrer from ?ref / refCode.
app.post('/api/auth/google', async (req, res) => {
  if (!googleAuthConfigured()) return res.status(503).json({ error: 'Google login is not configured on the server.' });
  if (!dbEnabled()) return res.status(503).json({ error: 'Database is not configured on the server.' });

  const credential = req.body?.credential;
  if (!credential) return res.status(400).json({ error: 'Missing Google credential.' });

  let profile;
  try {
    profile = await verifyGoogleCredential(credential);
  } catch (e) {
    return res.status(401).json({ error: e?.message || 'Google sign-in failed.' });
  }

  try {
    const refCode = (req.body?.refCode || '').toString().trim() || null;
    const { user, isNew } = await loginOrCreateUser({ ...profile, refCode });
    if (user.status && user.status !== 'active') {
      return res.status(403).json({ error: `Your account is ${user.status}.` });
    }
    setSessionCookie(res, createSessionToken(user.id));
    logEvent(user.id, 'login');
    res.json({ user: publicUser(user), isNew });
  } catch (e) {
    console.error('auth/google failed:', e?.message || e);
    res.status(500).json({ error: 'Could not complete sign-in.' });
  }
});

// Who am I? Returns the current signed-in user (from the session cookie) or null.
app.get('/api/auth/me', async (req, res) => {
  const uid = getSessionUserId(req);
  if (!uid) return res.json({ user: null });
  const user = await getUserById(uid);
  if (!user || user.status === 'deleted') {
    clearSessionCookie(res);
    return res.json({ user: null });
  }
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// --- Allowed option values (kept in sync with the frontend) ---
const PERSPECTIVES = ['Supporter', 'Opposition', 'Neutral', 'All'];
const STYLES = [
  'Friend', 'Casual Chat', 'Angry', 'Comedy', 'Sarcastic', 'Savage', 'Troll', 'Respectful',
  'Professional', 'Romantic', 'Cute', 'Emotional', 'Motivational', 'Mass Hero',
  'Cinema Dialogue', 'Villain', 'Mystery', 'Punch Dialogue', 'SMS Short', 'AI Robot',
];
// Reply OUTPUT languages — 100+, kept in sync with public/i18n/output-languages.json (the
// searchable picker's data source). Any name not special-cased in LANGUAGE_INSTRUCTIONS below
// still works via the generic fallback in languageInstruction().
const LANGUAGES = [
  'English', 'Tamil', 'Hindi', 'Spanish', 'French', 'Arabic', 'Chinese (Simplified)',
  'Chinese (Traditional)', 'Portuguese', 'Russian', 'Japanese', 'German', 'Korean', 'Italian',
  'Turkish', 'Vietnamese', 'Indonesian', 'Bengali', 'Urdu', 'Telugu', 'Marathi', 'Kannada',
  'Malayalam', 'Gujarati', 'Punjabi', 'Odia', 'Assamese', 'Nepali', 'Sinhala', 'Sanskrit',
  'Konkani', 'Maithili', 'Bhojpuri', 'Kashmiri', 'Sindhi', 'Manipuri', 'Santali', 'Dogri',
  'Thai', 'Malay', 'Filipino', 'Burmese', 'Khmer', 'Lao', 'Cebuano', 'Javanese', 'Sundanese',
  'Mongolian', 'Tibetan', 'Hebrew', 'Persian', 'Pashto', 'Kurdish', 'Azerbaijani', 'Kazakh',
  'Uzbek', 'Turkmen', 'Tajik', 'Kyrgyz', 'Armenian', 'Georgian', 'Dutch', 'Polish', 'Ukrainian',
  'Greek', 'Swedish', 'Norwegian', 'Danish', 'Finnish', 'Icelandic', 'Czech', 'Slovak',
  'Hungarian', 'Romanian', 'Bulgarian', 'Serbian', 'Croatian', 'Bosnian', 'Slovenian',
  'Macedonian', 'Albanian', 'Estonian', 'Latvian', 'Lithuanian', 'Irish', 'Welsh', 'Catalan',
  'Basque', 'Galician', 'Maltese', 'Luxembourgish', 'Swahili', 'Amharic', 'Hausa', 'Yoruba',
  'Igbo', 'Zulu', 'Xhosa', 'Afrikaans', 'Somali', 'Shona', 'Malagasy', 'Kinyarwanda', 'Chichewa',
  'Sesotho', 'Haitian Creole', 'Latin', 'Esperanto', 'Yiddish', 'Corsican', 'Frisian',
  'Scots Gaelic', 'Hawaiian', 'Hmong', 'Fijian', 'Samoan', 'Tongan', 'Maori', 'Tanglish',
];
const COUNTS = [1, 3, 5, 10, 20];

const LANGUAGE_INSTRUCTIONS = {
  Tamil:
    'Write every reply in natural, conversational Tamil (தமிழ்) — the way a real native Tamil speaker would actually type it in a chat or comment. Fluent and idiomatic, NOT a stiff word-for-word textbook translation. CRITICAL: every single word must be a REAL, correctly spelled Tamil word in normal use. NEVER output invented, garbled, mashed, or mistyped strings — for example, non-words like "பருதிங்கும்", "பட்டாச்சோல", "ஊரசுக்கு" are completely unacceptable. Spoken/colloquial Tamil and slang are welcome, but only authentic real words. Before finalising EACH reply, silently re-read it: (a) is every word a real Tamil word? (b) does the whole sentence make clear, obvious sense? If not, rewrite it until it does.',
  English:
    'Write every reply in natural, conversational English — the way a real person would actually reply.',
  Tanglish:
    'Write every reply in natural Tanglish — spoken Tamil typed in English/Latin letters, the way people really chat (e.g. "Anna idhu romba nallaa iruku da").',
};

// Instruction for any language: special-cased ones above, generic for the rest.
function languageInstruction(language) {
  if (LANGUAGE_INSTRUCTIONS[language]) return LANGUAGE_INSTRUCTIONS[language];
  return (
    `Write every reply in natural, conversational ${language} — the way a real native ${language} ` +
    `speaker would actually type it in a chat or comment. Fluent and idiomatic, NOT a stiff translation. ` +
    `Use ONLY real, correctly spelled ${language} words in the correct script; never invent, garble, or ` +
    `misspell words. Re-read each reply to make sure every word is real and the sentence clearly makes sense.`
  );
}

const PERSPECTIVE_INSTRUCTIONS = {
  Supporter: 'Every reply agrees with or supports the view/sentiment in the message — in a natural, sensible way.',
  Opposition:
    'Every reply respectfully disagrees with or pushes back on the OPINION in the message, while still making sense and staying on-topic. Disagree with the idea, do not insult people or contradict reality.',
  Neutral: 'Every reply stays balanced — acknowledging the point without strongly taking a side.',
  All:
    'Spread the replies across stances (supporting, opposing, neutral), but EVERY reply must still be a coherent, sensible, on-topic response — never rude, absurd, or contradictory just to fit a stance. Label each reply with its actual stance in the "perspective" field.',
};

// Each style is its own "reply engine" with a distinct personality and writing rhythm.
const STYLE_HINTS = {
  Friend:
    'FRIEND ENGINE. Warm, personal and supportive — like your closest friend replying just for you, not a public one-liner. Caring, easygoing, genuinely invested in the other person.',
  'Casual Chat':
    'CASUAL CHAT ENGINE. Relaxed everyday chit-chat energy — the way people banter in a WhatsApp/group chat. Informal, breezy, may use casual filler words. Light and low-effort in the best way.',
  Angry:
    'ANGRY ENGINE. Frustrated, irritated, worked-up reaction — real annoyance comes through in the wording and rhythm (clipped sentences, sharp emphasis). Never crosses into slurs, hate speech, threats, or harassment — it is heated, not abusive.',
  Comedy:
    'CLASSIC COMEDY ENGINE. Light, highly entertaining humour in a natural spoken voice (the kind of comment that gets laughs on Facebook / WhatsApp / YouTube). Use ONE of: playful exaggeration, a dramatic over-the-top reaction, or an innocent/funny misunderstanding of the message — then land a short punchline. Warm and silly, never mean. Invent fresh, original jokes; do NOT copy any comedian, actor, or movie dialogue.',
  Sarcastic:
    'SARCASTIC ENGINE. Dry, ironic wit — says the opposite of what it means, or exaggerates fake-praise/fake-sympathy to make the point land. Clever and biting, never a genuine personal insult or put-down of someone\'s character/appearance.',
  Savage:
    'SAVAGE ENGINE. Sharp, witty, supremely confident comeback. Win with clever, cutting wit — never abusive, never defamatory, no slurs, no attacks on appearance/identity. Burn the argument, not the person.',
  Troll:
    'TROLL ENGINE. Playful, mischievous wind-up energy — teasing, exaggerated bait, cheeky "gotcha" lines that get a reaction. Harmless fun, never real bullying, never targeting someone\'s identity or personal traits.',
  Respectful:
    'RESPECTFUL ENGINE. Polite, humble and considerate. Softly worded, deferential tone that shows genuine regard for the other person\'s feelings or effort.',
  Professional:
    'PROFESSIONAL ENGINE. Corporate, respectful and clear. Polished, neutral-formal wording suitable for an official or workplace comment.',
  Romantic:
    'ROMANTIC ENGINE. Affectionate, tender and sweet. Warm loving language appropriate to the moment — genuine and heartfelt, never cheesy filler or generic pickup lines.',
  Cute:
    'CUTE ENGINE. Adorable, bubbly and soft — playful sweetness, gentle words, an endearing and lighthearted feel. Innocent charm, not sarcasm.',
  Emotional:
    'EMOTIONAL ENGINE. Warm, empathetic and deeply human. Speak from genuine feeling — acknowledge the emotion in the moment and show heartfelt care or reaction.',
  Motivational:
    'MOTIVATIONAL ENGINE. Energising pep-talk tone — encouraging the reader to keep going, push through, or feel proud. Uplifting and sincere, not preachy or generic.',
  'Mass Hero':
    'MASS HERO ENGINE. Strong confidence and fired-up, motivational energy. Short, bold, hard-hitting punch lines with powerful wording that gives the reader a rush. Punchy rhythm, no long sentences. Completely original wording — never quote or imitate any hero, actor, or film dialogue.',
  'Cinema Dialogue':
    'CINEMA DIALOGUE ENGINE. Dramatic, theatrical delivery with a deliberate pause-and-punch rhythm, like a memorable movie line. Bold and stylised, but 100% original wording — never reproduce or closely paraphrase any real film dialogue.',
  Villain:
    'VILLAIN ENGINE. Confident, superior, slightly menacing antagonist energy — dramatic and arrogant in a fictional, larger-than-life way. Fun dark-character flavour, never a real threat, real hate, or targeted harassment.',
  Mystery:
    'MYSTERY ENGINE. Cryptic and intriguing — hints at more than it says, keeps the reader curious, a hint of suspense. Understated and enigmatic rather than fully explained.',
  'Punch Dialogue':
    'PUNCH DIALOGUE ENGINE. Ultra-short, maximum-impact one-liner — every word earns its place. Hard-hitting and bold, never abusive or crude.',
  'SMS Short':
    'SMS/SHORT ENGINE. Extremely brief, like a real text message — minimal words, quick and to the point, no fluff or elaboration.',
  'AI Robot':
    'AI/ROBOT ENGINE. Deadpan, literal and mechanical — a logical robotic persona giving a precise, matter-of-fact response. Dry, formal-ish phrasing, no emotion, occasionally a dry robotic quirk.',
};

function buildSystemPrompt() {
  return [
    'You write reply suggestions that a real person could send/post in DIRECT response to a given message, comment, question, post, article, or conversation.',
    '',
    'STEP 1 — Understand the message before replying:',
    '- Work out what the message actually means: its topic, its real-world context (sports, news, personal chat, politics, etc.), and its tone/sentiment (praise, complaint, joke, sarcasm, question, excitement, anger).',
    '- If the message is praising or congratulating someone, sensible replies agree, add to it, or gently joke — they do NOT randomly insult or contradict.',
    '- If you are not sure about specific real-world facts in the message, react to its sentiment instead of inventing details.',
    '',
    'STEP 2 — Write replies that actually fit:',
    '- Each reply must directly and specifically respond to THIS exact message and make complete sense on its own.',
    '- NEVER write generic lines that could be pasted under any random message.',
    '- NEVER write confusing, self-contradictory, or nonsensical replies. If a reply would not make sense to a normal reader, rewrite it.',
    '- An off-topic, contradictory, or absurd reply is wrong, even if it is well written.',
    '',
    'STEP 3 — Commit fully to each style\'s personality:',
    '- Every reply has a "style", and each style is its own reply engine with a distinct personality and writing rhythm (described next to each style below).',
    '- Two replies in different styles must read like they were written by two DIFFERENT people — different rhythm, energy, vocabulary, and sentence shapes. A Comedy reply and a Professional reply should feel nothing alike.',
    '- Lean hard into the chosen style; do not blur them into one neutral middle voice. Note: "AI Robot" is the one exception where sounding deliberately mechanical IS the style.',
    '',
    'Sound human & stay varied:',
    '- Make every reply feel like a real human actually typed it — natural, not robotic, not template-like (except the "AI Robot" style, which is deliberately robotic on purpose).',
    '- Across the set, VARY everything: openings, sentence structure, length, and rhythm. Never reuse the same phrase, opener, or pattern twice.',
    '- Each reply must be genuinely unique — no two replies should feel like copies of each other.',
    '',
    'Tone:',
    '- Be natural and respectful by default. The edgier styles (Angry, Sarcastic, Savage, Troll, Villain, Punch Dialogue) are intentionally sharper per their engine description above — even then, they win with wit/attitude, never with crude or insulting nonsense.',
    '- Keep each reply self-contained and ready to send as-is.',
    '',
    'Originality & safety (very important):',
    '- NEVER imitate, clone, or reproduce any real person\'s voice or distinctive speaking style — no actor, celebrity, politician, public figure, comedian, or fictional character.',
    '- NEVER reproduce copyrighted movie dialogues, song lyrics, or famous catchphrases.',
    '- Capture ONLY the requested general mood (comedy, mass, professional, etc.) with completely original wording.',
    '',
    'Hard rules:',
    '- Do NOT invent facts, statistics, names, dates, events, or quotes.',
    '- For controversial or political topics, never present unverified claims as facts. Phrase opinions as opinions ("I feel...", "In my view...").',
    '- The edgier styles (Angry, Sarcastic, Savage, Troll, Villain, Punch Dialogue) may be bold and blunt but must NEVER include slurs, hate speech, threats, defamation, or harassment.',
    '- Honour the requested perspective, styles, and output language exactly.',
    '',
    'Respond ONLY with valid JSON.',
  ].join('\n');
}

function buildUserPrompt({ message, perspective, styles, language, count, hasImage }) {
  const styleList = styles.map((s) => `- ${s}: ${STYLE_HINTS[s] || ''}`).join('\n');
  const source = hasImage
    ? [
        'An IMAGE has been attached — it is usually a screenshot of a social-media post, comment, conversation, or news.',
        'Carefully read EVERYTHING in the image, including any text (Tamil or English), and treat its content as the message to respond to.',
        message ? `The user also added this note/caption:\n"""\n${message}\n"""` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : `Read the following message carefully. Every reply you write must respond directly and specifically to it.\n\nMESSAGE TO RESPOND TO:\n"""\n${message}\n"""`;
  // Explicit request/instruction summary (kept in addition to, not instead of, the detailed
  // style engines / language / perspective rules below — this just restates the ask plainly).
  const requestSummary = [
    `User Question: ${hasImage ? '(see attached image' + (message ? ' + note below' : '') + ')' : message}`,
    `Selected Reply Style: ${styles.join(', ')}`,
    `Selected Output Language: ${language}`,
    `Instruction: Generate the replies in the selected output language. Keep the selected reply style(s) consistent. Return ${count} unique repl${count === 1 ? 'y' : 'ies'}.`,
  ].join('\n');
  return [
    requestSummary,
    '',
    source,
    '',
    `Write exactly ${count} reply suggestions, each one a direct, on-topic response to the message${hasImage ? '/image' : ''} above.`,
    '',
    `OUTPUT LANGUAGE: ${language}. ${languageInstruction(language)}`,
    '',
    `PERSPECTIVE: ${perspective}. ${PERSPECTIVE_INSTRUCTIONS[perspective]}`,
    '',
    `REPLY STYLES (rotate through these across the ${count} replies, distributing them as evenly as you can):`,
    styleList,
    '',
    'Before finalising, check each reply: does it actually respond to THIS message? If not, rewrite it.',
    '',
    'Return JSON in exactly this shape:',
    '{ "replies": [ { "style": "<one of the styles above>", "perspective": "<Supporter|Opposition|Neutral>", "text": "<the reply>" } ] }',
    `The "replies" array must contain exactly ${count} items, each with genuinely unique wording.`,
  ].join('\n');
}

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB decoded

// Parse a "data:image/png;base64,XXXX" string into { mimeType, data } or return an error.
function parseImage(dataUrl) {
  if (typeof dataUrl !== 'string') return { error: 'Invalid image.' };
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return { error: 'Invalid image format.' };
  const mimeType = m[1].toLowerCase();
  if (!IMAGE_MIMES.includes(mimeType)) return { error: 'Unsupported image type. Use PNG, JPG, WEBP, or GIF.' };
  const data = m[2];
  if (data.length * 0.75 > MAX_IMAGE_BYTES) return { error: 'Image is too large (max 8 MB).' };
  return { image: { mimeType, data } };
}

function validateBody(body) {
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  let image = null;
  if (body.image) {
    const parsed = parseImage(body.image);
    if (parsed.error) return { error: parsed.error };
    image = parsed.image;
  }

  if (!message && !image) return { error: 'Please paste a message or attach an image.' };
  if (message.length > 8000) return { error: 'Message is too long (max 8000 characters).' };

  const perspective = PERSPECTIVES.includes(body.perspective) ? body.perspective : null;
  if (!perspective) return { error: 'Invalid perspective.' };

  const styles = Array.isArray(body.styles) ? body.styles.filter((s) => STYLES.includes(s)) : [];
  if (styles.length === 0) return { error: 'Select at least one reply style.' };

  const language = LANGUAGES.includes(body.language) ? body.language : null;
  if (!language) return { error: 'Invalid language.' };

  const count = COUNTS.includes(Number(body.count)) ? Number(body.count) : null;
  if (!count) return { error: 'Invalid number of replies.' };

  return { message, image, perspective, styles, language, count };
}

async function handleGenerate(req, res) {
  const parsed = validateBody(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  if (activeKeyMissing()) {
    return res.status(500).json({ error: `Server is missing the API key for provider "${PROVIDER}". Add it to your .env file and restart.` });
  }

  try {
    const userPrompt = buildUserPrompt({ ...parsed, hasImage: !!parsed.image });
    // The model occasionally returns malformed JSON — retry once before giving up.
    let data = null;
    for (let attempt = 0; attempt < 2 && !data; attempt++) {
      const raw = await generateJson(buildSystemPrompt(), userPrompt, 0.7, parsed.image);
      data = tryParseJson(raw);
    }
    if (!data) {
      return res.status(502).json({ error: 'AI returned an unreadable response. Try again.' });
    }

    const replies = Array.isArray(data.replies) ? data.replies : [];
    const clean = replies
      .filter((r) => r && typeof r.text === 'string' && r.text.trim())
      .map((r) => ({
        style: STYLES.includes(r.style) ? r.style : parsed.styles[0],
        perspective: ['Supporter', 'Opposition', 'Neutral'].includes(r.perspective)
          ? r.perspective
          : parsed.perspective,
        text: r.text.trim(),
      }));

    if (clean.length === 0) {
      return res.status(502).json({ error: 'No replies were generated. Try again.' });
    }

    appendJsonl(GENERATIONS_FILE, {
      at: new Date().toISOString(),
      provider: PROVIDER,
      model: ACTIVE_MODEL,
      language: parsed.language,
      perspective: parsed.perspective,
      count: parsed.count,
      styles: parsed.styles,
      hasImage: !!parsed.image,
    });

    res.json({ replies: clean });
  } catch (err) {
    console.error(`${PROVIDER} error:`, err?.message || err);
    let status = 502;
    let msg = 'Failed to generate replies. Please try again.';
    if (err?.status === 401 || err?.status === 403) {
      status = 401;
      msg = `The ${PROVIDER} API key was rejected. Check your .env file.`;
    } else if (err?.status === 429) {
      status = 429;
      msg =
        PROVIDER === 'gemini'
          ? 'Gemini free-tier limit reached for this model today. Switch GEMINI_MODEL (e.g. gemini-2.5-flash-lite) or enable billing on your Google project.'
          : `${PROVIDER} quota/rate limit hit. Wait a moment, then try again.`;
    } else if (err?.status === 503 || /high demand|overload/i.test(err?.message || '')) {
      status = 503;
      msg = `The ${PROVIDER} model is busy right now. Please try again in a moment.`;
    }
    res.status(status).json({ error: msg });
  }
}
// Same handler on both routes (generate-replies is the documented name).
app.post('/api/generate', handleGenerate);
app.post('/api/generate-replies', handleGenerate);

// Regenerate a single reply for one style (used by the per-card "Regenerate" button)
app.post('/api/regenerate', async (req, res) => {
  const body = req.body || {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message.length > 8000) return res.status(400).json({ error: 'Message is too long.' });

  let image = null;
  if (body.image) {
    const parsedImg = parseImage(body.image);
    if (parsedImg.error) return res.status(400).json({ error: parsedImg.error });
    image = parsedImg.image;
  }
  if (!message && !image) return res.status(400).json({ error: 'Missing message or image.' });

  const style = STYLES.includes(body.style) ? body.style : null;
  if (!style) return res.status(400).json({ error: 'Invalid style.' });

  const language = LANGUAGES.includes(body.language) ? body.language : 'English';
  const perspective = ['Supporter', 'Opposition', 'Neutral', 'All'].includes(body.perspective)
    ? body.perspective
    : 'Neutral';

  if (activeKeyMissing()) {
    return res.status(500).json({ error: `Server is missing the API key for provider "${PROVIDER}".` });
  }

  try {
    const raw = await generateJson(
      buildSystemPrompt(),
      buildUserPrompt({ message, perspective, styles: [style], language, count: 1, hasImage: !!image }),
      0.8,
      image
    );
    const data = tryParseJson(raw);
    if (!data) {
      return res.status(502).json({ error: 'AI returned an unreadable response.' });
    }
    const first = (Array.isArray(data.replies) ? data.replies : []).find(
      (r) => r && typeof r.text === 'string' && r.text.trim()
    );
    if (!first) return res.status(502).json({ error: 'No reply generated.' });

    res.json({
      reply: {
        style,
        perspective: ['Supporter', 'Opposition', 'Neutral'].includes(first.perspective)
          ? first.perspective
          : perspective === 'All'
          ? 'Neutral'
          : perspective,
        text: first.text.trim(),
      },
    });
  } catch (err) {
    console.error('OpenAI error (regenerate):', err?.message || err);
    res.status(502).json({ error: 'Failed to regenerate. Try again.' });
  }
});

// ===== URL → public-metadata context =====
function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/facebook\.com|fb\.watch/i.test(url)) return 'facebook';
  if (/twitter\.com|x\.com/i.test(url)) return 'twitter';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  return null;
}
function youtubeId(url) {
  const m = url.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
  return m ? m[1] : null;
}
function extractHashtags(text) {
  return [...new Set((String(text).match(/#[\p{L}\p{N}_]+/gu) || []))].slice(0, 15);
}
function detectLang(text) {
  if (/[஀-௿]/.test(text)) return 'Tamil'; // Tamil unicode block
  if (/[ऀ-ॿ]/.test(text)) return 'Hindi';
  return 'English';
}
function buildContextText(c) {
  const lines = [`[${c.platform.toUpperCase()} post — public metadata only]`];
  if (c.title) lines.push(`Title: ${c.title}`);
  if (c.channel) lines.push(`Channel/User: ${c.channel}`);
  if (c.publishedAt) lines.push(`Published: ${c.publishedAt.slice(0, 10)}`);
  if (c.description) lines.push(`Description: ${c.description}`);
  if (c.hashtags?.length) lines.push(`Hashtags: ${c.hashtags.join(' ')}`);
  if (c.topComments?.length) lines.push(`Top public comments:\n- ${c.topComments.join('\n- ')}`);
  const stats = [];
  if (c.viewCount) stats.push(`${c.viewCount} views`);
  if (c.likeCount) stats.push(`${c.likeCount} likes`);
  if (c.commentCount) stats.push(`${c.commentCount} comments`);
  if (stats.length) lines.push(`Stats: ${stats.join(', ')}`);
  return lines.join('\n');
}

async function fetchYouTubeContext(url) {
  const id = youtubeId(url);
  if (!id) throw Object.assign(new Error('Could not read the YouTube video id from that URL.'), { status: 400 });

  const key = process.env.YOUTUBE_API_KEY;
  if (key) {
    const vr = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${id}&key=${key}`
    );
    const vd = await vr.json();
    if (!vr.ok) throw Object.assign(new Error(vd?.error?.message || 'YouTube API error'), { status: vr.status });
    const item = vd.items?.[0];
    if (!item) throw Object.assign(new Error('Video not found or it is private.'), { status: 404 });
    const s = item.snippet || {}, st = item.statistics || {};

    let topComments = [];
    try {
      const cr = await fetch(
        `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${id}&order=relevance&maxResults=8&textFormat=plainText&key=${key}`
      );
      const cd = await cr.json();
      topComments = (cd.items || [])
        .map((it) => it.snippet?.topLevelComment?.snippet?.textDisplay)
        .filter(Boolean)
        .map((t) => t.slice(0, 240))
        .slice(0, 8);
    } catch {}

    return {
      platform: 'youtube',
      title: s.title || '',
      channel: s.channelTitle || '',
      publishedAt: s.publishedAt || '',
      description: (s.description || '').slice(0, 1500),
      tags: s.tags || [],
      hashtags: extractHashtags(`${s.title || ''} ${s.description || ''}`),
      topComments,
      viewCount: st.viewCount,
      likeCount: st.likeCount,
      commentCount: st.commentCount,
    };
  }

  // No API key: oEmbed gives title + author only (no key needed).
  const or = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
  if (!or.ok) throw Object.assign(new Error('Could not fetch YouTube info.'), { status: 502 });
  const od = await or.json();
  return {
    platform: 'youtube',
    title: od.title || '',
    channel: od.author_name || '',
    description: '',
    tags: [],
    hashtags: [],
    topComments: [],
    limited: true,
  };
}

const MANUAL_MSG =
  'Unable to fetch public information automatically. Please paste the title, description or comments manually.';

app.post('/api/fetch-context', async (req, res) => {
  const url = (req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'Please paste a URL.' });

  const platform = detectPlatform(url);
  if (!platform) {
    return res.status(400).json({ error: 'Unsupported or invalid URL. Paste a YouTube or Instagram link.' });
  }

  // Only YouTube has a reliable public metadata API. Others → ask for manual paste.
  if (platform !== 'youtube') {
    return res.json({ platform, needsManual: true, message: MANUAL_MSG });
  }

  try {
    const ctx = await fetchYouTubeContext(url);
    ctx.detectedLanguage = detectLang(`${ctx.title} ${ctx.description}`);
    ctx.detectedTopic = (ctx.tags && ctx.tags.slice(0, 3).join(', ')) || ctx.hashtags.slice(0, 3).join(' ') || '';
    ctx.contextText = buildContextText(ctx);
    res.json(ctx);
  } catch (e) {
    if (e?.status === 404) return res.status(404).json({ error: e.message });
    if (e?.status === 403)
      return res.status(403).json({ error: 'YouTube API rejected the request. Check YOUTUBE_API_KEY / quota in .env.' });
    res.json({ platform, needsManual: true, message: MANUAL_MSG });
  }
});

// Record a feedback signal for one reply (👍 / 👎 / copy / save).
app.post('/api/feedback', (req, res) => {
  const b = req.body || {};
  const VOTES = ['useful', 'not-useful', 'copy', 'save', 'unsave'];
  if (!VOTES.includes(b.vote)) return res.status(400).json({ error: 'Invalid vote.' });

  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const entry = {
    at: new Date().toISOString(),
    vote: b.vote,
    style: str(b.style, 40),
    perspective: str(b.perspective, 40),
    language: str(b.language, 40),
    message: str(b.message, 2000),
    reply: str(b.reply, 2000),
  };

  try {
    fs.mkdirSync(path.dirname(FEEDBACK_FILE), { recursive: true });
    fs.appendFileSync(FEEDBACK_FILE, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('feedback write failed:', e?.message || e);
    return res.status(500).json({ error: 'Could not save feedback.' });
  }
  res.json({ ok: true });
});

// Phase 2 DB connectivity check (admin only).
app.get('/api/admin/db-check', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.json(await checkDb());
});

// Quick aggregate view of collected feedback (handy for spotting weak styles/perspectives).
app.get('/api/feedback/summary', (req, res) => {
  let lines = [];
  try {
    lines = fs.readFileSync(FEEDBACK_FILE, 'utf8').split('\n').filter(Boolean);
  } catch {
    return res.json({ total: 0, byStyle: {}, byPerspective: {}, byLanguage: {} });
  }
  const bump = (obj, key, vote) => {
    obj[key] = obj[key] || { useful: 0, 'not-useful': 0, copy: 0, save: 0 };
    if (obj[key][vote] !== undefined) obj[key][vote]++;
  };
  const byStyle = {}, byPerspective = {}, byLanguage = {};
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    bump(byStyle, e.style || '?', e.vote);
    bump(byPerspective, e.perspective || '?', e.vote);
    bump(byLanguage, e.language || '?', e.vote);
  }
  res.json({ total: lines.length, byStyle, byPerspective, byLanguage });
});

// ===== Admin analytics (password protected) =====
function checkAdmin(req, res) {
  if (!ADMIN_PASSWORD) {
    res.status(503).json({ error: 'Admin is not configured. Set ADMIN_PASSWORD in .env and restart.' });
    return false;
  }
  const given = req.get('x-admin-password') || '';
  if (given !== ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Wrong password.' });
    return false;
  }
  return true;
}

// Lets the admin page verify the password before showing the dashboard.
app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Admin is not configured. Set ADMIN_PASSWORD in .env.' });
  if ((req.body?.password || '') !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Wrong password.' });
  res.json({ ok: true });
});

app.get('/api/admin/analytics', (req, res) => {
  if (!checkAdmin(req, res)) return;

  const feedback = readJsonl(FEEDBACK_FILE);
  const generations = readJsonl(GENERATIONS_FILE);

  // feedback aggregates
  const bump = (obj, key, vote) => {
    if (!key) key = '?';
    obj[key] = obj[key] || { useful: 0, 'not-useful': 0, copy: 0, save: 0 };
    if (obj[key][vote] !== undefined) obj[key][vote]++;
  };
  const fbByStyle = {}, fbByLanguage = {}, fbByPerspective = {};
  const voteTotals = { useful: 0, 'not-useful': 0, copy: 0, save: 0 };
  for (const e of feedback) {
    bump(fbByStyle, e.style, e.vote);
    bump(fbByLanguage, e.language, e.vote);
    bump(fbByPerspective, e.perspective, e.vote);
    if (voteTotals[e.vote] !== undefined) voteTotals[e.vote]++;
  }

  // generation aggregates
  const tally = (obj, key) => { if (!key && key !== 0) key = '?'; obj[key] = (obj[key] || 0) + 1; };
  const genByLanguage = {}, genByProvider = {}, genByDay = {};
  let imageGenerations = 0;
  for (const g of generations) {
    tally(genByLanguage, g.language);
    tally(genByProvider, g.provider);
    tally(genByDay, (g.at || '').slice(0, 10));
    if (g.hasImage) imageGenerations++;
  }

  // most recent feedback (newest first), trimmed for display
  const recent = feedback.slice(-25).reverse().map((e) => ({
    at: e.at,
    vote: e.vote,
    style: e.style,
    language: e.language,
    perspective: e.perspective,
    message: (e.message || '').slice(0, 160),
    reply: (e.reply || '').slice(0, 220),
  }));

  res.json({
    totals: {
      generations: generations.length,
      imageGenerations,
      feedbackEvents: feedback.length,
      ...voteTotals,
    },
    feedback: { byStyle: fbByStyle, byLanguage: fbByLanguage, byPerspective: fbByPerspective },
    generations: { byLanguage: genByLanguage, byProvider: genByProvider, byDay: genByDay },
    recent,
    provider: PROVIDER,
    model: ACTIVE_MODEL,
  });
});

app.listen(PORT, () => {
  console.log(`\nAI Reply Assistant running at http://localhost:${PORT}`);
  console.log(`Provider: ${PROVIDER}  |  Model: ${ACTIVE_MODEL}`);
  console.log(`Admin analytics: ${ADMIN_PASSWORD ? 'enabled at /admin.html' : 'DISABLED (set ADMIN_PASSWORD in .env)'}`);
  console.log(`Google login: ${googleAuthConfigured() ? 'configured ✓' : 'OFF (set GOOGLE_CLIENT_ID in .env)'}`);
  checkDb().then((r) =>
    console.log(`Supabase DB: ${r.ok ? 'connected ✓' : 'not ready — ' + r.reason}\n`)
  );
});
