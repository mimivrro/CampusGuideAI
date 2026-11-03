import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import {
  speakInstruction,
  getActionIconSvg,
  isTabletDevice,
  getPointerConfig,
  smoothAngle,
  getScreenOrientationAngle,
  filterLinearAcceleration,
} from '../services/arUtils';

/**
 * Creates the exact dual-tone teardrop location pin from the reference image.
 * Features:
 * - Sharp bottom needle tip pointing directly down at the ground
 * - Large circular hole in the head so the path and environment are visible through it
 * - 3D dual-tone split (darker left half, lighter right half)
 * - Soft elliptical ground drop-shadow beneath the tip
 */
function createTeardropPin({
  height,
  width,
  holeRadius,
  depth,
  shadowX,
  shadowZ,
  leftColor,
  rightColor,
  emissiveLeft,
  emissiveRight,
}) {
  const group = new THREE.Group();
  group.frustumCulled = false;

  const R = width / 2;
  const Yc = height - R;
  const r = holeRadius;
  const theta = Math.asin(Math.min(0.99, R / Yc));
  const XtLeft = -R * Math.cos(theta);
  const YtLeft = Yc - R * Math.sin(theta);

  // 1. Left Half Shape
  const shapeLeft = new THREE.Shape();
  shapeLeft.moveTo(0, 0); // Tip
  shapeLeft.lineTo(XtLeft, YtLeft); // Left straight edge
  // Outer arc around top-left to top center (0, height)
  shapeLeft.absarc(0, Yc, R, -Math.PI + theta, Math.PI / 2, true);
  // Center line down to top of inner circular hole
  shapeLeft.lineTo(0, Yc + r);
  // Inner arc around left side of hole to bottom of hole (0, Yc - r)
  shapeLeft.absarc(0, Yc, r, Math.PI / 2, -Math.PI / 2, false);
  // Center line down to tip (0, 0)
  shapeLeft.lineTo(0, 0);

  // 2. Right Half Shape
  const shapeRight = new THREE.Shape();
  shapeRight.moveTo(0, 0); // Tip
  // Center line up to bottom of inner circular hole
  shapeRight.lineTo(0, Yc - r);
  // Inner arc around right side of hole to top of hole (0, Yc + r)
  shapeRight.absarc(0, Yc, r, -Math.PI / 2, Math.PI / 2, false);
  // Center line up to top center (0, height)
  shapeRight.lineTo(0, height);
  // Outer arc around top-right to right tangent point (XtRight, YtRight)
  shapeRight.absarc(0, Yc, R, Math.PI / 2, -theta, true);
  // Right straight edge down to tip (0, 0)
  shapeRight.lineTo(0, 0);

  const extrudeSettings = {
    depth: depth,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.004,
    bevelThickness: 0.004,
  };

  const geoLeft = new THREE.ExtrudeGeometry(shapeLeft, extrudeSettings);
  geoLeft.translate(0, 0, -depth / 2);
  const matLeft = new THREE.MeshStandardMaterial({
    color: leftColor,
    emissive: emissiveLeft,
    emissiveIntensity: 0.45,
    roughness: 0.25,
    metalness: 0.2,
  });
  const meshLeft = new THREE.Mesh(geoLeft, matLeft);
  meshLeft.frustumCulled = false;

  const geoRight = new THREE.ExtrudeGeometry(shapeRight, extrudeSettings);
  geoRight.translate(0, 0, -depth / 2);
  const matRight = new THREE.MeshStandardMaterial({
    color: rightColor,
    emissive: emissiveRight,
    emissiveIntensity: 0.55,
    roughness: 0.25,
    metalness: 0.2,
  });
  const meshRight = new THREE.Mesh(geoRight, matRight);
  meshRight.frustumCulled = false;

  // Container for the 3D pin body (rests tip at y = 0.09, just above floor ribbon)
  const pinBody = new THREE.Group();
  pinBody.add(meshLeft);
  pinBody.add(meshRight);
  pinBody.position.y = 0.09;
  pinBody.frustumCulled = false;
  group.add(pinBody);

  // 3. Ground Drop Shadow (matching the image)
  const shadowGeo = new THREE.CircleGeometry(shadowX, 32);
  shadowGeo.rotateX(-Math.PI / 2);
  shadowGeo.scale(1, 1, shadowZ / shadowX);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.position.y = 0.02; // Flush with floor
  shadowMesh.frustumCulled = false;
  group.add(shadowMesh);

  return {
    group,
    pinBody,
    shadowMesh,
    baseY: 0.09,
    shadowBaseScaleX: 1,
    shadowBaseScaleZ: shadowZ / shadowX,
  };
}

/**
 * ARNavigation.jsx
 *
 * Immersive WebAR / ARCore 3D Interior Navigation Viewport.
 * - Dynamic Phone vs. Tablet sizing: Pointers are sized and elevated specifically for
 *   each device form factor, with hollow reticles to keep the glowing green floor pathway 100% visible.
 * - NO PRECODED TIMERS: 3D position and step progression only change when the user physically walks
 *   (via linear accelerometer pedometer step detection) or manually taps "Step Forward".
 * - Renders a continuous 3D floor pathway ribbon connecting Start (Holo-Beacon) to Destination (Waypoint).
 * - Real-time Gyroscope compass orientation with screen angle orientation compensation.
 * - Full WebXR Google ARCore support with Three.js XR camera binding.
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

  // Automatic Device Form Factor Detection (Phone vs iPad/Tablet) - NO BUTTON
  const [deviceMode, setDeviceMode] = useState(() => (isTabletDevice() ? 'tablet' : 'phone'));

  useEffect(() => {
    function handleDeviceCheck() {
      const tablet = isTabletDevice();
      setDeviceMode(tablet ? 'tablet' : 'phone');
    }
    window.addEventListener('resize', handleDeviceCheck);
    window.addEventListener('orientationchange', handleDeviceCheck);
    return () => {
      window.removeEventListener('resize', handleDeviceCheck);
      window.removeEventListener('orientationchange', handleDeviceCheck);
    };
  }, []);

  // Physical Motion / Pedometer Step State (NO TIMERS!)
  const [walkProgress, setWalkProgress] = useState(0); // Progress index along route (0.0 to route.length - 1)
  const [stepCount, setStepCount] = useState(0);
  const [motionSensorActive, setMotionSensorActive] = useState(false);
  const [pedometerSensitivity, setPedometerSensitivity] = useState('normal'); // 'high' | 'normal' | 'low'
  const [lastStepFeedback, setLastStepFeedback] = useState(false);
  const [isStepsExpanded, setIsStepsExpanded] = useState(false); // Collapsible drawer
  const [dismissSimulatedNotice, setDismissSimulatedNotice] = useState(false);

  const route = useMemo(() => routeResult?.route ?? [], [routeResult?.route]);
  const turnInstructions = useMemo(
    () => routeResult?.turnInstructions ?? [],
    [routeResult?.turnInstructions]
  );
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
  const startPartsRef = useRef(null);
  const destPartsRef = useRef(null);
  const pathLineRef = useRef(null);
  const animFrameId = useRef(null);
  const gravityRef = useRef({ x: 0, y: 9.8, z: 0 });

  // Check WebXR AR support
  useEffect(() => {
    if ('xr' in navigator) {
      navigator.xr
        .isSessionSupported('immersive-ar')
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
      console.warn('Could not enumerate camera devices:', e);
    }
  }, []);

  // Request Camera Stream
  const startCamera = useCallback(
    async (deviceId = null) => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('Camera API not supported in this browser context.');
        setCameraActive(false);
        return;
      }

      let stream = null;
      try {
        if (deviceId) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: deviceId } },
          });
        } else {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: { ideal: 'environment' } },
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
            console.warn('Video play interrupted:', pErr);
          }
        }
        setCameraActive(true);
        setCameraError(null);
        await loadVideoDevices();
      } catch (err) {
        console.warn('Camera access failed:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setCameraError(
            'Camera permission blocked. Click the lock icon in the address bar -> Allow Camera -> Refresh.'
          );
        } else if (err.name === 'NotFoundError') {
          setCameraError('No camera device detected on this system.');
        } else {
          setCameraError(`Camera unavailable (${err.name || 'Error'}).`);
        }
        setCameraActive(false);
      }
    },
    [loadVideoDevices]
  );

  useEffect(() => {
    startCamera(selectedDeviceId);
  }, [selectedDeviceId, startCamera]);

  // Gyroscope / Compass orientation with screen angle compensation
  useEffect(() => {
    function handleOrientation(e) {
      if (!autoRotate) return;
      let alpha = e.alpha;
      if (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) {
        // iOS Safari gives compass heading relative to true north
        alpha = e.webkitCompassHeading;
      }
      if (alpha !== null && alpha !== undefined) {
        // Adjust for device screen orientation (landscape tablets vs portrait phones)
        const screenAngle = getScreenOrientationAngle();
        const adjustedHeading = (alpha + screenAngle + 360) % 360;

        setHeading((prev) => smoothAngle(prev, adjustedHeading, 0.18));
      }
    }

    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    } else if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation, true);
    }

    return () => {
      if ('ondeviceorientationabsolute' in window) {
        window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
      }
      if (window.DeviceOrientationEvent) {
        window.removeEventListener('deviceorientation', handleOrientation, true);
      }
    };
  }, [autoRotate]);

  // Function to take 1 physical step forward along route
  const advanceStep = useCallback(
    (stepMagnitude = null) => {
      if (!route || route.length < 2) return;
      const pointerCfg = getPointerConfig(deviceMode === 'tablet');
      const mag = stepMagnitude ?? pointerCfg.strideAdvance;
      setStepCount((c) => c + 1);
      setWalkProgress((prev) => Math.min(route.length - 1, prev + mag));
      setLastStepFeedback(true);
      setTimeout(() => setLastStepFeedback(false), 300);
    },
    [route, deviceMode]
  );

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
        console.warn('Motion permission request failed:', err);
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
      const rawAcc = e.accelerationIncludingGravity || e.acceleration;
      if (!rawAcc) return;

      const pointerCfg = getPointerConfig(deviceMode === 'tablet');

      // Filter linear acceleration by extracting gravity
      const linear = e.acceleration || filterLinearAcceleration(rawAcc, gravityRef.current, 0.82);
      const mag =
        linear.magnitude !== undefined
          ? linear.magnitude
          : Math.hypot(linear.x || 0, linear.y || 0, linear.z || 0);

      const delta = Math.abs(mag - lastMag);
      lastMag = mag;

      const now = Date.now();
      let threshold = pointerCfg.stepDeltaThreshold;
      if (pedometerSensitivity === 'high') threshold *= 0.65;
      if (pedometerSensitivity === 'low') threshold *= 1.45;

      const minInterval = deviceMode === 'tablet' ? 360 : 320;
      if (delta > threshold && now - lastStepTime > minInterval) {
        lastStepTime = now;
        setMotionSensorActive(true);
        advanceStep(pointerCfg.strideAdvance);
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
  }, [route, advanceStep, deviceMode, pedometerSensitivity]);

  // Voice Instruction triggers ONLY when physical step index advances
  useEffect(() => {
    if (voiceEnabled && currentStep) {
      speakInstruction(currentStep.text);
    }
  }, [currentStepIndex, voiceEnabled, currentStep]);

  // Rebuild Pointers helper (disposing old geometries to prevent GPU memory leaks)
  const rebuildPointers = useCallback((scene, isTablet) => {
    if (!scene) return;

    if (blueDotRef.current) {
      scene.remove(blueDotRef.current);
      blueDotRef.current.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material?.dispose();
        }
      });
      blueDotRef.current = null;
    }

    if (redDotRef.current) {
      scene.remove(redDotRef.current);
      redDotRef.current.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material?.dispose();
        }
      });
      redDotRef.current = null;
    }

    const cfg = getPointerConfig(isTablet);

    // 1. Initial / Walking Blue Pointer (matches bottom pin in user reference image)
    const blueData = createTeardropPin({
      height: cfg.pinHeight,
      width: cfg.pinWidth,
      holeRadius: cfg.holeRadius,
      depth: cfg.depth,
      shadowX: cfg.shadowRadiusX,
      shadowZ: cfg.shadowRadiusZ,
      leftColor: 0x0277bd,    // Deep royal blue (left half)
      rightColor: 0x03a9f4,   // Vibrant cyan-blue (right half)
      emissiveLeft: 0x01579b,
      emissiveRight: 0x0288d1,
    });
    scene.add(blueData.group);
    blueDotRef.current = blueData.group;
    startPartsRef.current = blueData;

    // 2. Destination Red Pointer (matches top pin in user reference image)
    const redData = createTeardropPin({
      height: cfg.pinHeight,
      width: cfg.pinWidth,
      holeRadius: cfg.holeRadius,
      depth: cfg.depth,
      shadowX: cfg.shadowRadiusX,
      shadowZ: cfg.shadowRadiusZ,
      leftColor: 0xc5222f,    // Deep crimson/burgundy (left half)
      rightColor: 0xef4444,   // Vibrant scarlet (right half)
      emissiveLeft: 0x991b1b,
      emissiveRight: 0xdc2626,
    });
    scene.add(redData.group);
    redDotRef.current = redData.group;
    destPartsRef.current = redData;
  }, []);

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
      antialias: true,
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
      roughness: 0.1,
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
      opacity: 0.85,
    });
    const arrowRing = new THREE.Mesh(arrowRingGeo, arrowRingMat);
    arrowRing.position.y = -0.3;
    arrowRing.frustumCulled = false;
    arrowGroup.add(arrowRing);

    arrowGroup.position.set(0, 0.9, -2.0);
    scene.add(arrowGroup);
    arrowMeshRef.current = arrowGroup;

    // 4. Build Start & Destination Pointers with device formatting
    rebuildPointers(scene, deviceMode === 'tablet');

    // 5. Continuous Glowing Floor Line Pathway Ribbon
    const pathGeometry = new THREE.BufferGeometry();
    const pathMaterial = new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x059669,
      emissiveIntensity: 0.95,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
      roughness: 0.2,
      depthWrite: false,
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
        arrowMeshRef.current.position.y = 0.85 + Math.sin(time * 3) * 0.08;
      }

      // Subtle floating bob for pins (matching physical ground drop shadow)
      const bob = Math.sin(time * 2.2) * 0.015;

      if (startPartsRef.current) {
        const { pinBody, shadowMesh, baseY, shadowBaseScaleX, shadowBaseScaleZ } = startPartsRef.current;
        if (pinBody) pinBody.position.y = baseY + bob;
        if (shadowMesh) {
          const s = 1.0 - bob * 2.5;
          shadowMesh.scale.set(shadowBaseScaleX * s, 1, shadowBaseScaleZ * s);
        }
      }

      if (destPartsRef.current) {
        const { pinBody, shadowMesh, baseY, shadowBaseScaleX, shadowBaseScaleZ } = destPartsRef.current;
        if (pinBody) pinBody.position.y = baseY + bob;
        if (shadowMesh) {
          const s = 1.0 - bob * 2.5;
          shadowMesh.scale.set(shadowBaseScaleX * s, 1, shadowBaseScaleZ * s);
        }
      }

      // Billboard pins to always face the camera eye horizontally (Y-axis billboarding)
      // This ensures the front face with the hole and needle tip always faces the user
      if (cameraThreeRef.current) {
        const camPos = cameraThreeRef.current.position;
        if (blueDotRef.current) {
          const dx = camPos.x - blueDotRef.current.position.x;
          const dz = camPos.z - blueDotRef.current.position.z;
          blueDotRef.current.rotation.y = Math.atan2(dx, dz);
        }
        if (redDotRef.current) {
          const dx = camPos.x - redDotRef.current.position.x;
          const dz = camPos.z - redDotRef.current.position.z;
          redDotRef.current.rotation.y = Math.atan2(dx, dz);
        }
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

      const tablet = isTabletDevice();
      setDeviceMode((prev) => {
        if (tablet && prev !== 'tablet') return 'tablet';
        if (!tablet && prev !== 'phone') return 'phone';
        return prev;
      });
    }
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
      renderer.dispose();
    };
  }, [rebuildPointers, deviceMode]);

  // Rebuild pointers when device formatting changes
  useEffect(() => {
    if (sceneRef.current) {
      rebuildPointers(sceneRef.current, deviceMode === 'tablet');
    }
  }, [deviceMode, rebuildPointers]);

  // Helper to transform map node (x, y) to 3D Camera relative position
  const transformToCameraSpace = useCallback((node, userPos, compassHeading) => {
    const scale = 0.05; // 1 map unit = 0.05 meters (~20px = 1m)
    const dx = (node.x - userPos.x) * scale;
    const dy = (node.y - userPos.y) * scale;

    const mapAngle = Math.atan2(dy, dx);
    const headingRad = ((compassHeading - 90) * Math.PI) / 180;
    const relAngle = mapAngle - headingRad;
    const dist = Math.hypot(dx, dy);

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
      y: n1.y + (n2.y - n1.y) * frac,
    };
  }, [route, walkProgress]);

  // Update 3D Path Line, Blue Dot, Red Dot, and Arrow on physical position / heading changes
  useEffect(() => {
    if (!route || route.length < 2) return;

    const userPos = getCurrentUserPos();
    const isTablet = deviceMode === 'tablet';
    const pointerCfg = getPointerConfig(isTablet);

    // Helper to calculate 2D map position at fractional progress along route
    const getRoutePosAtProgress = (progress) => {
      if (!route || route.length === 0) return { x: 0, y: 0 };
      if (route.length === 1) return { x: route[0].x, y: route[0].y };

      const idx = Math.min(Math.floor(progress), route.length - 2);
      const frac = progress - idx;
      const n1 = route[idx];
      const n2 = route[idx + 1] || n1;

      return {
        x: n1.x + (n2.x - n1.x) * frac,
        y: n1.y + (n2.y - n1.y) * frac,
      };
    };

    // 1. Position Blue Pointer (Initial pointer that moves as we walk along our path)
    if (blueDotRef.current && route.length > 0) {
      // Guide position along pathway ribbon (advances ahead as the user walks)
      const blueTargetProgress = Math.min(
        route.length - 1,
        walkProgress + (walkProgress < route.length - 1 ? pointerCfg.guideAdvanceOffset : 0)
      );
      const bluePos2D = getRoutePosAtProgress(blueTargetProgress);
      const pos3d = transformToCameraSpace(bluePos2D, userPos, heading);
      blueDotRef.current.position.set(pos3d.x, 0, pos3d.z);

      const s = pointerCfg.scale;
      blueDotRef.current.scale.set(s, s, s);
    }

    // 2. Position Red Pointer (Fixed at final destination)
    if (redDotRef.current && route[route.length - 1]) {
      const destNode = route[route.length - 1];
      const pos3d = transformToCameraSpace(destNode, userPos, heading);
      redDotRef.current.position.set(pos3d.x, 0, pos3d.z);

      const s = pointerCfg.scale;
      redDotRef.current.scale.set(s, s, s);
    }

    // 3. Point Floating 3D Turn Arrow towards Next Waypoint
    const nextNodeIdx = Math.min(Math.floor(walkProgress) + 1, route.length - 1);
    const nextNode = route[nextNodeIdx];
    if (arrowMeshRef.current && nextNode) {
      const pos3d = transformToCameraSpace(nextNode, userPos, heading);
      const angleRad = Math.atan2(pos3d.x, -pos3d.z);
      arrowMeshRef.current.rotation.y = angleRad;

      const arrowDist = 2.0; // Fixed distance in front of camera
      const maxClampedX = pointerCfg.arrowMaxX;
      const targetX = Math.sin(angleRad) * arrowDist;
      const clampedX = Math.max(-maxClampedX, Math.min(maxClampedX, targetX));

      arrowMeshRef.current.position.x = clampedX;
      arrowMeshRef.current.position.z = -Math.cos(angleRad) * arrowDist;

      const arrowScale = isTablet ? 1.15 : 0.85;
      arrowMeshRef.current.scale.set(arrowScale, arrowScale, arrowScale);
    }

    // 4. Generate Continuous 3D Floor Pathway Ribbon Mesh (All Route Nodes)
    if (pathLineRef.current) {
      const ribbonWidth = pointerCfg.ribbonWidth;
      const vertices = [];
      const indices = [];

      for (let i = 0; i < route.length; i++) {
        const p3d = transformToCameraSpace(route[i], userPos, heading);

        // Compute tangent direction for ribbon thickness
        let perpX = 1,
          perpZ = 0;
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

        const yPos = 0.08; // Raised slightly above floor ground plane (reticle rings are at 0.04 - 0.05)
        vertices.push(
          p3d.x - perpX * ribbonWidth,
          yPos,
          p3d.z - perpZ * ribbonWidth,
          p3d.x + perpX * ribbonWidth,
          yPos,
          p3d.z + perpZ * ribbonWidth
        );
      }

      for (let i = 0; i < route.length - 1; i++) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2);
        indices.push(base + 2, base + 1, base + 3);
      }

      if (vertices.length >= 6) {
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
  }, [route, walkProgress, heading, transformToCameraSpace, getCurrentUserPos, deviceMode]);

  // Launch Google ARCore WebXR session with Three.js XR binding
  const launchWebXR = async () => {
    if (!navigator.xr || !rendererRef.current) return;
    try {
      rendererRef.current.xr.enabled = true;
      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'dom-overlay'],
        optionalFeatures: ['local-floor', 'bounded-floor'],
        domOverlay: { root: containerRef.current },
      });
      await rendererRef.current.xr.setSession(session);
      setXrSessionActive(true);

      // WebXR Frame Render Loop
      rendererRef.current.setAnimationLoop((timestamp, frame) => {
        if (!xrSessionActive) return;
        rendererRef.current.render(sceneRef.current, cameraThreeRef.current);
      });

      session.addEventListener('end', () => {
        setXrSessionActive(false);
        if (rendererRef.current) {
          rendererRef.current.xr.enabled = false;
          rendererRef.current.setAnimationLoop(null);
        }
      });
    } catch (err) {
      console.warn('WebXR AR session failed:', err);
      alert('Native ARCore session failed or device is not compatible. Continuing in Camera AR mode.');
    }
  };

  const isArrived = walkProgress >= route.length - 1;


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

      {/* 3D Compass Dial Overlay (Tap to re-zero heading) */}
      <div
        className="ar-compass-overlay"
        onClick={() => setHeading(0)}
        title="Tap to re-zero compass heading"
      >
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
                const uPos = getCurrentUserPos();
                const rx = 50 + (n.x - uPos.x) * 0.12;
                const ry = 50 + (n.y - uPos.y) * 0.12;
                return `${rx},${ry}`;
              }).join(" ")}
              fill="none"
              stroke="#34d399"
              strokeWidth="2.5"
              strokeDasharray="4 2"
            />
          )}

          {/* Moving Guide Pointer (Blue Dot - moves as we walk) */}
          {route.length > 0 && (
            <circle
              cx={(() => {
                const uPos = getCurrentUserPos();
                const pCfg = getPointerConfig(deviceMode === 'tablet');
                const tProg = Math.min(
                  route.length - 1,
                  walkProgress + (walkProgress < route.length - 1 ? pCfg.guideAdvanceOffset : 0)
                );
                const idx = Math.min(Math.floor(tProg), route.length - 2);
                const frac = tProg - idx;
                const n1 = route[idx];
                const n2 = route[idx + 1] || n1;
                const bx = n1.x + (n2.x - n1.x) * frac;
                return 50 + (bx - uPos.x) * 0.12;
              })()}
              cy={(() => {
                const uPos = getCurrentUserPos();
                const pCfg = getPointerConfig(deviceMode === 'tablet');
                const tProg = Math.min(
                  route.length - 1,
                  walkProgress + (walkProgress < route.length - 1 ? pCfg.guideAdvanceOffset : 0)
                );
                const idx = Math.min(Math.floor(tProg), route.length - 2);
                const frac = tProg - idx;
                const n1 = route[idx];
                const n2 = route[idx + 1] || n1;
                const by = n1.y + (n2.y - n1.y) * frac;
                return 50 + (by - uPos.y) * 0.12;
              })()}
              r="4.2"
              fill="#0284c7"
              stroke="#ffffff"
              strokeWidth="1.5"
            />
          )}

          {/* Destination Node (Red Dot) */}
          {route[route.length - 1] && (
            <circle
              cx={(() => {
                const uPos = getCurrentUserPos();
                const dest = route[route.length - 1];
                return 50 + (dest.x - uPos.x) * 0.12;
              })()}
              cy={(() => {
                const uPos = getCurrentUserPos();
                const dest = route[route.length - 1];
                return 50 + (dest.y - uPos.y) * 0.12;
              })()}
              r="4.8"
              fill="#f43f5e"
              stroke="#ffffff"
              strokeWidth="1.8"
            />
          )}

          {/* Current Live User Position (Center) */}
          <circle cx="50" cy="50" r="3.5" fill="#38bdf8" stroke="#ffffff" strokeWidth="1.5" />
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
              onClick={() => advanceStep()}
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

            {/* Pedometer Sensitivity Cycle */}
            <button
              type="button"
              className={`hud-icon-btn ${pedometerSensitivity === 'high' ? 'active' : ''}`}
              onClick={() => {
                setPedometerSensitivity((s) => (s === 'normal' ? 'high' : s === 'high' ? 'low' : 'normal'));
              }}
              title={`Step Sensitivity: ${pedometerSensitivity.toUpperCase()} (Tap to change: Normal / High / Low)`}
            >
              ⚡ {pedometerSensitivity === 'high' ? 'High Sens' : pedometerSensitivity === 'low' ? 'Low Sens' : 'Sens'}
            </button>

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
