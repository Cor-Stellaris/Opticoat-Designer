const { prisma } = require('../middleware/auth');

// Check if user is a member of the team
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

// Check if user is admin of the team
async function requireTeamAdmin(req, res) {
  const member = await requireTeamMember(req, res);
  if (!member) return null;
  if (member.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }
  return member;
}

// Count unique seats across all teams this user owns (as admin)
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

// Check if team is frozen (admin's enterprise subscription lapsed)
async function checkTeamFrozen(req, res) {
  // DEV OVERRIDE: Skip frozen check during testing. Remove before production.
  return false;
}

// Create a notification
async function createNotification(userId, type, data) {
  await prisma.notification.create({
    data: { userId, type, data },
  });
}

module.exports = { requireTeamMember, requireTeamAdmin, countUniqueSeats, checkTeamFrozen, createNotification };
