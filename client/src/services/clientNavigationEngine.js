/**
 * clientNavigationEngine.js
 *
 * Resilient, zero-dependency client-side routing & Yen's k-shortest paths engine.
 * Guarantees that whether running online, locally, or deployed statically to Vercel
 * without a live backend, the user ALWAYS gets instant routes, 3 alternative paths,
 * steps calculation, and accurate timing.
 */

import { FALLBACK_GRAPH_DATA } from './fallbackGraphData.js';
import { getNodesByFloor } from './locationSearch.js';

export const METERS_PER_UNIT = 0.05;
export const STEP_LENGTH_M = 0.75;
export const STEP_SECONDS = 1;

export function calculateSteps(distance) {
  return Math.round((distance * METERS_PER_UNIT) / STEP_LENGTH_M);
}

export function calculateTimeSeconds(steps) {
  return steps * STEP_SECONDS;
}

// ---------------------------------------------------------------------------
// Build Adjacency Graph from fallback data
// ---------------------------------------------------------------------------
const baseNodes = FALLBACK_GRAPH_DATA.nodes;
const baseEdges = FALLBACK_GRAPH_DATA.edges;

export const clientGraph = {};
for (const nodeId of Object.keys(baseNodes)) {
  clientGraph[nodeId] = [];
}

for (const [a, b] of baseEdges) {
  const na = baseNodes[a];
  const nb = baseNodes[b];
  if (!na || !nb) continue;
  const cost = Math.hypot(na.x - nb.x, na.y - nb.y);
  if (!clientGraph[a]) clientGraph[a] = [];
  if (!clientGraph[b]) clientGraph[b] = [];
  clientGraph[a].push({ to: b, cost });
  clientGraph[b].push({ to: a, cost });
}

// ---------------------------------------------------------------------------
// Node Resolution Helpers
// ---------------------------------------------------------------------------
function normalizeQuery(s) {
  return (s || '').toLowerCase().replace(/[\s\-_]+/g, '');
}

export function resolveClientNode(query) {
  if (!query || !query.trim()) return null;
  const rawQ = query.trim();
  const lowerQ = rawQ.toLowerCase();
  const normQ = normalizeQuery(rawQ);

  // 1. Direct nodeId match
  if (baseNodes[rawQ]) {
    return { nodeId: rawQ, node: baseNodes[rawQ], floor: 0 };
  }

  // 2. Pure 3-digit classroom number (e.g. "102", "103", "201")
  const room3Match = rawQ.match(/^([0-3])(\d{2})$/);
  if (room3Match) {
    const floor = parseInt(room3Match[1], 10);
    const roomNum = parseInt(room3Match[2], 10);
    const targetRoomStr = roomNum.toString().padStart(3, '0');

    // Try A-block first
    for (const [nodeId, node] of Object.entries(baseNodes)) {
      if (node.label && (node.label === `A-${targetRoomStr}` || node.label.endsWith(`-${targetRoomStr}`))) {
        const floorNodes = getNodesByFloor(baseNodes, floor);
        const floorNode = floorNodes[nodeId] || node;
        return { nodeId, node: floorNode, floor };
      }
    }
  }

  // 3. Block + room (e.g. "A102", "A 102", "A-102", "B103", "C201")
  const blockRoomMatch = rawQ.match(/^([A-Za-z])[\s\-_]*([0-3])(\d{2})$/i);
  if (blockRoomMatch) {
    const block = blockRoomMatch[1].toUpperCase();
    const floor = parseInt(blockRoomMatch[2], 10);
    const roomNum = parseInt(blockRoomMatch[3], 10);
    const baseRoomLabel = `${block}-${roomNum.toString().padStart(3, '0')}`;

    for (const [nodeId, node] of Object.entries(baseNodes)) {
      if (node.label && node.label.toUpperCase() === baseRoomLabel) {
        const floorNodes = getNodesByFloor(baseNodes, floor);
        const floorNode = floorNodes[nodeId] || node;
        return { nodeId, node: floorNode, floor };
      }
    }
  }

  // 4. Exact label match across all floors (0 to 3)
  for (const floor of [0, 1, 2, 3]) {
    const floorNodes = getNodesByFloor(baseNodes, floor);
    for (const [nodeId, node] of Object.entries(floorNodes)) {
      if (node.label && node.label.toLowerCase() === lowerQ) {
        return { nodeId, node, floor };
      }
    }
  }

  // 5. Normalized label match
  for (const floor of [0, 1, 2, 3]) {
    const floorNodes = getNodesByFloor(baseNodes, floor);
    for (const [nodeId, node] of Object.entries(floorNodes)) {
      if (node.label && normalizeQuery(node.label) === normQ) {
        return { nodeId, node, floor };
      }
    }
  }

  // 6. Semantic POI categories
  const poiKeywords = {
    library: ['seating', 'library'],
    cafe: ['cafeteria'],
    cafeteria: ['cafeteria'],
    canteen: ['cafeteria'],
    food: ['cafeteria'],
    lift: ['lift'],
    elevator: ['lift'],
    stairs: ['stairs'],
    staircase: ['stairs'],
    washroom: ['washroom_gents', 'washroom_ladies'],
    restroom: ['washroom_gents', 'washroom_ladies'],
    toilet: ['washroom_gents', 'washroom_ladies'],
    classroom: ['classroom'],
    lab: ['lab'],
    office: ['office'],
    entrance: ['entrance'],
  };

  for (const [key, types] of Object.entries(poiKeywords)) {
    if (lowerQ.includes(key)) {
      for (const [nodeId, node] of Object.entries(baseNodes)) {
        if (types.includes(node.type)) {
          return { nodeId, node, floor: 0 };
        }
      }
    }
  }

  // 7. Substring match
  for (const [nodeId, node] of Object.entries(baseNodes)) {
    if (node.label && node.label.toLowerCase().includes(lowerQ)) {
      return { nodeId, node, floor: 0 };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Turn Instructions Generator
// ---------------------------------------------------------------------------
function generateTurnInstructions(route) {
  if (!route || route.length < 2) return [];
  const instructions = [];

  for (let i = 0; i < route.length - 1; i++) {
    const curr = route[i];
    const next = route[i + 1];
    const dx = next.x - curr.x;
    const dy = next.y - curr.y;
    const distPx = Math.hypot(dx, dy);
    const distMeters = Math.max(1, Math.round(distPx * METERS_PER_UNIT));

    let action = 'STRAIGHT';
    let icon = 'straight';
    let text = `Walk ${distMeters}m straight towards ${next.label || next.type}`;

    if (i > 0) {
      const prev = route[i - 1];
      const v1x = curr.x - prev.x;
      const v1y = curr.y - prev.y;
      const v2x = next.x - curr.x;
      const v2y = next.y - curr.y;

      const angle1 = Math.atan2(v1y, v1x) * (180 / Math.PI);
      const angle2 = Math.atan2(v2y, v2x) * (180 / Math.PI);
      let diff = angle2 - angle1;
      while (diff > 180) diff -= 360;
      while (diff < -180) diff += 360;

      if (diff > 30 && diff <= 120) {
        action = 'TURN_RIGHT';
        icon = 'turn-right';
        text = `Turn right towards ${next.label || 'corridor'}`;
      } else if (diff > 120) {
        action = 'SHARP_RIGHT';
        icon = 'sharp-right';
        text = `Sharp right turn ahead`;
      } else if (diff < -30 && diff >= -120) {
        action = 'TURN_LEFT';
        icon = 'turn-left';
        text = `Turn left towards ${next.label || 'corridor'}`;
      } else if (diff < -120) {
        action = 'SHARP_LEFT';
        icon = 'sharp-left';
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
    action: 'ARRIVED',
    icon: 'arrived',
    text: `You have arrived at ${destNode.label || destNode.type}!`,
    distanceMeters: 0,
    targetLabel: destNode.label || destNode.type,
    targetType: destNode.type,
  });

  return instructions;
}

// ---------------------------------------------------------------------------
// Route Result Builder
// ---------------------------------------------------------------------------
function buildRouteResult(startNodeId, destNodeId, path, distance, overrideLabel = null) {
  const destNode = baseNodes[destNodeId] || { x: 0, y: 0, label: destNodeId, type: 'classroom' };
  const steps = calculateSteps(distance);
  const timeSeconds = calculateTimeSeconds(steps);
  const estimatedMinutes = Math.max(1, Math.round(timeSeconds / 60));

  const route = path.map((nodeId) => ({
    nodeId,
    x: baseNodes[nodeId]?.x ?? 0,
    y: baseNodes[nodeId]?.y ?? 0,
    label: baseNodes[nodeId]?.label ?? nodeId,
    type: baseNodes[nodeId]?.type ?? 'corridor',
  }));

  if (overrideLabel && route.length > 0) {
    route[route.length - 1].label = overrideLabel;
  }

  const landmarks = route
    .filter((n) => ['lift', 'stairs', 'entrance'].includes(n.type) && n.label)
    .map((n) => n.label);

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
    steps,
    timeSeconds,
    estimatedMinutes,
    landmarks,
    turnInstructions,
  };
}

// ---------------------------------------------------------------------------
// Dijkstra with Excluded Nodes & Excluded Edges
// ---------------------------------------------------------------------------
function dijkstraWithExclusions(startId, endId, excludedNodes = new Set(), excludedEdges = new Set()) {
  if (!clientGraph[startId] || !clientGraph[endId]) return null;
  if (excludedNodes.has(startId) || excludedNodes.has(endId)) return null;
  if (startId === endId) return { path: [startId], distance: 0 };

  const dist = {};
  const prev = {};
  const visited = new Set();

  for (const nodeId of Object.keys(clientGraph)) {
    dist[nodeId] = Infinity;
  }
  dist[startId] = 0;

  const queue = [{ nodeId: startId, d: 0 }];

  while (queue.length > 0) {
    queue.sort((a, b) => a.d - b.d);
    const { nodeId: current, d: currentDist } = queue.shift();

    if (visited.has(current)) continue;
    if (excludedNodes.has(current)) continue;
    visited.add(current);

    if (current === endId) break;

    for (const { to, cost } of (clientGraph[current] || [])) {
      if (visited.has(to) || excludedNodes.has(to)) continue;
      const edgeKey = `${current}->${to}`;
      if (excludedEdges.has(edgeKey)) continue;

      const newDist = currentDist + cost;
      if (newDist < dist[to]) {
        dist[to] = newDist;
        prev[to] = current;
        queue.push({ nodeId: to, d: newDist });
      }
    }
  }

  if (dist[endId] === Infinity || dist[endId] === undefined) return null;

  const path = [];
  let cur = endId;
  while (cur !== undefined) {
    path.unshift(cur);
    cur = prev[cur];
  }

  return { path, distance: dist[endId] };
}

// ---------------------------------------------------------------------------
// Yen's Algorithm (k = 3)
// ---------------------------------------------------------------------------
export function findClientKShortestPaths(startId, endId, k = 3) {
  if (!clientGraph[startId] || !clientGraph[endId]) return [];
  if (startId === endId) return [{ path: [startId], distance: 0 }];

  const initial = dijkstraWithExclusions(startId, endId, new Set(), new Set());
  if (!initial) return [];

  const A = [initial];
  const B = [];

  for (let kIdx = 1; kIdx < k; kIdx++) {
    const prevPath = A[kIdx - 1].path;

    for (let i = 0; i < prevPath.length - 1; i++) {
      const spurNode = prevPath[i];
      const rootPath = prevPath.slice(0, i + 1);

      let rootDist = 0;
      for (let r = 0; r < i; r++) {
        const u = rootPath[r];
        const v = rootPath[r + 1];
        const edge = (clientGraph[u] || []).find((e) => e.to === v);
        rootDist += edge ? edge.cost : 0;
      }

      const excludedEdges = new Set();
      for (const p of A) {
        if (p.path.length > i + 1) {
          let matches = true;
          for (let r = 0; r <= i; r++) {
            if (p.path[r] !== rootPath[r]) {
              matches = false;
              break;
            }
          }
          if (matches) {
            excludedEdges.add(`${p.path[i]}->${p.path[i + 1]}`);
          }
        }
      }

      const excludedNodes = new Set();
      for (let r = 0; r < i; r++) {
        excludedNodes.add(rootPath[r]);
      }

      const spur = dijkstraWithExclusions(spurNode, endId, excludedNodes, excludedEdges);
      if (spur && spur.path.length > 0) {
        const totalPath = rootPath.slice(0, i).concat(spur.path);
        const totalDist = rootDist + spur.distance;
        const pathKey = totalPath.join('->');

        const inA = A.some((p) => p.path.join('->') === pathKey);
        const inB = B.some((p) => p.path.join('->') === pathKey);
        if (!inA && !inB) {
          B.push({ path: totalPath, distance: totalDist });
        }
      }
    }

    if (B.length === 0) break;
    B.sort((a, b) => a.distance - b.distance);
    A.push(B.shift());
  }

  return A;
}

// ---------------------------------------------------------------------------
// Client API Public Methods
// ---------------------------------------------------------------------------

export function findClientNearest(typeQuery, startNodeId) {
  const normType = typeQuery.trim().toLowerCase();
  let best = null;

  for (const [nodeId, node] of Object.entries(baseNodes)) {
    const rawType = (node.type || '').replace(/_/g, ' ').toLowerCase();
    if (rawType.includes(normType) || (node.label && node.label.toLowerCase().includes(normType))) {
      const res = dijkstraWithExclusions(startNodeId, nodeId);
      if (res && (!best || res.distance < best.distance)) {
        best = { ...res, destId: nodeId, label: node.label };
      }
    }
  }

  if (!best) return null;
  return buildRouteResult(startNodeId, best.destId, best.path, best.distance, best.label);
}

export function findClientRoute(startNodeId, destinationQuery) {
  if (!baseNodes[startNodeId]) {
    return { success: false, error: `Unknown start node: ${startNodeId}` };
  }

  const nearestMatch = destinationQuery.match(/^nearest\s+(.+)$/i)
    || destinationQuery.match(/^find\s+nearest\s+(.+)$/i)
    || destinationQuery.match(/^closest\s+(.+)$/i);

  if (nearestMatch) {
    const result = findClientNearest(nearestMatch[1].trim(), startNodeId);
    if (!result) return { success: false, error: `No ${nearestMatch[1]} found nearby.` };
    return result;
  }

  const resolved = resolveClientNode(destinationQuery);
  if (!resolved) {
    return { success: false, error: `Destination "${destinationQuery}" not found.` };
  }

  const { nodeId: destId, node } = resolved;
  if (destId === startNodeId) {
    return buildRouteResult(startNodeId, destId, [startNodeId], 0, node?.label);
  }

  const res = dijkstraWithExclusions(startNodeId, destId);
  if (!res) {
    return { success: false, error: `No route found to ${node?.label || destId}.` };
  }

  return buildRouteResult(startNodeId, destId, res.path, res.distance, node?.label);
}

export function findClientAlternatives(startNodeId, destinationQuery, k = 3, destinationLabel = null) {
  if (!baseNodes[startNodeId]) {
    return { success: false, error: `Unknown start node: ${startNodeId}` };
  }

  let destId = null;
  let destLabel = destinationLabel || null;

  const nearestMatch = destinationQuery.match(/^nearest\s+(.+)$/i)
    || destinationQuery.match(/^find\s+nearest\s+(.+)$/i)
    || destinationQuery.match(/^closest\s+(.+)$/i);

  if (nearestMatch) {
    const nearest = findClientNearest(nearestMatch[1].trim(), startNodeId);
    if (!nearest) return { success: false, error: `No ${nearestMatch[1]} found.` };
    destId = nearest.destination.nodeId;
    if (!destLabel) destLabel = nearest.destination.label;
  } else {
    const resolved = resolveClientNode(destinationQuery);
    if (!resolved) return { success: false, error: `Destination "${destinationQuery}" not found.` };
    destId = resolved.nodeId;
    if (!destLabel) destLabel = resolved.node?.label;
  }

  if (destId === startNodeId) {
    const single = buildRouteResult(startNodeId, destId, [startNodeId], 0, destLabel);
    return {
      success: true,
      paths: [{ ...single, rank: 1, steps: 0, timeSeconds: 0 }],
    };
  }

  const rawPaths = findClientKShortestPaths(startNodeId, destId, k);
  if (!rawPaths || rawPaths.length === 0) {
    return { success: false, error: `No alternative paths found to ${destLabel || destId}.` };
  }

  rawPaths.sort((a, b) => a.distance - b.distance);

  const paths = rawPaths.map((p, idx) => {
    const steps = calculateSteps(p.distance);
    const timeSeconds = calculateTimeSeconds(steps);
    const baseResult = buildRouteResult(startNodeId, destId, p.path, p.distance, destLabel);
    return {
      ...baseResult,
      rank: idx + 1,
      steps,
      timeSeconds,
    };
  });

  return { success: true, paths };
}
