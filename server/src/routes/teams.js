const express = require('express');
const router = express.Router();
const { requireUser, prisma } = require('../middleware/auth');
const { TIER_LIMITS } = require('../services/tierLimits');
const { requireTeamMember, requireTeamAdmin, countUniqueSeats, checkTeamFrozen, createNotification } = require('../services/teamHelpers');

// POST /api/teams — Create a team
router.post('/', ...requireUser, async (req, res) => {
  try {
    const limits = TIER_LIMITS[req.user.tier] || TIER_LIMITS.free;
    if (!limits.teamCollaboration) {
      return res.status(403).json({
        error: 'Team collaboration not available on your plan',
        currentTier: req.user.tier,
      });
    }

    if (limits.maxTeams !== -1) {
      const count = await prisma.team.count({ where: { createdById: req.user.id } });
      if (count >= limits.maxTeams) {
        return res.status(403).json({
          error: 'Team limit reached',
          current: count,
          max: limits.maxTeams,
          currentTier: req.user.tier,
        });
      }
    }

    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Team name is required' });
    }

    const team = await prisma.team.create({
      data: {
        name: name.trim(),
        createdById: req.user.id,
        members: {
          create: {
            userId: req.user.id,
            role: 'admin',
          },
        },
      },
      include: {
        members: true,
      },
    });

    res.status(201).json(team);
  } catch (error) {
    console.error('Create team error:', error);
    res.status(500).json({ error: 'Failed to create team' });
  }
});

// GET /api/teams — List teams user belongs to
router.get('/', ...requireUser, async (req, res) => {
  try {
    const memberships = await prisma.teamMember.findMany({
      where: { userId: req.user.id },
      include: {
        team: {
          include: {
            members: true,
            _count: { select: { sharedDesigns: true } },
          },
        },
      },
    });

    const teams = memberships.map(m => ({
      ...m.team,
      myRole: m.role,
      memberCount: m.team.members.length,
      designCount: m.team._count.sharedDesigns,
    }));

    res.json(teams);
  } catch (error) {
    console.error('List teams error:', error);
    res.status(500).json({ error: 'Failed to list teams' });
  }
});

// GET /api/teams/:teamId — Get team detail
router.get('/:teamId', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    const team = await prisma.team.findUnique({
      where: { id: req.params.teamId },
      include: {
        members: {
          include: {
            user: { select: { email: true } },
          },
        },
        invitations: {
          where: { status: 'pending' },
        },
        _count: { select: { sharedDesigns: true } },
      },
    });

    res.json({ ...team, myRole: member.role });
  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({ error: 'Failed to get team' });
  }
});

// PUT /api/teams/:teamId — Update team name
router.put('/:teamId', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamAdmin(req, res);
    if (!member) return;

    const frozen = await checkTeamFrozen(req, res);
    if (frozen) return;

    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Team name is required' });
    }

    const team = await prisma.team.update({
      where: { id: req.params.teamId },
      data: { name: name.trim() },
    });

    res.json(team);
  } catch (error) {
    console.error('Update team error:', error);
    res.status(500).json({ error: 'Failed to update team' });
  }
});

// DELETE /api/teams/:teamId — Delete team
router.delete('/:teamId', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamAdmin(req, res);
    if (!member) return;

    await prisma.team.delete({ where: { id: req.params.teamId } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete team error:', error);
    res.status(500).json({ error: 'Failed to delete team' });
  }
});

// POST /api/teams/:teamId/invite — Invite a user by email
router.post('/:teamId/invite', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamAdmin(req, res);
    if (!member) return;

    const frozen = await checkTeamFrozen(req, res);
    if (frozen) return;

    const { email } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check seat limits
    const team = await prisma.team.findUnique({
      where: { id: req.params.teamId },
      include: { createdBy: { select: { id: true, tier: true } } },
    });
    const limits = TIER_LIMITS[team.createdBy.tier] || TIER_LIMITS.free;
    if (limits.maxTeamSeats !== -1) {
      const currentSeats = await countUniqueSeats(team.createdById);
      if (currentSeats >= limits.maxTeamSeats) {
        return res.status(403).json({
          error: 'Team seat limit reached',
          current: currentSeats,
          max: limits.maxTeamSeats,
        });
      }
    }

    // Check if already a member
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      const existingMember = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: req.params.teamId, userId: existingUser.id } },
      });
      if (existingMember) {
        return res.status(400).json({ error: 'User is already a team member' });
      }
    }

    // Check for pending invitation
    const pendingInvite = await prisma.invitation.findFirst({
      where: { teamId: req.params.teamId, email: normalizedEmail, status: 'pending' },
    });
    if (pendingInvite) {
      return res.status(400).json({ error: 'An invitation is already pending for this email' });
    }

    // Upsert invitation (handles re-inviting after decline)
    const invitation = await prisma.invitation.upsert({
      where: {
        teamId_email: { teamId: req.params.teamId, email: normalizedEmail },
      },
      update: {
        status: 'pending',
        invitedById: req.user.id,
      },
      create: {
        teamId: req.params.teamId,
        email: normalizedEmail,
        invitedById: req.user.id,
        status: 'pending',
      },
    });

    // If invitee has an account, create notification
    if (existingUser) {
      await createNotification(existingUser.id, 'team_invitation', {
        teamId: req.params.teamId,
        teamName: team.name,
        invitedBy: req.user.email,
        invitationId: invitation.id,
      });
    }

    res.status(201).json(invitation);
  } catch (error) {
    console.error('Invite to team error:', error);
    res.status(500).json({ error: 'Failed to send invitation' });
  }
});

// DELETE /api/teams/:teamId/members/:userId — Remove a member
router.delete('/:teamId/members/:userId', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamAdmin(req, res);
    if (!member) return;

    if (req.params.userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot remove yourself — transfer admin or delete the team instead' });
    }

    const targetMember = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: req.params.teamId, userId: req.params.userId } },
    });
    if (!targetMember) {
      return res.status(404).json({ error: 'Member not found' });
    }

    await prisma.teamMember.delete({
      where: { teamId_userId: { teamId: req.params.teamId, userId: req.params.userId } },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// POST /api/teams/:teamId/leave — Leave a team
router.post('/:teamId/leave', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    if (member.role === 'admin') {
      return res.status(400).json({ error: 'Admin cannot leave — transfer admin first or delete the team' });
    }

    await prisma.teamMember.delete({
      where: { teamId_userId: { teamId: req.params.teamId, userId: req.user.id } },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Leave team error:', error);
    res.status(500).json({ error: 'Failed to leave team' });
  }
});

// POST /api/teams/:teamId/transfer-admin — Transfer admin role
router.post('/:teamId/transfer-admin', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamAdmin(req, res);
    if (!member) return;

    const { newAdminUserId } = req.body;
    if (!newAdminUserId) {
      return res.status(400).json({ error: 'newAdminUserId is required' });
    }

    // Verify new admin is a team member
    const newAdminMember = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: req.params.teamId, userId: newAdminUserId } },
    });
    if (!newAdminMember) {
      return res.status(404).json({ error: 'User is not a team member' });
    }

    // Verify new admin has enterprise tier
    const newAdminUser = await prisma.user.findUnique({ where: { id: newAdminUserId } });
    if (newAdminUser.tier !== 'enterprise') {
      return res.status(403).json({ error: 'New admin must have an enterprise subscription' });
    }

    // Swap roles in a transaction
    await prisma.$transaction([
      prisma.teamMember.update({
        where: { teamId_userId: { teamId: req.params.teamId, userId: req.user.id } },
        data: { role: 'member' },
      }),
      prisma.teamMember.update({
        where: { teamId_userId: { teamId: req.params.teamId, userId: newAdminUserId } },
        data: { role: 'admin' },
      }),
      prisma.team.update({
        where: { id: req.params.teamId },
        data: { createdById: newAdminUserId },
      }),
    ]);

    res.json({ success: true });
  } catch (error) {
    console.error('Transfer admin error:', error);
    res.status(500).json({ error: 'Failed to transfer admin' });
  }
});

module.exports = router;
