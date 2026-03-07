/**
 * Perceptual color distance in OKLCH space with circular hue handling.
 *
 * Weighted Euclidean metric across lightness, chroma, and hue that feeds
 * {@link colorBoosts} in `color-matching.ts` and {@link classifyTongueColor}
 * in `color-classification.ts`.
 *
 * @module
 */

import { isAchromatic, type Oklch } from 'hex-to-oklch';

/** Weight for lightness axis in the distance formula. Equal weighting (1) treats ΔL at face value. */
const LIGHTNESS_WEIGHT = 1;

/** Weight for chroma axis in the distance formula. Equal weighting (1) after {@link CHROMA_SCALE} normalization. */
const CHROMA_WEIGHT = 1;

/** Weight for hue axis in the distance formula. Equal weighting (1) after 0–180° → 0–1 normalization. */
const HUE_WEIGHT = 1;

/**
 * Typical upper bound of sRGB chroma in OKLCH.
 *
 * Normalizing by this keeps ΔC on a comparable 0–1-ish scale with
 * normalized ΔL and circular Δh. Most sRGB colors have chroma below 0.4;
 * highly saturated display primaries can exceed it slightly.
 */
const CHROMA_SCALE = 0.4;

/**
 * Maximum possible distance given the current weights.
 *
 * Derived from `√(LIGHTNESS_WEIGHT + CHROMA_WEIGHT + HUE_WEIGHT)` — the
 * theoretical worst case where each normalized axis differs by 1.
 * Used by {@link distanceToScore} in `color-classification.ts` to map
 * raw distances into 0–1 scores.
 */
export const MAX_DISTANCE = Math.sqrt(LIGHTNESS_WEIGHT + CHROMA_WEIGHT + HUE_WEIGHT);

/**
 * Compute weighted OKLCH distance between two colors.
 *
 * Hue is circular (0° and 360° are identical). For achromatic
 * colors, hue is ignored because it is perceptually meaningless.
 *
 * @param a - First color in OKLCH space.
 * @param b - Second color in OKLCH space.
 * @returns Weighted Euclidean distance (0 = identical, {@link MAX_DISTANCE} = maximally different).
 *
 * @example
 * ```ts
 * import { hexToOklch } from 'hex-to-oklch';
 * const d = oklchDistance(hexToOklch('#ff0000'), hexToOklch('#00ff00'));
 * // d ≈ 1.18
 * ```
 */
export function oklchDistance(a: Oklch, b: Oklch): number {
	const lightnessDiff = Math.abs(a.l - b.l);
	const chromaDiff = Math.abs(a.c - b.c) / CHROMA_SCALE;

	const rawHueDiff = Math.abs(a.h - b.h);
	const hueDiff = isAchromatic(a) || isAchromatic(b)
		? 0
		: Math.min(rawHueDiff, 360 - rawHueDiff) / 180;

	return Math.sqrt(
		lightnessDiff * lightnessDiff * LIGHTNESS_WEIGHT
			+ chromaDiff * chromaDiff * CHROMA_WEIGHT
			+ hueDiff * hueDiff * HUE_WEIGHT,
	);
}
