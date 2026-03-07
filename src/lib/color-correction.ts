/**
 * Gray-world white-balance correction for tongue images.
 *
 * Computes per-channel gain from the whole scene so ambient lighting bias
 * is neutralized without destroying the tongue's own chromaticity.
 * Produces a corrected `ImageData` and the average tongue color (from the
 * masked region) for downstream {@link classifyTongueColor}.
 *
 * @module
 */

import { err, ok, type Result } from './result.ts';
import type { TongueMask } from './tongue-segmentation.ts';

/**
 * An sRGB color with 0–255 integer channels.
 *
 * Used as the common color interchange type between correction,
 * classification, and display layers.
 */
export interface RgbColor {
	/** Red channel (0–255). */
	readonly r: number;
	/** Green channel (0–255). */
	readonly g: number;
	/** Blue channel (0–255). */
	readonly b: number;
}

/**
 * Successful output of {@link applyGrayWorldCorrection}.
 */
export interface ColorCorrectionResult {
	/** White-balanced copy of the input `ImageData`. */
	readonly correctedImageData: ImageData;
	/** Mean RGB of the tongue-masked pixels after correction. */
	readonly averageTongueColor: RgbColor;
}

/**
 * Discriminated union of errors from {@link applyGrayWorldCorrection}.
 *
 * - `mask_size_mismatch` — mask dimensions don't match the image.
 * - `no_masked_pixels` — mask contains no tongue pixels (all zeros).
 */
export type ColorCorrectionError =
	| { readonly kind: 'mask_size_mismatch' }
	| { readonly kind: 'no_masked_pixels' };

/**
 * Clamp and round a floating-point channel value to the 0–255 byte range.
 *
 * @param value - Unclamped channel value (may be fractional or out of range after gain).
 * @returns Integer in [0, 255].
 *
 * @example
 * ```ts
 * clampChannel(280.7); // 255
 * clampChannel(-3);    // 0
 * clampChannel(128.4); // 128
 * ```
 */
export function clampChannel(value: number): number {
	return Math.min(255, Math.max(0, Math.round(value)));
}

/**
 * Per-channel mean RGB statistics for a region of pixels.
 */
interface ChannelStats {
	/** Mean red value (0–255 scale, fractional). */
	readonly rMean: number;
	/** Mean green value (0–255 scale, fractional). */
	readonly gMean: number;
	/** Mean blue value (0–255 scale, fractional). */
	readonly bMean: number;
	/** Number of pixels included in the averages. */
	readonly pixelCount: number;
}

/**
 * Compute channel means over every pixel in the image.
 *
 * @param imageData - Source image pixel data.
 * @returns Channel means and total pixel count.
 */
function computeWholeImageChannelStats(imageData: ImageData): ChannelStats {
	let rSum = 0;
	let gSum = 0;
	let bSum = 0;

	for (let channelIndex = 0; channelIndex < imageData.data.length; channelIndex += 4) {
		const r = imageData.data[channelIndex];
		const g = imageData.data[channelIndex + 1];
		const b = imageData.data[channelIndex + 2];
		if (r === undefined || g === undefined || b === undefined) continue;

		rSum += r;
		gSum += g;
		bSum += b;
	}

	const pixelCount = imageData.width * imageData.height;
	return {
		rMean: rSum / pixelCount,
		gMean: gSum / pixelCount,
		bMean: bSum / pixelCount,
		pixelCount,
	};
}

/**
 * Compute channel means over only the masked (tongue) pixels.
 *
 * @param imageData - Source image pixel data.
 * @param mask - Binary mask where `1` = tongue pixel.
 * @returns Channel means, or `undefined` if no pixels are masked.
 */
function computeMaskedChannelStats(
	imageData: ImageData,
	mask: Uint8Array,
): ChannelStats | undefined {
	let rSum = 0;
	let gSum = 0;
	let bSum = 0;
	let pixelCount = 0;

	for (let pixelIndex = 0; pixelIndex < mask.length; pixelIndex++) {
		if (mask[pixelIndex] !== 1) continue;

		const channelIndex = pixelIndex * 4;
		const r = imageData.data[channelIndex];
		const g = imageData.data[channelIndex + 1];
		const b = imageData.data[channelIndex + 2];
		if (r === undefined || g === undefined || b === undefined) continue;

		rSum += r;
		gSum += g;
		bSum += b;
		pixelCount++;
	}

	if (pixelCount === 0) {
		return undefined;
	}

	return {
		rMean: rSum / pixelCount,
		gMean: gSum / pixelCount,
		bMean: bSum / pixelCount,
		pixelCount,
	};
}

/**
 * Apply per-channel multiplicative gains to every pixel.
 *
 * Creates a new `ImageData`; alpha is preserved unchanged.
 *
 * @param imageData - Source image to correct.
 * @param rGain - Red channel multiplier.
 * @param gGain - Green channel multiplier.
 * @param bGain - Blue channel multiplier.
 * @returns New `ImageData` with gain-adjusted channels clamped to 0–255.
 */
function applyGains(
	imageData: ImageData,
	rGain: number,
	gGain: number,
	bGain: number,
): ImageData {
	const correctedData = new Uint8ClampedArray(imageData.data.length);

	for (let channelIndex = 0; channelIndex < imageData.data.length; channelIndex += 4) {
		const r = imageData.data[channelIndex];
		const g = imageData.data[channelIndex + 1];
		const b = imageData.data[channelIndex + 2];
		const a = imageData.data[channelIndex + 3];

		if (r === undefined || g === undefined || b === undefined || a === undefined) {
			continue;
		}

		correctedData[channelIndex] = clampChannel(r * rGain);
		correctedData[channelIndex + 1] = clampChannel(g * gGain);
		correctedData[channelIndex + 2] = clampChannel(b * bGain);
		correctedData[channelIndex + 3] = a;
	}

	return new ImageData(correctedData, imageData.width, imageData.height);
}

/**
 * Compute the average RGB of masked pixels.
 *
 * @param imageData - Source image (typically already gain-corrected).
 * @param mask - Binary mask where `1` = tongue pixel.
 * @returns Clamped average {@link RgbColor}, or `undefined` if mask has no pixels.
 */
function computeAverageMaskedColor(imageData: ImageData, mask: Uint8Array): RgbColor | undefined {
	const stats = computeMaskedChannelStats(imageData, mask);
	if (stats === undefined) return undefined;

	return {
		r: clampChannel(stats.rMean),
		g: clampChannel(stats.gMean),
		b: clampChannel(stats.bMean),
	};
}

/**
 * Apply gray-world white-balance correction and extract average tongue color.
 *
 * Assumes the mean color of the entire scene should be neutral gray.
 * Gains are computed from the whole image (not just the tongue) so ambient
 * lighting bias is corrected without warping the tongue's own chromaticity.
 *
 * @param imageData - Raw image pixel data from the cropped face region.
 * @param tongueMask - Binary {@link TongueMask} identifying tongue pixels.
 * @returns {@link Result} with corrected image + average tongue color, or a
 *   {@link ColorCorrectionError} if dimensions mismatch or no tongue pixels exist.
 *
 * @example
 * ```ts
 * const result = applyGrayWorldCorrection(imageData, tongueMask);
 * if (result.ok) {
 *   const { correctedImageData, averageTongueColor } = result.value;
 * }
 * ```
 */
export function applyGrayWorldCorrection(
	imageData: ImageData,
	tongueMask: TongueMask,
): Result<ColorCorrectionResult, ColorCorrectionError> {
	if (
		tongueMask.width !== imageData.width
		|| tongueMask.height !== imageData.height
		|| tongueMask.mask.length !== imageData.width * imageData.height
	) {
		return err({ kind: 'mask_size_mismatch' });
	}

	// Gray-world assumption: the average color of the entire scene should be
	// neutral gray. Compute gains from the whole image so ambient lighting is
	// corrected without destroying the tongue's own chromaticity.
	const sceneStats = computeWholeImageChannelStats(imageData);
	const targetMean = (sceneStats.rMean + sceneStats.gMean + sceneStats.bMean) / 3;
	const rGain = targetMean / Math.max(sceneStats.rMean, 1e-6);
	const gGain = targetMean / Math.max(sceneStats.gMean, 1e-6);
	const bGain = targetMean / Math.max(sceneStats.bMean, 1e-6);

	const correctedImageData = applyGains(imageData, rGain, gGain, bGain);
	const averageTongueColor = computeAverageMaskedColor(correctedImageData, tongueMask.mask);

	if (averageTongueColor === undefined) {
		return err({ kind: 'no_masked_pixels' });
	}

	return ok({ correctedImageData, averageTongueColor });
}
