const express = require('express');
const router = express.Router();
const { requireUser, prisma } = require('../middleware/auth');
const { stripe, getTierFromPriceId, isLumiAddonPriceId } = require('../services/stripe');
const { STRIPE_PRICES, LUMI_ADDON_MESSAGE_LIMIT } = require('../services/tierLimits');

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

    // Block checkout if user already has an active/trialing subscription for a tier plan
    if (req.user.stripeCustomerId) {
      const existing = await stripe.subscriptions.list({
        customer: req.user.stripeCustomerId,
        status: 'active',
        limit: 10,
      });
      const trialingSubs = await stripe.subscriptions.list({
        customer: req.user.stripeCustomerId,
        status: 'trialing',
        limit: 10,
      });
      const allSubs = [...existing.data, ...trialingSubs.data];
      const hasTierSub = allSubs.some(sub =>
        sub.items.data.some(item => {
          const tid = getTierFromPriceId(item.price?.id);
          return tid !== null; // has a tier subscription (not LUMI add-on)
        })
      );
      if (hasTierSub) {
        return res.status(409).json({
          error: 'You already have an active subscription. Please manage it from your account settings or cancel before subscribing to a new plan.',
        });
      }
    }

    // Use email from request body (sent by frontend from Clerk) or fall back to DB
    const userEmail = req.body.email || req.user.email;

    // Get or create Stripe customer
    let customerId = req.user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: { userId: req.user.id, clerkId: req.user.clerkId },
      });
      customerId = customer.id;

      await prisma.user.update({
        where: { id: req.user.id },
        data: { stripeCustomerId: customerId, email: userEmail },
      });
    } else if (req.user.email?.includes('@placeholder.com') && userEmail && !userEmail.includes('@placeholder.com')) {
      // Fix placeholder email on existing Stripe customer
      await stripe.customers.update(customerId, { email: userEmail });
      await prisma.user.update({
        where: { id: req.user.id },
        data: { email: userEmail },
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

    const sessionConfig = {
      customer: customerId,
      mode: 'subscription',
      line_items: lineItems,
      allow_promotion_codes: true,
      success_url: `${process.env.FRONTEND_URL}?billing=success`,
      cancel_url: `${process.env.FRONTEND_URL}?billing=cancelled`,
      metadata: { userId: req.user.id },
    };

    // 7-day free trial for Professional tier only (one-time per customer)
    if (tier === 'professional') {
      let hadTrial = false;
      if (customerId) {
        const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
        hadTrial = subs.data.some(s => s.trial_end !== null);
      }
      if (!hadTrial) {
        sessionConfig.subscription_data = { trial_period_days: 7 };
      }
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    res.json({ url: session.url });
  } catch (error) {
    console.error('Checkout error:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Failed to create checkout session' });
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

// POST /api/billing/lumi-addon — Create checkout for LUMI AI add-on ($19/mo)
router.post('/lumi-addon', ...requireUser, async (req, res) => {
  try {
    // Only Starter tier users can purchase the add-on
    if (req.user.tier !== 'starter') {
      return res.status(400).json({
        error: req.user.tier === 'free'
          ? 'Please upgrade to the Starter plan first to add Lumi AI.'
          : 'Your plan already includes unlimited Lumi AI access.',
      });
    }

    if (req.user.lumiAddonActive) {
      return res.status(400).json({ error: 'Lumi AI add-on is already active on your account.' });
    }

    // Double-check Stripe directly to prevent race condition (two fast clicks)
    if (req.user.stripeCustomerId) {
      const existing = await stripe.subscriptions.list({
        customer: req.user.stripeCustomerId,
        status: 'active',
        limit: 10,
      });
      const hasLumiSub = existing.data.some(sub =>
        sub.items.data.some(item => isLumiAddonPriceId(item.price?.id))
      );
      if (hasLumiSub) {
        return res.status(409).json({ error: 'Lumi AI add-on is already active on your account.' });
      }
    }

    const priceId = STRIPE_PRICES.lumiAddon?.monthly;
    if (!priceId) {
      return res.status(500).json({ error: 'Lumi add-on price not configured' });
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

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}?billing=lumi-success`,
      cancel_url: `${process.env.FRONTEND_URL}?billing=cancelled`,
      metadata: { userId: req.user.id, type: 'lumi-addon' },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Lumi add-on checkout error:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Failed to create checkout session' });
  }
});

// POST /api/billing/lumi-addon/cancel — Cancel LUMI add-on at period end
router.post('/lumi-addon/cancel', ...requireUser, async (req, res) => {
  try {
    if (!req.user.lumiAddonActive) {
      return res.status(400).json({ error: 'No active Lumi AI add-on to cancel.' });
    }

    if (!req.user.stripeCustomerId) {
      return res.status(400).json({ error: 'No billing account found.' });
    }

    // Find the LUMI add-on subscription
    const subscriptions = await stripe.subscriptions.list({
      customer: req.user.stripeCustomerId,
      status: 'active',
      limit: 10,
    });

    const lumiSub = subscriptions.data.find(sub =>
      sub.items.data.some(item => isLumiAddonPriceId(item.price?.id))
    );

    if (!lumiSub) {
      return res.status(404).json({ error: 'Lumi AI add-on subscription not found in Stripe.' });
    }

    // Cancel at period end so user keeps access until billing cycle ends
    await stripe.subscriptions.update(lumiSub.id, {
      cancel_at_period_end: true,
    });

    res.json({ message: 'Lumi AI add-on will be cancelled at the end of your billing period.' });
  } catch (error) {
    console.error('Lumi add-on cancel error:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Failed to cancel add-on' });
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

        // Check if this is a LUMI add-on purchase
        if (isLumiAddonPriceId(priceId)) {
          if (session.customer) {
            await prisma.user.updateMany({
              where: { stripeCustomerId: session.customer },
              data: {
                lumiAddonActive: true,
                lumiMessagesUsed: 0,
                lumiBillingCycleStart: new Date(),
              },
            });
            console.log('LUMI add-on activated via checkout');
          }
          break;
        }

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
        const activeStatuses = ['active', 'trialing'];

        // Check if this is a LUMI add-on subscription update
        if (isLumiAddonPriceId(priceId)) {
          if (subscription.customer) {
            const isActive = activeStatuses.includes(subscription.status);
            await prisma.user.updateMany({
              where: { stripeCustomerId: subscription.customer },
              data: { lumiAddonActive: isActive },
            });
            console.log(`LUMI add-on subscription ${isActive ? 'active' : 'deactivated'} (status: ${subscription.status})`);
          }
          break;
        }

        const newTier = getTierFromPriceId(priceId);

        // Only maintain paid tier for active/trialing subscriptions
        // Revert to free for past_due, unpaid, incomplete, paused, etc.
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
        const deletedPriceId = subscription.items.data[0]?.price?.id;

        // Check if this is a LUMI add-on subscription deletion
        if (isLumiAddonPriceId(deletedPriceId)) {
          if (subscription.customer) {
            await prisma.user.updateMany({
              where: { stripeCustomerId: subscription.customer },
              data: { lumiAddonActive: false, lumiMessagesUsed: 0 },
            });
            console.log('LUMI add-on subscription cancelled');
          }
          break;
        }

        if (subscription.customer) {
          // Find the admin user before reverting tier
          const admin = await prisma.user.findFirst({
            where: { stripeCustomerId: subscription.customer },
          });

          await prisma.user.updateMany({
            where: { stripeCustomerId: subscription.customer },
            data: { tier: 'free' },
          });

          // If Enterprise admin cancels, clear org access for all members
          if (admin?.organizationId) {
            await prisma.user.updateMany({
              where: { organizationId: admin.organizationId },
              data: { organizationId: null },
            });
            console.log(`Org ${admin.organizationId} disbanded — all members lost access`);
          }

          console.log('Subscription cancelled — reverted to free tier');
        }
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        if (invoice.customer) {
          // Check if this invoice includes a LUMI add-on line item
          const lumiLineItem = invoice.lines?.data?.find(item =>
            isLumiAddonPriceId(item.price?.id)
          );
          if (lumiLineItem) {
            await prisma.user.updateMany({
              where: { stripeCustomerId: invoice.customer },
              data: {
                lumiMessagesUsed: 0,
                lumiBillingCycleStart: new Date(),
              },
            });
            console.log(`LUMI add-on message counter reset for customer ${invoice.customer}`);
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.customer) {
          // Stripe retries failed payments 3 times over ~3 weeks.
          // The subscription.updated handler covers downgrade when status becomes past_due.
          console.log(`[BILLING] Payment failed for customer ${invoice.customer} — attempt ${invoice.attempt_count}`);
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
