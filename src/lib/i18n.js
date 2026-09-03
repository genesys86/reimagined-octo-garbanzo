import { defaultLocale, localeCodes, getLocale } from '../data/site.config.mjs';
import en from '../data/locales/en.json';
import it from '../data/locales/it.json';
import fr from '../data/locales/fr.json';
import es from '../data/locales/es.json';
import de from '../data/locales/de.json';
import ar from '../data/locales/ar.json';

import pagesEn from '../data/pages/en.json';
import pagesIt from '../data/pages/it.json';
import pagesFr from '../data/pages/fr.json';
import pagesEs from '../data/pages/es.json';
import pagesDe from '../data/pages/de.json';
import pagesAr from '../data/pages/ar.json';

const dictionaries = { en, it, fr, es, de, ar };
const pageContent = { en: pagesEn, it: pagesIt, fr: pagesFr, es: pagesEs, de: pagesDe, ar: pagesAr };

const lookup = (dict, key) => key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), dict);

const interpolate = (value, vars) =>
  typeof value === 'string' && vars
    ? value.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m))
    : value;

/** Translator for a locale, falling back to English for any missing key. */
export function useTranslations(lang) {
  const dict = dictionaries[lang] || dictionaries[defaultLocale];
  return function t(key, vars) {
    const value = lookup(dict, key) ?? lookup(dictionaries[defaultLocale], key);
    return interpolate(value ?? key, vars);
  };
}

export function getPageContent(lang, slug) {
  const set = pageContent[lang] || pageContent[defaultLocale];
  return set[slug] || pageContent[defaultLocale][slug] || null;
}

export function pageSlugs() {
  return Object.keys(pageContent[defaultLocale]);
}

/** Builds a locale-prefixed absolute path: localePath('it', 'products/x'). */
export function localePath(lang, ...segments) {
  const parts = segments
    .filter((s) => s != null && s !== '')
    .join('/')
    .split('/')
    .filter(Boolean);
  return `/${[lang, ...parts].join('/')}/`;
}

export function isRtl(lang) {
  return getLocale(lang).dir === 'rtl';
}

export { localeCodes, defaultLocale, getLocale };
