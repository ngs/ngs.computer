import { Z_RANGE } from "./config";

/** Per-chunk context handed to a pattern's depth function. */
export interface ChunkCtx {
  /** Chunk-centroid X, normalized to roughly [-1, 1]. */
  nx: number;
  /** Chunk-centroid Y, normalized to roughly [-1, 1] (3D-up). */
  ny: number;
  /** Radial distance from the glyph center, clamped to [0, 1]. */
  r: number;
  /** Chunk index in build order. */
  i: number;
}

/** Maps a chunk/dot to its depth (Z). */
export type ZFn = (ctx: ChunkCtx) => number;

/**
 * A way to scatter the glyph into 3D. Only the depth (Z) of each chunk varies;
 * the in-plane shape is identical, so every pattern reads as "正体" head-on and
 * breaks apart differently as it tilts. `chunk`/`gap` may override the defaults
 * to make a pattern choppier or coarser. `mode: "points"` renders the glyph as
 * a dot field instead of line segments (sampling every `step`-th contour point).
 * `makeZ()` returns a freshly randomized depth arrangement on every build, so
 * the layout differs each time the pattern appears.
 */
export interface ScatterPattern {
  name: string;
  mode?: "lines" | "points";
  chunk?: number;
  gap?: number;
  step?: number;
  makeZ: () => ZFn;
}

const TAU = Math.PI * 2;
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const pickOne = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

// ===== Depth arrangements =====
// Spatial arrangements are pure functions of position with parameters baked in
// at creation, so they stay stable frame-to-frame (safe for the flowing dots)
// while differing on every build.

function waveZ(): ZFn {
  const fx = rnd(1, 3) * Math.PI;
  const fy = rnd(1, 3) * Math.PI;
  const ph = rnd(0, TAU);
  const sign = Math.random() < 0.5 ? -1 : 1;
  return ({ nx, ny }) => Math.sin(nx * fx + ny * fy + ph) * Z_RANGE * sign;
}

function tiltZ(): ZFn {
  const ax = rnd(-1, 1);
  const ay = rnd(-1, 1);
  const d = Math.abs(ax) + Math.abs(ay) || 1; // normalize so |z| <= Z_RANGE
  return ({ nx, ny }) => ((nx * ax + ny * ay) / d) * Z_RANGE;
}

function radialZ(): ZFn {
  const k = rnd(1.5, 4);
  const ph = rnd(0, TAU);
  const sign = Math.random() < 0.5 ? -1 : 1;
  return ({ r }) => Math.sin(r * k * Math.PI + ph) * Z_RANGE * sign;
}

function twistZ(): ZFn {
  const k = Math.floor(rnd(1, 5));
  const ph = rnd(0, TAU);
  return ({ nx, ny }) => Math.sin(Math.atan2(ny, nx) * k + ph) * Z_RANGE;
}

const SPATIAL = [waveZ, tiltZ, radialZ, twistZ];

// Incoherent cloud: each chunk at an independent random depth. Built once per
// scatter, so it's fine for lines — but it would flicker on the flowing dots.
function cloudZ(): ZFn {
  return () => (Math.random() * 2 - 1) * Z_RANGE;
}

/** A fresh spatial arrangement (stable per build) — safe for the dot field. */
const randomSpatialZ = (): ZFn => pickOne(SPATIAL)();

/** A fresh arrangement for lines: spatial or an incoherent cloud. */
const randomScatterZ = (): ZFn => pickOne([cloudZ, ...SPATIAL])();

/** Patterns cycled through, one per "正体" reveal. */
export const PATTERNS: ScatterPattern[] = [
  // Line breakup: a different depth layout (cloud / wave / tilt / radial / twist)
  // each time.
  { name: "scatter", makeZ: randomScatterZ },

  // Flowing dot field: a different spatial depth layout each time.
  { name: "particle", mode: "points", step: 2, makeZ: randomSpatialZ },
];
