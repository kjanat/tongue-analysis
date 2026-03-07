/**
 * Color-based weight boosting for tongue type selection.
 *
 * Converts the image's {@link ColorProfile} to OKLCH, measures perceptual
 * distance to each {@link TongueType}'s reference color, and returns
 * Gaussian-falloff multipliers that bias the PRNG toward plausible matches.
 *
 * @module
 */

import { hexToOklch, type Oklch, rgbToOklch } from 'hex-to-oklch';
import type { TongueType } from '../data/tongue-types.ts';
import type { ColorProfile } from './color-analysis.ts';
import type { RgbColor } from './color-correction.ts';
import { clamp } from './math-utils.ts';
import { oklchDistance } from './oklch-distance.ts';

// ── HSL profile → OKLCH conversion ─────────────────────────────

/**
 * Normalize a hue angle into the 0–360° range.
 *
 * @param hue - Hue in degrees (may be negative or >360).
 * @returns Equivalent hue in [0, 360).
 */
function normalizeHueDegrees(hue: number): number {
	return ((hue % 360) + 360) % 360;
}

/**
 * Convert HSL to sRGB.
 *
 * Intermediate step for {@link profileToOklch}: the `hex-to-oklch` library
 * accepts RGB, not HSL directly.
 *
 * @param h - Hue in degrees (0–360).
 * @param s - Saturation as percentage (0–100).
 * @param l - Lightness as percentage (0–100).
 * @returns RGB color with channels in 0–255.
 */
function hslToRgb(h: number, s: number, l: number): RgbColor {
	const hue = normalizeHueDegrees(h) / 360;
	const sat = clamp(s, 0, 100) / 100;
	const lit = clamp(l, 0, 100) / 100;

	if (sat === 0) {
		const gray = Math.round(lit * 255);
		return { r: gray, g: gray, b: gray };
	}

	const q = lit < 0.5 ? lit * (1 + sat) : lit + sat - lit * sat;
	const p = 2 * lit - q;

	function hueToChannel(t: number): number {
		const wrapped = (t + 1) % 1;
		if (wrapped < 1 / 6) return p + (q - p) * 6 * wrapped;
		if (wrapped < 1 / 2) return q;
		if (wrapped < 2 / 3) return p + (q - p) * (2 / 3 - wrapped) * 6;
		return p;
	}

	return {
		r: Math.round(hueToChannel(hue + 1 / 3) * 255),
		g: Math.round(hueToChannel(hue) * 255),
		b: Math.round(hueToChannel(hue - 1 / 3) * 255),
	};
}

/**
 * Convert a {@link ColorProfile} (HSL) into OKLCH for perceptual distance comparison.
 *
 * @param profile - HSL color profile extracted from the tongue image.
 * @returns OKLCH representation of the profile's dominant color.
 */
function profileToOklch(profile: ColorProfile): Oklch {
	const rgb = hslToRgb(profile.hue, profile.saturation, profile.lightness);
	return rgbToOklch(rgb);
}

// ── Weight boosting ────────────────────────────────────────────

/**
 * Minimum boost — distant colors still selectable.
 *
 * Ensures every tongue type retains a non-zero selection probability
 * even when chromatically distant from the sample.
 */
const MIN_BOOST = 0.3;

/**
 * Maximum boost — close matches strongly favoured.
 *
 * A near-exact color match gets a 3× weight multiplier over base.
 */
const MAX_BOOST = 3.0;

/**
 * Sharpness of the exponential falloff.
 *
 * Controls the width of the Gaussian bell curve. Higher values create
 * a narrower "cone" around each type color.
 *
 * At k=5: d=0 → 1.0, d=0.2 → 0.82, d=0.5 → 0.29, d=0.8 → 0.04.
 */
const FALLOFF_K = 5;

/**
 * Compute per-type weight multipliers from image color vs tongue type colors.
 *
 * Uses absolute Gaussian-style falloff: `exp(-k * d²)` via
 * {@link oklchDistance}. When image color is far from ALL types, all
 * boosts ≈ {@link MIN_BOOST}, so the PRNG dominates. Only genuinely
 * close matches get meaningful lift up to {@link MAX_BOOST}.
 *
 * @param profile - HSL color profile from {@link extractColor} or the live analysis hook.
 * @param types - Tongue type definitions to compare against.
 * @returns One boost multiplier per type, in the same order as `types`.
 *
 * @example
 * ```ts
 * const boosts = colorBoosts(
 *   { hue: 0, saturation: 60, lightness: 50 },
 *   TONGUE_TYPES,
 * );
 * // boosts[i] ∈ [0.3, 3.0] — higher means closer color match
 * ```
 */
export function colorBoosts(
	profile: ColorProfile,
	types: readonly TongueType[],
): readonly number[] {
	const imageOklch = profileToOklch(profile);

	return types.map((t) => {
		const d = oklchDistance(imageOklch, hexToOklch(t.color.hex));
		const similarity = Math.exp(-FALLOFF_K * d * d); // 0–1, absolute
		return MIN_BOOST + similarity * (MAX_BOOST - MIN_BOOST);
	});
}
