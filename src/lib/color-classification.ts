import { hexToOklch, type Oklch, rgbToOklch } from 'hex-to-oklch';
import { TONGUE_TYPES, type TongueType } from '../data/tongue-types.ts';
import type { RgbColor } from './color-correction.ts';
import { MAX_DISTANCE, oklchDistance } from './oklch-distance.ts';

export interface TypeMatch {
	readonly type: TongueType;
	readonly distance: number;
	readonly score: number;
}

export interface TongueColorClassification {
	readonly averageColor: RgbColor;
	readonly oklch: Oklch;
	readonly matchedType: TongueType;
	readonly confidence: number;
	readonly rankings: readonly TypeMatch[];
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function distanceToScore(distance: number): number {
	return clamp(1 - distance / MAX_DISTANCE, 0, 1);
}

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
