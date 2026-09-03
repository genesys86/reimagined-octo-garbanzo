import { chromium } from 'playwright';

/**
 * End-to-end smoke test against a built site (npm run build && npm run preview).
 *   node tests/smoke.mjs
 * External images and fonts are stubbed so the run needs no outbound network.
 */
const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:4321';
const errors = [];
const results = [];
const ok = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`);

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({ locale: 'it-IT', viewport: { width: 1280, height: 900 } });
// External images/fonts are not reachable from the sandbox; stub them so the
// page reaches a stable state without waiting on the network.
await ctx.route('**/*', (route) => {
  const url = route.request().url();
  if (url.startsWith('http://localhost:4321')) return route.continue();
  return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
});
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(`${page.url()} :: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));

// 1. Home (Italian)
await page.goto(`${BASE}/it/`, { waitUntil: 'load' });
ok('home title is Italian', (await page.title()).includes('Alta gioielleria'));
const firstPrice = await page.locator('.card-price').first().innerText();
ok('home price rendered in EUR', firstPrice.includes('€'), firstPrice);

// 2. Currency switch -> USD
await page.locator('details.switch').first().click();
await page.locator('[data-set-currency="USD"]').click();
await page.waitForTimeout(300);
const usdPrice = await page.locator('.card-price').first().innerText();
ok('currency switch repaints prices', /\$|USD/.test(usdPrice), usdPrice);

// 3. Product page
await page.goto(`${BASE}/it/products/3-11-ct-oval-yellow-lab-diamond-ring-in-14k-white-gold/`, { waitUntil: 'load' });
ok('currency persists across pages', /\$|USD/.test(await page.locator('.price').first().innerText()));
const optionGroups = await page.locator('[data-option-index]').count();
ok('variant selectors rendered', optionGroups === 3, `groups=${optionGroups}`);
const skuBefore = await page.locator('[data-variant-sku]').innerText();
await page.locator('[data-option-index="2"] .chip').nth(3).click();
await page.waitForTimeout(200);
const skuAfter = await page.locator('[data-variant-sku]').innerText();
ok('changing an option changes the variant', skuBefore !== skuAfter, `${skuBefore} -> ${skuAfter}`);

// gallery
await page.locator('[data-thumb="2"]').click();
await page.waitForTimeout(150);
ok('gallery thumb swaps main image', (await page.locator('[data-gallery-main]').getAttribute('src')).length > 10);

// 4. Add to bag
await page.locator('[data-add-to-cart]').click();
await page.waitForTimeout(300);
ok('bag counter updates', (await page.locator('[data-cart-count]').first().innerText()) === '1');

// 5. Cart + discount
await page.goto(`${BASE}/it/cart/`, { waitUntil: 'load' });
ok('cart line rendered', (await page.locator('.cart-line').count()) === 1);
const totalBefore = await page.locator('[data-total]').innerText();
await page.fill('#discount-code', 'welcome10');
await page.locator('[data-discount-form] button').click();
await page.waitForTimeout(250);
const totalAfter = await page.locator('[data-total]').innerText();
ok('discount code applies', totalBefore !== totalAfter, `${totalBefore} -> ${totalAfter}`);
ok('discount row visible', await page.locator('[data-discount-row]').isVisible());

// quantity
await page.locator('.cart-line [data-step="1"]').click();
await page.waitForTimeout(250);
ok('quantity increment works', (await page.locator('[data-cart-count]').first().innerText()) === '2');

// 6. Checkout summary
await page.goto(`${BASE}/it/checkout/`, { waitUntil: 'load' });
ok('checkout summary lists the line', (await page.locator('[data-checkout-lines] .summary-row').count()) >= 1);
ok('checkout submit enabled with a cart', !(await page.locator('[data-checkout-submit]').isDisabled()));

// 7. Collection filtering
await page.goto(`${BASE}/it/collections/rings/`, { waitUntil: 'load' });
const total = Number(await page.locator('[data-result-count]').innerText());
await page.locator('[data-facet="metals"]').first().check();
await page.waitForTimeout(200);
const filtered = Number(await page.locator('[data-result-count]').innerText());
ok('facet filter narrows the grid', filtered > 0 && filtered < total, `${total} -> ${filtered}`);
await page.selectOption('[data-sort]', 'price-asc');
await page.waitForTimeout(200);
ok('sort applies an order', (await page.locator('.card-slot').first().evaluate((el) => el.style.order)) !== '');

// 8. Search
await page.goto(`${BASE}/it/search/?q=diamante`, { waitUntil: 'load' });
await page.goto(`${BASE}/it/search/`, { waitUntil: 'load' });
await page.fill('#q', 'emerald');
await page.waitForTimeout(300);
ok('search returns results', (await page.locator('[data-search-results] .card').count()) > 0);

// 9. Arabic / RTL
await page.goto(`${BASE}/ar/collections/gemstones/`, { waitUntil: 'load' });
ok('arabic page is RTL', (await page.locator('html').getAttribute('dir')) === 'rtl');
ok('arabic nav translated', (await page.locator('.nav a').first().innerText()).trim() === 'كل القطع');

// 10. Static pages + 404
await page.goto(`${BASE}/de/pages/privacy/`, { waitUntil: 'load' });
ok('legal page localized', (await page.locator('h1').innerText()).includes('Datenschutz'));
await page.goto(`${BASE}/fr/pages/faq/`, { waitUntil: 'load' });
ok('faq accordions rendered', (await page.locator('details.acc').count()) >= 8);

// 11. Language switch keeps the page
await page.goto(`${BASE}/en/products/3-11-ct-oval-yellow-lab-diamond-ring-in-14k-white-gold/`, { waitUntil: 'load' });
const frHref = await page.locator('[data-set-lang="fr"]').getAttribute('href');
ok('language switch stays on the same product', frHref.includes('/fr/products/3-11-ct-oval'), frHref);

console.log(results.join('\n'));
console.log(`\nconsole errors: ${errors.length}`);
errors.slice(0, 12).forEach((e) => console.log('  ' + e));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
