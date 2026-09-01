/**
 * geminiService.js
 *
 * Gemini AI integration for CampusGuide AI.
 *
 * Architecture
 * ────────────
 * 1. User sends a natural-language message.
 * 2. Gemini receives the message along with campus tool definitions.
 * 3. Gemini decides which tool(s) to call (it never invents campus data).
 * 4. This service executes the tool on the navigation engine.
 * 5. The result is fed back to Gemini.
 * 6. Gemini produces a final spoken/written response.
 * 7. If a route was calculated, it is returned alongside the text so the
 *    frontend map can update.
 *
 * The LLM never receives the full graph — only tool results.
 * Route calculation always happens in navigationService, never in the LLM.
 */

import { GoogleGenAI } from '@google/genai';
import {
  calculateRoute,
  findNearest,
  searchNodes,
  getNodeDetails,
  resolveNode,
} from './navigationService.js';

// ─── Model config ────────────────────────────────────────────────────────────
const MODEL_TEXT = process.env.GEMINI_TEXT_MODEL;
const MAX_TOOL_ROUNDS = 5; // prevent infinite function-call loops

// ─── Lazy AI client init ─────────────────────────────────────────────────────
let _client = null;

function getClient() {
  if (_client) return _client;

  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new Error(
      'GEMINI_API_KEY is not configured. ' +
      'Open server/.env and paste your real Gemini API key.'
    );
  }

  _client = new GoogleGenAI({ apiKey: key });
  return _client;
}

// ─── System instruction ───────────────────────────────────────────────────────
export const SYSTEM_INSTRUCTION = `
You are CampusGuide AI, an indoor navigation assistant for Campus 25.

You help students and staff find rooms, facilities, and navigate between locations.

STRICT RULES — follow these at all times:
- You may ONLY provide campus facts that come from the supplied campus knowledge base tools.
- NEVER invent, guess, or assume room numbers, locations, distances, routes, floors, or facilities.
- NEVER describe a route or give directions yourself — always use the calculateRoute tool.
- If a destination does not exist in the knowledge base, say clearly that you cannot find it and suggest searching by category (e.g., "Try asking for 'nearest lift' or 'library'").
- If the user's starting location is unknown, use the application's current location value.

BEHAVIOR:
- When a user asks where something is → call searchCampusLocation, then calculateRoute.
- When a user asks for the nearest X → call findNearest.
- When a user asks for directions → call calculateRoute.
- When a user asks about a specific node ID → call getLocationDetails.
- For navigation responses, mention important landmarks on the route (lifts, stairs, entrances) if they appear.
- Keep responses concise and natural — you will often be spoken aloud.
- Acknowledge when a destination is not in your knowledge base rather than making something up.

CAMPUS CONTEXT:
- Campus 25 has blocks A, B, and C.
- A-Block Entrance (node_1005) is the default starting point.
- Lifts are labelled LIFT-1 through LIFT-20.
- Stairs are labelled STAIRS-1 through STAIRS-12.
- Special facilities: LIBRARY, FACULTY LOUNGE, KIIT CAFE.
- Washrooms: GENTS WASHROOM, LADIES WASHROOM (multiple locations).
`.trim();

// ─── Tool declarations (sent to Gemini) ──────────────────────────────────────
export const TOOL_DECLARATIONS = [
  {
    name: 'searchCampusLocation',
    description:
      'Search for campus locations by name, room number, or keyword. ' +
      'Returns up to 10 matching named locations. Use this before calculateRoute ' +
      'when you need to find a nodeId for a label.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Room label, keyword, or partial name to search for. ' +
            'Examples: "A-007", "library", "B-018", "cafeteria".',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'getLocationDetails',
    description: 'Get full details (label, type, coordinates) for a specific node ID.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'The node ID, e.g. "node_1007".',
        },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'calculateRoute',
    description:
      'Calculate the shortest walking route from the user\'s current location ' +
      'to a destination. The destination can be a room label (e.g. "A-007"), ' +
      'a facility name (e.g. "LIBRARY", "KIIT CAFE"), or a category (e.g. "classroom"). ' +
      'Returns the ordered route, total distance, estimated minutes, and landmarks.',
    parameters: {
      type: 'object',
      properties: {
        destinationQuery: {
          type: 'string',
          description:
            'Destination label, room number, or category. ' +
            'Examples: "A-007", "LIBRARY", "KIIT CAFE", "FACULTY LOUNGE", "B-018".',
        },
        startNodeId: {
          type: 'string',
          description:
            'Optional override for the start node. ' +
            'Leave empty to use the user\'s current location.',
        },
      },
      required: ['destinationQuery'],
    },
  },
  {
    name: 'findNearest',
    description:
      'Find the nearest facility of a given type from the user\'s current location. ' +
      'Use this when the user asks for "nearest lift", "nearest washroom", etc.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description:
            'Facility type to find. Valid values: ' +
            '"lift", "stairs", "washroom", "washroom_gents", "washroom_ladies", ' +
            '"classroom", "lab", "office", "entrance", "cafeteria".',
        },
        startNodeId: {
          type: 'string',
          description:
            'Optional override for the start node. ' +
            'Leave empty to use the user\'s current location.',
        },
      },
      required: ['type'],
    },
  },
];

// ─── Tool executor ────────────────────────────────────────────────────────────

/**
 * Execute a Gemini-requested tool and return its result.
 * Also captures any route result that should update the frontend map.
 *
 * @param {string} toolName
 * @param {object} args
 * @param {string} currentNodeId
 * @returns {{ data: any, routeResult: object|null }}
 */
export function executeTool(toolName, args, currentNodeId) {
  switch (toolName) {
    case 'searchCampusLocation': {
      const results = searchNodes(String(args.query || ''));
      return {
        data: {
          found: results.length,
          locations: results,
          hint:
            results.length === 0
              ? 'No locations found. Try a different keyword or room number.'
              : undefined,
        },
        routeResult: null,
      };
    }

    case 'getLocationDetails': {
      const node = getNodeDetails(String(args.nodeId || ''));
      return {
        data: node ?? { error: `Node "${args.nodeId}" not found in campus graph.` },
        routeResult: null,
      };
    }

    case 'calculateRoute': {
      const startId = (args.startNodeId && String(args.startNodeId).match(/^node_\d+$/))
        ? args.startNodeId
        : currentNodeId;
      const result = calculateRoute(startId, String(args.destinationQuery || ''));
      return {
        data: result.success
          ? {
              destination: result.destination,
              distance: result.distance,
              estimatedMinutes: result.estimatedMinutes,
              landmarks: result.landmarks,
              routeLength: result.route.length,
            }
          : { error: result.error },
        routeResult: result.success ? result : null,
      };
    }

    case 'findNearest': {
      const startId = (args.startNodeId && String(args.startNodeId).match(/^node_\d+$/))
        ? args.startNodeId
        : currentNodeId;
      const result = findNearest(String(args.type || ''), startId);
      if (!result) {
        return {
          data: { error: `No "${args.type}" found reachable from current location.` },
          routeResult: null,
        };
      }
      return {
        data: {
          destination: result.destination,
          distance: result.distance,
          estimatedMinutes: result.estimatedMinutes,
          landmarks: result.landmarks,
        },
        routeResult: result,
      };
    }

    default:
      return {
        data: { error: `Unknown tool: ${toolName}` },
        routeResult: null,
      };
  }
}

// ─── Main chat function ───────────────────────────────────────────────────────

/**
 * Send a user message through the Gemini function-calling loop.
 *
 * @param {string} message        - Natural-language user query
 * @param {string} currentNodeId  - User's current location node ID
 * @returns {Promise<{ reply: string, routeResult: object|null }>}
 */
export async function chatWithCampusAI(message, currentNodeId) {
  const ai = getClient();

  // Build conversation history
  const contents = [
    { role: 'user', parts: [{ text: message }] },
  ];

  let routeResult = null;

  // Function-calling loop (max MAX_TOOL_ROUNDS to prevent runaway loops)
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await ai.models.generateContent({
      model: MODEL_TEXT,
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        // Prefer function calls when available
        toolConfig: {
          functionCallingConfig: { mode: 'AUTO' },
        },
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate) {
      break;
    }

    const parts = candidate.content?.parts ?? [];

    // Append model's response to history
    contents.push({ role: 'model', parts });

    // Extract any function calls from this response
    const functionCallParts = parts.filter((p) => p.functionCall);

    if (functionCallParts.length === 0) {
      // No more function calls — this is the final text response
      const textPart = parts.find((p) => p.text);
      const reply = textPart?.text?.trim() || 'I could not generate a response.';
      return { reply, routeResult };
    }

    // Execute each requested tool and collect responses
    const toolResponseParts = [];

    for (const part of functionCallParts) {
      const { name, args } = part.functionCall;

      let toolOutput;
      try {
        toolOutput = executeTool(name, args ?? {}, currentNodeId);
      } catch (err) {
        toolOutput = {
          data: { error: `Tool execution error: ${err.message}` },
          routeResult: null,
        };
      }

      // If this tool produced a route, capture it for the frontend
      if (toolOutput.routeResult) {
        routeResult = toolOutput.routeResult;
      }

      toolResponseParts.push({
        functionResponse: {
          name,
          response: { result: toolOutput.data },
        },
      });
    }

    // Feed tool results back into the conversation
    contents.push({ role: 'user', parts: toolResponseParts });
  }

  // Fallback if loop exhausted without a text response
  return {
    reply: 'I processed your request but could not generate a final response. Please try again.',
    routeResult,
  };
}
