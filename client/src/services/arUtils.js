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
    y: 0, // Ground level
    z: relZ,
    distanceMeters: Math.hypot(dx, dy),
  };
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

