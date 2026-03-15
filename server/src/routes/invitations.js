const express = require('express');
const router = express.Router();
const { requireUser, prisma } = require('../middleware/auth');
const { createNotification } = require('../services/teamHelpers');

// GET /api/invitations — List pending invitations for current user
router.get('/', ...requireUser, async (req, res) => {
  try {
    if (req.user.tier !== 'enterprise') {
      return res.status(403).json({
        error: 'Enterprise subscription required to join teams',
        currentTier: req.user.tier,
      });
    }

    const invitations = await prisma.teamInvitation.findMany({
      where: { email: req.user.email, status: 'pending' },
      include: {
        team: { select: { name: true } },
        invitedBy: { select: { email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(invitations);
  } catch (error) {
    console.error('List invitations error:', error);
    res.status(500).json({ error: 'Failed to list invitations' });
  }
});

// POST /api/invitations/:invitationId/accept — Accept an invitation
router.post('/:invitationId/accept', ...requireUser, async (req, res) => {
  try {
    if (req.user.tier !== 'enterprise') {
      return res.status(403).json({
        error: 'Enterprise subscription required to join teams',
        currentTier: req.user.tier,
      });
    }

    const invitation = await prisma.teamInvitation.findFirst({
      where: {
        id: req.params.invitationId,
        email: req.user.email,
        status: 'pending',
      },
      include: {
        team: { select: { name: true, createdById: true } },
      },
    });

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }

    await prisma.$transaction([
      prisma.teamInvitation.update({
        where: { id: invitation.id },
        data: { status: 'accepted' },
      }),
      prisma.teamMember.create({
        data: {
          teamId: invitation.teamId,
          userId: req.user.id,
          role: 'member',
        },
      }),
    ]);

    // Notify team admin
    await createNotification(invitation.team.createdById, 'invite_accepted', {
      teamId: invitation.teamId,
      teamName: invitation.team.name,
      memberName: req.user.email,
      memberEmail: req.user.email,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Accept invitation error:', error);
    res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

// POST /api/invitations/:invitationId/decline — Decline an invitation
router.post('/:invitationId/decline', ...requireUser, async (req, res) => {
  try {
    const invitation = await prisma.teamInvitation.findFirst({
      where: {
        id: req.params.invitationId,
        email: req.user.email,
        status: 'pending',
      },
    });

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }

    await prisma.teamInvitation.update({
      where: { id: invitation.id },
      data: { status: 'declined' },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Decline invitation error:', error);
    res.status(500).json({ error: 'Failed to decline invitation' });
  }
});

module.exports = router;
