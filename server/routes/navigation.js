/**
 * navigation.js — Navigation API routes
 *
 * POST /api/navigation/route
 *   Body: { startNodeId, destinationQuery }
 *   Returns: RouteResult
 *
 * POST /api/navigation/nearest
 *   Body: { type, startNodeId }
 *   Returns: RouteResult for nearest node of that type
 *
 * GET /api/navigation/node/:nodeId
 *   Returns: node details
 *
 * GET /api/navigation/search?q=...
 *   Returns: array of matching named nodes
 */

import { Router } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import {
  calculateRoute,
  findNearest,
  getNodeDetails,
  searchNodes,
} from '../services/navigationService.js';
import { nodes, edges } from '../data/buildingData.js';
import { navigationLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Apply navigation-specific rate limit to all routes here
router.use(navigationLimiter);

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------
function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ success: false, error: errors.array()[0].msg });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// POST /api/navigation/route
// ---------------------------------------------------------------------------
router.post(
  '/route',
  [
    body('startNodeId')
      .isString().withMessage('startNodeId must be a string')
      .matches(/^node_\d+$/).withMessage('startNodeId must match pattern node_XXXX')
      .trim(),
    body('destinationQuery')
      .isString().withMessage('destinationQuery must be a string')
      .isLength({ min: 1, max: 200 }).withMessage('destinationQuery must be 1–200 characters')
      .trim(),
  ],
  (req, res) => {
    if (!validate(req, res)) return;

    const { startNodeId, destinationQuery } = req.body;
    const result = calculateRoute(startNodeId, destinationQuery);

    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/navigation/nearest
// ---------------------------------------------------------------------------
router.post(
  '/nearest',
  [
    body('startNodeId')
      .isString().withMessage('startNodeId must be a string')
      .matches(/^node_\d+$/).withMessage('startNodeId must match pattern node_XXXX')
      .trim(),
    body('type')
      .isString().withMessage('type must be a string')
      .isLength({ min: 1, max: 100 }).withMessage('type must be 1–100 characters')
      .trim(),
  ],
  (req, res) => {
    if (!validate(req, res)) return;

    const { startNodeId, type } = req.body;
    const result = findNearest(type, startNodeId);

    if (result) {
      res.json(result);
    } else {
      res.status(404).json({
        success: false,
        error: `No "${type}" found reachable from current location.`,
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/navigation/node/:nodeId
// ---------------------------------------------------------------------------
router.get(
  '/node/:nodeId',
  [
    param('nodeId')
      .matches(/^node_\d+$/).withMessage('nodeId must match pattern node_XXXX'),
  ],
  (req, res) => {
    if (!validate(req, res)) return;

    const details = getNodeDetails(req.params.nodeId);
    if (!details) {
      return res.status(404).json({ success: false, error: 'Node not found.' });
    }
    res.json({ success: true, node: details });
  }
);

// ---------------------------------------------------------------------------
// GET /api/navigation/search?q=...
// ---------------------------------------------------------------------------
router.get(
  '/search',
  [
    query('q')
      .isString().withMessage('q must be a string')
      .isLength({ min: 1, max: 100 }).withMessage('q must be 1–100 characters')
      .trim(),
  ],
  (req, res) => {
    if (!validate(req, res)) return;

    const results = searchNodes(req.query.q);
    res.json({ success: true, results });
  }
);

// ---------------------------------------------------------------------------
// GET /api/navigation/graph
// Returns all nodes and edges in a compact form for frontend graph rendering.
// Cached as a simple object since the graph never changes at runtime.
// ---------------------------------------------------------------------------
let _graphCache = null;

router.get('/graph', (_req, res) => {
  if (!_graphCache) {
    // Build compact node map (drop corridor nodes with no label for cleaner display
    // but keep them for edge rendering so the graph stays connected)
    const compactNodes = {};
    for (const [id, node] of Object.entries(nodes)) {
      compactNodes[id] = {
        x: node.x,
        y: node.y,
        label: node.label,
        type: node.type,
      };
    }
    // Edges: just [fromId, toId] — cost not needed for rendering
    const compactEdges = edges.map(([a, b]) => [a, b]);
    _graphCache = { nodes: compactNodes, edges: compactEdges };
  }
  res.json({ success: true, ..._graphCache });
});

export default router;
