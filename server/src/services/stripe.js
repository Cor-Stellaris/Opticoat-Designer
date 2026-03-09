const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Map Stripe Price IDs to tier names
function getTierFromPriceId(priceId) {
  const priceToTier = {
    [process.env.STRIPE_STARTER_MONTHLY_PRICE_ID]: 'starter',
    [process.env.STRIPE_STARTER_ANNUAL_PRICE_ID]: 'starter',
    [process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID]: 'professional',
    [process.env.STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID]: 'professional',
    [process.env.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID]: 'enterprise',
    [process.env.STRIPE_ENTERPRISE_ANNUAL_PRICE_ID]: 'enterprise',
  };
  return priceToTier[priceId] || null;
}

module.exports = { stripe, getTierFromPriceId };
