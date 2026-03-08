/**
 * Lighting quality analysis for tongue images.
 *
 * Computes luminance statistics over masked pixels and classifies
 * frames as too dark, too bright, or high-contrast. Used as both a
 * pre-check and a secondary diagnostic when segmentation or
 * classification fails.
 *
 * @module
 */

import {
	BRIGHT_PIXEL_LUMINANCE,
	DARK_PIXEL_LUMINANCE,
	HIGH_CONTRAST_RATIO_THRESHOLD,
	MAX_BRIGHT_RATIO,
	MAX_DARK_RATIO,
	MAX_MEAN_LUMINANCE,
	MAX_STD_DEV,
	MIN_LIGHTING_SAMPLE_COUNT,
	MIN_MEAN_LUMINANCE,
} from './thresholds.ts';
import type { LightingStats } from './types.ts';

/**
 * Describes a detected lighting problem.
 *
 * Intersected into the `poor_lighting` variant of {@link AnalysisError}
 * to give the UI enough detail for a user-friendly message.
 */
export interface LightingIssue {
	/**
	 * The category of lighting problem.
	 * - `too_dark` — Mean luminance below threshold or excessive dark pixels.
	 * - `too_bright` — Mean luminance above threshold or excessive bright pixels.
	 * - `high_contrast` — High luminance std dev with both dark and bright extremes.
	 */
	readonly issue: 'too_dark' | 'too_bright' | 'high_contrast';
	/** Average luminance (0–255) of the sampled region. */
	readonly meanLuminance: number;
	/** Fraction of sampled pixels below {@link DARK_PIXEL_LUMINANCE}. */
	readonly darkRatio: number;
	/** Fraction of sampled pixels above {@link BRIGHT_PIXEL_LUMINANCE}. */
	readonly brightRatio: number;
}

/**
 * Compute luminance statistics over the allowed pixels of an image.
 *
 * Uses BT.709 luminance coefficients (`0.2126R + 0.7152G + 0.0722B`)
 * and a single-pass algorithm to derive mean, standard deviation, and
 * dark/bright pixel ratios.
 *
 * @param imageData - RGBA pixel data (`.data.length` must be `4 * allowedMask.length`).
 * @param allowedMask - Per-pixel mask where `1` marks pixels to include.
 * @returns Lighting statistics, or `undefined` if the mask is empty or
 *   dimensions are inconsistent.
 *
 * @example
 * ```ts
 * const stats = computeLightingStats(crop.imageData, mask);
 * if (stats) console.log(`mean luminance: ${stats.meanLuminance}`);
 * ```
 */
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

/**
 * Detect whether lighting conditions are too poor for reliable analysis.
 *
 * Computes statistics via {@link computeLightingStats}, then checks
 * against thresholds in order: too dark, too bright, high contrast.
 * Returns the first matching issue, or `undefined` if lighting is
 * acceptable.
 *
 * @param imageData - RGBA pixel data of the cropped region.
 * @param allowedMask - Per-pixel mask (1 = include).
 * @returns The detected {@link LightingIssue}, or `undefined` if lighting passes.
 *
 * @example
 * ```ts
 * const issue = detectLightingIssue(crop.imageData, mask);
 * if (issue) showWarning(`Lighting: ${issue.issue}`);
 * ```
 */
export function detectLightingIssue(
	imageData: ImageData,
	allowedMask: Uint8Array,
): LightingIssue | undefined {
	const stats = computeLightingStats(imageData, allowedMask);
	if (stats === undefined || stats.sampleCount < MIN_LIGHTING_SAMPLE_COUNT) return undefined;

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
		&& (stats.darkRatio > HIGH_CONTRAST_RATIO_THRESHOLD || stats.brightRatio > HIGH_CONTRAST_RATIO_THRESHOLD)
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
