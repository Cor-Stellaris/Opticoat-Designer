const express = require('express');
const router = express.Router();
const { requireUser, prisma } = require('../middleware/auth');
const { stripe, getTierFromPriceId } = require('../services/stripe');
const { STRIPE_PRICES } = require('../services/tierLimits');

// POST /api/billing/checkout — Create a Stripe Checkout session
router.post('/checkout', ...requireUser, async (req, res) => {
  try {
    const { tier, interval } = req.body; // tier: starter|professional|enterprise, interval: monthly|annual

    if (!tier || !STRIPE_PRICES[tier]) {
      return res.status(400).json({ error: 'Invalid tier' });
    }

    if (!interval || !['monthly', 'annual'].includes(interval)) {
      return res.status(400).json({ error: 'Invalid interval (monthly or annual)' });
    }

    const priceId = STRIPE_PRICES[tier][interval];
    if (!priceId) {
      return res.status(400).json({ error: 'Price not configured for this tier/interval' });
    }

    // Get or create Stripe customer
    let customerId = req.user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        metadata: { userId: req.user.id, clerkId: req.user.clerkId },
      });
      customerId = customer.id;

      await prisma.user.update({
        where: { id: req.user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    // Build line items — Enterprise includes per-seat add-on for seats beyond 5
    const lineItems = [{ price: priceId, quantity: 1 }];

    if (tier === 'enterprise') {
      const seats = parseInt(req.body.seats) || 5; // default 5 included
      const extraSeats = Math.max(0, seats - 5);   // 5 seats included in base price
      if (extraSeats > 0) {
        const seatPriceId = STRIPE_PRICES.enterpriseSeat[interval];
        if (seatPriceId) {
          lineItems.push({ price: seatPriceId, quantity: extraSeats });
        }
      }
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: lineItems,
      success_url: `${process.env.FRONTEND_URL}?billing=success`,
      cancel_url: `${process.env.FRONTEND_URL}?billing=cancelled`,
      metadata: { userId: req.user.id },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// POST /api/billing/portal — Create a Stripe Billing Portal session
router.post('/portal', ...requireUser, async (req, res) => {
  try {
    if (!req.user.stripeCustomerId) {
      return res.status(400).json({ error: 'No billing account found' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: req.user.stripeCustomerId,
      return_url: process.env.FRONTEND_URL,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Portal error:', error);
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// POST /api/billing/webhook — Stripe webhook handler
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, // raw body (express.raw middleware in index.js)
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const priceId = subscription.items.data[0]?.price?.id;
        const newTier = getTierFromPriceId(priceId);

        if (newTier && session.customer) {
          await prisma.user.updateMany({
            where: { stripeCustomerId: session.customer },
            data: { tier: newTier },
          });
          console.log(`User upgraded to ${newTier} via checkout`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const priceId = subscription.items.data[0]?.price?.id;
        const newTier = getTierFromPriceId(priceId);

        // Only maintain paid tier for active/trialing subscriptions
        // Revert to free for past_due, unpaid, incomplete, paused, etc.
        const activeStatuses = ['active', 'trialing'];
        if (subscription.customer) {
          if (newTier && activeStatuses.includes(subscription.status)) {
            await prisma.user.updateMany({
              where: { stripeCustomerId: subscription.customer },
              data: { tier: newTier },
            });
            console.log(`Subscription updated to ${newTier} (status: ${subscription.status})`);
          } else if (!activeStatuses.includes(subscription.status)) {
            await prisma.user.updateMany({
              where: { stripeCustomerId: subscription.customer },
              data: { tier: 'free' },
            });
            console.log(`Subscription degraded — status: ${subscription.status}, reverted to free`);
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        if (subscription.customer) {
          await prisma.user.updateMany({
            where: { stripeCustomerId: subscription.customer },
            data: { tier: 'free' },
          });
          console.log('Subscription cancelled — reverted to free tier');
        }
        break;
      }

      default:
        // Unhandled event type
        break;
    }
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }

  res.json({ received: true });
});

module.exports = router;
