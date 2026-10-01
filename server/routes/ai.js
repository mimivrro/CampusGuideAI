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
import { calculateRoute, searchNodes } from '../services/navigationService.js';
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

      return res.json({
        success: true,
        reply: result.reply,
        routeResult: result.routeResult ?? null,
      });
    } catch (err) {
      console.warn('[AI] chatWithCampusAI error, falling back to local campus engine:', err.message);

      // Intelligent local fallback: calculate route directly if possible
      try {
        const routeResult = calculateRoute(currentNodeId, message);
        if (routeResult?.success) {
          const destName = routeResult.destination?.label || routeResult.destination?.type || 'destination';
          const landmarks = routeResult.landmarks?.length ? ` Landmarks on path: ${routeResult.landmarks.join(', ')}.` : '';
          return res.json({
            success: true,
            reply: `Destination found: **${destName}** (${routeResult.estimatedMinutes} min walk, ${routeResult.distance} units).${landmarks}`,
            routeResult,
          });
        }
      } catch (calcErr) {
        // Fall through to location suggestions
      }

      // Check for matching locations
      const matches = searchNodes(message);
      if (matches.length > 0) {
        const names = matches.map(m => m.label).slice(0, 4).join(', ');
        return res.json({
          success: true,
          reply: `I found these matching campus locations: ${names}. Try searching for one of them or use the quick buttons below.`,
          routeResult: null,
        });
      }

      return res.json({
        success: true,
        reply: `Could not find "${message}". Try searching for classrooms like "102", "B 103", or facilities like "library", "nearest lift", "cafeteria".`,
        routeResult: null,
      });
    }
  }
);

export default router;
