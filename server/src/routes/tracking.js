const express = require('express');
const router = express.Router();
const { requireUser, prisma } = require('../middleware/auth');
const { TIER_LIMITS } = require('../services/tierLimits');

// GET /api/tracking/runs — List tracking runs with optional filters
router.get('/runs', ...requireUser, async (req, res) => {
  try {
    // Check tier access
    const limits = TIER_LIMITS[req.user.tier] || TIER_LIMITS.free;
    if (!limits.recipeTracking) {
      return res.status(403).json({
        error: 'Recipe tracking not available on your plan',
        currentTier: req.user.tier,
      });
    }

    const { machineId, recipeName, placement } = req.query;
    const where = { userId: req.user.id };

    if (machineId) where.machineId = machineId;
    if (recipeName) where.recipeName = recipeName;
    if (placement) where.placement = placement;

    const runs = await prisma.trackingRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { machine: { select: { name: true } } },
    });

    res.json(runs);
  } catch (error) {
    console.error('List runs error:', error);
    res.status(500).json({ error: 'Failed to list tracking runs' });
  }
});

// POST /api/tracking/runs — Upload tracking run(s)
router.post('/runs', ...requireUser, async (req, res) => {
  try {
    const limits = TIER_LIMITS[req.user.tier] || TIER_LIMITS.free;
    if (!limits.recipeTracking) {
      return res.status(403).json({
        error: 'Recipe tracking not available on your plan',
        currentTier: req.user.tier,
      });
    }

    const { runs } = req.body; // Array of run objects
    if (!runs || !Array.isArray(runs) || runs.length === 0) {
      return res.status(400).json({ error: 'Runs array is required' });
    }

    const created = await prisma.trackingRun.createMany({
      data: runs.map(run => ({
        userId: req.user.id,
        machineId: run.machineId || null,
        recipeName: run.recipeName,
        placement: run.placement || 'INT',
        runNumber: run.runNumber || '',
        data: run.data,
      })),
    });

    res.status(201).json({ count: created.count });
  } catch (error) {
    console.error('Create runs error:', error);
    res.status(500).json({ error: 'Failed to upload tracking runs' });
  }
});

// DELETE /api/tracking/runs/:id — Delete a single run
router.delete('/runs/:id', ...requireUser, async (req, res) => {
  try {
    const existing = await prisma.trackingRun.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Run not found' });
    }

    await prisma.trackingRun.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete run error:', error);
    res.status(500).json({ error: 'Failed to delete tracking run' });
  }
});

// DELETE /api/tracking/runs — Clear all runs for current user
router.delete('/runs', ...requireUser, async (req, res) => {
  try {
    const result = await prisma.trackingRun.deleteMany({
      where: { userId: req.user.id },
    });
    res.json({ deleted: result.count });
  } catch (error) {
    console.error('Clear runs error:', error);
    res.status(500).json({ error: 'Failed to clear tracking runs' });
  }
});

module.exports = router;
