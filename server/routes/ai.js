/**
 * ai.js — AI chat route
 *
 * POST /api/ai/chat
 *   Body:    { message: string, currentNodeId: string }
 *   Returns: { success: true, reply: string, routeResult: object|null }
 *         or { success: false, error: string, code: string }
 */

import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { chatWithCampusAI } from '../services/geminiService.js';
import { aiLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Apply AI-specific rate limit to all routes here
router.use(aiLimiter);

// ── Validation helper ─────────────────────────────────────────────────────────
function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      error: errors.array()[0].msg,
      code: 'VALIDATION_ERROR',
    });
    return false;
  }
  return true;
}

// ── POST /api/ai/chat ─────────────────────────────────────────────────────────
router.post(
  '/chat',
  [
    body('message')
      .isString()
      .withMessage('message must be a string')
      .trim()
      .isLength({ min: 1, max: 500 })
      .withMessage('message must be between 1 and 500 characters'),

    body('currentNodeId')
      .isString()
      .withMessage('currentNodeId must be a string')
      .trim()
      .matches(/^node_\d+$/)
      .withMessage('currentNodeId must match pattern node_XXXX'),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;

    const { message, currentNodeId } = req.body;

    try {
      const result = await chatWithCampusAI(message, currentNodeId);

      res.json({
        success: true,
        reply: result.reply,
        routeResult: result.routeResult ?? null,
      });
    } catch (err) {
      console.error('[AI] chatWithCampusAI error:', err.message);

      // Surface a friendly message based on error type
      if (err.message.includes('GEMINI_API_KEY')) {
        return res.status(503).json({
          success: false,
          error: 'The AI service is not configured yet. Please add your Gemini API key to server/.env.',
          code: 'AI_NOT_CONFIGURED',
        });
      }

      if (err.message.includes('quota') || err.message.includes('429')) {
        return res.status(429).json({
          success: false,
          error: 'AI quota exceeded. Please wait a moment and try again.',
          code: 'AI_QUOTA_EXCEEDED',
        });
      }

      if (err.message.includes('API_KEY_INVALID') || err.message.includes('401')) {
        return res.status(503).json({
          success: false,
          error: 'Invalid Gemini API key. Please check server/.env.',
          code: 'AI_KEY_INVALID',
        });
      }

      res.status(503).json({
        success: false,
        error: 'The AI service is temporarily unavailable. You can still use the quick navigation buttons.',
        code: 'AI_UNAVAILABLE',
      });
    }
  }
);

export default router;
