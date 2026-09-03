/**
 * Cloudflare Pages Function — POST /api/checkout
 *
 * Only used when PUBLIC_CHECKOUT_MODE=stripe. It turns the browser's bag into a
 * Stripe Checkout Session and hands the URL back. Prices are recomputed here
 * from the committed catalogue, never trusted from the request body, so a
 * tampered cart cannot buy a €40,000 ring for €1.
 *
 * Required environment variables (Pages → Settings → Environment variables):
 *   STRIPE_SECRET_KEY   sk_live_... or sk_test_...
 *   SITE_ORIGIN         https://lamaisonvaldor.com
 *
 * Netlify equivalent: move this to netlify/functions/checkout.js and read the
 * variables from process.env. Vercel: api/checkout.js with the same body.
 */
import catalog from '../../src/data/catalog.json';
import discountData from '../../src/data/discounts.json';
import rates from '../../src/data/rates.json';
import { baseCurrency, currencies, freeShippingThreshold, shippingFee } from '../../src/data/site.config.mjs';

const byHandle = new Map(catalog.products.map((p) => [p.handle, p]));
const zeroDecimal = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK']);

/** Countries the carrier quotes for. Trim or extend to match your contract. */
const shipTo = [
  'AT', 'AU', 'AE', 'BE', 'BG', 'BH', 'CA', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR',
  'GB', 'GR', 'HK', 'HR', 'HU', 'IE', 'IL', 'IN', 'IS', 'IT', 'JP', 'KW', 'LT', 'LU', 'LV', 'MT',
  'MX', 'NL', 'NO', 'NZ', 'OM', 'PL', 'PT', 'QA', 'RO', 'SA', 'SE', 'SG', 'SI', 'SK', 'US', 'ZA',
];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

/** Base-currency amount -> the smallest unit of the charged currency. */
function toMinorUnits(amount, currency) {
  const cfg = currencies.find((c) => c.code === currency);
  const rate = rates.rates[currency] ?? 1;
  const unit = cfg?.round || 1;
  const converted = Math.round((amount * rate) / unit) * unit;
  const decimals = zeroDecimal.has(currency) ? 0 : cfg?.decimals ?? 2;
  return Math.round(converted * 10 ** decimals);
}

export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'checkout is not configured' }, 501);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }

  const currency = currencies.some((c) => c.code === payload.currency) ? payload.currency : baseCurrency;
  const items = Array.isArray(payload.items) ? payload.items.slice(0, 25) : [];
  if (!items.length) return json({ error: 'empty cart' }, 400);

  const lineItems = [];
  let subtotal = 0;

  for (const item of items) {
    const product = byHandle.get(String(item.handle));
    if (!product) return json({ error: `unknown product ${item.handle}` }, 400);

    // The authoritative price is the variant's, matched on SKU, not the cart's.
    const variant = product.variants.find((v) => v.sku === item.sku) || product.variants[0];
    const qty = Math.min(20, Math.max(1, Number(item.qty) || 1));
    subtotal += variant.price * qty;

    lineItems.push({
      quantity: qty,
      price_data: {
        currency: currency.toLowerCase(),
        unit_amount: toMinorUnits(variant.price, currency),
        product_data: {
          name: product.title.slice(0, 250),
          description: (variant.options || []).join(' · ').slice(0, 250) || undefined,
          images: product.images.slice(0, 1).map((i) => i.src),
          metadata: { handle: product.handle, sku: variant.sku },
        },
      },
    });
  }

  const discount = (discountData.codes || []).find((d) => d.code === String(payload.discount || '').toUpperCase());
  const afterDiscount = discount ? subtotal * (1 - discount.value / 100) : subtotal;
  const shipping = afterDiscount >= freeShippingThreshold ? 0 : shippingFee;

  const origin = env.SITE_ORIGIN || new URL(request.url).origin;
  const locale = /^[a-z]{2}$/.test(payload.locale || '') ? payload.locale : 'en';

  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('success_url', `${origin}/${locale}/pages/faq/?order=ok&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${origin}/${locale}/cart/`);
  form.set('locale', 'auto');
  form.set('billing_address_collection', 'required');
  shipTo.forEach((code, i) => form.set(`shipping_address_collection[allowed_countries][${i}]`, code));
  if (payload.customer?.email) form.set('customer_email', String(payload.customer.email).slice(0, 200));

  lineItems.forEach((line, i) => {
    form.set(`line_items[${i}][quantity]`, String(line.quantity));
    form.set(`line_items[${i}][price_data][currency]`, line.price_data.currency);
    form.set(`line_items[${i}][price_data][unit_amount]`, String(line.price_data.unit_amount));
    form.set(`line_items[${i}][price_data][product_data][name]`, line.price_data.product_data.name);
    if (line.price_data.product_data.description) {
      form.set(`line_items[${i}][price_data][product_data][description]`, line.price_data.product_data.description);
    }
    line.price_data.product_data.images.forEach((src, k) => {
      form.set(`line_items[${i}][price_data][product_data][images][${k}]`, src);
    });
    form.set(`line_items[${i}][price_data][product_data][metadata][sku]`, line.price_data.product_data.metadata.sku);
  });

  if (shipping > 0) {
    form.set('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
    form.set('shipping_options[0][shipping_rate_data][display_name]', 'Insured worldwide delivery');
    form.set('shipping_options[0][shipping_rate_data][fixed_amount][currency]', currency.toLowerCase());
    form.set('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(toMinorUnits(shipping, currency)));
  }

  // Discount codes live in Stripe, not here: a session cannot carry an ad-hoc
  // percentage. Map each code to a Stripe coupon id in the environment
  // (STRIPE_COUPON_WELCOME10=...), or let the customer type it on Stripe's page.
  const couponId = discount && env[`STRIPE_COUPON_${discount.code}`];
  if (couponId) form.set('discounts[0][coupon]', couponId);
  else form.set('allow_promotion_codes', 'true');

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('stripe error', res.status, detail.slice(0, 500));
    return json({ error: 'could not create a checkout session' }, 502);
  }

  const session = await res.json();
  return json({ url: session.url, id: session.id });
}
