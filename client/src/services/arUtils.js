/**
 * arUtils.js
 *
 * AR Vector math, camera transformation, compass bearing, and turn calculations
 * for WebAR / Google ARCore indoor navigation.
 */

export const SCALE_METERS = 0.05; // 1 pixel unit = 0.05 meters (~20 px = 1 meter)

/**
 * Calculates bearing angle in degrees (0 to 360) from node A to node B
 */
export function calculateBearing(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  // Canvas Y grows downward, so angle calculation accounts for SVG/Canvas orient
  let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angleDeg < 0) angleDeg += 360;
  return angleDeg;
}

/**
 * Calculates turn angle difference from bearing1 to bearing2 (-180 to +180 deg)
 * Positive: Turn Right, Negative: Turn Left
 */
export function calculateTurnAngle(bearing1, bearing2) {
  let diff = (bearing2 - bearing1 + 540) % 360 - 180;
  return diff;
}

/**
 * Transform 2D node coordinates relative to user position & device heading
 * into 3D camera relative coordinates [X, Y, Z] for Three.js
 */
export function nodeTo3DPosition(userNode, targetNode, headingDeg = 0) {
  const dx = (targetNode.x - userNode.x) * SCALE_METERS;
  const dy = (targetNode.y - userNode.y) * SCALE_METERS;

  // Convert heading to radians (0 deg = North / forward)
  const rad = (headingDeg * Math.PI) / 180;
  
  // Rotate world delta by user heading
  const relX = dx * Math.cos(rad) - dy * Math.sin(rad);
  const relZ = -(dx * Math.sin(rad) + dy * Math.cos(rad)); // Z negative is forward in Three.js

  return {
    x: relX,
    y: 0.12, // Slightly elevated ground level
    z: relZ,
    distanceMeters: Math.hypot(dx, dy),
  };
}

/**
 * Transforms route waypoints into Camera-Forward Relative 3D Space (X, Y, Z)
 * This guarantees the ribbon path is ALWAYS anchored directly in front of the camera
 * (extending forward along -Z) so the user never has to search around for the path!
 * 
 * If route is empty or has < 2 nodes, provides a smooth 12-meter forward preview ribbon.
 */
export function transformRouteToCameraPath(route, userPos, walkProgress = 0) {
  const RIBBON_Y = 0.12; // Elevated above floor to avoid clipping & z-fighting

  // Fallback demo/preview path if no active route is loaded yet
  if (!route || route.length < 2) {
    const previewPoints = [];
    for (let z = 0.5; z <= 12.0; z += 0.8) {
      previewPoints.push({ x: 0, y: RIBBON_Y, z: -z, distance: z });
    }
    return previewPoints;
  }

  const currIdx = Math.min(Math.floor(walkProgress), route.length - 2);
  const nextIdx = currIdx + 1;
  const nCurr = route[currIdx];
  const nNext = route[nextIdx];

  // Base forward heading of current active corridor segment (in radians)
  const forwardAngle = Math.atan2(nNext.y - nCurr.y, nNext.x - nCurr.x);

  const points3D = [];
  // 1. Initial point right at user's feet in front of camera
  points3D.push({ x: 0, y: RIBBON_Y, z: -0.5, distance: 0 });

  // 2. Distance from current user position to the next waypoint along active segment
  const dxNext = (nNext.x - userPos.x) * SCALE_METERS;
  const dyNext = (nNext.y - userPos.y) * SCALE_METERS;
  const distNext = Math.max(0.4, Math.hypot(dxNext, dyNext));

  // Subdivide straight forward along -Z to next waypoint
  const stepSize = 0.8;
  for (let d = stepSize; d < distNext; d += stepSize) {
    points3D.push({ x: 0, y: RIBBON_Y, z: -(d + 0.5), distance: d });
  }

  // Next corner waypoint in camera coordinates
  let currentCameraPos = {
    x: 0,
    y: RIBBON_Y,
    z: -(distNext + 0.5),
  };
  points3D.push({ ...currentCameraPos, distance: distNext });

  // 3. Chain subsequent route turns and segments
  let accDistance = distNext;
  for (let i = nextIdx; i < route.length - 1; i++) {
    const nodeA = route[i];
    const nodeB = route[i + 1];

    const segDx = (nodeB.x - nodeA.x) * SCALE_METERS;
    const segDy = (nodeB.y - nodeA.y) * SCALE_METERS;
    const segLen = Math.hypot(segDx, segDy);
    if (segLen <= 0.01) continue;

    const segAngle = Math.atan2(segDy, segDx);
    const relTurn = segAngle - forwardAngle;

    // Unit direction in camera space: +X is right, -X is left, -Z is forward
    const ux = Math.sin(relTurn);
    const uz = -Math.cos(relTurn);

    // Subdivide this segment
    const numSteps = Math.max(1, Math.round(segLen / stepSize));
    for (let s = 1; s <= numSteps; s++) {
      const frac = s / numSteps;
      const stepDist = segLen * frac;
      const pt = {
        x: currentCameraPos.x + ux * stepDist,
        y: RIBBON_Y,
        z: currentCameraPos.z + uz * stepDist,
        distance: accDistance + stepDist,
      };
      points3D.push(pt);
    }

    currentCameraPos = {
      x: currentCameraPos.x + ux * segLen,
      y: RIBBON_Y,
      z: currentCameraPos.z + uz * segLen,
    };
    accDistance += segLen;
  }

  return points3D;
}

/**
 * Procedural Dynamic Canvas Texture for 3D Floor Navigation Ribbon
 * Features luminous glowing neon edges and high-contrast streaming forward motion chevrons (>>>)
 */
export function createRibbonTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  if (!ctx) return null;

  // 1. High-contrast luminous background:
  // Radiant cyan to turquoise gradient with rich opacity so it never fades into dark or bright floors
  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, 'rgba(14, 165, 233, 0.7)');     // Deep Sky Blue edge
  grad.addColorStop(0.12, 'rgba(56, 189, 248, 0.95)');  // Bright Cyan inner rail
  grad.addColorStop(0.5, 'rgba(52, 211, 153, 0.98)');   // Emerald Neon core
  grad.addColorStop(0.88, 'rgba(56, 189, 248, 0.95)');  // Bright Cyan inner rail
  grad.addColorStop(1, 'rgba(14, 165, 233, 0.7)');     // Deep Sky Blue edge
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 512);

  // 2. Solid glowing neon white outer rails
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 10, 512);
  ctx.fillRect(246, 0, 10, 512);

  // 3. Inner neon cyan accent lines
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(14, 0, 4, 512);
  ctx.fillRect(238, 0, 4, 512);

  // 4. Crisp White Streaming Chevrons (>>>)
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#00f5ff';
  ctx.shadowBlur = 12;

  for (let y = 64; y < 512; y += 128) {
    ctx.beginPath();
    ctx.moveTo(128, y - 48); // Sharp Tip pointing forward (-Z)
    ctx.lineTo(215, y + 22);
    ctx.lineTo(185, y + 22);
    ctx.lineTo(128, y - 18);
    ctx.lineTo(71, y + 22);
    ctx.lineTo(41, y + 22);
    ctx.closePath();
    ctx.fill();
  }

  return canvas;
}

/**
 * Text-to-Speech voice prompt helper for AR guidance
 */
export function speakInstruction(text) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel(); // stop previous speech
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.warn("Speech synthesis unavailable:", e);
  }
}

/**
 * Formats turn direction icons / labels
 */
export function getActionIconSvg(action) {
  switch (action) {
    case 'TURN_LEFT':
    case 'SLIGHT_LEFT':
    case 'SHARP_LEFT':
      return '⬅️';
    case 'TURN_RIGHT':
    case 'SLIGHT_RIGHT':
    case 'SHARP_RIGHT':
      return '➡️';
    case 'LIFT':
      return '🛗';
    case 'STAIRS':
      return '🪜';
    case 'ARRIVED':
      return '🎯';
    default:
      return '⬆️';
  }
}

/**
 * Detects whether the current device is a tablet/iPad form factor.
 * Detects iPadOS Safari (which presents as Macintosh with touch points),
 * Android tablets, and tablet screen dimensions automatically.
 */
export function isTabletDevice() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIPad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const isAndroidTablet = /Android/i.test(ua) && !/Mobile/i.test(ua);

  const width = window.innerWidth || 0;
  const height = window.innerHeight || 0;
  const minDim = Math.min(width, height);
  const maxDim = Math.max(width, height);
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  const isTabletDimensions = minDim >= 600 && maxDim >= 900;
  const isTabletWidth = width >= 768 && isTouch;

  return isIPad || isAndroidTablet || isTabletDimensions || isTabletWidth;
}

/**
 * Provides responsive pointer geometry dimensions, heights, and scales
 * for the dual-tone teardrop location pins, sized specifically for Phone vs. Tablet/iPad
 * so the ground pathway ribbon remains unobstructed and perfectly visible.
 */
export function getPointerConfig(isTablet = false) {
  if (isTablet) {
    return {
      isTablet: true,
      scale: 1.0,
      // Teardrop Pin Dimensions for Tablet / iPad (compact, sleek, clear circular hole)
      pinHeight: 0.48,
      pinWidth: 0.28,
      holeRadius: 0.075,
      depth: 0.03,
      shadowRadiusX: 0.14,
      shadowRadiusZ: 0.065,
      // Arrow FOV clamp for tablet's wider screen
      arrowMaxX: 1.15,
      // Ribbon width on tablet floor
      ribbonWidth: 0.42,
      // Pedometer sensor parameters
      stepDeltaThreshold: 1.8,
      strideAdvance: 0.14,
      // Distance lookahead along path for moving blue guide pin (~1.5m ahead)
      guideAdvanceOffset: 0.35,
    };
  }

  // Mobile Phone Configuration (decreased compact size, completely non-blocking)
  return {
    isTablet: false,
    scale: 0.85,
    // Teardrop Pin Dimensions for Phone (decreased size so floor ribbon is 100% visible)
    pinHeight: 0.36,
    pinWidth: 0.21,
    holeRadius: 0.055,
    depth: 0.022,
    shadowRadiusX: 0.10,
    shadowRadiusZ: 0.045,
    // Arrow FOV clamp for phone portrait
    arrowMaxX: 0.65,
    // Ribbon width on phone floor
    ribbonWidth: 0.32,
    // Pedometer sensor parameters
    stepDeltaThreshold: 2.4,
    strideAdvance: 0.12,
    // Distance lookahead along path for moving blue guide pin (~1.2m ahead)
    guideAdvanceOffset: 0.28,
  };
}

/**
 * Calculates smoothed angle handling 360-degree boundary wrap
 */
export function smoothAngle(current, target, factor = 0.18) {
  const diff = (target - current + 540) % 360 - 180;
  return (current + diff * factor + 360) % 360;
}

/**
 * Returns screen orientation angle in degrees (0, 90, 180, 270)
 * to adjust gyroscope compass heading for phone/tablet orientation.
 */
export function getScreenOrientationAngle() {
  if (typeof window === 'undefined') return 0;
  if (window.screen?.orientation?.angle !== undefined) {
    return window.screen.orientation.angle;
  }
  if (typeof window.orientation === 'number') {
    return window.orientation;
  }
  return 0;
}

/**
 * Low-pass gravity filter to isolate dynamic linear acceleration from raw acceleration
 */
export function filterLinearAcceleration(raw, gravityState, alpha = 0.8) {
  if (!raw) return { x: 0, y: 0, z: 0, magnitude: 0 };
  
  // Extract gravity component
  gravityState.x = alpha * gravityState.x + (1 - alpha) * (raw.x || 0);
  gravityState.y = alpha * gravityState.y + (1 - alpha) * (raw.y || 0);
  gravityState.z = alpha * gravityState.z + (1 - alpha) * (raw.z || 0);

  // Linear acceleration = raw - gravity
  const lx = (raw.x || 0) - gravityState.x;
  const ly = (raw.y || 0) - gravityState.y;
  const lz = (raw.z || 0) - gravityState.z;
  const mag = Math.hypot(lx, ly, lz);

  return { x: lx, y: ly, z: lz, magnitude: mag };
}

