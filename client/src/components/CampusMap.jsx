import { useRef, useState, useEffect } from "react";

// Node type color palette tuned for dark mode
const TYPE_COLOR = {
  classroom:       "#3b82f6", // Blue
  lab:             "#8b5cf6", // Purple
  office:          "#f59e0b", // Amber
  lift:            "#06b6d4", // Cyan
  stairs:          "#10b981", // Emerald
  cafeteria:       "#ef4444", // Red
  seating:         "#ec4899", // Pink
  entrance:        "#f97316", // Orange
  washroom_gents:  "#64748b", // Slate
  washroom_ladies: "#a78bfa", // Violet
  corridor:        "#334155", // Dark slate
};

const TYPE_LABEL = {
  classroom: "Classroom", lab: "Lab", office: "Office",
  lift: "Lift", stairs: "Stairs", cafeteria: "Cafeteria",
  seating: "Library/Lounge", entrance: "Entrance",
  washroom_gents: "Gents WC", washroom_ladies: "Ladies WC",
};

const ALWAYS_LABEL_TYPES = new Set(["entrance", "cafeteria", "seating"]);
const WALK_MS = 600;

function CampusMap({ routeResult, startNode }) {
  const [graphData, setGraphData] = useState(null);
  const [gLoading, setGLoading] = useState(true);
  const [gError, setGError] = useState(null);
  const [walkIndex, setWalkIndex] = useState(0);
  const [isWalking, setIsWalking] = useState(false);
  const walkTimer = useRef(null);

  // Zoom & Pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setGLoading(true);
    fetch("/api/navigation/graph")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) { setGraphData(d); setGError(null); }
        else setGError("Graph topology data unavailable.");
      })
      .catch(() => setGError("Unable to connect to navigation graph API."))
      .finally(() => setGLoading(false));
  }, []);

  useEffect(() => {
    stopWalk();
    setWalkIndex(0);
  }, [routeResult]);

  useEffect(() => () => { if (walkTimer.current) clearInterval(walkTimer.current); }, []);

  function startWalk() {
    if (!route.length) return;
    setIsWalking(true);
    walkTimer.current = setInterval(() => {
      setWalkIndex((i) => {
        const next = i + 1;
        if (next >= route.length) { stopWalk(); return route.length - 1; }
        return next;
      });
    }, WALK_MS);
  }

  function stopWalk() {
    setIsWalking(false);
    if (walkTimer.current) { clearInterval(walkTimer.current); walkTimer.current = null; }
  }

  function resetWalk() { stopWalk(); setWalkIndex(0); }

  function handleZoomIn() {
    setZoom((z) => Math.min(z * 1.3, 4));
  }

  function handleZoomOut() {
    setZoom((z) => Math.max(z / 1.3, 0.5));
  }

  function handleResetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function handlePointerDown(e) {
    setIsDragging(true);
    const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    const clientY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
    dragStart.current = { x: clientX - pan.x, y: clientY - pan.y };
  }

  function handlePointerMove(e) {
    if (!isDragging) return;
    const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    const clientY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
    setPan({
      x: clientX - dragStart.current.x,
      y: clientY - dragStart.current.y,
    });
  }

  function handlePointerUp() {
    setIsDragging(false);
  }

  const route = routeResult?.route ?? [];
  const destination = routeResult?.destination ?? null;
  const landmarks = routeResult?.landmarks ?? [];

  const DEFAULT_START = startNode ?? { x: 841, y: 1169, label: "A-Block Entrance", nodeId: "node_1005" };
  const currentPos = route.length > 0 ? route[walkIndex] : DEFAULT_START;

  const routeNodeSet = new Set(route.map((n) => n.nodeId));
  const routeEdgeSet = new Set();
  for (let i = 0; i < route.length - 1; i++) {
    routeEdgeSet.add([route[i].nodeId, route[i + 1].nodeId].sort().join("|"));
  }
  const walkedEdgeSet = new Set();
  for (let i = 0; i < walkIndex; i++) {
    walkedEdgeSet.add([route[i].nodeId, route[i + 1].nodeId].sort().join("|"));
  }

  if (gLoading) {
    return (
      <div className="map-container">
        <div className="map-header">
          <div className="map-header-left"><h3>Campus Topology</h3></div>
        </div>
        <div className="graph-area" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 380 }}>
          <div style={{ color: "var(--text-secondary)", fontSize: 14 }}>Loading graph engine...</div>
        </div>
      </div>
    );
  }

  if (gError || !graphData) {
    return (
      <div className="map-container">
        <div className="map-header">
          <div className="map-header-left">
            <h3>Campus Topology</h3>
            <p style={{ color: "var(--danger-rose)" }}>{gError}</p>
          </div>
        </div>
        <div className="graph-area" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 380 }}>
          <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
            <p>Make sure the backend server is active on port 5000.</p>
          </div>
        </div>
      </div>
    );
  }

  const nodeList = Object.values(graphData.nodes);
  const xs = nodeList.map((n) => n.x);
  const ys = nodeList.map((n) => n.y);
  const PAD = 100;
  const baseMinX = Math.min(...xs) - PAD;
  const baseMinY = Math.min(...ys) - PAD;
  const baseW = Math.max(...xs) - Math.min(...xs) + PAD * 2;
  const baseH = Math.max(...ys) - Math.min(...ys) + PAD * 2;

  const zoomedW = baseW / zoom;
  const zoomedH = baseH / zoom;
  const vMinX = baseMinX + (baseW - zoomedW) / 2 - pan.x * (baseW / 500);
  const vMinY = baseMinY + (baseH - zoomedH) / 2 - pan.y * (baseH / 500);

  function nodeProps(id, node) {
    const isCurrentPos  = id === currentPos?.nodeId || (route.length === 0 && id === DEFAULT_START.nodeId);
    const isDestination = id === destination?.nodeId;
    const onRoute       = routeNodeSet.has(id);
    const isCorridor    = node.type === "corridor";

    if (isCurrentPos) return { r: 24, fill: "#38bdf8", stroke: "#ffffff", sw: 4, opacity: 1, zOrder: 4 };
    if (isDestination) return { r: 22, fill: "#f43f5e", stroke: "#ffffff", sw: 4, opacity: 1, zOrder: 3 };
    if (onRoute)       return { r: 14, fill: TYPE_COLOR[node.type] ?? "#94a3b8", stroke: "#ffffff", sw: 2, opacity: 1, zOrder: 2 };
    if (isCorridor)    return { r: 4,  fill: "#334155", stroke: "none", sw: 0, opacity: 0.6, zOrder: 0 };
    return               { r: 10, fill: TYPE_COLOR[node.type] ?? "#64748b", stroke: "none", sw: 0, opacity: 0.75, zOrder: 1 };
  }

  function showLabel(id, node) {
    if (id === currentPos?.nodeId) return true;
    if (id === destination?.nodeId) return true;
    if (routeNodeSet.has(id) && node.label) return true;
    if (ALWAYS_LABEL_TYPES.has(node.type) && node.label) return true;
    if (node.type === "lift" && node.label) return true;
    return false;
  }

  const hasRoute = route.length > 1;

  const sortedNodes = Object.entries(graphData.nodes)
    .map(([id, node]) => ({ id, node, ...nodeProps(id, node) }))
    .sort((a, b) => a.zOrder - b.zOrder);

  return (
    <div className="map-container">
      {/* Map Header */}
      <div className="map-header">
        <div className="map-header-info">
          <div className="map-title-row">
            <h3>Interactive Campus Graph</h3>
            <span className={`map-badge ${hasRoute ? "map-badge--active" : ""}`}>
              {hasRoute ? "Route Active" : "Graph View"}
            </span>
          </div>

          <div className="map-target-row">
            {destination ? (
              <p className="map-target-text">Target: <strong>{destination.label || destination.type}</strong></p>
            ) : (
              <p className="map-target-text">Select a destination to calculate route</p>
            )}
          </div>
        </div>

        {hasRoute && (
          <div className="map-actions-row">
            {isWalking ? (
              <button className="walk-btn walk-btn--pause" onClick={stopWalk}>⏸ Pause</button>
            ) : (
              <button className="walk-btn" onClick={startWalk} disabled={walkIndex >= route.length - 1}>
                ▶ Walk
              </button>
            )}
            <button className="walk-btn walk-btn--reset" onClick={resetWalk}>↺ Reset</button>
          </div>
        )}
      </div>

      {/* SVG Canvas Area with Zoom Controls */}
      <div
        className="graph-area"
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
      >
        <div className="map-zoom-controls">
          <button className="zoom-btn" onClick={handleZoomIn} title="Zoom In">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <button className="zoom-btn" onClick={handleZoomOut} title="Zoom Out">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <button className="zoom-btn" onClick={handleResetView} title="Reset View">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
              <path d="M3 3v5h5"></path>
            </svg>
          </button>
        </div>

        <svg
          viewBox={`${vMinX} ${vMinY} ${zoomedW} ${zoomedH}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          {/* Base graph edges */}
          {graphData.edges.map(([a, b], i) => {
            const na = graphData.nodes[a];
            const nb = graphData.nodes[b];
            if (!na || !nb) return null;
            const key = [a, b].sort().join("|");
            if (routeEdgeSet.has(key)) return null;
            return (
              <line
                key={`bg-${i}`}
                x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                stroke="#1e293b" strokeWidth="3.5" strokeLinecap="round"
              />
            );
          })}

          {/* Active route edges */}
          {graphData.edges.map(([a, b], i) => {
            const na = graphData.nodes[a];
            const nb = graphData.nodes[b];
            if (!na || !nb) return null;
            const key = [a, b].sort().join("|");
            if (!routeEdgeSet.has(key)) return null;
            const walked = walkedEdgeSet.has(key);
            return walked ? (
              <line
                key={`w-${i}`}
                x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                stroke="#34d399" strokeWidth="10" strokeLinecap="round"
              />
            ) : (
              <g key={`r-${i}`}>
                <line
                  x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                  stroke="rgba(56, 189, 248, 0.25)" strokeWidth="20" strokeLinecap="round"
                />
                <line
                  x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                  stroke="#38bdf8" strokeWidth="9" strokeLinecap="round"
                  strokeDasharray="24 12"
                />
              </g>
            );
          })}

          {/* Nodes */}
          {sortedNodes.map(({ id, node, r, fill, stroke, sw, opacity }) => {
            const isCurrentPos = id === currentPos?.nodeId || (route.length === 0 && id === DEFAULT_START.nodeId);
            const showLbl = showLabel(id, node);

            return (
              <g key={id}>
                {isCurrentPos && (
                  <>
                    <circle cx={node.x} cy={node.y} r={r + 14} fill="#38bdf8" opacity="0.15">
                      <animate attributeName="r" values={`${r+6};${r+22};${r+6}`} dur="2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite" />
                    </circle>
                  </>
                )}

                <circle
                  cx={node.x} cy={node.y} r={r}
                  fill={fill} stroke={stroke} strokeWidth={sw}
                  opacity={opacity}
                />

                {showLbl && node.label && (
                  <text
                    x={node.x} y={node.y + r + 24}
                    textAnchor="middle"
                    fontSize={isCurrentPos || id === destination?.nodeId ? 24 : 18}
                    fontWeight={isCurrentPos || id === destination?.nodeId ? "700" : "500"}
                    fill={isCurrentPos ? "#38bdf8" : id === destination?.nodeId ? "#f43f5e" : "#e2e8f0"}
                    fontFamily="Inter, system-ui, sans-serif"
                    paintOrder="stroke"
                    stroke="#040711" strokeWidth="6"
                  >
                    {node.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Modern Compact Map Info Bar */}
      <div className="map-info">
        <div className="map-info-main">
          <div className="map-info-title">
            {destination ? (destination.label || destination.type) : "No active route"}
            {walkIndex > 0 && ` — Step ${walkIndex + 1} of ${route.length}`}
          </div>
          {landmarks.length > 0 && (
            <div className="landmark-trail">Via {landmarks.slice(0, 3).join(" → ")}</div>
          )}
        </div>

        {routeResult && (
          <div className="map-info-chips">
            <span className="map-stat-chip">⏱️ ~{routeResult.estimatedMinutes} min</span>
            <span className="map-stat-chip">📍 {route.length} waypoints</span>
            <span className="map-stat-chip">📏 {routeResult.distance} units</span>
          </div>
        )}
      </div>

      {/* Swipeable Horizontal Legend Ribbon */}
      <div className="map-legend">
        <div className="legend-scroll-container">
          <span className="legend-item highlight">
            <span className="legend-dot" style={{ background: "#38bdf8" }} /> Path Ahead
          </span>
          <span className="legend-item highlight">
            <span className="legend-dot" style={{ background: "#34d399" }} /> Walked
          </span>
          {Object.entries(TYPE_LABEL).map(([type, label]) => (
            <span key={type} className="legend-item">
              <span className="legend-dot" style={{ background: TYPE_COLOR[type] }} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default CampusMap;