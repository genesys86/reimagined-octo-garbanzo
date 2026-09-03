/**
 * Central configuration for the La Maison Val d'Or storefront.
 * Everything that is deployment- or business-specific lives here.
 */

export const site = {
  domain: 'lamaisonvaldor.com',
  url: 'https://lamaisonvaldor.com',
  brand: "La Maison Val d'Or",
  brandShort: 'Val d’Or',
  legalName: "La Maison Val d'Or",
  email: 'contact@lamaisonvaldor.com',
  supportEmail: 'support@lamaisonvaldor.com',
  // Used by the enquiry / order flow when no payment provider is configured.
  whatsapp: '',
  phone: '',
  address: {
    line1: '',
    city: '',
    zip: '',
    country: 'GR',
  },
  social: {
    instagram: '',
    facebook: '',
    pinterest: '',
    tiktok: '',
  },
};

/** Language the catalogue data itself is authored in. */
export const sourceLocale = 'en';

/** Currency the Shopify export prices are expressed in. */
export const baseCurrency = 'EUR';

export const locales = [
  { code: 'en', hreflang: 'en', label: 'English', native: 'English', dir: 'ltr', flag: '\u{1F1EC}\u{1F1E7}', defaultCurrency: 'GBP' },
  { code: 'it', hreflang: 'it', label: 'Italian', native: 'Italiano', dir: 'ltr', flag: '\u{1F1EE}\u{1F1F9}', defaultCurrency: 'EUR' },
  { code: 'fr', hreflang: 'fr', label: 'French', native: 'Français', dir: 'ltr', flag: '\u{1F1EB}\u{1F1F7}', defaultCurrency: 'EUR' },
  { code: 'es', hreflang: 'es', label: 'Spanish', native: 'Español', dir: 'ltr', flag: '\u{1F1EA}\u{1F1F8}', defaultCurrency: 'EUR' },
  { code: 'de', hreflang: 'de', label: 'German', native: 'Deutsch', dir: 'ltr', flag: '\u{1F1E9}\u{1F1EA}', defaultCurrency: 'EUR' },
  { code: 'ar', hreflang: 'ar', label: 'Arabic', native: 'العربية', dir: 'rtl', flag: '\u{1F1E6}\u{1F1EA}', defaultCurrency: 'AED' },
];

export const defaultLocale = 'en';

export const localeCodes = locales.map((l) => l.code);

export function getLocale(code) {
  return locales.find((l) => l.code === code) || locales.find((l) => l.code === defaultLocale);
}

/**
 * Currencies offered in the switcher.
 * `decimals` and `round` drive the presentation rules in src/lib/money.js:
 * `round` is the nearest unit prices are snapped to after conversion, so a
 * converted price never shows the noise of a floating exchange rate.
 */
export const currencies = [
  { code: 'EUR', symbol: '€', decimals: 2, round: 1, locale: 'de-DE' },
  { code: 'USD', symbol: '$', decimals: 2, round: 1, locale: 'en-US' },
  { code: 'GBP', symbol: '£', decimals: 2, round: 1, locale: 'en-GB' },
  { code: 'CHF', symbol: 'CHF', decimals: 2, round: 1, locale: 'de-CH' },
  { code: 'CAD', symbol: 'CA$', decimals: 2, round: 1, locale: 'en-CA' },
  { code: 'AUD', symbol: 'A$', decimals: 2, round: 1, locale: 'en-AU' },
  { code: 'AED', symbol: 'د.إ', decimals: 2, round: 5, locale: 'ar-AE' },
  { code: 'SAR', symbol: 'ر.س', decimals: 2, round: 5, locale: 'ar-SA' },
  { code: 'QAR', symbol: 'ر.ق', decimals: 2, round: 5, locale: 'ar-QA' },
  { code: 'KWD', symbol: 'د.ك', decimals: 3, round: 1, locale: 'ar-KW' },
  { code: 'SEK', symbol: 'kr', decimals: 2, round: 10, locale: 'sv-SE' },
  { code: 'PLN', symbol: 'zł', decimals: 2, round: 5, locale: 'pl-PL' },
  { code: 'JPY', symbol: '¥', decimals: 0, round: 100, locale: 'ja-JP' },
  { code: 'SGD', symbol: 'S$', decimals: 2, round: 1, locale: 'en-SG' },
  { code: 'HKD', symbol: 'HK$', decimals: 2, round: 5, locale: 'zh-HK' },
  { code: 'INR', symbol: '₹', decimals: 2, round: 10, locale: 'en-IN' },
];

export const currencyCodes = currencies.map((c) => c.code);

export function getCurrency(code) {
  return currencies.find((c) => c.code === code) || currencies.find((c) => c.code === baseCurrency);
}

/** Country -> preferred currency, used for the geo suggestion banner. */
export const countryCurrency = {
  AT: 'EUR', BE: 'EUR', CY: 'EUR', DE: 'EUR', EE: 'EUR', ES: 'EUR', FI: 'EUR', FR: 'EUR',
  GR: 'EUR', IE: 'EUR', IT: 'EUR', LT: 'EUR', LU: 'EUR', LV: 'EUR', MT: 'EUR', NL: 'EUR',
  PT: 'EUR', SI: 'EUR', SK: 'EUR', HR: 'EUR',
  GB: 'GBP', US: 'USD', CH: 'CHF', CA: 'CAD', AU: 'AUD', NZ: 'AUD',
  AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', BH: 'AED', OM: 'AED',
  SE: 'SEK', PL: 'PLN', JP: 'JPY', SG: 'SGD', HK: 'HKD', IN: 'INR',
};

/** Country -> preferred language, used for the geo suggestion banner. */
export const countryLocale = {
  IT: 'it', CH: 'de', AT: 'de', DE: 'de', LI: 'de',
  FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr', CA: 'fr',
  ES: 'es', MX: 'es', AR: 'es', CL: 'es', CO: 'es', PE: 'es',
  AE: 'ar', SA: 'ar', QA: 'ar', KW: 'ar', BH: 'ar', OM: 'ar', EG: 'ar', JO: 'ar', MA: 'ar',
};

/**
 * Checkout mode.
 *  - 'enquiry' : cart becomes a reservation request handled by email / WhatsApp.
 *                Works on a purely static host, no keys required.
 *  - 'stripe'  : posts the cart to /api/checkout (see functions/api/checkout.js)
 *                which creates a Stripe Checkout Session in the selected currency.
 * Overridable at build time with PUBLIC_CHECKOUT_MODE.
 */
export const checkoutMode =
  (typeof process !== 'undefined' ? process.env.PUBLIC_CHECKOUT_MODE : undefined) || 'enquiry';

/** Free shipping threshold, expressed in the base currency. */
export const freeShippingThreshold = 150;

/** Flat shipping fee below the threshold, expressed in the base currency. */
export const shippingFee = 19;

export const catalogueSettings = {
  /** Products shown in the "featured" home rail. */
  featured: 12,
};
