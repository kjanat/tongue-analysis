import { err, ok, type Result } from './result.ts';
import type { TongueMask } from './tongue-segmentation.ts';

export interface RgbColor {
	readonly r: number;
	readonly g: number;
	readonly b: number;
}

export interface ColorCorrectionResult {
	readonly correctedImageData: ImageData;
	readonly averageTongueColor: RgbColor;
}

export type ColorCorrectionError =
	| { readonly kind: 'mask_size_mismatch' }
	| { readonly kind: 'no_masked_pixels' };

export function clampChannel(value: number): number {
	return Math.min(255, Math.max(0, Math.round(value)));
}

interface ChannelStats {
	readonly rMean: number;
	readonly gMean: number;
	readonly bMean: number;
	readonly pixelCount: number;
}

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

function computeAverageMaskedColor(imageData: ImageData, mask: Uint8Array): RgbColor | undefined {
	const stats = computeMaskedChannelStats(imageData, mask);
	if (stats === undefined) return undefined;

	return {
		r: clampChannel(stats.rMean),
		g: clampChannel(stats.gMean),
		b: clampChannel(stats.bMean),
	};
}

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
