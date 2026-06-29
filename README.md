# ngs.computer

An interactive 3D signature for [**ngs.computer**](https://ngs.computer/). The kanji
name **長瀨** is rasterized, shattered into a cloud of line fragments and flowing
dots, and tumbled in space with [three.js](https://threejs.org/) — every chunk
shares the same in-plane shape but sits at a different depth, so the glyph only
resolves into its readable form (**正体**) when it faces you head-on.

## How it works

1. **Rasterize.** The glyph is drawn to an offscreen canvas at weight 900 using
   _Zen Old Mincho_ (`src/rasterize.ts`).
2. **Trace.** Contours are extracted from the bitmap with a marching-squares pass
   (`src/marchingSquares.ts`).
3. **Scatter.** Each contour is cut into short line-segment chunks — or sampled as
   dots — and pushed to a per-chunk depth `Z` by a pattern function
   (`src/patterns.ts`, `src/positions.ts`). The X/Y outline is left untouched, so
   the silhouette is identical from the front and breaks apart as it tilts.
4. **Render.** An orthographic three.js scene draws the fragments
   (`src/main.ts`). Auto-rotation wanders through random orientations, occasionally
   settling head-on to reveal the name before a front-to-front morph — the current
   breakup explodes into a cloud, swaps primitive (lines ↔ dots) at peak chaos, then
   reassembles into the next pattern.

Two breakup patterns alternate on each reveal:

- **scatter** — line fragments at a freshly randomized depth layout (cloud, wave,
  tilt, radial, or twist).
- **particle** — a dot field that flows along the contour.

The line/dot color follows the OS light/dark preference.

## Controls & query parameters

| Input              | Effect                                                                              |
| ------------------ | ----------------------------------------------------------------------------------- |
| Drag (mouse/touch) | Rotate the glyph; releasing keeps a decaying spin. Auto-rotation resumes when idle. |
| `?` key            | Toggle a debug overlay (FPS, mode, morph progress, dot/vertex counts, …).           |
| `?text=…`          | Render arbitrary text instead of 長瀨 (up to 24 characters).                        |
| `?now=1`           | Append a live, second-resolution clock line at half size.                           |

> **Note:** `?text=` and `?now=1` fetch the required glyphs from Google Fonts on
> demand, so the requested characters are sent to Google in the request URL. The
> default 長瀨 ships as a bundled `woff2` subset and needs no network request.

## Tech stack

- **TypeScript** + **[Vite](https://vite.dev/)** build
- **[three.js](https://threejs.org/)** (orthographic WebGL rendering, custom point shader)
- _Zen Old Mincho_ — bundled `woff2` subset for the default glyphs, on-demand Google Fonts subsets for everything else
- **ESLint** / **Stylelint** / **Prettier**, enforced via **Husky** + **lint-staged**

## Development

```sh
npm install
npm run dev        # start the Vite dev server
npm run build      # type-check (tsc) and bundle to dist/
npm run preview    # preview the production build
```

Other scripts:

```sh
npm run lint            # ESLint
npm run lint:css        # Stylelint
npm run format          # Prettier (write)
npm run format:check    # Prettier (check)
npm run favicons        # regenerate favicons from resources/favicon.svg
```

## Project structure

```
index.html                 entry HTML
src/
  main.ts                  three.js scene, animation loop, interaction, morphs
  config.ts                tuning parameters (sizes, timings, easing, …)
  rasterize.ts             draw the glyph(s) to an offscreen canvas
  marchingSquares.ts       extract contours from the bitmap
  positions.ts             chunk contours into line segments / dot fields
  patterns.ts              depth (Z) arrangements and breakup patterns
  loadFont.ts              on-demand Google Fonts subset loading
  logo.ts / logo.svg       inline status-corner logo
scripts/generate-favicons.ts   favicon generation
```

## Deployment

Pushing to `main` builds the site and deploys it to GitHub Pages via
`.github/workflows/deploy.yml`, served from the custom domain `ngs.computer`
(`public/CNAME`). Pull requests run lint, format, and build checks in
`.github/workflows/ci.yml`.
