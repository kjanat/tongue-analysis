import { isAchromatic, type Oklch } from 'hex-to-oklch';

const LIGHTNESS_WEIGHT = 1;
const CHROMA_WEIGHT = 1;
const HUE_WEIGHT = 1;

/**
 * Typical upper bound of sRGB chroma in OKLCH.
 *
 * Normalizing by this keeps ΔC on a comparable 0–1-ish scale with
 * normalized ΔL and circular Δh.
 */
const CHROMA_SCALE = 0.4;

/**
 * Maximum possible distance given the current weights.
 * Used to convert raw distances into 0–1 scores.
 */
export const MAX_DISTANCE = Math.sqrt(LIGHTNESS_WEIGHT + CHROMA_WEIGHT + HUE_WEIGHT);

/**
 * Compute weighted OKLCH distance between two colors.
 *
 * Hue is circular (0° and 360° are identical). For achromatic
 * colors, hue is ignored because it is perceptually meaningless.
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
