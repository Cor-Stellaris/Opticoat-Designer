const express = require('express');
const router = express.Router();
const { requireUser, prisma } = require('../middleware/auth');
const { stripe } = require('../services/stripe');
const { STRIPE_PRICES } = require('../services/tierLimits');

// GET /api/organizations/seats — Get seat usage for current org
router.get('/seats', ...requireUser, async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(400).json({ error: 'Not in an organization' });
    }

    // Count members in the org
    const used = await prisma.user.count({
      where: { organizationId: orgId },
    });

    // Get max seats from Stripe subscription (base 5 + extra seats)
    let max = 5; // default included seats
    if (req.user.stripeCustomerId) {
      try {
        const subs = await stripe.subscriptions.list({
          customer: req.user.stripeCustomerId,
          status: 'active',
          limit: 1,
        });
        if (subs.data.length > 0) {
          const sub = subs.data[0];
          // Look for seat add-on line item
          const seatItem = sub.items.data.find(item => {
            const priceId = item.price.id;
            return priceId === STRIPE_PRICES.enterpriseSeat?.monthly ||
                   priceId === STRIPE_PRICES.enterpriseSeat?.annual;
          });
          if (seatItem) {
            max = 5 + seatItem.quantity;
          }
        }
      } catch (e) {
        console.warn('Failed to fetch subscription for seat count:', e.message);
      }
    }

    res.json({ used, max });
  } catch (error) {
    console.error('Seats error:', error);
    res.status(500).json({ error: 'Failed to get seat info' });
  }
});

// POST /api/organizations/add-seats — Add more seats to Enterprise subscription
router.post('/add-seats', ...requireUser, async (req, res) => {
  try {
    if (req.user.tier !== 'enterprise') {
      return res.status(403).json({ error: 'Enterprise tier required' });
    }

    const { additionalSeats } = req.body;
    if (!additionalSeats || additionalSeats < 1) {
      return res.status(400).json({ error: 'Must add at least 1 seat' });
    }

    if (!req.user.stripeCustomerId) {
      return res.status(400).json({ error: 'No billing account found' });
    }

    const subs = await stripe.subscriptions.list({
      customer: req.user.stripeCustomerId,
      status: 'active',
      limit: 1,
    });

    if (subs.data.length === 0) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    const sub = subs.data[0];

    // Determine interval from the base subscription
    const baseItem = sub.items.data[0];
    const interval = baseItem.price.recurring?.interval === 'year' ? 'annual' : 'monthly';
    const seatPriceId = STRIPE_PRICES.enterpriseSeat?.[interval];

    if (!seatPriceId) {
      return res.status(400).json({ error: 'Seat pricing not configured' });
    }

    // Check if seat line item already exists
    const existingSeatItem = sub.items.data.find(item => item.price.id === seatPriceId);

    if (existingSeatItem) {
      // Update existing seat quantity
      await stripe.subscriptionItems.update(existingSeatItem.id, {
        quantity: existingSeatItem.quantity + additionalSeats,
      });
    } else {
      // Add new seat line item
      await stripe.subscriptionItems.create({
        subscription: sub.id,
        price: seatPriceId,
        quantity: additionalSeats,
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Add seats error:', error);
    res.status(500).json({ error: 'Failed to add seats' });
  }
});

module.exports = router;
