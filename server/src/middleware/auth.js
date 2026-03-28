const { requireAuth } = require('@clerk/express');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { URL } = require('url');

// Parse DATABASE_URL into pg Pool config object
function parseDbUrl(urlStr) {
  const url = new URL(urlStr);
  return {
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  };
}

const poolConfig = parseDbUrl(process.env.DATABASE_URL);
const adapter = new PrismaPg(poolConfig);
const prisma = new PrismaClient({ adapter });

// Middleware: require authentication and attach user from DB
const requireUser = [
  requireAuth(),
  async (req, res, next) => {
    try {
      const auth = typeof req.auth === 'function' ? req.auth() : req.auth;
      const clerkId = auth.userId;
      if (!clerkId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      let user = await prisma.user.findUnique({ where: { clerkId } });

      if (!user) {
        // Auto-create user on first authenticated request
        user = await prisma.user.create({
          data: {
            clerkId,
            email: auth.sessionClaims?.email || `${clerkId}@placeholder.com`,
            tier: 'free',
          },
        });
      }

      // Org-aware tier inheritance: if user belongs to an org with an Enterprise admin,
      // they inherit Enterprise access even if their own tier is lower
      const orgId = auth.orgId || null;

      // Update organizationId if it changed
      if (orgId !== user.organizationId) {
        await prisma.user.update({
          where: { id: user.id },
          data: { organizationId: orgId || null },
        });
        user.organizationId = orgId || null;
      }

      let effectiveTier = user.tier;
      if (orgId && user.tier !== 'enterprise') {
        const orgAdmin = await prisma.user.findFirst({
          where: { organizationId: orgId, tier: 'enterprise' },
        });
        if (orgAdmin) effectiveTier = 'enterprise';
      }

      req.user = { ...user, effectiveTier };
      next();
    } catch (error) {
      console.error('Auth middleware error:', error);
      res.status(500).json({ error: 'Authentication error' });
    }
  },
];

module.exports = { requireUser, prisma };
