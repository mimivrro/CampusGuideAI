import { useState, useRef, useEffect, useCallback } from "react";

const GEMINI_OUT_RATE = 24000;

const STATUS = {
  IDLE:         "idle",
  CONNECTING:   "connecting",
  LISTENING:    "listening",
  SPEAKING:     "speaking",
  COMPLETED:    "completed",
  ERROR:        "error",
};

function VoiceAssistant({ currentNodeId, onRouteResult, onNavigate, onClose }) {
  const [status, setStatus] = useState(STATUS.IDLE);
  const [userTranscript, setUserTranscript] = useState("");
  const [aiTranscript, setAiTranscript] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [lastRoute, setLastRoute] = useState(null);

  const wsRef = useRef(null);
  const captureCtxRef = useRef(null);
  const playCtxRef = useRef(null);
  const micStreamRef = useRef(null);
  const scriptProcRef = useRef(null);
  const speechRecognitionRef = useRef(null);
  const nextPlayRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    // Auto-start recording on drawer open for seamless mobile UX
    startSession();
    return () => {
      mountedRef.current = false;
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function safeSet(setter, value) {
    if (mountedRef.current) setter(value);
  }

  function b64ToBuffer(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function float32ToB64(f32) {
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      i16[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767)));
    }
    const bin = String.fromCharCode(...new Uint8Array(i16.buffer));
    return btoa(bin);
  }

  function playChunk(b64) {
    try {
      if (!playCtxRef.current || playCtxRef.current.state === "closed") {
        playCtxRef.current = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: GEMINI_OUT_RATE,
        });
        nextPlayRef.current = 0;
      }
      const ctx = playCtxRef.current;
      const raw = b64ToBuffer(b64);
      const i16 = new Int16Array(raw);
      const f32 = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;

      const buf = ctx.createBuffer(1, f32.length, GEMINI_OUT_RATE);
      buf.copyToChannel(f32, 0);

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);

      const startAt = Math.max(ctx.currentTime + 0.02, nextPlayRef.current);
      src.start(startAt);
      nextPlayRef.current = startAt + buf.duration;

      safeSet(setStatus, STATUS.SPEAKING);
    } catch (e) {
      console.warn("[Voice] Playback error:", e);
    }
  }

  function startBrowserSpeechToText() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("[Voice] Native SpeechRecognition not supported in this browser.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event) => {
        let interimText = "";
        let finalText = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalText += event.results[i][0].transcript;
          } else {
            interimText += event.results[i][0].transcript;
          }
        }

        const currentText = finalText || interimText;
        if (currentText && mountedRef.current) {
          setUserTranscript(currentText);
        }
      };

      recognition.onerror = (e) => {
        console.warn("[Voice] SpeechRecognition error:", e.error);
      };

      recognition.start();
      speechRecognitionRef.current = recognition;
    } catch (err) {
      console.warn("[Voice] Failed to start native speech recognition:", err);
    }
  }

  function stopBrowserSpeechToText() {
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch {}
      speechRecognitionRef.current = null;
    }
  }

  async function startMic(ws) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      micStreamRef.current = stream;

      const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      captureCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();

      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      scriptProcRef.current = proc;

      proc.onaudioprocess = (e) => {
        if (!mountedRef.current || ws.readyState !== WebSocket.OPEN) return;
        const b64 = float32ToB64(e.inputBuffer.getChannelData(0));
        ws.send(JSON.stringify({ type: "audio", data: b64 }));
      };

      src.connect(proc);
      proc.connect(ctx.destination);
      safeSet(setStatus, STATUS.LISTENING);
    } catch (err) {
      const msg = err.name === "NotAllowedError"
        ? "Microphone access denied by browser."
        : `Mic capture error: ${err.message}`;
      safeSet(setErrorMsg, msg);
      safeSet(setStatus, STATUS.ERROR);
    }
  }

  function stopMic() {
    stopBrowserSpeechToText();
    try { scriptProcRef.current?.disconnect(); } catch {}
    scriptProcRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    try {
      if (captureCtxRef.current?.state !== "closed") captureCtxRef.current?.close();
    } catch {}
    captureCtxRef.current = null;
  }

  function teardown() {
    stopMic();
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
    try {
      if (playCtxRef.current?.state !== "closed") playCtxRef.current?.close();
    } catch {}
    playCtxRef.current = null;
  }

  const startSession = useCallback(() => {
    teardown();
    safeSet(setStatus, STATUS.CONNECTING);
    safeSet(setUserTranscript, "");
    safeSet(setAiTranscript, "");
    safeSet(setErrorMsg, "");
    safeSet(setLastRoute, null);

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws/voice?nodeId=${currentNodeId}`;

    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      safeSet(setErrorMsg, "Unable to establish WebSocket connection.");
      safeSet(setStatus, STATUS.ERROR);
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      startMic(ws);
      startBrowserSpeechToText();
    };

    ws.onmessage = ({ data }) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (!mountedRef.current) return;

      switch (msg.type) {
        case "status":
          if (msg.message === "connected" || msg.message === "ready") {
            safeSet(setStatus, (s) => (s === STATUS.LISTENING ? STATUS.LISTENING : STATUS.PROCESSING));
          }
          break;
        case "audio":
          playChunk(msg.data);
          break;
        case "transcript":
          safeSet(setAiTranscript, (t) => (t ? `${t} ${msg.text}` : msg.text));
          break;
        case "route":
          setLastRoute(msg.routeResult);
          if (onRouteResult) onRouteResult(msg.routeResult);
          break;
        case "error":
          safeSet(setErrorMsg, msg.message || "Voice session error.");
          safeSet(setStatus, STATUS.ERROR);
          break;
        default: break;
      }
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      safeSet(setErrorMsg, "WebSocket error. Ensure backend server is running on port 5000.");
      safeSet(setStatus, STATUS.ERROR);
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      stopMic();
      wsRef.current = null;
    };
  }, [currentNodeId, onRouteResult]);

  const stopSessionAndCalculateRoute = useCallback(() => {
    teardown();
    safeSet(setStatus, STATUS.COMPLETED);

    if (lastRoute && onRouteResult) {
      onRouteResult(lastRoute);
    } else {
      const query = userTranscript.trim();
      if (query && onNavigate) {
        onNavigate(query);
      }
    }

    if (onClose) onClose();
  }, [lastRoute, userTranscript, onRouteResult, onNavigate, onClose]);

  const isRecording = status === STATUS.CONNECTING || status === STATUS.LISTENING || status === STATUS.SPEAKING || status === STATUS.PROCESSING;

  return (
    <div className="voice-drawer-backdrop" onClick={stopSessionAndCalculateRoute}>
      <div className="voice-drawer-sheet" onClick={(e) => e.stopPropagation()}>
        {/* Handle Bar */}
        <div className="drawer-handle-bar"></div>

        {/* Header */}
        <div className="drawer-header">
          <div className="drawer-title-group">
            <div className="voice-live-dot"></div>
            <div>
              <div className="drawer-title">Realtime Voice Navigation</div>
              <div className="drawer-subtitle">Speak your destination (e.g. "Where is A-007?")</div>
            </div>
          </div>

          <button className="drawer-close-btn" onClick={stopSessionAndCalculateRoute} title="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Live Audio Visualizer / Status Badge */}
        <div className="drawer-status-box">
          <div className="voice-status-badge">
            {status === STATUS.IDLE && "Ready · Click Start Recording"}
            {status === STATUS.CONNECTING && "Connecting Audio Engine..."}
            {status === STATUS.LISTENING && "🔴 Listening... Speak Now"}
            {status === STATUS.SPEAKING && "🔊 Assistant Responding..."}
            {status === STATUS.COMPLETED && "Route Processed"}
            {status === STATUS.ERROR && "Session Error"}
          </div>
        </div>

        {/* Live Speech Recognition Transcript Box */}
        <div className="drawer-section">
          <div className="drawer-section-label">
            LIVE SPEECH TRANSCRIPT:
          </div>
          <div className="voice-transcript">
            {userTranscript ? (
              <span className="transcript-user-text">"{userTranscript}"</span>
            ) : (
              <span className="transcript-placeholder">
                {isRecording ? "Listening to your microphone... speak your destination." : "No speech recorded yet."}
              </span>
            )}
          </div>
        </div>

        {/* AI Response Box */}
        {aiTranscript && (
          <div className="drawer-section">
            <div className="drawer-section-label-ai">
              ASSISTANT RESPONSE:
            </div>
            <div className="voice-transcript">
              {aiTranscript}
            </div>
          </div>
        )}

        {/* Error Box */}
        {status === STATUS.ERROR && errorMsg && (
          <div className="drawer-error-box">
            {errorMsg.includes("GEMINI_API_KEY") || errorMsg.includes("not configured")
              ? "Configure GEMINI_API_KEY in server/.env and restart backend server."
              : errorMsg}
          </div>
        )}

        {/* Bottom Actions */}
        <div className="drawer-actions">
          {!isRecording ? (
            <button
              className="action-btn action-btn-primary full-width"
              onClick={startSession}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" x2="12" y1="19" y2="22"/>
              </svg>
              Start Recording
            </button>
          ) : (
            <button
              className="action-btn drawer-stop-btn full-width"
              onClick={stopSessionAndCalculateRoute}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect width="12" height="12" x="6" y="6" rx="2"/>
              </svg>
              Stop & Show Route
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default VoiceAssistant;
