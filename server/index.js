/**
 * index.js — CampusGuide AI backend entry point
 *
 * Configured for production deployment on Render & Vercel CORS handling.
 */

import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createServer } from 'http';

import { generalLimiter } from './middleware/rateLimiter.js';
import navigationRouter from './routes/navigation.js';
import aiRouter from './routes/ai.js';
import { attachVoiceWebSocket } from './routes/voice.js';

const app = express();
const PORT = parseInt(process.env.PORT) || 5000;

// Parsed list of allowed origins from env (comma-separated if multiple)
const ALLOWED_ORIGINS = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(',').map((o) => o.trim())
  : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'];

// ---------------------------------------------------------------------------
// Security headers (tuned for cross-origin APIs & WebSockets)
// ---------------------------------------------------------------------------
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// ---------------------------------------------------------------------------
// CORS — Dynamic origin validation for Vercel, localhost, and custom domains
// ---------------------------------------------------------------------------
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      const isAllowed =
        ALLOWED_ORIGINS.includes(origin) ||
        ALLOWED_ORIGINS.includes('*') ||
        /\.vercel\.app$/.test(origin);

      if (isAllowed) {
        callback(null, true);
      } else {
        console.warn(`[CORS Blocked] Origin: ${origin}`);
        callback(new Error(`CORS policy: Origin ${origin} not allowed.`));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// ---------------------------------------------------------------------------
// Body parsing — limit to 10 KB to prevent large payload attacks
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// ---------------------------------------------------------------------------
// General rate limit applied globally
// ---------------------------------------------------------------------------
app.use(generalLimiter);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'CampusGuide AI Backend',
    timestamp: new Date().toISOString(),
    allowedOrigins: ALLOWED_ORIGINS,
  });
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use('/api/navigation', navigationRouter);
app.use('/api/ai', aiRouter);

// ---------------------------------------------------------------------------
// 404 catch-all
// ---------------------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found.' });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error.',
  });
});

// ---------------------------------------------------------------------------
// Start HTTP server & attach WebSocket server
// ---------------------------------------------------------------------------
const httpServer = createServer(app);

httpServer.listen(PORT, () => {
  console.log(`\n🏫 CampusGuide AI server running on port ${PORT}`);
  console.log(`   Allowed CORS origins : ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`   Health check endpoint: http://localhost:${PORT}/health\n`);
  attachVoiceWebSocket(httpServer);
});

export default app;
