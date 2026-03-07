import {
	BRIGHT_PIXEL_LUMINANCE,
	DARK_PIXEL_LUMINANCE,
	MAX_BRIGHT_RATIO,
	MAX_DARK_RATIO,
	MAX_MEAN_LUMINANCE,
	MAX_STD_DEV,
	MIN_MEAN_LUMINANCE,
} from './thresholds.ts';
import type { LightingStats } from './types.ts';

export interface LightingIssue {
	readonly issue: 'too_dark' | 'too_bright' | 'high_contrast';
	readonly meanLuminance: number;
	readonly darkRatio: number;
	readonly brightRatio: number;
}

export function computeLightingStats(
	imageData: ImageData,
	allowedMask: Uint8Array,
): LightingStats | undefined {
	const expectedPixelCount = imageData.data.length / 4;
	if (!Number.isInteger(expectedPixelCount) || allowedMask.length !== expectedPixelCount) {
		return undefined;
	}

	let luminanceSum = 0;
	let luminanceSquaredSum = 0;
	let darkCount = 0;
	let brightCount = 0;
	let sampleCount = 0;

	for (let pixelIndex = 0; pixelIndex < allowedMask.length; pixelIndex++) {
		if (allowedMask[pixelIndex] !== 1) continue;

		const channelIndex = pixelIndex * 4;
		const r = imageData.data[channelIndex];
		const g = imageData.data[channelIndex + 1];
		const b = imageData.data[channelIndex + 2];
		if (r === undefined || g === undefined || b === undefined) continue;

		const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		luminanceSum += luminance;
		luminanceSquaredSum += luminance * luminance;
		sampleCount++;

		if (luminance < DARK_PIXEL_LUMINANCE) darkCount++;
		if (luminance > BRIGHT_PIXEL_LUMINANCE) brightCount++;
	}

	if (sampleCount === 0) return undefined;

	const meanLuminance = luminanceSum / sampleCount;
	const variance = Math.max(
		0,
		luminanceSquaredSum / sampleCount - meanLuminance * meanLuminance,
	);

	return {
		meanLuminance,
		stdDevLuminance: Math.sqrt(variance),
		darkRatio: darkCount / sampleCount,
		brightRatio: brightCount / sampleCount,
		sampleCount,
	};
}

export function detectLightingIssue(
	imageData: ImageData,
	allowedMask: Uint8Array,
): LightingIssue | undefined {
	const stats = computeLightingStats(imageData, allowedMask);
	if (stats === undefined || stats.sampleCount < 50) return undefined;

	if (stats.meanLuminance < MIN_MEAN_LUMINANCE || stats.darkRatio > MAX_DARK_RATIO) {
		return {
			issue: 'too_dark',
			meanLuminance: stats.meanLuminance,
			darkRatio: stats.darkRatio,
			brightRatio: stats.brightRatio,
		};
	}

	if (stats.meanLuminance > MAX_MEAN_LUMINANCE || stats.brightRatio > MAX_BRIGHT_RATIO) {
		return {
			issue: 'too_bright',
			meanLuminance: stats.meanLuminance,
			darkRatio: stats.darkRatio,
			brightRatio: stats.brightRatio,
		};
	}

	if (
		stats.stdDevLuminance > MAX_STD_DEV
		&& (stats.darkRatio > 0.18 || stats.brightRatio > 0.18)
	) {
		return {
			issue: 'high_contrast',
			meanLuminance: stats.meanLuminance,
			darkRatio: stats.darkRatio,
			brightRatio: stats.brightRatio,
		};
	}

	return undefined;
}
