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
  CLOCK_SCALE,
  FONT_FAMILY,
  INTERVAL,
  KANJI,
  MAX_TEXT_LENGTH,
  MIN_RANDOM_BETWEEN,
  MORPH_BURST,
  MORPH_DURATION,
  MORPH_SETTLE,
  PARTICLE_FLOW_SPEED,
  REVEAL_CHANCE,
  REVEAL_HOLD_MULT,
  TARGET_SIZE,
} from "./config";
import type { BBox, Loop } from "./marchingSquares";
import { extractContours } from "./marchingSquares";
import { loadRemoteFont } from "./loadFont";
import type { ParticleField } from "./positions";
import { buildParticleField, buildPositions } from "./positions";
import type { ZFn } from "./patterns";
import { PATTERNS } from "./patterns";
import type { TextLine } from "./rasterize";
import { rasterizeKanji } from "./rasterize";
import { mountLogo } from "./logo";

const params = new URLSearchParams(location.search);

// Base string to render: `?text=` overrides the default, capped in length.
function resolveBaseText(): string {
  const raw = params.get("text");
  if (!raw) return KANJI;
  const text = Array.from(raw.trim()).slice(0, MAX_TEXT_LENGTH).join("");
  return text || KANJI;
}
const baseText = resolveBaseText();

// `?now=1` appends a live, second-resolution clock on a new line.
const showClock = params.has("now") && params.get("now") !== "0";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function nowString(): string {
  const d = new Date();
  const date = `${String(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return `${date} ${time}`;
}

// The lines to rasterize right now (base, plus the smaller clock line if on).
function currentLines(): TextLine[] {
  const lines: TextLine[] = [{ text: baseText, scale: 1 }];
  if (showClock) lines.push({ text: nowString(), scale: CLOCK_SCALE });
  return lines;
}

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

// Transparent so it can fade through alpha 0 at a morph's swap point.
const lineMat = new LineBasicMaterial({
  color: lineColor(),
  transparent: true,
});

// Round-dot point material; per-vertex `size` drives the halftone look, and the
// ortho camera keeps point sizes constant in screen space (so sizes come purely
// from the attribute, not depth foreshortening). `uAlpha` fades the dots in/out
// during a morph (0 at the swap point, 1 when settled).
const pointMat = new ShaderMaterial({
  uniforms: {
    uColor: { value: new Color(lineColor()) },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uAlpha: { value: 1 },
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
    uniform float uAlpha;
    void main() {
      vec2 c = gl_PointCoord - vec2(0.5);
      if (dot(c, c) > 0.25) discard; // clip the square sprite into a disc
      gl_FragColor = vec4(uColor, uAlpha);
    }
  `,
  transparent: true,
});

// Set a primitive's opacity (line uses material.opacity, dots use uAlpha).
function setMorphAlpha(isPoints: boolean, a: number): void {
  if (isPoints) pointMat.uniforms.uAlpha.value = a;
  else lineMat.opacity = a;
}

let lineMesh: LineSegments | null = null;
let pointMesh: Points | null = null;
// Follow the OS dark/light switch.
darkMQ.addEventListener("change", () => {
  const c = lineColor();
  lineMat.color.setHex(c);
  (pointMat.uniforms.uColor.value as Color).setHex(c);
});

// Kept around so we can re-scatter into a different pattern without re-rasterizing.
let contourLoops: Loop[] | null = null;
let contourBBox: BBox | null = null;
// Randomize which breakup shows first; it alternates from there on each reveal.
let patternIndex = Math.floor(Math.random() * PATTERNS.length);

// Active flowing dot field (only while the particle pattern is showing).
let particleField: ParticleField | null = null;
let flow = 0; // accumulated flow offset (sample-steps)

// The depth arrangement currently in use for each primitive. Reused across
// clock rebuilds so only the glyphs change, not the scatter layout.
let lineZ: ZFn | null = null;
let dotsZ: ZFn | null = null;

// Front→front morph: the current breakup explodes into a cloud, swaps primitive
// at peak chaos (hiding the line↔dot geometry change), then reassembles.
interface BurstLayer {
  isPoints: boolean;
  base: Float32Array; // readable positions (burst == 0)
  dirs: Float32Array; // per-vertex outward offset in the screen plane
  live: Float32Array; // the array bound to the mesh
  apply(burst: number): void;
}
let morphActive = false;
let morphStart = 0;
let morphSwapped = false; // crossed the midpoint primitive swap yet?
let morphFrom: BurstLayer | null = null; // explodes outward (first half)
let morphTo: BurstLayer | null = null; // reassembles (second half)
let showingPoints = false; // which primitive is the current steady display

// A vertex buffer that bursts outward along fixed random directions and back.
function makeBurstLayer(
  base: Float32Array,
  isPoints: boolean,
  live?: Float32Array,
): BurstLayer {
  const n = base.length / 3;
  const dirs = new Float32Array(base.length);
  // Line vertices come in segment pairs; move both endpoints together so each
  // fragment flies out intact instead of stretching into a streak.
  const stride = isPoints ? 1 : 2;
  for (let i = 0; i < n; i += stride) {
    const a = Math.random() * Math.PI * 2;
    const r = (0.35 + Math.random() * 0.65) * MORPH_BURST;
    const dx = Math.cos(a) * r;
    const dy = Math.sin(a) * r;
    for (let j = 0; j < stride && i + j < n; j++) {
      dirs[(i + j) * 3] = dx;
      dirs[(i + j) * 3 + 1] = dy; // z stays 0 — burst in the head-on plane
    }
  }
  const target = live ?? new Float32Array(base);
  return {
    isPoints,
    base,
    dirs,
    live: target,
    apply(burst: number): void {
      for (let k = 0; k < base.length; k++) {
        target[k] = base[k] + dirs[k] * burst;
      }
    },
  };
}

// Digits and separators the clock needs beyond the base text.
const CLOCK_GLYPHS = "0123456789-: ";

async function buildKanji(): Promise<void> {
  // Make sure the requested web-font glyphs are loaded before rasterizing
  // (otherwise it bakes in whatever fallback font is loaded at that moment).
  // The bundled subset only covers the default text; custom strings and the
  // clock's digits fetch their glyphs on demand.
  const needsRemote = baseText !== KANJI || showClock;
  if (needsRemote) {
    await loadRemoteFont(baseText + (showClock ? CLOCK_GLYPHS : ""));
  } else {
    try {
      await document.fonts.load(`900 380px ${FONT_FAMILY}`, baseText);
      await document.fonts.ready;
    } catch {
      /* fall back to a system font on failure */
    }
  }

  if (!rebuildContours()) return;

  lineMesh = new LineSegments(new BufferGeometry(), lineMat);
  pointMesh = new Points(new BufferGeometry(), pointMat);
  group.add(lineMesh, pointMesh);

  showPattern(PATTERNS[patternIndex]);
  if (showClock) setInterval(tickClock, 1000);
}
void buildKanji();

// Re-rasterize the current text and refresh the cached contours. Returns false
// if nothing was drawn (e.g. all-whitespace).
function rebuildContours(): boolean {
  const img = rasterizeKanji(currentLines());
  const { loops, bbox } = extractContours(img);
  if (!bbox) return false;
  contourLoops = loops;
  contourBBox = bbox;
  return true;
}

// Once a second, rebuild the geometry from the new time, reusing the active
// depth arrangement so only the digits change (no re-scatter). Skipped mid-morph.
function tickClock(): void {
  if (morphActive || !rebuildContours()) return;
  const pattern = PATTERNS[patternIndex];
  if (showingPoints && dotsZ) {
    buildDots(pattern, dotsZ, false);
    particleField?.update(flow); // keep the flow position across the rebuild
    if (pointMesh) pointMesh.geometry.attributes.position.needsUpdate = true;
  } else if (lineZ) {
    buildScatter(pattern, lineZ);
  }
}

// Build the line geometry for a scatter pattern into lineMesh, using arrangement `z`.
function buildScatter(pattern: (typeof PATTERNS)[number], z: ZFn): void {
  if (!lineMesh || !contourLoops || !contourBBox) return;
  const positions = buildPositions(contourLoops, contourBBox, pattern, z);
  lineMesh.geometry.setAttribute("position", new BufferAttribute(positions, 3));
}

// Build the flowing dot field into pointMesh, using arrangement `z`.
function buildDots(
  pattern: (typeof PATTERNS)[number],
  z: ZFn,
  resetFlow = true,
): void {
  if (!pointMesh || !contourLoops || !contourBBox) return;
  if (resetFlow) flow = 0;
  particleField = buildParticleField(contourLoops, contourBBox, pattern, z);
  const geo = pointMesh.geometry;
  // BufferAttribute wraps the field's array, so per-frame update()s show up.
  geo.setAttribute("position", new BufferAttribute(particleField.positions, 3));
  geo.setAttribute("size", new BufferAttribute(particleField.sizes, 1));
}

// Switch to `pattern` instantly (used on load and to settle after a morph).
function showPattern(pattern: (typeof PATTERNS)[number]): void {
  if (!lineMesh || !pointMesh) return;
  morphActive = false;
  morphFrom = null;
  morphTo = null;
  const toPoints = pattern.mode === "points";
  if (toPoints) {
    dotsZ = pattern.makeZ();
    buildDots(pattern, dotsZ);
  } else {
    lineZ = pattern.makeZ();
    buildScatter(pattern, lineZ);
    particleField = null;
  }
  lineMat.opacity = 1;
  pointMat.uniforms.uAlpha.value = 1;
  showingPoints = toPoints;
  lineMesh.visible = !toPoints;
  pointMesh.visible = toPoints;
}

// Start a front→front morph into `pattern`: the current breakup bursts into a
// cloud, the primitive is swapped at peak chaos, then the new one reassembles.
function startMorph(pattern: (typeof PATTERNS)[number]): void {
  if (!lineMesh || !pointMesh || !contourLoops || !contourBBox) return;
  const toPoints = pattern.mode === "points";

  // FROM = whatever is showing now; capture its current positions to burst out.
  if (showingPoints && particleField) {
    morphFrom = makeBurstLayer(new Float32Array(particleField.positions), true);
    pointMesh.geometry.setAttribute(
      "position",
      new BufferAttribute(morphFrom.live, 3),
    );
  } else {
    const arr = lineMesh.geometry.attributes.position.array as Float32Array;
    morphFrom = makeBurstLayer(new Float32Array(arr), false);
    lineMesh.geometry.setAttribute(
      "position",
      new BufferAttribute(morphFrom.live, 3),
    );
  }

  // TO = the next breakup; for dots, live IS the field buffer so flow resumes.
  if (toPoints) {
    dotsZ = pattern.makeZ();
    buildDots(pattern, dotsZ);
    const field = particleField;
    if (!field) return;
    morphTo = makeBurstLayer(
      new Float32Array(field.positions),
      true,
      field.positions,
    );
  } else {
    lineZ = pattern.makeZ();
    const positions = buildPositions(contourLoops, contourBBox, pattern, lineZ);
    morphTo = makeBurstLayer(positions, false);
  }

  lineMesh.visible = !morphFrom.isPoints;
  pointMesh.visible = morphFrom.isPoints;
  setMorphAlpha(morphFrom.isPoints, 1); // FROM starts fully opaque
  morphSwapped = false;
  morphStart = performance.now();
  morphActive = true;
}

// Morph into the next pattern, staying head-on (one step per "正体" reveal).
function advancePattern(): void {
  patternIndex = (patternIndex + 1) % PATTERNS.length;
  startMorph(PATTERNS[patternIndex]);
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
let pendingMorph = false; // next switch morphs to the next pattern, still at front

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
  // After the front hold, morph (front→front) into the next pattern, hold the
  // new one head-on for a beat, and only then resume wandering.
  if (pendingMorph) {
    pendingMorph = false;
    advancePattern(); // cross-fade to the next pattern, staying at the front
    targetQuat.identity(); // remain readable through the morph + settle
    return MORPH_DURATION + MORPH_SETTLE;
  }

  // Only allow a reveal once enough random angles have passed since the last one.
  if (sinceReveal >= MIN_RANDOM_BETWEEN && Math.random() < REVEAL_CHANCE) {
    targetQuat.identity(); // settle on the readable "正体"
    sinceReveal = 0;
    pendingMorph = true; // next switch morphs to the next pattern at the front
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

// ===== Debug overlay (toggle with "?") =====
let debugVisible = false;
let debugEl: HTMLDivElement | null = null;
let fpsSmooth = 0;

function ensureDebugEl(): HTMLDivElement {
  if (debugEl) return debugEl;
  const el = document.createElement("div");
  el.style.cssText = [
    "position:fixed",
    "top:8px",
    "left:8px",
    "z-index:10",
    "margin:0",
    "padding:8px 10px",
    "font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
    "white-space:pre",
    "color:#f3efe6",
    "background:rgba(19,17,15,0.82)",
    "border-radius:6px",
    "pointer-events:none",
    "user-select:none",
  ].join(";");
  document.body.appendChild(el);
  debugEl = el;
  return el;
}

function updateDebug(now: number): void {
  const el = ensureDebugEl();
  const p = PATTERNS[patternIndex];
  const dots = pointMesh?.visible ? (particleField?.count ?? 0) : 0;
  const lineVerts = lineMesh?.visible
    ? lineMesh.geometry.attributes.position.count
    : 0;
  const morph = morphActive
    ? `${morphFrom?.isPoints ? "dots" : "line"}→${morphTo?.isPoints ? "dots" : "line"} ${String(Math.round(Math.min(1, (now - morphStart) / MORPH_DURATION) * 100))}%`
    : "—";
  const revealIn = autoMode
    ? `${Math.max(0, (nextSwitch - now) / 1000).toFixed(1)}s`
    : "—";
  el.textContent = [
    `fps    ${String(Math.round(fpsSmooth))}`,
    `text   ${baseText}${showClock ? "  +clock" : ""}`,
    `mode   ${showingPoints ? "dots" : "line"}  (${p.name})`,
    `morph  ${morph}`,
    `dots   ${String(dots)}`,
    `line   ${String(lineVerts)} verts`,
    `flow   ${flow.toFixed(1)}`,
    `auto   ${autoMode ? "on" : "off"}  reveal-in ${revealIn}`,
    `since  ${String(sinceReveal)} / ${String(MIN_RANDOM_BETWEEN)}`,
    `view   dpr ${String(renderer.getPixelRatio())}  ${String(app.clientWidth)}×${String(app.clientHeight)}`,
  ].join("\n");
}

window.addEventListener("keydown", (e) => {
  if (e.key !== "?") return;
  debugVisible = !debugVisible;
  if (debugEl) debugEl.style.display = debugVisible ? "block" : "none";
});

// ===== 6) Loop =====
let lastFrame = performance.now();
function tick(): void {
  const now = performance.now();
  const dt = Math.min(now - lastFrame, 100) / 1000; // seconds, clamped after stalls
  lastFrame = now;
  if (dt > 0) fpsSmooth = fpsSmooth ? fpsSmooth * 0.9 + (1 / dt) * 0.1 : 1 / dt;

  // Interaction stopped and INTERVAL elapsed -> resume auto (force the next angle).
  if (!autoMode && now - lastInteract > INTERVAL) {
    autoMode = true;
    nextSwitch = now; // pick the next target immediately
  }

  // Stream the dots along their contours (frozen during a morph so the
  // splitting line can track them).
  if (particleField && pointMesh?.visible && !morphActive) {
    flow += PARTICLE_FLOW_SPEED * dt;
    particleField.update(flow);
    pointMesh.geometry.attributes.position.needsUpdate = true;
  }

  // Front→front morph: burst the FROM breakup outward, swap primitive at peak
  // chaos, then reassemble the TO breakup. The swap hides the line↔dot change.
  if (morphActive && lineMesh && pointMesh && morphFrom && morphTo) {
    const t = Math.min(1, (now - morphStart) / MORPH_DURATION);
    const e = t * t * (3 - 2 * t); // smoothstep
    const burst = Math.sin(Math.PI * e); // 0 at the ends, 1 at the midpoint
    if (e < 0.5) {
      // FROM bursts apart and fades to alpha 0 by the midpoint.
      morphFrom.apply(burst);
      const m = morphFrom.isPoints ? pointMesh : lineMesh;
      m.geometry.attributes.position.needsUpdate = true;
      setMorphAlpha(morphFrom.isPoints, 1 - e / 0.5);
    } else {
      // Swap the primitive while fully transparent, then fade TO back in.
      if (!morphSwapped) {
        morphSwapped = true;
        setMorphAlpha(morphFrom.isPoints, 0);
        const toMesh = morphTo.isPoints ? pointMesh : lineMesh;
        toMesh.geometry.setAttribute(
          "position",
          new BufferAttribute(morphTo.live, 3),
        );
        lineMesh.visible = !morphTo.isPoints;
        pointMesh.visible = morphTo.isPoints;
      }
      morphTo.apply(burst);
      const m = morphTo.isPoints ? pointMesh : lineMesh;
      m.geometry.attributes.position.needsUpdate = true;
      setMorphAlpha(morphTo.isPoints, (e - 0.5) / 0.5);
    }
    if (t >= 1) {
      morphActive = false;
      showingPoints = morphTo.isPoints;
      lineMesh.visible = !morphTo.isPoints;
      pointMesh.visible = morphTo.isPoints;
      lineMat.opacity = 1;
      pointMat.uniforms.uAlpha.value = 1;
      if (!morphTo.isPoints) particleField = null; // back to lines: stop the flow
      morphFrom = null;
      morphTo = null;
    }
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

  if (debugVisible) updateDebug(now);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
