import {
  CHUNK,
  GAP,
  PARTICLE_SIZE_JITTER,
  PARTICLE_SIZE_MIN,
  TARGET_SIZE,
} from "./config";
import type { BBox, Loop } from "./marchingSquares";
import type { ScatterPattern } from "./patterns";

// Maps grid-space contour coordinates into centered 3D space.
function makeMapper(bbox: BBox): {
  mx: (x: number) => number;
  my: (y: number) => number;
  half: number;
} {
  const cx = (bbox.gminX + bbox.gmaxX) / 2;
  const cy = (bbox.gminY + bbox.gmaxY) / 2;
  const maxDim = Math.max(bbox.gmaxX - bbox.gminX, bbox.gmaxY - bbox.gminY);
  const scale = TARGET_SIZE / maxDim;
  return {
    mx: (x: number): number => (x - cx) * scale,
    my: (y: number): number => -(y - cy) * scale, // flip Y (screen-down -> 3D-up)
    half: TARGET_SIZE / 2, // normalization base for chunk/point centroids
  };
}

// ===== 3) Turn contours into 3D line segments (each chunk's depth set by the pattern) =====
export function buildPositions(
  loops: Loop[],
  bbox: BBox,
  pattern: ScatterPattern,
): Float32Array {
  const { mx, my, half } = makeMapper(bbox);

  const chunk = pattern.chunk ?? CHUNK;
  const gap = pattern.gap ?? GAP;
  const z = pattern.makeZ(); // fresh random arrangement for this build

  const pos: number[] = [];
  let i = 0;
  for (const poly of loops) {
    let k = 0;
    while (k < poly.length - 1) {
      const end = Math.min(k + chunk, poly.length - 1);

      // Chunk centroid (mapped to 3D space), so positional patterns can place it.
      let sx = 0;
      let sy = 0;
      for (let t = k; t <= end; t++) {
        sx += mx(poly[t][0]);
        sy += my(poly[t][1]);
      }
      const n = end - k + 1;
      const nx = sx / n / half;
      const ny = sy / n / half;
      const r = Math.min(1, Math.hypot(nx, ny));
      const zv = z({ nx, ny, r, i });

      for (let t = k; t < end; t++) {
        const A = poly[t];
        const B = poly[t + 1];
        pos.push(mx(A[0]), my(A[1]), zv, mx(B[0]), my(B[1]), zv);
      }
      k = end + gap; // leave a gap before the next line (no shared endpoints)
      i++;
    }
  }
  return new Float32Array(pos);
}

// A dot field whose particles flow along their source contour. `positions` is
// rewritten in place by `update(flow)`; `sizes` stays fixed per slot.
export interface ParticleField {
  positions: Float32Array;
  sizes: Float32Array;
  count: number;
  /** Slide every dot `flow` sample-steps along its loop (wraps seamlessly). */
  update(flow: number): void;
}

// ===== Sample the contours into a flowing dot field =====
// Each contour loop becomes a ring of evenly-spaced dots; advancing `flow`
// streams them along the loop. Depth is resampled from the pattern each frame,
// so dots drift through the (static) wave field as they travel.
export function buildParticleField(
  loops: Loop[],
  bbox: BBox,
  pattern: ScatterPattern,
): ParticleField {
  const { mx, my, half } = makeMapper(bbox);
  const step = Math.max(1, pattern.step ?? 2);

  // Precompute each usable loop's mapped points and its traversable length.
  const rings: {
    xs: Float32Array;
    ys: Float32Array;
    n: number;
    len: number;
  }[] = [];
  const slots: { ring: number; base: number }[] = [];
  for (const poly of loops) {
    const n = poly.length;
    if (n < 3) continue;
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    for (let t = 0; t < n; t++) {
      xs[t] = mx(poly[t][0]);
      ys[t] = my(poly[t][1]);
    }
    // Closed loops repeat the first point at the end; drop it from the cycle.
    const closed =
      poly[0][0] === poly[n - 1][0] && poly[0][1] === poly[n - 1][1];
    const len = closed ? n - 1 : n;
    const ring = rings.length;
    rings.push({ xs, ys, n, len });
    const count = Math.max(1, Math.floor(len / step));
    for (let j = 0; j < count; j++) slots.push({ ring, base: j * step });
  }

  const count = slots.length;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let s = 0; s < count; s++) {
    sizes[s] = PARTICLE_SIZE_MIN + Math.random() * PARTICLE_SIZE_JITTER;
  }

  // One fresh (but frame-stable) arrangement for this build, so the dots flow
  // through a fixed depth field instead of re-randomizing every frame.
  const z = pattern.makeZ();

  function update(flow: number): void {
    for (let s = 0; s < count; s++) {
      const slot = slots[s];
      const ring = rings[slot.ring];
      const { xs, ys, n, len } = ring;
      let sPos = (slot.base + flow) % len;
      if (sPos < 0) sPos += len;
      const i0 = Math.floor(sPos) % n;
      const i1 = (i0 + 1) % n;
      const f = sPos - Math.floor(sPos);
      const x = xs[i0] + (xs[i1] - xs[i0]) * f;
      const y = ys[i0] + (ys[i1] - ys[i0]) * f;
      const nx = x / half;
      const ny = y / half;
      const r = Math.min(1, Math.hypot(nx, ny));
      const o = s * 3;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = z({ nx, ny, r, i: s });
    }
  }

  update(0);
  return { positions, sizes, count, update };
}
