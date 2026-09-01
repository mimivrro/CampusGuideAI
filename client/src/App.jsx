import { useState, useCallback, useEffect } from "react";
import CampusMap from "./components/CampusMap";
import VoiceAssistant from "./components/VoiceAssistant";
import { getRoute, getNearest } from "./services/navigationApi";

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

async function aiChat(message, currentNodeId) {
  let res;
  try {
    res = await fetch("/api/ai/chat", {
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

function App() {
  const [currentNodeId] = useState(DEFAULT_NODE_ID);
  const [routeResult, setRouteResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState("");
  const [showVoice, setShowVoice] = useState(false);
  const [showPoisModal, setShowPoisModal] = useState(false);

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

  const navigate = useCallback(async (destinationQuery) => {
    if (!destinationQuery.trim()) return;
    setIsLoading(true);
    setError(null);
    setResponse("");

    try {
      let result;
      const nearestMatch = destinationQuery.match(/^nearest\s+(.+)$/i);
      if (nearestMatch) {
        result = await getNearest(nearestMatch[1].trim(), currentNodeId);
      } else {
        result = await getRoute(currentNodeId, destinationQuery);
      }
      setRouteResult(result);
      setResponse(
        `Destination found: **${result.destination.label || result.destination.type}** (${result.estimatedMinutes} min walk, ${result.distance} units).` +
        (result.landmarks.length ? ` Landmarks on path: ${result.landmarks.join(", ")}.` : "")
      );
    } catch (err) {
      const msg = err.message || "Navigation failed.";
      setError(msg);
      setResponse(msg);
      setRouteResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [currentNodeId]);

  const askAI = useCallback(async (message) => {
    if (!message.trim()) return;
    setIsLoading(true);
    setError(null);
    setResponse("");

    try {
      const data = await aiChat(message, currentNodeId);
      if (data.routeResult) setRouteResult(data.routeResult);
      setResponse(data.reply || "Route calculated successfully.");
    } catch (err) {
      const msg = err.message || "AI request failed.";
      setError(msg);
      setResponse(msg);
    } finally {
      setIsLoading(false);
    }
  }, [currentNodeId]);

  const handleSend = () => {
    const q = question.trim();
    if (q && !isLoading) askAI(q);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSend();
  };

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
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="3 11 22 2 13 21 11 13 3 11"/>
              </svg>
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
            <span className="meta-pill">Start: A-Block Entrance</span>
          </div>
        </header>

        {/* Search Bar */}
        <section id="search-section" className="search-container">
          <input
            type="text"
            className="search-input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search room or location..."
            disabled={isLoading}
          />
          
          <button
            className={`action-btn action-btn-voice ${showVoice ? 'active' : ''}`}
            title="Voice Assistant"
            onClick={() => setShowVoice((prev) => !prev)}
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
        </section>

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
            <div className="response-content">
              <h4>{error ? "Navigation Alert" : "Assistant Guidance"}</h4>
              <p>{renderResponse(response)}</p>
            </div>
          </div>
        )}

        {/* Interactive Map */}
        <section id="map-section">
          <CampusMap routeResult={routeResult} startNode={null} />
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
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect width="7" height="7" x="3" y="3" rx="1"/>
                    <rect width="7" height="7" x="14" y="3" rx="1"/>
                    <rect width="7" height="7" x="14" y="14" rx="1"/>
                    <rect width="7" height="7" x="3" y="14" rx="1"/>
                  </svg>
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
                    navigate(query);
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

      {/* Slide-Up Voice Assistant Drawer */}
      {showVoice && (
        <VoiceAssistant
          currentNodeId={currentNodeId}
          onRouteResult={(rr) => setRouteResult(rr)}
          onNavigate={(query) => navigate(query)}
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
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polygon points="3 11 22 2 13 21 11 13 3 11"/>
                </svg>
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