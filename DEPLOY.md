# Going live on lamaisonvaldor.com

The site is static: `npm run build` produces `dist/`, and any host that serves files can serve
it. Below is the path I would take, then the two alternatives, then the DNS.

**One thing I could not do from here:** connecting the domain needs access to the registrar
account that holds `lamaisonvaldor.com` and to the hosting account. Both steps are below,
click by click.

---

## 1. Host: Cloudflare Pages (recommended)

Free, global CDN, free TLS, and it runs `functions/api/checkout.js` as-is if you later switch
on Stripe.

1. Push this repository to GitHub (already done if you are reading this in a PR).
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Pick the repository and branch.
4. Build settings:
   - Framework preset: **Astro**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Node version: `22` (add `NODE_VERSION=22` under environment variables)
5. Environment variables — none are required. Add these only when you want them:

   | Variable | When |
   | --- | --- |
   | `SITE_URL` | Preview deployments, so canonicals point at the preview host |
   | `PUBLIC_CHECKOUT_MODE=stripe` | To switch the bag from concierge requests to Stripe |
   | `STRIPE_SECRET_KEY` | With `stripe` mode. **Production scope only.** |
   | `SITE_ORIGIN=https://lamaisonvaldor.com` | With `stripe` mode |

6. Deploy. You get `lamaisonvaldor.pages.dev` — check it before touching DNS.

`public/_headers` and `public/_redirects` are picked up automatically: security headers, a
one-year cache on hashed assets, edge language negotiation on `/`, and 301s from the old
Shopify paths (`/products/…`, `/collections/…`) so existing links keep working.

## 2. Point the domain at it

In Cloudflare Pages → your project → **Custom domains** → **Set up a custom domain**, add
both `lamaisonvaldor.com` and `www.lamaisonvaldor.com`.

**If the domain's nameservers are already Cloudflare's**, the records are created for you.
Skip to step 3.

**If the domain is at another registrar** (GoDaddy, Namecheap, OVH, Aruba, Google Domains…),
either move the nameservers to Cloudflare — the dashboard shows you which two to enter — or
add these records at your current DNS provider:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| `CNAME` | `www` | `lamaisonvaldor.pages.dev` | Auto / 3600 |
| `CNAME` (or `ALIAS`/`ANAME`) | `@` | `lamaisonvaldor.pages.dev` | Auto / 3600 |

A plain `CNAME` on the root is not valid DNS at every provider. If yours refuses it, use its
`ALIAS`/`ANAME`/"CNAME flattening" record type, or point the root at Cloudflare's anycast
addresses and let the `www` CNAME do the work.

Keep any existing `MX` and `TXT` records — deleting them takes your email down with the
migration.

TLS is issued automatically once the records resolve; allow up to an hour.

## 3. Verify

```bash
curl -sI https://lamaisonvaldor.com/ | head -3          # 200 or 30x, and HSTS present
curl -s  https://lamaisonvaldor.com/en/ | grep -c hreflang
curl -sI https://lamaisonvaldor.com/it/products/…/      # a real product URL
```

Then, in a browser: switch currency, add a piece to the bag, reload, and confirm the bag
survived; open `/ar/` and confirm the layout mirrors.

Submit `https://lamaisonvaldor.com/sitemap-index.xml` in Google Search Console and Bing
Webmaster Tools.

---

## Alternatives

**Netlify** — same repository, build `npm run build`, publish `dist`. `_headers` and
`_redirects` work identically. Move `functions/api/checkout.js` to
`netlify/functions/checkout.js` and read the secrets from `process.env` instead of `env`.
Custom domain: **Domain settings → Add a domain**, then a `CNAME` to `<site>.netlify.app`.

**Vercel** — import the repository, it detects Astro. Move the function to `api/checkout.js`.
`_headers`/`_redirects` are ignored: port them to `vercel.json`. Custom domain: **Settings →
Domains**, then the `A` / `CNAME` records Vercel shows you.

**GitHub Pages** — works for the static site, but there is no place to run the checkout
function, so stay in `enquiry` mode. `public/CNAME` already contains the domain; enable Pages
on the branch that holds `dist/`, then point DNS at `<user>.github.io`.

---

## Before you take orders

- [ ] Fill in the real company details in `src/data/site.config.mjs`: legal name, address, VAT
      number, phone, WhatsApp, social links. They appear in the footer and the legal pages.
- [ ] Set up `contact@lamaisonvaldor.com` — the concierge checkout and every contact form send
      there. In `enquiry` mode this inbox *is* your order pipeline.
- [ ] Read the legal pages end to end. They are written for an EU trader under Greek law and
      state a 14-day withdrawal right, a two-year guarantee and insured shipping. Every one of
      those is a commitment; have a lawyer confirm them and adjust the text where they differ
      from what you actually offer.
- [ ] Check the twelve flagged prices (`npm run import` prints them) against the supplier.
- [ ] Run `npm run images:download` and commit `public/media/` before the Shopify store closes,
      or every product photo disappears with it.
- [ ] Decide on checkout: stay concierge, or set up Stripe, test it with `sk_test_`, and only
      then switch the key to live.
- [ ] Turn on the daily FX action (`.github/workflows/rates.yml`) so converted prices do not
      drift; it commits `rates.json` and your host redeploys on the commit.
- [ ] Add analytics if you want it — the cookie banner already asks for consent and stores the
      answer under `lmv.consent`; wire your script to fire only when that is `all`.
