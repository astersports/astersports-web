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
  apiVersion: "2026-05-27.dahlia",
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
