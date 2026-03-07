/**
 * HSV-based tongue segmentation with morphological cleanup.
 *
 * Takes RGBA {@link ImageData} (typically a cropped mouth region from
 * {@link detectMouthRegion}), applies a redness pre-filter + HSV thresholding,
 * morphological open (erode → dilate), connected-component analysis, and
 * centroid validation. Returns a binary mask of the largest tongue-colored
 * region or a typed error explaining why segmentation failed.
 *
 * @module
 */

import { clamp } from './math-utils.ts';
import { err, ok, type Result } from './result.ts';

/**
 * Binary mask and metadata for a successfully segmented tongue.
 *
 * The mask is a flat `Uint8Array` where `1` = tongue pixel, `0` = background,
 * laid out in row-major order matching `width * height`.
 */
export interface TongueMask {
	/** Binary mask: `1` for tongue pixels, `0` for background. Row-major, length = `width * height`. */
	readonly mask: Uint8Array;
	/** Image width in pixels (matches input {@link ImageData}). */
	readonly width: number;
	/** Image height in pixels (matches input {@link ImageData}). */
	readonly height: number;
	/** Number of pixels in the largest connected component (the accepted tongue region). */
	readonly pixelCount: number;
	/** Total connected components found after morphological opening. */
	readonly componentCount: number;
	/**
	 * Ratio of the largest component's pixel count to total foreground pixels.
	 * Values near 1.0 indicate a clean, single-region segmentation.
	 */
	readonly largestComponentRatio: number;
	/**
	 * Vertical centroid of the tongue mask as a fraction of image height (0 = top, 1 = bottom).
	 * Tongues typically appear in the lower half (ratio ≥ {@link MIN_CENTROID_Y_RATIO}).
	 */
	readonly centroidYRatio: number;
	/** Whether {@link centroidYRatio} ≥ {@link MIN_CENTROID_Y_RATIO}. */
	readonly passesCentroidHeuristic: boolean;
}

/**
 * HSV color-space thresholds for tongue pixel classification.
 *
 * All values use standard ranges: hue 0–360°, saturation 0–100%, value 0–100%.
 * Hue wraps around 360° (tongue hues span ~330°–20°, crossing the red boundary).
 */
export interface HsvThreshold {
	/** Lower hue bound in degrees (0–360). May be > {@link hueMax} for wrap-around ranges. */
	readonly hueMin: number;
	/** Upper hue bound in degrees (0–360). */
	readonly hueMax: number;
	/** Minimum saturation percentage (0–100). */
	readonly saturationMin: number;
	/** Maximum saturation percentage (0–100). */
	readonly saturationMax: number;
	/** Minimum value (brightness) percentage (0–100). */
	readonly valueMin: number;
	/** Maximum value (brightness) percentage (0–100). */
	readonly valueMax: number;
}

/**
 * Discriminated union of tongue segmentation failure modes.
 *
 * Each variant has a `kind` tag for exhaustive pattern matching.
 *
 * - `empty_input` — image has zero width or height.
 * - `allowed_mask_size_mismatch` — `allowedMask` length doesn't match image pixel count.
 * - `no_tongue_pixels_detected` — zero pixels passed HSV + redness thresholding.
 * - `multiple_regions_detected` — multiple disjoint tongue-colored blobs; largest is too small
 *   relative to total (below {@link MIN_LARGEST_COMPONENT_RATIO}).
 * - `insufficient_pixels` — tongue region found but too small for reliable analysis.
 */
export type TongueSegmentationError =
	| { readonly kind: 'empty_input' }
	| { readonly kind: 'allowed_mask_size_mismatch' }
	| { readonly kind: 'no_tongue_pixels_detected' }
	| {
		readonly kind: 'multiple_regions_detected';
		/** Total disjoint foreground regions found. */
		readonly componentCount: number;
		/** Fraction of foreground pixels belonging to the largest region. */
		readonly largestComponentRatio: number;
	}
	| {
		readonly kind: 'insufficient_pixels';
		/** Actual tongue pixel count. */
		readonly count: number;
		/** Minimum pixel count required for the current configuration. */
		readonly minimumRequired: number;
	};

/**
 * Default HSV thresholds tuned for tongue tissue under typical indoor lighting.
 *
 * Hue range 290°–20° spans red/pink (330°–20°) and extends into purple/magenta
 * (290°–330°) to capture Bloed Stagnatie tongues with purplish tint.
 * Moderate saturation (20–80%) and value (35–95%) accept both pale and
 * deeply colored tongues while excluding white/gray and very dark regions.
 */
const DEFAULT_HSV_THRESHOLD: HsvThreshold = {
	hueMin: 290,
	hueMax: 20,
	saturationMin: 20,
	saturationMax: 80,
	valueMin: 35,
	valueMax: 95,
};

/**
 * Minimum vertical centroid position (as fraction of image height).
 * Tongues protrude downward from the mouth; a centroid above 45%
 * suggests the detected region is upper lip or gum, not tongue.
 */
const MIN_CENTROID_Y_RATIO = 0.45;

/**
 * Minimum ratio of largest connected component to total foreground.
 * Below 55%, the segmentation likely captured scattered noise or
 * multiple disjoint skin-colored regions rather than a single tongue.
 */
const MIN_LARGEST_COMPONENT_RATIO = 0.55;

/** Minimum red channel value (0–255) for the redness pre-filter. */
const MIN_RED_CHANNEL = 70;

/** Absolute minimum tongue pixel count below which analysis is unreliable. */
const MIN_TONGUE_PIXELS = 120;

/**
 * Minimum difference `R - B` required by the redness pre-filter.
 * Ensures the pixel is distinctly red-shifted compared to blue.
 */
const REDNESS_OVER_BLUE_MIN = 8;

/**
 * Minimum difference `R - G` required by the redness pre-filter.
 * Ensures the pixel is distinctly red-shifted compared to green.
 */
const REDNESS_OVER_GREEN_MIN = 12;

/** HSV color with hue in degrees (0–360), saturation and value as percentages (0–100). */
interface HsvColor {
	/** Hue in degrees (0–360). */
	readonly h: number;
	/** Saturation as percentage (0–100). */
	readonly s: number;
	/** Value (brightness) as percentage (0–100). */
	readonly v: number;
}

/**
 * Convert an sRGB color to HSV.
 *
 * Uses the standard hexcone model. Output ranges: H 0–360°, S 0–100%, V 0–100%.
 * Negative hue from the modulo is normalized to positive via `(h + 360) % 360`.
 *
 * @param r - Red channel (0–255).
 * @param g - Green channel (0–255).
 * @param b - Blue channel (0–255).
 * @returns HSV representation.
 */
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

/**
 * Check whether a hue falls within a range that may wrap around 360°.
 *
 * When `min ≤ max`, tests a simple interval. When `min > max` (e.g. 330°–20°),
 * tests the union `[min, 360°] ∪ [0°, max]`.
 *
 * @param hue - Hue angle in degrees (0–360).
 * @param min - Lower hue bound.
 * @param max - Upper hue bound.
 * @returns `true` if `hue` is within the (possibly wrapped) range.
 */
function isHueInRange(hue: number, min: number, max: number): boolean {
	if (min <= max) {
		return hue >= min && hue <= max;
	}

	return hue >= min || hue <= max;
}

/**
 * Test whether an HSV color falls within all six threshold bounds.
 *
 * @param color - HSV color to test.
 * @param threshold - HSV threshold ranges.
 * @returns `true` if hue, saturation, and value are all in range.
 */
function isPixelInThreshold(color: HsvColor, threshold: HsvThreshold): boolean {
	return isHueInRange(color.h, threshold.hueMin, threshold.hueMax)
		&& color.s >= threshold.saturationMin
		&& color.s <= threshold.saturationMax
		&& color.v >= threshold.valueMin
		&& color.v <= threshold.valueMax;
}

/**
 * Fast RGB pre-filter to reject obviously non-tongue pixels before HSV conversion.
 *
 * Requires a minimum red channel intensity and sufficient red dominance
 * over green. Accepts two colour profiles:
 * - **Red-dominant** (standard): R exceeds both G and B — covers normal
 *   pink/red tongue hues.
 * - **Purple** (R ≈ B, both exceed G): captures Bloed Stagnatie tongues
 *   where the blue channel is comparable to red.
 *
 * Avoids the cost of {@link rgbToHsv} for pixels that clearly aren't
 * tongue-colored.
 *
 * @param r - Red channel (0–255).
 * @param g - Green channel (0–255).
 * @param b - Blue channel (0–255).
 * @returns `true` if the pixel could plausibly be tongue tissue.
 */
function hasTongueLikeColor(r: number, g: number, b: number): boolean {
	if (r < MIN_RED_CHANNEL) return false;
	if (r - g < REDNESS_OVER_GREEN_MIN) return false;

	// Red-dominant (standard tongue) or purple (R≈B, both exceed green)
	return r - b >= REDNESS_OVER_BLUE_MIN
		|| (b >= MIN_RED_CHANNEL && b - g >= REDNESS_OVER_GREEN_MIN);
}

/**
 * Build a binary mask of pixels matching the tongue color profile.
 *
 * For each pixel: skip if outside `allowedMask` → apply {@link hasTongueLikeRedness}
 * pre-filter → convert to HSV → test against {@link HsvThreshold}.
 *
 * @param imageData - Source RGBA image data.
 * @param threshold - HSV threshold configuration.
 * @param allowedMask - Optional spatial constraint (e.g. mouth interior from face detection).
 *   Only pixels where `allowedMask[i] === 1` are evaluated.
 * @returns Binary mask (`1` = tongue candidate, `0` = rejected), length = pixel count.
 */
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

		if (!hasTongueLikeColor(r, g, b)) {
			continue;
		}

		const hsv = rgbToHsv(r, g, b);
		mask[pixelIndex] = isPixelInThreshold(hsv, threshold) ? 1 : 0;
	}

	return mask;
}

/**
 * Morphological erosion with a 3x3 structuring element.
 *
 * A pixel survives only if all 8 neighbors (and itself) are set.
 * Removes single-pixel noise and thin protrusions. Border pixels
 * (1px margin) are always cleared.
 *
 * @param mask - Input binary mask (`1`/`0`).
 * @param width - Image width.
 * @param height - Image height.
 * @returns New eroded mask (does not mutate input).
 */
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

/**
 * Morphological dilation with a 3x3 structuring element.
 *
 * A pixel is set if any of its 8 neighbors (or itself) is set.
 * Fills small gaps and smooths contours. Combined with {@link erode}
 * as erode→dilate to form a morphological opening.
 *
 * @param mask - Input binary mask (`1`/`0`).
 * @param width - Image width.
 * @param height - Image height.
 * @returns New dilated mask (does not mutate input).
 */
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

/** Result of connected-component analysis on a binary mask. */
interface ConnectedComponentAnalysis {
	/** Binary mask containing only the largest component's pixels. */
	readonly largestMask: Uint8Array;
	/** Pixel count of the largest connected component. */
	readonly largestComponentSize: number;
	/** Total number of distinct connected components (8-connectivity). */
	readonly componentCount: number;
	/** Sum of pixels across all components. */
	readonly totalForegroundPixels: number;
}

/**
 * Label connected components via BFS and isolate the largest one.
 *
 * Uses 8-connectivity (diagonal neighbors count). Iterates all foreground
 * pixels, flood-fills each unvisited region, and tracks the largest.
 * The returned mask contains only the largest component — all others are
 * discarded as noise or secondary regions.
 *
 * @param mask - Input binary mask after morphological processing.
 * @param width - Image width.
 * @param height - Image height.
 * @returns Analysis with the largest component isolated and metadata.
 */
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

/**
 * Compute the vertical centroid of foreground pixels as a fraction of image height.
 *
 * Returns 0 if no foreground pixels exist. Used to validate that the detected
 * region is in the lower half of the mouth crop (where tongues appear).
 *
 * @param mask - Binary mask (`1` = foreground).
 * @param width - Image width (used to derive y from flat index).
 * @param height - Image height (used as denominator for normalization).
 * @returns Ratio in [0, 1] where 0 = top edge, 1 = bottom edge.
 */
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

/**
 * Segment tongue tissue from an RGBA image using color thresholding and morphology.
 *
 * Pipeline: RGB redness pre-filter → HSV threshold → morphological open (erode→dilate) →
 * connected-component analysis → largest-component isolation → pixel count + centroid validation.
 *
 * @param imageData - Source RGBA pixel data (typically a cropped mouth region).
 * @param options - Optional overrides for the segmentation pipeline.
 * @param options.threshold - Custom {@link HsvThreshold}; defaults to {@link DEFAULT_HSV_THRESHOLD}.
 * @param options.minimumPixels - Override minimum tongue pixel count; clamped to
 *   `[1, allowedMask foreground count]`. Defaults to {@link MIN_TONGUE_PIXELS}.
 * @param options.allowedMask - Spatial constraint mask (e.g. inner-lip region).
 *   Must have length `width * height`; only pixels with value `1` are evaluated.
 * @returns {@link TongueMask} on success, or a typed {@link TongueSegmentationError}.
 *
 * @example
 * ```ts
 * const result = segmentTongue(croppedImageData, {
 *   allowedMask: innerMouthMask,
 * });
 * if (result.ok) {
 *   console.log(`Tongue: ${result.value.pixelCount}px`);
 * }
 * ```
 */
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
	const allowedMask = options?.allowedMask;

	if (allowedMask !== undefined && allowedMask.length !== imageData.width * imageData.height) {
		return err({ kind: 'allowed_mask_size_mismatch' });
	}

	const clampCeiling = allowedMask !== undefined
		? allowedMask.reduce((sum, pixel) => sum + pixel, 0)
		: imageData.width * imageData.height;
	const minimumPixels = clamp(options?.minimumPixels ?? MIN_TONGUE_PIXELS, 1, clampCeiling);

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
