import {
  resolveClientNode,
  findClientRoute,
  findClientNearest,
  findClientNearestWashrooms,
  findClientAlternatives,
  isGenericWashroomQuery,
} from './src/services/clientNavigationEngine.js';
import { searchLocalLocations } from './src/services/locationSearch.js';

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

// Case f: Autocomplete search for "toilet", "washroom", "restroom" returns both Gents and Ladies washrooms
console.log("TEST CASE (f): Autocomplete search for washrooms includes both Gents and Ladies");
const searchToilet = searchLocalLocations("toilet");
const searchWashroom = searchLocalLocations("washroom");
const hasGentsToilet = searchToilet.some(r => r.type === 'washroom_gents');
const hasLadiesToilet = searchToilet.some(r => r.type === 'washroom_ladies');
const hasGentsWashroom = searchWashroom.some(r => r.type === 'washroom_gents');
const hasLadiesWashroom = searchWashroom.some(r => r.type === 'washroom_ladies');

console.log("Search 'toilet' results count:", searchToilet.length, { hasGentsToilet, hasLadiesToilet });
console.log("Search 'washroom' results count:", searchWashroom.length, { hasGentsWashroom, hasLadiesWashroom });

if (!hasGentsToilet || !hasLadiesToilet) {
  throw new Error("Case (f) failed: search for 'toilet' must return both Gents and Ladies washrooms!");
}
if (!hasGentsWashroom || !hasLadiesWashroom) {
  throw new Error("Case (f) failed: search for 'washroom' must return both Gents and Ladies washrooms!");
}
console.log("-> PASS: Case (f) autocomplete surfaces both Gents and Ladies washrooms.\n");

// Case g: Generic washroom queries produce routes to BOTH Gents and Ladies washrooms
console.log("TEST CASE (g): Generic washroom query produces routes to BOTH Gents and Ladies");
const nearestWashrooms = findClientNearestWashrooms(DEFAULT_NODE_ID);
console.log("Nearest washrooms from A-Block Entrance:", {
  gents: nearestWashrooms.gents ? { label: nearestWashrooms.gents.destination.label, dist: nearestWashrooms.gents.distance } : null,
  ladies: nearestWashrooms.ladies ? { label: nearestWashrooms.ladies.destination.label, dist: nearestWashrooms.ladies.distance } : null,
});
if (!nearestWashrooms.gents || !nearestWashrooms.ladies) {
  throw new Error("Case (g) failed: both Gents and Ladies washrooms must be resolved!");
}

const altsToilet = findClientAlternatives(DEFAULT_NODE_ID, "toilet");
const altsWashroom = findClientAlternatives(DEFAULT_NODE_ID, "nearest washroom");
console.log("Alternatives for 'toilet':", altsToilet.paths?.map(p => `${p.destination.label} (${p.distance}u, ${p.gender})`));
console.log("Alternatives for 'nearest washroom':", altsWashroom.paths?.map(p => `${p.destination.label} (${p.distance}u, ${p.gender})`));

const hasBothInToiletAlts = altsToilet.paths?.some(p => p.gender === 'gents') && altsToilet.paths?.some(p => p.gender === 'ladies');
const hasBothInWashroomAlts = altsWashroom.paths?.some(p => p.gender === 'gents') && altsWashroom.paths?.some(p => p.gender === 'ladies');

if (!hasBothInToiletAlts || !hasBothInWashroomAlts) {
  throw new Error("Case (g) failed: alternative paths for generic washroom must include both Gents and Ladies!");
}
console.log("-> PASS: Case (g) generic washroom routes compute both Gents and Ladies washroom alternatives.\n");

// Case h: Specific "ladies washroom" navigates directly to washroom_ladies
console.log("TEST CASE (h): Specific 'ladies washroom' navigates directly to Ladies Washroom");
const ladiesRoute = simulateNavigate("ladies washroom", "A-Block Entrance");
console.log("Ladies route destination:", ladiesRoute.destination);
if (!ladiesRoute.success || ladiesRoute.destination.type !== "washroom_ladies") {
  throw new Error("Case (h) failed: 'ladies washroom' did not route to washroom_ladies!");
}
console.log("-> PASS: Case (h) 'ladies washroom' navigates directly to Ladies Washroom.\n");

// Case i: Specific "gents washroom" navigates directly to washroom_gents
console.log("TEST CASE (i): Specific 'gents washroom' navigates directly to Gents Washroom");
const gentsRoute = simulateNavigate("gents washroom", "A-Block Entrance");
console.log("Gents route destination:", gentsRoute.destination);
if (!gentsRoute.success || gentsRoute.destination.type !== "washroom_gents") {
  throw new Error("Case (i) failed: 'gents washroom' did not route to washroom_gents!");
}
console.log("-> PASS: Case (i) 'gents washroom' navigates directly to Gents Washroom.\n");

console.log("=== ALL TEST CASES PASSED SUCCESSFULLY ===");
