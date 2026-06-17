// Generate the favicon set from resources/favicon.svg into public/.
// Run with: npm run favicons (Node 22.18+/24, runs TypeScript directly).
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(root, "resources/favicon.svg");
const OUT = resolve(root, "public");

interface PngTarget {
  size: number;
  file: string;
}

// Standalone PNGs referenced from index.html.
const PNG_TARGETS: PngTarget[] = [
  { size: 96, file: "favicon-96x96.png" },
  { size: 180, file: "apple-touch-icon.png" },
];
// Sizes bundled into the multi-resolution favicon.ico for legacy clients.
const ICO_SIZES = [16, 32, 48];

// Render the SVG at a high density so every downscale stays crisp.
const render = (svg: Buffer, size: number) =>
  sharp(svg, { density: 384 }).resize(size, size).png();

async function main(): Promise<void> {
  const svg = await readFile(SRC);
  await mkdir(OUT, { recursive: true });

  for (const { size, file } of PNG_TARGETS) {
    await render(svg, size).toFile(resolve(OUT, file));
    console.log(`✓ ${file} (${String(size)}×${String(size)})`);
  }

  const icoFrames = await Promise.all(
    ICO_SIZES.map((size) => render(svg, size).toBuffer()),
  );
  await writeFile(resolve(OUT, "favicon.ico"), await pngToIco(icoFrames));
  console.log(`✓ favicon.ico (${ICO_SIZES.join(", ")})`);

  // Ship the SVG itself for browsers that support it.
  await copyFile(SRC, resolve(OUT, "favicon.svg"));
  console.log("✓ favicon.svg");
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
