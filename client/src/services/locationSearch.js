import { FALLBACK_GRAPH_DATA } from './fallbackGraphData';

/**
 * Get nodes with floor-adjusted labels (e.g. A-002 -> A-102 on 1st floor).
 * Conforms to the Campus 25 floor numbering schema.
 */
export function getNodesByFloor(nodes = FALLBACK_GRAPH_DATA.nodes, floor = 0) {
  const result = {};
  for (const [id, node] of Object.entries(nodes)) {
    const newNode = { ...node, baseLabel: node.label, floor };
    if (newNode.label && newNode.label.match(/^[A-Z]-\d{3}$/)) {
      const match = newNode.label.match(/^([A-Z])-(\d{3})$/);
      if (match) {
        const block = match[1];
        const roomNumber = parseInt(match[2], 10);
        if (floor === 0) {
          newNode.label = `${block}-${roomNumber.toString().padStart(3, '0')}`;
        } else {
          const newRoomNumber = (floor * 100) + roomNumber;
          newNode.label = `${block}-${newRoomNumber.toString().padStart(3, '0')}`;
        }
      }
    }
    result[id] = newNode;
  }
  return result;
}

function normalize(s) {
  return (s || '').toLowerCase().replace(/[\s\-_]+/g, '');
}

/**
 * Search locations across all floors (0 to 3) with intelligent scoring.
 * Matches:
 * - Room numbers: "102", "103", "201"
 * - Block + room: "A102", "A 102", "A-102", "B 103", "C 201"
 * - Labels: "A-001", "LIBRARY", "KIIT CAFE"
 * - Categories: "washroom", "lift", "stairs", "classroom", "lab"
 * - Node IDs: "node_1001"
 */
export function searchLocalLocations(query, nodes = FALLBACK_GRAPH_DATA.nodes) {
  if (!query || !query.trim()) return [];
  const rawQ = query.trim().toLowerCase();
  const normQ = normalize(query);

  const results = [];
  const seen = new Set();

  for (const floor of [0, 1, 2, 3]) {
    const floorNodes = getNodesByFloor(nodes, floor);

    for (const [nodeId, node] of Object.entries(floorNodes)) {
      if (node.type === 'corridor') continue;

      const rawLabel = (node.label || '').toLowerCase();
      const normLabel = normalize(node.label);
      const roomNumMatch = node.label ? node.label.match(/\d{3}/) : null;
      const roomNum = roomNumMatch ? roomNumMatch[0] : '';
      const rawType = (node.type || '').replace(/_/g, ' ').toLowerCase();

      let score = 0;

      if (normLabel === normQ) score = 1000;
      else if (roomNum && roomNum === normQ) score = 950;
      else if (normLabel.startsWith(normQ)) score = 900;
      else if (normLabel.includes(normQ)) score = 800;
      else if (rawLabel.includes(rawQ)) score = 750;
      else if (rawType.includes(rawQ)) score = 600;
      else if (rawQ.startsWith('node') && nodeId.toLowerCase().includes(rawQ)) score = 500;

      if (score > 0) {
        const key = `${nodeId}-${node.label}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            nodeId,
            label: node.label,
            type: node.type,
            floor,
            score,
          });
        }
      }
    }
  }

  results.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return results.slice(0, 12);
}
