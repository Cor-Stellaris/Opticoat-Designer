const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireUser, prisma } = require('../middleware/auth');
const { requireTeamMember, requireTeamAdmin, checkTeamFrozen, createNotification } = require('../services/teamHelpers');

// GET /api/teams/:teamId/designs/:designId/submissions — List submissions for a shared design
router.get('/', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    const submissions = await prisma.designSubmission.findMany({
      where: { sharedDesignId: req.params.designId },
      include: {
        submitter: { select: { id: true, email: true } },
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(submissions);
  } catch (error) {
    console.error('List submissions error:', error);
    res.status(500).json({ error: 'Failed to list submissions' });
  }
});

// POST /api/teams/:teamId/designs/:designId/submissions — Submit a modified design for review
router.post('/', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    const frozen = await checkTeamFrozen(req, res);
    if (frozen) return;

    const { data, notes, sourceDesignId } = req.body;
    if (!data) {
      return res.status(400).json({ error: 'Design data is required' });
    }
    if (!notes || !notes.trim()) {
      return res.status(400).json({ error: 'Submission notes are required' });
    }

    // Verify the shared design exists in this team
    const sharedDesign = await prisma.sharedDesign.findFirst({
      where: { id: req.params.designId, teamId: req.params.teamId },
      include: { team: { select: { createdById: true } } },
    });

    if (!sharedDesign) {
      return res.status(404).json({ error: 'Shared design not found' });
    }

    const submission = await prisma.designSubmission.create({
      data: {
        sharedDesignId: req.params.designId,
        submitterId: req.user.id,
        data,
        notes: notes.trim(),
        sourceDesignId: sourceDesignId || null,
        status: 'pending',
      },
    });

    // Notify team admin
    if (sharedDesign.team.createdById !== req.user.id) {
      await createNotification(sharedDesign.team.createdById, 'submission_created', {
        teamId: req.params.teamId,
        sharedDesignId: req.params.designId,
        submissionId: submission.id,
        designName: sharedDesign.name,
        submittedBy: req.user.email,
      });
    }

    res.status(201).json(submission);
  } catch (error) {
    console.error('Create submission error:', error);
    res.status(500).json({ error: 'Failed to create submission' });
  }
});

// GET /api/teams/:teamId/designs/:designId/submissions/:subId — Get submission detail
router.get('/:subId', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    const submission = await prisma.designSubmission.findFirst({
      where: { id: req.params.subId, sharedDesignId: req.params.designId },
      include: {
        submitter: { select: { id: true, email: true } },
        comments: {
          include: {
            author: { select: { id: true, email: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    res.json({ ...submission, myRole: member.role });
  } catch (error) {
    console.error('Get submission error:', error);
    res.status(500).json({ error: 'Failed to get submission' });
  }
});

// POST /api/teams/:teamId/designs/:designId/submissions/:subId/approve — Approve submission
router.post('/:subId/approve', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamAdmin(req, res);
    if (!member) return;

    const frozen = await checkTeamFrozen(req, res);
    if (frozen) return;

    const submission = await prisma.designSubmission.findFirst({
      where: { id: req.params.subId, sharedDesignId: req.params.designId, status: 'pending' },
    });

    if (!submission) {
      return res.status(404).json({ error: 'Pending submission not found' });
    }

    const { reviewNote } = req.body || {};

    // In a transaction: approve submission + replace shared design data
    const [updatedSubmission] = await prisma.$transaction([
      prisma.designSubmission.update({
        where: { id: req.params.subId },
        data: {
          status: 'approved',
          reviewNote: reviewNote || null,
        },
      }),
      prisma.sharedDesign.update({
        where: { id: req.params.designId },
        data: { data: submission.data },
      }),
    ]);

    // Notify submitter
    if (submission.submitterId !== req.user.id) {
      const sharedDesign = await prisma.sharedDesign.findUnique({
        where: { id: req.params.designId },
        select: { name: true },
      });

      await createNotification(submission.submitterId, 'submission_approved', {
        teamId: req.params.teamId,
        sharedDesignId: req.params.designId,
        submissionId: submission.id,
        designName: sharedDesign?.name,
        approvedBy: req.user.email,
      });
    }

    res.json(updatedSubmission);
  } catch (error) {
    console.error('Approve submission error:', error);
    res.status(500).json({ error: 'Failed to approve submission' });
  }
});

// POST /api/teams/:teamId/designs/:designId/submissions/:subId/deny — Deny submission
router.post('/:subId/deny', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamAdmin(req, res);
    if (!member) return;

    const submission = await prisma.designSubmission.findFirst({
      where: { id: req.params.subId, sharedDesignId: req.params.designId, status: 'pending' },
    });

    if (!submission) {
      return res.status(404).json({ error: 'Pending submission not found' });
    }

    const { reviewNote } = req.body || {};
    if (!reviewNote || !reviewNote.trim()) {
      return res.status(400).json({ error: 'A review note is required when denying a submission' });
    }

    const updatedSubmission = await prisma.designSubmission.update({
      where: { id: req.params.subId },
      data: {
        status: 'denied',
        reviewNote: reviewNote.trim(),
      },
    });

    // Notify submitter
    if (submission.submitterId !== req.user.id) {
      const sharedDesign = await prisma.sharedDesign.findUnique({
        where: { id: req.params.designId },
        select: { name: true },
      });

      await createNotification(submission.submitterId, 'submission_denied', {
        teamId: req.params.teamId,
        sharedDesignId: req.params.designId,
        submissionId: submission.id,
        designName: sharedDesign?.name,
        deniedBy: req.user.email,
        reviewNote: reviewNote.trim(),
      });
    }

    res.json(updatedSubmission);
  } catch (error) {
    console.error('Deny submission error:', error);
    res.status(500).json({ error: 'Failed to deny submission' });
  }
});

// GET /api/teams/:teamId/designs/:designId/submissions/:subId/comments — List submission comments
router.get('/:subId/comments', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    const comments = await prisma.submissionComment.findMany({
      where: { submissionId: req.params.subId },
      include: {
        author: { select: { id: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json(comments);
  } catch (error) {
    console.error('List submission comments error:', error);
    res.status(500).json({ error: 'Failed to list comments' });
  }
});

// POST /api/teams/:teamId/designs/:designId/submissions/:subId/comments — Add comment on submission
router.post('/:subId/comments', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    const frozen = await checkTeamFrozen(req, res);
    if (frozen) return;

    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment content is required' });
    }

    // Verify submission exists
    const submission = await prisma.designSubmission.findFirst({
      where: { id: req.params.subId, sharedDesignId: req.params.designId },
    });

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const comment = await prisma.submissionComment.create({
      data: {
        submissionId: req.params.subId,
        authorId: req.user.id,
        content: content.trim(),
      },
      include: {
        author: { select: { id: true, email: true } },
      },
    });

    // Notify submitter + team admin + prior commenters (excluding self)
    const sharedDesign = await prisma.sharedDesign.findFirst({
      where: { id: req.params.designId, teamId: req.params.teamId },
      include: { team: { select: { createdById: true } } },
    });

    const priorComments = await prisma.submissionComment.findMany({
      where: { submissionId: req.params.subId, id: { not: comment.id } },
      select: { authorId: true },
      distinct: ['authorId'],
    });

    const notifyUserIds = new Set();
    // Notify submitter
    if (submission.submitterId !== req.user.id) {
      notifyUserIds.add(submission.submitterId);
    }
    // Notify team admin
    if (sharedDesign && sharedDesign.team.createdById !== req.user.id) {
      notifyUserIds.add(sharedDesign.team.createdById);
    }
    // Notify prior commenters
    for (const c of priorComments) {
      if (c.authorId !== req.user.id) {
        notifyUserIds.add(c.authorId);
      }
    }

    const commentPreview = content.trim().substring(0, 100);

    await Promise.all(
      [...notifyUserIds].map(userId =>
        createNotification(userId, 'submission_comment', {
          teamId: req.params.teamId,
          sharedDesignId: req.params.designId,
          submissionId: req.params.subId,
          designName: sharedDesign?.name,
          commentBy: req.user.email,
          commentPreview,
        })
      )
    );

    res.status(201).json(comment);
  } catch (error) {
    console.error('Create submission comment error:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// DELETE /api/teams/:teamId/designs/:designId/submissions/:subId/comments/:commentId — Delete comment
router.delete('/:subId/comments/:commentId', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    const comment = await prisma.submissionComment.findFirst({
      where: { id: req.params.commentId, submissionId: req.params.subId },
    });

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Only comment author or team admin can delete
    if (comment.authorId !== req.user.id && member.role !== 'admin') {
      return res.status(403).json({ error: 'Only the comment author or a team admin can delete this comment' });
    }

    await prisma.submissionComment.delete({ where: { id: req.params.commentId } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete submission comment error:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

module.exports = router;
