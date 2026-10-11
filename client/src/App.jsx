import { useState, useCallback, useEffect, useRef } from "react";
import CampusMap from "./components/CampusMap";
import VoiceAssistant from "./components/VoiceAssistant";
import ARNavigation from "./components/ARNavigation";
import { getRoute, getNearest, getAlternatives, searchLocations } from "./services/navigationApi";
import { searchLocalLocations } from "./services/locationSearch";
import { resolveClientNode } from "./services/clientNavigationEngine";
import { API_BASE } from "./config";

const DEFAULT_NODE_ID = "node_1005"; // A-Block Entrance

const POI_ICONS = {
  library: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
    </svg>
  ),
  classroom: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
      <path d="M6 12v5c3 3 9 3 12 0v-5"/>
    </svg>
  ),
  lab: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/>
      <path d="M8.5 2h7"/>
      <path d="M7 16h10"/>
    </svg>
  ),
  faculty: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  cafeteria: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8h1a4 4 0 0 1 0 8h-1"/>
      <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/>
      <line x1="6" y1="1" x2="6" y2="4"/>
      <line x1="10" y1="1" x2="10" y2="4"/>
      <line x1="14" y1="1" x2="14" y2="4"/>
    </svg>
  ),
  lift: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2"/>
      <path d="m15 10-3-3-3 3"/>
      <path d="m9 14 3 3 3-3"/>
    </svg>
  ),
  stairs: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19h4v-4h4v-4h4V7h4"/>
    </svg>
  ),
  washroom: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 21a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2z"/>
      <circle cx="8.5" cy="5" r="2"/>
      <path d="M17 21a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2z"/>
      <circle cx="15.5" cy="5" r="2"/>
    </svg>
  )
};

const QUICK_OPTIONS = [
  { label: "Library",        icon: POI_ICONS.library,   query: "LIBRARY"          },
  { label: "Classrooms",     icon: POI_ICONS.classroom, query: "classroom"        },
  { label: "Laboratories",   icon: POI_ICONS.lab,       query: "lab"              },
  { label: "Faculty Lounge", icon: POI_ICONS.faculty,   query: "FACULTY LOUNGE"   },
  { label: "Cafeteria",      icon: POI_ICONS.cafeteria, query: "KIIT CAFE"        },
  { label: "Nearest Lift",   icon: POI_ICONS.lift,      query: "nearest lift"     },
  { label: "Stairs",         icon: POI_ICONS.stairs,    query: "nearest stairs"   },
  { label: "Washrooms",      icon: POI_ICONS.washroom,  query: "nearest washroom" },
];

function getSuggestionIcon(type) {
  if (type === "classroom") return POI_ICONS.classroom;
  if (type === "lab") return POI_ICONS.lab;
  if (type === "lift") return POI_ICONS.lift;
  if (type === "stairs") return POI_ICONS.stairs;
  if (type === "washroom_gents" || type === "washroom_ladies") return POI_ICONS.washroom;
  if (type === "cafeteria") return POI_ICONS.cafeteria;
  if (type === "seating") return POI_ICONS.library;
  if (type === "office") return POI_ICONS.faculty;
  return POI_ICONS.classroom;
}

function getSuggestionTypeLabel(type) {
  if (type === "washroom_gents") return "Gents Washroom";
  if (type === "washroom_ladies") return "Ladies Washroom";
  if (type === "seating") return "Library / Seating";
  return type ? type.replace(/_/g, " ") : "Location";
}

function LocationSearchInput({
  id,
  value,
  onChange,
  onSelect,
  onSubmit,
  placeholder,
  disabled,
  leadingDotClass,
  leadingDotTitle,
  trailingActions,
  inputRef,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const internalInputRef = useRef(null);
  const activeInputRef = inputRef || internalInputRef;
  const dropdownRef = useRef(null);

  // Close suggestions dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (
        activeInputRef.current &&
        !activeInputRef.current.contains(e.target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target)
      ) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [activeInputRef]);

  const handleInputChange = (e) => {
    const val = e.target.value;
    onChange(val);
    setSelectedIndex(-1);
    if (!val.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Instant local search
    const local = searchLocalLocations(val);
    setSuggestions(local);
    setShowSuggestions(local.length > 0);

    // Also fetch from API in background to ensure sync
    searchLocations(val).then((data) => {
      if (data?.success && Array.isArray(data.results) && data.results.length > 0) {
        setSuggestions(data.results);
        setShowSuggestions(true);
      }
    }).catch(() => {});
  };

  const handleSelectSuggestion = (item) => {
    setShowSuggestions(false);
    setSelectedIndex(-1);
    onSelect(item);
  };

  const handleKeyDown = (e) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSuggestions(false);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
          handleSelectSuggestion(suggestions[selectedIndex]);
          return;
        }
        setShowSuggestions(false);
        if (onSubmit) onSubmit();
        return;
      }
    }

    if (e.key === "Enter") {
      setShowSuggestions(false);
      if (onSubmit) onSubmit();
    }
  };

  return (
    <div className="search-bar-wrapper">
      <div className="search-container">
        {leadingDotClass && (
          <span
            className={`location-indicator-dot ${leadingDotClass}`}
            title={leadingDotTitle || ""}
          />
        )}
        <input
          id={id}
          ref={activeInputRef}
          type="text"
          className="search-input"
          value={value}
          onChange={handleInputChange}
          onFocus={() => {
            if (value.trim().length > 0 && suggestions.length > 0) {
              setShowSuggestions(true);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          spellCheck="false"
        />

        {value && (
          <button
            type="button"
            className="search-clear-btn"
            onClick={() => {
              onChange("");
              setSuggestions([]);
              setShowSuggestions(false);
              activeInputRef.current?.focus();
            }}
            title="Clear search"
            aria-label="Clear search input"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        )}

        {trailingActions}
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div ref={dropdownRef} className="suggestions-dropdown" role="listbox">
          {suggestions.map((item, idx) => (
            <div
              key={`${item.nodeId}-${item.label}-${item.floor ?? 0}`}
              className={`suggestion-item ${idx === selectedIndex ? 'selected' : ''}`}
              onClick={() => handleSelectSuggestion(item)}
              onMouseEnter={() => setSelectedIndex(idx)}
              role="option"
              aria-selected={idx === selectedIndex}
            >
              <div className="suggestion-icon">
                {getSuggestionIcon(item.type)}
              </div>
              <div className="suggestion-content">
                <div className="suggestion-title-row">
                  <span className="suggestion-label">{item.label}</span>
                  {item.floor !== undefined && item.floor > 0 && (
                    <span className="suggestion-floor-badge">{item.floor}F</span>
                  )}
                  {item.floor === 0 && item.label.startsWith("A-") && (
                    <span className="suggestion-floor-badge" style={{ background: "rgba(56,189,248,0.15)", color: "#38bdf8", borderColor: "rgba(56,189,248,0.3)" }}>GF</span>
                  )}
                </div>
                <span className="suggestion-type">{getSuggestionTypeLabel(item.type)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

async function aiChat(message, currentNodeId) {
  let res;
  try {
    res = await fetch(`${API_BASE}/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, currentNodeId }),
    });
  } catch {
    throw new Error("Cannot connect to server. Ensure Express backend is running.");
  }

  const text = await res.text();
  if (!text.trim()) throw new Error("Server returned an empty response.");

  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error("Invalid response format from server."); }

  if (!res.ok) throw new Error(data?.error || `AI error (HTTP ${res.status})`);
  return data;
}

function formatTimeAndSteps(steps, timeSeconds) {
  const safeSteps = Math.round(steps ?? 0);
  const totalSec = Math.max(0, Math.round(timeSeconds ?? 0));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;

  let timeStr = "";
  if (mins > 0 && secs > 0) {
    timeStr = `${mins} min ${secs} s`;
  } else if (mins > 0) {
    timeStr = `${mins} min`;
  } else {
    timeStr = `${secs} s`;
  }
  return `≈ ${safeSteps} steps · ${timeStr}`;
}

function App() {
  const [currentNodeId, setCurrentNodeId] = useState(DEFAULT_NODE_ID);
  const [startPoint, setStartPoint] = useState("");
  const [question, setQuestion] = useState("");
  const [routeResult, setRouteResult] = useState(null);
  const [alternativePaths, setAlternativePaths] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentFloor, setCurrentFloor] = useState(0);

  const [response, setResponse] = useState("");
  const [showVoice, setShowVoice] = useState(false);
  const [showPoisModal, setShowPoisModal] = useState(false);
  const [showArModal, setShowArModal] = useState(false);
  const [viewMode, setViewMode] = useState("2d"); // "2d" | "ar"

  // Theme state: "dark" | "light" | "system"
  const [themeMode, setThemeMode] = useState(() => {
    return localStorage.getItem("campus_guide_theme") || "system";
  });

  useEffect(() => {
    localStorage.setItem("campus_guide_theme", themeMode);
    
    function applyTheme() {
      if (themeMode === "system") {
        const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        document.documentElement.setAttribute("data-theme", systemDark ? "dark" : "light");
      } else {
        document.documentElement.setAttribute("data-theme", themeMode);
      }
    }

    applyTheme();

    if (themeMode === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e) => document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }
  }, [themeMode]);

  const handleSelectAlternative = useCallback((path) => {
    if (!path) return;
    setRouteResult(path);
    const destLabel = path.destination?.label || path.destination?.type || "Destination";
    const timingInfo = formatTimeAndSteps(path.steps, path.timeSeconds);
    setResponse(
      `Selected Route #${path.rank || 1}: **${destLabel}** (${timingInfo}, ${path.distance} units).` +
      (path.landmarks?.length ? ` Landmarks on path: ${path.landmarks.join(", ")}.` : "")
    );
    if (destLabel) {
      const match = destLabel.match(/^[A-Z]-(\d)\d{2}$/);
      if (match) {
        setCurrentFloor(parseInt(match[1], 10));
      }
    }
  }, []);

  const fetchAndSetAlternatives = useCallback(async (startId, destQuery, destLabel, initialRoute) => {
    if (!startId || !destQuery) return;
    try {
      const data = await getAlternatives(startId, destQuery, destLabel);
      if (data?.success && Array.isArray(data.paths) && data.paths.length > 0) {
        setAlternativePaths(data.paths);
        setRouteResult((prev) => {
          if (!prev) return data.paths[0];
          const matched = data.paths.find((p) => p.rank === prev.rank);
          return matched || data.paths[0];
        });
      } else if (initialRoute) {
        setAlternativePaths([initialRoute]);
      }
    } catch (err) {
      console.warn("Could not fetch alternatives:", err);
      if (initialRoute) {
        setAlternativePaths([initialRoute]);
      }
    }
  }, []);

  // Resolve current active start node and label
  const resolvedStartInfo = (() => {
    if (startPoint.trim()) {
      const resolved = resolveClientNode(startPoint.trim());
      if (resolved && resolved.node) {
        return {
          nodeId: resolved.nodeId,
          label: resolved.node.label || startPoint.trim(),
          node: resolved.node,
        };
      }
      return {
        nodeId: null,
        label: startPoint.trim(),
        node: null,
      };
    }
    return {
      nodeId: DEFAULT_NODE_ID,
      label: "A-Block Entrance",
      node: { x: 841, y: 1169, label: "A-Block Entrance", type: "entrance" },
    };
  })();

  const activeStartLabel = resolvedStartInfo.label;
  const activeStartNodeObj = resolvedStartInfo.node
    ? {
        nodeId: resolvedStartInfo.nodeId || DEFAULT_NODE_ID,
        label: resolvedStartInfo.label,
        x: resolvedStartInfo.node.x ?? 841,
        y: resolvedStartInfo.node.y ?? 1169,
        type: resolvedStartInfo.node.type ?? "entrance",
      }
    : {
        nodeId: DEFAULT_NODE_ID,
        label: "A-Block Entrance",
        x: 841,
        y: 1169,
        type: "entrance",
      };

  const navigate = useCallback(async (destinationQuery, customStartQuery) => {
    const destQ = (destinationQuery !== undefined ? destinationQuery : question).trim();
    const startQ = (customStartQuery !== undefined ? customStartQuery : startPoint).trim();

    if (!destQ) {
      const emptyDestMsg = "Please enter a destination.";
      setError(emptyDestMsg);
      setResponse("Please enter a destination to navigate to.");
      setRouteResult(null);
      setAlternativePaths([]);
      return;
    }

    // 1. Resolve start node (fallback to default if empty)
    let activeStartId = DEFAULT_NODE_ID;
    let activeStartLabelStr = "A-Block Entrance";

    if (startQ) {
      const resolvedStart = resolveClientNode(startQ);
      if (!resolvedStart) {
        const errorMsg = `Start location not found: "${startQ}". Check the room label or try a category like "library", "lift", "washroom".`;
        setError(errorMsg);
        setResponse(errorMsg);
        setRouteResult(null);
        setAlternativePaths([]);
        return;
      }
      activeStartId = resolvedStart.nodeId;
      activeStartLabelStr = resolvedStart.node?.label || startQ;
    }

    // 2. Pre-validate start != destination
    const nearestMatch = destQ.match(/^nearest\s+(.+)$/i);
    if (!nearestMatch) {
      const resolvedDest = resolveClientNode(destQ);
      if (resolvedDest && resolvedDest.nodeId === activeStartId) {
        const sameLocMsg = `Start and destination cannot be the same location (${resolvedDest.node?.label || activeStartLabelStr}).`;
        setError(sameLocMsg);
        setResponse(sameLocMsg);
        setRouteResult(null);
        setAlternativePaths([]);
        return;
      }
    }

    setIsLoading(true);
    setError(null);
    setResponse("");
    setAlternativePaths([]);
    setCurrentNodeId(activeStartId);

    try {
      let result;
      if (nearestMatch) {
        result = await getNearest(nearestMatch[1].trim(), activeStartId);
      } else {
        result = await getRoute(activeStartId, destQ);
      }

      // Check if nearest resolved to the start location
      if (result.destination?.nodeId === activeStartId) {
        const sameLocMsg = `Start and destination cannot be the same location (${activeStartLabelStr}).`;
        setError(sameLocMsg);
        setResponse(sameLocMsg);
        setRouteResult(null);
        setAlternativePaths([]);
        return;
      }

      setRouteResult(result);

      const destLabel = result.destination?.label || result.destination?.type || destQ;
      const timingInfo = formatTimeAndSteps(result.steps, result.timeSeconds);
      setResponse(
        `Route calculated from **${activeStartLabelStr}** to **${destLabel}** (${timingInfo}, ${result.distance} units).` +
        (result.landmarks?.length ? ` Landmarks on path: ${result.landmarks.join(", ")}.` : "")
      );

      const startNodeId = result.route?.[0]?.nodeId || activeStartId;
      const targetQuery = result.destination?.label || destQ;
      await fetchAndSetAlternatives(startNodeId, targetQuery, result.destination?.label, result);
    } catch (err) {
      const msg = err.message || "Navigation failed.";
      setError(msg);
      setResponse(msg);
      setRouteResult(null);
      setAlternativePaths([]);
    } finally {
      setIsLoading(false);
    }
  }, [question, startPoint, fetchAndSetAlternatives]);

  const handleSwap = useCallback(() => {
    const currentStart = startPoint.trim();
    const currentDest = question.trim();

    // The new start is the previous destination
    const newStart = currentDest;
    // The new destination is previous start (or default if it was empty)
    const newDest = currentStart || "A-Block Entrance";

    setStartPoint(newStart);
    setQuestion(newDest);

    if (newDest.trim()) {
      navigate(newDest, newStart);
    }
  }, [startPoint, question, navigate]);

  const handleSelectDestinationSuggestion = useCallback((suggestion) => {
    setQuestion(suggestion.label);
    if (suggestion.floor !== undefined) {
      setCurrentFloor(suggestion.floor);
    }
    navigate(suggestion.label, startPoint);
  }, [navigate, startPoint]);

  const handleSelectStartSuggestion = useCallback((suggestion) => {
    setStartPoint(suggestion.label);
    setCurrentNodeId(suggestion.nodeId);
    if (suggestion.floor !== undefined) {
      setCurrentFloor(suggestion.floor);
    }
    if (question.trim()) {
      navigate(question, suggestion.label);
    }
  }, [navigate, question]);

  const handleSend = () => {
    if (!isLoading) {
      navigate(question, startPoint);
    }
  };

  const askAI = useCallback(async (message) => {
    if (!message.trim()) return;
    setIsLoading(true);
    setError(null);
    setResponse("");
    setAlternativePaths([]);

    try {
      const data = await aiChat(message, currentNodeId);
      if (data.routeResult) {
        setRouteResult(data.routeResult);
        if (data.routeResult.route?.[0]?.nodeId) {
          const destQuery = data.routeResult.destination?.label || data.routeResult.destination?.nodeId || message;
          await fetchAndSetAlternatives(
            data.routeResult.route[0].nodeId,
            destQuery,
            data.routeResult.destination?.label,
            data.routeResult
          );
        }
      }
      setResponse(data.reply || "Route calculated successfully.");
    } catch (err) {
      // If AI is unavailable (e.g. Gemini key not configured), fall back to direct navigation
      try {
        await navigate(message, startPoint);
      } catch {
        const msg = err.message || "AI request failed.";
        setError(msg);
        setResponse(msg);
        setAlternativePaths([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentNodeId, fetchAndSetAlternatives, navigate, startPoint]);

  const renderResponse = (text) => {
    const parts = text.split(/\*\*(.+?)\*\*/g);
    return parts.map((p, i) => i % 2 === 1 ? <strong key={i}>{p}</strong> : p);
  };

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="app-container">
      {/* Ambient Blobs */}
      <div className="liquid-bg-blob-1"></div>
      <div className="liquid-bg-blob-2"></div>

      {/* Sleek Glassmorphic Navbar */}
      <header className="navbar">
        <div className="navbar-inner">
          <a href="#" className="brand-container">
            <div className="brand-logo">
              <img src="/logo.png" alt="CampusGuide AI Logo" />
            </div>
            <div>
              <div className="brand-title">CampusGuide AI</div>
              <div className="brand-subtitle">Campus 25 Indoor Navigation</div>
            </div>
          </a>

          <div className="nav-links">
            <a href="#map-section" className="nav-link">Interactive Map</a>
            <button className="nav-link" onClick={() => setShowPoisModal(true)}>Quick POIs</button>
            
            {/* Theme Toggle Pill Button */}
            <div className="theme-toggle-pill" title="Toggle Theme (Dark / Light / System)">
              <button
                className={`theme-toggle-btn ${themeMode === "dark" ? "active" : ""}`}
                onClick={() => setThemeMode("dark")}
                title="Dark Mode"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              </button>
              <button
                className={`theme-toggle-btn ${themeMode === "light" ? "active" : ""}`}
                onClick={() => setThemeMode("light")}
                title="Light Mode"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5"/>
                  <line x1="12" y1="1" x2="12" y2="3"/>
                  <line x1="12" y1="21" x2="12" y2="23"/>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                  <line x1="1" y1="12" x2="3" y2="12"/>
                  <line x1="21" y1="12" x2="23" y2="12"/>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
              </button>
              <button
                className={`theme-toggle-btn ${themeMode === "system" ? "active" : ""}`}
                onClick={() => setThemeMode("system")}
                title="System Auto"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2"/>
                  <line x1="8" y1="21" x2="16" y2="21"/>
                  <line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
              </button>
            </div>

            <span className="nav-badge">
              <span className="pulse-dot" />
              Live Engine
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {/* Clean Integrated Unboxed Header */}
        <header className="page-header">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            <div className="header-badge">
              <span className="pulse-dot" />
              Campus 25 Navigation
            </div>

            {/* Mobile Theme Toggle Pill */}
            <div className="theme-toggle-pill" style={{ display: "inline-flex" }}>
              <button
                className={`theme-toggle-btn ${themeMode === "dark" ? "active" : ""}`}
                onClick={() => setThemeMode("dark")}
                title="Dark Mode"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              </button>
              <button
                className={`theme-toggle-btn ${themeMode === "light" ? "active" : ""}`}
                onClick={() => setThemeMode("light")}
                title="Light Mode"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5"/>
                  <line x1="12" y1="1" x2="12" y2="3"/>
                  <line x1="12" y1="21" x2="12" y2="23"/>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                  <line x1="1" y1="12" x2="3" y2="12"/>
                  <line x1="21" y1="12" x2="23" y2="12"/>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
              </button>
              <button
                className={`theme-toggle-btn ${themeMode === "system" ? "active" : ""}`}
                onClick={() => setThemeMode("system")}
                title="System Auto"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2"/>
                  <line x1="8" y1="21" x2="16" y2="21"/>
                  <line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
              </button>
            </div>
          </div>

          <h1 className="page-header-title">Where would you like to go?</h1>
          <p className="page-header-subtitle">
            Search rooms, locate nearest facilities, or use voice commands.
          </p>
          <div className="header-meta-pills">
            <span className="meta-pill">190 Nodes</span>
            <span className="meta-pill">165 Corridors</span>
            <span className="meta-pill">Start: {activeStartLabel}</span>
          </div>
        </header>

        {/* Dual Location Inputs (Start & Destination) with Autocomplete & Swap */}
        <div className="search-bar-wrapper">
          <section id="search-section" className="nav-inputs-wrapper">
            <LocationSearchInput
              id="start-location-input"
              placeholder="Choose start point (default: A-Block Entrance)..."
              value={startPoint}
              onChange={setStartPoint}
              onSelect={handleSelectStartSuggestion}
              onSubmit={handleSend}
              disabled={isLoading}
              leadingDotClass="start-dot"
              leadingDotTitle="Start Point"
            />

            <div className="nav-swap-divider">
              <div className="nav-swap-line" />
              <button
                type="button"
                className="nav-swap-btn"
                onClick={handleSwap}
                title="Swap start and destination"
                aria-label="Swap start and destination"
                disabled={isLoading}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 16V4M7 4L3 8M7 4L11 8M17 8v12M17 20l4-4M17 20l-4-4" />
                </svg>
                <span>Swap</span>
              </button>
            </div>

            <LocationSearchInput
              id="destination-location-input"
              placeholder="Search destination (e.g. 102, B 103, Library)..."
              value={question}
              onChange={setQuestion}
              onSelect={handleSelectDestinationSuggestion}
              onSubmit={handleSend}
              disabled={isLoading}
              leadingDotClass="dest-dot"
              leadingDotTitle="Destination"
              trailingActions={
                <>
                  <button
                    className={`action-btn action-btn-voice ${showVoice ? 'active' : ''}`}
                    title="Voice Assistant"
                    onClick={() => setShowVoice((prev) => !prev)}
                    type="button"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                      <line x1="12" x2="12" y1="19" y2="22"/>
                    </svg>
                  </button>

                  <button
                    className="action-btn action-btn-primary"
                    onClick={handleSend}
                    disabled={isLoading}
                    type="button"
                  >
                    {isLoading ? (
                      "..."
                    ) : (
                      <>
                        <span className="nav-btn-text">Navigate</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M5 12h14M12 5l7 7-7 7"/>
                        </svg>
                      </>
                    )}
                  </button>
                </>
              }
            />
          </section>
        </div>

        {/* Response Box */}
        {response && (
          <div className={`response-box ${error ? 'error' : ''}`}>
            <div className="response-icon">
              {error ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" x2="12" y1="8" y2="12"/>
                  <line x1="12" x2="12.01" y1="16" y2="16"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              )}
            </div>
            <div className="response-content" style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                <h4>{error ? "Navigation Alert" : "Assistant Guidance"}</h4>
                {routeResult && (
                  <button
                    className="ar-launch-pill-btn"
                    onClick={() => setShowArModal(true)}
                  >
                    ✨ Launch 3D AR Navigation
                  </button>
                )}
              </div>
              <p>{renderResponse(response)}</p>
            </div>
          </div>
        )}

        {/* Route Alternative Cards */}
        {alternativePaths.length > 0 && (
          <div className="route-alternatives-container">
            <div className="route-alternatives-header">
              <span className="route-alternatives-title">Route Alternatives ({alternativePaths.length})</span>
              <span className="route-alternatives-hint">Click a card to switch path</span>
            </div>
            <div className="route-alternatives-grid">
              {alternativePaths.map((path, idx) => {
                const isSelected =
                  routeResult &&
                  (path === routeResult ||
                    path.rank === routeResult.rank ||
                    (path.route &&
                      routeResult.route &&
                      path.route.map((n) => n.nodeId).join("->") ===
                        routeResult.route.map((n) => n.nodeId).join("->")));
                const isShortest = path.rank === 1 || idx === 0;

                return (
                  <button
                    key={path.rank || idx}
                    type="button"
                    className={`route-alt-card ${isSelected ? "selected" : ""} ${
                      isShortest ? "shortest" : ""
                    }`}
                    onClick={() => handleSelectAlternative(path)}
                  >
                    <div className="route-alt-card-top">
                      <div className="route-alt-rank-group">
                        <span className="route-alt-rank">Route #{path.rank || idx + 1}</span>
                        {isShortest && (
                          <span className="route-alt-badge-shortest">Shortest</span>
                        )}
                        {isSelected && !isShortest && (
                          <span className="route-alt-badge-active">Selected</span>
                        )}
                      </div>
                      <span className="route-alt-distance">{path.distance} units</span>
                    </div>
                    <div className="route-alt-meta">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                      </svg>
                      <span>{formatTimeAndSteps(path.steps, path.timeSeconds)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Interactive Map & AR View Switcher */}
        <section id="map-section">
          <div className="view-mode-tabs">
            <button
              className={`view-mode-tab ${viewMode === "2d" ? "active" : ""}`}
              onClick={() => setViewMode("2d")}
            >
              🗺️ 2D Topology Map
            </button>
            <button
              className={`view-mode-tab ${viewMode === "ar" ? "active" : ""}`}
              onClick={() => setViewMode("ar")}
            >
              ✨ 3D WebAR (ARCore)
            </button>
          </div>

          {viewMode === "2d" && (
            <CampusMap
              routeResult={routeResult}
              startNode={activeStartNodeObj}
              alternativePaths={alternativePaths}
              currentFloor={currentFloor}
              onFloorChange={setCurrentFloor}
              onSelectPath={handleSelectAlternative}
            />
          )}

          {viewMode === "ar" && (
            <div style={{ height: "650px", position: "relative", borderRadius: "16px", overflow: "hidden" }}>
              <ARNavigation
                routeResult={routeResult}
                startNode={currentNodeId}
                onClose={() => setViewMode("2d")}
                onNodeSelect={(nodeId) => setCurrentNodeId(nodeId)}
              />
            </div>
          )}
        </section>
      </main>

      {/* Slide-Up Quick POIs Drawer Modal */}
      {showPoisModal && (
        <div className="voice-drawer-backdrop" onClick={() => setShowPoisModal(false)}>
          <div className="voice-drawer-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-handle-bar"></div>
            <div className="drawer-header">
              <div className="drawer-title-group">
                <div className="brand-logo" style={{ width: 30, height: 30 }}>
                  <img src="/logo.png" alt="CampusGuide AI Logo" />
                </div>
                <div>
                  <div className="drawer-title">Quick Destinations</div>
                  <div className="drawer-subtitle">Tap any location to calculate route</div>
                </div>
              </div>
              <button className="drawer-close-btn" onClick={() => setShowPoisModal(false)} title="Close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <div className="poi-grid" style={{ marginTop: "0.5rem" }}>
              {QUICK_OPTIONS.map(({ label, icon, query }) => (
                <button
                  key={label}
                  className="poi-card"
                  onClick={() => {
                    setQuestion(query);
                    navigate(query, startPoint);
                    setShowPoisModal(false);
                    scrollToSection("map-section");
                  }}
                  disabled={isLoading}
                >
                  <div className="poi-icon-box">{icon}</div>
                  <span className="poi-label">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Full-Screen WebAR Navigation Overlay Modal */}
      {showArModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, backgroundColor: "#000" }}>
          <ARNavigation
            routeResult={routeResult}
            startNode={currentNodeId}
            onClose={() => setShowArModal(false)}
            onNodeSelect={(nodeId) => setCurrentNodeId(nodeId)}
          />
        </div>
      )}

      {/* Slide-Up Voice Assistant Drawer */}
      {showVoice && (
        <VoiceAssistant
          currentNodeId={currentNodeId}
          onRouteResult={(rr) => {
            setRouteResult(rr);
            if (rr?.route?.[0]?.nodeId && rr?.destination?.nodeId) {
              fetchAndSetAlternatives(rr.route[0].nodeId, rr.destination.nodeId, rr);
            }
          }}
          onNavigate={(query) => {
            setQuestion(query);
            navigate(query, startPoint);
          }}
          onClose={() => setShowVoice(false)}
        />
      )}

      {/* Mobile Fixed Bottom Navigation Bar */}
      <nav className="mobile-bottom-nav">
        <button className="bottom-nav-item" onClick={() => scrollToSection("map-section")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
            <line x1="8" y1="2" x2="8" y2="18"/>
            <line x1="16" y1="6" x2="16" y2="22"/>
          </svg>
          <span>Map</span>
        </button>

        <button className="bottom-nav-item" onClick={() => setShowArModal(true)}>
          <span style={{ fontSize: "1.2rem" }}>✨</span>
          <span>3D AR</span>
        </button>

        <button className="bottom-nav-item" onClick={() => setShowPoisModal(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect width="7" height="7" x="3" y="3" rx="1"/>
            <rect width="7" height="7" x="14" y="3" rx="1"/>
            <rect width="7" height="7" x="14" y="14" rx="1"/>
            <rect width="7" height="7" x="3" y="14" rx="1"/>
          </svg>
          <span>POIs</span>
        </button>

        <button className="bottom-nav-item" onClick={() => scrollToSection("search-section")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.3-4.3"/>
          </svg>
          <span>Search</span>
        </button>

        <button
          className={`bottom-nav-item bottom-nav-voice ${showVoice ? 'active' : ''}`}
          onClick={() => setShowVoice((prev) => !prev)}
        >
          <div className="bottom-voice-icon-box">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" x2="12" y1="19" y2="22"/>
            </svg>
          </div>
          <span>Voice AI</span>
        </button>
      </nav>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-top">
            <div className="footer-brand">
              <div className="brand-logo" style={{ width: 32, height: 32 }}>
                <img src="/logo.png" alt="CampusGuide AI Logo" />
              </div>
              <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>CampusGuide AI</span>
            </div>
            <div className="footer-links">
              <a href="#map-section" className="footer-link">Map View</a>
              <button className="footer-link" onClick={() => setShowPoisModal(true)}>Destinations</button>
              <a href="/health" target="_blank" className="footer-link">System Health</a>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© 2026 CampusGuide AI · Intelligent Indoor Pathfinding</span>
            <span>Campus 25 Dijkstra Graph Engine v2.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;