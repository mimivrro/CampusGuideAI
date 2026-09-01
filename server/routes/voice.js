/**
 * voice.js — WebSocket handler for Gemini Live voice sessions
 *
 * Upgrade path: ws://localhost:5000/ws/voice?nodeId=node_1005
 *
 * Browser → Server messages (JSON):
 *   { type: "audio",  data: "<base64 PCM16 @ 16kHz>" }
 *   { type: "text",   message: "<user text>" }     ← optional text fallback
 *
 * Server → Browser messages (JSON) — see geminiLiveService.js for full list.
 */

import { WebSocketServer } from 'ws';
import {
  addVoiceSession,
  removeVoiceSession,
  getVoiceSessionCount,
  VOICE_MAX_PER_IP,
} from '../middleware/rateLimiter.js';
import { createLiveSession } from '../services/geminiLiveService.js';

/**
 * Attach the WebSocket server to the HTTP server.
 * Called from index.js after createServer().
 *
 * @param {http.Server} httpServer
 */
export function attachVoiceWebSocket(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  // ── HTTP upgrade handler ────────────────────────────────────────────────
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (!url.pathname.startsWith('/ws/voice')) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  // ── WebSocket connection ────────────────────────────────────────────────
  wss.on('connection', async (ws, req) => {
    const ip =
      req.headers['x-forwarded-for']?.split(',')[0].trim() ||
      req.socket.remoteAddress ||
      'unknown';

    const url  = new URL(req.url, `http://${req.headers.host}`);
    const nodeId = url.searchParams.get('nodeId') || 'node_1005';

    // ── Concurrent session limit ──────────────────────────────────────────
    if (getVoiceSessionCount(ip) >= VOICE_MAX_PER_IP) {
      ws.send(JSON.stringify({
        type: 'error',
        message: `Maximum ${VOICE_MAX_PER_IP} concurrent voice sessions per device.`,
      }));
      ws.close();
      return;
    }

    addVoiceSession(ip);
    console.log(`[Voice] Session opened — IP: ${ip}  nodeId: ${nodeId}`);

    let liveSession = null;

    // ── Start Gemini Live session ─────────────────────────────────────────
    try {
      liveSession = await createLiveSession(ws, nodeId);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
      ws.close();
      removeVoiceSession(ip);
      return;
    }

    // ── Receive messages from browser ─────────────────────────────────────
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // ignore malformed frames
      }

      if (msg.type === 'audio' && msg.data) {
        // Forward PCM16 audio chunk to Gemini
        liveSession.sendRealtimeInput({
          audio: {
            data: msg.data,
            mimeType: 'audio/pcm;rate=16000',
          },
        });
      } else if (msg.type === 'text' && msg.message) {
        // Text fallback (for testing without mic)
        liveSession.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: msg.message }] }],
          turnComplete: true,
        });
      }
    });

    // ── Cleanup on disconnect ─────────────────────────────────────────────
    ws.on('close', () => {
      console.log(`[Voice] Session closed — IP: ${ip}`);
      removeVoiceSession(ip);
      try { liveSession?.close(); } catch { /* already closed */ }
    });

    ws.on('error', (err) => {
      console.error(`[Voice] WS error — IP: ${ip}`, err.message);
      removeVoiceSession(ip);
      try { liveSession?.close(); } catch { /* already closed */ }
    });
  });

  console.log('[Voice] WebSocket server attached at /ws/voice');
}
