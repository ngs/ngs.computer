import { CELL } from "./config";

/** A point in grid coordinates [x, y]. */
export type Point = [number, number];

/** A connected sequence of points (a contour loop). */
export type Loop = Point[];

/** Bounding box in grid coordinates. */
export interface BBox {
  gminX: number;
  gminY: number;
  gmaxX: number;
  gmaxY: number;
}

export interface Contours {
  loops: Loop[];
  bbox: BBox | null;
}

/** Edge label pointing at a cell-edge midpoint (T:top R:right B:bottom L:left). */
type Edge = "T" | "R" | "B" | "L";

// ===== 2) Extract contour lines with Marching Squares =====
// For each cell configuration -> the pair(s) of edges to connect
// (midpoints of T:top R:right B:bottom L:left).
const MS: Record<number, [Edge, Edge][]> = {
  1: [["L", "T"]],
  2: [["T", "R"]],
  3: [["L", "R"]],
  4: [["R", "B"]],
  5: [["L", "T"], ["R", "B"]],
  6: [["T", "B"]],
  7: [["L", "B"]],
  8: [["B", "L"]],
  9: [["T", "B"]],
  10: [["T", "R"], ["B", "L"]],
  11: [["R", "B"]],
  12: [["L", "R"]],
  13: [["T", "R"]],
  14: [["L", "T"]],
};

/** A single segment [x1, y1, x2, y2]. */
type Segment = [number, number, number, number];

export function extractContours(img: ImageData): Contours {
  const { data, width, height } = img;
  const darkAt = (x: number, y: number): boolean => {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const i = (y * width + x) * 4;
    // Low luminance = dark.
    return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 < 110;
  };

  // Bounding box of the dark pixels.
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let found = false;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (darkAt(x, y)) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return { loops: [], bbox: null };

  // Pad by one cell so the contours close cleanly.
  minX -= CELL;
  minY -= CELL;
  maxX += CELL;
  maxY += CELL;

  const cols = Math.floor((maxX - minX) / CELL) + 1;
  const rows = Math.floor((maxY - minY) / CELL) + 1;
  const inside = (c: number, r: number): boolean =>
    darkAt(minX + c * CELL, minY + r * CELL);

  const pt = (label: Edge, c: number, r: number): Point => {
    switch (label) {
      case "T":
        return [c + 0.5, r];
      case "R":
        return [c + 1, r + 0.5];
      case "B":
        return [c + 0.5, r + 1];
      case "L":
        return [c, r + 0.5];
    }
  };

  const segs: Segment[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = inside(c, r) ? 1 : 0;
      const b = inside(c + 1, r) ? 1 : 0;
      const br = inside(c + 1, r + 1) ? 1 : 0;
      const bl = inside(c, r + 1) ? 1 : 0;
      const idx = a + b * 2 + br * 4 + bl * 8;
      const cfg = MS[idx];
      if (!cfg) continue;
      for (const [p, q] of cfg) {
        const P = pt(p, c, r);
        const Q = pt(q, c, r);
        segs.push([P[0], P[1], Q[0], Q[1]]);
      }
    }
  }

  // Key the endpoints, then stitch segments into polylines (loops).
  const key = (x: number, y: number): string => `${(x * 2) | 0}_${(y * 2) | 0}`;
  const map = new Map<string, number[]>();
  const pushAt = (k: string, i: number): void => {
    const list = map.get(k);
    if (list) list.push(i);
    else map.set(k, [i]);
  };
  segs.forEach((s, i) => {
    pushAt(key(s[0], s[1]), i);
    pushAt(key(s[2], s[3]), i);
  });

  const used = new Array<boolean>(segs.length).fill(false);
  const loops: Loop[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const start = segs[i];
    const startK = key(start[0], start[1]);
    const poly: Loop = [
      [start[0], start[1]],
      [start[2], start[3]],
    ];
    let endX = start[2];
    let endY = start[3];
    let guard = 0;
    while (guard++ < 100000) {
      const cand = map.get(key(endX, endY));
      let nxt = -1;
      if (cand) {
        for (const j of cand) {
          if (!used[j]) {
            nxt = j;
            break;
          }
        }
      }
      if (nxt < 0) break;
      used[nxt] = true;
      const s = segs[nxt];
      if (key(s[0], s[1]) === key(endX, endY)) {
        endX = s[2];
        endY = s[3];
      } else {
        endX = s[0];
        endY = s[1];
      }
      poly.push([endX, endY]);
      if (key(endX, endY) === startK) break; // closed
    }
    if (poly.length >= 2) loops.push(poly);
  }

  // Bounding box in grid coordinates.
  let gminX = Infinity;
  let gminY = Infinity;
  let gmaxX = -Infinity;
  let gmaxY = -Infinity;
  for (const poly of loops) {
    for (const p of poly) {
      if (p[0] < gminX) gminX = p[0];
      if (p[0] > gmaxX) gmaxX = p[0];
      if (p[1] < gminY) gminY = p[1];
      if (p[1] > gmaxY) gmaxY = p[1];
    }
  }
  return { loops, bbox: { gminX, gminY, gmaxX, gmaxY } };
}
