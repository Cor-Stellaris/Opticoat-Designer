const express = require('express');
const router = express.Router();
const { requireUser, prisma } = require('../middleware/auth');
const { TIER_LIMITS } = require('../services/tierLimits');

// GET /api/machines — List machines for current user
router.get('/', ...requireUser, async (req, res) => {
  try {
    const machines = await prisma.machine.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(machines);
  } catch (error) {
    console.error('List machines error:', error);
    res.status(500).json({ error: 'Failed to list machines' });
  }
});

// POST /api/machines — Create a machine
router.post('/', ...requireUser, async (req, res) => {
  try {
    const limits = TIER_LIMITS[req.user.effectiveTier || req.user.tier] || TIER_LIMITS.free;
    if (limits.maxMachines === 0) {
      return res.status(403).json({
        error: 'Machines not available on your plan',
        currentTier: req.user.tier,
      });
    }

    if (limits.maxMachines !== -1) {
      const count = await prisma.machine.count({ where: { userId: req.user.id } });
      if (count >= limits.maxMachines) {
        return res.status(403).json({
          error: 'Machine limit reached',
          current: count,
          max: limits.maxMachines,
          currentTier: req.user.tier,
        });
      }
    }

    const { name, toolingFactors } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Machine name is required' });
    }

    const machine = await prisma.machine.create({
      data: {
        userId: req.user.id,
        name,
        toolingFactors: toolingFactors || {},
      },
    });

    res.status(201).json(machine);
  } catch (error) {
    console.error('Create machine error:', error);
    res.status(500).json({ error: 'Failed to create machine' });
  }
});

// PUT /api/machines/:id — Update a machine
router.put('/:id', ...requireUser, async (req, res) => {
  try {
    const existing = await prisma.machine.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Machine not found' });
    }

    const { name, toolingFactors } = req.body;
    const machine = await prisma.machine.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(toolingFactors && { toolingFactors }),
      },
    });

    res.json(machine);
  } catch (error) {
    console.error('Update machine error:', error);
    res.status(500).json({ error: 'Failed to update machine' });
  }
});

// DELETE /api/machines/:id — Delete a machine
router.delete('/:id', ...requireUser, async (req, res) => {
  try {
    const existing = await prisma.machine.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Machine not found' });
    }

    await prisma.machine.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete machine error:', error);
    res.status(500).json({ error: 'Failed to delete machine' });
  }
});

module.exports = router;
