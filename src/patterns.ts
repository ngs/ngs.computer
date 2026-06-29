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

/**
 * A way to scatter the glyph into 3D. Only the depth (Z) of each chunk varies;
 * the in-plane shape is identical, so every pattern reads as "正体" head-on and
 * breaks apart differently as it tilts. `chunk`/`gap` may override the defaults
 * to make a pattern choppier or coarser. `mode: "points"` renders the glyph as
 * a dot field instead of line segments (sampling every `step`-th contour point).
 */
export interface ScatterPattern {
  name: string;
  mode?: "lines" | "points";
  chunk?: number;
  gap?: number;
  step?: number;
  z: (ctx: ChunkCtx) => number;
}

const rand = (): number => Math.random() * 2 - 1; // [-1, 1)

/** Scatter patterns cycled through, one per "正体" reveal. */
export const PATTERNS: ScatterPattern[] = [
  // The original: every chunk at an independent random depth (a noise cloud).
  { name: "scatter", z: () => rand() * Z_RANGE },

  // Dissolve the glyph into a flowing field of dots; depth follows a diagonal
  // wave so the particles read as drifting sheets when tilted.
  {
    name: "particle",
    mode: "points",
    step: 2,
    z: ({ nx, ny }) =>
      Math.sin(nx * Math.PI * 1.2 + ny * Math.PI * 0.8) * Z_RANGE,
  },
];
