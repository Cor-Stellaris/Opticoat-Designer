# Team Collaboration — Design Spec

**Date:** 2026-03-15
**Status:** Approved
**Tier:** Enterprise only ($349/mo, 5 seats included across all teams, $49/mo per additional seat)

---

## 1. Overview

Add team collaboration to OptiCoat Designer's Enterprise tier. Teams are project-based (not organization-based), supporting cross-company collaboration. Team members can share designs, clone and modify them, submit changes for review, and discuss designs through threaded comments.

## 2. Core Concepts

### 2.1 Teams

- Any enterprise user can **create** a team (becomes admin).
- Admin **invites** members by email. Invitees must have an enterprise subscription.
- Teams are not tied to a single organization — a designer at Essilor can invite a collaborator at Buhler.
- Admin manages membership: invite, remove.
- **Seat model (per-account):** Enterprise tier includes 5 total seats across ALL teams the user creates. Additional seats cost $49/mo each (handled via Stripe subscription item quantity updates). A "seat" is counted as a unique user across all teams the admin owns. If the same person is in 2 of your teams, that's 1 seat.
- A user can belong to **multiple teams** (as member or admin of different teams).
- An enterprise user can create up to **3 teams**.
- Roles: **admin** (creator) and **member**. No other roles at launch.

### 2.2 Admin Departure & Ownership Transfer

- Admin can **transfer ownership** to another team member via `POST /api/teams/:teamId/transfer-admin`. The new admin must be an enterprise user.
- Admin cannot leave a team without first transferring ownership or deleting the team.
- **If an admin's enterprise subscription lapses:** The team is **frozen**. All team data is preserved read-only. Members see a banner: "Team frozen — the team owner's subscription is inactive." No new shares, submissions, or comments allowed. Once the admin re-subscribes, the team unfreezes automatically.
- **If an admin's account is deleted:** Team is deleted (cascade). Members lose access to shared designs but retain any personal clones they made.

### 2.3 Shared Designs

- Any team member can **publish** one of their personal designs to the team library.
- Shared designs are **read-only** in the team context — nobody edits them in place.
- Any team member can **clone** a shared design to their personal workspace and modify it freely.
- The person who published it is the **owner** of that shared design.
- A `sourceDesignId` links back to the original personal design (nullable — the original may be deleted).

### 2.4 Status Tags

Shared designs carry a status managed by the team admin:

| Status | Meaning |
|--------|---------|
| Draft | Initial state when first shared |
| In Review | Under active evaluation |
| Approved | Cleared for production use |
| Production | Currently being coated |
| Archived | Retired — preserved but no longer active |

Transitions: Admin can set any status. Status is informational and does not gate any functionality.

### 2.5 Submission & Review Workflow

1. Team member **clones** a shared design to their workspace.
2. Member modifies the design (layers, thicknesses, materials, etc.).
3. Member **submits** their modified version back to the team with a **note** explaining what changed and why (e.g., "Reduced layer 4 thickness from 120nm to 105nm to improve stress tolerance").
4. Admin **reviews** the submission:
   - **Approve** — The submission replaces the current shared design. Old version is not preserved (no version history at launch).
   - **Deny** — Admin provides feedback explaining why. The submission stays visible for reference.
5. Admin can also **clone** any team member's personal designs (if shared to the team).
6. A `sourceDesignId` on the submission links back to the cloned personal design.

### 2.6 Discussion Threads

Two locations for threaded discussions:

**On shared designs (general discussion):**
- Any team member can start or reply to a thread.
- For broad design discussion: "Layer 3 is delaminating at 60 degrees — anyone else seeing this?"
- Threads are chronological, flat (no nested replies).

**On submissions (review-specific):**
- Comments tied to a specific submission.
- For review feedback: "Thickness change looks good but bump the tooling factor too."
- Visible to all team members.

**Comment management:**
- Authors can **delete** their own comments.
- Admins can **delete** any comment in their team.

### 2.7 Notifications (In-App Only)

A notification bell/badge in the app header. Events that generate notifications:

| Event | Recipients | Data shape |
|-------|-----------|------------|
| Invited to a team | Invitee | `{ teamId, teamName, inviterName, invitationId }` |
| Invitation accepted | Admin | `{ teamId, teamName, memberName, memberEmail }` |
| New design shared to team | All team members | `{ teamId, teamName, designName, ownerName }` |
| New submission for review | Admin | `{ teamId, teamName, designName, submitterName, submissionId }` |
| Submission approved | Submitter | `{ teamId, teamName, designName, reviewNote }` |
| Submission denied | Submitter | `{ teamId, teamName, designName, reviewNote }` |
| New comment on a shared design | Design owner + prior commenters | `{ teamId, teamName, designName, authorName, commentPreview }` |
| New comment on a submission | Submitter + admin + prior commenters | `{ teamId, teamName, designName, authorName, commentPreview }` |

Notifications are read/unread. No email at launch.

## 3. Database Schema

New Prisma models (additions to existing `schema.prisma`):

### Team
```
model Team {
  id          String       @id @default(cuid())
  name        String
  createdById String
  createdBy   User         @relation("TeamsCreated", fields: [createdById], references: [id])
  members     TeamMember[]
  sharedDesigns SharedDesign[]
  invitations TeamInvitation[]
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
}
```

### TeamMember
```
model TeamMember {
  id       String   @id @default(cuid())
  teamId   String
  team     Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  userId   String
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  role     String   @default("member") // "admin" or "member"
  joinedAt DateTime @default(now())

  @@unique([teamId, userId])
  @@index([teamId])
  @@index([userId])
}
```

### TeamInvitation
```
model TeamInvitation {
  id          String   @id @default(cuid())
  teamId      String
  team        Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  email       String
  invitedById String
  invitedBy   User     @relation("TeamInvitations", fields: [invitedById], references: [id])
  status      String   @default("pending") // "pending", "accepted", "declined"
  createdAt   DateTime @default(now())

  @@unique([teamId, email])
  @@index([email])
}
```

### SharedDesign
```
model SharedDesign {
  id              String       @id @default(cuid())
  teamId          String
  team            Team         @relation(fields: [teamId], references: [id], onDelete: Cascade)
  ownerId         String
  owner           User         @relation("SharedDesignsOwned", fields: [ownerId], references: [id])
  sourceDesignId  String?      // Link to original personal Design (nullable if deleted)
  sourceDesign    Design?      @relation(fields: [sourceDesignId], references: [id], onDelete: SetNull)
  name            String
  data            Json         // Full design data (same format as Design.data)
  status          String       @default("draft") // draft, in_review, approved, production, archived
  submissions     DesignSubmission[]
  comments        DesignComment[]
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  @@index([teamId])
  @@index([ownerId])
}
```

### DesignSubmission
```
model DesignSubmission {
  id              String       @id @default(cuid())
  sharedDesignId  String
  sharedDesign    SharedDesign @relation(fields: [sharedDesignId], references: [id], onDelete: Cascade)
  submitterId     String
  submitter       User         @relation("DesignSubmissions", fields: [submitterId], references: [id])
  sourceDesignId  String?      // Link to the cloned personal Design
  sourceDesign    Design?      @relation(fields: [sourceDesignId], references: [id], onDelete: SetNull)
  data            Json         // The modified design data
  notes           String       // Explanation of changes
  status          String       @default("pending") // "pending", "approved", "denied"
  reviewNote      String?      // Admin feedback (especially for denials)
  comments        SubmissionComment[]
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  @@index([sharedDesignId])
  @@index([sharedDesignId, status])
  @@index([submitterId])
}
```

### DesignComment (on shared designs)
```
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
```

### SubmissionComment (on submissions)
```
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
```

### Notification
```
model Notification {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  type      String   // "team_invite", "invite_accepted", "design_shared", "submission_new", "submission_approved", "submission_denied", "comment_design", "comment_submission"
  data      Json     // Shape varies by type — see Section 2.7 for per-type data shapes
  read      Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([userId])
  @@index([userId, read])
}
```

### User model additions
Add these relations to the existing User model:
```
teamsCreated       Team[]             @relation("TeamsCreated")
teamMemberships    TeamMember[]
teamInvitations    TeamInvitation[]   @relation("TeamInvitations")
sharedDesigns      SharedDesign[]     @relation("SharedDesignsOwned")
submissions        DesignSubmission[] @relation("DesignSubmissions")
designComments     DesignComment[]    @relation("DesignComments")
submissionComments SubmissionComment[] @relation("SubmissionComments")
notifications      Notification[]
```

### Design model additions
Add this relation to the existing Design model:
```
sharedDesigns      SharedDesign[]
designSubmissions  DesignSubmission[]
```

## 4. API Routes

All routes require authentication + enterprise tier check.

### Teams (`/api/teams`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/teams` | Create a team (caller becomes admin) |
| GET | `/api/teams` | List teams the user belongs to |
| GET | `/api/teams/:teamId` | Get team details + member list |
| PUT | `/api/teams/:teamId` | Update team name (admin only) |
| DELETE | `/api/teams/:teamId` | Delete team (admin only) |
| POST | `/api/teams/:teamId/invite` | Invite a user by email (admin only) |
| DELETE | `/api/teams/:teamId/members/:userId` | Remove a member (admin only) |
| POST | `/api/teams/:teamId/leave` | Leave a team (non-admin only) |
| POST | `/api/teams/:teamId/transfer-admin` | Transfer admin role to another member (admin only) |

### Invitations (`/api/invitations`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/invitations` | List current user's pending invitations (by email) |
| POST | `/api/invitations/:invitationId/accept` | Accept an invitation |
| POST | `/api/invitations/:invitationId/decline` | Decline an invitation |

### Shared Designs (`/api/teams/:teamId/designs`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/teams/:teamId/designs` | List shared designs in team |
| POST | `/api/teams/:teamId/designs` | Publish a design to the team |
| GET | `/api/teams/:teamId/designs/:designId` | Get shared design detail |
| PUT | `/api/teams/:teamId/designs/:designId/status` | Update status tag (admin only) |
| DELETE | `/api/teams/:teamId/designs/:designId` | Remove shared design (owner or admin) |
| POST | `/api/teams/:teamId/designs/:designId/clone` | Clone shared design to personal workspace |

### Submissions (`/api/teams/:teamId/designs/:designId/submissions`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `.../submissions` | List submissions for a shared design |
| POST | `.../submissions` | Submit a modified design for review |
| GET | `.../submissions/:subId` | Get submission detail |
| POST | `.../submissions/:subId/approve` | Approve submission (admin only) |
| POST | `.../submissions/:subId/deny` | Deny submission with feedback (admin only) |

### Comments

| Method | Path | Description |
|--------|------|-------------|
| GET | `.../designs/:designId/comments` | List comments on a shared design |
| POST | `.../designs/:designId/comments` | Add a comment |
| DELETE | `.../designs/:designId/comments/:commentId` | Delete a comment (author or admin) |
| GET | `.../submissions/:subId/comments` | List comments on a submission |
| POST | `.../submissions/:subId/comments` | Add a comment |
| DELETE | `.../submissions/:subId/comments/:commentId` | Delete a comment (author or admin) |

### Notifications (`/api/notifications`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/notifications` | List user's notifications (paginated, 20 per page) |
| GET | `/api/notifications/unread-count` | Get unread count (for badge) |
| PUT | `/api/notifications/:id/read` | Mark as read |
| PUT | `/api/notifications/read-all` | Mark all as read |

## 5. Frontend UI

### 5.1 New Tab: "Team" (Enterprise only)

Added as a 5th tab between "Design Assistant" and "Recipe Tracking". Non-enterprise users see a locked tab with an upgrade prompt.

### 5.2 Team Management Panel

- **My Teams** list — shows teams user belongs to (with role badge: Admin/Member)
- **Create Team** button — name input, creates team
- **Team detail view** — member list, invite form (email input), pending invitations sent
- **Pending Invitations** section — accept/decline buttons for incoming invites (uses `GET /api/invitations`)
- **Transfer Admin** option in team settings (admin only)

### 5.3 Shared Design Library

- Grid or list view of shared designs in the selected team
- Each card shows: design name, owner, status badge, layer count, last updated, comment count
- Click to open detail view
- **"Share to Team"** button available in the main Designer tab — if user belongs to multiple teams, shows a team selector dropdown before publishing

### 5.4 Shared Design Detail View

- Read-only design preview (layer stack table, reflectivity chart thumbnail)
- **Clone** button — copies to user's personal designs
- **Status badge** — colored by status (Draft=gray, In Review=yellow, Approved=green, Production=blue, Archived=gray-muted)
- **Submissions panel** — list of pending/approved/denied submissions with notes
- **Discussion thread** — chronological comments with author + timestamp, delete button on own comments
- **Submit Changes** button — opens submission form (select a personal design + add notes)

### 5.5 Submission Review (Admin View)

- Side-by-side or inline view showing the submission
- Submitter's notes displayed prominently
- **Approve** / **Deny** buttons (deny requires feedback text)
- Review-specific comment thread

### 5.6 Notification Bell

- Bell icon in the app header (near user avatar)
- Red badge with unread count
- Dropdown showing recent notifications grouped by time
- Click notification to navigate to relevant team/design/submission

## 6. Tier Limits Integration

Add to all tiers in `tierLimits.js`:

```js
// free, starter, professional tiers:
teamCollaboration: false,
maxTeams: 0,
maxTeamSeats: 0,

// enterprise tier:
teamCollaboration: true,
maxTeams: 3,                // teams user can create (as admin)
maxTeamSeats: 5,            // total unique members across all owned teams (included)
additionalSeatPrice: 49,    // $/mo per extra seat via Stripe
```

Backend middleware checks `teamCollaboration` feature flag on all `/api/teams/*` and `/api/invitations/*` routes.

Seat counting: When an admin invites a member, the backend counts unique users across all teams the admin owns. If count exceeds `maxTeamSeats`, the invite is blocked with a message to purchase additional seats.

## 7. Security Considerations

- **Team membership verification** on every request — user must be a member of the team to access any team resource.
- **Admin-only actions** enforced server-side: invite, remove member, approve/deny submissions, change status, transfer admin.
- **Design data isolation** — cloning creates a full copy; no shared mutable references.
- **Input sanitization** on comments and notes (prevent XSS in stored content).
- **Rate limiting** on invitations to prevent spam (max 10 invitations per hour per admin).
- **Comment deletion authorization** — only the comment author or team admin can delete.
- **Frozen team enforcement** — if admin's enterprise subscription lapses, all write operations on the team return 403 with a descriptive message.

## 8. Out of Scope (Future)

- Email notifications (requires SendGrid/Resend integration)
- Real-time co-editing / presence indicators
- Design version history / diff view
- Role-based permissions beyond admin/member (e.g., reviewer, viewer)
- File attachments on comments
- @mention functionality in comments
- Team-level analytics / activity dashboard
- Team name uniqueness enforcement
- Pagination on comments/submissions (acceptable at launch scale, add when needed)
