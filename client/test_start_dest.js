import { resolveClientNode, findClientRoute, findClientNearest } from './src/services/clientNavigationEngine.js';

const DEFAULT_NODE_ID = "node_1005"; // A-Block Entrance

function simulateNavigate(destQuery, startQuery) {
  const destQ = (destQuery !== undefined ? destQuery : "").trim();
  const startQ = (startQuery !== undefined ? startQuery : "").trim();

  if (!destQ) {
    return { success: false, error: "Please enter a destination." };
  }

  // 1. Resolve start node (fallback to default if empty)
  let activeStartId = DEFAULT_NODE_ID;
  let activeStartLabelStr = "A-Block Entrance";

  if (startQ) {
    const resolvedStart = resolveClientNode(startQ);
    if (!resolvedStart) {
      return {
        success: false,
        error: `Start location not found: "${startQ}". Check the room label or try a category like "library", "lift", "washroom".`
      };
    }
    activeStartId = resolvedStart.nodeId;
    activeStartLabelStr = resolvedStart.node?.label || startQ;
  }

  // 2. Pre-validate start != destination
  const nearestMatch = destQ.match(/^nearest\s+(.+)$/i);
  if (!nearestMatch) {
    const resolvedDest = resolveClientNode(destQ);
    if (resolvedDest && resolvedDest.nodeId === activeStartId) {
      return {
        success: false,
        error: `Start and destination cannot be the same location (${resolvedDest.node?.label || activeStartLabelStr}).`
      };
    }
  }

  let result;
  if (nearestMatch) {
    result = findClientNearest(nearestMatch[1].trim(), activeStartId);
    if (!result) return { success: false, error: `No ${nearestMatch[1]} found nearby.` };
  } else {
    result = findClientRoute(activeStartId, destQ);
  }

  if (result.destination?.nodeId === activeStartId) {
    return {
      success: false,
      error: `Start and destination cannot be the same location (${activeStartLabelStr}).`
    };
  }

  return {
    ...result,
    activeStartId,
    activeStartLabel: activeStartLabelStr,
  };
}

// Running the 5 required test cases
console.log("=== RUNNING NAVIGATION TEST CASES ===\n");

// Case a: valid start + valid destination -> route is correct
console.log("TEST CASE (a): Valid start + valid destination");
const caseA = simulateNavigate("A-008", "A-001");
console.log("Result:", {
  success: caseA.success,
  start: caseA.activeStartLabel,
  startNodeId: caseA.activeStartId,
  dest: caseA.destination?.label,
  distance: caseA.distance,
  steps: caseA.steps,
  routeLength: caseA.route?.length,
  path: caseA.route?.map(n => n.label).join(" -> ")
});
if (!caseA.success || caseA.route[0].label !== "A-001" || caseA.route[caseA.route.length - 1].label !== "A-008") {
  throw new Error("Case (a) failed!");
}
console.log("-> PASS: Case (a) correctly routed from A-001 to A-008.\n");

// Case b: empty start (fallback to A-Block Entrance)
console.log("TEST CASE (b): Empty start");
const caseB = simulateNavigate("Library", "");
console.log("Result:", {
  success: caseB.success,
  start: caseB.activeStartLabel,
  startNodeId: caseB.activeStartId,
  dest: caseB.destination?.label,
  distance: caseB.distance,
  steps: caseB.steps,
  path: caseB.route?.map(n => n.label).join(" -> ")
});
if (!caseB.success || caseB.activeStartId !== DEFAULT_NODE_ID || caseB.route[0].nodeId !== DEFAULT_NODE_ID) {
  throw new Error("Case (b) failed!");
}
console.log("-> PASS: Case (b) correctly fell back to A-Block Entrance.\n");

// Case c: invalid start
console.log("TEST CASE (c): Invalid start");
const caseC = simulateNavigate("Library", "InvalidLocationXYZ999");
console.log("Result:", caseC);
if (caseC.success || !caseC.error.includes("Start location not found")) {
  throw new Error("Case (c) failed!");
}
console.log("-> PASS: Case (c) correctly rejected invalid start with error message.\n");

// Case d: start == destination
console.log("TEST CASE (d): start == destination");
const caseD1 = simulateNavigate("Library", "Library");
console.log("Result (Library == Library):", caseD1);
const caseD2 = simulateNavigate("A-001", "A-001");
console.log("Result (A-001 == A-001):", caseD2);
if (caseD1.success || !caseD1.error.includes("Start and destination cannot be the same location")) {
  throw new Error("Case (d1) failed!");
}
if (caseD2.success || !caseD2.error.includes("Start and destination cannot be the same location")) {
  throw new Error("Case (d2) failed!");
}
console.log("-> PASS: Case (d) correctly rejected identical start and destination.\n");

// Case e: start and destination swapped
console.log("TEST CASE (e): start and destination swapped");
const forward = simulateNavigate("A-008", "A-001");
const swapped = simulateNavigate("A-001", "A-008");
console.log("Forward route (A-001 -> A-008):", forward.route?.map(n => n.label).join(" -> "));
console.log("Swapped route (A-008 -> A-001):", swapped.route?.map(n => n.label).join(" -> "));
if (!swapped.success || swapped.route[0].label !== "A-008" || swapped.route[swapped.route.length - 1].label !== "A-001") {
  throw new Error("Case (e) failed!");
}
console.log("-> PASS: Case (e) swapped route works perfectly in reverse.\n");

console.log("=== ALL TEST CASES PASSED SUCCESSFULLY ===");
