/**
 * Translates product copy into every storefront language.
 *
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/translate.mjs
 *   node scripts/translate.mjs --locales it,fr --limit 20
 *   node scripts/translate.mjs --force            # re-translate everything
 *
 * Output: src/data/i18n/products.<locale>.json, merged into the catalogue at
 * build time by src/lib/catalog.js. The files are committed, so a deploy never
 * calls the API — run this only when the catalogue changes.
 *
 * The UI, the navigation and the legal pages are hand-translated in
 * src/data/locales and src/data/pages; this script only covers the ~236 product
 * descriptions imported from the supplier feed. Without an API key it exits
 * cleanly and the site falls back to the source-language copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { locales, sourceLocale } from '../src/data/site.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/data/catalog.json'), 'utf8'));
const outDir = path.join(root, 'src/data/i18n');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const force = args.includes('--force');
const limit = Number(flag('limit', 0)) || Infinity;
const targets = (flag('locales') || locales.map((l) => l.code).filter((c) => c !== sourceLocale).join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.TRANSLATE_MODEL || 'claude-sonnet-5';
const batchSize = Number(process.env.TRANSLATE_BATCH || 6);

if (!apiKey) {
  console.log('ANTHROPIC_API_KEY is not set — nothing to do.');
  console.log('The site builds fine without it: untranslated products fall back to the source language,');
  console.log('and the product page tells the reader so. Set the key and re-run to fill the gaps.');
  process.exit(0);
}

/** Fields worth translating, and the fingerprint that tells us when they changed. */
const sourceOf = (product) => ({
  title: product.title,
  excerpt: product.excerpt,
  tagline: product.tagline,
  descriptionHtml: product.descriptionHtml,
  seoTitle: product.seoTitle,
  seoDescription: product.seoDescription,
  benefits: product.benefits,
  faqs: product.faqs,
});

const fingerprint = (product) =>
  crypto.createHash('sha1').update(JSON.stringify(sourceOf(product))).digest('hex').slice(0, 12);

const SYSTEM = `You translate e-commerce copy for a fine-jewellery house.

Rules:
- Translate into the target language naturally, as a native copywriter would. Never translate word for word.
- Keep the register: understated luxury, concrete, no marketing inflation.
- Keep every HTML tag, attribute and structure in descriptionHtml exactly as given. Translate only the text between tags.
- Never translate or convert: carat weights, clarity grades (VS1, VVS2, D-F), colour grades, karat marks (14K, 18K), certificate bodies (IGI, GIA, GRS), measurements, SKUs, and numerals.
- Gemstone and metal names use the standard trade term of the target language.
- seoTitle stays under 60 characters, seoDescription under 155 characters.
- Return only JSON matching the requested shape. No prose, no code fences.`;

async function translateBatch(items, lang, langName) {
  const payload = items.map((p) => ({ handle: p.handle, ...sourceOf(p) }));

  const body = {
    model,
    max_tokens: 8000,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Target language: ${langName} (${lang}).

Translate every object in this array. Return a JSON array with the same length and the same field names, each object keeping its "handle" unchanged.

${JSON.stringify(payload)}`,
      },
    ],
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = await res.json();
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const json = text.trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim();

  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('expected a JSON array');
  return parsed;
}

fs.mkdirSync(outDir, { recursive: true });

for (const lang of targets) {
  const meta = locales.find((l) => l.code === lang);
  if (!meta) { console.warn(`skipping unknown locale "${lang}"`); continue; }

  const file = path.join(outDir, `products.${lang}.json`);
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

  const pending = catalog.products
    .filter((p) => force || existing[p.handle]?._hash !== fingerprint(p))
    .slice(0, limit === Infinity ? undefined : limit);

  if (!pending.length) {
    console.log(`${lang}: up to date (${Object.keys(existing).length} products)`);
    continue;
  }

  console.log(`${lang}: translating ${pending.length} product(s) with ${model}…`);
  let done = 0;
  let failed = 0;

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    try {
      const results = await translateBatch(batch, lang, meta.label);
      for (const result of results) {
        const source = batch.find((p) => p.handle === result.handle);
        if (!source) continue;
        existing[result.handle] = { ...result, _hash: fingerprint(source) };
        done++;
      }
      // Write after every batch so an interrupted run keeps its progress.
      fs.writeFileSync(file, JSON.stringify(existing, null, 0));
      process.stdout.write(`  ${Math.min(i + batchSize, pending.length)}/${pending.length}\r`);
    } catch (err) {
      failed += batch.length;
      console.warn(`\n  batch ${i / batchSize + 1} failed: ${err.message}`);
    }
  }

  console.log(`\n${lang}: ${done} translated${failed ? `, ${failed} failed (re-run to retry)` : ''} -> ${path.relative(root, file)}`);
}
