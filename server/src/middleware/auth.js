const { requireAuth } = require('@clerk/express');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Middleware: require authentication and attach user from DB
const requireUser = [
  requireAuth(),
  async (req, res, next) => {
    try {
      const clerkId = req.auth.userId;
      if (!clerkId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      let user = await prisma.user.findUnique({ where: { clerkId } });

      if (!user) {
        // Auto-create user on first authenticated request
        const clerkUser = req.auth;
        user = await prisma.user.create({
          data: {
            clerkId,
            email: clerkUser.sessionClaims?.email || `${clerkId}@placeholder.com`,
            tier: 'free',
          },
        });
      }

      req.user = user;
      next();
    } catch (error) {
      console.error('Auth middleware error:', error);
      res.status(500).json({ error: 'Authentication error' });
    }
  },
];

module.exports = { requireUser, prisma };
