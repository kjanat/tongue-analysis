import { err, ok, type Result } from './result.ts';

export interface TongueMask {
	readonly mask: Uint8Array;
	readonly width: number;
	readonly height: number;
	readonly pixelCount: number;
	readonly componentCount: number;
	readonly largestComponentRatio: number;
	readonly centroidYRatio: number;
	readonly passesCentroidHeuristic: boolean;
}

export interface HsvThreshold {
	readonly hueMin: number;
	readonly hueMax: number;
	readonly saturationMin: number;
	readonly saturationMax: number;
	readonly valueMin: number;
	readonly valueMax: number;
}

export type TongueSegmentationError =
	| { readonly kind: 'empty_input' }
	| { readonly kind: 'allowed_mask_size_mismatch' }
	| { readonly kind: 'no_tongue_pixels_detected' }
	| {
		readonly kind: 'multiple_regions_detected';
		readonly componentCount: number;
		readonly largestComponentRatio: number;
	}
	| {
		readonly kind: 'insufficient_pixels';
		readonly count: number;
		readonly minimumRequired: number;
	};

const DEFAULT_HSV_THRESHOLD: HsvThreshold = {
	hueMin: 330,
	hueMax: 20,
	saturationMin: 20,
	saturationMax: 80,
	valueMin: 35,
	valueMax: 95,
};

const MIN_TONGUE_PIXELS = 120;
const MIN_CENTROID_Y_RATIO = 0.45;
const MIN_LARGEST_COMPONENT_RATIO = 0.55;
const REDNESS_OVER_GREEN_MIN = 12;
const REDNESS_OVER_BLUE_MIN = 8;
const MIN_RED_CHANNEL = 70;

interface HsvColor {
	readonly h: number;
	readonly s: number;
	readonly v: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function rgbToHsv(r: number, g: number, b: number): HsvColor {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;

	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const delta = max - min;

	let hue = 0;
	if (delta !== 0) {
		if (max === rn) {
			hue = 60 * (((gn - bn) / delta) % 6);
		} else if (max === gn) {
			hue = 60 * ((bn - rn) / delta + 2);
		} else {
			hue = 60 * ((rn - gn) / delta + 4);
		}
	}

	const normalizedHue = (hue + 360) % 360;
	const saturation = max === 0 ? 0 : (delta / max) * 100;
	const value = max * 100;

	return { h: normalizedHue, s: saturation, v: value };
}

function isHueInRange(hue: number, min: number, max: number): boolean {
	if (min <= max) {
		return hue >= min && hue <= max;
	}

	return hue >= min || hue <= max;
}

function isPixelInThreshold(color: HsvColor, threshold: HsvThreshold): boolean {
	return isHueInRange(color.h, threshold.hueMin, threshold.hueMax)
		&& color.s >= threshold.saturationMin
		&& color.s <= threshold.saturationMax
		&& color.v >= threshold.valueMin
		&& color.v <= threshold.valueMax;
}

function hasTongueLikeRedness(r: number, g: number, b: number): boolean {
	return r >= MIN_RED_CHANNEL
		&& r - g >= REDNESS_OVER_GREEN_MIN
		&& r - b >= REDNESS_OVER_BLUE_MIN;
}

function buildThresholdMask(
	imageData: ImageData,
	threshold: HsvThreshold,
	allowedMask?: Uint8Array,
): Uint8Array {
	const { data, width, height } = imageData;
	const pixelCount = width * height;
	const mask = new Uint8Array(pixelCount);

	for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
		if (allowedMask !== undefined && allowedMask[pixelIndex] !== 1) {
			continue;
		}

		const channelIndex = pixelIndex * 4;
		const r = data[channelIndex];
		const g = data[channelIndex + 1];
		const b = data[channelIndex + 2];

		if (r === undefined || g === undefined || b === undefined) {
			continue;
		}

		if (!hasTongueLikeRedness(r, g, b)) {
			continue;
		}

		const hsv = rgbToHsv(r, g, b);
		mask[pixelIndex] = isPixelInThreshold(hsv, threshold) ? 1 : 0;
	}

	return mask;
}

function erode(mask: Uint8Array, width: number, height: number): Uint8Array {
	const output = new Uint8Array(mask.length);

	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			let allNeighborsOn = true;

			for (let offsetY = -1; offsetY <= 1; offsetY++) {
				for (let offsetX = -1; offsetX <= 1; offsetX++) {
					const index = (y + offsetY) * width + (x + offsetX);
					if (mask[index] !== 1) {
						allNeighborsOn = false;
						break;
					}
				}

				if (!allNeighborsOn) break;
			}

			if (allNeighborsOn) {
				output[y * width + x] = 1;
			}
		}
	}

	return output;
}

function dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
	const output = new Uint8Array(mask.length);

	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			let anyNeighborOn = false;

			for (let offsetY = -1; offsetY <= 1; offsetY++) {
				for (let offsetX = -1; offsetX <= 1; offsetX++) {
					const index = (y + offsetY) * width + (x + offsetX);
					if (mask[index] === 1) {
						anyNeighborOn = true;
						break;
					}
				}

				if (anyNeighborOn) break;
			}

			if (anyNeighborOn) {
				output[y * width + x] = 1;
			}
		}
	}

	return output;
}

interface ConnectedComponentAnalysis {
	readonly largestMask: Uint8Array;
	readonly largestComponentSize: number;
	readonly componentCount: number;
	readonly totalForegroundPixels: number;
}

function analyzeConnectedComponents(
	mask: Uint8Array,
	width: number,
	height: number,
): ConnectedComponentAnalysis {
	const visited = new Uint8Array(mask.length);
	let largestComponent: readonly number[] = [];
	let componentCount = 0;
	let totalForegroundPixels = 0;

	for (let start = 0; start < mask.length; start++) {
		if (mask[start] !== 1 || visited[start] === 1) continue;

		componentCount++;

		const queue = [start];
		const component: number[] = [];
		visited[start] = 1;

		let cursor = 0;
		while (cursor < queue.length) {
			const index = queue[cursor];
			cursor++;
			if (index === undefined) continue;

			component.push(index);
			const x = index % width;
			const y = Math.floor(index / width);

			for (let offsetY = -1; offsetY <= 1; offsetY++) {
				for (let offsetX = -1; offsetX <= 1; offsetX++) {
					if (offsetX === 0 && offsetY === 0) continue;

					const neighborX = x + offsetX;
					const neighborY = y + offsetY;
					if (
						neighborX < 0
						|| neighborX >= width
						|| neighborY < 0
						|| neighborY >= height
					) {
						continue;
					}

					const neighborIndex = neighborY * width + neighborX;
					if (mask[neighborIndex] !== 1 || visited[neighborIndex] === 1) {
						continue;
					}

					visited[neighborIndex] = 1;
					queue.push(neighborIndex);
				}
			}
		}

		if (component.length > largestComponent.length) {
			largestComponent = component;
		}

		totalForegroundPixels += component.length;
	}

	const largestMask = new Uint8Array(mask.length);
	for (const index of largestComponent) {
		largestMask[index] = 1;
	}

	return {
		largestMask,
		largestComponentSize: largestComponent.length,
		componentCount,
		totalForegroundPixels,
	};
}

function centroidYRatio(mask: Uint8Array, width: number, height: number): number {
	let weightedY = 0;
	let count = 0;

	for (let index = 0; index < mask.length; index++) {
		if (mask[index] !== 1) continue;
		const y = Math.floor(index / width);
		weightedY += y;
		count++;
	}

	if (count === 0 || height === 0) return 0;
	return (weightedY / count) / height;
}

export function segmentTongue(
	imageData: ImageData,
	options?: {
		readonly threshold?: HsvThreshold;
		readonly minimumPixels?: number;
		readonly allowedMask?: Uint8Array;
	},
): Result<TongueMask, TongueSegmentationError> {
	if (imageData.width === 0 || imageData.height === 0) {
		return err({ kind: 'empty_input' });
	}

	const threshold = options?.threshold ?? DEFAULT_HSV_THRESHOLD;
	const minimumPixels = clamp(options?.minimumPixels ?? MIN_TONGUE_PIXELS, 1, Number.MAX_SAFE_INTEGER);
	const allowedMask = options?.allowedMask;

	if (allowedMask !== undefined && allowedMask.length !== imageData.width * imageData.height) {
		return err({ kind: 'allowed_mask_size_mismatch' });
	}

	const thresholdMask = buildThresholdMask(imageData, threshold, allowedMask);
	const openedMask = dilate(erode(thresholdMask, imageData.width, imageData.height), imageData.width, imageData.height);
	const componentAnalysis = analyzeConnectedComponents(openedMask, imageData.width, imageData.height);
	const largestComponentMask = componentAnalysis.largestMask;
	const pixelCount = componentAnalysis.largestComponentSize;

	if (pixelCount === 0) {
		return err({ kind: 'no_tongue_pixels_detected' });
	}

	if (pixelCount < minimumPixels) {
		return err({
			kind: 'insufficient_pixels',
			count: pixelCount,
			minimumRequired: minimumPixels,
		});
	}

	const largestComponentRatio = pixelCount / Math.max(componentAnalysis.totalForegroundPixels, 1);
	if (
		componentAnalysis.componentCount > 1
		&& largestComponentRatio < MIN_LARGEST_COMPONENT_RATIO
	) {
		return err({
			kind: 'multiple_regions_detected',
			componentCount: componentAnalysis.componentCount,
			largestComponentRatio,
		});
	}

	const yRatio = centroidYRatio(largestComponentMask, imageData.width, imageData.height);

	return ok({
		mask: largestComponentMask,
		width: imageData.width,
		height: imageData.height,
		pixelCount,
		componentCount: componentAnalysis.componentCount,
		largestComponentRatio,
		centroidYRatio: yRatio,
		passesCentroidHeuristic: yRatio >= MIN_CENTROID_Y_RATIO,
	});
}
