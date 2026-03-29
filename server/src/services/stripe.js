const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Map Stripe Price IDs to tier names
function getTierFromPriceId(priceId) {
  if (!priceId) return null;

  // Build map only from defined env vars to avoid undefined key collisions
  const priceToTier = {};
  const mappings = [
    ['STRIPE_STARTER_MONTHLY_PRICE_ID', 'starter'],
    ['STRIPE_STARTER_ANNUAL_PRICE_ID', 'starter'],
    ['STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID', 'professional'],
    ['STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID', 'professional'],
    ['STRIPE_ENTERPRISE_MONTHLY_PRICE_ID', 'enterprise'],
    ['STRIPE_ENTERPRISE_ANNUAL_PRICE_ID', 'enterprise'],
  ];
  for (const [envVar, tier] of mappings) {
    const id = process.env[envVar];
    if (id) priceToTier[id] = tier;
  }

  const tier = priceToTier[priceId] || null;
  if (!tier) {
    console.warn(`[STRIPE] Unknown price ID: ${priceId} — no tier mapping found. Check STRIPE_*_PRICE_ID env vars.`);
  }
  return tier;
}

// Check if a price ID is the LUMI AI add-on
function isLumiAddonPriceId(priceId) {
  return priceId && priceId === process.env.STRIPE_LUMI_ADDON_MONTHLY_PRICE_ID;
}

module.exports = { stripe, getTierFromPriceId, isLumiAddonPriceId };
