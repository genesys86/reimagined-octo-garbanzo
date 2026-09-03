/**
 * Turns the Shopify product export into the flat catalogue the site builds from.
 *
 *   node scripts/import-shopify.mjs [path/to/products_export.csv]
 *
 * Output: src/data/catalog.json (committed, so a deploy never needs the CSV).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsvObjects } from './lib/csv.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2] || path.join(root, 'data/source/products_export.csv');
const outFile = path.join(root, 'src/data/catalog.json');

/**
 * Dropshipping feeds occasionally carry a price that is off by orders of
 * magnitude. Anything above this ceiling stays in the catalogue but is flagged,
 * kept out of the merchandised rails and reported at the end of the import so a
 * human can check it against the supplier. Override with PRICE_REVIEW_CEILING.
 */
const reviewCeiling = Number(process.env.PRICE_REVIEW_CEILING || 250000);

const MF = (name) => `${name}`;
const mf = {
  tagline: 'Tagline (product.metafields.vitals.tagline)',
  highlightTitle: 'Highlight - title (product.metafields.vitals.highlight_title)',
  highlightDesc: 'Highlight - description (product.metafields.vitals.highlight_description)',
  color: 'Color (product.metafields.shopify.color-pattern)',
  jewelryMaterial: 'Jewelry material (product.metafields.shopify.jewelry-material)',
  jewelryType: 'Jewelry type (product.metafields.shopify.jewelry-type)',
  gemstone: 'Gemstone type (product.metafields.shopify.gemstone-type)',
  material: 'Material (product.metafields.shopify.material)',
  targetGender: 'Target gender (product.metafields.shopify.target-gender)',
  ringSize: 'Ring size (product.metafields.shopify.ring-size)',
  shape: 'Shape (product.metafields.shopify.shape)',
  stoneShape: 'Stone shape (product.metafields.shopify.stone-shape)',
  finish: 'Finish (product.metafields.shopify.finish)',
  authenticity: 'Authenticity (product.metafields.shopify.authenticity)',
  rarity: 'Rarity (product.metafields.shopify.rarity)',
  watchFeatures: 'Watch features (product.metafields.shopify.watch-features)',
  watchMaterial: 'Watch material (product.metafields.shopify.watch-material)',
  bandColor: 'Band color (product.metafields.shopify.band-color)',
  caseColor: 'Case color (product.metafields.shopify.case-color)',
  dialColor: 'Dial color (product.metafields.shopify.dial-color)',
  mineralClass: 'Mineral class (product.metafields.shopify.mineral-class)',
  productUse: 'Product use (product.metafields.shopify.product-use)',
  theme: 'Theme (product.metafields.shopify.theme)',
  ageGroup: 'Age group (product.metafields.shopify.age-group)',
};

// ---------------------------------------------------------------- helpers

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

/** Keeps the small tag vocabulary Shopify descriptions actually use. */
function sanitizeHtml(html) {
  if (!html) return '';
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '');
  const allowed = new Set(['p', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'h3', 'h4', 'span', 'table', 'thead', 'tbody', 'tr', 'td', 'th']);
  out = out.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (m, tag) => (allowed.has(tag.toLowerCase()) ? `<${m.startsWith('</') ? '/' : ''}${tag.toLowerCase()}>` : ''));
  // Bare text (some rows are not wrapped in <p>) still renders fine inside the prose block.
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

const stripTags = (html) => clean((html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));

const splitList = (v) => clean(v).split(/;\s*/).map((x) => clean(x)).filter(Boolean);

const titleCase = (s) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const num = (v) => {
  const n = Number.parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// ------------------------------------------------------- taxonomy mapping

/** Shopify product category -> storefront collection(s). */
function collectionsFor(product) {
  const cat = product.category || '';
  const t = `${product.title} ${product.type}`.toLowerCase();
  const out = new Set();
  const has = (s) => cat.includes(s);

  if (has('> Rings')) out.add('rings');
  if (has('Engagement Rings') || /engagement|bridal/.test(t)) out.add('engagement');
  if (has('> Necklaces')) out.add('necklaces');
  if (has('> Bracelets')) out.add('bracelets');
  if (has('> Earrings')) out.add('earrings');
  if (has('Charms & Pendants')) out.add('pendants');
  if (has('> Watches')) out.add('watches');
  if (has('Jewelry Sets')) out.add('sets');
  if (has('Loose Stones') || has('Gemstones') || has('> Beads') || has('Rocks & Fossils')) out.add('gemstones');
  if (has('Sculptures & Statues') || has('Decorative Plaques') || has('Artwork')) out.add('objets');

  if (!out.size) {
    if (/\bring\b/.test(t)) out.add('rings');
    else if (/necklace|chain|collier/.test(t)) out.add('necklaces');
    else if (/bracelet|bangle/.test(t)) out.add('bracelets');
    else if (/earring|stud|hoop/.test(t)) out.add('earrings');
    else if (/pendant|charm/.test(t)) out.add('pendants');
    else if (/watch/.test(t)) out.add('watches');
    else if (/statue|sculpture|figurine/.test(t)) out.add('objets');
    else out.add('objets');
  }
  return [...out];
}

/** Attributes we can infer reliably from title + description + metafields. */
function attributesFor(row, product) {
  const hay = `${product.title} ${product.descriptionText} ${row[mf.jewelryMaterial]} ${row[mf.material]}`.toLowerCase();
  const attrs = {};

  const karat = hay.match(/\b(9|10|14|18|21|22|24)\s*(?:k|kt|ct)\b(?!\s*(?:tw|ctw|carat weight))/);
  if (karat) attrs.karat = `${karat[1]}K`;

  const metals = [];
  if (/\bplatinum\b/.test(hay)) metals.push('platinum');
  if (/rose gold|pink gold/.test(hay)) metals.push('rose-gold');
  if (/white gold/.test(hay)) metals.push('white-gold');
  if (/yellow gold/.test(hay)) metals.push('yellow-gold');
  if (!metals.length && /\bgold\b/.test(hay)) metals.push('gold');
  if (/sterling silver|\b925\b|\bsilver\b/.test(hay)) metals.push('silver');
  if (/\btitanium\b/.test(hay)) metals.push('titanium');
  if (metals.length) attrs.metals = [...new Set(metals)];

  const stones = new Set(splitList(row[mf.gemstone]).map((s) => s.toLowerCase()));
  for (const [re, key] of [
    [/lab[-\s]?grown|lab[-\s]?created|cvd|hpht/, 'lab-grown-diamond'],
    [/\bdiamond/, 'diamond'],
    [/\bemerald\b/, 'emerald'], [/\bruby|rubies\b/, 'ruby'], [/\bsapphire\b/, 'sapphire'],
    [/\bpearl\b/, 'pearl'], [/\bopal\b/, 'opal'], [/\bamethyst\b/, 'amethyst'],
    [/\btourmaline\b/, 'tourmaline'], [/\bmoissanite\b/, 'moissanite'],
    [/\btanzanite\b/, 'tanzanite'], [/\bgarnet\b/, 'garnet'], [/\bquartz\b/, 'quartz'],
    [/\bturquoise\b/, 'turquoise'], [/\bjade\b/, 'jade'], [/\bagate\b/, 'agate'],
    [/\bcitrine\b/, 'citrine'], [/\bperidot\b/, 'peridot'], [/\baquamarine\b/, 'aquamarine'],
  ]) if (re.test(hay)) stones.add(key);
  if (stones.size) attrs.stones = [...stones];

  const carat = product.title.match(/(\d+(?:\.\d+)?)\s*(?:ct|carat|ctw)\b/i);
  if (carat) attrs.carat = Number.parseFloat(carat[1]);

  const gender = splitList(row[mf.targetGender]).map((g) => g.toLowerCase());
  if (gender.length) attrs.gender = gender;

  const jType = splitList(row[mf.jewelryType]).map((g) => g.toLowerCase());
  if (jType.length) attrs.jewelryType = jType;

  const colors = splitList(row[mf.color]).map((c) => c.toLowerCase());
  if (colors.length) attrs.colors = colors;

  if (/\bigi\b|\bgia\b|certified|certificate/.test(hay)) attrs.certified = true;
  return attrs;
}

/** Spec rows shown in the product accordion — label keys are translated at render time. */
function specsFor(row, product) {
  const specs = [];
  const push = (key, value) => { const v = clean(value); if (v) specs.push({ key, value: v }); };
  push('karat', product.attributes.karat);
  push('metal', (product.attributes.metals || []).map(titleCase).join(', '));
  push('stone', (product.attributes.stones || []).map(titleCase).join(', '));
  push('carat', product.attributes.carat ? `${product.attributes.carat} ct` : '');
  push('stoneShape', splitList(row[mf.stoneShape]).map(titleCase).join(', ') || splitList(row[mf.shape]).map(titleCase).join(', '));
  push('finish', splitList(row[mf.finish]).map(titleCase).join(', '));
  push('gender', (product.attributes.gender || []).map(titleCase).join(', '));
  push('jewelryType', (product.attributes.jewelryType || []).map(titleCase).join(', '));
  push('watchMaterial', splitList(row[mf.watchMaterial]).map(titleCase).join(', '));
  push('watchFeatures', splitList(row[mf.watchFeatures]).map(titleCase).join(', '));
  push('dialColor', splitList(row[mf.dialColor]).map(titleCase).join(', '));
  push('mineralClass', splitList(row[mf.mineralClass]).map(titleCase).join(', '));
  push('authenticity', splitList(row[mf.authenticity]).map(titleCase).join(', '));
  push('rarity', splitList(row[mf.rarity]).map(titleCase).join(', '));
  if (product.weightGrams) push('weight', `${product.weightGrams} g`);
  return specs;
}

// ------------------------------------------------------------- excluded

/** App/utility SKUs that are not part of the public catalogue. */
function isExcluded(row) {
  const vendor = (row.Vendor || '').toLowerCase();
  const title = (row.Title || '').toLowerCase();
  const cat = row['Product Category'] || '';
  if (row['Gift Card'] === 'true') return true;
  if (vendor === 'seel') return true;
  if (cat.includes('Shipping Insurance') || cat === 'Gift Cards') return true;
  if (/^(return protection|shipping insurance|insurance)\b/.test(title)) return true;
  if ((row.Status || 'active') !== 'active') return true;
  if (row.Published && row.Published !== 'true') return true;
  return false;
}

// ------------------------------------------------------------------ main

const csv = fs.readFileSync(input, 'utf8');
const rows = parseCsvObjects(csv);

const grouped = new Map();
for (const row of rows) {
  const handle = row.Handle;
  if (!handle) continue;
  if (!grouped.has(handle)) grouped.set(handle, []);
  grouped.get(handle).push(row);
}

const products = [];
let skipped = 0;

for (const [handle, group] of grouped) {
  const head = group.find((r) => r.Title) || group[0];
  if (!head.Title || isExcluded(head)) { skipped++; continue; }

  const descriptionHtml = sanitizeHtml(head['Body (HTML)']);
  const descriptionText = stripTags(head['Body (HTML)']);

  const product = {
    handle,
    title: clean(head.Title),
    vendor: clean(head.Vendor),
    category: clean(head['Product Category']),
    type: clean(head.Type),
    tags: splitList(head.Tags.replace(/,/g, ';')),
    descriptionHtml,
    descriptionText,
    excerpt: clean(head['SEO Description']) || descriptionText.slice(0, 180),
    seoTitle: clean(head['SEO Title']) || clean(head.Title),
    seoDescription: clean(head['SEO Description']) || descriptionText.slice(0, 300),
    tagline: clean(head[mf.tagline]),
  };

  // ---- images (deduplicated, ordered by Image Position)
  const seen = new Set();
  product.images = group
    .filter((r) => r['Image Src'])
    .map((r) => ({ src: r['Image Src'], alt: clean(r['Image Alt Text']), pos: num(r['Image Position']) ?? 999 }))
    .sort((a, b) => a.pos - b.pos)
    .filter((i) => (seen.has(i.src) ? false : seen.add(i.src)))
    .map((i) => ({ src: i.src, alt: i.alt || product.title }));

  // ---- options + variants
  const optionNames = [1, 2, 3]
    .map((n) => clean(head[`Option${n} Name`]))
    .map((n) => (n === 'Title' ? '' : n));

  const variantRows = group.filter((r) => r['Variant Price'] !== '' || r['Variant SKU']);
  const optionValues = [new Set(), new Set(), new Set()];
  const variants = [];
  for (const r of variantRows) {
    const price = num(r['Variant Price']);
    if (price === null) continue;
    const slots = [1, 2, 3].map((n) => clean(r[`Option${n} Value`]));
    slots.forEach((v, i) => { if (v && optionNames[i]) optionValues[i].add(v); });
    const compareAt = num(r['Variant Compare At Price']);
    variants.push({
      sku: clean(r['Variant SKU']),
      slots,
      price: Math.round(price * 100) / 100,
      compareAt: compareAt && compareAt > price ? Math.round(compareAt * 100) / 100 : null,
      grams: num(r['Variant Grams']) || 0,
      image: r['Variant Image'] || null,
    });
  }
  if (!variants.length) { skipped++; continue; }

  // Some imported items pack several attributes into a single Shopify option,
  // e.g. "Diamond Clarity|Diamond Carat Weight|Ring Size" -> "VS1|3.11ct|4".
  // Split those back out so the product page offers one selector per attribute.
  const specsList = [];
  optionNames.forEach((name, slot) => {
    if (!name || !optionValues[slot].size) return;
    const parts = name.split('|').map(clean).filter(Boolean);
    parts.forEach((partName, part) => {
      const values = [...new Set([...optionValues[slot]].map((v) => (parts.length === 1 ? clean(v) : clean(v.split('|')[part] || ''))))].filter(Boolean);
      if (values.length) specsList.push({ name: partName, slot, part, parts: parts.length, values });
    });
  });

  const valueOf = (variant, spec) => {
    const raw = variant.slots[spec.slot] || '';
    return spec.parts === 1 ? clean(raw) : clean(raw.split('|')[spec.part] || '');
  };

  // Options that resolve to a single value everywhere are shown as specs, not selectors.
  product.options = specsList.filter((s) => s.values.length > 1).map((s) => ({ name: s.name, values: s.values }));
  product.fixedOptions = specsList.filter((s) => s.values.length === 1).map((s) => ({ name: s.name, value: s.values[0] }));

  const selectable = specsList.filter((s) => s.values.length > 1);
  const uniq = new Map();
  for (const v of variants) {
    const options = selectable.map((spec) => valueOf(v, spec));
    const key = options.join('||') || v.sku;
    if (!uniq.has(key)) uniq.set(key, { sku: v.sku, options, price: v.price, compareAt: v.compareAt, grams: v.grams, image: v.image });
  }
  product.variants = [...uniq.values()];

  const prices = product.variants.map((v) => v.price).filter((p) => p > 0);
  product.price = {
    min: prices.length ? Math.min(...prices) : 0,
    max: prices.length ? Math.max(...prices) : 0,
    compareAt: Math.max(0, ...product.variants.map((v) => v.compareAt || 0)) || null,
  };
  product.weightGrams = Math.max(0, ...product.variants.map((v) => v.grams || 0)) || null;
  product.flagged = product.price.min > reviewCeiling;

  product.attributes = attributesFor(head, product);
  product.collections = collectionsFor(product);
  product.specs = specsFor(head, product);
  for (const f of product.fixedOptions || []) {
    if (!product.specs.some((s) => s.label === f.name)) product.specs.push({ label: f.name, value: f.value });
  }

  // ---- merchandising blocks (only ~20 products carry these in the export)
  product.benefits = [1, 2, 3, 4]
    .map((n) => ({
      title: clean(head[`Key benefit ${n} - title (product.metafields.vitals.key_benefit_${n}_title)`]),
      body: clean(head[`Key benefit ${n} - description (product.metafields.vitals.key_benefit_${n}_description)`]),
    }))
    .filter((b) => b.title);
  product.faqs = [1, 2, 3]
    .map((n) => ({
      q: clean(head[`FAQ ${n} - question (product.metafields.vitals.faq_${n}_question)`]),
      a: clean(head[`FAQ ${n} - answer (product.metafields.vitals.faq_${n}_answer)`]),
    }))
    .filter((f) => f.q && f.a);

  // Highlights fall back to the bullet list Shopify descriptions always use.
  if (!product.benefits.length) {
    const bullets = [...(head['Body (HTML)'] || '').matchAll(/<li>([\s\S]*?)<\/li>/gi)]
      .map((m) => stripTags(m[1]))
      .filter(Boolean)
      .slice(0, 4);
    product.benefits = bullets.map((b) => {
      const [t, ...rest] = b.split(':');
      return rest.length ? { title: clean(t), body: clean(rest.join(':')) } : { title: '', body: b };
    }).filter((b) => b.title || b.body);
  }

  products.push(product);
}

// --------------------------------------------------------- collections

const collectionOrder = ['rings', 'engagement', 'necklaces', 'bracelets', 'earrings', 'pendants', 'sets', 'watches', 'gemstones', 'objets'];
const counts = new Map();
for (const p of products) for (const c of p.collections) counts.set(c, (counts.get(c) || 0) + 1);

const collections = collectionOrder
  .filter((slug) => counts.get(slug))
  .map((slug) => {
    const items = products.filter((p) => p.collections.includes(slug));
    const cover = items.find((p) => p.images.length)?.images[0]?.src || null;
    return { slug, count: items.length, cover };
  });

// Facet vocabularies drive the filter rail; keys are translated at render time.
const facets = {
  metals: [...new Set(products.flatMap((p) => p.attributes.metals || []))].sort(),
  stones: [...new Set(products.flatMap((p) => p.attributes.stones || []))].sort(),
  gender: [...new Set(products.flatMap((p) => p.attributes.gender || []))].sort(),
};

// Merchandising order: well-photographed pieces first, flagged prices last.
products.sort((a, b) => {
  if (a.flagged !== b.flagged) return a.flagged ? 1 : -1;
  const shot = Math.min(b.images.length, 6) - Math.min(a.images.length, 6);
  if (shot) return shot;
  return b.price.min - a.price.min;
});

const catalog = {
  // Deliberately no timestamp: the output must be a pure function of the input
  // so CI can diff it against the committed copy. Git records when it changed.
  source: path.basename(input),
  productCount: products.length,
  collections,
  facets,
  products,
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(catalog, null, 0));

console.log(`imported ${products.length} products (skipped ${skipped})`);
console.log(`collections: ${collections.map((c) => `${c.slug}:${c.count}`).join(' ')}`);
console.log(`images: ${products.reduce((n, p) => n + p.images.length, 0)}  variants: ${products.reduce((n, p) => n + p.variants.length, 0)}`);
console.log(`facets: metals=${facets.metals.join(',')} | stones=${facets.stones.join(',')}`);

const flagged = products.filter((p) => p.flagged);
if (flagged.length) {
  console.warn(`\n${flagged.length} product(s) priced above ${reviewCeiling} ${'EUR'} — check these against the supplier feed:`);
  for (const p of flagged) console.warn(`  ${String(Math.round(p.price.min)).padStart(10)}  ${p.handle}`);
  console.warn('They stay listed but are kept out of the home page rails.');
}
console.log(`-> ${path.relative(root, outFile)} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`);
