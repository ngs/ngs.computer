import "./style.css";
import "./font.css";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  OrthographicCamera,
  Quaternion,
  Scene,
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
  REVEAL_CHANCE,
  TARGET_SIZE,
} from "./config";
import { extractContours } from "./marchingSquares";
import { buildPositions } from "./positions";
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
let lineMesh: LineSegments | null = null;
// Follow the OS dark/light switch.
darkMQ.addEventListener("change", () => {
  if (lineMesh)
    (lineMesh.material as LineBasicMaterial).color.setHex(lineColor());
});

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
  const positions = buildPositions(loops, bbox);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  const mat = new LineBasicMaterial({ color: lineColor() });
  lineMesh = new LineSegments(geo, mat);
  group.add(lineMesh);
}
void buildKanji();

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

// World-space angular velocity (radians/frame) carried over from dragging, so
// releasing keeps a monotonically-decaying glide (no overshoot, no bounce).
const spin = new Vector3();
const tmpAxis = new Vector3();
const tmpQuat = new Quaternion();

// Start scattered and drift to another random angle (no "正体" reveal on load).
group.quaternion.copy(randomQuat());
targetQuat.copy(randomQuat());

function pickTarget(): void {
  // Only allow a reveal once enough random angles have passed since the last one.
  if (sinceReveal >= MIN_RANDOM_BETWEEN && Math.random() < REVEAL_CHANCE) {
    targetQuat.identity(); // settle on the readable "正体"
    sinceReveal = 0;
  } else {
    targetQuat.copy(randomQuat()); // a fully random orientation
    sinceReveal++;
  }
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
function tick(): void {
  const now = performance.now();

  // Interaction stopped and INTERVAL elapsed -> resume auto (force the next angle).
  if (!autoMode && now - lastInteract > INTERVAL) {
    autoMode = true;
    nextSwitch = now; // pick the next target immediately
  }

  // While dragging, the pointer moves the model directly. Otherwise auto mode
  // eases toward the target (no overshoot), and a freshly released drag keeps
  // gliding on its leftover momentum until it decays.
  if (!dragging) {
    if (autoMode) {
      if (now >= nextSwitch) {
        pickTarget();
        nextSwitch = now + INTERVAL;
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
