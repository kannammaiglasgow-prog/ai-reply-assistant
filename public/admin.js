const $ = (id) => document.getElementById(id);
const gate = $('gate');
const dashboard = $('dashboard');
const loginForm = $('loginForm');
const loginError = $('loginError');
const logoutBtn = $('logoutBtn');

// ===== Theme (shared key with the main app) =====
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

// ===== Usage controls (this browser's daily free-limit, shared localStorage key with the app) =====
const FREE_LIMIT = 1000;
function renderUsageState() {
  let u = {};
  try { u = JSON.parse(localStorage.getItem('are.usage') || '{}'); } catch {}
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
  const used = u.date === today ? (u.used || 0) : 0;
  $('usageState').textContent = `This browser today: ${used} used · ${Math.max(0, FREE_LIMIT - used)} / ${FREE_LIMIT} remaining`;
}
$('resetDailyBtn').addEventListener('click', () => {
  localStorage.removeItem('are.usage');
  renderUsageState();
  $('resetMsg').textContent = '✓ Daily usage reset for this browser.';
  setTimeout(() => { $('resetMsg').textContent = ''; }, 2500);
});

// ===== Auth =====
function getPw() { return sessionStorage.getItem('are.admin') || ''; }

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  const password = $('password').value;
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) { loginError.textContent = data.error || 'Login failed.'; return; }
    sessionStorage.setItem('are.admin', password);
    showDashboard();
  } catch {
    loginError.textContent = 'Network error.';
  }
});

logoutBtn.addEventListener('click', () => {
  sessionStorage.removeItem('are.admin');
  dashboard.classList.add('hidden');
  logoutBtn.classList.add('hidden');
  gate.classList.remove('hidden');
  $('password').value = '';
});

async function showDashboard() {
  const res = await fetch('/api/admin/analytics', { headers: { 'x-admin-password': getPw() } });
  if (res.status === 401) { // stale/wrong password
    sessionStorage.removeItem('are.admin');
    gate.classList.remove('hidden');
    return;
  }
  const data = await res.json();
  if (!res.ok) { loginError.textContent = data.error || 'Failed to load.'; return; }
  gate.classList.add('hidden');
  dashboard.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');
  render(data);
  renderUsageState();
  loadSettings();
  loadPlans();
}

// ===== Membership plans editor =====
async function loadPlans() {
  const state = $('plansState');
  let res;
  try {
    res = await fetch('/api/admin/plans', { headers: { 'x-admin-password': getPw() } });
  } catch {
    state.textContent = 'Network error loading plans.';
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { state.textContent = data.error || 'Plans unavailable.'; return; }
  state.classList.add('hidden');
  $('plansTable').classList.remove('hidden');
  $('plansFoot').classList.remove('hidden');
  renderPlansTable(data.plans || []);
}

function planRow(p = {}) {
  const tr = el('tr');
  tr.dataset.id = p.id || '';
  const cell = (input) => { const td = el('td'); td.appendChild(input); return td; };
  const mk = (field, type, value, attrs = {}) => {
    const i = el('input');
    i.type = type;
    i.dataset.field = field;
    i.value = value == null ? '' : String(value);
    Object.assign(i, attrs);
    i.style.width = type === 'text' ? '110px' : '80px';
    return i;
  };
  tr.appendChild(cell(mk('name', 'text', p.name)));
  tr.appendChild(cell(mk('monthly_price', 'number', p.monthly_price, { min: 0, step: '0.01' })));
  tr.appendChild(cell(mk('monthly_limit', 'number', p.monthly_limit, { min: 0, placeholder: '∞' })));
  tr.appendChild(cell(mk('priority', 'number', p.priority ?? 0, { min: 0 })));
  const sel = el('select');
  sel.dataset.field = 'active';
  [['true', 'Active'], ['false', 'Off']].forEach(([v, t]) => { const o = el('option', '', t); o.value = v; sel.appendChild(o); });
  sel.value = p.active === false ? 'false' : 'true';
  tr.appendChild(cell(sel));
  return tr;
}

function renderPlansTable(plans) {
  const wrap = $('plansTable');
  wrap.innerHTML = '';
  const table = el('table', 'data-table');
  const head = el('tr');
  ['Name', 'Price / mo ($)', 'Tokens / mo (empty = unlimited)', 'Order', 'Status'].forEach((h) => head.appendChild(el('th', '', h)));
  table.appendChild(head);
  plans.forEach((p) => table.appendChild(planRow(p)));
  wrap.appendChild(table);
}

$('addPlanBtn').addEventListener('click', () => {
  const table = $('plansTable').querySelector('table');
  if (table) table.appendChild(planRow({ priority: table.rows.length - 1 }));
});

$('savePlansBtn').addEventListener('click', async () => {
  const msg = $('plansMsg');
  msg.textContent = 'Saving…';
  const rows = [...$('plansTable').querySelectorAll('tr')]; // header is skipped by the name-field guard below
  let saved = 0, failed = 0, firstError = '';
  for (const tr of rows) {
    const get = (f) => tr.querySelector(`[data-field="${f}"]`);
    if (!get('name')) continue; // header row
    const name = get('name').value.trim();
    if (!name) continue; // blank new row — skip
    const body = {
      id: tr.dataset.id || null,
      name,
      monthly_price: get('monthly_price').value,
      monthly_limit: get('monthly_limit').value === '' ? null : get('monthly_limit').value,
      priority: get('priority').value,
      active: get('active').value === 'true',
    };
    try {
      const res = await fetch('/api/admin/plans', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': getPw() },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { saved++; if (d.plan?.id) tr.dataset.id = d.plan.id; }
      else { failed++; if (!firstError) firstError = d.error || ''; }
    } catch { failed++; }
  }
  msg.textContent = failed ? `Saved ${saved}, failed ${failed}. ${firstError}` : `✓ Saved ${saved} plans.`;
  if (!failed) setTimeout(() => { msg.textContent = ''; }, 2500);
});

// ===== Admin settings (token / guest / referral / membership) =====
// Field metadata mirrors SETTINGS_SCHEMA on the server; the server re-validates on save.
const SETTINGS_FIELDS = [
  { key: 'guest_free_generations', label: 'Guest free generations', type: 'int', help: 'Free replies a guest gets before login is required.' },
  { key: 'guest_trial_enabled', label: 'Enable guest free trial', type: 'bool', help: 'Master on/off for the pre-login free trial.' },
  { key: 'starter_tokens', label: 'Starter tokens after Google login', type: 'int', help: 'Tokens granted on first sign-in.' },
  { key: 'token_cost_per_generation', label: 'Token cost per generation', type: 'int', help: 'Tokens spent per reply generated.' },
  { key: 'referral_reward', label: 'Referral reward tokens', type: 'int', help: 'Tokens the referrer earns per successful referral.' },
  { key: 'referral_enabled', label: 'Enable referral system', type: 'bool' },
  { key: 'referral_min_action', label: 'Referral minimum action', type: 'enum', options: ['signup', 'first_generation', 'paid_membership'], help: 'What the invited user must do before the reward is paid.' },
  { key: 'max_referral_rewards_per_month', label: 'Max referral rewards / month', type: 'int' },
  { key: 'membership_enabled', label: 'Enable membership plans', type: 'bool' },
  { key: 'free_user_default_status', label: 'Free user status', type: 'enum', options: ['active', 'blocked'] },
  { key: 'paid_user_default_status', label: 'Paid user status', type: 'enum', options: ['active', 'expired', 'cancelled'] },
];

async function loadSettings() {
  const state = $('settingsState');
  const form = $('settingsForm');
  const foot = $('settingsFoot');
  form.classList.add('hidden');
  foot.classList.add('hidden');
  let res;
  try {
    res = await fetch('/api/admin/settings', { headers: { 'x-admin-password': getPw() } });
  } catch {
    state.textContent = 'Network error loading settings.';
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 503 = DB not connected yet; show the reason so the admin knows what to configure.
    state.textContent = data.error || 'Settings unavailable.';
    return;
  }
  renderSettingsForm(data.settings || {});
  state.classList.add('hidden');
  form.classList.remove('hidden');
  foot.classList.remove('hidden');
}

function renderSettingsForm(values) {
  const form = $('settingsForm');
  form.innerHTML = '';
  SETTINGS_FIELDS.forEach((f) => {
    const field = el('div', 'setting-field');
    const label = el('label', '', f.label);
    label.setAttribute('for', 'set_' + f.key);
    field.appendChild(label);

    const cur = values[f.key];
    let input;
    if (f.type === 'bool') {
      input = el('select');
      [['true', 'Enabled'], ['false', 'Disabled']].forEach(([v, t]) => {
        const o = el('option', '', t); o.value = v; input.appendChild(o);
      });
      input.value = /^(true|1|on|yes)$/i.test(String(cur)) ? 'true' : 'false';
    } else if (f.type === 'enum') {
      input = el('select');
      f.options.forEach((v) => { const o = el('option', '', v); o.value = v; input.appendChild(o); });
      if (cur != null) input.value = String(cur);
    } else {
      input = el('input');
      input.type = 'number';
      input.min = '0';
      input.value = cur == null ? '' : String(cur);
    }
    input.id = 'set_' + f.key;
    input.dataset.key = f.key;
    input.dataset.type = f.type;
    field.appendChild(input);
    if (f.help) field.appendChild(el('span', 'setting-help', f.help));
    form.appendChild(field);
  });
}

$('saveSettings').addEventListener('click', async () => {
  const msg = $('settingsMsg');
  msg.textContent = 'Saving…';
  const patch = {};
  $('settingsForm').querySelectorAll('[data-key]').forEach((inp) => {
    const key = inp.dataset.key;
    if (inp.dataset.type === 'bool') patch[key] = inp.value === 'true';
    else if (inp.dataset.type === 'int') patch[key] = parseInt(inp.value, 10);
    else patch[key] = inp.value;
  });
  try {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': getPw() },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { msg.textContent = data.error || 'Save failed.'; return; }
    msg.textContent = '✓ Saved.';
    setTimeout(() => { msg.textContent = ''; }, 2500);
  } catch {
    msg.textContent = 'Network error.';
  }
});

// ===== Rendering =====
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function render(d) {
  $('activeProvider').textContent = `Active: ${d.provider} · ${d.model}`;

  // stat cards
  const t = d.totals;
  const stats = [
    ['Generations', t.generations],
    ['Image generations', t.imageGenerations],
    ['Feedback events', t.feedbackEvents],
    ['👍 Useful', t.useful],
    ['👎 Not useful', t['not-useful']],
    ['⧉ Copies', t.copy],
    ['★ Saves', t.save],
  ];
  const grid = $('statGrid');
  grid.innerHTML = '';
  stats.forEach(([label, val]) => {
    const c = el('div', 'stat-card');
    c.append(el('div', 'stat-value', String(val ?? 0)), el('div', 'stat-label muted', label));
    grid.appendChild(c);
  });

  // feedback by style table (with satisfaction bar)
  renderStyleTable(d.feedback.byStyle);

  // generation bars
  renderBars($('byLanguage'), d.generations.byLanguage);
  renderBars($('byDay'), sortByKey(d.generations.byDay));

  // recent feedback
  renderRecent(d.recent);
}

function sortByKey(obj) {
  const out = {};
  Object.keys(obj).sort().forEach((k) => (out[k] = obj[k]));
  return out;
}

function renderStyleTable(byStyle) {
  const wrap = $('byStyle');
  wrap.innerHTML = '';
  const keys = Object.keys(byStyle).sort();
  if (keys.length === 0) { wrap.appendChild(el('p', 'muted', 'No feedback yet.')); return; }
  const table = el('table', 'data-table');
  const head = el('tr');
  ['Style', '👍', '👎', 'Copy', 'Save', 'Satisfaction'].forEach((h) => head.appendChild(el('th', '', h)));
  table.appendChild(head);
  keys.forEach((k) => {
    const v = byStyle[k];
    const pos = v.useful, neg = v['not-useful'];
    const total = pos + neg;
    const pct = total ? Math.round((pos / total) * 100) : 0;
    const row = el('tr');
    row.appendChild(el('td', '', k));
    row.appendChild(el('td', '', String(pos)));
    row.appendChild(el('td', '', String(neg)));
    row.appendChild(el('td', '', String(v.copy)));
    row.appendChild(el('td', '', String(v.save)));
    const barCell = el('td');
    const bar = el('div', 'sat-bar');
    const fill = el('div', 'sat-fill');
    fill.style.width = pct + '%';
    fill.style.background = pct >= 50 ? 'var(--success)' : 'var(--danger)';
    bar.appendChild(fill);
    barCell.append(bar, el('span', 'sat-pct muted', total ? pct + '%' : '—'));
    row.appendChild(barCell);
    table.appendChild(row);
  });
  wrap.appendChild(table);
}

function renderBars(container, obj) {
  container.innerHTML = '';
  const entries = Object.entries(obj).filter(([k]) => k && k !== '?');
  if (entries.length === 0) { container.appendChild(el('p', 'muted', 'No data yet.')); return; }
  const max = Math.max(...entries.map(([, v]) => v));
  entries.sort((a, b) => b[1] - a[1]);
  entries.forEach(([k, v]) => {
    const row = el('div', 'bar-row');
    row.appendChild(el('span', 'bar-label', k));
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = (max ? (v / max) * 100 : 0) + '%';
    track.appendChild(fill);
    row.append(track, el('span', 'bar-val muted', String(v)));
    container.appendChild(row);
  });
}

function renderRecent(recent) {
  const wrap = $('recent');
  wrap.innerHTML = '';
  if (!recent || recent.length === 0) { wrap.appendChild(el('p', 'muted', 'No feedback yet.')); return; }
  const table = el('table', 'data-table');
  const head = el('tr');
  ['When', 'Vote', 'Style', 'Lang', 'Message', 'Reply'].forEach((h) => head.appendChild(el('th', '', h)));
  table.appendChild(head);
  recent.forEach((r) => {
    const row = el('tr');
    row.appendChild(el('td', 'nowrap', new Date(r.at).toLocaleString()));
    const voteCell = el('td');
    const vmap = { useful: '👍', 'not-useful': '👎', copy: '⧉', save: '★', unsave: '☆' };
    voteCell.textContent = vmap[r.vote] || r.vote;
    row.appendChild(voteCell);
    row.appendChild(el('td', '', r.style || ''));
    row.appendChild(el('td', '', r.language || ''));
    row.appendChild(el('td', 'tamil cell-clip', r.message || ''));
    row.appendChild(el('td', 'tamil cell-clip', r.reply || ''));
    table.appendChild(row);
  });
  wrap.appendChild(table);
}

// auto-load if already authenticated this session
if (getPw()) showDashboard();
