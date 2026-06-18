// ===== Tuning parameters =====

/** Text to render (use "長瀬" where 瀨 is unavailable). */
export const KANJI = "長瀨";

/** Google Fonts family. Pins the typeface so it looks the same everywhere. */
export const FONT_FAMILY = "'Zen Old Mincho'";

/** Font spec used for rasterization. */
export const FONT_SPEC = `900 380px ${FONT_FAMILY},"Hiragino Mincho ProN","Yu Mincho",serif`;

/** Approximate glyph size in 3D space. */
export const TARGET_SIZE = 10;

/** Depth spread of the lines (larger = more scattered). */
export const Z_RANGE = 3.6;

/** Contour grid resolution (px). Smaller = finer detail = more lines. */
export const CELL = 3;

/** Points per line segment chunk (shorter = choppier = more scattered). */
export const CHUNK = 12;

/** Gap between chunks (in points). Creates the "no shared endpoints" spacing. */
export const GAP = 2;

/** Angle switch interval (ms). */
export const INTERVAL = 1000;

/** Every Nth switch, go to the readable front-facing angle. */
export const REVEAL_EVERY = 3;

/** Auto-mode easing toward the target angle, per frame (0-1). Lower = gentler, longer glide. */
export const EASE = 0.06;

/** Drag inertia: angular-velocity retention per frame (0-1). Higher = longer glide after release. */
export const DAMPING = 0.92;
