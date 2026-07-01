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
}

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
