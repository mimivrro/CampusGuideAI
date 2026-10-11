import { useRef, useState, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { calculateBearing, speakInstruction, getActionIconSvg } from '../services/arUtils';

/**
 * ARNavigation.jsx
 *
 * Immersive WebAR / ARCore 3D Interior Navigation Viewport.
 * - NO PRECODED TIMERS: 3D position and step progression only change when the user physically walks
 *   (via Device Motion pedometer step detection) or manually taps "Step Forward".
 * - Renders a continuous 3D floor pathway ribbon connecting Start (Blue Dot) to Destination (Red Dot).
 * - Real-time Gyroscope compass orientation.
 * - Dynamic hands-free turn guidance HUD that reacts to physical walking movement.
 */
function ARNavigation({ routeResult, startNode, onClose, onNodeSelect }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const videoRef = useRef(null);

  // AR State
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [heading, setHeading] = useState(0); // Compass orientation (0 - 360 deg)
  const [autoRotate, setAutoRotate] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [webXRSupported, setWebXRSupported] = useState(false);
  const [xrSessionActive, setXrSessionActive] = useState(false);
  const [showAnchorModal, setShowAnchorModal] = useState(false);

  // Physical Motion / Pedometer Step State (NO TIMERS!)
  const [walkProgress, setWalkProgress] = useState(0); // Progress index along route (0.0 to route.length - 1)
  const [stepCount, setStepCount] = useState(0);
  const [motionSensorActive, setMotionSensorActive] = useState(false);
  const [lastStepFeedback, setLastStepFeedback] = useState(false);
  const [isStepsExpanded, setIsStepsExpanded] = useState(false); // Collapsible drawer: false = kept down (see path), true = kept up (see all steps)
  const [dismissSimulatedNotice, setDismissSimulatedNotice] = useState(false);

  const route = routeResult?.route ?? [];
  const turnInstructions = routeResult?.turnInstructions ?? [];
  const destination = routeResult?.destination ?? null;
  const startLocation = route[0] ?? null;

  // Derive active instruction step from physical walkProgress
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
  const blueDotRef = useRef(null);
  const redDotRef = useRef(null);
  const pathLineRef = useRef(null);
  const animFrameId = useRef(null);

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

  // Gyroscope / Compass orientation
  useEffect(() => {
    function handleOrientation(e) {
      if (!autoRotate) return;
      let alpha = e.alpha;
      if (e.webkitCompassHeading) {
        alpha = e.webkitCompassHeading;
      }
      if (alpha !== null && alpha !== undefined) {
        setHeading((prev) => {
          const diff = (alpha - prev + 540) % 360 - 180;
          return (prev + diff * 0.15 + 360) % 360;
        });
      }
    }

    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation, true);
    }
    return () => {
      if (window.DeviceOrientationEvent) {
        window.removeEventListener('deviceorientation', handleOrientation, true);
      }
    };
  }, [autoRotate]);

  // Function to manually take 1 physical step forward along route
  const advanceStep = useCallback((stepMagnitude = 0.12) => {
    if (!route || route.length < 2) return;
    setStepCount((c) => c + 1);
    setWalkProgress((prev) => Math.min(route.length - 1, prev + stepMagnitude));
    setLastStepFeedback(true);
    setTimeout(() => setLastStepFeedback(false), 300);
  }, [route]);

  // Request Motion Sensors (iOS 13+ & Android permission prompt)
  const enableMotionSensor = useCallback(async () => {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const state = await DeviceMotionEvent.requestPermission();
        if (state === 'granted') {
          setMotionSensorActive(true);
        } else {
          alert("Motion sensor permission denied. You can tap 'Step Forward' to walk along the route.");
        }
      } catch (err) {
        console.warn("Motion permission request failed:", err);
      }
    } else {
      setMotionSensorActive(true);
    }
  }, []);

  // REAL Physical Step Detection (Pedometer via DeviceMotion API — NO TIMERS)
  useEffect(() => {
    let lastMag = 0;
    let lastStepTime = 0;

    function handleMotion(e) {
      if (!route || route.length < 2) return;
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
        advanceStep(0.12); // Advance position proportional to physical step (~0.7m stride)
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
  }, [route, advanceStep]);

  // Voice Instruction triggers ONLY when physical step index advances
  useEffect(() => {
    if (voiceEnabled && currentStep) {
      speakInstruction(currentStep.text);
    }
  }, [currentStepIndex, voiceEnabled, currentStep]);

  // Initialize Three.js 3D WebAR Scene
  useEffect(() => {
    if (!canvasRef.current) return;

    const width = containerRef.current?.clientWidth || window.innerWidth;
    const height = containerRef.current?.clientHeight || window.innerHeight;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(65, width / height, 0.1, 1000);
    camera.position.set(0, 1.6, 0); // 1.6m eye level height
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
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x38bdf8, 2.0);
    dirLight.position.set(5, 12, 7);
    scene.add(dirLight);

    // 3. Floating 3D Directional Arrow Cue
    const arrowGroup = new THREE.Group();
    arrowGroup.frustumCulled = false;

    const arrowGeo = new THREE.ConeGeometry(0.35, 1.1, 16);
    arrowGeo.rotateX(Math.PI / 2);
    const arrowMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 1.0,
      metalness: 0.3,
      roughness: 0.1
    });
    const arrowMesh = new THREE.Mesh(arrowGeo, arrowMat);
    arrowMesh.frustumCulled = false;
    arrowGroup.add(arrowMesh);

    const arrowRingGeo = new THREE.RingGeometry(0.4, 0.6, 32);
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

    arrowGroup.position.set(0, 0.9, -2.0);
    scene.add(arrowGroup);
    arrowMeshRef.current = arrowGroup;

    // 4. Blue Dot Marker (Start Node)
    const blueGroup = new THREE.Group();
    blueGroup.frustumCulled = false;

    const blueSphereGeo = new THREE.SphereGeometry(0.4, 24, 24);
    const blueSphereMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.9,
      metalness: 0.5,
      roughness: 0.1
    });
    const blueSphere = new THREE.Mesh(blueSphereGeo, blueSphereMat);
    blueSphere.position.y = 0.5;
    blueSphere.frustumCulled = false;
    blueGroup.add(blueSphere);

    const blueRingGeo = new THREE.RingGeometry(0.6, 1.0, 32);
    blueRingGeo.rotateX(-Math.PI / 2);
    const blueRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });
    const blueRing = new THREE.Mesh(blueRingGeo, blueRingMat);
    blueRing.position.y = 0.05;
    blueRing.frustumCulled = false;
    blueGroup.add(blueRing);

    scene.add(blueGroup);
    blueDotRef.current = blueGroup;

    // 5. Red Dot Marker (Destination Node)
    const redGroup = new THREE.Group();
    redGroup.frustumCulled = false;

    const redHeadGeo = new THREE.SphereGeometry(0.5, 24, 24);
    const redHeadMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e,
      emissive: 0xe11d48,
      emissiveIntensity: 1.0,
      metalness: 0.5,
      roughness: 0.1
    });
    const redHead = new THREE.Mesh(redHeadGeo, redHeadMat);
    redHead.position.y = 1.3;
    redHead.frustumCulled = false;
    redGroup.add(redHead);

    const redConeGeo = new THREE.ConeGeometry(0.4, 1.1, 16);
    redConeGeo.rotateX(Math.PI);
    const redCone = new THREE.Mesh(redConeGeo, redHeadMat);
    redCone.position.y = 0.5;
    redCone.frustumCulled = false;
    redGroup.add(redCone);

    const redRingGeo = new THREE.RingGeometry(0.8, 1.4, 32);
    redRingGeo.rotateX(-Math.PI / 2);
    const redRingMat = new THREE.MeshBasicMaterial({
      color: 0xf43f5e,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const redRing = new THREE.Mesh(redRingGeo, redRingMat);
    redRing.position.y = 0.05;
    redRing.frustumCulled = false;
    redGroup.add(redRing);

    scene.add(redGroup);
    redDotRef.current = redGroup;

    // 6. Continuous Glowing Floor Line Pathway Ribbon
    const pathGeometry = new THREE.BufferGeometry();
    const pathMaterial = new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x059669,
      emissiveIntensity: 0.9,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      roughness: 0.2,
      depthWrite: false
    });
    const pathMesh = new THREE.Mesh(pathGeometry, pathMaterial);
    pathMesh.frustumCulled = false;
    scene.add(pathMesh);
    pathLineRef.current = pathMesh;

    // Render Animation Loop
    let time = 0;
    function animate() {
      animFrameId.current = requestAnimationFrame(animate);
      time += 0.03;

      if (arrowMeshRef.current) {
        arrowMeshRef.current.position.y = 0.8 + Math.sin(time * 3) * 0.1;
      }
      if (blueDotRef.current) {
        blueDotRef.current.rotation.y += 0.01;
      }
      if (redDotRef.current) {
        redDotRef.current.position.y = Math.sin(time * 2) * 0.12;
        redDotRef.current.rotation.y += 0.02;
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

  // Helper to transform map node (x, y) to 3D Camera relative position
  const transformToCameraSpace = useCallback((node, userPos, compassHeading) => {
    const scale = 0.05; // 1 map unit = 0.05 meters (~20px = 1m)
    const dx = (node.x - userPos.x) * scale;
    const dy = (node.y - userPos.y) * scale;

    // Angle of map vector
    const mapAngle = Math.atan2(dy, dx);
    // Device heading in radians (0 deg = North)
    const headingRad = ((compassHeading - 90) * Math.PI) / 180;
    const relAngle = mapAngle - headingRad;
    const dist = Math.hypot(dx, dy);

    // Three.js Camera frame: -Z is forward, +X is right, Y is height
    const x3d = Math.sin(relAngle) * dist;
    const z3d = -Math.cos(relAngle) * dist;

    return { x: x3d, y: 0.08, z: z3d, dist };
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

  // Update 3D Path Line, Blue Dot, Red Dot, and Arrow on physical position / heading changes
  useEffect(() => {
    if (!route || route.length < 2) return;

    const userPos = getCurrentUserPos();

    // 1. Position Blue Dot (Start Node)
    if (blueDotRef.current && route[0]) {
      const pos3d = transformToCameraSpace(route[0], userPos, heading);
      blueDotRef.current.position.set(pos3d.x, pos3d.y, pos3d.z);
    }

    // 2. Position Red Dot (Destination Node)
    if (redDotRef.current && route[route.length - 1]) {
      const pos3d = transformToCameraSpace(route[route.length - 1], userPos, heading);
      redDotRef.current.position.set(pos3d.x, pos3d.y, pos3d.z);
    }

    // 3. Point Floating 3D Turn Arrow towards Next Waypoint (Clamped within mobile camera FOV)
    const nextNodeIdx = Math.min(Math.floor(walkProgress) + 1, route.length - 1);
    const nextNode = route[nextNodeIdx];
    if (arrowMeshRef.current && nextNode) {
      const pos3d = transformToCameraSpace(nextNode, userPos, heading);
      const angleRad = Math.atan2(pos3d.x, -pos3d.z);
      arrowMeshRef.current.rotation.y = angleRad;

      const arrowDist = 2.0; // Fixed distance in front of camera
      const maxClampedX = 0.65; // Keep inside mobile screen portrait width
      const targetX = Math.sin(angleRad) * arrowDist;
      const clampedX = Math.max(-maxClampedX, Math.min(maxClampedX, targetX));

      arrowMeshRef.current.position.x = clampedX;
      arrowMeshRef.current.position.z = -Math.cos(angleRad) * arrowDist;
    }

    // 4. Generate Continuous 3D Floor Pathway Ribbon Mesh (All Route Nodes)
    if (pathLineRef.current) {
      const ribbonWidth = 0.35;
      const vertices = [];
      const indices = [];

      for (let i = 0; i < route.length; i++) {
        const p3d = transformToCameraSpace(route[i], userPos, heading);

        // Compute tangent direction for ribbon thickness
        let perpX = 1, perpZ = 0;
        if (i < route.length - 1) {
          const pNext = transformToCameraSpace(route[i + 1], userPos, heading);
          const dirX = pNext.x - p3d.x;
          const dirZ = pNext.z - p3d.z;
          const len = Math.hypot(dirX, dirZ) || 1;
          perpX = -dirZ / len;
          perpZ = dirX / len;
        } else if (i > 0) {
          const pPrev = transformToCameraSpace(route[i - 1], userPos, heading);
          const dirX = p3d.x - pPrev.x;
          const dirZ = p3d.z - pPrev.z;
          const len = Math.hypot(dirX, dirZ) || 1;
          perpX = -dirZ / len;
          perpZ = dirX / len;
        }

        const yPos = 0.08; // Slightly raised above floor ground plane
        vertices.push(
          p3d.x - perpX * ribbonWidth, yPos, p3d.z - perpZ * ribbonWidth,
          p3d.x + perpX * ribbonWidth, yPos, p3d.z + perpZ * ribbonWidth
        );
      }

      for (let i = 0; i < route.length - 1; i++) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2);
        indices.push(base + 2, base + 1, base + 3);
      }

      if (vertices.length >= 6) {
        // Create fresh geometry & dispose old geometry so WebGL updates GPU buffer reliably on mobile
        const newGeo = new THREE.BufferGeometry();
        newGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        newGeo.setIndex(indices);
        newGeo.computeVertexNormals();
        newGeo.computeBoundingSphere();

        if (pathLineRef.current.geometry) {
          pathLineRef.current.geometry.dispose();
        }
        pathLineRef.current.geometry = newGeo;
      }
    }
  }, [route, walkProgress, heading, transformToCameraSpace, getCurrentUserPos]);

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

  const isArrived = walkProgress >= (route.length - 1);

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
              {destination ? `To: ${destination.label || destination.type}` : "AR Navigation"}
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

      {/* 3D Compass Dial Overlay */}
      <div className="ar-compass-overlay">
        <div className="compass-dial" style={{ transform: `rotate(${-heading}deg)` }}>
          <span className="compass-n">N</span>
          <span className="compass-e">E</span>
          <span className="compass-s">S</span>
          <span className="compass-w">W</span>
        </div>
        <div className="compass-heading-text">{Math.round(heading)}°</div>
      </div>

      {/* Mini Top-Down Radar Map */}
      <div className="ar-radar-container">
        <div className="radar-header">Pedometer Radar</div>
        <svg viewBox="0 0 100 100" className="radar-svg">
          <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(56,189,248,0.2)" strokeWidth="1" />
          <circle cx="50" cy="50" r="28" fill="none" stroke="rgba(56,189,248,0.2)" strokeWidth="1" strokeDasharray="3 3" />
          
          {/* Compass Vision Cone */}
          <polygon
            points="50,50 30,5 70,5"
            fill="rgba(56,189,248,0.18)"
            transform={`rotate(${heading} 50 50)`}
          />

          {/* Full Path Preview */}
          {route.length > 1 && (
            <polyline
              points={route.map((n) => {
                const start = route[0];
                const rx = 50 + (n.x - start.x) * 0.1;
                const ry = 50 + (n.y - start.y) * 0.1;
                return `${rx},${ry}`;
              }).join(" ")}
              fill="none"
              stroke="#34d399"
              strokeWidth="2.5"
              strokeDasharray="4 2"
            />
          )}

          {/* Start Node (Blue Dot) */}
          {route[0] && (
            <circle cx="20" cy="80" r="4" fill="#0284c7" stroke="#ffffff" strokeWidth="1.5" />
          )}

          {/* Target Node (Red Dot) */}
          {route[route.length - 1] && (
            <circle cx="80" cy="20" r="5" fill="#f43f5e" stroke="#ffffff" strokeWidth="2" />
          )}

          {/* Live User Position Dot */}
          <circle cx="50" cy="50" r="5" fill="#38bdf8" stroke="#ffffff" strokeWidth="2" />
        </svg>
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
            {/* Active step summary banner */}
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

            {/* Scrollable list of all steps */}
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
                    Step {currentStepIndex + 1} of {turnInstructions.length || 1}
                  </div>
                  <div className="hud-instruction-text">{currentStep.text}</div>
                  <div className="hud-meta">
                    <span className="hud-chip">
                      🔵 Start: <strong>{startLocation?.label || "Entrance"}</strong>
                    </span>
                    <span className="hud-chip">
                      🔴 Target: <strong>{currentStep.targetLabel}</strong>
                    </span>
                    {currentStep.distanceMeters > 0 && (
                      <span className="hud-chip highlight">
                        📏 ~{currentStep.distanceMeters}m
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="hud-content">
                <div className="hud-instruction-text">Calculating 3D AR pathway...</div>
              </div>
            )}
          </>
        )}

        {/* Real Physical Motion Control Bar (Structured 2-row layout: always fits on mobile without overflow) */}
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
              onClick={() => advanceStep(0.12)}
              title="Step Forward (advances 1 physical stride along pathway)"
            >
              👟 Step Forward
            </button>
          </div>

          <div className="hud-controls-secondary">
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

            <button
              type="button"
              className={`hud-icon-btn ${autoRotate ? 'active' : ''}`}
              onClick={() => setAutoRotate(!autoRotate)}
              title="Toggle Gyro Compass"
            >
              🧭 {autoRotate ? 'Gyro' : 'Manual'}
            </button>
          </div>
        </div>

        {/* Manual Orientation Slider fallback */}
        {!autoRotate && (
          <div className="heading-slider-row">
            <span>Heading Adjust:</span>
            <input
              type="range"
              min="0"
              max="360"
              value={heading}
              onChange={(e) => setHeading(Number(e.target.value))}
            />
            <span>{Math.round(heading)}°</span>
          </div>
        )}
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
