import { FONT_SPEC } from "./config";

// ===== 1) Draw the kanji offscreen and grab its pixels =====
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
  ctx.font = FONT_SPEC;
  ctx.fillText(text, W / 2, H / 2);
  return ctx.getImageData(0, 0, W, H);
}
