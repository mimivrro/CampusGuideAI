/**
 * config.js
 *
 * Central configuration for API and WebSocket endpoints.
 *
 * - In local development: Defaults to relative paths ('/api' and current host wss/ws)
 *   allowing Vite dev server proxying.
 * - In production (Vercel): Uses VITE_API_URL and VITE_WS_URL set in Vercel env settings.
 */

const RAW_API_URL = import.meta.env.VITE_API_URL || '';
const RAW_WS_URL = import.meta.env.VITE_WS_URL || '';

// Clean base API URL without trailing slash
export const API_BASE = RAW_API_URL
  ? `${RAW_API_URL.replace(/\/+$/, '')}/api`
  : '/api';

/**
 * Builds the full WebSocket connection URL for voice streaming.
 * @param {string} nodeId - Current location node ID
 * @returns {string} WebSocket URL
 */
export function getWebSocketUrl(nodeId) {
  if (RAW_WS_URL) {
    const cleanWs = RAW_WS_URL.replace(/\/+$/, '');
    return `${cleanWs}/ws/voice?nodeId=${nodeId}`;
  }

  // Fallback to current browser host (for local Vite dev proxy)
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws/voice?nodeId=${nodeId}`;
}
