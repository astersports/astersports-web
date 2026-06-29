import Stripe from "stripe";

/**
 * Stripe client singleton.
 * Uses STRIPE_SECRET_KEY injected by the platform. When the key is absent
 * (dev/test/CI), construct with a non-empty placeholder so importing this module
 * doesn't throw ("Neither apiKey nor config.authenticator provided") — any actual
 * API call still fails auth, which is correct. In production the real key is
 * present, so behavior is unchanged.
 */
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_unconfigured_placeholder", {
  apiVersion: "2026-06-24.dahlia",
  typescript: true,
});

/**
 * Product & Price configuration for Aster Sports billing.
 * These are created on-demand via ensureProducts() if they don't exist yet.
 */
export const PRODUCTS = {
  WEB_MAINTENANCE: {
    name: "Web Maintenance",
    description: "Monthly website maintenance, security updates, performance monitoring, content changes, and priority support.",
    priceAmount: 30000, // $300.00 in cents
    interval: "month" as const,
  },
} as const;

/**
 * Cached product/price IDs after first lookup or creation.
 */
let cachedProductId: string | null = null;
let cachedPriceId: string | null = null;

/**
 * Ensure the Web Maintenance product and price exist in Stripe.
 * Creates them if they don't exist, or finds existing ones.
 * Returns { productId, priceId }.
 */
export async function ensureProducts(): Promise<{ productId: string; priceId: string }> {
  if (cachedProductId && cachedPriceId) {
    return { productId: cachedProductId, priceId: cachedPriceId };
  }

  // Search for existing product by name
  const existingProducts = await stripe.products.search({
    query: `name:"${PRODUCTS.WEB_MAINTENANCE.name}"`,
  });

  let productId: string;

  if (existingProducts.data.length > 0) {
    productId = existingProducts.data[0].id;
  } else {
    // Create the product
    const product = await stripe.products.create({
      name: PRODUCTS.WEB_MAINTENANCE.name,
      description: PRODUCTS.WEB_MAINTENANCE.description,
    });
    productId = product.id;
  }

  // Search for existing recurring price on this product
  const existingPrices = await stripe.prices.list({
    product: productId,
    type: "recurring",
    active: true,
    limit: 10,
  });

  let priceId: string;
  const matchingPrice = existingPrices.data.find(
    (p) =>
      p.unit_amount === PRODUCTS.WEB_MAINTENANCE.priceAmount &&
      p.recurring?.interval === PRODUCTS.WEB_MAINTENANCE.interval
  );

  if (matchingPrice) {
    priceId = matchingPrice.id;
  } else {
    // Create the price
    const price = await stripe.prices.create({
      product: productId,
      unit_amount: PRODUCTS.WEB_MAINTENANCE.priceAmount,
      currency: "usd",
      recurring: {
        interval: PRODUCTS.WEB_MAINTENANCE.interval,
      },
    });
    priceId = price.id;
  }

  cachedProductId = productId;
  cachedPriceId = priceId;

  return { productId, priceId };
}

// ─── Studio plan/pack prices (created on-demand) ──────────────────────────────

const studioPriceCache: Map<string, string> = new Map();

/**
 * Ensure a Studio product + price exist in Stripe; return the price id.
 * Recurring when `interval` is given, one-time otherwise. Cached per
 * (name, amount, interval). Shared by studioBilling (subscribe/topup) AND
 * shadowBilling (trial conversion) — kept here in the neutral stripe module so
 * the two don't have to import each other (avoids a circular import).
 */
export async function ensureStudioPrice(
  productName: string,
  amountCents: number,
  interval?: "month"
): Promise<string> {
  const cacheKey = `${productName}-${amountCents}-${interval ?? "once"}`;
  if (studioPriceCache.has(cacheKey)) return studioPriceCache.get(cacheKey)!;

  // Escape backslash/quote so a future product name with those chars can't break
  // or distort the Stripe search query.
  const safeName = productName.replace(/[\\"]/g, "\\$&");
  const products = await stripe.products.search({ query: `name:"${safeName}"` });
  let productId: string;
  if (products.data.length > 0) {
    productId = products.data[0].id;
  } else {
    const product = await stripe.products.create({
      name: productName,
      description: `Aster Print Studio - ${productName}`,
    });
    productId = product.id;
  }

  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  const match = prices.data.find(
    (p) =>
      p.unit_amount === amountCents &&
      (interval ? p.recurring?.interval === interval : !p.recurring)
  );
  if (match) {
    studioPriceCache.set(cacheKey, match.id);
    return match.id;
  }

  const priceData: Stripe.PriceCreateParams = {
    product: productId,
    unit_amount: amountCents,
    currency: "usd",
  };
  if (interval) priceData.recurring = { interval };
  const price = await stripe.prices.create(priceData);
  studioPriceCache.set(cacheKey, price.id);
  return price.id;
}
