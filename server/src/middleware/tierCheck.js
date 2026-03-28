const { TIER_LIMITS } = require('../services/tierLimits');

// Middleware factory: check if user's tier allows a feature
const requireTier = (feature) => {
  return (req, res, next) => {
    const userTier = req.user?.effectiveTier || req.user?.tier || 'free';
    const limits = TIER_LIMITS[userTier];

    if (!limits) {
      return res.status(403).json({ error: 'Invalid subscription tier' });
    }

    // Check boolean features
    if (typeof limits[feature] === 'boolean' && !limits[feature]) {
      return res.status(403).json({
        error: 'Feature not available on your plan',
        feature,
        currentTier: userTier,
        requiredTier: getMinimumTier(feature),
      });
    }

    // Check string features (e.g., designAssistant: 'target' | 'all' | false)
    if (limits[feature] === false) {
      return res.status(403).json({
        error: 'Feature not available on your plan',
        feature,
        currentTier: userTier,
        requiredTier: getMinimumTier(feature),
      });
    }

    next();
  };
};

// Check numeric limits (e.g., maxSavedDesigns)
const checkLimit = (limitKey, currentCount) => {
  return (req, res, next) => {
    const userTier = req.user?.effectiveTier || req.user?.tier || 'free';
    const limits = TIER_LIMITS[userTier];
    const maxAllowed = limits[limitKey];

    // -1 means unlimited
    if (maxAllowed !== -1 && currentCount >= maxAllowed) {
      return res.status(403).json({
        error: `Limit reached: ${limitKey}`,
        current: currentCount,
        max: maxAllowed,
        currentTier: userTier,
        upgradeTier: getNextTier(userTier),
      });
    }

    next();
  };
};

// Helper: find minimum tier that enables a feature
function getMinimumTier(feature) {
  const tiers = ['free', 'starter', 'professional', 'enterprise'];
  for (const tier of tiers) {
    const limits = TIER_LIMITS[tier];
    if (limits[feature] && limits[feature] !== false) return tier;
  }
  return 'enterprise';
}

// Helper: get next tier up
function getNextTier(currentTier) {
  const order = ['free', 'starter', 'professional', 'enterprise'];
  const idx = order.indexOf(currentTier);
  return idx < order.length - 1 ? order[idx + 1] : null;
}

module.exports = { requireTier, checkLimit, getMinimumTier, getNextTier };
