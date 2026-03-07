/**
 * Frame acquisition and dimension utilities.
 *
 * Handles loading images from URLs and extracting pixel dimensions
 * from heterogeneous frame sources (`HTMLImageElement` / `HTMLVideoElement`).
 *
 * @module
 */

import type { FrameDimensions, FrameSource } from './types.ts';

/**
 * Load an image from a URL into an `HTMLImageElement`.
 *
 * Wraps the browser's async image loading in a Promise. The returned
 * element is fully decoded (`naturalWidth > 0`) on resolution.
 *
 * @param imageUrl - Absolute URL, relative path, or data-URI.
 * @returns The loaded image element.
 * @throws {Error} If the browser cannot fetch or decode the image.
 *
 * @example
 * ```ts
 * const img = await loadImage('https://example.com/tongue.jpg');
 * ```
 */
export function loadImage(imageUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => {
			resolve(image);
		};
		image.onerror = () => {
			reject(new Error(`Image load failed: ${imageUrl}`));
		};
		image.src = imageUrl;
	});
}

/**
 * Extract the natural pixel dimensions from a frame source.
 *
 * Checks `naturalWidth`/`naturalHeight` for images and
 * `videoWidth`/`videoHeight` for video elements. Returns `undefined`
 * if the source has not loaded or has zero dimensions.
 *
 * @param source - An image or video element.
 * @returns Pixel dimensions, or `undefined` if unavailable.
 *
 * @example
 * ```ts
 * const dims = getFrameDimensions(videoEl);
 * if (dims) console.log(`${dims.width}x${dims.height}`);
 * ```
 */
export function getFrameDimensions(source: FrameSource): FrameDimensions | undefined {
	if ('naturalWidth' in source && source.naturalWidth > 0 && source.naturalHeight > 0) {
		return { width: source.naturalWidth, height: source.naturalHeight };
	}

	if ('videoWidth' in source && source.videoWidth > 0 && source.videoHeight > 0) {
		return { width: source.videoWidth, height: source.videoHeight };
	}

	return undefined;
}
