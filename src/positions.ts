import { CHUNK, GAP, TARGET_SIZE, Z_RANGE } from "./config";
import type { BBox, Loop } from "./marchingSquares";

// ===== 3) Turn contours into 3D line segments (each chunk at a random depth) =====
export function buildPositions(loops: Loop[], bbox: BBox): Float32Array {
  const cx = (bbox.gminX + bbox.gmaxX) / 2;
  const cy = (bbox.gminY + bbox.gmaxY) / 2;
  const maxDim = Math.max(bbox.gmaxX - bbox.gminX, bbox.gmaxY - bbox.gminY);
  const scale = TARGET_SIZE / maxDim;
  const mx = (x: number): number => (x - cx) * scale;
  const my = (y: number): number => -(y - cy) * scale; // flip Y (screen-down -> 3D-up)

  const pos: number[] = [];
  for (const poly of loops) {
    let k = 0;
    while (k < poly.length - 1) {
      const end = Math.min(k + CHUNK, poly.length - 1);
      const z = (Math.random() * 2 - 1) * Z_RANGE; // depth of this line
      for (let t = k; t < end; t++) {
        const A = poly[t];
        const B = poly[t + 1];
        pos.push(mx(A[0]), my(A[1]), z, mx(B[0]), my(B[1]), z);
      }
      k = end + GAP; // leave a gap before the next line (no shared endpoints)
    }
  }
  return new Float32Array(pos);
}
