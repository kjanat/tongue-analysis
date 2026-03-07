/**
 * Numeric thresholds governing the tongue analysis pipeline.
 *
 * These constants control quality gates for color classification
 * and lighting validation. "Standard" thresholds apply when face
 * detection succeeds; "closeup" thresholds are relaxed fallbacks
 * used when the full-image path is taken.
 *
 * @module
 */

// ── Color Classification Gates ──────────────────

/** Minimum OKLCh chroma for a standard (face-detected) frame to be classifiable. */
export const STANDARD_MIN_CLASSIFIABLE_CHROMA = 0.03;

/** Minimum match confidence for a standard frame to produce a diagnosis. */
export const STANDARD_MIN_CLASSIFIABLE_CONFIDENCE = 0.35;

/** Minimum OKLCh chroma for a closeup/fallback frame — relaxed because
 *  full-image crops include more non-tongue pixels that dilute saturation. */
export const CLOSEUP_MIN_CLASSIFIABLE_CHROMA = 0.012;

/** Minimum match confidence for a closeup/fallback frame. */
export const CLOSEUP_MIN_CLASSIFIABLE_CONFIDENCE = 0.12;

// ── Lighting Validation ─────────────────────────

/** Luminance value (0–255) below which a pixel is considered "dark". */
export const DARK_PIXEL_LUMINANCE = 40;

/** Luminance value (0–255) above which a pixel is considered "bright". */
export const BRIGHT_PIXEL_LUMINANCE = 215;

/** Mean luminance below this rejects the frame as too dark. */
export const MIN_MEAN_LUMINANCE = 42;

/** Mean luminance above this rejects the frame as overexposed. */
export const MAX_MEAN_LUMINANCE = 220;

/** Maximum fraction of dark pixels before the frame is rejected. */
export const MAX_DARK_RATIO = 0.52;

/** Maximum fraction of bright pixels before the frame is rejected. */
export const MAX_BRIGHT_RATIO = 0.45;

/** Maximum luminance standard deviation — exceeding this indicates uneven lighting. */
export const MAX_STD_DEV = 70;

/** Minimum number of sampled pixels required for lighting stats to be meaningful. */
export const MIN_LIGHTING_SAMPLE_COUNT = 50;

/** When both dark and bright ratios exceed this, lighting is flagged as high-contrast. */
export const HIGH_CONTRAST_RATIO_THRESHOLD = 0.18;
