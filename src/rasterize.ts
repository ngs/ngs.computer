import { FONT_STACK } from "./config";

const spec = (size: number): string => `900 ${String(size)}px ${FONT_STACK}`;

// ===== 1) Draw the text offscreen and grab its pixels =====
export function rasterizeKanji(text: string): ImageData {
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

  // Shrink the type until it fits the canvas width (longer custom strings).
  const maxW = W * 0.86;
  let size = 380;
  ctx.font = spec(size);
  const w = ctx.measureText(text).width;
  if (w > maxW) {
    size = Math.max(48, Math.floor((size * maxW) / w));
    ctx.font = spec(size);
  }

  ctx.fillText(text, W / 2, H / 2);
  return ctx.getImageData(0, 0, W, H);
}
