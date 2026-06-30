// ===== Elements =====
const $ = (id) => document.getElementById(id);
const form = $('generator');
const messageEl = $('message');
const charCount = $('charCount');
const clearBtn = $('clearBtn');
const generateBtn = $('generateBtn');
const statusEl = $('status');
const emptyState = $('emptyState');
const resultsWrap = $('resultsWrap');
const resultsEl = $('results');
const resultsTitle = $('resultsTitle');
const searchInput = $('searchInput');
const filterStyle = $('filterStyle');
const sortOrder = $('sortOrder');
const toastEl = $('toast');
const imageInput = $('imageInput');
const attachBtn = $('attachBtn');
const imagePreview = $('imagePreview');
const previewImg = $('previewImg');
const removeImageBtn = $('removeImageBtn');
const urlInput = $('urlInput');
const fetchBtn = $('fetchBtn');
const contextCard = $('contextCard');
const usageCounter = $('usageCounter');
const topupBtn = $('topupBtn');

const STYLE_CLASS = {
  Comedy: 's-funny', 'Mass Hero': 's-mass', Smart: 's-smart', Professional: 's-professional',
  Friendly: 's-friendly', Emotional: 's-emotional', Debate: 's-debate', Savage: 's-savage',
  Meme: 's-meme', News: 's-news',
};

// In-memory list of generated replies (each gets a stable id + timestamp)
let replies = [];
let lastParams = null; // remember message/perspective/language/image for regenerate
let idSeq = 0;
let attachedImage = null; // data URL of the attached image, or null

// ===== Theme =====
(function initTheme() {
  const saved = localStorage.getItem('are.theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  $('themeToggle').textContent = saved === 'dark' ? '🌙' : '☀️';
})();
$('themeToggle').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('are.theme', next);
  $('themeToggle').textContent = next === 'dark' ? '🌙' : '☀️';
});

// ===== Nav (Home is the only active tab in this build) =====
document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const tab = link.dataset.tab;
    if (tab !== 'Home') {
      toast(`“${tab}” is coming in the next update.`);
      return;
    }
    document.querySelectorAll('.nav-link').forEach((l) => l.classList.toggle('active', l === link));
  });
});

// ===== Daily free-reply limit (localStorage, resets at local midnight) =====
const FREE_LIMIT = 10;

function todayStr() {
  const d = new Date(); // local time
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function getUsage() {
  let u;
  try { u = JSON.parse(localStorage.getItem('are.usage') || '{}'); } catch { u = {}; }
  if (u.date !== todayStr()) u = { date: todayStr(), used: 0 }; // new day → reset
  return u;
}
function setUsed(used) {
  const u = { date: todayStr(), used: Math.max(0, used) };
  localStorage.setItem('are.usage', JSON.stringify(u));
  return u;
}
function remaining() {
  return Math.max(0, FREE_LIMIT - getUsage().used);
}
function addUsed(n) {
  setUsed(getUsage().used + n);
  updateUsageUI();
}
function updateUsageUI() {
  const left = remaining();
  usageCounter.textContent = `Free replies today: ${left} / ${FREE_LIMIT} remaining`;
  if (left <= 0) {
    generateBtn.disabled = true;
    generateBtn.title = 'Daily free limit reached';
    topupBtn.classList.remove('hidden');
    setStatus('Daily free limit reached. Please top up to generate more replies.', true);
  } else {
    generateBtn.disabled = false;
    generateBtn.title = '';
    topupBtn.classList.add('hidden');
  }
}

topupBtn.addEventListener('click', () => toast('Top-up feature coming soon.'));

// ===== Toast =====
let toastTimer;
function toast(msg, ms = 2200) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), ms);
}

// ===== Char counter + clear =====
messageEl.addEventListener('input', () => {
  charCount.textContent = `${messageEl.value.length} / 5000 characters`;
});
// Clear the input fields (message, URL, image, context preview). Keeps the option selections.
function clearInputs() {
  messageEl.value = '';
  charCount.textContent = '0 / 5000 characters';
  urlInput.value = '';
  contextCard.classList.add('hidden');
  clearImage();
}
clearBtn.addEventListener('click', () => {
  clearInputs();
  messageEl.focus();
});

// ===== Image attach (file picker + paste) =====
attachBtn.addEventListener('click', () => imageInput.click());
removeImageBtn.addEventListener('click', clearImage);

async function setImageFromFile(file) {
  if (!file || !file.type.startsWith('image/')) return setStatus('Please choose an image file.', true);
  try {
    attachedImage = await fileToResizedDataURL(file);
    previewImg.src = attachedImage;
    imagePreview.classList.remove('hidden');
    attachBtn.textContent = '🖼️ Change image';
    setStatus('');
  } catch {
    setStatus('Could not read that image. Try another file.', true);
  }
}

imageInput.addEventListener('change', async () => {
  const file = imageInput.files?.[0];
  if (file) await setImageFromFile(file);
  imageInput.value = ''; // allow re-selecting the same file later
});

// Paste an image anywhere (Ctrl+V), just like in chat. Text paste still works normally.
document.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items || [];
  for (const it of items) {
    if (it.type && it.type.startsWith('image/')) {
      const file = it.getAsFile();
      if (file) {
        e.preventDefault(); // don't paste the image as junk text
        setImageFromFile(file);
        toast('Image pasted ✓');
        return;
      }
    }
  }
  // no image in clipboard → let the normal text paste happen
});

function clearImage() {
  attachedImage = null;
  previewImg.removeAttribute('src');
  imagePreview.classList.add('hidden');
  attachBtn.textContent = '🖼️ Attach image';
}

// Downscale large images client-side so the upload payload stays small.
function fileToResizedDataURL(file, maxDim = 1280) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (Math.max(width, height) > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ===== Fetch context from a URL =====
fetchBtn.addEventListener('click', fetchContext);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fetchContext(); } });
$('ctxClose').addEventListener('click', () => { contextCard.classList.add('hidden'); });

async function fetchContext() {
  const url = urlInput.value.trim();
  if (!url) return setStatus('Paste a YouTube or Instagram URL first.', true);

  fetchBtn.disabled = true;
  fetchBtn.textContent = 'Fetching…';
  setStatus('');
  try {
    const res = await fetch('/api/fetch-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) { setStatus(data.error || 'Could not fetch context.', true); return; }
    if (data.needsManual) {
      contextCard.classList.add('hidden');
      setStatus(data.message || 'Could not fetch automatically — paste the details manually.', true);
      return;
    }
    renderContext(data);
    // load the compiled context into the message box (editable) so Generate uses it
    messageEl.value = data.contextText || '';
    charCount.textContent = `${messageEl.value.length} / 5000 characters`;
    // auto-select detected language if it's one of our options
    if (data.detectedLanguage) {
      const opt = [...$('language').options].find((o) => o.value === data.detectedLanguage);
      if (opt) $('language').value = data.detectedLanguage;
    }
  } catch {
    setStatus('Network error fetching context.', true);
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.textContent = 'Fetch Context';
  }
}

function renderContext(d) {
  $('ctxPlatform').textContent = d.platform;
  const bits = [];
  if (d.detectedLanguage) bits.push(`Lang: ${d.detectedLanguage}`);
  if (d.detectedTopic) bits.push(`Topic: ${d.detectedTopic}`);
  if (d.limited) bits.push('(limited — add YOUTUBE_API_KEY for full data)');
  $('ctxDetected').textContent = bits.join(' · ');

  $('ctxTitle').textContent = d.title || '(no title)';

  const meta = [];
  if (d.channel) meta.push(d.channel);
  if (d.publishedAt) meta.push(d.publishedAt.slice(0, 10));
  if (d.viewCount) meta.push(`${Number(d.viewCount).toLocaleString()} views`);
  if (d.likeCount) meta.push(`${Number(d.likeCount).toLocaleString()} likes`);
  if (d.commentCount) meta.push(`${Number(d.commentCount).toLocaleString()} comments`);
  $('ctxMeta').textContent = meta.join(' · ');

  $('ctxDesc').textContent = d.description ? d.description.slice(0, 300) + (d.description.length > 300 ? '…' : '') : '';

  const tags = $('ctxHashtags');
  tags.innerHTML = '';
  (d.hashtags || []).forEach((h) => {
    const s = document.createElement('span');
    s.className = 'ctx-tag';
    s.textContent = h;
    tags.appendChild(s);
  });

  const cm = $('ctxComments');
  cm.innerHTML = '';
  if (d.topComments && d.topComments.length) {
    const h = document.createElement('div');
    h.className = 'muted ctx-comments-head';
    h.textContent = 'Top comments';
    cm.appendChild(h);
    d.topComments.slice(0, 5).forEach((c) => {
      const p = document.createElement('div');
      p.className = 'ctx-comment';
      p.textContent = '“' + c + '”';
      cm.appendChild(p);
    });
  }

  contextCard.classList.remove('hidden');
}

// ===== Helpers =====
function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}
function readForm() {
  return {
    message: messageEl.value.trim(),
    image: attachedImage || undefined,
    perspective: document.querySelector('input[name="perspective"]:checked')?.value,
    styles: [...document.querySelectorAll('input[name="style"]:checked')].map((c) => c.value),
    language: $('language').value,
    count: Number($('count').value),
  };
}

// ===== Saved replies (localStorage) =====
function getSaved() {
  try { return JSON.parse(localStorage.getItem('are.saved') || '[]'); } catch { return []; }
}
function isSaved(text) { return getSaved().some((r) => r.text === text); }
function toggleSaved(reply) {
  let saved = getSaved();
  if (saved.some((r) => r.text === reply.text)) {
    saved = saved.filter((r) => r.text !== reply.text);
  } else {
    saved.push({ style: reply.style, perspective: reply.perspective, text: reply.text, at: Date.now() });
  }
  localStorage.setItem('are.saved', JSON.stringify(saved));
  return isSaved(reply.text);
}

function sendFeedback(vote, reply) {
  // fire-and-forget; never block the UI on logging
  const body = {
    vote,
    style: reply.style,
    perspective: reply.perspective,
    language: lastParams?.language || $('language').value,
    message: lastParams?.message || '',
    reply: reply.text,
  };
  fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
}

// ===== Render =====
function styleBadge(style) {
  const span = document.createElement('span');
  span.className = `badge ${STYLE_CLASS[style] || 's-short'}`;
  span.textContent = style;
  return span;
}

function makeCard(reply) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = reply.id;

  const head = document.createElement('div');
  head.className = 'card-head';
  const persp = document.createElement('span');
  persp.className = 'badge persp';
  persp.textContent = reply.perspective;
  head.append(styleBadge(reply.style), persp);

  const text = document.createElement('p');
  text.className = 'card-text tamil';
  text.textContent = reply.text;

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const copyBtn = mkAct('⧉ Copy');
  copyBtn.addEventListener('click', async () => {
    await copyText(reply.text);
    sendFeedback('copy', reply);
    copyBtn.textContent = '✓ Copied';
    copyBtn.classList.add('copied');
    setTimeout(() => { copyBtn.textContent = '⧉ Copy'; copyBtn.classList.remove('copied'); }, 1400);
  });

  const regenBtn = mkAct('↻ Regenerate');
  regenBtn.addEventListener('click', () => regenerate(reply.id, regenBtn));

  const saveBtn = mkAct(isSaved(reply.text) ? '★ Saved' : '☆ Save');
  if (isSaved(reply.text)) saveBtn.classList.add('saved');
  saveBtn.addEventListener('click', () => {
    const now = toggleSaved(reply);
    saveBtn.textContent = now ? '★ Saved' : '☆ Save';
    saveBtn.classList.toggle('saved', now);
    sendFeedback(now ? 'save' : 'unsave', reply);
    toast(now ? 'Saved' : 'Removed from saved');
  });

  const up = mkAct('👍'); up.classList.add('useful', 'spacer');
  const down = mkAct('👎'); down.classList.add('notuseful');
  up.addEventListener('click', () => {
    const nowActive = !up.classList.contains('active');
    up.classList.toggle('active');
    down.classList.remove('active');
    if (nowActive) sendFeedback('useful', reply);
  });
  down.addEventListener('click', () => {
    const nowActive = !down.classList.contains('active');
    down.classList.toggle('active');
    up.classList.remove('active');
    if (nowActive) sendFeedback('not-useful', reply);
  });

  actions.append(copyBtn, regenBtn, saveBtn, up, down);
  card.append(head, text, actions);
  return card;
}
function mkAct(label) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'act'; b.textContent = label;
  return b;
}

function visibleReplies() {
  const q = searchInput.value.trim().toLowerCase();
  const fs = filterStyle.value;
  let list = replies.filter((r) =>
    (!q || r.text.toLowerCase().includes(q)) && (!fs || r.style === fs)
  );
  if (sortOrder.value === 'oldest') list = [...list].sort((a, b) => a.seq - b.seq);
  else if (sortOrder.value === 'newest') list = [...list].sort((a, b) => b.seq - a.seq);
  else if (sortOrder.value === 'style') list = [...list].sort((a, b) => a.style.localeCompare(b.style));
  return list;
}

function renderResults() {
  resultsEl.innerHTML = '';
  const list = visibleReplies();
  if (list.length === 0) {
    resultsEl.innerHTML = '<p class="muted" style="text-align:center;padding:20px">No replies match your search.</p>';
  } else {
    list.forEach((r) => resultsEl.appendChild(makeCard(r)));
  }
  resultsTitle.textContent = `AI Generated Replies (${replies.length})`;
  // refresh style filter options
  const styles = [...new Set(replies.map((r) => r.style))].sort();
  const current = filterStyle.value;
  filterStyle.innerHTML = '<option value="">All Styles</option>' +
    styles.map((s) => `<option value="${s}">${s}</option>`).join('');
  filterStyle.value = current;
}

[searchInput, filterStyle, sortOrder].forEach((el) => el.addEventListener('input', renderResults));

function showResults() { emptyState.classList.add('hidden'); resultsWrap.classList.remove('hidden'); }

function showSkeletons(n) {
  showResults();
  resultsEl.innerHTML = '';
  resultsTitle.textContent = 'Generating…';
  for (let i = 0; i < Math.min(n, 6); i++) {
    const c = document.createElement('div');
    c.className = 'card skeleton';
    resultsEl.appendChild(c);
  }
}

// ===== Generate =====
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const p = readForm();
  if (!p.message && !p.image) return setStatus('Paste a message or attach an image first.', true);
  if (p.styles.length === 0) return setStatus('Select at least one reply style.', true);

  // daily free-limit check (do NOT call the API if it would exceed today's free replies)
  const left = remaining();
  if (left <= 0) { updateUsageUI(); return; }
  if (p.count > left) {
    return setStatus(`You have only ${left} free repl${left === 1 ? 'y' : 'ies'} left today. Please select ${left} or fewer replies, or top up.`, true);
  }

  lastParams = { message: p.message, image: p.image, perspective: p.perspective, language: p.language };
  generateBtn.disabled = true;
  setStatus(`Generating ${p.count} replies…`);
  showSkeletons(p.count);

  try {
    const res = await fetch('/api/generate-replies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    const data = await res.json();
    if (!res.ok) { setStatus(data.error || 'Something went wrong.', true); resultsEl.innerHTML = ''; resultsTitle.textContent = 'AI Generated Replies (0)'; return; }

    replies = data.replies.map((r) => ({ ...r, id: ++idSeq, seq: idSeq }));
    renderResults();
    addUsed(data.replies.length); // count actual replies generated toward the daily limit
    clearInputs(); // clear the message / URL / image after generating
    if (remaining() > 0) setStatus('');
  } catch {
    setStatus('Network error — is the server running?', true);
    resultsEl.innerHTML = '';
  } finally {
    updateUsageUI();
  }
});

// ===== Regenerate one card =====
async function regenerate(id, btn) {
  const idx = replies.findIndex((r) => r.id === id);
  if (idx === -1 || !lastParams) return;
  if (remaining() < 1) { toast('Daily free limit reached. Top up to generate more.'); return; }
  const original = btn.textContent;
  btn.textContent = '↻ …';
  btn.disabled = true;
  try {
    const res = await fetch('/api/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...lastParams, style: replies[idx].style }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Regenerate failed'); return; }
    replies[idx] = { ...replies[idx], text: data.reply.text, perspective: data.reply.perspective };
    renderResults();
    addUsed(1); // a regenerated reply counts toward the daily limit
  } catch {
    toast('Network error');
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
}

// initialise the daily usage counter on load
updateUsageUI();

// ===== Bulk actions =====
$('copyAll').addEventListener('click', async () => {
  const text = visibleReplies().map((r) => `[${r.style} • ${r.perspective}]\n${r.text}`).join('\n\n');
  if (!text) return;
  await copyText(text);
  toast('All replies copied');
});
$('exportTxt').addEventListener('click', () => {
  const text = visibleReplies().map((r) => `[${r.style} • ${r.perspective}]\n${r.text}`).join('\n\n');
  download('replies.txt', text, 'text/plain');
});
$('exportCsv').addEventListener('click', () => {
  const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [['Style', 'Perspective', 'Reply'], ...visibleReplies().map((r) => [r.style, r.perspective, r.text])];
  download('replies.csv', rows.map((r) => r.map(esc).join(',')).join('\n'), 'text/csv');
});
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ===== Google login + session (Phase 2) =====
// Degrades gracefully: if the server has no GOOGLE_CLIENT_ID / DB, the login UI stays hidden
// and the app behaves exactly like Phase 1 (localStorage usage).
let currentUser = null; // null when signed out; set to the public user object when signed in

// Capture an invite code from /invite/<CODE> → /?ref=CODE and remember it across the sign-in.
function captureRefCode() {
  const ref = new URLSearchParams(location.search).get('ref');
  if (ref) {
    localStorage.setItem('are.ref', ref);
    // tidy the URL so the code isn't left lying around
    history.replaceState(null, '', location.pathname);
  }
  return localStorage.getItem('are.ref') || null;
}

function showSignedIn(user) {
  currentUser = user;
  $('googleSignin').hidden = true;
  $('googleSignin').style.display = 'none';
  const chip = $('userChip');
  chip.hidden = false;
  $('userName').textContent = user.name || user.email || 'Account';
  const av = $('userAvatar');
  if (user.picture) { av.src = user.picture; av.style.display = ''; }
  else av.style.display = 'none';
}

function showSignedOut() {
  currentUser = null;
  $('userChip').hidden = true;
  const slot = $('googleSignin');
  slot.hidden = false;
  slot.style.display = '';
}

async function handleGoogleCredential(response) {
  try {
    const refCode = localStorage.getItem('are.ref') || null;
    const r = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential, refCode }),
    });
    const data = await r.json();
    if (!r.ok) { toast(data.error || 'Sign-in failed.', 3200); return; }
    localStorage.removeItem('are.ref'); // referral consumed (or not applicable) — don't reuse
    showSignedIn(data.user);
    if (data.isNew) {
      toast(`🎉 Welcome! You have received ${data.user.bonusBalance} free AI replies.`, 4200);
    } else {
      toast(`Signed in as ${data.user.name || data.user.email}`);
    }
  } catch {
    toast('Could not reach the server for sign-in.', 3200);
  }
}

async function signOut() {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  showSignedOut();
  toast('Signed out');
}
$('signOutBtn').addEventListener('click', signOut);

// Wait for the GIS script (loaded async) before rendering the button.
function whenGisReady(cb, tries = 40) {
  if (window.google?.accounts?.id) return cb();
  if (tries <= 0) return;
  setTimeout(() => whenGisReady(cb, tries - 1), 150);
}

async function initAuth() {
  captureRefCode();
  let cfg;
  try {
    cfg = await (await fetch('/api/config')).json();
  } catch {
    return; // server unreachable — stay in Phase 1 mode
  }
  if (!cfg.authEnabled || !cfg.googleClientId) {
    // Login not configured on the server: keep the slot hidden, app works as before.
    $('googleSignin').style.display = 'none';
    return;
  }

  // Restore an existing session first.
  try {
    const me = await (await fetch('/api/auth/me')).json();
    if (me.user) showSignedIn(me.user);
  } catch {}

  whenGisReady(() => {
    google.accounts.id.initialize({
      client_id: cfg.googleClientId,
      callback: handleGoogleCredential,
    });
    if (!currentUser) {
      showSignedOut();
      google.accounts.id.renderButton($('googleSignin'), {
        theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'filled_black' : 'outline',
        size: 'medium',
        type: 'standard',
        shape: 'pill',
        text: 'signin_with',
      });
    }
  });
}

initAuth();
