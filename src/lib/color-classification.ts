/**
 * Nearest-neighbor tongue color classification in OKLCH space.
 *
 * Converts the average tongue {@link RgbColor} to OKLCH, ranks every
 * {@link TongueType} by {@link oklchDistance}, and produces a
 * {@link TongueColorClassification} with confidence score.
 *
 * @module
 */

import { hexToOklch, type Oklch, rgbToOklch } from 'hex-to-oklch';
import { TONGUE_TYPES, type TongueType } from '../data/tongue-types.ts';
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

/**
 * Compute classification confidence from ranked matches.
 *
 * Blends absolute score (70%) with margin between 1st and 2nd place (30%).
 * High confidence requires both a close absolute match AND clear separation
 * from the runner-up.
 *
 * @param rankings - Type matches sorted by distance ascending.
 * @returns Confidence in [0, 1], rounded to 3 decimal places.
 */
function computeConfidence(rankings: readonly TypeMatch[]): number {
	const primary = rankings[0];
	if (primary === undefined) return 0;

	const secondary = rankings[1];
	if (secondary === undefined) {
		return Math.round(distanceToScore(primary.distance) * 1000) / 1000;
	}

	const absoluteScore = distanceToScore(primary.distance);
	const marginScore = clamp((secondary.distance - primary.distance) / MAX_DISTANCE, 0, 1);
	const weighted = absoluteScore * 0.7 + marginScore * 0.3;

	return Math.round(weighted * 1000) / 1000;
}

/**
 * Classify a tongue's average color against known tongue types.
 *
 * Converts `averageColor` to OKLCH, computes {@link oklchDistance} to every
 * type's reference hex, ranks by proximity, and returns the best match with
 * a blended confidence score.
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
		.sort((a, b) => a.distance - b.distance);

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
