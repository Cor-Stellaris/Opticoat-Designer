require('dotenv').config();
const express = require('express');
const cors = require('cors');

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

// Chat route works without database/auth — registered directly on app (not Router)
// Express 5 Router doesn't track async handler Promises, causing premature disconnects
const { chatHandler } = require('./routes/chat');
app.post('/api/chat', chatHandler);

// Full routes only load when database + Clerk are configured
if (hasDatabase) {
  const { clerkMiddleware } = require('@clerk/express');
  app.use(clerkMiddleware());

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
} else {
  console.log('⚡ Running in chat-only mode (no DATABASE_URL set)');
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

app.listen(PORT, () => {
  console.log(`OptiCoat Server running on port ${PORT}`);
});
