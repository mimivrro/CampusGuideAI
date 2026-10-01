/**
 * navigationApi.js
 *
 * Frontend API client for the CampusGuide navigation backend.
 * Uses API_BASE from config.js (supports local Vite proxy and Render production URL).
 * Includes automatic offline/client-side engine fallback so routing, 3 alternative
 * paths, and timings work seamlessly even if the backend is sleeping, down, or
 * deployed on Vercel without a configured API origin.
 */

import { API_BASE } from '../config.js';
import {
  findClientRoute,
  findClientNearest,
  findClientAlternatives,
  calculateSteps,
  calculateTimeSeconds,
} from './clientNavigationEngine.js';

/**
 * Safe JSON parser — never throws on empty or non-JSON responses.
 * Returns null if the body cannot be parsed.
 */
async function safeJson(res) {
  try {
    const text = await res.text();
    if (!text || !text.trim()) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function enrichRoute(data) {
  if (!data) return data;
  const dist = data.distance ?? 0;
  const steps = data.steps ?? calculateSteps(dist);
  const timeSeconds = data.timeSeconds ?? calculateTimeSeconds(steps);
  return {
    ...data,
    steps,
    timeSeconds,
  };
}

function enrichAlternatives(data) {
  if (!data || !Array.isArray(data.paths)) return data;
  const enrichedPaths = data.paths.map((p, idx) => {
    const dist = p.distance ?? 0;
    const steps = p.steps ?? calculateSteps(dist);
    const timeSeconds = p.timeSeconds ?? calculateTimeSeconds(steps);
    return {
      ...p,
      rank: p.rank || idx + 1,
      steps,
      timeSeconds,
    };
  });
  return {
    ...data,
    paths: enrichedPaths,
  };
}

/**
 * Request the shortest route from startNodeId to a destination.
 *
 * @param {string} startNodeId      - Current location node (e.g. "node_1005")
 * @param {string} destinationQuery - Room label, category, or semantic query
 * @returns {Promise<RouteResult>}
 */
export async function getRoute(startNodeId, destinationQuery) {
  try {
    const res = await fetch(`${API_BASE}/navigation/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startNodeId, destinationQuery }),
    });

    if (res.ok) {
      const data = await safeJson(res);
      if (data && data.success) {
        return enrichRoute(data);
      }
    }
  } catch (err) {
    // Network or proxy failure: proceed to local engine
    console.warn('Backend route request failed, using client navigation engine:', err);
  }

  // Resilient client-side fallback
  const localResult = findClientRoute(startNodeId, destinationQuery);
  if (localResult && localResult.success) {
    return enrichRoute(localResult);
  }

  throw new Error(`Destination not found: "${destinationQuery}".`);
}

/**
 * Find the nearest node of a given type from startNodeId.
 *
 * @param {string} type         - e.g. "lift", "washroom", "stairs"
 * @param {string} startNodeId  - Current location node
 * @returns {Promise<RouteResult>}
 */
export async function getNearest(type, startNodeId) {
  try {
    const res = await fetch(`${API_BASE}/navigation/nearest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, startNodeId }),
    });

    if (res.ok) {
      const data = await safeJson(res);
      if (data && data.success) {
        return enrichRoute(data);
      }
    }
  } catch (err) {
    console.warn('Backend nearest request failed, using client navigation engine:', err);
  }

  const localResult = findClientNearest(type, startNodeId);
  if (localResult && localResult.success) {
    return enrichRoute(localResult);
  }

  throw new Error(`No ${type} found near current location.`);
}

/**
 * Search for named nodes by label fragment.
 *
 * @param {string} query
 * @returns {Promise<{ success: boolean, results: Array }>}
 */
export async function searchLocations(query) {
  try {
    const res = await fetch(
      `${API_BASE}/navigation/search?q=${encodeURIComponent(query)}`
    );
    const data = await safeJson(res);
    return data ?? { success: false, results: [] };
  } catch {
    return { success: false, results: [] };
  }
}

/**
 * Request up to 3 shortest loopless alternative routes from startNodeId to a destination.
 *
 * @param {string} startNodeId       - Current location node (e.g. "node_1005")
 * @param {string} destinationQuery  - Room label, node ID, category, or semantic query
 * @param {string} [destinationLabel] - Optional display label override (e.g. "A-102")
 * @returns {Promise<{ success: boolean, paths: Array }>}
 */
export async function getAlternatives(startNodeId, destinationQuery, destinationLabel = null) {
  try {
    const res = await fetch(`${API_BASE}/navigation/alternatives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startNodeId, destinationQuery, destinationLabel }),
    });

    if (res.ok) {
      const data = await safeJson(res);
      if (data && data.success && Array.isArray(data.paths) && data.paths.length > 0) {
        return enrichAlternatives(data);
      }
    }
  } catch (err) {
    console.warn('Backend alternatives request failed, using client navigation engine:', err);
  }

  // Resilient client-side fallback
  const localAlts = findClientAlternatives(startNodeId, destinationQuery, 3, destinationLabel);
  if (localAlts && localAlts.success && Array.isArray(localAlts.paths) && localAlts.paths.length > 0) {
    return enrichAlternatives(localAlts);
  }

  return { success: false, paths: [] };
}
