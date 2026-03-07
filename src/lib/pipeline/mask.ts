/**
 * Spatial masks that constrain tongue segmentation to plausible regions.
 *
 * Two strategies: {@link makeMouthOpeningMask} uses the inner lip polygon
 * from face detection; {@link makeFallbackAllowedMask} rasterises a
 * heuristic ellipse for closeup images where no face was detected.
 *
 * @module
 */

import type { MouthRegion } from '../face-detection.ts';
import type { MouthCrop, Point2D } from './types.ts';

/**
 * Ray-casting point-in-polygon test.
 *
 * Casts a horizontal ray from `point` to the right and counts edge
 * crossings. Odd count = inside. Handles non-convex polygons correctly.
 *
 * @param point - The test coordinate.
 * @param polygon - Ordered vertices of the polygon (auto-closed).
 * @returns `true` if `point` lies strictly inside the polygon.
 */
function pointInPolygon(point: Point2D, polygon: readonly Point2D[]): boolean {
	let inside = false;

	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const a = polygon[i];
		const b = polygon[j];
		if (a === undefined || b === undefined) continue;

		const deltaY = b.y - a.y;
		const intersects = (a.y > point.y) !== (b.y > point.y)
			&& point.x < ((b.x - a.x) * (point.y - a.y)) / deltaY + a.x;

		if (intersects) inside = !inside;
	}

	return inside;
}

/**
 * Build a binary mask from the inner lip polygon.
 *
 * Translates the polygon coordinates from frame-space to crop-space,
 * then rasterises using {@link pointInPolygon} with half-pixel offsets
 * (pixel-center sampling). Pixels inside the polygon are set to `1`.
 *
 * @param crop - The cropped mouth region (provides offset and dimensions).
 * @param mouth - Detected mouth with `innerLipPolygon` landmarks.
 * @returns `Uint8Array` of length `crop.width * crop.height`; `1` = inside mouth.
 *
 * @example
 * ```ts
 * const mask = makeMouthOpeningMask(crop, mouthRegion);
 * // mask[y * crop.width + x] === 1 for pixels inside the lip polygon
 * ```
 */
export function makeMouthOpeningMask(
	crop: MouthCrop,
	mouth: MouthRegion,
): Uint8Array {
	const relativePolygon = mouth.innerLipPolygon.map((point) => ({
		x: point.x - crop.x,
		y: point.y - crop.y,
	}));

	const mask = new Uint8Array(crop.width * crop.height);
	if (relativePolygon.length < 3) return mask;

	for (let y = 0; y < crop.height; y++) {
		for (let x = 0; x < crop.width; x++) {
			if (pointInPolygon({ x: x + 0.5, y: y + 0.5 }, relativePolygon)) {
				mask[y * crop.width + x] = 1;
			}
		}
	}

	return mask;
}

/** Result of fallback ellipse rasterisation, bundling the mask with its pixel count. */
interface FallbackAllowedMaskResult {
	/** Binary mask; `1` = pixel inside the ellipse. */
	readonly mask: Uint8Array;
	/** Total number of `1`-valued pixels in the mask. */
	readonly allowedPixels: number;
}

/**
 * Rasterise a vertically-offset ellipse approximating a tongue in a closeup.
 *
 * The ellipse is centred at `(0.5w, 0.64h)` with radii `(0.46w, 0.4h)`,
 * clipped to `y >= 0.18h`. These magic numbers were tuned empirically
 * against typical tongue-closeup framing: the tongue sits in the lower
 * two-thirds, and the top 18% is usually lips/nose.
 *
 * @param width - Frame width in pixels.
 * @param height - Frame height in pixels.
 * @returns The rasterised mask and its pixel count.
 */
function rasterizeFallbackEllipse(width: number, height: number): FallbackAllowedMaskResult {
	const mask = new Uint8Array(width * height);

	const centerX = width * 0.5;
	const centerY = height * 0.64;
	const radiusX = width * 0.46;
	const radiusY = height * 0.4;
	const minY = Math.floor(height * 0.18);

	if (radiusX <= 0 || radiusY <= 0) return { mask, allowedPixels: 0 };

	let allowedPixels = 0;
	for (let y = minY; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const dx = (x + 0.5 - centerX) / radiusX;
			const dy = (y + 0.5 - centerY) / radiusY;
			if (dx * dx + dy * dy <= 1) {
				mask[y * width + x] = 1;
				allowedPixels++;
			}
		}
	}

	return { mask, allowedPixels };
}

/**
 * Create an allowed-pixel mask for full-frame fallback analysis.
 *
 * Delegates to {@link rasterizeFallbackEllipse} to produce an elliptical
 * region covering the expected tongue area in a closeup image.
 *
 * @param width - Frame width in pixels.
 * @param height - Frame height in pixels.
 * @returns The mask and its allowed pixel count.
 *
 * @example
 * ```ts
 * const { mask, allowedPixels } = makeFallbackAllowedMask(640, 480);
 * ```
 */
export function makeFallbackAllowedMask(width: number, height: number): FallbackAllowedMaskResult {
	return rasterizeFallbackEllipse(width, height);
}

/**
 * Compute the minimum tongue-pixel count required for fallback analysis.
 *
 * Returns `max(200, floor(w*h * 0.03))`, capped at the total allowed
 * pixels in the ellipse. The 3% floor prevents accepting noise as tongue
 * in large frames; the 200px absolute floor covers tiny crops. Capping
 * at `allowedPixels` ensures the threshold is achievable.
 *
 * @param width - Frame width in pixels.
 * @param height - Frame height in pixels.
 * @param precomputedAllowedPixels - If the ellipse was already rasterised,
 *   pass its pixel count to avoid redundant computation.
 * @returns Minimum number of tongue pixels the segmenter must find.
 *
 * @example
 * ```ts
 * const minPx = fallbackMinimumPixels(640, 480, ellipse.allowedPixels);
 * ```
 */
export function fallbackMinimumPixels(
	width: number,
	height: number,
	precomputedAllowedPixels?: number,
): number {
	const minimumPixels = Math.max(200, Math.floor(width * height * 0.03));
	const allowedPixels = precomputedAllowedPixels ?? rasterizeFallbackEllipse(width, height).allowedPixels;
	return Math.min(allowedPixels, minimumPixels);
}
