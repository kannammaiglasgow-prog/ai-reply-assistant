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
let outputLangPicker = null; // set once /i18n/output-languages.json loads (100+ reply languages)

const STYLE_CLASS = {
  Friend: 's-friend', 'Casual Chat': 's-casual', Angry: 's-angry', Comedy: 's-funny',
  Sarcastic: 's-sarcastic', Savage: 's-savage', Troll: 's-troll', Respectful: 's-respectful',
  Professional: 's-professional', Romantic: 's-romantic', Cute: 's-cute', Emotional: 's-emotional',
  Motivational: 's-motivational', 'Mass Hero': 's-mass', 'Cinema Dialogue': 's-cinema',
  Villain: 's-villain', Mystery: 's-mystery', 'Punch Dialogue': 's-punch',
  'SMS Short': 's-sms', 'AI Robot': 's-airobot',
};

// Canonical style key (sent to/from the API) -> i18n key, so the badge/checkbox label is
// translated for display while the value the server sees never changes.
const STYLE_I18N_KEY = {
  Friend: 'step5.styleFriend', 'Casual Chat': 'step5.styleCasualChat', Angry: 'step5.styleAngry',
  Comedy: 'step5.styleComedy', Sarcastic: 'step5.styleSarcastic', Savage: 'step5.styleSavage',
  Troll: 'step5.styleTroll', Respectful: 'step5.styleRespectful', Professional: 'step5.styleProfessional',
  Romantic: 'step5.styleRomantic', Cute: 'step5.styleCute', Emotional: 'step5.styleEmotional',
  Motivational: 'step5.styleMotivational', 'Mass Hero': 'step5.styleMassHero',
  'Cinema Dialogue': 'step5.styleCinemaDialogue', Villain: 'step5.styleVillain', Mystery: 'step5.styleMystery',
  'Punch Dialogue': 'step5.stylePunchDialogue', 'SMS Short': 'step5.styleSmsShort', 'AI Robot': 'step5.styleAiRobot',
};
function styleLabel(style) {
  const key = STYLE_I18N_KEY[style];
  return key ? i18n.t(key) : style;
}

// Nav tab data-tab value -> i18n key, used to translate the "coming soon" toast.
const NAV_I18N_KEY = { Recent: 'nav.recent', 'Saved Replies': 'nav.saved', Settings: 'nav.settings' };

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

// ===== Nav (placeholder tabs removed from the topbar; handler kept for when pages ship) =====
document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const tab = link.dataset.tab;
    if (tab !== 'Home') {
      toast(i18n.t('nav.comingSoon', { name: i18n.t(NAV_I18N_KEY[tab] || 'nav.home') }));
      return;
    }
    document.querySelectorAll('.nav-link').forEach((l) => l.classList.toggle('active', l === link));
  });
});

// ===== Style chips: show the popular first row, expand for all 20 =====
$('moreStylesBtn').addEventListener('click', () => {
  const collapsed = $('styles').classList.toggle('styles-collapsed');
  const key = collapsed ? 'step5.showMore' : 'step5.showLess';
  $('moreStylesBtn').setAttribute('data-i18n', key); // keep the label right across language switches
  $('moreStylesBtn').textContent = i18n.t(key);
});

// ===== Empty-state example chips: one tap fills the message box =====
document.querySelectorAll('.example-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    messageEl.value = i18n.t(chip.dataset.example);
    charCount.textContent = i18n.t('step1.charCount', { count: messageEl.value.length, max: 5000 });
    messageEl.focus();
    // Pre-select a friendly default style if none picked yet, so Generate works in one tap.
    if (!document.querySelector('input[name="style"]:checked')) {
      const friend = document.querySelector('input[name="style"][value="Friend"]');
      if (friend) friend.checked = true;
    }
  });
});

// ===== Daily free-reply limit (localStorage, resets at local midnight) =====
const FREE_LIMIT = 1000;

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
  usageCounter.textContent = i18n.t('generate.usageCounter', { left, limit: FREE_LIMIT });
  if (left <= 0) {
    generateBtn.disabled = true;
    generateBtn.title = i18n.t('generate.dailyLimitTitle');
    topupBtn.classList.remove('hidden');
    setStatus(i18n.t('generate.dailyLimitStatus'), true);
  } else {
    generateBtn.disabled = false;
    generateBtn.title = '';
    topupBtn.classList.add('hidden');
  }
}

// ===== Token system (Phase A) =====
// When the server has Google login + a database, it enforces tokens/guest limits server-side.
// Until then, appConfig.tokenSystem is false and everything above (localStorage limit) is used.
let appConfig = {
  tokenSystem: false,
  guestFreeGenerations: 1,
  guestTrialEnabled: true,
  tokenCostPerGeneration: 1,
  referralEnabled: false,
};
let guestRemaining = null; // token mode, signed-out: free tries left (null = not yet known)

// One entry point that renders whichever counter applies to the current mode.
function refreshUsageUI() {
  if (appConfig.tokenSystem) updateTokenUI();
  else updateUsageUI();
}

function updateTokenUI() {
  const badge = $('tokenBadge');
  generateBtn.disabled = false;
  generateBtn.title = '';
  $('referralBtn').hidden = !(currentUser && appConfig.referralEnabled);
  if (currentUser) {
    const tokens = currentUser.tokens ?? currentUser.bonusBalance ?? 0;
    badge.hidden = false;
    $('tokenBalance').textContent = tokens;
    usageCounter.textContent = i18n.t('generate.tokenBalance', { n: tokens });
    topupBtn.classList.remove('hidden'); // acts as the "Upgrade" button when signed in
    if (tokens <= 0) setStatus(i18n.t('generate.outOfTokens'), true);
  } else {
    badge.hidden = true;
    const left = guestRemaining == null ? appConfig.guestFreeGenerations : guestRemaining;
    usageCounter.textContent = appConfig.guestTrialEnabled
      ? i18n.t('generate.guestLeft', { left })
      : i18n.t('generate.loginToStart');
    topupBtn.classList.add('hidden');
  }
}

// ---- Modals ----
function openLoginModal(message) {
  if (message) $('loginModalMsg').textContent = message;
  $('loginModal').classList.remove('hidden');
}
function closeLoginModal() { $('loginModal').classList.add('hidden'); }
function openUpgradeModal() { $('upgradeModal').classList.remove('hidden'); }
function closeUpgradeModal() { $('upgradeModal').classList.add('hidden'); }

$('loginModalClose').addEventListener('click', closeLoginModal);
$('upgradeModalClose').addEventListener('click', closeUpgradeModal);
$('upgradeClose2').addEventListener('click', closeUpgradeModal);
$('upgradeBtn').addEventListener('click', () => { closeUpgradeModal(); openPlansModal(); });
// Click the dim backdrop (outside the card) to dismiss.
$('loginModal').addEventListener('click', (e) => { if (e.target === $('loginModal')) closeLoginModal(); });
$('upgradeModal').addEventListener('click', (e) => { if (e.target === $('upgradeModal')) closeUpgradeModal(); });

topupBtn.addEventListener('click', () => {
  if (appConfig.tokenSystem) openUpgradeModal();
  else toast(i18n.t('generate.topUpComingSoon'));
});

// ---- Referral (Refer & Earn) modal ----
$('referralModalClose').addEventListener('click', () => $('referralModal').classList.add('hidden'));
$('referralModal').addEventListener('click', (e) => {
  if (e.target === $('referralModal')) $('referralModal').classList.add('hidden');
});

async function openReferralModal() {
  $('referralModal').classList.remove('hidden');
  $('referralLink').value = '…';
  try {
    const r = await fetch('/api/referrals');
    const d = await r.json();
    if (!r.ok) {
      if (d.needsLogin) { $('referralModal').classList.add('hidden'); openLoginModal(d.error); }
      else toast(d.error || i18n.t('errors.somethingWrong'));
      return;
    }
    $('referralLink').value = d.link || '';
    $('referralRewardLine').textContent = i18n.t('referral.rewardLine', { n: d.reward });
    $('refInvited').textContent = d.invited;
    $('refPending').textContent = d.pending;
    $('refRewarded').textContent = d.rewarded;
    $('refEarned').textContent = d.tokensEarned;
  } catch {
    toast(i18n.t('toast.networkError'));
  }
}
$('referralBtn').addEventListener('click', openReferralModal);

$('copyReferralBtn').addEventListener('click', async () => {
  const link = $('referralLink').value;
  if (!link || link === '…') return;
  await copyText(link);
  toast(i18n.t('referral.copied'));
});

// ---- Membership plans modal (Phase C) ----
$('plansModalClose').addEventListener('click', () => $('plansModal').classList.add('hidden'));
$('plansModal').addEventListener('click', (e) => {
  if (e.target === $('plansModal')) $('plansModal').classList.add('hidden');
});

async function openPlansModal() {
  $('plansModal').classList.remove('hidden');
  const grid = $('plansGrid');
  grid.innerHTML = `<p class="muted">${i18n.t('plans.loading')}</p>`;
  try {
    const r = await fetch('/api/plans');
    const d = await r.json();
    if (!r.ok || !d.enabled || !d.plans.length) {
      grid.innerHTML = `<p class="muted">${i18n.t('plans.unavailable')}</p>`;
      return;
    }
    grid.innerHTML = '';
    d.plans.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'plan-card';
      const tokensLine = p.monthlyTokens == null
        ? i18n.t('plans.unlimited')
        : i18n.t('plans.tokensPerMonth', { n: p.monthlyTokens });
      card.innerHTML = `
        <h4>${p.name}</h4>
        <div class="plan-price">${p.monthlyPrice === 0 ? i18n.t('plans.free') : '$' + p.monthlyPrice.toFixed(2)}<span class="muted">${p.monthlyPrice === 0 ? '' : i18n.t('plans.perMonth')}</span></div>
        <p class="muted plan-tokens">${tokensLine}</p>`;
      const btn = document.createElement('button');
      btn.className = 'primary-btn plan-choose';
      btn.textContent = p.monthlyPrice === 0 ? i18n.t('plans.currentFree') : i18n.t('plans.choose');
      btn.disabled = p.monthlyPrice === 0;
      btn.addEventListener('click', () => choosePlan(p, btn));
      card.appendChild(btn);
      grid.appendChild(card);
    });
  } catch {
    grid.innerHTML = `<p class="muted">${i18n.t('toast.networkError')}</p>`;
  }
}

async function choosePlan(plan, btn) {
  if (!currentUser) {
    $('plansModal').classList.add('hidden');
    openLoginModal(i18n.t('login.message'));
    return;
  }
  btn.disabled = true;
  try {
    const r = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId: plan.id }),
    });
    const d = await r.json();
    if (d.needsLogin) { $('plansModal').classList.add('hidden'); openLoginModal(d.error); return; }
    // Until Stripe is wired, the server answers with a clear "coming soon".
    toast(d.error || i18n.t('plans.paymentSoon'), 3600);
  } catch {
    toast(i18n.t('toast.networkError'));
  } finally {
    btn.disabled = false;
  }
}

// ---- User dashboard modal (Phase C) ----
$('dashboardModalClose').addEventListener('click', () => $('dashboardModal').classList.add('hidden'));
$('dashboardModal').addEventListener('click', (e) => {
  if (e.target === $('dashboardModal')) $('dashboardModal').classList.add('hidden');
});
$('dashboardBtn').addEventListener('click', () => { if (appConfig.tokenSystem) openDashboard(); });
$('dashUpgradeBtn').addEventListener('click', () => {
  $('dashboardModal').classList.add('hidden');
  openPlansModal();
});
$('dashCopyRefBtn').addEventListener('click', async () => {
  const link = $('dashRefLink').value;
  if (!link || link === '…') return;
  await copyText(link);
  toast(i18n.t('referral.copied'));
});

async function openDashboard() {
  $('dashboardModal').classList.remove('hidden');
  try {
    const r = await fetch('/api/me/summary');
    const d = await r.json();
    if (!r.ok) {
      $('dashboardModal').classList.add('hidden');
      if (d.needsLogin) openLoginModal(d.error);
      else toast(d.error || i18n.t('errors.somethingWrong'));
      return;
    }
    if (typeof d.tokens === 'number' && currentUser) { currentUser.tokens = d.tokens; refreshUsageUI(); }
    const av = $('dashAvatar');
    if (d.user.picture) { av.src = d.user.picture; av.style.display = ''; } else av.style.display = 'none';
    $('dashName').textContent = d.user.name || d.user.email;
    $('dashEmail').textContent = d.user.email;
    $('dashTokens').textContent = d.tokens;
    $('dashPlan').textContent = d.plan.name;
    $('dashPayStatus').textContent = d.paymentStatus
      ? `${i18n.t('dashboard.currentPlan')} · ${d.paymentStatus}`
      : i18n.t('dashboard.currentPlan');
    $('dashRefEarned').textContent = d.referral.tokensEarned;
    $('dashRefLink').value = d.referral.link || '';
    renderDashHistory(d.usage || []);
  } catch {
    $('dashboardModal').classList.add('hidden');
    toast(i18n.t('toast.networkError'));
  }
}

function renderDashHistory(rows) {
  const wrap = $('dashHistory');
  wrap.innerHTML = '';
  if (!rows.length) {
    wrap.innerHTML = `<p class="muted">${i18n.t('dashboard.noUsage')}</p>`;
    return;
  }
  rows.forEach((u) => {
    const row = document.createElement('div');
    row.className = 'dash-history-row';
    const when = new Date(u.created_at).toLocaleString();
    row.innerHTML = `
      <span class="dash-h-when muted">${when}</span>
      <span class="dash-h-what">${u.action === 'regenerate' ? '↻' : '⚡'} ${u.replies} ${u.language || ''}</span>
      <span class="dash-h-cost">−${u.tokens_spent} 🎟️</span>`;
    wrap.appendChild(row);
  });
}

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
  charCount.textContent = i18n.t('step1.charCount', { count: messageEl.value.length, max: 5000 });
});
// Clear the input fields (message, URL, image, context preview). Keeps the option selections.
function clearInputs() {
  messageEl.value = '';
  charCount.textContent = i18n.t('step1.charCount', { count: 0, max: 5000 });
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
  if (!file || !file.type.startsWith('image/')) return setStatus(i18n.t('errors.chooseImageFile'), true);
  try {
    attachedImage = await fileToResizedDataURL(file);
    previewImg.src = attachedImage;
    imagePreview.classList.remove('hidden');
    attachBtn.textContent = i18n.t('step1.changeImage');
    setStatus('');
  } catch {
    setStatus(i18n.t('errors.couldNotReadImage'), true);
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
        toast(i18n.t('toast.imagePasted'));
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
  attachBtn.textContent = i18n.t('step1.attachImage');
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
  if (!url) return setStatus(i18n.t('errors.pasteUrl'), true);

  fetchBtn.disabled = true;
  fetchBtn.textContent = i18n.t('step1.fetching');
  setStatus('');
  try {
    const res = await fetch('/api/fetch-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) { setStatus(data.error || i18n.t('errors.couldNotFetchContext'), true); return; }
    if (data.needsManual) {
      contextCard.classList.add('hidden');
      setStatus(data.message || i18n.t('errors.couldNotFetchAutoManual'), true);
      return;
    }
    renderContext(data);
    // load the compiled context into the message box (editable) so Generate uses it
    messageEl.value = data.contextText || '';
    charCount.textContent = i18n.t('step1.charCount', { count: messageEl.value.length, max: 5000 });
    // auto-select detected language if it's one of our 100+ options
    if (data.detectedLanguage) {
      const opt = [...$('language').options].find((o) => o.value === data.detectedLanguage);
      if (opt) {
        $('language').value = data.detectedLanguage;
        outputLangPicker?.setValue(data.detectedLanguage);
        localStorage.setItem('are.outputLang', data.detectedLanguage);
      }
    }
  } catch {
    setStatus(i18n.t('errors.networkErrorContext'), true);
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.textContent = i18n.t('step1.fetchContext');
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
    count: Number(document.querySelector('input[name="count"]:checked')?.value || 1),
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
  span.textContent = styleLabel(style);
  return span;
}

function makeCard(reply) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = reply.id;

  const head = document.createElement('div');
  head.className = 'card-head';
  const PERSP_I18N_KEY = { Supporter: 'step4.supporter', Opposition: 'step4.opposition', Neutral: 'step4.neutral' };
  const persp = document.createElement('span');
  persp.className = 'badge persp';
  persp.textContent = i18n.t(PERSP_I18N_KEY[reply.perspective] || 'step4.neutral');
  head.append(styleBadge(reply.style), persp);

  const text = document.createElement('p');
  text.className = 'card-text tamil';
  text.textContent = reply.text;

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const copyBtn = mkAct(i18n.t('card.copy'));
  copyBtn.addEventListener('click', async () => {
    await copyText(reply.text);
    sendFeedback('copy', reply);
    copyBtn.textContent = i18n.t('card.copied');
    copyBtn.classList.add('copied');
    setTimeout(() => { copyBtn.textContent = i18n.t('card.copy'); copyBtn.classList.remove('copied'); }, 1400);
  });

  const regenBtn = mkAct(i18n.t('card.regenerate'));
  regenBtn.addEventListener('click', () => regenerate(reply.id, regenBtn));

  const saveBtn = mkAct(isSaved(reply.text) ? i18n.t('card.saved') : i18n.t('card.save'));
  if (isSaved(reply.text)) saveBtn.classList.add('saved');
  saveBtn.addEventListener('click', () => {
    const now = toggleSaved(reply);
    saveBtn.textContent = now ? i18n.t('card.saved') : i18n.t('card.save');
    saveBtn.classList.toggle('saved', now);
    sendFeedback(now ? 'save' : 'unsave', reply);
    toast(now ? i18n.t('toast.saved') : i18n.t('toast.removedFromSaved'));
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
    resultsEl.innerHTML = `<p class="muted" style="text-align:center;padding:20px">${i18n.t('results.noMatch')}</p>`;
  } else {
    list.forEach((r) => resultsEl.appendChild(makeCard(r)));
  }
  resultsTitle.textContent = i18n.t('results.titleTemplate', { count: replies.length });
  // refresh style filter options
  const styles = [...new Set(replies.map((r) => r.style))].sort();
  const current = filterStyle.value;
  filterStyle.innerHTML = `<option value="">${i18n.t('results.allStyles')}</option>` +
    styles.map((s) => `<option value="${s}">${styleLabel(s)}</option>`).join('');
  filterStyle.value = current;
}

[searchInput, filterStyle, sortOrder].forEach((el) => el.addEventListener('input', renderResults));

function showResults() { emptyState.classList.add('hidden'); resultsWrap.classList.remove('hidden'); }

function showSkeletons(n) {
  showResults();
  resultsEl.innerHTML = '';
  resultsTitle.textContent = i18n.t('results.generating');
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
  if (!p.message && !p.image) return setStatus(i18n.t('errors.pasteMessageOrImage'), true);
  if (p.styles.length === 0) return setStatus(i18n.t('errors.selectStyle'), true);

  if (!appConfig.tokenSystem) {
    // Legacy (Phase-1) localStorage daily free-limit check.
    const left = remaining();
    if (left <= 0) { updateUsageUI(); return; }
    if (p.count > left) {
      return setStatus(i18n.t(left === 1 ? 'errors.onlyLeftOne' : 'errors.onlyLeftMany', { left }), true);
    }
  } else if (!currentUser) {
    // Token mode, guest: if no free tries remain, ask to log in before spending an API call.
    const left = guestRemaining == null ? appConfig.guestFreeGenerations : guestRemaining;
    if (!appConfig.guestTrialEnabled || left < p.count) {
      return openLoginModal(i18n.t('login.message'));
    }
  }

  lastParams = { message: p.message, image: p.image, perspective: p.perspective, language: p.language };
  generateBtn.disabled = true;
  setStatus(i18n.t('generate.generatingCount', { count: p.count }));
  showSkeletons(p.count);

  try {
    const res = await fetch('/api/generate-replies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    const data = await res.json();
    if (!res.ok) {
      resultsEl.innerHTML = '';
      resultsTitle.textContent = i18n.t('results.titleTemplate', { count: 0 });
      if (data.needsLogin) { openLoginModal(data.error); setStatus(''); return; }
      if (data.needsTokens) {
        if (typeof data.tokenBalance === 'number' && currentUser) currentUser.tokens = data.tokenBalance;
        openUpgradeModal(); setStatus(''); refreshUsageUI(); return;
      }
      setStatus(data.error || i18n.t('errors.somethingWrong'), true);
      return;
    }

    replies = data.replies.map((r) => ({ ...r, id: ++idSeq, seq: idSeq }));
    renderResults();
    if (appConfig.tokenSystem) {
      if (typeof data.tokenBalance === 'number' && currentUser) currentUser.tokens = data.tokenBalance;
      if (typeof data.guestRemaining === 'number') guestRemaining = data.guestRemaining;
    } else {
      addUsed(data.replies.length); // count actual replies generated toward the daily limit
    }
    clearInputs(); // clear the message / URL / image after generating
    setStatus('');
  } catch {
    setStatus(i18n.t('errors.networkErrorGenerate'), true);
    resultsEl.innerHTML = '';
  } finally {
    refreshUsageUI();
  }
});

// ===== Regenerate one card =====
async function regenerate(id, btn) {
  const idx = replies.findIndex((r) => r.id === id);
  if (idx === -1 || !lastParams) return;
  if (!appConfig.tokenSystem && remaining() < 1) { toast(i18n.t('toast.dailyLimitReached')); return; }
  if (appConfig.tokenSystem && !currentUser) {
    const left = guestRemaining == null ? appConfig.guestFreeGenerations : guestRemaining;
    if (!appConfig.guestTrialEnabled || left < 1) { openLoginModal(i18n.t('login.message')); return; }
  }
  const original = btn.textContent;
  btn.textContent = i18n.t('card.regenerating');
  btn.disabled = true;
  try {
    const res = await fetch('/api/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...lastParams, style: replies[idx].style }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.needsLogin) { openLoginModal(data.error); return; }
      if (data.needsTokens) { openUpgradeModal(); return; }
      toast(data.error || i18n.t('toast.regenerateFailed'));
      return;
    }
    replies[idx] = { ...replies[idx], text: data.reply.text, perspective: data.reply.perspective };
    renderResults();
    if (appConfig.tokenSystem) {
      if (typeof data.tokenBalance === 'number' && currentUser) currentUser.tokens = data.tokenBalance;
      if (typeof data.guestRemaining === 'number') guestRemaining = data.guestRemaining;
      refreshUsageUI();
    } else {
      addUsed(1); // a regenerated reply counts toward the daily limit
    }
  } catch {
    toast(i18n.t('toast.networkError'));
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
}

// initialise the usage counter on load
refreshUsageUI();

// ===== Bulk actions =====
$('copyAll').addEventListener('click', async () => {
  const text = visibleReplies().map((r) => `[${r.style} • ${r.perspective}]\n${r.text}`).join('\n\n');
  if (!text) return;
  await copyText(text);
  toast(i18n.t('toast.allRepliesCopied'));
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
  closeLoginModal();
  refreshUsageUI();
}

function showSignedOut() {
  currentUser = null;
  $('userChip').hidden = true;
  const slot = $('googleSignin');
  slot.hidden = false;
  slot.style.display = '';
  refreshUsageUI();
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
    if (!r.ok) { toast(data.error || i18n.t('toast.signInFailed'), 3200); return; }
    localStorage.removeItem('are.ref'); // referral consumed (or not applicable) — don't reuse
    showSignedIn(data.user);
    if (data.isNew) {
      toast(i18n.t('toast.welcomeBonus', { n: data.user.bonusBalance }), 4200);
    } else {
      toast(i18n.t('toast.signedInAs', { name: data.user.name || data.user.email }));
    }
  } catch {
    toast(i18n.t('toast.couldNotReachServer'), 3200);
  }
}

async function signOut() {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  showSignedOut();
  toast(i18n.t('toast.signedOut'));
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

  // Token system is live — adopt the server's admin-configured guest allowance.
  appConfig = {
    tokenSystem: !!cfg.tokenSystem,
    guestFreeGenerations: cfg.guestFreeGenerations ?? 1,
    guestTrialEnabled: cfg.guestTrialEnabled ?? true,
    tokenCostPerGeneration: cfg.tokenCostPerGeneration ?? 1,
    referralEnabled: !!cfg.referralEnabled,
  };

  // Restore an existing session first.
  try {
    const me = await (await fetch('/api/auth/me')).json();
    if (me.user) showSignedIn(me.user);
  } catch {}
  refreshUsageUI();

  whenGisReady(() => {
    google.accounts.id.initialize({
      client_id: cfg.googleClientId,
      callback: handleGoogleCredential,
    });
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (!currentUser) {
      showSignedOut();
      google.accounts.id.renderButton($('googleSignin'), {
        theme: dark ? 'filled_black' : 'outline',
        size: 'medium',
        type: 'standard',
        shape: 'pill',
        text: 'signin_with',
      });
    }
    // Also render a (larger) button inside the login modal shown at the guest limit.
    const modalSlot = $('loginModalGoogle');
    if (modalSlot) {
      modalSlot.innerHTML = '';
      google.accounts.id.renderButton(modalSlot, {
        theme: dark ? 'filled_black' : 'outline',
        size: 'large',
        type: 'standard',
        shape: 'pill',
        text: 'continue_with',
      });
    }
  });
}

initAuth();

// ===== Re-render dynamic (JS-generated) text whenever the interface language changes =====
// Static HTML text (data-i18n attributes) is handled by i18n.js itself; this covers the pieces
// app.js writes directly: usage counter, char counter, attach-image button, and any already-
// rendered result cards / style filter (renderResults() rebuilds them with translated labels).
i18n.onChange(() => {
  refreshUsageUI();
  charCount.textContent = i18n.t('step1.charCount', { count: messageEl.value.length, max: 5000 });
  attachBtn.textContent = attachedImage ? i18n.t('step1.changeImage') : i18n.t('step1.attachImage');
  if (!resultsWrap.classList.contains('hidden')) renderResults();
});

// ===== Language pickers (100+ languages each; two fully independent selections) =====
// Interface language (window.i18n, persisted as are.uiLang) waits for i18n.js to finish loading
// languages.json so the picker shows real flags/native names instead of the single-entry fallback.
i18n.ready.then(() => {
  const uiPicker = createLangPicker($('uiLanguagePicker'), {
    items: i18n.getLanguages(),
    valueKey: 'code',
    initialValue: i18n.getLanguage(),
    onSelect: (item) => i18n.setLanguage(item.code),
    searchPlaceholder: i18n.t('langPicker.searchPlaceholder'),
    buttonTitle: i18n.t('langPicker.uiLanguageTitle'),
    popularLabel: i18n.t('langPicker.popular'),
    allLabel: i18n.t('langPicker.allLanguages'),
    noMatchLabel: i18n.t('langPicker.noMatches'),
  });
  // Re-translate both pickers' own chrome (search placeholder, group labels) on every switch.
  i18n.onChange(() => {
    const labels = {
      searchPlaceholder: i18n.t('langPicker.searchPlaceholder'),
      popularLabel: i18n.t('langPicker.popular'),
      allLabel: i18n.t('langPicker.allLanguages'),
      noMatchLabel: i18n.t('langPicker.noMatches'),
    };
    uiPicker.setLabels({ ...labels, buttonTitle: i18n.t('langPicker.uiLanguageTitle') });
    outputLangPicker?.setLabels({ ...labels, buttonTitle: i18n.t('langPicker.outputLanguageTitle') });
  });
});

// Reply output language (what the AI writes replies in) — separate data file, separate
// localStorage key (are.outputLang), independent of the interface language above.
(async function initOutputLanguagePicker() {
  let items;
  try {
    const [data] = await Promise.all([
      (await fetch('/i18n/output-languages.json')).json(),
      i18n.ready, // wait so the picker's own chrome (search/labels) is translated from the start
    ]);
    items = data;
  } catch {
    return; // picker just won't render; the hidden <select> still has no options either way
  }
  const hiddenSelect = $('language');
  hiddenSelect.innerHTML = items.map((l) => `<option value="${l.name}">${l.name}</option>`).join('');
  const saved = localStorage.getItem('are.outputLang');
  const initial = items.some((l) => l.name === saved) ? saved : 'Tamil';
  hiddenSelect.value = initial;

  outputLangPicker = createLangPicker($('outputLanguagePicker'), {
    items,
    valueKey: 'name',
    initialValue: initial,
    onSelect: (item) => {
      hiddenSelect.value = item.name;
      localStorage.setItem('are.outputLang', item.name);
    },
    searchPlaceholder: i18n.t('langPicker.searchPlaceholder'),
    buttonTitle: i18n.t('langPicker.outputLanguageTitle'),
    popularLabel: i18n.t('langPicker.popular'),
    allLabel: i18n.t('langPicker.allLanguages'),
    noMatchLabel: i18n.t('langPicker.noMatches'),
  });
})();
