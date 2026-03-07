/**
 * Canvas-based cropping of mouth regions from frame sources.
 *
 * Provides two strategies: {@link cropMouth} extracts the detected mouth
 * bounding box, {@link cropFullImage} uses the entire frame (closeup fallback).
 * Both produce a {@link MouthCrop} containing pixel data and source coordinates.
 *
 * @browser Uses `document.createElement('canvas')` — browser-only by design.
 * @module
 */

import type { MouthRegion } from '../face-detection.ts';
import { clamp } from '../math-utils.ts';
import type { AnalysisError } from '../pipeline.ts';
import { err, ok, type Result } from '../result.ts';
import { getFrameDimensions } from './frame-source.ts';
import type { FrameSource, MouthCrop } from './types.ts';

/**
 * Rasterise a rectangular sub-region of `source` onto an offscreen canvas.
 *
 * Creates a temporary canvas sized to the crop dimensions, draws the
 * specified source rectangle, and extracts the resulting `ImageData`.
 *
 * @param source - Image or video element to crop from.
 * @param sx - Source x-coordinate (left edge of crop in source pixels).
 * @param sy - Source y-coordinate (top edge of crop in source pixels).
 * @param sw - Source width of the crop region.
 * @param sh - Source height of the crop region.
 * @returns `Result.ok` with the cropped {@link MouthCrop}, or `Result.err`
 *   with `canvas_unavailable` if 2D context creation fails.
 */
function createCanvasCrop(
	source: FrameSource,
	sx: number,
	sy: number,
	sw: number,
	sh: number,
): Result<MouthCrop, AnalysisError> {
	const canvas = document.createElement('canvas');
	canvas.width = sw;
	canvas.height = sh;

	const context = canvas.getContext('2d');
	if (context === null) {
		return err({ kind: 'canvas_unavailable' });
	}

	let imageData: ImageData;
	try {
		context.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
		imageData = context.getImageData(0, 0, sw, sh);
	} catch {
		return err({ kind: 'mouth_crop_failed' });
	}

	return ok({
		imageData,
		x: sx,
		y: sy,
		width: sw,
		height: sh,
	});
}

/**
 * Crop the detected mouth bounding box from the source frame.
 *
 * Clamps the bounding box to frame boundaries to handle edge cases
 * where MediaPipe returns coordinates slightly outside the image.
 *
 * @param source - The full image or video element.
 * @param mouth - Detected mouth region with bounding box coordinates.
 * @returns `Result.ok` with the cropped region, or `Result.err` with
 *   `mouth_crop_failed` if dimensions are invalid.
 *
 * @example
 * ```ts
 * const crop = cropMouth(imageElement, mouthRegion);
 * if (crop.ok) processPixels(crop.value.imageData);
 * ```
 */
export function cropMouth(
	source: FrameSource,
	mouth: MouthRegion,
): Result<MouthCrop, AnalysisError> {
	const dimensions = getFrameDimensions(source);
	if (dimensions === undefined) {
		return err({ kind: 'mouth_crop_failed' });
	}

	const { width, height } = dimensions;
	// Defensive: `getFrameDimensions` guarantees positive values when it returns
	// non-undefined, so this branch is currently unreachable.
	if (width <= 0 || height <= 0) {
		return err({ kind: 'mouth_crop_failed' });
	}

	// Compute the intersection of the bounding box with the image bounds.
	// Clamping left/right and top/bottom independently avoids the over-wide
	// crop that the old independent x + width clamping produced when the
	// bounding box started outside the image (e.g. negative x).
	const left = clamp(Math.floor(mouth.boundingBox.x), 0, width);
	const top = clamp(Math.floor(mouth.boundingBox.y), 0, height);
	const right = clamp(Math.ceil(mouth.boundingBox.x + mouth.boundingBox.width), 0, width);
	const bottom = clamp(Math.ceil(mouth.boundingBox.y + mouth.boundingBox.height), 0, height);

	const cropWidth = right - left;
	const cropHeight = bottom - top;

	if (cropWidth <= 0 || cropHeight <= 0) {
		return err({ kind: 'mouth_crop_failed' });
	}

	return createCanvasCrop(source, left, top, cropWidth, cropHeight);
}

/**
 * Crop the entire frame as a fallback when face detection fails.
 *
 * Used for tongue closeup images where the whole frame is assumed
 * to contain the tongue. Produces a {@link MouthCrop} with `x=0, y=0`.
 *
 * @param source - The full image or video element.
 * @returns `Result.ok` with the full-frame crop, or `Result.err` with
 *   `mouth_crop_failed` if dimensions are invalid.
 *
 * @example
 * ```ts
 * const crop = cropFullImage(videoElement);
 * ```
 */
export function cropFullImage(source: FrameSource): Result<MouthCrop, AnalysisError> {
	const dimensions = getFrameDimensions(source);
	if (dimensions === undefined) {
		return err({ kind: 'mouth_crop_failed' });
	}

	const { width, height } = dimensions;
	// Defensive: `getFrameDimensions` guarantees positive values when it returns
	// non-undefined, so this branch is currently unreachable.
	if (width <= 0 || height <= 0) {
		return err({ kind: 'mouth_crop_failed' });
	}

	return createCanvasCrop(source, 0, 0, width, height);
}
