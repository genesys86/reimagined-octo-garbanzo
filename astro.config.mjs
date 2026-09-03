import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { site, localeCodes, defaultLocale } from './src/data/site.config.mjs';

// SITE_URL lets preview deployments emit correct canonical/sitemap URLs.
const siteUrl = process.env.SITE_URL || site.url;

export default defineConfig({
  site: siteUrl,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  compressHTML: true,
  integrations: [
    sitemap({
      i18n: {
        defaultLocale,
        locales: Object.fromEntries(localeCodes.map((c) => [c, c])),
      },
      filter: (page) => !page.includes('/checkout/') && !page.includes('/cart/'),
    }),
  ],
  vite: {
    build: { assetsInlineLimit: 2048 },
  },
});
