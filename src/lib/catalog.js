import catalog from '../data/catalog.json';
import { defaultLocale, catalogueSettings } from '../data/site.config.mjs';

/**
 * Optional machine-translated product copy, produced by scripts/translate.mjs.
 * Missing files simply mean the source-language copy is used.
 */
const overlayModules = import.meta.glob('../data/i18n/products.*.json', { eager: true });
const overlays = {};
for (const [file, mod] of Object.entries(overlayModules)) {
  const lang = file.match(/products\.([a-z-]+)\.json$/)?.[1];
  if (lang) overlays[lang] = mod.default ?? mod;
}

export const products = catalog.products;
export const collections = catalog.collections;
export const facets = catalog.facets;
export const hasTranslations = (lang) => Boolean(overlays[lang]);

const byHandle = new Map(products.map((p) => [p.handle, p]));

/** Returns the product with any available translation for `lang` merged in. */
export function localizedProduct(product, lang) {
  if (!product) return null;
  const tr = lang !== defaultLocale ? overlays[lang]?.[product.handle] : null;
  if (!tr) return product;
  return {
    ...product,
    title: tr.title || product.title,
    excerpt: tr.excerpt || product.excerpt,
    tagline: tr.tagline || product.tagline,
    descriptionHtml: tr.descriptionHtml || product.descriptionHtml,
    seoTitle: tr.seoTitle || tr.title || product.seoTitle,
    seoDescription: tr.seoDescription || tr.excerpt || product.seoDescription,
    benefits: tr.benefits?.length ? tr.benefits : product.benefits,
    faqs: tr.faqs?.length ? tr.faqs : product.faqs,
    translated: true,
  };
}

export function getProduct(handle, lang) {
  return localizedProduct(byHandle.get(handle), lang);
}

export function productsIn(slug) {
  return slug === 'all' ? products : products.filter((p) => p.collections.includes(slug));
}

export function collectionOf(slug) {
  return collections.find((c) => c.slug === slug) || null;
}

/** Same category first, then closest price — good enough without a recommender. */
export function relatedProducts(product, lang, limit = 4) {
  const primary = product.collections[0];
  return products
    .filter((p) => p.handle !== product.handle && p.collections.includes(primary) && !p.flagged)
    .sort((a, b) => Math.abs(a.price.min - product.price.min) - Math.abs(b.price.min - product.price.min))
    .slice(0, limit)
    .map((p) => localizedProduct(p, lang));
}

export function featuredProducts(lang, limit = catalogueSettings.featured) {
  // One piece per category first, so the home rail is not eight rings in a row.
  // Flagged prices (see scripts/import-shopify.mjs) never front the shop.
  const pool = products.filter((p) => !p.flagged && p.images.length);
  const seen = new Set();
  const spread = [];
  for (const p of pool) {
    const key = p.collections[0];
    if (seen.has(key)) continue;
    seen.add(key);
    spread.push(p);
  }
  const rest = pool.filter((p) => !spread.includes(p));
  return [...spread, ...rest].slice(0, limit).map((p) => localizedProduct(p, lang));
}

/** Compact index shipped to the browser for instant search. */
export function searchIndex(lang) {
  return products.map((p) => {
    const l = localizedProduct(p, lang);
    return {
      h: p.handle,
      t: l.title,
      c: p.collections,
      p: p.price.min,
      i: p.images[0]?.src || '',
      k: [
        l.title,
        p.title,
        ...(p.attributes.metals || []),
        ...(p.attributes.stones || []),
        p.attributes.karat || '',
        p.category.split('>').pop() || '',
      ].join(' ').toLowerCase(),
    };
  });
}

