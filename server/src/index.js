require('dotenv').config();
const express = require('express');
const cors = require('cors');

console.log('[BOOT] Starting OptiCoat Server...');
console.log('[BOOT] Node version:', process.version);
console.log('[BOOT] PORT:', process.env.PORT || '3001 (default)');
console.log('[BOOT] DATABASE_URL:', process.env.DATABASE_URL ? 'set' : 'NOT SET');
console.log('[BOOT] CLERK_SECRET_KEY:', process.env.CLERK_SECRET_KEY ? 'set' : 'NOT SET');

const app = express();
const PORT = process.env.PORT || 3001;
const hasDatabase = !!process.env.DATABASE_URL;

// CORS — allow frontend + Capacitor mobile origins
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'capacitor://localhost',  // iOS Capacitor webview
  'https://localhost',      // Android Capacitor webview
  'http://localhost',       // Android Capacitor fallback
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Stripe webhook needs raw body — must be before express.json()
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

// Parse JSON for all other routes
app.use(express.json({ limit: '10mb' }));

// Full routes only load when database + Clerk are configured
if (hasDatabase) {
  try {
    console.log('[BOOT] Loading Clerk middleware...');
    const { clerkMiddleware } = require('@clerk/express');
    app.use(clerkMiddleware());

    console.log('[BOOT] Loading auth middleware...');
    const { requireUser } = require('./middleware/auth');

    console.log('[BOOT] Loading route handlers...');
    const { chatHandler } = require('./routes/chat');
    app.post('/api/chat', ...requireUser, chatHandler);

    const authRouter = require('./routes/auth');
    const designsRouter = require('./routes/designs');
    const materialsRouter = require('./routes/materials');
    const billingRouter = require('./routes/billing');
    const trackingRouter = require('./routes/tracking');
    const machinesRouter = require('./routes/machines');
    app.use('/api/auth', authRouter);
    app.use('/api/designs', designsRouter);
    app.use('/api/materials', materialsRouter);
    app.use('/api/billing', billingRouter);
    app.use('/api/tracking', trackingRouter);
    app.use('/api/machines', machinesRouter);
    console.log('[BOOT] All routes loaded successfully');
  } catch (err) {
    console.error('[BOOT] FATAL: Failed to load routes:', err);
    process.exit(1);
  }
} else {
  console.log('⚡ Running in dev mode (no DATABASE_URL set) — chat-only, no auth');
  // Dev-only chat without auth
  const { chatHandler } = require('./routes/chat');
  app.post('/api/chat', chatHandler);
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OptiCoat Server running on port ${PORT} (0.0.0.0)`);
});
