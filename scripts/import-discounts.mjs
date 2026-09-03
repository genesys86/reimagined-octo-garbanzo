/**
 * Turns the Shopify discount export into src/data/discounts.json.
 * Only order-level percentage codes can be honoured by a static storefront;
 * app-driven and Buy-X-Get-Y discounts are listed as unsupported so the cart
 * can tell the customer to mention the code to their adviser instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsvObjects } from './lib/csv.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2] || path.join(root, 'data/source/discounts_export.csv');
const outFile = path.join(root, 'src/data/discounts.json');

const rows = parseCsvObjects(fs.readFileSync(input, 'utf8'));
const codes = [];

for (const r of rows) {
  const name = (r.Name || '').trim();
  if (!name || name.startsWith('[DO NOT DELETE]')) continue;
  if ((r.Status || '').toLowerCase() !== 'active') continue;
  if ((r['Value Type'] || '').toLowerCase() !== 'percentage') continue;
  // Buy X Get Y needs product-level logic the storefront cannot evaluate offline.
  if ((r.Type || '') !== 'Amount Off') continue;

  const value = Math.abs(Number.parseFloat(r.Value));
  if (!Number.isFinite(value) || value <= 0) continue;

  codes.push({
    code: name.toUpperCase(),
    type: 'percentage',
    value,
    appliesTo: (r['Discount Class'] || 'order').toLowerCase(),
    oncePerCustomer: r['Applies Once Per Customer'] === 'true',
    usageLimit: r['Usage Limit Per Code'] ? Number(r['Usage Limit Per Code']) : null,
    startsAt: r.Start || null,
    endsAt: r.End || null,
  });
}

// No timestamp here either — see the note in import-shopify.mjs.
fs.writeFileSync(outFile, JSON.stringify({ codes }, null, 2) + '\n');
console.log(`imported ${codes.length} discount codes: ${codes.map((c) => `${c.code} -${c.value}%`).join(', ')}`);
