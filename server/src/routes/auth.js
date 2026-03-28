const express = require('express');
const router = express.Router();
const { requireUser, prisma } = require('../middleware/auth');
const { TIER_LIMITS } = require('../services/tierLimits');
const { stripe } = require('../services/stripe');

// POST /api/auth/sync — Sync Clerk user to local DB (called on frontend login)
router.post('/sync', ...requireUser, async (req, res) => {
  try {
    // User is already created/fetched by requireUser middleware
    const user = req.user;

    // Update email if provided in body
    if (req.body.email && req.body.email !== user.email) {
      await prisma.user.update({
        where: { id: user.id },
        data: { email: req.body.email },
      });
    }

    res.json({
      id: user.id,
      email: user.email,
      tier: user.tier,
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error('Auth sync error:', error);
    res.status(500).json({ error: 'Failed to sync user' });
  }
});

// GET /api/auth/tier — Get current user tier + feature limits
router.get('/tier', ...requireUser, async (req, res) => {
  const tier = req.user.effectiveTier || req.user.tier;
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.free;

  // Check if user is on a trial
  let trial = null;
  if (req.user.stripeCustomerId) {
    try {
      const subs = await stripe.subscriptions.list({ customer: req.user.stripeCustomerId, status: 'trialing', limit: 1 });
      if (subs.data.length > 0) {
        trial = { isTrialing: true, trialEnd: subs.data[0].trial_end * 1000 };
      }
    } catch (e) {
      console.warn('Failed to check trial status:', e.message);
    }
  }

  res.json({
    userId: req.user.id,
    tier,
    ownTier: req.user.tier,
    organizationId: req.user.organizationId || null,
    limits,
    trial,
  });
});

module.exports = router;
