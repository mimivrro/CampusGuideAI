/**
 * navigationService.js
 *
 * Campus 25 indoor navigation engine.
 * - Builds an adjacency-list graph from the knowledge base
 * - Finds nodes by exact/partial/semantic query
 * - Calculates shortest paths with Dijkstra's algorithm
 * - Returns ordered route with x/y coordinates, distance, and ETA
 *
 * The LLM never calls this directly — it is called by tool-dispatch functions.
 * No route data is ever fabricated; every result comes from the graph.
 */

import { nodes, edges, poiCategories } from '../data/buildingData.js';

// ---------------------------------------------------------------------------
// 1. Build adjacency list (undirected — each edge added in both directions)
// ---------------------------------------------------------------------------
const graph = {};

for (const nodeId of Object.keys(nodes)) {
  graph[nodeId] = [];
}

for (const [a, b, cost] of edges) {
  if (!graph[a]) graph[a] = [];
  if (!graph[b]) graph[b] = [];
  graph[a].push({ to: b, cost });
  graph[b].push({ to: a, cost });
}

// ---------------------------------------------------------------------------
// 2. Node search helpers
// ---------------------------------------------------------------------------

/**
 * Find a node by exact label (case-insensitive).
 * Returns { nodeId, node } or null.
 */
function findByExactLabel(query) {
  const q = query.trim().toLowerCase();
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (node.label.toLowerCase() === q) {
      return { nodeId, node };
    }
  }
  return null;
}

/**
 * Find all nodes whose label contains the query string (case-insensitive).
 * Returns array of { nodeId, node }.
 */
function findByPartialLabel(query) {
  const q = query.trim().toLowerCase();
  const results = [];
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (node.label && node.label.toLowerCase().includes(q)) {
      results.push({ nodeId, node });
    }
  }
  return results;
}

/**
 * Find nodes by type / semantic category.
 * Supports: classroom, lab, office, lift, stairs, washroom_gents,
 *           washroom_ladies, washroom, entrance, cafeteria, seating, corridor
 * Also maps friendly aliases: library → seating+LIBRARY, lounge → FACULTY LOUNGE, etc.
 */
function findByType(typeQuery) {
  const q = typeQuery.trim().toLowerCase();

  // Semantic aliases → poiCategory keys
  const aliases = {
    library: 'library',
    libraries: 'library',
    'faculty lounge': 'faculty_lounge',
    lounge: 'faculty_lounge',
    'faculty room': 'faculty_lounge',
    cafe: 'cafeteria',
    cafeteria: 'cafeteria',
    canteen: 'cafeteria',
    food: 'cafeteria',
    lift: 'lifts',
    lifts: 'lifts',
    elevator: 'lifts',
    elevators: 'lifts',
    stairs: 'stairs',
    staircase: 'stairs',
    stair: 'stairs',
    washroom: 'washrooms',
    washrooms: 'washrooms',
    toilet: 'washrooms',
    restroom: 'washrooms',
    bathroom: 'washrooms',
    'gents washroom': 'washrooms_gents',
    "men's washroom": 'washrooms_gents',
    'ladies washroom': 'washrooms_ladies',
    "women's washroom": 'washrooms_ladies',
    entrance: 'entrances',
    exit: 'entrances',
    door: 'entrances',
    classroom: 'classrooms',
    classrooms: 'classrooms',
    lab: 'labs',
    laboratory: 'labs',
    labs: 'labs',
    office: 'offices',
    offices: 'offices',
  };

  const categoryKey = aliases[q];
  if (categoryKey && poiCategories[categoryKey]) {
    return poiCategories[categoryKey].map(nodeId => ({ nodeId, node: nodes[nodeId] }));
  }

  // Fall back to direct type match
  return Object.entries(nodes)
    .filter(([, node]) => node.type.toLowerCase() === q)
    .map(([nodeId, node]) => ({ nodeId, node }));
}

/**
 * Main node resolver — tries strategies in order:
 * 1. Exact node ID (e.g. "node_1007")
 * 2. Exact label match
 * 3. Partial label match
 * 4. Semantic type/category
 *
 * Returns { nodeId, node } for the best single match, or null.
 * For "find nearest" use-cases, returns an array via findCandidates().
 */
export function resolveNode(query) {
  if (!query) return null;
  const q = query.trim();

  // 1. Direct node ID
  if (nodes[q]) return { nodeId: q, node: nodes[q] };

  // 2. Exact label
  const exact = findByExactLabel(q);
  if (exact) return exact;

  // 3. Partial label — prefer shorter label (more specific)
  const partial = findByPartialLabel(q);
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    // Pick the one with the shortest label as it's most specific
    partial.sort((a, b) => a.node.label.length - b.node.label.length);
    return partial[0];
  }

  // 4. Type / semantic category — return first match (use findCandidates for nearest)
  const byType = findByType(q);
  if (byType.length > 0) return byType[0];

  return null;
}

/**
 * Returns all candidate nodes for a query (used by findNearest).
 */
export function findCandidates(query) {
  const q = query.trim();

  if (nodes[q]) return [{ nodeId: q, node: nodes[q] }];

  const exact = findByExactLabel(q);
  if (exact) return [exact];

  const partial = findByPartialLabel(q);
  if (partial.length > 0) return partial;

  return findByType(q);
}

// ---------------------------------------------------------------------------
// 3. Dijkstra's shortest path
// ---------------------------------------------------------------------------

/**
 * Dijkstra's algorithm.
 * @param {string} startId - Start node ID
 * @param {string} endId   - Destination node ID
 * @returns {{ path: string[], distance: number } | null}
 */
function dijkstra(startId, endId) {
  if (!graph[startId] || !graph[endId]) return null;
  if (startId === endId) return { path: [startId], distance: 0 };

  // Priority queue as a simple sorted array (fine for graph size ~330 nodes)
  const dist = {};
  const prev = {};
  const visited = new Set();

  for (const nodeId of Object.keys(nodes)) {
    dist[nodeId] = Infinity;
  }
  dist[startId] = 0;

  const queue = [{ nodeId: startId, d: 0 }];

  while (queue.length > 0) {
    // Pop minimum distance node
    queue.sort((a, b) => a.d - b.d);
    const { nodeId: current } = queue.shift();

    if (visited.has(current)) continue;
    visited.add(current);

    if (current === endId) break;

    for (const { to, cost } of (graph[current] || [])) {
      if (visited.has(to)) continue;
      const newDist = dist[current] + cost;
      if (newDist < dist[to]) {
        dist[to] = newDist;
        prev[to] = current;
        queue.push({ nodeId: to, d: newDist });
      }
    }
  }

  if (dist[endId] === Infinity) return null; // No path

  // Reconstruct path
  const path = [];
  let cur = endId;
  while (cur !== undefined) {
    path.unshift(cur);
    cur = prev[cur];
  }

  return { path, distance: dist[endId] };
}

// ---------------------------------------------------------------------------
// 4. Find nearest node of a given type/query from a start node
// ---------------------------------------------------------------------------

/**
 * Finds the nearest node matching the query from startNodeId.
 * @param {string} typeQuery  - Type/label query (e.g. "lift", "washroom")
 * @param {string} startNodeId
 * @returns RouteResult | null
 */
export function findNearest(typeQuery, startNodeId) {
  const candidates = findCandidates(typeQuery);
  if (candidates.length === 0) return null;
  if (!nodes[startNodeId]) return null;

  let bestResult = null;

  for (const { nodeId: destId } of candidates) {
    if (destId === startNodeId) {
      // Already there
      return buildRouteResult(startNodeId, destId, [startNodeId], 0);
    }
    const result = dijkstra(startNodeId, destId);
    if (result && (!bestResult || result.distance < bestResult.distance)) {
      bestResult = { ...result, destId };
    }
  }

  if (!bestResult) return null;
  return buildRouteResult(startNodeId, bestResult.destId, bestResult.path, bestResult.distance);
}

// ---------------------------------------------------------------------------
// 5. Main route calculation entry point
// ---------------------------------------------------------------------------

/**
 * Walking speed: ~1.2 m/s typical indoor pace.
 * The graph pixel coordinates approximate real distances.
 * Empirically, 1 graph unit ≈ 0.05 m → 80 units/sec.
 * (Tune PIXELS_PER_SECOND to match your floor plan scale.)
 */
const PIXELS_PER_SECOND = 80;

function buildRouteResult(startNodeId, destNodeId, path, distance) {
  const destNode = nodes[destNodeId];
  const seconds = distance / PIXELS_PER_SECOND;
  const estimatedMinutes = Math.max(1, Math.round(seconds / 60));

  // Build ordered route with coordinates
  const route = path.map(nodeId => ({
    nodeId,
    x: nodes[nodeId].x,
    y: nodes[nodeId].y,
    label: nodes[nodeId].label,
    type: nodes[nodeId].type,
  }));

  // Identify notable landmarks along the route (lifts, stairs, entrances)
  const landmarks = route
    .filter(n => ['lift', 'stairs', 'entrance'].includes(n.type) && n.label)
    .map(n => n.label);

  return {
    success: true,
    destination: {
      nodeId: destNodeId,
      label: destNode.label,
      type: destNode.type,
      x: destNode.x,
      y: destNode.y,
    },
    route,
    distance: Math.round(distance),
    estimatedMinutes,
    landmarks,
  };
}

/**
 * Top-level route calculation.
 * Called by the navigation route handler and the AI tool dispatcher.
 *
 * @param {string} startNodeId     - Current location node ID (e.g. "node_1005")
 * @param {string} destinationQuery - Free-text query (e.g. "A-007", "library", "nearest lift")
 * @returns RouteResult
 */
export function calculateRoute(startNodeId, destinationQuery) {
  // Validate start node
  if (!nodes[startNodeId]) {
    return { success: false, error: `Unknown start node: ${startNodeId}` };
  }

  // "Nearest X" pattern
  const nearestMatch = destinationQuery.match(/^nearest\s+(.+)$/i)
    || destinationQuery.match(/^find\s+nearest\s+(.+)$/i)
    || destinationQuery.match(/^closest\s+(.+)$/i);

  if (nearestMatch) {
    const typeQuery = nearestMatch[1].trim();
    const result = findNearest(typeQuery, startNodeId);
    if (!result) {
      return { success: false, error: `No ${typeQuery} found in the campus graph.` };
    }
    return result;
  }

  // Resolve destination
  const resolved = resolveNode(destinationQuery);
  if (!resolved) {
    return {
      success: false,
      error: `Destination not found: "${destinationQuery}". Check the room label or try a category like "library", "lift", "washroom".`,
    };
  }

  const { nodeId: destId } = resolved;

  // Same node
  if (destId === startNodeId) {
    return buildRouteResult(startNodeId, destId, [startNodeId], 0);
  }

  // Run Dijkstra
  const result = dijkstra(startNodeId, destId);
  if (!result) {
    return {
      success: false,
      error: `No navigable path found from current location to "${resolved.node.label}". The graph may be disconnected.`,
    };
  }

  return buildRouteResult(startNodeId, destId, result.path, result.distance);
}

/**
 * Get details for a single node by ID.
 */
export function getNodeDetails(nodeId) {
  const node = nodes[nodeId];
  if (!node) return null;
  return { nodeId, ...node };
}

/**
 * List all named (non-corridor) nodes — used by AI search tool.
 */
export function searchNodes(query) {
  const q = query.trim().toLowerCase();
  return Object.entries(nodes)
    .filter(([, node]) => node.label && node.label.toLowerCase().includes(q))
    .map(([nodeId, node]) => ({ nodeId, label: node.label, type: node.type }))
    .slice(0, 10); // cap at 10 results
}
