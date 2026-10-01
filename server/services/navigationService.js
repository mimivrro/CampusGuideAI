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
export const graph = {};

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
 * Get nodes with floor-adjusted labels (e.g. A-002 -> A-102 on floor 1, A-202 on floor 2).
 * Follows the Campus 25 floor room numbering convention.
 */
export function getNodesByFloor(floor = 0) {
  const filtered = {};
  for (const [id, node] of Object.entries(nodes)) {
    const newNode = { ...node, baseLabel: node.label, floor };
    if (newNode.label && newNode.label.match(/^[A-Z]-\d{3}$/)) {
      const match = newNode.label.match(/^([A-Z])-(\d{3})$/);
      if (match) {
        const block = match[1];
        const roomNumber = parseInt(match[2], 10);
        if (floor === 0) {
          newNode.label = `${block}-${roomNumber.toString().padStart(3, '0')}`;
        } else {
          const newRoomNumber = (floor * 100) + roomNumber;
          newNode.label = `${block}-${newRoomNumber.toString().padStart(3, '0')}`;
        }
      }
    }
    filtered[id] = newNode;
  }
  return filtered;
}

function normalizeQuery(s) {
  return (s || '').toLowerCase().replace(/[\s\-_]+/g, '');
}

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
 * 3. Search across all floors (handles "102", "103", "201", "A102", "B 103", "C 201")
 * 4. Partial label match
 * 5. Semantic type/category
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

  // 3. Search across all floors (handles "102", "103", "201", "A102", "B 103", "C 201")
  const matches = searchNodes(q);
  if (matches.length > 0 && matches[0].score >= 700) {
    const top = matches[0];
    return {
      nodeId: top.nodeId,
      node: {
        ...nodes[top.nodeId],
        label: top.label,
        floor: top.floor,
      },
    };
  }

  // 4. Partial label — prefer shorter label (more specific)
  const partial = findByPartialLabel(q);
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    // Pick the one with the shortest label as it's most specific
    partial.sort((a, b) => a.node.label.length - b.node.label.length);
    return partial[0];
  }

  // 5. Type / semantic category — return first match (use findCandidates for nearest)
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

  const matches = searchNodes(q);
  if (matches.length > 0 && matches[0].score >= 700) {
    return matches.map(m => ({
      nodeId: m.nodeId,
      node: { ...nodes[m.nodeId], label: m.label, floor: m.floor }
    }));
  }

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

function generateTurnInstructions(route) {
  if (!route || route.length < 2) return [];
  const SCALE_METERS = 0.05; // 1 unit ≈ 0.05 meters
  const instructions = [];

  for (let i = 0; i < route.length - 1; i++) {
    const curr = route[i];
    const next = route[i + 1];
    const dx = next.x - curr.x;
    const dy = next.y - curr.y;
    const distPx = Math.hypot(dx, dy);
    const distMeters = Math.max(1, Math.round(distPx * SCALE_METERS));

    let action = "STRAIGHT";
    let icon = "straight";
    let text = `Walk ${distMeters}m straight towards ${next.label || next.type}`;

    if (i > 0) {
      const prev = route[i - 1];
      const v1x = curr.x - prev.x;
      const v1y = curr.y - prev.y;
      const angle1 = Math.atan2(v1y, v1x);
      const angle2 = Math.atan2(dy, dx);
      let diff = (angle2 - angle1) * (180 / Math.PI);
      
      while (diff > 180) diff -= 360;
      while (diff < -180) diff += 360;

      if (curr.type === "lift") {
        action = "LIFT";
        icon = "lift";
        text = `Take ${curr.label || "Lift"} to next floor section`;
      } else if (curr.type === "stairs") {
        action = "STAIRS";
        icon = "stairs";
        text = `Use ${curr.label || "Stairs"}`;
      } else if (diff > 25 && diff < 70) {
        action = "SLIGHT_RIGHT";
        icon = "slight-right";
        text = `Bear right towards ${next.label || "corridor"}`;
      } else if (diff >= 70 && diff <= 120) {
        action = "TURN_RIGHT";
        icon = "turn-right";
        text = `Turn right towards ${next.label || "corridor"}`;
      } else if (diff > 120) {
        action = "SHARP_RIGHT";
        icon = "sharp-right";
        text = `Sharp right turn ahead`;
      } else if (diff < -25 && diff > -70) {
        action = "SLIGHT_LEFT";
        icon = "slight-left";
        text = `Bear left towards ${next.label || "corridor"}`;
      } else if (diff <= -70 && diff >= -120) {
        action = "TURN_LEFT";
        icon = "turn-left";
        text = `Turn left towards ${next.label || "corridor"}`;
      } else if (diff < -120) {
        action = "SHARP_LEFT";
        icon = "sharp-left";
        text = `Sharp left turn ahead`;
      }
    }

    instructions.push({
      stepIndex: i,
      fromNodeId: curr.nodeId,
      toNodeId: next.nodeId,
      action,
      icon,
      text,
      distanceMeters: distMeters,
      targetLabel: next.label || next.type,
      targetType: next.type,
    });
  }

  const destNode = route[route.length - 1];
  instructions.push({
    stepIndex: route.length - 1,
    fromNodeId: destNode.nodeId,
    toNodeId: destNode.nodeId,
    action: "ARRIVED",
    icon: "arrived",
    text: `You have arrived at ${destNode.label || destNode.type}!`,
    distanceMeters: 0,
    targetLabel: destNode.label || destNode.type,
    targetType: destNode.type,
  });

  return instructions;
}

export function buildRouteResult(startNodeId, destNodeId, path, distance, overrideLabel = null) {
  const destNode = nodes[destNodeId];
  const METERS_PER_UNIT = 0.05;
  const STEP_LENGTH_M = 0.75;
  const STEP_SECONDS = 1;
  const steps = Math.round((distance * METERS_PER_UNIT) / STEP_LENGTH_M);
  const timeSeconds = steps * STEP_SECONDS;
  const estimatedMinutes = Math.max(1, Math.round(timeSeconds / 60));

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

  const turnInstructions = generateTurnInstructions(route);

  return {
    success: true,
    destination: {
      nodeId: destNodeId,
      label: overrideLabel || destNode.label,
      type: destNode.type,
      x: destNode.x,
      y: destNode.y,
    },
    route,
    distance: Math.round(distance),
    estimatedMinutes,
    landmarks,
    turnInstructions,
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
    return buildRouteResult(startNodeId, destId, [startNodeId], 0, resolved.node?.label);
  }

  // Run Dijkstra
  const result = dijkstra(startNodeId, destId);
  if (!result) {
    return {
      success: false,
      error: `No navigable path found from current location to "${resolved.node.label}". The graph may be disconnected.`,
    };
  }

  return buildRouteResult(startNodeId, destId, result.path, result.distance, resolved.node?.label);
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
 * List all matching named nodes — searches across all floors and aliases.
 * Supports:
 * - Room numbers: "102", "103", "201"
 * - Block + room: "A102", "A 102", "A-102", "B 103", "C 201"
 * - Base labels: "A-001", "A-007"
 * - Amenities: "library", "lift", "washroom", "cafe", "stairs"
 * - Node IDs: "node_1001"
 */
export function searchNodes(query) {
  if (!query || !query.trim()) return [];
  const rawQ = query.trim().toLowerCase();
  const normQ = normalizeQuery(query);

  const results = [];
  const seen = new Set();

  for (const floor of [0, 1, 2, 3]) {
    const floorNodes = getNodesByFloor(floor);
    for (const [nodeId, node] of Object.entries(floorNodes)) {
      if (node.type === 'corridor') continue;

      const rawLabel = (node.label || '').toLowerCase();
      const normLabel = normalizeQuery(node.label);
      const roomNumMatch = node.label.match(/\d{3}/);
      const roomNum = roomNumMatch ? roomNumMatch[0] : '';
      const rawType = (node.type || '').replace(/_/g, ' ').toLowerCase();

      let score = 0;

      if (normLabel === normQ) score = 1000;
      else if (roomNum && roomNum === normQ) score = 950;
      else if (normLabel.startsWith(normQ)) score = 900;
      else if (normLabel.includes(normQ)) score = 800;
      else if (rawLabel.includes(rawQ)) score = 750;
      else if (rawType.includes(rawQ)) score = 600;
      else if (rawQ.startsWith('node') && nodeId.toLowerCase().includes(rawQ)) score = 500;

      if (score > 0) {
        const key = `${nodeId}-${node.label}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            nodeId,
            label: node.label,
            type: node.type,
            floor,
            score,
          });
        }
      }
    }
  }

  results.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return results.slice(0, 15);
}
