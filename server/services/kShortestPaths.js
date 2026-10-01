/**
 * kShortestPaths.js
 *
 * Yen's k-shortest loopless paths algorithm (k = 3).
 * Uses the existing graph from navigationService.js.
 * Returns distinct, loopless paths sorted shortest first.
 */

import { graph, buildRouteResult, resolveNode, findNearest } from './navigationService.js';
import { nodes } from '../data/buildingData.js';

// ---------------------------------------------------------------------------
// Time Model Constants (tweakable)
// ---------------------------------------------------------------------------
export const METERS_PER_UNIT = 0.05; // 1 graph coordinate unit ≈ 0.05 meters
export const STEP_LENGTH_M = 0.75;  // Typical stride length: 0.75m
export const STEP_SECONDS = 1;      // 1 step per second pace

export function calculateSteps(distance) {
  return Math.round((distance * METERS_PER_UNIT) / STEP_LENGTH_M);
}

export function calculateTimeSeconds(steps) {
  return steps * STEP_SECONDS;
}

// ---------------------------------------------------------------------------
// Dijkstra with Excluded Nodes & Excluded Edges
// ---------------------------------------------------------------------------
function dijkstraWithExclusions(startId, endId, excludedNodes, excludedEdges) {
  if (!graph[startId] || !graph[endId]) return null;
  if (excludedNodes.has(startId) || excludedNodes.has(endId)) return null;
  if (startId === endId) return { path: [startId], distance: 0 };

  const dist = {};
  const prev = {};
  const visited = new Set();

  for (const nodeId of Object.keys(graph)) {
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

    for (const { to, cost } of (graph[current] || [])) {
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
// Yen's K-Shortest Loopless Paths Algorithm
// ---------------------------------------------------------------------------
export function findKShortestPaths(startId, endId, k = 3) {
  if (!graph[startId] || !graph[endId]) return [];
  if (startId === endId) {
    return [{ path: [startId], distance: 0 }];
  }

  // 1. Initial shortest path using Dijkstra
  const initial = dijkstraWithExclusions(startId, endId, new Set(), new Set());
  if (!initial) return [];

  const A = [initial];
  const B = []; // Candidates: array of { path: string[], distance: number }

  for (let kIdx = 1; kIdx < k; kIdx++) {
    const prevPath = A[kIdx - 1].path;

    for (let i = 0; i < prevPath.length - 1; i++) {
      const spurNode = prevPath[i];
      const rootPath = prevPath.slice(0, i + 1);

      // Root path distance
      let rootDist = 0;
      for (let r = 0; r < i; r++) {
        const u = rootPath[r];
        const v = rootPath[r + 1];
        const edge = (graph[u] || []).find((e) => e.to === v);
        rootDist += edge ? edge.cost : 0;
      }

      // For each path p in A that shares rootPath prefix up to i, exclude next edge
      const excludedEdges = new Set();
      for (const p of A) {
        if (p.path.length > i + 1) {
          let matchesRoot = true;
          for (let r = 0; r <= i; r++) {
            if (p.path[r] !== rootPath[r]) {
              matchesRoot = false;
              break;
            }
          }
          if (matchesRoot) {
            excludedEdges.add(`${p.path[i]}->${p.path[i + 1]}`);
          }
        }
      }

      // Exclude all rootPath nodes except the spurNode
      const excludedNodes = new Set();
      for (let r = 0; r < i; r++) {
        excludedNodes.add(rootPath[r]);
      }

      const spur = dijkstraWithExclusions(spurNode, endId, excludedNodes, excludedEdges);

      if (spur && spur.path.length > 0) {
        const totalPath = rootPath.slice(0, i).concat(spur.path);
        const totalDist = rootDist + spur.distance;
        const pathKey = totalPath.join('->');

        const alreadyInA = A.some((p) => p.path.join('->') === pathKey);
        const alreadyInB = B.some((p) => p.path.join('->') === pathKey);

        if (!alreadyInA && !alreadyInB) {
          B.push({ path: totalPath, distance: totalDist });
        }
      }
    }

    if (B.length === 0) break;

    // Pick shortest candidate from B
    B.sort((a, b) => a.distance - b.distance);
    const nextBest = B.shift();
    A.push(nextBest);
  }

  return A;
}

// ---------------------------------------------------------------------------
// Alternative Routes Resolver & Builder
// ---------------------------------------------------------------------------
export function calculateAlternativeRoutes(startNodeId, destinationQuery, k = 3, destinationLabel = null) {
  if (!nodes[startNodeId]) {
    return { success: false, error: `Unknown start node: ${startNodeId}` };
  }

  // Handle "nearest ..." query
  const nearestMatch =
    destinationQuery.match(/^nearest\s+(.+)$/i) ||
    destinationQuery.match(/^find\s+nearest\s+(.+)$/i) ||
    destinationQuery.match(/^closest\s+(.+)$/i);

  let destId = null;
  let destLabel = destinationLabel || null;
  if (nearestMatch) {
    const typeQuery = nearestMatch[1].trim();
    const nearestResult = findNearest(typeQuery, startNodeId);
    if (!nearestResult) {
      return { success: false, error: `No ${typeQuery} found in the campus graph.` };
    }
    destId = nearestResult.destination.nodeId;
    if (!destLabel) destLabel = nearestResult.destination.label;
  } else {
    const resolved = resolveNode(destinationQuery);
    if (!resolved) {
      return {
        success: false,
        error: `Destination not found: "${destinationQuery}". Check the room label or try a category like "library", "lift", "washroom".`,
      };
    }
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

  const rawPaths = findKShortestPaths(startNodeId, destId, k);

  if (!rawPaths || rawPaths.length === 0) {
    const label = destLabel || nodes[destId]?.label || destId;
    return {
      success: false,
      error: `No navigable path found from current location to "${label}". The graph may be disconnected.`,
    };
  }

  // Sort shortest first
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
