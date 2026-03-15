const express = require('express');
const router = express.Router();
const { requireUser, prisma } = require('../middleware/auth');

// GET /api/notifications — List user's notifications (paginated)
router.get('/', ...requireUser, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = 20;
    const skip = (page - 1) * perPage;

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: perPage,
      }),
      prisma.notification.count({
        where: { userId: req.user.id },
      }),
    ]);

    res.json({
      notifications,
      total,
      page,
      totalPages: Math.ceil(total / perPage),
    });
  } catch (error) {
    console.error('List notifications error:', error);
    res.status(500).json({ error: 'Failed to list notifications' });
  }
});

// GET /api/notifications/unread-count — Count unread notifications
// MUST be defined before /:id/read to avoid Express matching "unread-count" as :id
router.get('/unread-count', ...requireUser, async (req, res) => {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.user.id, read: false },
    });

    res.json({ count });
  } catch (error) {
    console.error('Unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// PUT /api/notifications/:id/read — Mark single notification as read
router.put('/:id/read', ...requireUser, async (req, res) => {
  try {
    const notification = await prisma.notification.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: { read: true },
    });

    res.json(updated);
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// PUT /api/notifications/read-all — Mark all notifications as read
router.put('/read-all', ...requireUser, async (req, res) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user.id, read: false },
      data: { read: true },
    });

    res.json({ updated: result.count });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

module.exports = router;
