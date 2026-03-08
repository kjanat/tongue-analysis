/**
 * Nearest-neighbor tongue color classification in OKLCH space.
 *
 * Converts the average tongue {@link RgbColor} to OKLCH, ranks every
 * {@link TongueType} by {@link oklchDistance}, and produces a
 * {@link TongueColorClassification} with confidence score.
 *
 * @module
 */

import { TONGUE_TYPES, type TongueType } from '$data/tongue-types.ts';
import { hexToOklch, type Oklch, rgbToOklch } from 'hex-to-oklch';
import type { RgbColor } from './color-correction.ts';
import { clamp } from './math-utils.ts';
import { MAX_DISTANCE, oklchDistance } from './oklch-distance.ts';

/**
 * A single candidate match between the sample color and a tongue type.
 */
export interface TypeMatch {
	/** The tongue type being compared. */
	readonly type: TongueType;
	/** Raw {@link oklchDistance} from sample to this type's reference color. */
	readonly distance: number;
	/** Normalized similarity score (0 = worst, 1 = exact match). */
	readonly score: number;
}

/**
 * Full classification result: best match, confidence, and ranked alternatives.
 *
 * Produced by {@link classifyTongueColor} and consumed by the diagnosis
 * generator and results display.
 */
export interface TongueColorClassification {
	/** Input average tongue color (post gray-world correction). */
	readonly averageColor: RgbColor;
	/** OKLCH conversion of {@link averageColor}. */
	readonly oklch: Oklch;
	/** Closest tongue type by perceptual distance. */
	readonly matchedType: TongueType;
	/** Combined confidence (0–1) from absolute score and margin to runner-up. */
	readonly confidence: number;
	/** All types ranked by distance, ascending (best first). */
	readonly rankings: readonly TypeMatch[];
}

/**
 * Convert raw OKLCH distance to a 0–1 similarity score.
 *
 * Linear mapping: 0 distance → score 1, {@link MAX_DISTANCE} → score 0.
 *
 * @param distance - Raw distance from {@link oklchDistance}.
 * @returns Clamped similarity score in [0, 1].
 */
function distanceToScore(distance: number): number {
	return clamp(1 - distance / MAX_DISTANCE, 0, 1);
}

/** Weight of the absolute-fit component in the confidence blend. */
const ABSOLUTE_WEIGHT = 0.35;

/** Weight of the relative-separation component in the confidence blend. */
const SEPARATION_WEIGHT = 0.65;

/**
 * Compute classification confidence from ranked matches.
 *
 * Self-calibrating: derives its normalization scale from the rankings
 * themselves rather than a precomputed palette constant. This makes
 * confidence correct for any subset of tongue types, not just the full
 * {@link TONGUE_TYPES} palette.
 *
 * Two components:
 * - **Absolute fit** (35%) — how close the best match is relative to
 *   the median ranking distance (the "typical" match distance for this
 *   sample). A best match much closer than the median reads as high fit.
 * - **Relative separation** (65%) — ratio of the gap between 1st and 2nd
 *   place to the runner-up distance. Dominates because "how unambiguous
 *   is this?" is what humans expect from "confidence."
 *
 * @param rankings - Type matches sorted by distance ascending.
 * @returns Confidence in [0, 1], rounded to 3 decimal places.
 */
function computeConfidence(rankings: readonly TypeMatch[]): number {
	const primary = rankings[0];
	if (primary === undefined) return 0;

	const mid = Math.floor(rankings.length / 2);
	const scale = rankings[mid]?.distance ?? MAX_DISTANCE;
	const absoluteFit = clamp(1 - primary.distance / scale, 0, 1);

	const secondary = rankings[1];
	if (secondary === undefined) {
		return Math.round(absoluteFit * 1000) / 1000;
	}

	const separation = secondary.distance > 0
		? clamp((secondary.distance - primary.distance) / secondary.distance, 0, 1)
		: 0;

	const weighted = absoluteFit * ABSOLUTE_WEIGHT + separation * SEPARATION_WEIGHT;
	return Math.round(weighted * 1000) / 1000;
}

// ── Display confidence ───────────────────────────

/** Baseline multiplier — even a tied match shows decent confidence. */
const DISPLAY_BASE = 0.75;

/** Bonus multiplier for clear separation from the runner-up. */
const DISPLAY_MARGIN_BONUS = 0.25;

/**
 * Compute a user-facing confidence from classification data.
 *
 * The raw {@link TongueColorClassification.confidence} is a conservative
 * internal metric (65% weighted toward inter-type separation) that produces
 * low values even for good matches when multiple types cluster nearby.
 * Users interpret "22%" as "barely sure" even when the winner is 1.5× closer
 * than any alternative.
 *
 * This function produces a display-friendly value that better matches user
 * expectations of "how confident is the system?":
 *
 * ```
 * displayConfidence = score × (BASE + MARGIN_BONUS × marginFactor)
 * ```
 *
 * - **score** — the winner's raw perceptual similarity (`1 − distance / MAX_DISTANCE`).
 *   Typically 0.6–0.9 for real tongue images. Anchors the result in actual
 *   match quality.
 * - **marginFactor** — `clamp(runnerUpDistance / winnerDistance − 1, 0, 1)`.
 *   0 when tied, 1 when the runner-up is ≥ 2× farther. Rewards clear winners.
 * - **BASE (0.75)** — ensures a good perceptual match reads as confident even
 *   without large separation.
 * - **MARGIN_BONUS (0.25)** — adds up to 25% extra for decisive wins.
 *
 * Typical outputs: 55–85% for real tongue images, with strong matches
 * reaching 90%+. This is strictly a presentation metric — all internal
 * gating uses the raw confidence.
 *
 * @param classification - Output of {@link classifyTongueColor}.
 * @returns Display confidence in [0, 1], rounded to 3 decimal places.
 */
export function computeDisplayConfidence(classification: TongueColorClassification): number {
	const primary = classification.rankings[0];
	if (primary === undefined) return 0;

	const score = primary.score;
	const secondary = classification.rankings[1];

	if (secondary === undefined) {
		return Math.round(score * 1000) / 1000;
	}

	const ratio = primary.distance > 0
		? secondary.distance / primary.distance
		: 2;
	const marginFactor = clamp(ratio - 1, 0, 1);

	const display = score * (DISPLAY_BASE + DISPLAY_MARGIN_BONUS * marginFactor);
	return Math.round(clamp(display, 0, 1) * 1000) / 1000;
}

/**
 * Classify a tongue's average color against known tongue types.
 *
 * Converts `averageColor` to OKLCH, computes {@link oklchDistance} to every
 * type's reference hex, and ranks by weight-adjusted proximity. Each type's
 * {@link TongueType.weight} scales its effective distance: `distance / weight`.
 * A weight below 1 (e.g. 0.4 for "normaal") increases effective distance,
 * making that type harder to match so more interesting diagnoses surface
 * when raw distances are similar.
 *
 * The {@link TypeMatch.distance} and {@link TypeMatch.score} fields always
 * reflect the *raw* perceptual distance — weight only affects ranking order.
 * {@link computeConfidence} operates on raw distances from the reordered list.
 *
 * @param averageColor - Mean RGB of the tongue region (from {@link applyGrayWorldCorrection}).
 * @param types - Tongue type definitions to match against (defaults to {@link TONGUE_TYPES}).
 * @returns Full {@link TongueColorClassification} with match, confidence, and rankings.
 * @throws If `types` is empty (no candidates to match).
 *
 * @example
 * ```ts
 * const classification = classifyTongueColor({ r: 200, g: 120, b: 130 });
 * console.log(classification.matchedType.name, classification.confidence);
 * ```
 */
export function classifyTongueColor(
	averageColor: RgbColor,
	types: readonly TongueType[] = TONGUE_TYPES,
): TongueColorClassification {
	const sample = rgbToOklch(averageColor);

	const rankings = types
		.map((type): TypeMatch => {
			const target = hexToOklch(type.color.hex);
			const distance = oklchDistance(sample, target);
			return {
				type,
				distance,
				score: distanceToScore(distance),
			};
		})
		.sort((a, b) => a.distance / a.type.weight - b.distance / b.type.weight);

	const matchedType = rankings[0]?.type;
	if (matchedType === undefined) {
		throw new Error('No tongue types available for classification');
	}

	return {
		averageColor,
		oklch: sample,
		matchedType,
		confidence: computeConfidence(rankings),
		rankings,
	};
}
