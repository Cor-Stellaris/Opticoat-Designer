const express = require('express');
const router = express.Router();
const { requireUser, prisma } = require('../middleware/auth');
const { TIER_LIMITS } = require('../services/tierLimits');

// GET /api/designs — List all designs for current user
router.get('/', ...requireUser, async (req, res) => {
  try {
    const designs = await prisma.design.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.json(designs);
  } catch (error) {
    console.error('List designs error:', error);
    res.status(500).json({ error: 'Failed to list designs' });
  }
});

// GET /api/designs/:id — Get a single design with full data
router.get('/:id', ...requireUser, async (req, res) => {
  try {
    const design = await prisma.design.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!design) {
      return res.status(404).json({ error: 'Design not found' });
    }

    res.json(design);
  } catch (error) {
    console.error('Get design error:', error);
    res.status(500).json({ error: 'Failed to get design' });
  }
});

// POST /api/designs — Save a new design
router.post('/', ...requireUser, async (req, res) => {
  try {
    // Check tier limit
    const limits = TIER_LIMITS[req.user.tier] || TIER_LIMITS.free;
    if (limits.maxSavedDesigns !== -1) {
      const count = await prisma.design.count({ where: { userId: req.user.id } });
      if (count >= limits.maxSavedDesigns) {
        return res.status(403).json({
          error: 'Design save limit reached',
          current: count,
          max: limits.maxSavedDesigns,
          currentTier: req.user.tier,
        });
      }
    }

    const { name, data } = req.body;
    if (!name || !data) {
      return res.status(400).json({ error: 'Name and data are required' });
    }

    const design = await prisma.design.create({
      data: {
        userId: req.user.id,
        name,
        data,
      },
    });

    res.status(201).json(design);
  } catch (error) {
    console.error('Create design error:', error);
    res.status(500).json({ error: 'Failed to save design' });
  }
});

// PUT /api/designs/:id — Update an existing design
router.put('/:id', ...requireUser, async (req, res) => {
  try {
    const existing = await prisma.design.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Design not found' });
    }

    const { name, data } = req.body;
    const design = await prisma.design.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(data && { data }),
      },
    });

    res.json(design);
  } catch (error) {
    console.error('Update design error:', error);
    res.status(500).json({ error: 'Failed to update design' });
  }
});

// DELETE /api/designs/:id — Delete a design
router.delete('/:id', ...requireUser, async (req, res) => {
  try {
    const existing = await prisma.design.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Design not found' });
    }

    await prisma.design.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete design error:', error);
    res.status(500).json({ error: 'Failed to delete design' });
  }
});

module.exports = router;
