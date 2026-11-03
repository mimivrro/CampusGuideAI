import { useRef, useState, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import {
  calculateBearing,
  calculateTurnAngle,
  transformRouteToCameraPath,
  createRibbonTexture,
  speakInstruction,
  getActionIconSvg,
  SCALE_METERS
} from '../services/arUtils';
import { getRoute } from '../services/navigationApi';

/**
 * ARNavigation.jsx
 *
 * Immersive WebAR / ARCore 3D Interior Navigation Viewport.
 *
 * 1. STATIC ON-SCREEN FORWARD RIBBON:
 *    Anchored straight in front of the camera view (extending along -Z at screen center).
 *    Never disappears, drifts off-screen, or requires 360° searching.
 *
 * 2. RADAR-PATH SYNCHRONIZATION:
 *    User is centered at (50, 50). The active corridor path points directly UP (12 o'clock).
 *    Upcoming corridor bends (left/right) match the 3D ribbon geometry 1:1.
 *
 * 3. AUTOMATIC RADAR CAPTURE & LOCK:
 *    Automatically locks onto the path corridor without manual sliders or compass calibration.
 *    Smoothly tracks user progression with live distance and turn indicators.
 */
function ARNavigation({ routeResult, startNode, onClose, onNodeSelect }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const videoRef = useRef(null);

  // Active route state (uses prop or locally loaded destination)
  const [activeRouteResult, setActiveRouteResult] = useState(routeResult || null);
  const [routeLoading, setRouteLoading] = useState(false);

  // Synchronize prop updates
  useEffect(() => {
    if (routeResult) {
      setActiveRouteResult(routeResult);
    }
  }, [routeResult]);

  // If no routeResult provided on mount, automatically calculate route to Central Library
  useEffect(() => {
    if (!activeRouteResult) {
      const startId = (typeof startNode === 'string' && startNode) ? startNode : 'node_1005';
      setRouteLoading(true);
      getRoute(startId, 'Central Library')
        .then((res) => {
          setActiveRouteResult(res);
        })
        .catch(() => {
          // Fallback handled gracefully by transformRouteToCameraPath
        })
        .finally(() => {
          setRouteLoading(false);
        });
    }
  }, [startNode, activeRouteResult]);

  // AR & Camera State
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [webXRSupported, setWebXRSupported] = useState(false);
  const [xrSessionActive, setXrSessionActive] = useState(false);
  const [showAnchorModal, setShowAnchorModal] = useState(false);
  const [dismissSimulatedNotice, setDismissSimulatedNotice] = useState(false);

  // Physical Motion / Pedometer Step State (NO PRECODED TIMERS)
  const [walkProgress, setWalkProgress] = useState(0); // Progress index along route (0.0 to route.length - 1)
  const [stepCount, setStepCount] = useState(0);
  const [autoWalkPace, setAutoWalkPace] = useState(false); // Smooth preview walk at 1.2 m/s
  const [motionSensorActive, setMotionSensorActive] = useState(false);
  const [lastStepFeedback, setLastStepFeedback] = useState(false);
  const [isStepsExpanded, setIsStepsExpanded] = useState(false); // Collapsible drawer: false = kept down (see path), true = kept up (see all steps)

  const route = activeRouteResult?.route ?? [];
  const turnInstructions = activeRouteResult?.turnInstructions ?? [];
  const destination = activeRouteResult?.destination ?? null;
  const startLocation = route[0] ?? null;

  // Active turn instruction based on physical walkProgress
  const currentStepIndex = Math.min(
    Math.floor(walkProgress),
    Math.max(0, turnInstructions.length - 1)
  );
  const currentStep = turnInstructions[currentStepIndex] || turnInstructions[0];

  // Camera devices
  const [videoDevices, setVideoDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  // Three.js scene refs
  const sceneRef = useRef(null);
  const cameraThreeRef = useRef(null);
  const rendererRef = useRef(null);
  const arrowMeshRef = useRef(null);
  const redDotRef = useRef(null);
  const blueDotRef = useRef(null);
  const pathLineRef = useRef(null);
  const ribbonTextureRef = useRef(null);
  const animFrameId = useRef(null);
  const stepSurgeRef = useRef(0);
  const isWalkingRef = useRef(false);

  // Check WebXR AR support
  useEffect(() => {
    if ('xr' in navigator) {
      navigator.xr.isSessionSupported('immersive-ar')
        .then((supported) => setWebXRSupported(supported))
        .catch(() => setWebXRSupported(false));
    }
  }, []);

  // Enumerate video devices
  const loadVideoDevices = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === 'videoinput');
      setVideoDevices(cams);
    } catch (e) {
      console.warn("Could not enumerate camera devices:", e);
    }
  }, []);

  // Request Camera Stream
  const startCamera = useCallback(async (deviceId = null) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError("Camera API not supported in this browser context.");
      setCameraActive(false);
      return;
    }

    let stream = null;
    try {
      if (deviceId) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId } }
        });
      } else {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } }
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch (pErr) {
          console.warn("Video play interrupted:", pErr);
        }
      }
      setCameraActive(true);
      setCameraError(null);
      await loadVideoDevices();
    } catch (err) {
      console.warn("Camera access failed:", err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError("Camera permission blocked. Click the lock icon in the address bar -> Allow Camera -> Refresh.");
      } else if (err.name === 'NotFoundError') {
        setCameraError("No camera device detected on this system.");
      } else {
        setCameraError(`Camera unavailable (${err.name || 'Error'}).`);
      }
      setCameraActive(false);
    }
  }, [loadVideoDevices]);

  useEffect(() => {
    startCamera(selectedDeviceId);
  }, [selectedDeviceId, startCamera]);

  // Advance physical step forward along route with visual surge & haptic feedback
  const advanceStep = useCallback((stepMagnitude = 0.14) => {
    const maxProg = Math.max(1, (route.length > 0 ? route.length - 1 : 10));
    setStepCount((c) => c + 1);
    setWalkProgress((prev) => Math.min(maxProg, prev + stepMagnitude));

    // Surge ribbon texture forward to give distinct motion feedback
    stepSurgeRef.current = 0.14;
    setLastStepFeedback(true);
    setTimeout(() => setLastStepFeedback(false), 250);

    // Haptic vibration on mobile
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(25); } catch {}
    }
  }, [route]);

  // Request Motion Sensors (iOS 13+ & Android permission prompt)
  const enableMotionSensor = useCallback(async () => {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const state = await DeviceMotionEvent.requestPermission();
        if (state === 'granted') {
          setMotionSensorActive(true);
        } else {
          alert("Motion sensor permission denied. You can tap 'Step Forward' to walk.");
        }
      } catch (err) {
        console.warn("Motion permission request failed:", err);
      }
    } else {
      setMotionSensorActive(true);
    }
  }, []);

  // Real Physical Step Detection (Pedometer via DeviceMotion API — NO TIMERS)
  useEffect(() => {
    let lastMag = 0;
    let lastStepTime = 0;

    function handleMotion(e) {
      const acc = e.accelerationIncludingGravity || e.acceleration;
      if (!acc) return;

      const mag = Math.sqrt((acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2);
      const delta = Math.abs(mag - lastMag);
      lastMag = mag;

      const now = Date.now();
      // Detect footstep impact acceleration spike (> 2.8 m/s² difference with min 380ms stride interval)
      if (delta > 2.8 && (now - lastStepTime > 380)) {
        lastStepTime = now;
        setMotionSensorActive(true);
        advanceStep(0.14); // ~0.7m physical step stride
      }
    }

    if (window.DeviceMotionEvent) {
      window.addEventListener('devicemotion', handleMotion);
    }
    return () => {
      if (window.DeviceMotionEvent) {
        window.removeEventListener('devicemotion', handleMotion);
      }
    };
  }, [advanceStep]);

  // Optional Smooth Auto-Walk Pace (Human walking speed 1.2 m/s)
  useEffect(() => {
    if (!autoWalkPace) {
      isWalkingRef.current = false;
      return;
    }

    isWalkingRef.current = true;
    const maxProg = Math.max(1, (route.length > 0 ? route.length - 1 : 10));
    const timer = setInterval(() => {
      setWalkProgress((prev) => {
        if (prev >= maxProg) {
          setAutoWalkPace(false);
          isWalkingRef.current = false;
          return maxProg;
        }
        stepSurgeRef.current = 0.04;
        return Math.min(maxProg, prev + 0.015);
      });
    }, 80);

    return () => clearInterval(timer);
  }, [autoWalkPace, route]);

  // Voice Instruction triggers when step index advances
  useEffect(() => {
    if (voiceEnabled && currentStep) {
      speakInstruction(currentStep.text);
    }
  }, [currentStepIndex, voiceEnabled, currentStep]);

  // Quick Destination Switcher inside AR
  const handleQuickDestination = useCallback(async (query) => {
    const startId = (typeof startNode === 'string' && startNode) ? startNode : (route[0]?.nodeId || 'node_1005');
    setRouteLoading(true);
    setWalkProgress(0);
    setStepCount(0);
    try {
      const res = await getRoute(startId, query);
      setActiveRouteResult(res);
      if (res.turnInstructions?.[0]) {
        speakInstruction(res.turnInstructions[0].text);
      }
    } catch (e) {
      console.warn("Could not load destination:", e);
    } finally {
      setRouteLoading(false);
    }
  }, [startNode, route]);

  // Initialize Three.js 3D WebAR Scene
  useEffect(() => {
    if (!canvasRef.current) return;

    const width = containerRef.current?.clientWidth || window.innerWidth;
    const height = containerRef.current?.clientHeight || window.innerHeight;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera tilted downward ~16° towards floor ribbon so the path starting at feet is prominent
    const camera = new THREE.PerspectiveCamera(65, width / height, 0.1, 1000);
    camera.position.set(0, 1.35, 0);
    camera.lookAt(0, 0.1, -4.5);
    cameraThreeRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      alpha: true,
      antialias: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    rendererRef.current = renderer;

    // 2. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x38bdf8, 2.5);
    dirLight.position.set(5, 12, 7);
    scene.add(dirLight);

    // 3. Floating 3D Directional Arrow Cue (Anchored on the forward ribbon)
    const arrowGroup = new THREE.Group();
    arrowGroup.frustumCulled = false;

    const arrowGeo = new THREE.ConeGeometry(0.35, 1.1, 16);
    arrowGeo.rotateX(Math.PI / 2);
    const arrowMat = new THREE.MeshStandardMaterial({
      color: 0x00f5ff,
      emissive: 0x0284c7,
      emissiveIntensity: 0.95,
      metalness: 0.4,
      roughness: 0.2
    });
    const arrowMesh = new THREE.Mesh(arrowGeo, arrowMat);
    arrowMesh.frustumCulled = false;
    arrowGroup.add(arrowMesh);

    const arrowRingGeo = new THREE.RingGeometry(0.4, 0.65, 32);
    arrowRingGeo.rotateX(-Math.PI / 2);
    const arrowRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const arrowRing = new THREE.Mesh(arrowRingGeo, arrowRingMat);
    arrowRing.position.y = -0.3;
    arrowRing.frustumCulled = false;
    arrowGroup.add(arrowRing);

    arrowGroup.position.set(0, 0.75, -2.8);
    scene.add(arrowGroup);
    arrowMeshRef.current = arrowGroup;

    // 4. Blue Dot Marker (Start Node Anchor)
    const blueGroup = new THREE.Group();
    blueGroup.frustumCulled = false;

    const blueSphereGeo = new THREE.SphereGeometry(0.15, 24, 24);
    const blueSphereMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.9,
      metalness: 0.5,
      roughness: 0.1
    });
    const blueSphere = new THREE.Mesh(blueSphereGeo, blueSphereMat);
    blueSphere.position.y = 0.20;
    blueSphere.frustumCulled = false;
    blueGroup.add(blueSphere);

    const blueRingGeo = new THREE.RingGeometry(0.20, 0.38, 32);
    blueRingGeo.rotateX(-Math.PI / 2);
    const blueRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const blueRing = new THREE.Mesh(blueRingGeo, blueRingMat);
    blueRing.position.y = 0.12;
    blueRing.frustumCulled = false;
    blueGroup.add(blueRing);

    blueGroup.position.set(0, 0, -0.5);
    scene.add(blueGroup);
    blueDotRef.current = blueGroup;

    // 5. Red Dot Marker (Destination Node Beacon)
    const redGroup = new THREE.Group();
    redGroup.frustumCulled = false;

    const redHeadGeo = new THREE.SphereGeometry(0.18, 24, 24);
    const redHeadMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e,
      emissive: 0xe11d48,
      emissiveIntensity: 1.0,
      metalness: 0.5,
      roughness: 0.1
    });
    const redHead = new THREE.Mesh(redHeadGeo, redHeadMat);
    redHead.position.y = 0.52;
    redHead.frustumCulled = false;
    redGroup.add(redHead);

    const redConeGeo = new THREE.ConeGeometry(0.15, 0.40, 16);
    redConeGeo.rotateX(Math.PI);
    const redCone = new THREE.Mesh(redConeGeo, redHeadMat);
    redCone.position.y = 0.20;
    redCone.frustumCulled = false;
    redGroup.add(redCone);

    const redRingGeo = new THREE.RingGeometry(0.28, 0.50, 32);
    redRingGeo.rotateX(-Math.PI / 2);
    const redRingMat = new THREE.MeshBasicMaterial({
      color: 0xf43f5e,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9
    });
    const redRing = new THREE.Mesh(redRingGeo, redRingMat);
    redRing.position.y = 0.12;
    redRing.frustumCulled = false;
    redGroup.add(redRing);

    scene.add(redGroup);
    redDotRef.current = redGroup;

    // 6. Dynamic Animated Floor Ribbon with Procedural Chevrons >>>
    const ribbonCanvas = createRibbonTexture();
    let ribbonTexture = null;
    if (ribbonCanvas) {
      ribbonTexture = new THREE.CanvasTexture(ribbonCanvas);
      ribbonTexture.wrapS = THREE.RepeatWrapping;
      ribbonTexture.wrapT = THREE.RepeatWrapping;
      ribbonTexture.repeat.set(1, 10);
      ribbonTextureRef.current = ribbonTexture;
    }

    const pathGeometry = new THREE.BufferGeometry();
    const pathMaterial = new THREE.MeshBasicMaterial({
      map: ribbonTexture,
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.98,
      depthWrite: false
    });
    const pathMesh = new THREE.Mesh(pathGeometry, pathMaterial);
    pathMesh.frustumCulled = false;
    scene.add(pathMesh);
    pathLineRef.current = pathMesh;

    // Render Animation Loop
    let time = 0;
    const baseCamY = 1.35;
    function animate() {
      animFrameId.current = requestAnimationFrame(animate);
      time += 0.03;

      // Stream texture forward along ribbon
      if (ribbonTextureRef.current) {
        ribbonTextureRef.current.offset.y -= (0.018 + stepSurgeRef.current);
        stepSurgeRef.current *= 0.92;
      }

      // Realistic walking head-bob when moving
      if (isWalkingRef.current || stepSurgeRef.current > 0.02) {
        camera.position.y = baseCamY + Math.sin(time * 8) * 0.035;
      } else {
        camera.position.y = baseCamY;
      }

      // Gentle arrow bob
      if (arrowMeshRef.current) {
        arrowMeshRef.current.position.y = 0.75 + Math.sin(time * 3.5) * 0.08;
      }

      // Destination pin spin & pulsing floor ring
      if (redDotRef.current) {
        redDotRef.current.position.y = Math.sin(time * 2.5) * 0.12;
        redDotRef.current.rotation.y += 0.025;
      }

      renderer.render(scene, camera);
    }
    animate();

    function handleResize() {
      if (!containerRef.current || !rendererRef.current || !cameraThreeRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraThreeRef.current.aspect = w / h;
      cameraThreeRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    }
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
      renderer.dispose();
    };
  }, []);

  // Calculate current interpolated User Position on Route
  const getCurrentUserPos = useCallback(() => {
    if (!route || route.length === 0) return { x: 0, y: 0 };
    if (route.length === 1) return { x: route[0].x, y: route[0].y };

    const idx = Math.min(Math.floor(walkProgress), route.length - 2);
    const frac = walkProgress - idx;

    const n1 = route[idx];
    const n2 = route[idx + 1] || n1;

    return {
      x: n1.x + (n2.x - n1.x) * frac,
      y: n1.y + (n2.y - n1.y) * frac
    };
  }, [route, walkProgress]);

  // Update 3D Path Line, Floating Arrow & Destination Beacon
  useEffect(() => {
    const userPos = getCurrentUserPos();

    // Generate Camera-Forward Relative 3D Points
    // (Always generates points even if route is empty, giving a smooth straight preview!)
    const points3D = transformRouteToCameraPath(route, userPos, walkProgress);

    if (points3D.length < 2) return;

    // Build Smooth Glowing 3D Ribbon Mesh
    if (pathLineRef.current) {
      const ribbonWidth = 0.52; // Wide, prominent floor ribbon
      const vertices = [];
      const uvs = [];
      const indices = [];

      let accumulatedDist = 0;

      for (let i = 0; i < points3D.length; i++) {
        const p = points3D[i];
        let normX = 1;
        let normZ = 0;

        if (i < points3D.length - 1) {
          const nextP = points3D[i + 1];
          const dx = nextP.x - p.x;
          const dz = nextP.z - p.z;
          const len = Math.hypot(dx, dz) || 1;
          normX = -dz / len;
          normZ = dx / len;
          accumulatedDist += len;
        } else if (i > 0) {
          const prevP = points3D[i - 1];
          const dx = p.x - prevP.x;
          const dz = p.z - prevP.z;
          const len = Math.hypot(dx, dz) || 1;
          normX = -dz / len;
          normZ = dx / len;
        }

        // Left & Right edges of the floor ribbon
        vertices.push(
          p.x - normX * ribbonWidth, p.y, p.z - normZ * ribbonWidth,
          p.x + normX * ribbonWidth, p.y, p.z + normZ * ribbonWidth
        );

        // UV mapping along length of ribbon
        const v = accumulatedDist * 1.5;
        uvs.push(0, v, 1, v);
      }

      for (let i = 0; i < points3D.length - 1; i++) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2);
        indices.push(base + 2, base + 1, base + 3);
      }

      // Reallocate fresh BufferGeometry so WebGL reliably assigns the GPU vertex buffers
      const newGeo = new THREE.BufferGeometry();
      newGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      newGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      newGeo.setIndex(indices);
      newGeo.computeVertexNormals();
      newGeo.computeBoundingSphere();

      if (pathLineRef.current.geometry) {
        pathLineRef.current.geometry.dispose();
      }
      pathLineRef.current.geometry = newGeo;
      pathLineRef.current.visible = true;
    }

    // Position Floating 3D Directional Arrow on the Path Ahead
    if (arrowMeshRef.current && points3D.length > 2) {
      const targetP = points3D[Math.min(3, points3D.length - 1)];
      const angleRad = Math.atan2(targetP.x, -targetP.z);
      arrowMeshRef.current.rotation.y = angleRad;
      arrowMeshRef.current.position.set(targetP.x * 0.35, 0.75, Math.max(-3.8, Math.min(-1.6, targetP.z)));
      arrowMeshRef.current.visible = true;
    }

    // Position Red Dot Destination Pin at the end of the ribbon
    if (redDotRef.current && points3D.length > 1) {
      const destP = points3D[points3D.length - 1];
      redDotRef.current.position.set(destP.x, 0, destP.z);
      redDotRef.current.visible = true;
    }

    // Hide Start Blue Dot once user has moved along route
    if (blueDotRef.current) {
      blueDotRef.current.visible = walkProgress < 0.6;
    }
  }, [route, walkProgress, getCurrentUserPos]);

  // Launch Google ARCore WebXR session
  const launchWebXR = async () => {
    if (!navigator.xr) return;
    try {
      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'dom-overlay'],
        domOverlay: { root: containerRef.current }
      });
      setXrSessionActive(true);
      session.addEventListener('end', () => setXrSessionActive(false));
    } catch (err) {
      console.warn("WebXR AR session failed:", err);
      alert("Native ARCore session failed. Continuing in Camera AR mode.");
    }
  };

  // ── Automatic Radar-Path Synchronization ──
  const userPos = getCurrentUserPos();
  const currIdx = Math.min(Math.floor(walkProgress), Math.max(0, route.length - 2));
  const nCurr = route[currIdx] || route[0] || { x: 0, y: 0 };
  const nNext = route[currIdx + 1] || route[route.length - 1] || nCurr;
  const destNode = destination || route[route.length - 1] || nCurr;

  // Active corridor direction on map (deg)
  const segmentBearing = calculateBearing(nCurr.x, nCurr.y, nNext.x, nNext.y);
  // Target destination direction from current user position (deg)
  const targetBearing = calculateBearing(userPos.x, userPos.y, destNode.x, destNode.y);

  // Relative angle to destination from current forward corridor direction (-180 to +180 deg)
  const relTargetAngle = calculateTurnAngle(segmentBearing, targetBearing);

  // Remaining distance to destination in meters
  const distToDest = Math.max(
    0,
    Math.round(Math.hypot((destNode.x - userPos.x) * SCALE_METERS, (destNode.y - userPos.y) * SCALE_METERS))
  );

  // Next turn distance in meters
  const distToNextTurn = Math.max(
    0,
    Math.round(Math.hypot((nNext.x - userPos.x) * SCALE_METERS, (nNext.y - userPos.y) * SCALE_METERS))
  );

  // Synchronized Radar Path:
  // User is at center (50, 50).
  // FORWARD ALONG ACTIVE CORRIDOR IS ALWAYS STRAIGHT UP (12 o'clock).
  // All upcoming bends (left/right) are rotated to align with the camera forward view.
  const radarScale = 0.15;
  const upcomingRadarNodes = route.slice(currIdx, currIdx + 8);
  const radarPathD = upcomingRadarNodes.length > 1
    ? upcomingRadarNodes.map((n, idx) => {
        if (idx === 0) return "M 50 50";
        const dx = (n.x - userPos.x) * radarScale;
        const dy = (n.y - userPos.y) * radarScale;
        // Rotate so active segment bearing points straight UP (-90 deg)
        const rad = ((segmentBearing - 90) * Math.PI) / 180;
        const rx = 50 + (dx * Math.cos(-rad) - dy * Math.sin(-rad));
        const ry = 50 + (dx * Math.sin(-rad) + dy * Math.cos(-rad));
        return `L ${rx.toFixed(1)} ${ry.toFixed(1)}`;
      }).join(" ")
    : "M 50 50 L 50 18";

  const isArrived = route.length > 1 && walkProgress >= (route.length - 1);

  return (
    <div className="ar-viewport-container" ref={containerRef}>
      {/* Background Device Camera Stream */}
      <video
        ref={videoRef}
        className="ar-camera-video"
        playsInline
        muted
        autoPlay
      />

      {/* Camera Permission Prompt / Simulated 3D Floor Background */}
      {!cameraActive && (
        <div className="ar-simulated-bg">
          <div className="ar-simulated-grid"></div>

          {!dismissSimulatedNotice ? (
            <div className="ar-camera-permission-card">
              <div className="permission-icon">📷</div>
              <h3>Camera Access</h3>
              <p className="permission-subtext">
                Enable camera to project 3D arrows onto real floors, or explore in 3D simulated mode.
              </p>
              {cameraError && (
                <div className="permission-error-box">
                  ⚠️ {cameraError}
                  {cameraError.includes("browser context") && (
                    <div className="permission-error-hint">
                      (Browser requires HTTPS for camera. You can explore in 3D Simulated Mode below!)
                    </div>
                  )}
                </div>
              )}

              <div className="permission-actions-group">
                <button
                  type="button"
                  className="ar-permission-btn"
                  onClick={() => startCamera(selectedDeviceId)}
                >
                  📷 Try Camera Permission
                </button>

                <button
                  type="button"
                  className="ar-simulated-mode-btn"
                  onClick={() => setDismissSimulatedNotice(true)}
                >
                  🎮 View 3D Path on Simulated Floor
                </button>
              </div>

              {videoDevices.length > 0 && (
                <div className="permission-device-select">
                  <span>Selected Device: </span>
                  <select
                    value={selectedDeviceId}
                    onChange={(e) => {
                      setSelectedDeviceId(e.target.value);
                      startCamera(e.target.value);
                    }}
                    className="permission-select-dropdown"
                  >
                    <option value="">Auto / Integrated Camera</option>
                    {videoDevices.map((dev, idx) => (
                      <option key={dev.deviceId || idx} value={dev.deviceId}>
                        {dev.label || `Camera ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="ar-simulated-active-pill"
              onClick={() => setDismissSimulatedNotice(false)}
              title="3D Simulated Mode Active. Tap to configure camera"
            >
              🎮 3D Simulated Floor Active (Tap for Camera)
            </button>
          )}
        </div>
      )}

      {/* Three.js 3D WebAR Canvas */}
      <canvas ref={canvasRef} className="ar-three-canvas" />

      {/* Top Header Bar */}
      <div className="ar-top-bar">
        <div className="ar-brand-group">
          <div className="ar-status-dot pulse"></div>
          <div className="ar-brand-text">
            <div className="ar-title">WebAR Walk</div>
            <div className="ar-subtitle">
              {destination ? `To: ${destination.label || destination.type}` : "AR Real-Step Navigation"}
            </div>
          </div>
        </div>

        <div className="ar-top-actions">
          {videoDevices.length > 0 && (
            <select
              className="ar-pill-btn ar-select-pill"
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              title="Select Camera Device"
            >
              <option value="">🎥 Camera</option>
              {videoDevices.map((dev, idx) => (
                <option key={dev.deviceId || idx} value={dev.deviceId}>
                  {dev.label || `Cam ${idx + 1}`}
                </option>
              ))}
            </select>
          )}

          {!cameraActive && (
            <button
              type="button"
              className="ar-pill-btn ar-camera-btn"
              onClick={() => {
                setDismissSimulatedNotice(false);
                startCamera(selectedDeviceId);
              }}
              title="Enable Camera Stream"
            >
              🎥 <span className="ar-btn-label">Camera</span>
            </button>
          )}

          {webXRSupported && (
            <button
              type="button"
              className={`ar-pill-btn ${xrSessionActive ? 'active' : ''}`}
              onClick={launchWebXR}
              title="Launch Google ARCore WebXR"
            >
              <span>✨ ARCore</span>
            </button>
          )}

          <button
            type="button"
            className="ar-pill-btn ar-anchor-btn"
            onClick={() => setShowAnchorModal(true)}
            title="Recalibrate position anchor"
          >
            🎯 <span className="ar-btn-label">Anchor</span>
          </button>

          <button
            type="button"
            className="ar-close-btn"
            onClick={onClose}
            title="Exit AR View"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Quick Destination Chips in AR */}
      <div style={{
        position: "absolute",
        top: "60px",
        left: "12px",
        right: "12px",
        display: "flex",
        gap: "6px",
        overflowX: "auto",
        zIndex: 20,
        padding: "4px 0",
        scrollbarWidth: "none"
      }}>
        {[
          { label: "Central Library", query: "Central Library", icon: "📚" },
          { label: "Cafeteria", query: "Cafeteria", icon: "☕" },
          { label: "Lab A-002", query: "A-002", icon: "🔬" },
          { label: "Entrance", query: "A-BLOCK ENTRANCE", icon: "🚪" }
        ].map((dest) => (
          <button
            key={dest.label}
            onClick={() => handleQuickDestination(dest.query)}
            disabled={routeLoading}
            style={{
              background: destination?.label?.toLowerCase().includes(dest.label.toLowerCase())
                ? "rgba(14, 165, 233, 0.9)"
                : "rgba(15, 23, 42, 0.75)",
              color: "#ffffff",
              border: "1px solid rgba(56, 189, 248, 0.4)",
              backdropFilter: "blur(8px)",
              padding: "4px 10px",
              borderRadius: "9999px",
              fontSize: "0.75rem",
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              boxShadow: "0 2px 6px rgba(0,0,0,0.3)"
            }}
          >
            <span>{dest.icon}</span>
            <span>{dest.label}</span>
          </button>
        ))}
      </div>

      {/* Synchronized Auto-Locking Radar System */}
      <div className="ar-radar-container">
        <div className="radar-lock-badge">
          <span style={{ fontSize: "9px" }}>🟢</span> LOCKED
        </div>
        <svg viewBox="0 0 100 100" className="radar-svg">
          {/* Radar background grid */}
          <circle cx="50" cy="50" r="46" fill="rgba(6,9,19,0.85)" stroke="rgba(56,189,248,0.3)" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="30" fill="none" stroke="rgba(56,189,248,0.2)" strokeWidth="1" strokeDasharray="3 3" />
          <circle cx="50" cy="50" r="15" fill="none" stroke="rgba(56,189,248,0.2)" strokeWidth="1" />

          {/* Forward Line of Sight (Straight UP is where ribbon and walk direction are) */}
          <line x1="50" y1="50" x2="50" y2="6" stroke="rgba(52,211,153,0.5)" strokeWidth="1.5" strokeDasharray="2 2" />

          {/* Synchronized Path Line: centered on user and aligned with active corridor */}
          {radarPathD && (
            <path
              d={radarPathD}
              fill="none"
              stroke="#34d399"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Automatic Target Direction Needle pointing towards destination */}
          <g transform={`rotate(${relTargetAngle} 50 50)`}>
            <polygon
              points="50,6 45,16 55,16"
              fill="#f43f5e"
              stroke="#ffffff"
              strokeWidth="1"
            />
            <circle cx="50" cy="9" r="2.5" fill="#ffffff" />
          </g>

          {/* Live User Position Indicator at Center */}
          <circle cx="50" cy="50" r="5.5" fill="#38bdf8" stroke="#ffffff" strokeWidth="2.5" />
          <polygon points="50,42 46,47 54,47" fill="#ffffff" />
        </svg>

        {/* Live Distance & Target Badge */}
        <div className="radar-dist-chip">
          🎯 {distToDest}m {destination?.label ? `· ${destination.label.slice(0, 10)}` : ''}
        </div>
      </div>

      {/* Main HUD Instruction Card (Physical Motion Tracking & Collapsible Steps Drawer) */}
      <div className={`ar-hud-card ${isStepsExpanded ? 'expanded' : 'collapsed'}`}>
        {/* Drawer Header & Keep Up / Keep Down Toggle Bar */}
        <div className="hud-drawer-header">
          <div
            className="hud-drawer-handle"
            onClick={() => setIsStepsExpanded((prev) => !prev)}
            title={isStepsExpanded ? "Keep down to view 3D floor path" : "Keep up to view all route steps"}
          />
          <div className="hud-drawer-top-row">
            <div className="hud-drawer-title-area">
              <span className="hud-drawer-badge">
                {isStepsExpanded ? '📋 ALL ROUTE STEPS' : `STEP ${currentStepIndex + 1} OF ${turnInstructions.length || 1}`}
              </span>
              <span className="hud-drawer-route-summary">
                {startLocation?.label || "Start"} → {destination?.label || destination?.type || "Destination"}
              </span>
            </div>

            <button
              type="button"
              className={`hud-toggle-steps-btn ${isStepsExpanded ? 'active' : ''}`}
              onClick={() => setIsStepsExpanded((prev) => !prev)}
              aria-expanded={isStepsExpanded}
              title={isStepsExpanded ? "Keep down to see camera & floor path" : "Keep up to see all route steps"}
            >
              <span className="hud-toggle-arrow">{isStepsExpanded ? '▼' : '▲'}</span>
              <span className="hud-toggle-label">
                {isStepsExpanded ? 'Keep Down (View Path)' : `Keep Up (View Steps • ${turnInstructions.length || 0})`}
              </span>
            </button>
          </div>
        </div>

        {/* When Expanded (Kept Up): Scrollable list of ALL turn-by-turn steps */}
        {isStepsExpanded ? (
          <div className="hud-expanded-view">
            {currentStep && (
              <div className="hud-active-step-preview">
                <div className="active-preview-icon">
                  {getActionIconSvg(currentStep.action)}
                </div>
                <div className="active-preview-info">
                  <div className="active-preview-label">
                    Current Step ({currentStepIndex + 1}/{turnInstructions.length}):
                  </div>
                  <div className="active-preview-text">{currentStep.text}</div>
                </div>
                <div className="active-preview-nav">
                  <button
                    type="button"
                    className="step-jump-btn"
                    disabled={currentStepIndex <= 0}
                    onClick={() => setWalkProgress(Math.max(0, currentStepIndex - 1))}
                    title="Previous Step"
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    className="step-jump-btn"
                    disabled={currentStepIndex >= turnInstructions.length - 1}
                    onClick={() => setWalkProgress(Math.min(turnInstructions.length - 1, currentStepIndex + 1))}
                    title="Next Step"
                  >
                    ▶
                  </button>
                </div>
              </div>
            )}

            <div className="ar-steps-scroll-container">
              {turnInstructions.length === 0 ? (
                <div className="ar-steps-empty">Calculating pathway instructions...</div>
              ) : (
                turnInstructions.map((step, idx) => {
                  const isActive = idx === currentStepIndex;
                  const isPast = idx < currentStepIndex;
                  return (
                    <div
                      key={step.stepIndex ?? idx}
                      className={`ar-step-item ${isActive ? 'active' : ''} ${isPast ? 'completed' : ''}`}
                      onClick={() => setWalkProgress(idx)}
                      role="button"
                      tabIndex={0}
                      title={`Tap to jump navigation to Step ${idx + 1}`}
                    >
                      <div className="ar-step-index-pill">
                        {isPast ? '✓' : idx + 1}
                      </div>
                      <div className="ar-step-icon-box">
                        {getActionIconSvg(step.action)}
                      </div>
                      <div className="ar-step-content">
                        <div className="ar-step-instruction-line">{step.text}</div>
                        <div className="ar-step-tags">
                          {step.targetLabel && (
                            <span className="ar-step-tag target">🎯 {step.targetLabel}</span>
                          )}
                          {step.distanceMeters > 0 && (
                            <span className="ar-step-tag dist">📏 ~{step.distanceMeters}m</span>
                          )}
                          {isActive && (
                            <span className="ar-step-tag active-now">Live Step</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          /* When Kept Down (Collapsed): Compact Current Step HUD Card (Camera & 3D path fully visible) */
          <>
            {isArrived ? (
              <div className="hud-content">
                <div className="hud-icon-box" style={{ background: "rgba(52, 211, 153, 0.2)", borderColor: "#34d399" }}>
                  <span className="hud-action-emoji">🎯</span>
                </div>
                <div className="hud-details">
                  <div className="hud-step-tag" style={{ background: "rgba(52, 211, 153, 0.2)", color: "#34d399" }}>
                    Destination Reached
                  </div>
                  <div className="hud-instruction-text">
                    You have arrived at {destination?.label || destination?.type || "your destination"}!
                  </div>
                </div>
              </div>
            ) : currentStep ? (
              <div className="hud-content">
                <div className="hud-icon-box">
                  <span className="hud-action-emoji">
                    {getActionIconSvg(currentStep.action)}
                  </span>
                </div>

                <div className="hud-details">
                  <div className="hud-step-tag hud-step-tag-desktop">
                    Step {currentStepIndex + 1} of {turnInstructions.length || 1} · {distToNextTurn > 0 ? `Next turn in ~${distToNextTurn}m` : 'On Corridor'}
                  </div>
                  <div className="hud-instruction-text">{currentStep.text}</div>
                  <div className="hud-meta">
                    <span className="hud-chip">
                      🔵 Start: <strong>{startLocation?.label || "Entrance"}</strong>
                    </span>
                    <span className="hud-chip">
                      🔴 Target: <strong>{currentStep.targetLabel || destination?.label || "Corridor"}</strong>
                    </span>
                    {distToDest > 0 && (
                      <span className="hud-chip highlight">
                        📏 ~{distToDest}m remaining
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="hud-content">
                <div className="hud-icon-box">
                  <span className="hud-action-emoji">⬆️</span>
                </div>
                <div className="hud-details">
                  <div className="hud-step-tag">Auto-Locked Guidance</div>
                  <div className="hud-instruction-text">
                    {routeLoading ? "Calculating pathway..." : "Follow the glowing ribbon straight ahead"}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Real Physical Motion Control Bar */}
        <div className="hud-controls-row">
          <div className="hud-controls-primary">
            {/* Live Footstep Pedometer Counter */}
            <div
              className={`hud-chip hud-chip-pedometer ${lastStepFeedback ? 'highlight' : ''}`}
            >
              <span>👟 Steps: <strong>{stepCount}</strong></span>
              {motionSensorActive && (
                <span className="hud-sensor-indicator">• Active</span>
              )}
            </div>

            {/* Manual Step Forward Action */}
            <button
              type="button"
              className="hud-nav-btn primary"
              onClick={() => advanceStep(0.14)}
              title="Step Forward (advances along ribbon)"
            >
              👟 Step Forward
            </button>
          </div>

          <div className="hud-controls-secondary">
            {/* Toggle Walking Pace Simulation */}
            <button
              type="button"
              className={`hud-icon-btn ${autoWalkPace ? 'active' : ''}`}
              onClick={() => setAutoWalkPace(!autoWalkPace)}
              title="Preview walking along ribbon at natural walking pace"
            >
              🏃 {autoWalkPace ? 'Walking' : 'Pace'}
            </button>

            {!motionSensorActive && (
              <button
                type="button"
                className="hud-icon-btn active"
                onClick={enableMotionSensor}
                title="Activate accelerometer step sensor"
              >
                📡 Sensor
              </button>
            )}

            <button
              type="button"
              className={`hud-icon-btn ${voiceEnabled ? 'active' : ''}`}
              onClick={() => {
                setVoiceEnabled(!voiceEnabled);
                if (!voiceEnabled && currentStep) speakInstruction(currentStep.text);
              }}
              title={voiceEnabled ? "Mute Voice Guidance" : "Enable Voice Guidance"}
            >
              {voiceEnabled ? '🔊 Voice' : '🔇 Mute'}
            </button>
          </div>
        </div>
      </div>

      {/* Position Anchor Calibration Modal */}
      {showAnchorModal && (
        <div className="ar-modal-backdrop" onClick={() => setShowAnchorModal(false)}>
          <div className="ar-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ar-modal-header">
              <h3>🎯 Indoor Anchor Calibration</h3>
              <button className="ar-close-btn" onClick={() => setShowAnchorModal(false)}>✕</button>
            </div>
            <p className="ar-modal-desc">
              Select your current physical location inside the building to snap the AR camera anchor:
            </p>

            <div className="anchor-list">
              {[
                { id: "node_1005", label: "Block A Entrance", desc: "Ground Floor Main Gate" },
                { id: "node_1042", label: "Central Lift LIFT-1", desc: "Block A Elevators" },
                { id: "node_1061", label: "Central Staircase STAIRS-1", desc: "Block A Stairs" },
                { id: "node_1075", label: "Central Library Entrance", desc: "2nd Floor Lounge" },
                { id: "node_1073", label: "KIIT Student Cafeteria", desc: "Ground Floor Food Court" },
              ].map((loc) => (
                <button
                  key={loc.id}
                  className="anchor-item"
                  onClick={() => {
                    if (onNodeSelect) onNodeSelect(loc.id);
                    setWalkProgress(0);
                    setStepCount(0);
                    setShowAnchorModal(false);
                    // Re-calculate route from new anchor
                    const destQuery = destination?.label || destination?.type || "Central Library";
                    setRouteLoading(true);
                    getRoute(loc.id, destQuery)
                      .then((res) => setActiveRouteResult(res))
                      .catch((e) => console.warn(e))
                      .finally(() => setRouteLoading(false));
                  }}
                >
                  <div className="anchor-icon">📍</div>
                  <div>
                    <div className="anchor-name">{loc.label}</div>
                    <div className="anchor-desc">{loc.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ARNavigation;
