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

/** Chance (0-1) that an eligible switch lands on the readable front-facing "正体". */
export const REVEAL_CHANCE = 0.2;

/** Minimum number of random angles forced between two "正体" reveals. */
export const MIN_RANDOM_BETWEEN = 3;

/** Dwell at the readable "正体" as a multiple of INTERVAL (2 = stay twice as long). */
export const REVEAL_HOLD_MULT = 2;

/** Particle-pattern dot size (screen px, before devicePixelRatio). */
export const PARTICLE_SIZE_MIN = 0.9; // base dot size
export const PARTICLE_SIZE_JITTER = 1.2; // random per-dot size variation (set 0 for uniform)

/** Particle flow speed along the contour (sample-steps per second; 0 = static). */
export const PARTICLE_FLOW_SPEED = 9;

/** Auto-mode easing toward the target angle, per frame (0-1). Lower = gentler, longer glide. */
export const EASE = 0.06;

/** Drag inertia: angular-velocity retention per frame (0-1). Higher = longer glide after release. */
export const DAMPING = 0.92;
