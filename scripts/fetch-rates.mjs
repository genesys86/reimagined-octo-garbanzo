/**
 * Refreshes src/data/rates.json from a free FX endpoint.
 *
 *   node scripts/fetch-rates.mjs
 *
 * The file is committed so the site always builds — even offline, or if the
 * provider is down. Run it from CI on a schedule to keep prices current.
 * Set EXCHANGE_RATE_API_URL to point at a paid/pinned provider instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseCurrency, currencyCodes } from '../src/data/site.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'src/data/rates.json');
const endpoint = process.env.EXCHANGE_RATE_API_URL || `https://open.er-api.com/v6/latest/${baseCurrency}`;

const previous = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : null;

try {
  const res = await fetch(endpoint, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  const source = body.rates || body.conversion_rates || body.data;
  if (!source) throw new Error('unexpected payload shape');

  const rates = { [baseCurrency]: 1 };
  const missing = [];
  for (const code of currencyCodes) {
    const value = Number(source[code]);
    if (Number.isFinite(value) && value > 0) rates[code] = Math.round(value * 1e6) / 1e6;
    else if (previous?.rates?.[code]) { rates[code] = previous.rates[code]; missing.push(`${code} (kept previous)`); }
    else missing.push(`${code} (MISSING)`);
  }

  fs.writeFileSync(outFile, JSON.stringify({ base: baseCurrency, updatedAt: new Date().toISOString(), provider: endpoint, rates }, null, 2) + '\n');
  console.log(`rates updated from ${endpoint}`);
  if (missing.length) console.warn(`  warning: ${missing.join(', ')}`);
  console.log(Object.entries(rates).map(([k, v]) => `${k}=${v}`).join('  '));
} catch (err) {
  console.error(`rate refresh failed: ${err.message}`);
  if (previous) { console.error('keeping the committed rates.json'); process.exit(0); }
  process.exit(1);
}
