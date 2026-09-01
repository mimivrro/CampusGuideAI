/**
 * navigationApi.js
 *
 * Frontend API client for the CampusGuide navigation backend.
 * Uses API_BASE from config.js (supports local Vite proxy and Render production URL).
 */

import { API_BASE } from '../config.js';

/**
 * Safe JSON parser — never throws on empty or non-JSON responses.
 * Returns null if the body cannot be parsed.
 */
async function safeJson(res) {
  const text = await res.text();
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Request the shortest route from startNodeId to a destination.
 *
 * @param {string} startNodeId      - Current location node (e.g. "node_1005")
 * @param {string} destinationQuery - Room label, category, or semantic query
 * @returns {Promise<RouteResult>}
 */
export async function getRoute(startNodeId, destinationQuery) {
  let res;
  try {
    res = await fetch(`${API_BASE}/navigation/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startNodeId, destinationQuery }),
    });
  } catch (networkErr) {
    throw new Error('Cannot reach the navigation server. Is backend service active?');
  }

  const data = await safeJson(res);

  if (!res.ok) {
    throw new Error(
      data?.error || `Navigation request failed (HTTP ${res.status})`
    );
  }

  if (!data) {
    throw new Error('Server returned an empty response. Please try again.');
  }

  return data;
}

/**
 * Find the nearest node of a given type from startNodeId.
 *
 * @param {string} type         - e.g. "lift", "washroom", "stairs"
 * @param {string} startNodeId  - Current location node
 * @returns {Promise<RouteResult>}
 */
export async function getNearest(type, startNodeId) {
  let res;
  try {
    res = await fetch(`${API_BASE}/navigation/nearest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, startNodeId }),
    });
  } catch (networkErr) {
    throw new Error('Cannot reach the navigation server. Is backend service active?');
  }

  const data = await safeJson(res);

  if (!res.ok) {
    throw new Error(
      data?.error || `Nearest lookup failed (HTTP ${res.status})`
    );
  }

  if (!data) {
    throw new Error('Server returned an empty response. Please try again.');
  }

  return data;
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
