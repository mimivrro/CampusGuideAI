/**
 * rateLimiter.js
 *
 * Configurable rate-limiting middleware for CampusGuide AI.
 * All limits are overridable via environment variables.
 */

import rateLimit from 'express-rate-limit';

// ---------------------------------------------------------------------------
// General API limiter — applied to all routes
// ---------------------------------------------------------------------------
export const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 min
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests. Please wait a moment and try again.',
    code: 'RATE_LIMIT_GENERAL',
  },
});

// ---------------------------------------------------------------------------
// Navigation route limiter — POST /api/navigation/*
// ---------------------------------------------------------------------------
export const navigationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: parseInt(process.env.NAV_RATE_LIMIT_MAX) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Navigation request limit reached. Please slow down.',
    code: 'RATE_LIMIT_NAVIGATION',
  },
});

// ---------------------------------------------------------------------------
// AI text limiter — POST /api/ai/*
// ---------------------------------------------------------------------------
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: parseInt(process.env.AI_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'AI request limit reached. Please wait a moment.',
    code: 'RATE_LIMIT_AI',
  },
});

// ---------------------------------------------------------------------------
// Voice session tracker — max N concurrent WebSocket sessions per IP
// ---------------------------------------------------------------------------
const voiceSessions = new Map(); // IP → count

export const VOICE_MAX_PER_IP = parseInt(process.env.VOICE_MAX_SESSIONS_PER_IP) || 2;

export function addVoiceSession(ip) {
  const count = (voiceSessions.get(ip) || 0) + 1;
  voiceSessions.set(ip, count);
  return count;
}

export function removeVoiceSession(ip) {
  const count = Math.max(0, (voiceSessions.get(ip) || 1) - 1);
  if (count === 0) voiceSessions.delete(ip);
  else voiceSessions.set(ip, count);
}

export function getVoiceSessionCount(ip) {
  return voiceSessions.get(ip) || 0;
}
