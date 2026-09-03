/**
 * Client runtime: currency switching, the bag, and the two consent banners.
 * Kept dependency-free and small — it runs on every page.
 */
import { formatMoney, convert } from '../lib/money.js';
import { currencies, baseCurrency, locales, defaultLocale, countryCurrency, countryLocale, freeShippingThreshold, shippingFee } from '../data/site.config.mjs';
import discountData from '../data/discounts.json';

const KEY = { cart: 'lmv.cart', currency: 'lmv.currency', lang: 'lmv.lang', geo: 'lmv.geo', consent: 'lmv.consent', discount: 'lmv.discount' };

const store = (() => {
  try {
    localStorage.setItem('lmv.probe', '1');
    localStorage.removeItem('lmv.probe');
    return localStorage;
  } catch {
    // Private windows and locked-down browsers: fall back to an in-memory map.
    const mem = new Map();
    return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  }
})();

const read = (key, fallback) => {
  try { const raw = store.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
};
const write = (key, value) => { try { store.setItem(key, JSON.stringify(value)); } catch { /* quota or blocked */ } };

const html = document.documentElement;
const lang = html.getAttribute('lang') || defaultLocale;
const currencyCodes = currencies.map((c) => c.code);

// ------------------------------------------------------------------ currency

function defaultCurrencyFor(language) {
  return locales.find((l) => l.code === language)?.defaultCurrency || baseCurrency;
}

let currency = read(KEY.currency, null);
if (!currencyCodes.includes(currency)) currency = defaultCurrencyFor(lang);

function setCurrency(code, { persist = true } = {}) {
  if (!currencyCodes.includes(code)) return;
  currency = code;
  if (persist) write(KEY.currency, code);
  paintPrices();
  document.dispatchEvent(new CustomEvent('lmv:currency', { detail: { currency } }));
}

/** Rewrites every element carrying a base-currency amount. */
function paintPrices(root = document) {
  root.querySelectorAll('[data-price]').forEach((el) => {
    // Guard: data-price marks a leaf that holds nothing but the amount.
    if (el.firstElementChild) return;
    const base = Number(el.getAttribute('data-price'));
    if (!Number.isFinite(base)) return;
    el.textContent = formatMoney(base, currency, lang);
  });
  root.querySelectorAll('[data-currency-code]').forEach((el) => { el.textContent = currency; });
  root.querySelectorAll('[data-currency-active]').forEach((el) => {
    el.setAttribute('aria-current', String(el.getAttribute('data-currency-active') === currency));
  });
}

// ---------------------------------------------------------------------- bag

let cart = read(KEY.cart, []);
if (!Array.isArray(cart)) cart = [];

const lineKey = (item) => `${item.handle}::${(item.options || []).join('|')}`;

function saveCart() {
  write(KEY.cart, cart);
  paintCartCount();
  document.dispatchEvent(new CustomEvent('lmv:cart', { detail: { cart } }));
}

function addToCart(item) {
  const key = lineKey(item);
  const existing = cart.find((l) => lineKey(l) === key);
  if (existing) existing.qty += item.qty || 1;
  else cart.push({ ...item, qty: item.qty || 1 });
  saveCart();
}

function setQty(key, qty) {
  const line = cart.find((l) => lineKey(l) === key);
  if (!line) return;
  line.qty = Math.max(0, qty);
  if (line.qty === 0) cart = cart.filter((l) => lineKey(l) !== key);
  saveCart();
}

function removeLine(key) { cart = cart.filter((l) => lineKey(l) !== key); saveCart(); }
function clearCart() { cart = []; write(KEY.discount, null); saveCart(); }

function cartCount() { return cart.reduce((n, l) => n + l.qty, 0); }
function cartSubtotal() { return cart.reduce((n, l) => n + l.price * l.qty, 0); }

function paintCartCount() {
  const n = cartCount();
  document.querySelectorAll('[data-cart-count]').forEach((el) => {
    el.textContent = String(n);
    el.hidden = n === 0;
  });
}

// ----------------------------------------------------------------- discount

const discounts = discountData.codes || [];

function findDiscount(code) {
  const wanted = String(code || '').trim().toUpperCase();
  if (!wanted) return null;
  const found = discounts.find((d) => d.code === wanted);
  if (!found) return null;
  if (found.endsAt && new Date(found.endsAt) < new Date()) return null;
  return found;
}

const getDiscount = () => findDiscount(read(KEY.discount, null)?.code);
const setDiscount = (code) => { const d = findDiscount(code); write(KEY.discount, d ? { code: d.code } : null); return d; };

/** Totals in base currency; the view converts on the way out. */
function totals() {
  const subtotal = cartSubtotal();
  const discount = getDiscount();
  const reduction = discount ? (subtotal * discount.value) / 100 : 0;
  const afterDiscount = subtotal - reduction;
  const shipping = cart.length === 0 || afterDiscount >= freeShippingThreshold ? 0 : shippingFee;
  return { subtotal, discount, reduction, shipping, total: afterDiscount + shipping };
}

// ------------------------------------------------------------------ banners

function initConsent() {
  const el = document.querySelector('[data-cookie-banner]');
  if (!el) return;
  if (read(KEY.consent, null)) return;
  el.hidden = false;
  el.querySelectorAll('[data-consent]').forEach((btn) => {
    btn.addEventListener('click', () => {
      write(KEY.consent, { choice: btn.getAttribute('data-consent'), at: Date.now() });
      el.hidden = true;
    });
  });
}

/**
 * Suggests a language/currency from the visitor's browser and, when available,
 * the CDN country header exposed on <html data-country>. Never switches on its own.
 */
function initGeoSuggestion() {
  const el = document.querySelector('[data-geo-banner]');
  if (!el || read(KEY.geo, null) || read(KEY.lang, null)) return;

  const country = (html.getAttribute('data-country') || '').toUpperCase();
  const browserLang = (navigator.language || '').slice(0, 2).toLowerCase();
  const suggestedLang = countryLocale[country] || (locales.some((l) => l.code === browserLang) ? browserLang : null);
  const suggestedCurrency = countryCurrency[country] || null;

  const langChanges = suggestedLang && suggestedLang !== lang;
  const currencyChanges = suggestedCurrency && suggestedCurrency !== currency;
  if (!langChanges && !currencyChanges) return;

  const target = langChanges ? location.pathname.replace(/^\/[a-z]{2}\//, `/${suggestedLang}/`) : location.pathname;
  const langLabel = locales.find((l) => l.code === (suggestedLang || lang))?.native || '';

  el.querySelectorAll('[data-geo-language]').forEach((n) => { n.textContent = langLabel; });
  el.querySelectorAll('[data-geo-currency]').forEach((n) => { n.textContent = suggestedCurrency || currency; });
  el.hidden = false;

  el.querySelector('[data-geo-accept]')?.addEventListener('click', () => {
    write(KEY.geo, { at: Date.now() });
    if (suggestedCurrency) setCurrency(suggestedCurrency);
    if (langChanges) { write(KEY.lang, suggestedLang); location.href = target + location.search; }
    else el.hidden = true;
  });
  el.querySelector('[data-geo-decline]')?.addEventListener('click', () => {
    write(KEY.geo, { at: Date.now() });
    el.hidden = true;
  });
}

// -------------------------------------------------------------------- wiring

function initChrome() {
  document.querySelectorAll('[data-set-currency]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setCurrency(btn.getAttribute('data-set-currency'));
      btn.closest('details')?.removeAttribute('open');
    });
  });

  document.querySelectorAll('[data-set-lang]').forEach((a) => {
    a.addEventListener('click', () => write(KEY.lang, a.getAttribute('data-set-lang')));
  });

  document.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.querySelector(btn.getAttribute('data-toggle'));
      if (!target) return;
      const open = target.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
  });

  // Only one dropdown open at a time.
  document.addEventListener('click', (e) => {
    document.querySelectorAll('details.switch[open]').forEach((d) => {
      if (!d.contains(e.target)) d.removeAttribute('open');
    });
  });

  write(KEY.lang, lang);
}

const api = {
  get lang() { return lang; },
  get currency() { return currency; },
  get cart() { return cart; },
  setCurrency, addToCart, setQty, removeLine, clearCart, cartCount, cartSubtotal,
  totals, lineKey, getDiscount, setDiscount, formatMoney, convert, paintPrices, paintCartCount,
};

window.LMV = api;

paintPrices();
paintCartCount();
initChrome();
initConsent();
initGeoSuggestion();

export default api;
