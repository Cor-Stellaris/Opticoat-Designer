const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireUser, prisma } = require('../middleware/auth');
const { requireTeamMember, requireTeamAdmin, checkTeamFrozen, createNotification } = require('../services/teamHelpers');

// GET /api/teams/:teamId/designs — List shared designs in a team
router.get('/', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    const designs = await prisma.sharedDesign.findMany({
      where: { teamId: req.params.teamId },
      include: {
        owner: { select: { id: true, email: true } },
        _count: { select: { submissions: true, comments: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.json(designs);
  } catch (error) {
    console.error('List shared designs error:', error);
    res.status(500).json({ error: 'Failed to list shared designs' });
  }
});

// POST /api/teams/:teamId/designs — Publish a design to team
router.post('/', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    const frozen = await checkTeamFrozen(req, res);
    if (frozen) return;

    const { name, data, sourceDesignId } = req.body;
    if (!name || !data) {
      return res.status(400).json({ error: 'Name and data are required' });
    }

    const design = await prisma.sharedDesign.create({
      data: {
        teamId: req.params.teamId,
        ownerId: req.user.id,
        name,
        data,
        sourceDesignId: sourceDesignId || null,
        status: 'draft',
      },
    });

    // Notify all other team members
    const members = await prisma.teamMember.findMany({
      where: { teamId: req.params.teamId, userId: { not: req.user.id } },
      select: { userId: true },
    });

    await Promise.all(
      members.map(m =>
        createNotification(m.userId, 'design_shared', {
          teamId: req.params.teamId,
          sharedDesignId: design.id,
          designName: name,
          sharedBy: req.user.email,
        })
      )
    );

    res.status(201).json(design);
  } catch (error) {
    console.error('Create shared design error:', error);
    res.status(500).json({ error: 'Failed to share design' });
  }
});

// GET /api/teams/:teamId/designs/:designId — Get shared design detail
router.get('/:designId', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    const design = await prisma.sharedDesign.findFirst({
      where: { id: req.params.designId, teamId: req.params.teamId },
      include: {
        owner: { select: { id: true, email: true } },
        submissions: {
          include: {
            submitter: { select: { id: true, email: true } },
            _count: { select: { comments: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        comments: {
          include: {
            author: { select: { id: true, email: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!design) {
      return res.status(404).json({ error: 'Shared design not found' });
    }

    res.json({ ...design, myRole: member.role });
  } catch (error) {
    console.error('Get shared design error:', error);
    res.status(500).json({ error: 'Failed to get shared design' });
  }
});

// PUT /api/teams/:teamId/designs/:designId/status — Update status tag
router.put('/:designId/status', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamAdmin(req, res);
    if (!member) return;

    const frozen = await checkTeamFrozen(req, res);
    if (frozen) return;

    const { status } = req.body;
    const validStatuses = ['draft', 'in_review', 'approved', 'production', 'archived'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    const design = await prisma.sharedDesign.findFirst({
      where: { id: req.params.designId, teamId: req.params.teamId },
    });

    if (!design) {
      return res.status(404).json({ error: 'Shared design not found' });
    }

    const updated = await prisma.sharedDesign.update({
      where: { id: req.params.designId },
      data: { status },
    });

    res.json(updated);
  } catch (error) {
    console.error('Update shared design status error:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// DELETE /api/teams/:teamId/designs/:designId — Remove shared design
router.delete('/:designId', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    const design = await prisma.sharedDesign.findFirst({
      where: { id: req.params.designId, teamId: req.params.teamId },
    });

    if (!design) {
      return res.status(404).json({ error: 'Shared design not found' });
    }

    // Only owner or admin can delete
    if (design.ownerId !== req.user.id && member.role !== 'admin') {
      return res.status(403).json({ error: 'Only the owner or a team admin can delete this design' });
    }

    await prisma.sharedDesign.delete({ where: { id: req.params.designId } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete shared design error:', error);
    res.status(500).json({ error: 'Failed to delete shared design' });
  }
});

// POST /api/teams/:teamId/designs/:designId/clone — Clone to personal workspace
router.post('/:designId/clone', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    const sharedDesign = await prisma.sharedDesign.findFirst({
      where: { id: req.params.designId, teamId: req.params.teamId },
    });

    if (!sharedDesign) {
      return res.status(404).json({ error: 'Shared design not found' });
    }

    const clone = await prisma.design.create({
      data: {
        userId: req.user.id,
        name: `${sharedDesign.name} (cloned)`,
        data: sharedDesign.data,
      },
    });

    res.status(201).json(clone);
  } catch (error) {
    console.error('Clone shared design error:', error);
    res.status(500).json({ error: 'Failed to clone design' });
  }
});

// GET /api/teams/:teamId/designs/:designId/comments — List comments
router.get('/:designId/comments', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    const comments = await prisma.designComment.findMany({
      where: { sharedDesignId: req.params.designId },
      include: {
        author: { select: { id: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json(comments);
  } catch (error) {
    console.error('List design comments error:', error);
    res.status(500).json({ error: 'Failed to list comments' });
  }
});

// POST /api/teams/:teamId/designs/:designId/comments — Add a comment
router.post('/:designId/comments', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    const frozen = await checkTeamFrozen(req, res);
    if (frozen) return;

    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment content is required' });
    }

    const design = await prisma.sharedDesign.findFirst({
      where: { id: req.params.designId, teamId: req.params.teamId },
    });

    if (!design) {
      return res.status(404).json({ error: 'Shared design not found' });
    }

    const comment = await prisma.designComment.create({
      data: {
        sharedDesignId: req.params.designId,
        authorId: req.user.id,
        content: content.trim(),
      },
      include: {
        author: { select: { id: true, email: true } },
      },
    });

    // Notify design owner + all prior commenters (excluding the commenter)
    const priorComments = await prisma.designComment.findMany({
      where: { sharedDesignId: req.params.designId, id: { not: comment.id } },
      select: { authorId: true },
      distinct: ['authorId'],
    });

    const notifyUserIds = new Set();
    if (design.ownerId !== req.user.id) {
      notifyUserIds.add(design.ownerId);
    }
    for (const c of priorComments) {
      if (c.authorId !== req.user.id) {
        notifyUserIds.add(c.authorId);
      }
    }

    const commentPreview = content.trim().substring(0, 100);

    await Promise.all(
      [...notifyUserIds].map(userId =>
        createNotification(userId, 'design_comment', {
          teamId: req.params.teamId,
          sharedDesignId: req.params.designId,
          designName: design.name,
          commentBy: req.user.email,
          commentPreview,
        })
      )
    );

    res.status(201).json(comment);
  } catch (error) {
    console.error('Create design comment error:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// DELETE /api/teams/:teamId/designs/:designId/comments/:commentId — Delete comment
router.delete('/:designId/comments/:commentId', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    const comment = await prisma.designComment.findFirst({
      where: { id: req.params.commentId, sharedDesignId: req.params.designId },
    });

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Only comment author or team admin can delete
    if (comment.authorId !== req.user.id && member.role !== 'admin') {
      return res.status(403).json({ error: 'Only the comment author or a team admin can delete this comment' });
    }

    await prisma.designComment.delete({ where: { id: req.params.commentId } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete design comment error:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

module.exports = router;
