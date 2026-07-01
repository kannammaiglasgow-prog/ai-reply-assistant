// ===== Reusable searchable language picker (100+ languages) =====
// Vanilla JS, no dependencies. Used for BOTH the interface-language picker (valueKey: "code")
// and the reply output-language picker (valueKey: "name") — same component, different data file
// and value field, so both independently support search, "Popular" first, flag + native + English
// name rows, and RTL-safe rendering of native names.
window.createLangPicker = function createLangPicker(container, opts) {
  const { items, valueKey, initialValue, onSelect } = opts;
  // Mutable so setLabels() can re-translate the picker's own chrome when the UI language changes.
  let searchPlaceholder = opts.searchPlaceholder || 'Search languages...';
  let buttonTitle = opts.buttonTitle || 'Choose a language';
  let popularLabel = opts.popularLabel || 'Popular';
  let allLabel = opts.allLabel || 'All languages';
  let noMatchLabel = opts.noMatchLabel || 'No matches';

  let value = initialValue;
  let open = false;

  container.classList.add('lang-picker');
  container.innerHTML = `
    <button type="button" class="lang-picker-btn" title="${escapeAttr(buttonTitle)}" aria-haspopup="listbox">
      <span class="lang-picker-btn-flag"></span>
      <span class="lang-picker-btn-label"></span>
      <span class="lang-picker-caret">▾</span>
    </button>
    <div class="lang-picker-panel hidden" role="listbox">
      <input type="text" class="lang-picker-search" placeholder="${escapeAttr(searchPlaceholder)}" />
      <div class="lang-picker-list"></div>
    </div>
  `;

  const btn = container.querySelector('.lang-picker-btn');
  const btnFlag = container.querySelector('.lang-picker-btn-flag');
  const btnLabel = container.querySelector('.lang-picker-btn-label');
  const panel = container.querySelector('.lang-picker-panel');
  const search = container.querySelector('.lang-picker-search');
  const list = container.querySelector('.lang-picker-list');

  function escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;');
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  function findItem(v) {
    return items.find((i) => i[valueKey] === v);
  }

  function renderButton() {
    const item = findItem(value) || items[0];
    if (!item) return;
    btnFlag.textContent = item.flag || '';
    btnLabel.textContent = item.nativeName || item.name;
  }

  function rowHtml(item) {
    return `
      <div class="lang-picker-row" role="option" data-value="${escapeAttr(item[valueKey])}">
        <span class="lang-picker-flag">${item.flag || ''}</span>
        <span class="lang-picker-native" dir="auto">${escapeHtml(item.nativeName || item.name)}</span>
        <span class="lang-picker-english">${escapeHtml(item.name)}</span>
      </div>`;
  }

  function renderList(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      const popular = items.filter((i) => i.popular);
      const rest = items.filter((i) => !i.popular).sort((a, b) => a.name.localeCompare(b.name));
      list.innerHTML =
        (popular.length ? `<div class="lang-picker-group-label">${escapeHtml(popularLabel)}</div>${popular.map(rowHtml).join('')}` : '') +
        `<div class="lang-picker-group-label">${escapeHtml(allLabel)}</div>${rest.map(rowHtml).join('')}`;
      return;
    }
    const scored = items
      .map((i) => {
        const name = i.name.toLowerCase();
        const native = (i.nativeName || '').toLowerCase();
        const code = (i.code || '').toLowerCase();
        let score = -1;
        if (name.startsWith(q) || native.startsWith(q)) score = 0;
        else if (name.includes(q) || native.includes(q) || code === q) score = 1;
        return { i, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score || a.i.name.localeCompare(b.i.name));
    list.innerHTML = scored.length
      ? scored.map((x) => rowHtml(x.i)).join('')
      : `<div class="lang-picker-empty">${escapeHtml(noMatchLabel)}</div>`;
  }

  function openPanel() {
    open = true;
    panel.classList.remove('hidden');
    search.value = '';
    renderList('');
    search.focus();
  }
  function closePanel() {
    open = false;
    panel.classList.add('hidden');
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    open ? closePanel() : openPanel();
  });
  search.addEventListener('input', () => renderList(search.value));
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.lang-picker-row');
    if (!row) return;
    const item = findItem(row.getAttribute('data-value'));
    if (!item) return;
    value = item[valueKey];
    renderButton();
    closePanel();
    onSelect && onSelect(item);
  });
  document.addEventListener('click', (e) => {
    if (open && !container.contains(e.target)) closePanel();
  });
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
  });

  renderButton();

  return {
    // Programmatic sync (e.g. auto-detected language) — updates the UI without firing onSelect.
    setValue(v) {
      if (!findItem(v)) return;
      value = v;
      renderButton();
    },
    getValue() { return value; },
    // Re-translate the picker's own chrome (search placeholder, button title, group/empty labels)
    // when the host app's interface language changes.
    setLabels(labels = {}) {
      if (labels.searchPlaceholder != null) { searchPlaceholder = labels.searchPlaceholder; search.placeholder = searchPlaceholder; }
      if (labels.buttonTitle != null) { buttonTitle = labels.buttonTitle; btn.title = buttonTitle; }
      if (labels.popularLabel != null) popularLabel = labels.popularLabel;
      if (labels.allLabel != null) allLabel = labels.allLabel;
      if (labels.noMatchLabel != null) noMatchLabel = labels.noMatchLabel;
      if (open) renderList(search.value);
    },
  };
};
