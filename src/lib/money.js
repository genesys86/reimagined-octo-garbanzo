import ratesData from '../data/rates.json';
import { baseCurrency, currencies, getCurrency } from '../data/site.config.mjs';

export const rates = ratesData.rates;
export const ratesUpdatedAt = ratesData.updatedAt;

/** Converts a base-currency amount and snaps it to the currency's rounding unit. */
export function convert(amount, currency = baseCurrency) {
  const cfg = getCurrency(currency);
  const rate = rates[cfg.code] ?? 1;
  const raw = amount * rate;
  const unit = cfg.round || 1;
  return Math.round(raw / unit) * unit;
}

/**
 * Formats a base-currency amount for display.
 * Prices above 1000 drop the decimals — a €42,901 ring reads better than €42,901.36.
 */
export function formatMoney(amount, currency = baseCurrency, lang = 'en') {
  const cfg = getCurrency(currency);
  const value = convert(amount, cfg.code);
  const decimals = value >= 1000 ? 0 : cfg.decimals;
  try {
    return new Intl.NumberFormat(localeForCurrency(lang, cfg), {
      style: 'currency',
      currency: cfg.code,
      // narrowSymbol keeps "$1,200" rather than Italian CLDR's "1.200 USD".
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    return `${cfg.symbol} ${value.toFixed(decimals)}`;
  }
}

/** Number formatting follows the reader's language, not the currency's home country. */
function localeForCurrency(lang, cfg) {
  const region = cfg.locale.split('-')[1];
  return lang && region ? `${lang}-${region}` : cfg.locale;
}

export { baseCurrency, currencies, getCurrency };
