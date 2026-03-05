import { err, ok, type Result } from './result.ts';

export interface TongueMask {
	readonly mask: Uint8Array;
	readonly width: number;
	readonly height: number;
	readonly pixelCount: number;
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
	| { readonly kind: 'no_tongue_pixels_detected' }
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

function buildThresholdMask(
	imageData: ImageData,
	threshold: HsvThreshold,
): Uint8Array {
	const { data, width, height } = imageData;
	const pixelCount = width * height;
	const mask = new Uint8Array(pixelCount);

	for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
		const channelIndex = pixelIndex * 4;
		const r = data[channelIndex];
		const g = data[channelIndex + 1];
		const b = data[channelIndex + 2];

		if (r === undefined || g === undefined || b === undefined) {
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

function keepLargestConnectedComponent(
	mask: Uint8Array,
	width: number,
	height: number,
): Uint8Array {
	const visited = new Uint8Array(mask.length);
	let largestComponent: readonly number[] = [];

	for (let start = 0; start < mask.length; start++) {
		if (mask[start] !== 1 || visited[start] === 1) continue;

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
	}

	const largestMask = new Uint8Array(mask.length);
	for (const index of largestComponent) {
		largestMask[index] = 1;
	}

	return largestMask;
}

function countMaskPixels(mask: Uint8Array): number {
	let count = 0;
	for (const value of mask) {
		if (value === 1) count++;
	}
	return count;
}

export function segmentTongue(
	imageData: ImageData,
	options?: {
		readonly threshold?: HsvThreshold;
		readonly minimumPixels?: number;
	},
): Result<TongueMask, TongueSegmentationError> {
	if (imageData.width === 0 || imageData.height === 0) {
		return err({ kind: 'empty_input' });
	}

	const threshold = options?.threshold ?? DEFAULT_HSV_THRESHOLD;
	const minimumPixels = clamp(options?.minimumPixels ?? MIN_TONGUE_PIXELS, 1, Number.MAX_SAFE_INTEGER);

	const thresholdMask = buildThresholdMask(imageData, threshold);
	const openedMask = dilate(erode(thresholdMask, imageData.width, imageData.height), imageData.width, imageData.height);
	const largestComponentMask = keepLargestConnectedComponent(openedMask, imageData.width, imageData.height);
	const pixelCount = countMaskPixels(largestComponentMask);

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

	return ok({
		mask: largestComponentMask,
		width: imageData.width,
		height: imageData.height,
		pixelCount,
	});
}
