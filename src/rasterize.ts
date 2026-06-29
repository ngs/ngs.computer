import { FONT_STACK } from "./config";

const spec = (size: number): string => `900 ${String(size)}px ${FONT_STACK}`;

/** A line of text and its size relative to the base font size. */
export interface TextLine {
  text: string;
  scale: number;
}

// ===== 1) Draw the text offscreen and grab its pixels =====
// Renders one or more lines (each at its own size), shrinking the type so the
// widest line and the full stack both fit the canvas.
export function rasterizeKanji(lines: TextLine[]): ImageData {
  const W = 1280;
  const H = 640;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("Failed to acquire a 2D context");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lineGap = 1.25; // line height as a multiple of each line's font size
  const maxW = W * 0.86;
  const maxH = H * 0.82;

  // Per-line width at 1px so we can solve for the base size in one pass.
  const probe = 100;
  ctx.font = spec(probe);
  const unitWidths = lines.map((l) => ctx.measureText(l.text).width / probe);

  const widthDenom = Math.max(
    ...lines.map((l, i) => unitWidths[i] * l.scale),
    1e-4,
  );
  const scaleSum = lines.reduce((s, l) => s + l.scale, 0);
  const size = Math.max(
    40,
    Math.floor(Math.min(380, maxW / widthDenom, maxH / (lineGap * scaleSum))),
  );

  const heights = lines.map((l) => size * l.scale * lineGap);
  const total = heights.reduce((a, b) => a + b, 0);
  let y = H / 2 - total / 2;
  lines.forEach((line, i) => {
    ctx.font = spec(size * line.scale);
    ctx.fillText(line.text, W / 2, y + heights[i] / 2);
    y += heights[i];
  });

  return ctx.getImageData(0, 0, W, H);
}
