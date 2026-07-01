// ===== i18n engine (100+ UI languages) =====
// Loads translation dictionaries from /i18n/<code>.json (one file per language, listed in
// /i18n/languages.json — 118 languages and counting). Adding a new language later needs NO
// changes to this file, index.html, lang-picker.js, or app.js — just drop in a new <code>.json
// file and add one entry to languages.json.
//
// Not every one of the 118 listed languages has a hand-written dictionary yet. Per spec, any
// missing key — or an entire missing file — silently falls back to English rather than breaking
// or looking blank. The language IS still selected/persisted even if its file is 404 (so the UI
// is ready the moment a translation file is added later).
//
// Public API (window.i18n): t(key, vars), setLanguage(code), getLanguage(), getLanguages(),
// getLangMeta(code), onChange(cb). `key` is a dot-path like "step1.title". `vars` does
// {placeholder} interpolation.
(function () {
  const STORAGE_KEY = 'are.uiLang';
  const DEFAULT_LANG = 'en';

  let languages = [{ code: 'en', name: 'English', nativeName: 'English', flag: '🇬🇧', popular: true }];
  let currentLang = DEFAULT_LANG;
  let currentDict = {};
  let enDict = {}; // English is always kept loaded as the ultimate fallback
  const dictCache = {}; // code -> dict | null (null = fetch failed, avoid refetching)
  const listeners = [];
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; }); // resolves once languages.json + initial dict are loaded

  function get(dict, path) {
    return path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), dict);
  }

  function interpolate(str, vars) {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }

  // Translate a dot-path key, e.g. t('step1.title'), t('generate.usageCounter', { left: 5, limit: 10 }).
  // Falls back to the English dictionary, then to the raw key, if a translation is missing.
  function t(key, vars) {
    const val = get(currentDict, key) ?? get(enDict, key) ?? key;
    return typeof val === 'string' ? interpolate(val, vars) : val;
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url}`);
    return res.json();
  }

  // Returns {} (not a throw) for languages with no translation file yet, so callers can always
  // proceed — every key then naturally resolves through the English fallback in t().
  async function loadDict(code) {
    if (code in dictCache) return dictCache[code] || {};
    try {
      const dict = await fetchJson(`/i18n/${code}.json`);
      dictCache[code] = dict;
      return dict;
    } catch (e) {
      console.warn(`i18n: no translation file for "${code}" yet — falling back to English.`, e.message);
      dictCache[code] = null;
      return {};
    }
  }

  function langMeta(code) {
    return languages.find((l) => l.code === code);
  }

  // Apply the current dictionary to every element tagged with a data-i18n-* attribute, plus
  // the handful of pieces (page title, count options) that need small template logic.
  function applyStaticTranslations() {
    document.title = t('nav.brandName');

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    document.querySelectorAll('[data-i18n-label]').forEach((el) => {
      el.setAttribute('label', t(el.getAttribute('data-i18n-label')));
    });
    // "1 Reply" / "3 Replies" style count options: data-i18n-count="<n>" on the <option>.
    document.querySelectorAll('[data-i18n-count]').forEach((el) => {
      const n = Number(el.getAttribute('data-i18n-count'));
      el.textContent = t(n === 1 ? 'step3.countOne' : 'step3.countMany', { n });
    });
  }

  function setDirAndLang(code) {
    const meta = langMeta(code);
    document.documentElement.setAttribute('lang', code);
    document.documentElement.setAttribute('dir', meta?.dir === 'rtl' ? 'rtl' : 'ltr');
  }

  // Always resolves: switches to `code` (persisting + re-rendering) even when that language has
  // no translation file yet — the UI just reads through to English until one is added.
  async function setLanguage(code) {
    if (!langMeta(code)) code = DEFAULT_LANG;
    currentDict = await loadDict(code);
    if (code === DEFAULT_LANG) enDict = currentDict;
    currentLang = code;
    localStorage.setItem(STORAGE_KEY, code);
    setDirAndLang(code);
    applyStaticTranslations();
    listeners.forEach((cb) => {
      try { cb(code); } catch (e) { console.error('i18n onChange listener failed:', e); }
    });
  }

  function getLanguage() { return currentLang; }
  function getLanguages() { return languages; }
  function getLangMeta(code) { return langMeta(code); }
  function onChange(cb) { listeners.push(cb); }

  async function init() {
    try {
      languages = await fetchJson('/i18n/languages.json');
    } catch {
      // keep the built-in single-entry fallback so the app still works offline
    }
    enDict = await loadDict(DEFAULT_LANG);
    currentDict = enDict;

    const saved = localStorage.getItem(STORAGE_KEY);
    const initial = saved && langMeta(saved) ? saved : DEFAULT_LANG;
    await setLanguage(initial);
    readyResolve();
  }

  window.i18n = { t, setLanguage, getLanguage, getLanguages, getLangMeta, onChange, ready };
  document.addEventListener('DOMContentLoaded', init);
})();
