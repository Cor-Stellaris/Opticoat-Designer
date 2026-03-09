const express = require('express');
const router = express.Router();
const { requireUser, prisma } = require('../middleware/auth');
const { TIER_LIMITS } = require('../services/tierLimits');

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
router.get('/tier', ...requireUser, (req, res) => {
  const tier = req.user.tier;
  const limits = TIER_LIMITS[tier] || TIER_LIMITS.free;

  res.json({
    tier,
    limits,
  });
});

module.exports = router;
