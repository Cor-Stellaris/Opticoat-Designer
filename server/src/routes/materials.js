const express = require('express');
const router = express.Router();
const { requireUser, prisma } = require('../middleware/auth');
const { TIER_LIMITS } = require('../services/tierLimits');

// GET /api/materials — List custom materials for current user
router.get('/', ...requireUser, async (req, res) => {
  try {
    const materials = await prisma.customMaterial.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(materials);
  } catch (error) {
    console.error('List materials error:', error);
    res.status(500).json({ error: 'Failed to list materials' });
  }
});

// POST /api/materials — Create a custom material
router.post('/', ...requireUser, async (req, res) => {
  try {
    // Check tier limit
    const limits = TIER_LIMITS[req.user.effectiveTier || req.user.tier] || TIER_LIMITS.free;
    if (limits.maxCustomMaterials === 0) {
      return res.status(403).json({
        error: 'Custom materials not available on your plan',
        currentTier: req.user.tier,
      });
    }

    if (limits.maxCustomMaterials !== -1) {
      const count = await prisma.customMaterial.count({ where: { userId: req.user.id } });
      if (count >= limits.maxCustomMaterials) {
        return res.status(403).json({
          error: 'Custom material limit reached',
          current: count,
          max: limits.maxCustomMaterials,
          currentTier: req.user.tier,
        });
      }
    }

    const { name, properties } = req.body;
    if (!name || !properties) {
      return res.status(400).json({ error: 'Name and properties are required' });
    }

    const material = await prisma.customMaterial.create({
      data: {
        userId: req.user.id,
        name,
        properties,
      },
    });

    res.status(201).json(material);
  } catch (error) {
    console.error('Create material error:', error);
    res.status(500).json({ error: 'Failed to create material' });
  }
});

// DELETE /api/materials/:id — Delete a custom material
router.delete('/:id', ...requireUser, async (req, res) => {
  try {
    const existing = await prisma.customMaterial.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Material not found' });
    }

    await prisma.customMaterial.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete material error:', error);
    res.status(500).json({ error: 'Failed to delete material' });
  }
});

module.exports = router;
