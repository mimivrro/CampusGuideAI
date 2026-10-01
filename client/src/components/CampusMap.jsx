import { useRef, useState, useEffect } from "react";
import { API_BASE } from "../config";
import { FALLBACK_GRAPH_DATA } from "../services/fallbackGraphData";

// Node type color palette tuned for dark & warm paper mode
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

const ALWAYS_LABEL_TYPES = new Set(["entrance", "cafeteria", "seating", "classroom", "lab"]);
const WALK_MS = 600;

function formatTimeShort(timeSeconds, steps) {
  const s = Math.round(timeSeconds ?? (steps || 0));
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m > 0 && remS > 0) return `${m}m ${remS}s`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function CampusMap({
  routeResult,
  startNode,
  alternativePaths = [],
  currentFloor: propFloor,
  onFloorChange,
  onSelectPath,
}) {
  const [graphData, setGraphData] = useState(FALLBACK_GRAPH_DATA);
  const [floor, setFloor] = useState(propFloor ?? 0);
  const [gLoading, setGLoading] = useState(false);
  const [gError, setGError] = useState(null);
  const [walkIndex, setWalkIndex] = useState(0);
  const [isWalking, setIsWalking] = useState(false);
  const [hoveredNode, setHoveredNode] = useState(null);
  const walkTimer = useRef(null);

  useEffect(() => {
    if (propFloor !== undefined) {
      setFloor(propFloor);
    }
  }, [propFloor]);

  useEffect(() => {
    if (routeResult?.destination?.label) {
      const match = routeResult.destination.label.match(/^[A-Z]-(\d)(\d{2})$/);
      if (match) {
        const destFloor = parseInt(match[1], 10);
        setFloor(destFloor);
        if (onFloorChange) onFloorChange(destFloor);
      }
    }
  }, [routeResult, onFloorChange]);

  // Zoom & Pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    fetch(`${API_BASE}/navigation/graph`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) { setGraphData(d); setGError(null); }
      })
      .catch((err) => {
        console.warn("Using offline fallback graph data:", err);
      });
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

  const selectedRouteKey = route.map((n) => n.nodeId).join("->");
  const unselectedAlts = (alternativePaths || []).filter(
    (p) => (p?.route || []).map((n) => n.nodeId).join("->") !== selectedRouteKey
  );

  const altEdgeSet = new Set();
  const altNodeSet = new Set();
  for (const alt of unselectedAlts) {
    const r = alt.route || [];
    for (let i = 0; i < r.length - 1; i++) {
      altEdgeSet.add([r[i].nodeId, r[i + 1].nodeId].sort().join("|"));
      altNodeSet.add(r[i].nodeId);
    }
    if (r.length > 0) {
      altNodeSet.add(r[r.length - 1].nodeId);
    }
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
            <p>Ensure backend API service is running.</p>
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
    if (altNodeSet.has(id)) return { r: 11, fill: TYPE_COLOR[node.type] ?? "#818cf8", stroke: "#818cf8", sw: 2, opacity: 0.9, zOrder: 2 };
    if (isCorridor)    return { r: 4,  fill: "#334155", stroke: "none", sw: 0, opacity: 0.6, zOrder: 0 };
    return               { r: 10, fill: TYPE_COLOR[node.type] ?? "#64748b", stroke: "none", sw: 0, opacity: 0.75, zOrder: 1 };
  }

  function getNodeDisplayLabel(id, node) {
    if (id === destination?.nodeId && destination?.label) {
      return destination.label;
    }
    if (node.label && node.label.match(/^[A-Z]-\d{3}$/)) {
      const match = node.label.match(/^([A-Z])-(\d{3})$/);
      if (match) {
        const block = match[1];
        const num = parseInt(match[2], 10);
        if (floor === 0) return `${block}-${num.toString().padStart(3, '0')}`;
        return `${block}-${(floor * 100 + num).toString().padStart(3, '0')}`;
      }
    }
    return node.label;
  }

  function showLabel(id, node) {
    if (!node.label) return false;
    if (id === currentPos?.nodeId) return true;
    if (id === destination?.nodeId) return true;
    if (routeNodeSet.has(id)) return true;
    if (ALWAYS_LABEL_TYPES.has(node.type)) return true;
    if (node.type === "lift") return true;
    if (hoveredNode === id) return true;
    return zoom >= 1.3;
  }

  const hasRoute = route.length > 1;

  const sortedNodes = Object.entries(graphData.nodes)
    .map(([id, node]) => ({ id, node, ...nodeProps(id, node) }))
    .sort((a, b) => a.zOrder - b.zOrder);

  // Compute collision-free label coordinates
  const labelPositions = {};
  const placedRects = [];

  sortedNodes.forEach(({ id, node, r }) => {
    if (!showLabel(id, node)) return;
    const text = getNodeDisplayLabel(id, node) || "";
    if (!text) return;

    const approxWidth = text.length * 11 + 16;
    const approxHeight = 24;

    const candidates = [
      { yOff: r + 22, xOff: 0, anchor: "middle" },
      { yOff: -(r + 14), xOff: 0, anchor: "middle" },
      { yOff: 4, xOff: r + 14, anchor: "start" },
      { yOff: 4, xOff: -(r + 14), anchor: "end" },
    ];

    let chosen = candidates[0];
    for (const cand of candidates) {
      const cx = node.x + cand.xOff;
      const cy = node.y + cand.yOff;
      const rect = {
        left: cx - (cand.anchor === "middle" ? approxWidth / 2 : cand.anchor === "start" ? 0 : approxWidth),
        right: cx + (cand.anchor === "middle" ? approxWidth / 2 : cand.anchor === "start" ? approxWidth : 0),
        top: cy - approxHeight / 2,
        bottom: cy + approxHeight / 2,
      };

      const hasOverlap = placedRects.some(
        (pr) =>
          !(rect.right < pr.left || rect.left > pr.right || rect.bottom < pr.top || rect.top > pr.bottom)
      );

      if (!hasOverlap) {
        chosen = cand;
        placedRects.push(rect);
        break;
      }
    }

    labelPositions[id] = chosen;
  });

  return (
    <div className="map-container">
      {/* Map Header */}
      <div className="map-header">
        <div className="map-header-info">
          <div className="map-title-row">
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
              <h3>Interactive Campus Graph</h3>
              <span className={`map-badge ${hasRoute ? "map-badge--active" : ""}`}>
                {hasRoute ? "Route Active" : "Graph View"}
              </span>
            </div>

            {/* Alternative Route Quick Select Pills on Map Header */}
            {alternativePaths.length > 1 && (
              <div className="map-route-pills" title="Alternative paths comparison">
                {alternativePaths.map((p, idx) => {
                  const isSelected =
                    routeResult &&
                    (p === routeResult ||
                      p.rank === routeResult.rank ||
                      (p.route &&
                        routeResult.route &&
                        p.route.map((n) => n.nodeId).join("->") ===
                          routeResult.route.map((n) => n.nodeId).join("->")));
                  const isShortest = p.rank === 1 || idx === 0;

                  return (
                    <button
                      key={p.rank || idx}
                      type="button"
                      className={`map-route-pill ${isSelected ? "active" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onSelectPath) onSelectPath(p);
                      }}
                      title={`Route #${p.rank || idx + 1}: ${p.distance} units, ≈ ${p.steps ?? 0} steps (${formatTimeShort(p.timeSeconds, p.steps)})`}
                    >
                      <span className="pill-rank">Route #{p.rank || idx + 1}</span>
                      <span className="pill-time">{formatTimeShort(p.timeSeconds, p.steps)}</span>
                      {isShortest && <span className="pill-tag">Shortest</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="map-target-row">
            {destination ? (
              <p className="map-target-text">
                Target: <strong>{destination.label || destination.type}</strong>
                {routeResult && (
                  <span className="map-target-stats">
                    {" "}· {routeResult.distance} units · ≈ {routeResult.steps ?? Math.round((routeResult.distance * 0.05) / 0.75)} steps ({formatTimeShort(routeResult.timeSeconds, routeResult.steps)})
                  </span>
                )}
              </p>
            ) : (
              <p className="map-target-text">Select a destination or hover nodes to inspect</p>
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
        style={{ cursor: isDragging ? "grabbing" : "grab", minHeight: "520px", height: "520px" }}
      >
        <div className="map-zoom-controls">
          <div className="floor-pill-group" title="Select Campus Floor">
            {[0, 1, 2, 3].map((f) => (
              <button
                key={f}
                className={`floor-pill-btn ${floor === f ? "active" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setFloor(f);
                  if (onFloorChange) onFloorChange(f);
                }}
                title={f === 0 ? "Ground Floor" : `Floor ${f}`}
              >
                {f === 0 ? "GF" : `${f}F`}
              </button>
            ))}
          </div>

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
          style={{ width: "100%", height: "100%", minHeight: "520px", display: "block" }}
        >
          {/* Base graph edges */}
          {graphData.edges.map(([a, b], i) => {
            const na = graphData.nodes[a];
            const nb = graphData.nodes[b];
            if (!na || !nb) return null;
            const key = [a, b].sort().join("|");
            if (routeEdgeSet.has(key) || altEdgeSet.has(key)) return null;
            return (
              <line
                key={`bg-${i}`}
                x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                stroke="var(--graph-edge)" strokeWidth="3.5" strokeLinecap="round"
              />
            );
          })}

          {/* Alternative route edges */}
          {unselectedAlts.map((alt, altIdx) => {
            const r = alt.route || [];
            return (
              <g key={`alt-direct-${alt.rank || altIdx}`}>
                {r.slice(0, -1).map((curr, stepIdx) => {
                  const next = r[stepIdx + 1];
                  const key = [curr.nodeId, next.nodeId].sort().join("|");
                  if (routeEdgeSet.has(key)) return null;
                  return (
                    <line
                      key={`alt-direct-${altIdx}-${stepIdx}`}
                      x1={curr.x} y1={curr.y} x2={next.x} y2={next.y}
                      stroke="#818cf8" strokeWidth="6" strokeLinecap="round"
                      strokeDasharray="8 6" opacity="0.85"
                    />
                  );
                })}
              </g>
            );
          })}

          {/* Active route edges */}
          {route.slice(0, -1).map((curr, stepIdx) => {
            const next = route[stepIdx + 1];
            const key = [curr.nodeId, next.nodeId].sort().join("|");
            const walked = walkedEdgeSet.has(key);
            return walked ? (
              <line
                key={`w-direct-${stepIdx}`}
                x1={curr.x} y1={curr.y} x2={next.x} y2={next.y}
                stroke="#34d399" strokeWidth="10" strokeLinecap="round"
              />
            ) : (
              <g key={`r-direct-${stepIdx}`}>
                <line
                  x1={curr.x} y1={curr.y} x2={next.x} y2={next.y}
                  stroke="rgba(56, 189, 248, 0.25)" strokeWidth="20" strokeLinecap="round"
                />
                <line
                  x1={curr.x} y1={curr.y} x2={next.x} y2={next.y}
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
            const pos = labelPositions[id] || { yOff: r + 22, xOff: 0, anchor: "middle" };

            return (
              <g
                key={id}
                onMouseEnter={() => setHoveredNode(id)}
                onMouseLeave={() => setHoveredNode(null)}
              >
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

                {showLbl && getNodeDisplayLabel(id, node) && (
                  <g transform={`translate(${node.x + pos.xOff}, ${node.y + pos.yOff})`}>
                    <text
                      x={0} y={0}
                      textAnchor={pos.anchor}
                      fontSize={isCurrentPos || id === destination?.nodeId ? 22 : 16}
                      fontWeight={isCurrentPos || id === destination?.nodeId ? "700" : "600"}
                      fill={isCurrentPos ? "#38bdf8" : id === destination?.nodeId ? "#f43f5e" : "var(--text-primary)"}
                      fontFamily="Inter, system-ui, sans-serif"
                      paintOrder="stroke"
                      stroke="var(--graph-text-stroke)" strokeWidth="6"
                    >
                      {getNodeDisplayLabel(id, node)}
                    </text>
                  </g>
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
          {unselectedAlts.length > 0 && (
            <span className="legend-item highlight">
              <span className="legend-dot" style={{ background: "#818cf8" }} /> Alternative
            </span>
          )}
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