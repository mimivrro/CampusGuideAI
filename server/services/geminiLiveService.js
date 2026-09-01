/**
 * geminiLiveService.js
 *
 * Manages Gemini Live (real-time voice) sessions.
 * Each browser WebSocket connection maps to one Gemini Live session.
 *
 * Audio protocol
 * ──────────────
 * Browser → Server: PCM16 @ 16 kHz mono (base64)
 * Server  → Gemini: same format via sendRealtimeInput
 * Gemini  → Server: PCM16 @ 24 kHz mono (base64) in audio parts
 * Server  → Browser: relayed as-is
 *
 * Message types sent TO the browser WebSocket
 * ────────────────────────────────────────────
 * { type: "status",  message: string }
 * { type: "audio",   data: base64, mimeType: string }
 * { type: "transcript", text: string }
 * { type: "route",   routeResult: object }
 * { type: "error",   message: string }
 */

import { GoogleGenAI } from '@google/genai';
import {
  SYSTEM_INSTRUCTION,
  TOOL_DECLARATIONS,
  executeTool,
} from './geminiService.js';

const MODEL_LIVE = process.env.GEMINI_LIVE_MODEL || 'gemini-2.0-flash-live-001';

/**
 * Create and attach a Gemini Live session to a WebSocket connection.
 *
 * @param {WebSocket} ws            - The browser WebSocket
 * @param {string}    currentNodeId - User's current campus location
 * @returns {Promise<object>}       - The Live session object (call .close() to end)
 */
export async function createLiveSession(ws, currentNodeId) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const ai = new GoogleGenAI({ apiKey: key });

  // Helper: safely send JSON to the browser WS (no-op if closed)
  function send(payload) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify(payload));
    }
  }

  const session = await ai.live.connect({
    model: MODEL_LIVE,
    config: {
      responseModalities: ['AUDIO', 'TEXT'],
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Aoede' },
        },
      },
    },
    callbacks: {
      onopen() {
        send({ type: 'status', message: 'connected' });
      },

      onmessage(message) {
        // ── Audio / text from Gemini ──────────────────────────────────────
        const parts = message.serverContent?.modelTurn?.parts ?? [];
        for (const part of parts) {
          if (part.inlineData) {
            send({
              type: 'audio',
              data: part.inlineData.data,
              mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
            });
          } else if (part.text) {
            send({ type: 'transcript', text: part.text });
          }
        }

        // ── Turn complete ─────────────────────────────────────────────────
        if (message.serverContent?.turnComplete) {
          send({ type: 'status', message: 'ready' });
        }

        // ── Function calls ────────────────────────────────────────────────
        const functionCalls = message.toolCall?.functionCalls ?? [];
        if (functionCalls.length > 0) {
          const functionResponses = [];

          for (const fc of functionCalls) {
            let toolOutput;
            try {
              toolOutput = executeTool(fc.name, fc.args ?? {}, currentNodeId);
            } catch (err) {
              toolOutput = {
                data: { error: `Tool error: ${err.message}` },
                routeResult: null,
              };
            }

            // If a route was calculated, push it to the frontend map
            if (toolOutput.routeResult) {
              send({ type: 'route', routeResult: toolOutput.routeResult });
            }

            functionResponses.push({
              id: fc.id,
              name: fc.name,
              response: { result: toolOutput.data },
            });
          }

          // Feed results back to Gemini
          session.sendToolResponse({ functionResponses });
        }
      },

      onerror(err) {
        console.error('[Live] Gemini session error:', err);
        send({ type: 'error', message: err.message || 'Live session error.' });
      },

      onclose() {
        send({ type: 'status', message: 'disconnected' });
      },
    },
  });

  return session;
}
