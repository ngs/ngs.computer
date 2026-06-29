import "./style.css";
import "./font.css";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  OrthographicCamera,
  Points,
  Quaternion,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from "three";
import {
  DAMPING,
  EASE,
  FONT_FAMILY,
  INTERVAL,
  KANJI,
  MIN_RANDOM_BETWEEN,
  PARTICLE_FLOW_SPEED,
  REVEAL_CHANCE,
  REVEAL_HOLD_MULT,
  TARGET_SIZE,
} from "./config";
import type { BBox, Loop } from "./marchingSquares";
import { extractContours } from "./marchingSquares";
import type { ParticleField } from "./positions";
import { buildParticleField, buildPositions } from "./positions";
import { PATTERNS } from "./patterns";
import { rasterizeKanji } from "./rasterize";
import { mountLogo } from "./logo";

// Replace the status link's "*" placeholder with the inline SVG logo.
mountLogo();

// ===== 4) Three.js setup =====
const appElement = document.getElementById("app");
if (!appElement) throw new Error("#app was not found");
// Typed const so the narrowing survives inside the closures below.
const app: HTMLElement = appElement;

const renderer = new WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
app.appendChild(renderer.domElement);

const scene = new Scene();

let camera: OrthographicCamera;
function makeCamera(): void {
  const aspect = app.clientWidth / app.clientHeight;
  const f = TARGET_SIZE * 1.32;
  camera = new OrthographicCamera(
    (-f * aspect) / 2,
    (f * aspect) / 2,
    f / 2,
    -f / 2,
    0.1,
    1000,
  );
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
}
makeCamera();

const group = new Group();
scene.add(group);

const darkMQ = window.matchMedia("(prefers-color-scheme: dark)");
const lineColor = (): number => (darkMQ.matches ? 0xf3efe6 : 0x13110f); // dark:white / light:ink

// Round-dot point material; per-vertex `size` drives the halftone look, and the
// ortho camera keeps point sizes constant in screen space (so sizes come purely
// from the attribute, not depth foreshortening).
const pointMat = new ShaderMaterial({
  uniforms: {
    uColor: { value: new Color(lineColor()) },
    uPixelRatio: { value: renderer.getPixelRatio() },
  },
  vertexShader: /* glsl */ `
    attribute float size;
    uniform float uPixelRatio;
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * uPixelRatio;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    void main() {
      vec2 c = gl_PointCoord - vec2(0.5);
      if (dot(c, c) > 0.25) discard; // clip the square sprite into a disc
      gl_FragColor = vec4(uColor, 1.0);
    }
  `,
  transparent: true,
});

let lineMesh: LineSegments | null = null;
let pointMesh: Points | null = null;
// Follow the OS dark/light switch.
darkMQ.addEventListener("change", () => {
  const c = lineColor();
  if (lineMesh) (lineMesh.material as LineBasicMaterial).color.setHex(c);
  (pointMat.uniforms.uColor.value as Color).setHex(c);
});

// Kept around so we can re-scatter into a different pattern without re-rasterizing.
let contourLoops: Loop[] | null = null;
let contourBBox: BBox | null = null;
let patternIndex = 0;

// Active flowing dot field (only while the particle pattern is showing).
let particleField: ParticleField | null = null;
let flow = 0; // accumulated flow offset (sample-steps)

async function buildKanji(): Promise<void> {
  // Make sure the requested web-font glyphs are loaded before rasterizing
  // (otherwise it bakes in whatever fallback font is loaded at that moment).
  try {
    await document.fonts.load(`900 380px ${FONT_FAMILY}`, KANJI);
    await document.fonts.ready;
  } catch {
    /* fall back to a system font on failure */
  }

  const img = rasterizeKanji(KANJI);
  const { loops, bbox } = extractContours(img);
  if (!bbox) return;
  contourLoops = loops;
  contourBBox = bbox;

  lineMesh = new LineSegments(
    new BufferGeometry(),
    new LineBasicMaterial({ color: lineColor() }),
  );
  pointMesh = new Points(new BufferGeometry(), pointMat);
  group.add(lineMesh, pointMesh);

  renderPattern(PATTERNS[patternIndex]);
}
void buildKanji();

// Rebuild the active geometry for `pattern` and show the matching primitive
// (line segments or the dot field). Called head-on at "正体", where the ortho
// view collapses Z, so the swap stays invisible until the glyph tilts away.
function renderPattern(pattern: (typeof PATTERNS)[number]): void {
  if (!lineMesh || !pointMesh || !contourLoops || !contourBBox) return;
  if (pattern.mode === "points") {
    particleField = buildParticleField(contourLoops, contourBBox, pattern);
    const geo = pointMesh.geometry;
    // BufferAttribute wraps the field's array, so per-frame update()s show up.
    geo.setAttribute(
      "position",
      new BufferAttribute(particleField.positions, 3),
    );
    geo.setAttribute("size", new BufferAttribute(particleField.sizes, 1));
  } else {
    particleField = null;
    const positions = buildPositions(contourLoops, contourBBox, pattern);
    lineMesh.geometry.setAttribute(
      "position",
      new BufferAttribute(positions, 3),
    );
  }
  lineMesh.visible = pattern.mode !== "points";
  pointMesh.visible = pattern.mode === "points";
}

// Advance to the next pattern (one step per "正体" reveal).
function advancePattern(): void {
  patternIndex = (patternIndex + 1) % PATTERNS.length;
  renderPattern(PATTERNS[patternIndex]);
}

function resize(): void {
  const w = app.clientWidth;
  const h = app.clientHeight;
  renderer.setSize(w, h);
  const aspect = w / h;
  const f = TARGET_SIZE * 1.32;
  camera.left = (-f * aspect) / 2;
  camera.right = (f * aspect) / 2;
  camera.top = f / 2;
  camera.bottom = -f / 2;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ===== 5) Angle control =====
const targetQuat = new Quaternion(); // target of the auto transition
function randomQuat(): Quaternion {
  return new Quaternion().random(); // uniformly random orientation
}

let autoMode = true;
let nextSwitch = performance.now() + INTERVAL;
let lastInteract = -1e9;
let sinceReveal = 0; // random angles shown since the last "正体" reveal
let leavingReveal = false; // next switch follows a reveal -> re-scatter on the way out

// World-space angular velocity (radians/frame) carried over from dragging, so
// releasing keeps a monotonically-decaying glide (no overshoot, no bounce).
const spin = new Vector3();
const tmpAxis = new Vector3();
const tmpQuat = new Quaternion();

// Start scattered and drift to another random angle (no "正体" reveal on load).
group.quaternion.copy(randomQuat());
targetQuat.copy(randomQuat());

// Returns how long to hold this target before switching again (ms).
function pickTarget(): number {
  // Leaving a reveal: break the glyph apart with a fresh pattern as it tilts off.
  if (leavingReveal) {
    leavingReveal = false;
    advancePattern();
  }

  // Only allow a reveal once enough random angles have passed since the last one.
  if (sinceReveal >= MIN_RANDOM_BETWEEN && Math.random() < REVEAL_CHANCE) {
    targetQuat.identity(); // settle on the readable "正体"
    sinceReveal = 0;
    leavingReveal = true; // next switch re-scatters
    return INTERVAL * REVEAL_HOLD_MULT; // linger longer while it's readable
  }
  targetQuat.copy(randomQuat()); // a fully random orientation
  sinceReveal++;
  return INTERVAL;
}

// Apply the angular velocity to the orientation, then bleed it off (inertia).
function integrateSpin(): void {
  const angle = spin.length();
  if (angle > 1e-6) {
    tmpAxis.copy(spin).multiplyScalar(1 / angle);
    group.quaternion.premultiply(tmpQuat.setFromAxisAngle(tmpAxis, angle));
  }
  spin.multiplyScalar(DAMPING);
}

// Drag interaction (shared between mouse and touch).
let dragging = false;
let lastX = 0;
let lastY = 0;
const SPEED = 0.01;
app.addEventListener("pointerdown", (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  app.classList.add("dragging");
  app.setPointerCapture(e.pointerId);
  interact();
});
app.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  const qy = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    dx * SPEED,
  );
  const qx = new Quaternion().setFromAxisAngle(
    new Vector3(1, 0, 0),
    dy * SPEED,
  );
  group.quaternion.premultiply(qy).premultiply(qx); // rotate in world space
  // Remember the step as angular velocity, so releasing keeps the momentum.
  spin.set(dy * SPEED, dx * SPEED, 0);
  interact();
});
function endDrag(): void {
  dragging = false;
  app.classList.remove("dragging");
}
app.addEventListener("pointerup", endDrag);
app.addEventListener("pointercancel", endDrag);

function interact(): void {
  autoMode = false;
  lastInteract = performance.now();
}

// ===== 6) Loop =====
let lastFrame = performance.now();
function tick(): void {
  const now = performance.now();
  const dt = Math.min(now - lastFrame, 100) / 1000; // seconds, clamped after stalls
  lastFrame = now;

  // Interaction stopped and INTERVAL elapsed -> resume auto (force the next angle).
  if (!autoMode && now - lastInteract > INTERVAL) {
    autoMode = true;
    nextSwitch = now; // pick the next target immediately
  }

  // Stream the particle dots along their contours while the dot field is showing.
  if (particleField && pointMesh?.visible) {
    flow += PARTICLE_FLOW_SPEED * dt;
    particleField.update(flow);
    pointMesh.geometry.attributes.position.needsUpdate = true;
  }

  // While dragging, the pointer moves the model directly. Otherwise auto mode
  // eases toward the target (no overshoot), and a freshly released drag keeps
  // gliding on its leftover momentum until it decays.
  if (!dragging) {
    if (autoMode) {
      if (now >= nextSwitch) {
        nextSwitch = now + pickTarget();
      }
      group.quaternion.slerp(targetQuat, EASE); // gentle ease-in, never overshoots
    } else {
      integrateSpin(); // post-drag inertia
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
