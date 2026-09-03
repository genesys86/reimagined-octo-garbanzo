# La Maison Val d'Or — standalone storefront

A self-contained, multilingual, multi-currency shop for **lamaisonvaldor.com**, built from
the Shopify product export. No Shopify, no theme, no monthly platform fee: the whole site is
static HTML you can host anywhere, and the catalogue lives in this repository as JSON.

- **236 products**, 1 395 images, 2 915 variants imported from `data/source/products_export.csv`
- **6 languages** — English, Italian, French, Spanish, German, Arabic (RTL) — 1 568 pages
- **16 currencies** switched instantly in the browser, from committed daily FX rates
- **Bag, discount codes and checkout** that work with zero backend, and a Stripe path when you want one
- Lighthouse-friendly: no framework runtime, ~11 KB of JavaScript, images lazy-loaded

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # -> dist/
npm test           # 22-check browser smoke test against the built site
```

---

## How it fits together

```
data/source/products_export.csv   the Shopify export (input, never read at runtime)
        │  npm run import
        ▼
src/data/catalog.json             flat catalogue, committed — the build's only product source
src/data/discounts.json           active percentage codes, from the discount export
src/data/rates.json               FX rates, committed so the build never depends on an API
src/data/locales/<lc>.json        every UI string, hand-translated
src/data/pages/<lc>.json          about / FAQ / shipping / returns / payment / privacy / terms / cookies
src/data/i18n/products.<lc>.json  optional machine-translated product copy (npm run translate)
src/data/site.config.mjs          languages, currencies, thresholds, checkout mode — start here
```

Everything the browser needs is generated at build time. `src/scripts/store.js` is the only
client runtime: it holds the bag, repaints prices when the currency changes, and drives the
two consent banners.

### Why the catalogue is committed

The CSV is a snapshot of a supplier feed. Committing the derived `catalog.json` means a deploy
can never half-fail because an import script broke, and every price change shows up as a
reviewable diff. Re-run `npm run import` whenever you get a new export, and commit the result —
CI fails the build if the two drift apart.

---

## The scripts

| Command | What it does |
| --- | --- |
| `npm run import` | Rebuilds `catalog.json` from the CSV. Reports products priced above the review ceiling. |
| `npm run import:discounts` | Rebuilds `discounts.json` from the discount export. |
| `npm run rates` | Refreshes `rates.json`. Keeps the committed file if the provider is down. |
| `npm run translate` | Translates product copy into every language (needs `ANTHROPIC_API_KEY`). |
| `npm run images:download` | Mirrors catalogue images into `public/media/` so you stop hotlinking Shopify's CDN. |
| `npm test` | Drives a real browser through the shop: currency switch, variants, bag, discount, filters, RTL. |

### Prices that need a human

Twelve products in the export carry prices that look like feed errors — a 3.01 ct lab-grown
diamond listed at €25 000 000, a gold Buddha at €6 853 597. The importer **does not touch
them**: it flags anything above `PRICE_REVIEW_CEILING` (default 250 000), keeps it listed and
searchable, but keeps it out of the home-page rails and the "you may also like" rail, and
prints the list at the end of every import:

```
12 product(s) priced above 250000 EUR — check these against the supplier feed:
    25000000  gia-certified-3-01ct-oval-lab-grown-diamond-d-vs1-excellent-cut
     6853598  chinese-sakyamuni-buddha-statue-gold-ornament-...
```

Fix them in the supplier feed, re-export, re-import.

---

## Languages

The interface, the navigation, the FAQ and all eight legal pages are **hand-translated** into
six languages and live in `src/data/locales/` and `src/data/pages/`. Every key exists in every
language; a missing key would fall back to English rather than render blank.

Product titles and descriptions come from the supplier in English. `npm run translate` fills
them in for the other five languages using the Claude API, writing one committed file per
language and skipping anything already translated:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run translate
npm run translate -- --locales it,fr --limit 20   # try it on twenty products first
npm run translate -- --force                      # redo everything
```

Until you run it, product pages in the other languages show English copy with a one-line note
saying so — deliberately, rather than pretending the page is localised.

**URLs** are `/<lang>/<section>/…`, every page carries `hreflang` alternates plus `x-default`,
and `/` negotiates the language at the edge via `public/_redirects` (with a client-side
fallback for hosts that ignore it). Arabic renders RTL end to end.

## Currencies

`src/data/site.config.mjs` lists 16 currencies; each language opens in a sensible default
(EUR for Italian, GBP for English, AED for Arabic). Prices are stored once in the base
currency and converted in the browser, then snapped to the currency's rounding unit so a
converted ring reads `AED 84 165`, not `AED 84 163.27`.

Rates come from `rates.json`, refreshed by `npm run rates` and by the daily GitHub Action in
`.github/workflows/rates.yml`. If the provider is unreachable the committed file stands and
the build still succeeds.

## Checkout

Two modes, set with `PUBLIC_CHECKOUT_MODE`:

- **`enquiry`** (default) — the bag becomes a reservation request. The customer fills in the
  form, the browser opens a pre-filled email containing the full order, and a client adviser
  replies with availability and a payment link. Works on any static host with no keys, and
  suits a catalogue whose median piece is €34 000.
- **`stripe`** — the bag posts to `/api/checkout` (`functions/api/checkout.js`, a Cloudflare
  Pages Function) which creates a Stripe Checkout Session. **Prices are recomputed server-side
  from the committed catalogue**, matched by SKU, so a tampered cart cannot buy a €40 000 ring
  for €1.

Discount codes from the export (`WELCOME10`, `RGJJ2FATW7SP`, `QT39EDEFQWBQ`) apply in the bag.
Buy-X-Get-Y and app-driven discounts are deliberately not imported — a static cart cannot
evaluate them correctly, and a discount that silently fails is worse than one that is absent.

---

## Deploying and connecting the domain

See **[DEPLOY.md](DEPLOY.md)** for the DNS records, the host setup (Cloudflare Pages, Netlify
or Vercel) and the go-live checklist.

## What is deliberately not here

- **No customer data.** `customers_export.csv` was not imported and is git-ignored. Publishing
  a public repository containing 60-odd real email addresses would be a personal-data breach
  under the GDPR. Import it into your email tool instead.
- **No order history, no accounts, no admin.** This is a storefront. Orders live in your inbox
  or in Stripe.
- **No stock levels.** Dropshipped pieces are made to order; the site says so rather than
  showing an invented "3 left".

## Notes for whoever picks this up next

- Images are still hotlinked from `cdn.shopify.com`. They work today, but they are outside your
  control — run `npm run images:download` before you close the Shopify account.
- The legal pages state Greek law and an EU trader. Have a lawyer confirm the company details,
  and fill in the real address, VAT number and phone in `src/data/site.config.mjs`.
- The brand copy on the home page and the About page is written, not placeholder. Read it and
  make sure you are happy standing behind every claim in it — particularly the delivery times,
  the guarantee and the certification promises.
