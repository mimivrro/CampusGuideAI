/**
 * config.js
 *
 * Central configuration for API and WebSocket endpoints.
 *
 * Single-Server Render Deployment:
 * You only need to set ONE variable on Vercel:
 *   VITE_API_URL = https://your-backend.onrender.com
 *
 * getWebSocketUrl automatically converts https:// -> wss:// to connect
 * to the WebSocket voice assistant running on the same Render server.
 */

const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
const RAW_API_URL = env.VITE_API_URL || '';
const RAW_WS_URL = env.VITE_WS_URL || '';

// Clean base API URL without trailing slash (e.g. https://my-backend.onrender.com/api)
export const API_BASE = RAW_API_URL
  ? `${RAW_API_URL.replace(/\/+$/, '')}/api`
  : '/api';

/**
 * Builds the full WebSocket connection URL for voice streaming.
 * Automatically derives wss:// from VITE_API_URL if VITE_WS_URL is not set.
 * 
 * @param {string} nodeId - Current location node ID
 * @returns {string} WebSocket URL
 */
export function getWebSocketUrl(nodeId) {
  // If an explicit WS URL is provided, use it
  if (RAW_WS_URL) {
    const cleanWs = RAW_WS_URL.replace(/\/+$/, '');
    return `${cleanWs}/ws/voice?nodeId=${nodeId}`;
  }

  // Automatically derive wss:// from VITE_API_URL for single Render component
  if (RAW_API_URL) {
    const cleanApi = RAW_API_URL.replace(/\/+$/, '');
    const wsUrl = cleanApi.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
    return `${wsUrl}/ws/voice?nodeId=${nodeId}`;
  }

  // Fallback to current browser host (for local Vite dev proxy)
  const proto = (typeof window !== 'undefined' && window.location.protocol === 'https:') ? 'wss:' : 'ws:';
  const host = (typeof window !== 'undefined' && window.location.host) ? window.location.host : 'localhost:5000';
  return `${proto}//${host}/ws/voice?nodeId=${nodeId}`;
}
