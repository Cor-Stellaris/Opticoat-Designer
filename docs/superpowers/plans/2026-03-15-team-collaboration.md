# Team Collaboration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add team collaboration (shared designs, submission/review workflow, discussion threads, notifications) to the Enterprise tier.

**Architecture:** New Prisma models (Team, TeamMember, TeamInvitation, SharedDesign, DesignSubmission, DesignComment, SubmissionComment, Notification) + 5 new backend route files + new "Team" tab in the frontend single-file app + notification bell in header.

**Tech Stack:** Prisma 7 / PostgreSQL, Express 5, React 19, lucide-react icons, existing apiClient helpers.

**Spec:** `docs/superpowers/specs/2026-03-15-team-collaboration-design.md`

---

## File Structure

### New Files
- `server/src/routes/teams.js` — Team CRUD, membership, admin transfer
- `server/src/routes/invitations.js` — List/accept/decline invitations
- `server/src/routes/sharedDesigns.js` — Shared design CRUD, clone, status
- `server/src/routes/submissions.js` — Submit, approve, deny, comments
- `server/src/routes/notifications.js` — List, unread count, mark read

### Modified Files
- `server/prisma/schema.prisma` — Add 8 new models + User/Design relation additions
- `server/src/services/tierLimits.js` — Add teamCollaboration flags to all tiers
- `server/src/index.js` — Register 5 new route files
- `src/opticoat-designer.js` — New Team tab + notification bell (~1500-2000 lines)
- `src/services/apiClient.js` — No changes needed (apiGet/Post/Put/Delete all exist)

---

## Chunk 1: Database Schema & Tier Limits

### Task 1: Add new Prisma models to schema

**Files:**
- Modify: `server/prisma/schema.prisma`

- [ ] **Step 1: Add Team model after ApiKey model**

Add at end of `server/prisma/schema.prisma`:

```prisma
model Team {
  id            String           @id @default(cuid())
  name          String
  createdById   String
  createdBy     User             @relation("TeamsCreated", fields: [createdById], references: [id])
  members       TeamMember[]
  sharedDesigns SharedDesign[]
  invitations   TeamInvitation[]
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt
}

model TeamMember {
  id       String   @id @default(cuid())
  teamId   String
  team     Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  userId   String
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  role     String   @default("member")
  joinedAt DateTime @default(now())

  @@unique([teamId, userId])
  @@index([teamId])
  @@index([userId])
}

model TeamInvitation {
  id          String   @id @default(cuid())
  teamId      String
  team        Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  email       String
  invitedById String
  invitedBy   User     @relation("TeamInvitations", fields: [invitedById], references: [id])
  status      String   @default("pending")
  createdAt   DateTime @default(now())

  @@unique([teamId, email])
  @@index([email])
}

model SharedDesign {
  id             String             @id @default(cuid())
  teamId         String
  team           Team               @relation(fields: [teamId], references: [id], onDelete: Cascade)
  ownerId        String
  owner          User               @relation("SharedDesignsOwned", fields: [ownerId], references: [id])
  sourceDesignId String?
  sourceDesign   Design?            @relation(fields: [sourceDesignId], references: [id], onDelete: SetNull)
  name           String
  data           Json
  status         String             @default("draft")
  submissions    DesignSubmission[]
  comments       DesignComment[]
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt

  @@index([teamId])
  @@index([ownerId])
}

model DesignSubmission {
  id             String              @id @default(cuid())
  sharedDesignId String
  sharedDesign   SharedDesign        @relation(fields: [sharedDesignId], references: [id], onDelete: Cascade)
  submitterId    String
  submitter      User                @relation("DesignSubmissions", fields: [submitterId], references: [id])
  sourceDesignId String?
  sourceDesign   Design?             @relation(fields: [sourceDesignId], references: [id], onDelete: SetNull)
  data           Json
  notes          String
  status         String              @default("pending")
  reviewNote     String?
  comments       SubmissionComment[]
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  @@index([sharedDesignId])
  @@index([sharedDesignId, status])
  @@index([submitterId])
}

model DesignComment {
  id             String       @id @default(cuid())
  sharedDesignId String
  sharedDesign   SharedDesign @relation(fields: [sharedDesignId], references: [id], onDelete: Cascade)
  authorId       String
  author         User         @relation("DesignComments", fields: [authorId], references: [id])
  content        String
  createdAt      DateTime     @default(now())

  @@index([sharedDesignId])
}

model SubmissionComment {
  id           String           @id @default(cuid())
  submissionId String
  submission   DesignSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  authorId     String
  author       User             @relation("SubmissionComments", fields: [authorId], references: [id])
  content      String
  createdAt    DateTime         @default(now())

  @@index([submissionId])
}

model Notification {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  type      String
  data      Json
  read      Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([userId])
  @@index([userId, read])
}
```

- [ ] **Step 2: Add relations to existing User model**

In the User model (lines 9-23 of schema.prisma), add these relations after the existing `apiKeys` line:

```prisma
  teamsCreated       Team[]              @relation("TeamsCreated")
  teamMemberships    TeamMember[]
  teamInvitations    TeamInvitation[]    @relation("TeamInvitations")
  sharedDesigns      SharedDesign[]      @relation("SharedDesignsOwned")
  submissions        DesignSubmission[]  @relation("DesignSubmissions")
  designComments     DesignComment[]     @relation("DesignComments")
  submissionComments SubmissionComment[] @relation("SubmissionComments")
  notifications      Notification[]
```

- [ ] **Step 3: Add relations to existing Design model**

In the Design model (lines 25-35), add after the `updatedAt` field:

```prisma
  sharedDesigns     SharedDesign[]
  designSubmissions DesignSubmission[]
```

- [ ] **Step 4: Generate Prisma client and push schema**

Run:
```bash
cd server && npx prisma generate && npx prisma db push
```

Expected: Schema synced to database, client regenerated with new models.

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma
git commit -m "feat: add team collaboration models to Prisma schema"
```

### Task 2: Update tier limits

**Files:**
- Modify: `server/src/services/tierLimits.js`

- [ ] **Step 1: Add teamCollaboration fields to free tier**

In the `free` object (around line 12), add before the closing brace:

```js
    teamCollaboration: false,
    maxTeams: 0,
    maxTeamSeats: 0,
```

- [ ] **Step 2: Add teamCollaboration fields to starter tier**

In the `starter` object (around line 40), add before the closing brace:

```js
    teamCollaboration: false,
    maxTeams: 0,
    maxTeamSeats: 0,
```

- [ ] **Step 3: Add teamCollaboration fields to professional tier**

In the `professional` object (around line 70), add before the closing brace:

```js
    teamCollaboration: false,
    maxTeams: 0,
    maxTeamSeats: 0,
```

- [ ] **Step 4: Update enterprise tier with team fields**

In the `enterprise` object (around line 95), replace the existing `teamMembers: 5` and `additionalSeatPrice: 49` lines with:

```js
    teamCollaboration: true,
    maxTeams: 3,
    maxTeamSeats: 5,
    additionalSeatPrice: 49,
```

- [ ] **Step 5: Commit**

```bash
git add server/src/services/tierLimits.js
git commit -m "feat: add teamCollaboration tier limits to all tiers"
```

---

## Chunk 2: Backend Routes — Teams & Invitations

### Task 3: Create teams route

**Files:**
- Create: `server/src/routes/teams.js`

- [ ] **Step 1: Create the teams route file**

Create `server/src/routes/teams.js`:

```js
const express = require('express');
const router = express.Router();
const { requireUser, prisma } = require('../middleware/auth');
const { TIER_LIMITS } = require('../services/tierLimits');

// Helper: check if user is a member of the team
async function requireTeamMember(req, res) {
  const member = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: req.params.teamId, userId: req.user.id } },
  });
  if (!member) {
    res.status(404).json({ error: 'Team not found' });
    return null;
  }
  return member;
}

// Helper: check if user is admin of the team
async function requireTeamAdmin(req, res) {
  const member = await requireTeamMember(req, res);
  if (!member) return null;
  if (member.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }
  return member;
}

// Helper: count unique seats across all teams this user owns (as admin)
async function countUniqueSeats(adminUserId) {
  const teams = await prisma.team.findMany({
    where: { createdById: adminUserId },
    select: { id: true },
  });
  if (teams.length === 0) return 0;
  const teamIds = teams.map(t => t.id);
  const members = await prisma.teamMember.findMany({
    where: { teamId: { in: teamIds }, role: 'member' },
    select: { userId: true },
    distinct: ['userId'],
  });
  return members.length;
}

// Helper: create a notification
async function createNotification(userId, type, data) {
  await prisma.notification.create({
    data: { userId, type, data },
  });
}

// POST /api/teams — Create a team
router.post('/', ...requireUser, async (req, res) => {
  try {
    const limits = TIER_LIMITS[req.user.tier] || TIER_LIMITS.free;
    if (!limits.teamCollaboration) {
      return res.status(403).json({ error: 'Team collaboration requires Enterprise tier', currentTier: req.user.tier });
    }

    const teamCount = await prisma.team.count({ where: { createdById: req.user.id } });
    if (limits.maxTeams !== -1 && teamCount >= limits.maxTeams) {
      return res.status(403).json({
        error: 'Team creation limit reached',
        current: teamCount,
        max: limits.maxTeams,
        currentTier: req.user.tier,
      });
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
          create: { userId: req.user.id, role: 'admin' },
        },
      },
      include: {
        members: { include: { user: { select: { id: true, email: true } } } },
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
    const limits = TIER_LIMITS[req.user.tier] || TIER_LIMITS.free;
    if (!limits.teamCollaboration) {
      return res.status(403).json({ error: 'Team collaboration requires Enterprise tier', currentTier: req.user.tier });
    }

    const memberships = await prisma.teamMember.findMany({
      where: { userId: req.user.id },
      include: {
        team: {
          include: {
            members: { include: { user: { select: { id: true, email: true } } } },
            _count: { select: { sharedDesigns: true } },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
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

// GET /api/teams/:teamId — Get team details
router.get('/:teamId', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    const team = await prisma.team.findUnique({
      where: { id: req.params.teamId },
      include: {
        members: {
          include: { user: { select: { id: true, email: true } } },
          orderBy: { joinedAt: 'asc' },
        },
        invitations: {
          where: { status: 'pending' },
          orderBy: { createdAt: 'desc' },
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

// PUT /api/teams/:teamId — Update team name (admin only)
router.put('/:teamId', ...requireUser, async (req, res) => {
  try {
    const admin = await requireTeamAdmin(req, res);
    if (!admin) return;

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

// DELETE /api/teams/:teamId — Delete team (admin only)
router.delete('/:teamId', ...requireUser, async (req, res) => {
  try {
    const admin = await requireTeamAdmin(req, res);
    if (!admin) return;

    await prisma.team.delete({ where: { id: req.params.teamId } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete team error:', error);
    res.status(500).json({ error: 'Failed to delete team' });
  }
});

// POST /api/teams/:teamId/invite — Invite by email (admin only)
router.post('/:teamId/invite', ...requireUser, async (req, res) => {
  try {
    const admin = await requireTeamAdmin(req, res);
    if (!admin) return;

    const { email } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check seat limits
    const limits = TIER_LIMITS[req.user.tier] || TIER_LIMITS.free;
    if (limits.maxTeamSeats !== -1) {
      const seatCount = await countUniqueSeats(req.user.id);
      if (seatCount >= limits.maxTeamSeats) {
        return res.status(403).json({
          error: 'Team seat limit reached. Purchase additional seats to invite more members.',
          current: seatCount,
          max: limits.maxTeamSeats,
          currentTier: req.user.tier,
        });
      }
    }

    // Check if already a member
    const existingUser = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (existingUser) {
      const existingMember = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: req.params.teamId, userId: existingUser.id } },
      });
      if (existingMember) {
        return res.status(400).json({ error: 'User is already a team member' });
      }
    }

    // Check if invitation already pending
    const existingInvite = await prisma.teamInvitation.findUnique({
      where: { teamId_email: { teamId: req.params.teamId, email: email.trim().toLowerCase() } },
    });
    if (existingInvite && existingInvite.status === 'pending') {
      return res.status(400).json({ error: 'Invitation already pending for this email' });
    }

    const invitation = await prisma.teamInvitation.upsert({
      where: { teamId_email: { teamId: req.params.teamId, email: email.trim().toLowerCase() } },
      update: { status: 'pending', invitedById: req.user.id },
      create: {
        teamId: req.params.teamId,
        email: email.trim().toLowerCase(),
        invitedById: req.user.id,
      },
    });

    // Create notification for invitee if they have an account
    if (existingUser) {
      const team = await prisma.team.findUnique({ where: { id: req.params.teamId }, select: { name: true } });
      await createNotification(existingUser.id, 'team_invite', {
        teamId: req.params.teamId,
        teamName: team.name,
        inviterName: req.user.email,
        invitationId: invitation.id,
      });
    }

    res.status(201).json(invitation);
  } catch (error) {
    console.error('Invite member error:', error);
    res.status(500).json({ error: 'Failed to send invitation' });
  }
});

// DELETE /api/teams/:teamId/members/:userId — Remove member (admin only)
router.delete('/:teamId/members/:userId', ...requireUser, async (req, res) => {
  try {
    const admin = await requireTeamAdmin(req, res);
    if (!admin) return;

    if (req.params.userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot remove yourself. Transfer admin or delete the team.' });
    }

    const member = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: req.params.teamId, userId: req.params.userId } },
    });
    if (!member) {
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

// POST /api/teams/:teamId/leave — Leave team (non-admin)
router.post('/:teamId/leave', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    if (member.role === 'admin') {
      return res.status(400).json({ error: 'Admin cannot leave. Transfer admin role first or delete the team.' });
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
    const admin = await requireTeamAdmin(req, res);
    if (!admin) return;

    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const targetMember = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: req.params.teamId, userId } },
      include: { user: true },
    });
    if (!targetMember) {
      return res.status(404).json({ error: 'Target member not found in this team' });
    }

    // New admin must be enterprise tier
    if (targetMember.user.tier !== 'enterprise') {
      return res.status(400).json({ error: 'New admin must have Enterprise tier subscription' });
    }

    // Swap roles in a transaction
    await prisma.$transaction([
      prisma.teamMember.update({
        where: { teamId_userId: { teamId: req.params.teamId, userId: req.user.id } },
        data: { role: 'member' },
      }),
      prisma.teamMember.update({
        where: { teamId_userId: { teamId: req.params.teamId, userId } },
        data: { role: 'admin' },
      }),
      prisma.team.update({
        where: { id: req.params.teamId },
        data: { createdById: userId },
      }),
    ]);

    res.json({ success: true });
  } catch (error) {
    console.error('Transfer admin error:', error);
    res.status(500).json({ error: 'Failed to transfer admin role' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/teams.js
git commit -m "feat: add teams API route (CRUD, invite, membership, admin transfer)"
```

### Task 4: Create invitations route

**Files:**
- Create: `server/src/routes/invitations.js`

- [ ] **Step 1: Create the invitations route file**

Create `server/src/routes/invitations.js`:

```js
const express = require('express');
const router = express.Router();
const { requireUser, prisma } = require('../middleware/auth');
const { TIER_LIMITS } = require('../services/tierLimits');

// Helper: create a notification
async function createNotification(userId, type, data) {
  await prisma.notification.create({
    data: { userId, type, data },
  });
}

// GET /api/invitations — List current user's pending invitations
router.get('/', ...requireUser, async (req, res) => {
  try {
    const limits = TIER_LIMITS[req.user.tier] || TIER_LIMITS.free;
    if (!limits.teamCollaboration) {
      return res.status(403).json({ error: 'Team collaboration requires Enterprise tier', currentTier: req.user.tier });
    }

    const invitations = await prisma.teamInvitation.findMany({
      where: {
        email: req.user.email.toLowerCase(),
        status: 'pending',
      },
      include: {
        team: { select: { id: true, name: true } },
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

// POST /api/invitations/:invitationId/accept
router.post('/:invitationId/accept', ...requireUser, async (req, res) => {
  try {
    const limits = TIER_LIMITS[req.user.tier] || TIER_LIMITS.free;
    if (!limits.teamCollaboration) {
      return res.status(403).json({ error: 'Team collaboration requires Enterprise tier', currentTier: req.user.tier });
    }

    const invitation = await prisma.teamInvitation.findFirst({
      where: {
        id: req.params.invitationId,
        email: req.user.email.toLowerCase(),
        status: 'pending',
      },
      include: { team: { select: { id: true, name: true, createdById: true } } },
    });

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }

    // Accept invitation + add as member in transaction
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

    res.json({ success: true, teamId: invitation.teamId });
  } catch (error) {
    console.error('Accept invitation error:', error);
    res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

// POST /api/invitations/:invitationId/decline
router.post('/:invitationId/decline', ...requireUser, async (req, res) => {
  try {
    const invitation = await prisma.teamInvitation.findFirst({
      where: {
        id: req.params.invitationId,
        email: req.user.email.toLowerCase(),
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
```

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/invitations.js
git commit -m "feat: add invitations API route (list, accept, decline)"
```

### Task 5: Create shared designs route

**Files:**
- Create: `server/src/routes/sharedDesigns.js`

- [ ] **Step 1: Create the shared designs route file**

Create `server/src/routes/sharedDesigns.js`:

```js
const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireUser, prisma } = require('../middleware/auth');

// Helper: check team membership
async function requireTeamMember(req, res) {
  const member = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: req.params.teamId, userId: req.user.id } },
  });
  if (!member) {
    res.status(404).json({ error: 'Team not found' });
    return null;
  }
  return member;
}

async function requireTeamAdmin(req, res) {
  const member = await requireTeamMember(req, res);
  if (!member) return null;
  if (member.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }
  return member;
}

// Helper: check if team is frozen (admin subscription lapsed)
async function checkTeamFrozen(req, res) {
  const team = await prisma.team.findUnique({
    where: { id: req.params.teamId },
    include: { createdBy: { select: { tier: true } } },
  });
  if (team && team.createdBy.tier !== 'enterprise') {
    res.status(403).json({ error: 'Team is frozen — the team owner\'s subscription is inactive' });
    return true;
  }
  return false;
}

async function createNotification(userId, type, data) {
  await prisma.notification.create({ data: { userId, type, data } });
}

// GET /api/teams/:teamId/designs — List shared designs
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
    if (await checkTeamFrozen(req, res)) return;

    const { name, data, sourceDesignId } = req.body;
    if (!name || !data) {
      return res.status(400).json({ error: 'Name and data are required' });
    }

    const sharedDesign = await prisma.sharedDesign.create({
      data: {
        teamId: req.params.teamId,
        ownerId: req.user.id,
        sourceDesignId: sourceDesignId || null,
        name: name.trim(),
        data,
        status: 'draft',
      },
      include: {
        owner: { select: { id: true, email: true } },
      },
    });

    // Notify all other team members
    const members = await prisma.teamMember.findMany({
      where: { teamId: req.params.teamId, userId: { not: req.user.id } },
      select: { userId: true },
    });
    const team = await prisma.team.findUnique({ where: { id: req.params.teamId }, select: { name: true } });
    for (const m of members) {
      await createNotification(m.userId, 'design_shared', {
        teamId: req.params.teamId,
        teamName: team.name,
        designName: name.trim(),
        ownerName: req.user.email,
      });
    }

    res.status(201).json(sharedDesign);
  } catch (error) {
    console.error('Share design error:', error);
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
          include: { author: { select: { id: true, email: true } } },
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

// PUT /api/teams/:teamId/designs/:designId/status — Update status (admin only)
router.put('/:designId/status', ...requireUser, async (req, res) => {
  try {
    const admin = await requireTeamAdmin(req, res);
    if (!admin) return;
    if (await checkTeamFrozen(req, res)) return;

    const { status } = req.body;
    const validStatuses = ['draft', 'in_review', 'approved', 'production', 'archived'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be: ' + validStatuses.join(', ') });
    }

    const design = await prisma.sharedDesign.update({
      where: { id: req.params.designId },
      data: { status },
    });

    res.json(design);
  } catch (error) {
    console.error('Update design status error:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// DELETE /api/teams/:teamId/designs/:designId — Remove shared design (owner or admin)
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
      return res.status(403).json({ error: 'Only the design owner or team admin can delete' });
    }

    await prisma.sharedDesign.delete({ where: { id: design.id } });
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
        name: sharedDesign.name + ' (cloned)',
        data: sharedDesign.data,
      },
    });

    res.status(201).json(clone);
  } catch (error) {
    console.error('Clone design error:', error);
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
      include: { author: { select: { id: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });

    res.json(comments);
  } catch (error) {
    console.error('List design comments error:', error);
    res.status(500).json({ error: 'Failed to list comments' });
  }
});

// POST /api/teams/:teamId/designs/:designId/comments — Add comment
router.post('/:designId/comments', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;
    if (await checkTeamFrozen(req, res)) return;

    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment content is required' });
    }

    const comment = await prisma.designComment.create({
      data: {
        sharedDesignId: req.params.designId,
        authorId: req.user.id,
        content: content.trim(),
      },
      include: { author: { select: { id: true, email: true } } },
    });

    // Notify design owner + prior commenters (excluding the commenter)
    const design = await prisma.sharedDesign.findUnique({
      where: { id: req.params.designId },
      select: { ownerId: true, name: true, teamId: true },
    });
    const team = await prisma.team.findUnique({ where: { id: design.teamId }, select: { name: true } });
    const priorCommenters = await prisma.designComment.findMany({
      where: { sharedDesignId: req.params.designId, authorId: { not: req.user.id } },
      select: { authorId: true },
      distinct: ['authorId'],
    });
    const notifyIds = new Set([design.ownerId, ...priorCommenters.map(c => c.authorId)]);
    notifyIds.delete(req.user.id);
    for (const uid of notifyIds) {
      await createNotification(uid, 'comment_design', {
        teamId: design.teamId,
        teamName: team.name,
        designName: design.name,
        authorName: req.user.email,
        commentPreview: content.trim().substring(0, 100),
      });
    }

    res.status(201).json(comment);
  } catch (error) {
    console.error('Add design comment error:', error);
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

    if (comment.authorId !== req.user.id && member.role !== 'admin') {
      return res.status(403).json({ error: 'Can only delete your own comments' });
    }

    await prisma.designComment.delete({ where: { id: comment.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete design comment error:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/sharedDesigns.js
git commit -m "feat: add shared designs API route (CRUD, clone, status, comments)"
```

### Task 6: Create submissions route

**Files:**
- Create: `server/src/routes/submissions.js`

- [ ] **Step 1: Create the submissions route file**

Create `server/src/routes/submissions.js`:

```js
const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireUser, prisma } = require('../middleware/auth');

async function requireTeamMember(req, res) {
  const member = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: req.params.teamId, userId: req.user.id } },
  });
  if (!member) {
    res.status(404).json({ error: 'Team not found' });
    return null;
  }
  return member;
}

async function requireTeamAdmin(req, res) {
  const member = await requireTeamMember(req, res);
  if (!member) return null;
  if (member.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }
  return member;
}

async function checkTeamFrozen(req, res) {
  const team = await prisma.team.findUnique({
    where: { id: req.params.teamId },
    include: { createdBy: { select: { tier: true } } },
  });
  if (team && team.createdBy.tier !== 'enterprise') {
    res.status(403).json({ error: 'Team is frozen — the team owner\'s subscription is inactive' });
    return true;
  }
  return false;
}

async function createNotification(userId, type, data) {
  await prisma.notification.create({ data: { userId, type, data } });
}

// GET .../submissions — List submissions for a shared design
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

// POST .../submissions — Submit a modified design for review
router.post('/', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;
    if (await checkTeamFrozen(req, res)) return;

    const { data, notes, sourceDesignId } = req.body;
    if (!data || !notes || !notes.trim()) {
      return res.status(400).json({ error: 'Design data and notes are required' });
    }

    // Verify the shared design exists
    const sharedDesign = await prisma.sharedDesign.findFirst({
      where: { id: req.params.designId, teamId: req.params.teamId },
      select: { id: true, name: true, teamId: true },
    });
    if (!sharedDesign) {
      return res.status(404).json({ error: 'Shared design not found' });
    }

    const submission = await prisma.designSubmission.create({
      data: {
        sharedDesignId: req.params.designId,
        submitterId: req.user.id,
        sourceDesignId: sourceDesignId || null,
        data,
        notes: notes.trim(),
      },
      include: {
        submitter: { select: { id: true, email: true } },
      },
    });

    // Notify team admin
    const team = await prisma.team.findUnique({
      where: { id: req.params.teamId },
      select: { name: true, createdById: true },
    });
    await createNotification(team.createdById, 'submission_new', {
      teamId: req.params.teamId,
      teamName: team.name,
      designName: sharedDesign.name,
      submitterName: req.user.email,
      submissionId: submission.id,
    });

    res.status(201).json(submission);
  } catch (error) {
    console.error('Create submission error:', error);
    res.status(500).json({ error: 'Failed to submit design' });
  }
});

// GET .../submissions/:subId — Get submission detail
router.get('/:subId', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    const submission = await prisma.designSubmission.findFirst({
      where: { id: req.params.subId, sharedDesignId: req.params.designId },
      include: {
        submitter: { select: { id: true, email: true } },
        comments: {
          include: { author: { select: { id: true, email: true } } },
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

// POST .../submissions/:subId/approve — Approve (admin only)
router.post('/:subId/approve', ...requireUser, async (req, res) => {
  try {
    const admin = await requireTeamAdmin(req, res);
    if (!admin) return;
    if (await checkTeamFrozen(req, res)) return;

    const submission = await prisma.designSubmission.findFirst({
      where: { id: req.params.subId, sharedDesignId: req.params.designId, status: 'pending' },
    });
    if (!submission) {
      return res.status(404).json({ error: 'Pending submission not found' });
    }

    const { reviewNote } = req.body;

    // Approve: update submission status + replace shared design data
    await prisma.$transaction([
      prisma.designSubmission.update({
        where: { id: submission.id },
        data: { status: 'approved', reviewNote: reviewNote || null },
      }),
      prisma.sharedDesign.update({
        where: { id: req.params.designId },
        data: { data: submission.data },
      }),
    ]);

    // Notify submitter
    const sharedDesign = await prisma.sharedDesign.findUnique({
      where: { id: req.params.designId },
      select: { name: true, teamId: true },
    });
    const team = await prisma.team.findUnique({ where: { id: sharedDesign.teamId }, select: { name: true } });
    await createNotification(submission.submitterId, 'submission_approved', {
      teamId: sharedDesign.teamId,
      teamName: team.name,
      designName: sharedDesign.name,
      reviewNote: reviewNote || '',
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Approve submission error:', error);
    res.status(500).json({ error: 'Failed to approve submission' });
  }
});

// POST .../submissions/:subId/deny — Deny (admin only)
router.post('/:subId/deny', ...requireUser, async (req, res) => {
  try {
    const admin = await requireTeamAdmin(req, res);
    if (!admin) return;

    const submission = await prisma.designSubmission.findFirst({
      where: { id: req.params.subId, sharedDesignId: req.params.designId, status: 'pending' },
    });
    if (!submission) {
      return res.status(404).json({ error: 'Pending submission not found' });
    }

    const { reviewNote } = req.body;
    if (!reviewNote || !reviewNote.trim()) {
      return res.status(400).json({ error: 'Review note is required when denying a submission' });
    }

    await prisma.designSubmission.update({
      where: { id: submission.id },
      data: { status: 'denied', reviewNote: reviewNote.trim() },
    });

    // Notify submitter
    const sharedDesign = await prisma.sharedDesign.findUnique({
      where: { id: req.params.designId },
      select: { name: true, teamId: true },
    });
    const team = await prisma.team.findUnique({ where: { id: sharedDesign.teamId }, select: { name: true } });
    await createNotification(submission.submitterId, 'submission_denied', {
      teamId: sharedDesign.teamId,
      teamName: team.name,
      designName: sharedDesign.name,
      reviewNote: reviewNote.trim(),
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Deny submission error:', error);
    res.status(500).json({ error: 'Failed to deny submission' });
  }
});

// GET .../submissions/:subId/comments — List submission comments
router.get('/:subId/comments', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;

    const comments = await prisma.submissionComment.findMany({
      where: { submissionId: req.params.subId },
      include: { author: { select: { id: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });

    res.json(comments);
  } catch (error) {
    console.error('List submission comments error:', error);
    res.status(500).json({ error: 'Failed to list comments' });
  }
});

// POST .../submissions/:subId/comments — Add comment on submission
router.post('/:subId/comments', ...requireUser, async (req, res) => {
  try {
    const member = await requireTeamMember(req, res);
    if (!member) return;
    if (await checkTeamFrozen(req, res)) return;

    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment content is required' });
    }

    const submission = await prisma.designSubmission.findFirst({
      where: { id: req.params.subId, sharedDesignId: req.params.designId },
      select: { id: true, submitterId: true, sharedDesignId: true },
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
      include: { author: { select: { id: true, email: true } } },
    });

    // Notify submitter + admin + prior commenters
    const sharedDesign = await prisma.sharedDesign.findUnique({
      where: { id: submission.sharedDesignId },
      select: { name: true, teamId: true },
    });
    const team = await prisma.team.findUnique({
      where: { id: sharedDesign.teamId },
      select: { name: true, createdById: true },
    });
    const priorCommenters = await prisma.submissionComment.findMany({
      where: { submissionId: req.params.subId, authorId: { not: req.user.id } },
      select: { authorId: true },
      distinct: ['authorId'],
    });
    const notifyIds = new Set([
      submission.submitterId,
      team.createdById,
      ...priorCommenters.map(c => c.authorId),
    ]);
    notifyIds.delete(req.user.id);
    for (const uid of notifyIds) {
      await createNotification(uid, 'comment_submission', {
        teamId: sharedDesign.teamId,
        teamName: team.name,
        designName: sharedDesign.name,
        authorName: req.user.email,
        commentPreview: content.trim().substring(0, 100),
      });
    }

    res.status(201).json(comment);
  } catch (error) {
    console.error('Add submission comment error:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// DELETE .../submissions/:subId/comments/:commentId — Delete comment
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

    if (comment.authorId !== req.user.id && member.role !== 'admin') {
      return res.status(403).json({ error: 'Can only delete your own comments' });
    }

    await prisma.submissionComment.delete({ where: { id: comment.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete submission comment error:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/submissions.js
git commit -m "feat: add submissions API route (submit, approve, deny, comments)"
```

### Task 7: Create notifications route

**Files:**
- Create: `server/src/routes/notifications.js`

- [ ] **Step 1: Create the notifications route file**

Create `server/src/routes/notifications.js`:

```js
const express = require('express');
const router = express.Router();
const { requireUser, prisma } = require('../middleware/auth');

// GET /api/notifications — List user's notifications (paginated)
router.get('/', ...requireUser, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where: { userId: req.user.id } }),
    ]);

    res.json({ notifications, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('List notifications error:', error);
    res.status(500).json({ error: 'Failed to list notifications' });
  }
});

// GET /api/notifications/unread-count
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

// PUT /api/notifications/:id/read — Mark as read
router.put('/:id/read', ...requireUser, async (req, res) => {
  try {
    const notification = await prisma.notification.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    await prisma.notification.update({
      where: { id: notification.id },
      data: { read: true },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// PUT /api/notifications/read-all — Mark all as read
router.put('/read-all', ...requireUser, async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, read: false },
      data: { read: true },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/notifications.js
git commit -m "feat: add notifications API route (list, unread count, mark read)"
```

### Task 8: Register all new routes in server index

**Files:**
- Modify: `server/src/index.js`

- [ ] **Step 1: Add route imports and registrations**

In `server/src/index.js`, inside the `if (hasDatabase)` block, after the existing route imports (around where `trackingRouter` is imported), add:

```js
    const teamsRouter = require('./routes/teams');
    const invitationsRouter = require('./routes/invitations');
    const sharedDesignsRouter = require('./routes/sharedDesigns');
    const submissionsRouter = require('./routes/submissions');
    const notificationsRouter = require('./routes/notifications');
```

And after the existing `app.use('/api/tracking', ...)` line, add:

```js
    app.use('/api/teams', teamsRouter);
    app.use('/api/invitations', invitationsRouter);
    app.use('/api/teams/:teamId/designs', sharedDesignsRouter);
    app.use('/api/teams/:teamId/designs/:designId/submissions', submissionsRouter);
    app.use('/api/notifications', notificationsRouter);
```

- [ ] **Step 2: Commit**

```bash
git add server/src/index.js
git commit -m "feat: register team collaboration routes in server"
```

---

## Chunk 3: Frontend — Team Tab UI

### Task 9: Add Team tab state variables and API helpers

**Files:**
- Modify: `src/opticoat-designer.js`

- [ ] **Step 1: Add lucide-react import for Users icon**

At the top of the file where lucide-react icons are imported (around line 4), add `Users, Bell, Send, Copy, Check, XCircle, UserPlus, Crown, LogOut, MessageSquare` to the existing destructured import:

```js
import { Plus, Trash2, Upload, X, Settings, Zap, TrendingUp, Lock, Info, Library, GripVertical, Users, Bell, Send, Copy, Check, XCircle, UserPlus, Crown, LogOut, MessageSquare } from 'lucide-react';
```

- [ ] **Step 2: Add team-related state variables**

After the existing state declarations (around line 400, after other useState blocks), add:

```js
  // Team collaboration state
  const [teams, setTeams] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [selectedTeamDetail, setSelectedTeamDetail] = useState(null);
  const [teamDesigns, setTeamDesigns] = useState([]);
  const [selectedSharedDesign, setSelectedSharedDesign] = useState(null);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [teamView, setTeamView] = useState('list'); // 'list', 'detail', 'design', 'submission'
  const [teamLoading, setTeamLoading] = useState(false);
  const [pendingInvitations, setPendingInvitations] = useState([]);
  const [showCreateTeamModal, setShowCreateTeamModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showShareToTeamModal, setShowShareToTeamModal] = useState(false);
  const [showSubmitChangesModal, setShowSubmitChangesModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [submissionNotes, setSubmissionNotes] = useState('');
  const [selectedDesignForSubmission, setSelectedDesignForSubmission] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [showNotificationDropdown, setShowNotificationDropdown] = useState(false);
  const [shareToTeamId, setShareToTeamId] = useState(null);
```

- [ ] **Step 3: Add team API helper functions**

After the state variables, add these helper functions (before the existing `useEffect` blocks):

```js
  // --- Team API helpers ---
  const loadTeams = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const data = await apiGet('/api/teams');
      setTeams(data);
    } catch (e) {
      console.warn('Failed to load teams:', e);
    }
  }, [isSignedIn]);

  const loadPendingInvitations = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const data = await apiGet('/api/invitations');
      setPendingInvitations(data);
    } catch (e) {
      console.warn('Failed to load invitations:', e);
    }
  }, [isSignedIn]);

  const loadTeamDetail = useCallback(async (teamId) => {
    try {
      setTeamLoading(true);
      const data = await apiGet(`/api/teams/${teamId}`);
      setSelectedTeamDetail(data);
      const designs = await apiGet(`/api/teams/${teamId}/designs`);
      setTeamDesigns(designs);
    } catch (e) {
      console.warn('Failed to load team detail:', e);
    } finally {
      setTeamLoading(false);
    }
  }, []);

  const loadSharedDesignDetail = useCallback(async (teamId, designId) => {
    try {
      setTeamLoading(true);
      const data = await apiGet(`/api/teams/${teamId}/designs/${designId}`);
      setSelectedSharedDesign(data);
    } catch (e) {
      console.warn('Failed to load shared design:', e);
    } finally {
      setTeamLoading(false);
    }
  }, []);

  const loadSubmissionDetail = useCallback(async (teamId, designId, subId) => {
    try {
      setTeamLoading(true);
      const data = await apiGet(`/api/teams/${teamId}/designs/${designId}/submissions/${subId}`);
      setSelectedSubmission(data);
    } catch (e) {
      console.warn('Failed to load submission:', e);
    } finally {
      setTeamLoading(false);
    }
  }, []);

  const loadUnreadCount = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const data = await apiGet('/api/notifications/unread-count');
      setUnreadNotificationCount(data.count);
    } catch (e) {
      // Silently fail — notifications are non-critical
    }
  }, [isSignedIn]);

  const loadNotifications = useCallback(async () => {
    try {
      const data = await apiGet('/api/notifications');
      setNotifications(data.notifications || []);
    } catch (e) {
      console.warn('Failed to load notifications:', e);
    }
  }, []);

  const handleCreateTeam = useCallback(async () => {
    if (!newTeamName.trim()) return;
    try {
      await apiPost('/api/teams', { name: newTeamName.trim() });
      setShowCreateTeamModal(false);
      setNewTeamName('');
      loadTeams();
    } catch (e) {
      alert('Failed to create team: ' + e.message);
    }
  }, [newTeamName, loadTeams]);

  const handleInviteMember = useCallback(async () => {
    if (!inviteEmail.trim() || !selectedTeamId) return;
    try {
      await apiPost(`/api/teams/${selectedTeamId}/invite`, { email: inviteEmail.trim() });
      setInviteEmail('');
      setShowInviteModal(false);
      loadTeamDetail(selectedTeamId);
    } catch (e) {
      alert('Failed to invite: ' + e.message);
    }
  }, [inviteEmail, selectedTeamId, loadTeamDetail]);

  const handleAcceptInvitation = useCallback(async (invitationId) => {
    try {
      await apiPost(`/api/invitations/${invitationId}/accept`);
      loadPendingInvitations();
      loadTeams();
    } catch (e) {
      alert('Failed to accept invitation: ' + e.message);
    }
  }, [loadPendingInvitations, loadTeams]);

  const handleDeclineInvitation = useCallback(async (invitationId) => {
    try {
      await apiPost(`/api/invitations/${invitationId}/decline`);
      loadPendingInvitations();
    } catch (e) {
      alert('Failed to decline invitation: ' + e.message);
    }
  }, [loadPendingInvitations]);

  const handleShareToTeam = useCallback(async (teamId) => {
    try {
      const designData = {
        layers, layerStacks, currentStackId, substrate, incident,
        wavelengthRange, displayMode, selectedIlluminant, customMaterials,
      };
      const name = prompt('Name for shared design:');
      if (!name) return;
      await apiPost(`/api/teams/${teamId}/designs`, { name, data: designData });
      setShowShareToTeamModal(false);
      alert('Design shared to team!');
      if (selectedTeamId === teamId) loadTeamDetail(teamId);
    } catch (e) {
      alert('Failed to share design: ' + e.message);
    }
  }, [layers, layerStacks, currentStackId, substrate, incident, wavelengthRange, displayMode, selectedIlluminant, customMaterials, selectedTeamId, loadTeamDetail]);

  const handleCloneDesign = useCallback(async (teamId, designId) => {
    try {
      const clone = await apiPost(`/api/teams/${teamId}/designs/${designId}/clone`);
      alert('Design cloned to your workspace! Name: ' + clone.name);
    } catch (e) {
      alert('Failed to clone design: ' + e.message);
    }
  }, []);

  const handleSubmitChanges = useCallback(async () => {
    if (!submissionNotes.trim() || !selectedDesignForSubmission) return;
    try {
      const design = savedDesigns.find(d => d.id === selectedDesignForSubmission);
      if (!design) { alert('Select a design to submit'); return; }
      await apiPost(
        `/api/teams/${selectedTeamId}/designs/${selectedSharedDesign.id}/submissions`,
        { data: design.data, notes: submissionNotes.trim(), sourceDesignId: design.id }
      );
      setShowSubmitChangesModal(false);
      setSubmissionNotes('');
      setSelectedDesignForSubmission(null);
      loadSharedDesignDetail(selectedTeamId, selectedSharedDesign.id);
    } catch (e) {
      alert('Failed to submit: ' + e.message);
    }
  }, [submissionNotes, selectedDesignForSubmission, selectedTeamId, selectedSharedDesign, savedDesigns, loadSharedDesignDetail]);

  const handleApproveSubmission = useCallback(async (subId) => {
    try {
      const reviewNote = prompt('Optional review note:') || '';
      await apiPost(
        `/api/teams/${selectedTeamId}/designs/${selectedSharedDesign.id}/submissions/${subId}/approve`,
        { reviewNote }
      );
      loadSharedDesignDetail(selectedTeamId, selectedSharedDesign.id);
    } catch (e) {
      alert('Failed to approve: ' + e.message);
    }
  }, [selectedTeamId, selectedSharedDesign, loadSharedDesignDetail]);

  const handleDenySubmission = useCallback(async (subId) => {
    try {
      const reviewNote = prompt('Reason for denial (required):');
      if (!reviewNote) return;
      await apiPost(
        `/api/teams/${selectedTeamId}/designs/${selectedSharedDesign.id}/submissions/${subId}/deny`,
        { reviewNote }
      );
      loadSharedDesignDetail(selectedTeamId, selectedSharedDesign.id);
    } catch (e) {
      alert('Failed to deny: ' + e.message);
    }
  }, [selectedTeamId, selectedSharedDesign, loadSharedDesignDetail]);

  const handleAddComment = useCallback(async (type, parentId) => {
    if (!commentText.trim()) return;
    try {
      const basePath = `/api/teams/${selectedTeamId}/designs/${selectedSharedDesign.id}`;
      const path = type === 'design'
        ? `${basePath}/comments`
        : `${basePath}/submissions/${parentId}/comments`;
      await apiPost(path, { content: commentText.trim() });
      setCommentText('');
      loadSharedDesignDetail(selectedTeamId, selectedSharedDesign.id);
    } catch (e) {
      alert('Failed to add comment: ' + e.message);
    }
  }, [commentText, selectedTeamId, selectedSharedDesign, loadSharedDesignDetail]);

  const handleDeleteComment = useCallback(async (type, parentId, commentId) => {
    try {
      const basePath = `/api/teams/${selectedTeamId}/designs/${selectedSharedDesign.id}`;
      const path = type === 'design'
        ? `${basePath}/comments/${commentId}`
        : `${basePath}/submissions/${parentId}/comments/${commentId}`;
      await apiDelete(path);
      loadSharedDesignDetail(selectedTeamId, selectedSharedDesign.id);
    } catch (e) {
      alert('Failed to delete comment: ' + e.message);
    }
  }, [selectedTeamId, selectedSharedDesign, loadSharedDesignDetail]);

  const handleUpdateDesignStatus = useCallback(async (designId, status) => {
    try {
      await apiPut(`/api/teams/${selectedTeamId}/designs/${designId}/status`, { status });
      loadTeamDetail(selectedTeamId);
      if (selectedSharedDesign?.id === designId) {
        loadSharedDesignDetail(selectedTeamId, designId);
      }
    } catch (e) {
      alert('Failed to update status: ' + e.message);
    }
  }, [selectedTeamId, selectedSharedDesign, loadTeamDetail, loadSharedDesignDetail]);

  const handleMarkNotificationRead = useCallback(async (id) => {
    try {
      await apiPut(`/api/notifications/${id}/read`);
      loadUnreadCount();
      loadNotifications();
    } catch (e) {
      console.warn('Failed to mark notification read:', e);
    }
  }, [loadUnreadCount, loadNotifications]);

  const handleMarkAllNotificationsRead = useCallback(async () => {
    try {
      await apiPut('/api/notifications/read-all');
      setUnreadNotificationCount(0);
      loadNotifications();
    } catch (e) {
      console.warn('Failed to mark all read:', e);
    }
  }, [loadNotifications]);
```

- [ ] **Step 4: Add useEffect to load teams and notifications on sign-in**

After the existing `useEffect` that fetches tier data (around line 530), add:

```js
  // Load teams and notifications for enterprise users
  useEffect(() => {
    if (isSignedIn && tierLimits.teamCollaboration) {
      loadTeams();
      loadPendingInvitations();
      loadUnreadCount();
      // Poll unread count every 60 seconds
      const interval = setInterval(loadUnreadCount, 60000);
      return () => clearInterval(interval);
    }
  }, [isSignedIn, tierLimits.teamCollaboration, loadTeams, loadPendingInvitations, loadUnreadCount]);
```

- [ ] **Step 5: Add apiDelete import**

At the top of the file where apiClient is imported, ensure `apiDelete` and `apiPut` are included:

```js
import { apiGet, apiPost, apiPut, apiDelete, apiStream, setTokenProvider } from './services/apiClient';
```

- [ ] **Step 6: Commit**

```bash
git add src/opticoat-designer.js
git commit -m "feat: add team collaboration state variables and API helpers"
```

### Task 10: Add Team tab button and tab content

**Files:**
- Modify: `src/opticoat-designer.js`

- [ ] **Step 1: Add Team tab button in the tab bar**

Find the tab buttons (around line 6037-6058, after the "Design Assistant" tab button and before "Recipe Tracking"). Add the Team tab button between them:

```jsx
            <button
              onClick={() => {
                if (CLERK_ENABLED && !isSignedIn) { setUpgradeFeature('Team Collaboration'); setShowUpgradePrompt(true); return; }
                if (!requireFeature('teamCollaboration', 'Team Collaboration')) return;
                setActiveTab("team");
              }}
              className={`px-4 py-2 rounded-t font-semibold transition-colors flex items-center gap-2 ${
                activeTab === "team"
                  ? "bg-white text-indigo-600 shadow"
                  : "bg-indigo-100 text-gray-600 hover:bg-indigo-200"
              }`}
            >
              <Users size={16} />
              Team
              {unreadNotificationCount > 0 && (
                <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5" style={{ fontSize: '10px', minWidth: '18px', textAlign: 'center' }}>
                  {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                </span>
              )}
            </button>
```

- [ ] **Step 2: Add the Team tab content block**

After the Yield Calculator tab content block (the last `{activeTab === "yield" && (...)}` block), add the full Team tab:

```jsx
          {activeTab === "team" && (
            <div className="bg-white rounded-lg shadow-lg p-4 flex-1 overflow-hidden flex flex-col">
              {/* Team Tab Header */}
              <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <div className="flex items-center gap-3">
                  {teamView !== 'list' && (
                    <button
                      onClick={() => {
                        if (teamView === 'submission') { setTeamView('design'); setSelectedSubmission(null); }
                        else if (teamView === 'design') { setTeamView('detail'); setSelectedSharedDesign(null); }
                        else { setTeamView('list'); setSelectedTeamId(null); setSelectedTeamDetail(null); }
                      }}
                      className="text-indigo-600 text-sm font-medium"
                      style={{ cursor: 'pointer' }}
                    >
                      &larr; Back
                    </button>
                  )}
                  <h2 className="text-lg font-bold text-gray-800">
                    {teamView === 'list' ? 'My Teams' :
                     teamView === 'detail' ? selectedTeamDetail?.name :
                     teamView === 'design' ? selectedSharedDesign?.name :
                     'Submission Review'}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  {teamView === 'list' && (
                    <button
                      onClick={() => setShowCreateTeamModal(true)}
                      className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center gap-1"
                    >
                      <Plus size={14} /> Create Team
                    </button>
                  )}
                  {teamView === 'detail' && selectedTeamDetail?.myRole === 'admin' && (
                    <button
                      onClick={() => setShowInviteModal(true)}
                      className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center gap-1"
                    >
                      <UserPlus size={14} /> Invite Member
                    </button>
                  )}
                  {/* Notification bell */}
                  <div style={{ position: 'relative' }}>
                    <button
                      onClick={() => { setShowNotificationDropdown(!showNotificationDropdown); if (!showNotificationDropdown) loadNotifications(); }}
                      className="p-2 text-gray-600 hover:text-indigo-600 relative"
                    >
                      <Bell size={18} />
                      {unreadNotificationCount > 0 && (
                        <span style={{
                          position: 'absolute', top: '2px', right: '2px',
                          background: '#ef4444', color: 'white', borderRadius: '50%',
                          width: '16px', height: '16px', fontSize: '10px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                        </span>
                      )}
                    </button>
                    {showNotificationDropdown && (
                      <div style={{
                        position: 'absolute', right: 0, top: '100%', width: '320px',
                        background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 50, maxHeight: '400px', overflowY: 'auto',
                      }}>
                        <div className="flex items-center justify-between p-3 border-b">
                          <span className="text-sm font-semibold">Notifications</span>
                          <button onClick={handleMarkAllNotificationsRead} className="text-xs text-indigo-600">Mark all read</button>
                        </div>
                        {notifications.length === 0 ? (
                          <p className="text-sm text-gray-500 p-4 text-center">No notifications</p>
                        ) : (
                          notifications.map(n => (
                            <div
                              key={n.id}
                              onClick={() => handleMarkNotificationRead(n.id)}
                              style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', background: n.read ? 'white' : '#f0f4ff', cursor: 'pointer' }}
                            >
                              <p style={{ fontSize: '13px', color: '#374151', margin: 0 }}>
                                {n.type === 'team_invite' && `You were invited to team "${n.data.teamName}"`}
                                {n.type === 'invite_accepted' && `${n.data.memberEmail} joined your team "${n.data.teamName}"`}
                                {n.type === 'design_shared' && `${n.data.ownerName} shared "${n.data.designName}" in ${n.data.teamName}`}
                                {n.type === 'submission_new' && `${n.data.submitterName} submitted changes to "${n.data.designName}"`}
                                {n.type === 'submission_approved' && `Your submission for "${n.data.designName}" was approved`}
                                {n.type === 'submission_denied' && `Your submission for "${n.data.designName}" was denied`}
                                {n.type === 'comment_design' && `${n.data.authorName} commented on "${n.data.designName}"`}
                                {n.type === 'comment_submission' && `${n.data.authorName} commented on a submission for "${n.data.designName}"`}
                              </p>
                              <p style={{ fontSize: '11px', color: '#9ca3af', margin: '2px 0 0' }}>
                                {new Date(n.createdAt).toLocaleString()}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Pending Invitations Banner */}
              {teamView === 'list' && pendingInvitations.length > 0 && (
                <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded">
                  <p className="text-sm font-semibold text-indigo-800 mb-2">Pending Invitations</p>
                  {pendingInvitations.map(inv => (
                    <div key={inv.id} className="flex items-center justify-between py-1">
                      <span className="text-sm text-gray-700">
                        <strong>{inv.team.name}</strong> — invited by {inv.invitedBy.email}
                      </span>
                      <div className="flex gap-2">
                        <button onClick={() => handleAcceptInvitation(inv.id)} className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700">Accept</button>
                        <button onClick={() => handleDeclineInvitation(inv.id)} className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400">Decline</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Team List View */}
              {teamView === 'list' && (
                <div className="flex-1 overflow-y-auto">
                  {teams.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center py-16">
                      <div className="text-center text-gray-500">
                        <Users size={48} className="mx-auto mb-4 text-gray-400" />
                        <p className="text-lg font-semibold mb-2">No teams yet</p>
                        <p className="text-sm mb-4">Create a team or accept an invitation to get started.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {teams.map(team => (
                        <div
                          key={team.id}
                          onClick={() => { setSelectedTeamId(team.id); setTeamView('detail'); loadTeamDetail(team.id); }}
                          className="flex items-center justify-between p-4 border rounded hover:bg-gray-50"
                          style={{ cursor: 'pointer' }}
                        >
                          <div>
                            <div className="font-medium text-sm">{team.name}</div>
                            <div className="text-xs text-gray-500">
                              {team.memberCount} members &middot; {team.designCount} designs &middot;
                              <span className={team.myRole === 'admin' ? 'text-indigo-600 font-semibold' : ''}> {team.myRole}</span>
                            </div>
                          </div>
                          <span className="text-gray-400">&rsaquo;</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Team Detail View */}
              {teamView === 'detail' && selectedTeamDetail && (
                <div className="flex-1 overflow-y-auto">
                  {teamLoading ? (
                    <p className="text-sm text-gray-500 py-8 text-center">Loading...</p>
                  ) : (
                    <div className="flex gap-4" style={{ minHeight: 0 }}>
                      {/* Left sidebar: Members */}
                      <div style={{ width: '220px', flexShrink: 0 }} className="border-r pr-4">
                        <h3 className="text-sm font-semibold text-gray-700 mb-2">Members ({selectedTeamDetail.members?.length})</h3>
                        <div className="space-y-1">
                          {selectedTeamDetail.members?.map(m => (
                            <div key={m.id} className="flex items-center justify-between text-xs py-1">
                              <span className="truncate" style={{ maxWidth: '140px' }}>{m.user.email}</span>
                              <div className="flex items-center gap-1">
                                {m.role === 'admin' && <Crown size={12} className="text-yellow-500" />}
                                {selectedTeamDetail.myRole === 'admin' && m.user.id !== selectedTeamDetail.createdById && m.role !== 'admin' && (
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      if (confirm('Remove this member?')) {
                                        try { await apiDelete(`/api/teams/${selectedTeamId}/members/${m.user.id}`); loadTeamDetail(selectedTeamId); }
                                        catch (err) { alert('Failed: ' + err.message); }
                                      }
                                    }}
                                    className="text-red-400 hover:text-red-600"
                                  >
                                    <X size={12} />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        {selectedTeamDetail.invitations?.length > 0 && (
                          <>
                            <h3 className="text-sm font-semibold text-gray-700 mt-4 mb-2">Pending Invites</h3>
                            {selectedTeamDetail.invitations.map(inv => (
                              <div key={inv.id} className="text-xs text-gray-500 py-1 truncate">{inv.email}</div>
                            ))}
                          </>
                        )}
                      </div>

                      {/* Right: Shared Designs */}
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-sm font-semibold text-gray-700">Shared Designs</h3>
                          <button
                            onClick={() => setShowShareToTeamModal(true)}
                            className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center gap-1"
                          >
                            <Send size={12} /> Share Design
                          </button>
                        </div>
                        {teamDesigns.length === 0 ? (
                          <p className="text-sm text-gray-500 py-8 text-center">No designs shared yet.</p>
                        ) : (
                          <div className="space-y-2">
                            {teamDesigns.map(d => (
                              <div
                                key={d.id}
                                onClick={() => { setTeamView('design'); loadSharedDesignDetail(selectedTeamId, d.id); }}
                                className="flex items-center justify-between p-3 border rounded hover:bg-gray-50"
                                style={{ cursor: 'pointer' }}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm truncate">{d.name}</span>
                                    <span style={{
                                      fontSize: '10px', padding: '1px 6px', borderRadius: '9999px', fontWeight: 600,
                                      background: d.status === 'draft' ? '#f3f4f6' : d.status === 'in_review' ? '#fef3c7' : d.status === 'approved' ? '#d1fae5' : d.status === 'production' ? '#dbeafe' : '#f3f4f6',
                                      color: d.status === 'draft' ? '#6b7280' : d.status === 'in_review' ? '#92400e' : d.status === 'approved' ? '#065f46' : d.status === 'production' ? '#1e40af' : '#9ca3af',
                                    }}>
                                      {d.status.replace('_', ' ')}
                                    </span>
                                  </div>
                                  <div className="text-xs text-gray-500 mt-1">
                                    by {d.owner.email} &middot; {d._count.submissions} submissions &middot; {d._count.comments} comments
                                  </div>
                                </div>
                                <span className="text-gray-400">&rsaquo;</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Shared Design Detail View */}
              {teamView === 'design' && selectedSharedDesign && (
                <div className="flex-1 overflow-y-auto">
                  {teamLoading ? (
                    <p className="text-sm text-gray-500 py-8 text-center">Loading...</p>
                  ) : (
                    <div>
                      {/* Design header with actions */}
                      <div className="flex items-center justify-between mb-4 pb-3 border-b">
                        <div className="flex items-center gap-3">
                          <span style={{
                            fontSize: '11px', padding: '2px 8px', borderRadius: '9999px', fontWeight: 600,
                            background: selectedSharedDesign.status === 'draft' ? '#f3f4f6' : selectedSharedDesign.status === 'in_review' ? '#fef3c7' : selectedSharedDesign.status === 'approved' ? '#d1fae5' : selectedSharedDesign.status === 'production' ? '#dbeafe' : '#f3f4f6',
                            color: selectedSharedDesign.status === 'draft' ? '#6b7280' : selectedSharedDesign.status === 'in_review' ? '#92400e' : selectedSharedDesign.status === 'approved' ? '#065f46' : selectedSharedDesign.status === 'production' ? '#1e40af' : '#9ca3af',
                          }}>
                            {selectedSharedDesign.status.replace('_', ' ')}
                          </span>
                          <span className="text-xs text-gray-500">by {selectedSharedDesign.owner?.email}</span>
                          {selectedSharedDesign.myRole === 'admin' && (
                            <select
                              value={selectedSharedDesign.status}
                              onChange={(e) => handleUpdateDesignStatus(selectedSharedDesign.id, e.target.value)}
                              className="text-xs border rounded px-2 py-1"
                            >
                              <option value="draft">Draft</option>
                              <option value="in_review">In Review</option>
                              <option value="approved">Approved</option>
                              <option value="production">Production</option>
                              <option value="archived">Archived</option>
                            </select>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleCloneDesign(selectedTeamId, selectedSharedDesign.id)}
                            className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 flex items-center gap-1"
                          >
                            <Copy size={12} /> Clone
                          </button>
                          <button
                            onClick={() => setShowSubmitChangesModal(true)}
                            className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center gap-1"
                          >
                            <Send size={12} /> Submit Changes
                          </button>
                        </div>
                      </div>

                      {/* Design data preview */}
                      <div className="mb-4 p-3 bg-gray-50 rounded border">
                        <h4 className="text-xs font-semibold text-gray-600 mb-2">Layer Stack Preview</h4>
                        {selectedSharedDesign.data?.layers ? (
                          <div className="text-xs text-gray-600">
                            {selectedSharedDesign.data.layers.map((layer, i) => (
                              <span key={i}>
                                {layer.material} ({layer.thickness}nm)
                                {i < selectedSharedDesign.data.layers.length - 1 ? ' / ' : ''}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400">No layer data</p>
                        )}
                      </div>

                      {/* Submissions */}
                      <div className="mb-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">
                          Submissions ({selectedSharedDesign.submissions?.length || 0})
                        </h4>
                        {selectedSharedDesign.submissions?.length === 0 ? (
                          <p className="text-xs text-gray-500">No submissions yet.</p>
                        ) : (
                          <div className="space-y-2">
                            {selectedSharedDesign.submissions?.map(sub => (
                              <div
                                key={sub.id}
                                onClick={() => { setTeamView('submission'); loadSubmissionDetail(selectedTeamId, selectedSharedDesign.id, sub.id); }}
                                className="p-3 border rounded hover:bg-gray-50"
                                style={{ cursor: 'pointer' }}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-medium">{sub.submitter.email}</span>
                                  <span style={{
                                    fontSize: '10px', padding: '1px 6px', borderRadius: '9999px', fontWeight: 600,
                                    background: sub.status === 'pending' ? '#fef3c7' : sub.status === 'approved' ? '#d1fae5' : '#fecaca',
                                    color: sub.status === 'pending' ? '#92400e' : sub.status === 'approved' ? '#065f46' : '#991b1b',
                                  }}>
                                    {sub.status}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-600 mt-1">{sub.notes}</p>
                                <div className="text-xs text-gray-400 mt-1">
                                  {new Date(sub.createdAt).toLocaleDateString()} &middot; {sub._count.comments} comments
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Discussion Thread */}
                      <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">
                          Discussion ({selectedSharedDesign.comments?.length || 0})
                        </h4>
                        <div className="space-y-2 mb-3">
                          {selectedSharedDesign.comments?.map(c => (
                            <div key={c.id} className="p-2 bg-gray-50 rounded text-xs">
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-semibold text-gray-700">{c.author.email}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-400">{new Date(c.createdAt).toLocaleString()}</span>
                                  {(c.author.id === selectedSharedDesign.myRole || selectedSharedDesign.myRole === 'admin' || c.authorId === undefined) && (
                                    <button onClick={(e) => { e.stopPropagation(); handleDeleteComment('design', null, c.id); }} className="text-red-400 hover:text-red-600"><Trash2 size={10} /></button>
                                  )}
                                </div>
                              </div>
                              <p className="text-gray-600">{c.content}</p>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment('design', null); }}
                            placeholder="Add a comment..."
                            className="flex-1 px-3 py-2 border rounded text-sm"
                          />
                          <button
                            onClick={() => handleAddComment('design', null)}
                            className="px-3 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                          >
                            <MessageSquare size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Submission Detail View */}
              {teamView === 'submission' && selectedSubmission && (
                <div className="flex-1 overflow-y-auto">
                  {teamLoading ? (
                    <p className="text-sm text-gray-500 py-8 text-center">Loading...</p>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-4 pb-3 border-b">
                        <div>
                          <span className="text-sm text-gray-600">Submitted by <strong>{selectedSubmission.submitter?.email}</strong></span>
                          <span style={{
                            fontSize: '10px', padding: '1px 6px', borderRadius: '9999px', fontWeight: 600, marginLeft: '8px',
                            background: selectedSubmission.status === 'pending' ? '#fef3c7' : selectedSubmission.status === 'approved' ? '#d1fae5' : '#fecaca',
                            color: selectedSubmission.status === 'pending' ? '#92400e' : selectedSubmission.status === 'approved' ? '#065f46' : '#991b1b',
                          }}>
                            {selectedSubmission.status}
                          </span>
                        </div>
                        {selectedSubmission.myRole === 'admin' && selectedSubmission.status === 'pending' && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleApproveSubmission(selectedSubmission.id)}
                              className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1"
                            >
                              <Check size={12} /> Approve
                            </button>
                            <button
                              onClick={() => handleDenySubmission(selectedSubmission.id)}
                              className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 flex items-center gap-1"
                            >
                              <XCircle size={12} /> Deny
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Submitter's notes */}
                      <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded">
                        <h4 className="text-xs font-semibold text-indigo-800 mb-1">Change Notes</h4>
                        <p className="text-sm text-gray-700">{selectedSubmission.notes}</p>
                      </div>

                      {/* Review note (if denied) */}
                      {selectedSubmission.reviewNote && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded">
                          <h4 className="text-xs font-semibold text-red-800 mb-1">Admin Review</h4>
                          <p className="text-sm text-gray-700">{selectedSubmission.reviewNote}</p>
                        </div>
                      )}

                      {/* Submitted design preview */}
                      <div className="mb-4 p-3 bg-gray-50 rounded border">
                        <h4 className="text-xs font-semibold text-gray-600 mb-2">Submitted Layer Stack</h4>
                        {selectedSubmission.data?.layers ? (
                          <div className="text-xs text-gray-600">
                            {selectedSubmission.data.layers.map((layer, i) => (
                              <span key={i}>
                                {layer.material} ({layer.thickness}nm)
                                {i < selectedSubmission.data.layers.length - 1 ? ' / ' : ''}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400">No layer data</p>
                        )}
                      </div>

                      {/* Submission comments */}
                      <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">
                          Review Comments ({selectedSubmission.comments?.length || 0})
                        </h4>
                        <div className="space-y-2 mb-3">
                          {selectedSubmission.comments?.map(c => (
                            <div key={c.id} className="p-2 bg-gray-50 rounded text-xs">
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-semibold text-gray-700">{c.author.email}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-400">{new Date(c.createdAt).toLocaleString()}</span>
                                  <button onClick={() => handleDeleteComment('submission', selectedSubmission.id, c.id)} className="text-red-400 hover:text-red-600"><Trash2 size={10} /></button>
                                </div>
                              </div>
                              <p className="text-gray-600">{c.content}</p>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment('submission', selectedSubmission.id); }}
                            placeholder="Add a review comment..."
                            className="flex-1 px-3 py-2 border rounded text-sm"
                          />
                          <button
                            onClick={() => handleAddComment('submission', selectedSubmission.id)}
                            className="px-3 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                          >
                            <MessageSquare size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
```

- [ ] **Step 3: Commit**

```bash
git add src/opticoat-designer.js
git commit -m "feat: add Team tab UI with team list, detail, design, and submission views"
```

### Task 11: Add modals for team operations

**Files:**
- Modify: `src/opticoat-designer.js`

- [ ] **Step 1: Add team modals before the closing of the component's return statement**

Find the area where other modals are rendered (near the save/load modals at the bottom of the JSX, around line 12090+). Add these modals nearby:

```jsx
              {/* Create Team Modal */}
              {showCreateTeamModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                  <div className="bg-white rounded-lg shadow-xl p-6 w-96">
                    <h3 className="text-lg font-bold text-gray-800 mb-4">Create Team</h3>
                    <input
                      type="text"
                      placeholder="Team name..."
                      value={newTeamName}
                      onChange={(e) => setNewTeamName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTeam(); }}
                      className="w-full px-3 py-2 border rounded mb-4 text-sm"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setShowCreateTeamModal(false); setNewTeamName(''); }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                      <button onClick={handleCreateTeam} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">Create</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Invite Member Modal */}
              {showInviteModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                  <div className="bg-white rounded-lg shadow-xl p-6 w-96">
                    <h3 className="text-lg font-bold text-gray-800 mb-4">Invite Team Member</h3>
                    <p className="text-xs text-gray-500 mb-3">The invitee must have an Enterprise subscription.</p>
                    <input
                      type="email"
                      placeholder="Email address..."
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleInviteMember(); }}
                      className="w-full px-3 py-2 border rounded mb-4 text-sm"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setShowInviteModal(false); setInviteEmail(''); }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                      <button onClick={handleInviteMember} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">Send Invite</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Share to Team Modal */}
              {showShareToTeamModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                  <div className="bg-white rounded-lg shadow-xl p-6 w-96">
                    <h3 className="text-lg font-bold text-gray-800 mb-4">Share Design to Team</h3>
                    {teams.length === 0 ? (
                      <p className="text-sm text-gray-500 mb-4">You don't belong to any teams yet.</p>
                    ) : (
                      <div className="space-y-2 mb-4">
                        {teams.map(t => (
                          <button
                            key={t.id}
                            onClick={() => handleShareToTeam(t.id)}
                            className="w-full text-left p-3 border rounded hover:bg-gray-50 text-sm"
                          >
                            <div className="font-medium">{t.name}</div>
                            <div className="text-xs text-gray-500">{t.memberCount} members &middot; {t.myRole}</div>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex justify-end">
                      <button onClick={() => setShowShareToTeamModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Submit Changes Modal */}
              {showSubmitChangesModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                  <div className="bg-white rounded-lg shadow-xl p-6 w-[500px]">
                    <h3 className="text-lg font-bold text-gray-800 mb-4">Submit Design Changes</h3>
                    <p className="text-xs text-gray-500 mb-3">Select one of your saved designs to submit as a change to "{selectedSharedDesign?.name}".</p>
                    <div className="mb-3">
                      <label className="text-xs font-semibold text-gray-700 mb-1 block">Select Design:</label>
                      <select
                        value={selectedDesignForSubmission || ''}
                        onChange={(e) => setSelectedDesignForSubmission(e.target.value)}
                        className="w-full px-2 py-1.5 border rounded text-sm"
                      >
                        <option value="">Choose a design...</option>
                        {savedDesigns.map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="mb-4">
                      <label className="text-xs font-semibold text-gray-700 mb-1 block">Change Notes (required):</label>
                      <textarea
                        value={submissionNotes}
                        onChange={(e) => setSubmissionNotes(e.target.value)}
                        placeholder="Describe what you changed and why..."
                        className="w-full px-3 py-2 border rounded text-sm"
                        rows={3}
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setShowSubmitChangesModal(false); setSubmissionNotes(''); setSelectedDesignForSubmission(null); }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                      <button
                        onClick={handleSubmitChanges}
                        disabled={!selectedDesignForSubmission || !submissionNotes.trim()}
                        className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                      >
                        Submit for Review
                      </button>
                    </div>
                  </div>
                </div>
              )}
```

- [ ] **Step 2: Commit**

```bash
git add src/opticoat-designer.js
git commit -m "feat: add team collaboration modals (create, invite, share, submit)"
```

### Task 12: Add teamCollaboration to FREE_TIER_LIMITS in frontend

**Files:**
- Modify: `src/opticoat-designer.js`

- [ ] **Step 1: Add teamCollaboration to the frontend FREE_TIER_LIMITS object**

Find the `FREE_TIER_LIMITS` object (around line 72-86, inside the dev mode block). Add to the object:

```js
    teamCollaboration: false,
    maxTeams: 0,
    maxTeamSeats: 0,
```

Note: This must be added to BOTH the dev-mode version and the real version (when dev mode is disabled for production). In dev mode, set `teamCollaboration: true` for testing.

- [ ] **Step 2: Commit**

```bash
git add src/opticoat-designer.js
git commit -m "feat: add teamCollaboration to frontend tier limits"
```

---

## Chunk 4: Integration & Final Verification

### Task 13: Verify Prisma schema and generate client

- [ ] **Step 1: Run Prisma generate**

```bash
cd server && npx prisma generate
```

Expected: Prisma Client generated successfully.

- [ ] **Step 2: Push schema to database**

```bash
cd server && npx prisma db push
```

Expected: Schema synced, all new tables created.

### Task 14: Test backend routes manually

- [ ] **Step 1: Start the dev server**

```bash
cd server && npm run dev
```

Expected: Server starts on port 3001 without errors.

- [ ] **Step 2: Verify all new routes are registered**

Check server console output — no import errors or crashes.

### Task 15: Build frontend and verify no errors

- [ ] **Step 1: Run the build**

```bash
npm run build
```

Expected: Build succeeds with only pre-existing warnings (useCallback deps, unused vars).

- [ ] **Step 2: Fix any build errors**

If there are new errors (missing imports, syntax issues), fix them and re-build.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: team collaboration — integration verified and build passing"
```

---

## Review Fixes (Applied Post-Review)

The following fixes MUST be applied during implementation. They correct issues found during plan review:

### Fix 1: CRITICAL — Move `apiPut` import before helper functions (Task 9)
Step 5 (adding `apiPut` to the import) must be done FIRST in Task 9, before Step 2-3 which use `apiPut`. The import line should be:
```js
import { apiGet, apiPost, apiPut, apiDelete, apiStream, setTokenProvider } from './services/apiClient';
```

### Fix 2: CRITICAL — Add `currentUserId` state and fix comment delete authorization
Add a state variable to track the current user's internal ID:
```js
const [currentUserId, setCurrentUserId] = useState(null);
```
Set it when fetching tier (in the existing `fetchTier` useEffect):
```js
const data = await apiGet('/api/auth/tier');
if (!cancelled) {
  setUserTier(data.tier || 'free');
  setTierLimits(data.limits || FREE_TIER_LIMITS);
  if (data.userId) setCurrentUserId(data.userId);
}
```
The backend `GET /api/auth/tier` route must also return `userId: req.user.id` in its response.

Fix the comment delete button condition in design view:
```jsx
{(c.author.id === currentUserId || selectedSharedDesign.myRole === 'admin') && (
  <button onClick={...}><Trash2 size={10} /></button>
)}
```
Apply the same fix to submission comments.

### Fix 3: CRITICAL — Fetch full design data before submitting changes
`savedDesigns` from `GET /api/designs` only contains `id, name, createdAt, updatedAt` (no `data` field). The `handleSubmitChanges` function must fetch the full design first:
```js
const handleSubmitChanges = useCallback(async () => {
  if (!submissionNotes.trim() || !selectedDesignForSubmission) return;
  try {
    // Fetch full design data (list endpoint doesn't include it)
    const design = await apiGet(`/api/designs/${selectedDesignForSubmission}`);
    if (!design) { alert('Design not found'); return; }
    await apiPost(
      `/api/teams/${selectedTeamId}/designs/${selectedSharedDesign.id}/submissions`,
      { data: design.data, notes: submissionNotes.trim(), sourceDesignId: design.id }
    );
    // ... rest unchanged
  } catch (e) {
    alert('Failed to submit: ' + e.message);
  }
}, [submissionNotes, selectedDesignForSubmission, selectedTeamId, selectedSharedDesign]);
```

### Fix 4: IMPORTANT — Add frozen team check to teams.js invite route
Add a `checkTeamFrozen` helper to `teams.js` (same as in sharedDesigns.js) and call it at the start of:
- `POST /:teamId/invite`
- `PUT /:teamId` (rename)

### Fix 5: IMPORTANT — Extract shared helpers to avoid duplication
Create `server/src/services/teamHelpers.js`:
```js
const { prisma } = require('../middleware/auth');

async function requireTeamMember(req, res) { /* ... */ }
async function requireTeamAdmin(req, res) { /* ... */ }
async function checkTeamFrozen(req, res) { /* ... */ }
async function createNotification(userId, type, data) { /* ... */ }

module.exports = { requireTeamMember, requireTeamAdmin, checkTeamFrozen, createNotification };
```
Import these in `teams.js`, `invitations.js`, `sharedDesigns.js`, and `submissions.js` instead of duplicating.

### Fix 6: IMPORTANT — Move notification bell to global header
The notification bell should be in the app's global header (near the user avatar/sign-in area), NOT inside the Team tab. This ensures users see notifications regardless of which tab is active. Move the bell JSX from the Team tab header to the main app header bar.

### Fix 7: IMPORTANT — Replace `prompt()` with proper modals
The `handleShareToTeam`, `handleApproveSubmission`, and `handleDenySubmission` functions use browser `prompt()`. Replace with proper modal state:
- Add `showApproveModal` / `showDenyModal` state + text inputs
- Use the same modal pattern as Create Team and Invite Member modals

### Fix 8: Add notification click navigation
When a notification is clicked, navigate to the relevant view:
```js
const handleNotificationClick = (n) => {
  handleMarkNotificationRead(n.id);
  setShowNotificationDropdown(false);
  if (n.data.teamId) {
    setActiveTab('team');
    setSelectedTeamId(n.data.teamId);
    setTeamView('detail');
    loadTeamDetail(n.data.teamId);
  }
};
```

### Fix 9: Add "Share to Team" button in Designer tab
Per the spec, add a "Share to Team" button in the Designer tab header (near Save/Load buttons) that opens the Share to Team modal. Only show for enterprise users who belong to at least one team.
