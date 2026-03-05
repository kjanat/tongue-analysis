import { hexToOklch, isAchromatic, type Oklch, rgbToOklch } from 'hex-to-oklch';
import { TONGUE_TYPES, type TongueType } from '../data/tongue-types.ts';
import type { RgbColor } from './color-correction.ts';

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

const LIGHTNESS_WEIGHT = 1;
const CHROMA_WEIGHT = 1;
const HUE_WEIGHT = 1;
const CHROMA_SCALE = 0.4;
const MAX_DISTANCE = Math.sqrt(LIGHTNESS_WEIGHT + CHROMA_WEIGHT + HUE_WEIGHT);

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function oklchDistance(a: Oklch, b: Oklch): number {
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
