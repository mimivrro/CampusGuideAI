/**
 * index.js — CampusGuide AI backend entry point
 *
 * Security middleware stack:
 *   Helmet → CORS → body size limit → rate limiting → routes → error handler
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
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
app.use(helmet());

// ---------------------------------------------------------------------------
// CORS — only allow the configured frontend origin
// ---------------------------------------------------------------------------
app.use(cors({
  origin: CLIENT_ORIGIN,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));

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
  res.json({ status: 'ok', service: 'CampusGuide AI', timestamp: new Date().toISOString() });
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
    error: 'Internal server error. Please try again later.',
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const httpServer = createServer(app);

httpServer.listen(PORT, () => {
  console.log(`\n🏫 CampusGuide AI server running on http://localhost:${PORT}`);
  console.log(`   CORS origin : ${CLIENT_ORIGIN}`);
  console.log(`   Health check: http://localhost:${PORT}/health\n`);
  attachVoiceWebSocket(httpServer);
});

export default app;
