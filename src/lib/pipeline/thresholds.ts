/**
 * Numeric thresholds governing the tongue analysis pipeline.
 *
 * Three groups, consumed at two pipeline stages:
 *
 * 1. **Color classification gates** — applied at the *end* of the pipeline
 *    (in `analysis-core.ts`) after OKLCh classification. Decide whether the
 *    measured color is trustworthy enough to generate a diagnosis. Both chroma
 *    AND confidence must be below threshold to reject; either alone is
 *    tolerated (pale tongue types are naturally low-chroma, and low confidence
 *    still carries signal). "Standard" thresholds apply when face detection
 *    succeeds; "closeup" thresholds are ~2.5–3× more lenient because the
 *    full-image crop includes non-tongue pixels that dilute saturation.
 *
 * 2. **Pixel-level luminance classifiers** — applied per-pixel inside
 *    `lighting.ts` during the luminance scan. These only *label* individual
 *    pixels as "dark" or "bright"; they don't reject anything by themselves.
 *    They feed the counters that produce `darkRatio` and `brightRatio`.
 *
 * 3. **Frame-level lighting rejection** — applied to the *aggregate*
 *    statistics from group 2 (in `lighting.ts`) to decide whether the whole
 *    frame has a lighting problem. Three checks run in priority order:
 *    too dark → too bright → high contrast. This runs as a *secondary
 *    diagnostic* after segmentation or color-gate failure, providing
 *    actionable "improve lighting" errors instead of generic ones.
 *
 * ---
 *
 * ## Tuning guide
 *
 * **"Too many `inconclusive_color` rejections on normal photos"**
 * Lower {@link STANDARD_MIN_CLASSIFIABLE_CHROMA} and/or
 * {@link STANDARD_MIN_CLASSIFIABLE_CONFIDENCE}. Both must be below
 * threshold simultaneously to reject, so lowering either one alone makes
 * the gate more permissive.
 *
 * **"Too many `inconclusive_color` rejections on closeup/fallback photos"**
 * Lower {@link CLOSEUP_MIN_CLASSIFIABLE_CHROMA} and/or
 * {@link CLOSEUP_MIN_CLASSIFIABLE_CONFIDENCE}. Same AND-logic applies.
 * Be careful going below ~0.005 chroma — at that point you're classifying
 * near-gray pixels where hue is essentially noise.
 *
 * **"Too many `poor_lighting` → `too_dark` errors"**
 * Two independent triggers — relax whichever is firing:
 * - Lower {@link MIN_MEAN_LUMINANCE} to tolerate a darker average.
 * - Raise {@link MAX_DARK_RATIO} to tolerate more dark pixels.
 *
 * **"Too many `poor_lighting` → `too_bright` errors"**
 * Same structure, two independent triggers:
 * - Raise {@link MAX_MEAN_LUMINANCE} to tolerate a brighter average.
 * - Raise {@link MAX_BRIGHT_RATIO} to tolerate more blown-out pixels.
 *
 * **"Too many `poor_lighting` → `high_contrast` errors"**
 * Two conditions must BOTH be true — loosen either one:
 * - Raise {@link MAX_STD_DEV} to tolerate wider luminance spread.
 * - Raise {@link HIGH_CONTRAST_RATIO_THRESHOLD} to require a larger
 *   cluster at the dark/bright extreme before triggering.
 *
 * **"Lighting check fires on tiny crops with unreliable stats"**
 * Raise {@link MIN_LIGHTING_SAMPLE_COUNT}. The check is skipped entirely
 * when fewer than this many masked pixels are available.
 *
 * **"What counts as a 'dark' or 'bright' pixel is wrong"**
 * Adjust {@link DARK_PIXEL_LUMINANCE} / {@link BRIGHT_PIXEL_LUMINANCE}.
 * These cascade: changing them shifts the `darkRatio` and `brightRatio`
 * distributions, which in turn affect **all three** frame-level checks
 * (`too_dark`, `too_bright`, and `high_contrast`). If you widen the
 * dark/bright definitions, you'll likely need to raise the corresponding
 * `MAX_*_RATIO` thresholds to compensate, or you'll reject more frames.
 *
 * **"Closeup fallback is too lenient / accepts garbage"**
 * Raise {@link CLOSEUP_MIN_CLASSIFIABLE_CHROMA} and/or
 * {@link CLOSEUP_MIN_CLASSIFIABLE_CONFIDENCE} toward their standard
 * counterparts. Narrowing the gap between standard and closeup thresholds
 * makes the fallback path stricter at the cost of more `inconclusive_color`
 * rejections when face detection fails.
 *
 * @module
 */

// ── 1. Color Classification Gates (analysis-core.ts) ──

/** Minimum OKLCh chroma for a standard (face-detected) frame to be classifiable.
 *
 *  Chroma measures color saturation in perceptual space. Tongues with chroma
 *  below this are likely gray/washed-out — but this alone doesn't reject;
 *  confidence must *also* be below its threshold (AND-gate). */
export const STANDARD_MIN_CLASSIFIABLE_CHROMA = 0.03;

/** Minimum match confidence (0–1) for a standard frame to produce a diagnosis.
 *
 *  Confidence is the inverse-distance score from OKLCh classification — how
 *  close the measured color is to the nearest TCM reference color. Low
 *  confidence means the color doesn't resemble any known tongue type. */
export const STANDARD_MIN_CLASSIFIABLE_CONFIDENCE = 0.15;

/** Minimum OKLCh chroma for a closeup/fallback frame.
 *
 *  ~2.5× more lenient than the standard threshold because full-image crops
 *  include surrounding skin/background pixels that dilute measured saturation.
 *  Setting this below ~0.005 risks classifying near-gray noise. */
export const CLOSEUP_MIN_CLASSIFIABLE_CHROMA = 0.012;

/** Minimum match confidence for a closeup/fallback frame.
 *
 *  ~3× more lenient than standard. The full-image color average is less
 *  precise, so the distance to reference colors is naturally larger. */
export const CLOSEUP_MIN_CLASSIFIABLE_CONFIDENCE = 0.05;

// ── 2. Pixel-Level Luminance Classifiers (lighting.ts) ──
//
// These label individual pixels during the luminance scan. They don't
// reject frames — they feed the darkRatio/brightRatio counters that
// group 3 evaluates. Changing these shifts ratio distributions, which
// cascades into ALL frame-level checks.

/** BT.709 luminance (0–255) below which a pixel is bucketed as "dark".
 *
 *  Lowering this → fewer pixels counted as dark → lower `darkRatio` →
 *  harder to trigger `too_dark` and `high_contrast` checks.
 *  Raising this → more pixels counted as dark → opposite effect. */
export const DARK_PIXEL_LUMINANCE = 40;

/** BT.709 luminance (0–255) above which a pixel is bucketed as "bright".
 *
 *  Raising this → fewer pixels counted as bright → lower `brightRatio` →
 *  harder to trigger `too_bright` and `high_contrast` checks.
 *  Lowering this → more pixels counted as bright → opposite effect. */
export const BRIGHT_PIXEL_LUMINANCE = 215;

// ── 3. Frame-Level Lighting Rejection (lighting.ts) ──
//
// Uses the ratios computed from group 2 to classify the whole frame.
// Checks run in priority order: too dark → too bright → high contrast.
// First match wins — a frame that's both dark and high-contrast reports
// only `too_dark`.

/** Fewer masked pixels than this → skip lighting analysis entirely.
 *
 *  Luminance stats are unreliable on tiny samples (e.g. a 5×5 crop).
 *  Raising this avoids false positives on small mouth regions but means
 *  lighting issues go unreported for small crops. */
export const MIN_LIGHTING_SAMPLE_COUNT = 50;

// Too dark: either condition alone triggers `too_dark`.

/** Mean luminance below this rejects the frame as too dark.
 *
 *  This catches uniformly dim frames. Lowering it tolerates darker
 *  environments but risks accepting underexposed images where tongue
 *  color is unreliable. */
export const MIN_MEAN_LUMINANCE = 42;

/** Fraction of dark pixels (0–1) above which the frame is rejected as too dark.
 *
 *  This catches frames with large dark regions even if the mean is acceptable
 *  (e.g. a bright spot on an otherwise dark image). At 0.52, more than half
 *  the pixels must be dark. */
export const MAX_DARK_RATIO = 0.52;

// Too bright: either condition alone triggers `too_bright`.

/** Mean luminance above this rejects the frame as overexposed.
 *
 *  Catches uniformly blown-out frames. Raising it tolerates brighter
 *  environments but risks accepting washed-out images where color
 *  differences between tongue types are compressed. */
export const MAX_MEAN_LUMINANCE = 220;

/** Fraction of bright pixels (0–1) above which the frame is rejected as overexposed.
 *
 *  Catches frames with large blown-out regions. At 0.45, nearly half the
 *  pixels must be bright — more lenient than {@link MAX_DARK_RATIO} because
 *  oral cavity photos naturally have some specular highlights. */
export const MAX_BRIGHT_RATIO = 0.45;

// High contrast: BOTH conditions must be true simultaneously.

/** Maximum luminance standard deviation before the frame *may* be rejected.
 *
 *  High stddev alone is fine (just wide dynamic range). This condition must
 *  be paired with a ratio threshold exceeding
 *  {@link HIGH_CONTRAST_RATIO_THRESHOLD} to actually trigger `high_contrast`.
 *  Raising this tolerates more uneven lighting. */
export const MAX_STD_DEV = 70;

/** Minimum dark-or-bright ratio (0–1) that, combined with stddev exceeding
 *  {@link MAX_STD_DEV}, triggers `high_contrast`.
 *
 *  The AND-gate prevents false positives: high stddev with evenly distributed
 *  luminance is normal. Only when the spread is extreme AND pixels cluster at
 *  an extreme is the lighting truly problematic (e.g. half the face in shadow).
 *  Raising this requires a larger cluster at the extreme to trigger. */
export const HIGH_CONTRAST_RATIO_THRESHOLD = 0.18;
