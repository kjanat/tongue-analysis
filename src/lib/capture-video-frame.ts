/**
 * Captures a single still frame from a live `<video>` element as a JPEG
 * {@link File}, or returns a typed {@link CaptureError} on failure.
 *
 * Used by {@link CameraCapture} to snapshot the camera feed before
 * handing the image to the analysis pipeline.
 *
 * @module
 */

import { err, ok, type Result } from './result.ts';

/**
 * Discriminated union of failure modes when capturing a video frame.
 *
 * - `no_video_signal` — video element has zero dimensions (no active stream).
 * - `canvas_unavailable` — browser failed to create a 2D canvas context.
 * - `blob_conversion_failed` — `canvas.toBlob()` returned `null`.
 */
type CaptureError =
	| { readonly kind: 'no_video_signal' }
	| { readonly kind: 'canvas_unavailable' }
	| { readonly kind: 'blob_conversion_failed' };

/**
 * Dutch user-facing messages for each {@link CaptureError} variant.
 * Keyed by the `kind` tag for exhaustive, type-safe lookup.
 */
const CAPTURE_ERROR_MESSAGES: Readonly<Record<CaptureError['kind'], string>> = {
	no_video_signal: 'Geen camerabeeld beschikbaar om vast te leggen.',
	canvas_unavailable: 'Kon cameraframe niet verwerken.',
	blob_conversion_failed: 'Kon foto niet opslaan. Probeer opnieuw.',
};

/**
 * Resolve a {@link CaptureError} to its Dutch user-facing message.
 *
 * @param error - The capture error to translate.
 * @returns A single-sentence Dutch string for UI display.
 *
 * @example
 * ```ts
 * const result = await captureVideoFrame(videoEl);
 * if (!result.ok) {
 * 	alert(captureErrorMessage(result.error));
 * }
 * ```
 */
export function captureErrorMessage(error: CaptureError): string {
	return CAPTURE_ERROR_MESSAGES[error.kind];
}

/**
 * Convert a canvas to a JPEG blob at 92% quality.
 *
 * Wraps the callback-based `canvas.toBlob()` API in a Promise.
 * Returns `null` when the browser cannot encode the canvas content.
 *
 * @param canvas - The canvas element containing the drawn video frame.
 * @returns The JPEG blob, or `null` on encoding failure.
 */
function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
	return new Promise((resolve) => {
		canvas.toBlob(
			(blob) => {
				resolve(blob);
			},
			'image/jpeg',
			0.92,
		);
	});
}

/**
 * Capture the current frame of a `<video>` element as a JPEG {@link File}.
 *
 * Draws the video onto an offscreen canvas, encodes to JPEG at 92% quality,
 * and wraps the result in a `File` with a timestamped filename. Uses
 * {@link Result} to surface failures without throwing.
 *
 * @param video - The HTMLVideoElement with an active media stream.
 * @param filenamePrefix - Prefix for the generated filename.
 *   Defaults to `'tong-camera'`. The final name is `{prefix}-{timestamp}.jpg`.
 * @returns A {@link Result} containing the JPEG `File` on success,
 *   or a {@link CaptureError} on failure.
 *
 * @example
 * ```ts
 * const result = await captureVideoFrame(videoRef.current);
 * if (result.ok) {
 * 	onCapture(result.value); // File ready for upload/analysis
 * }
 * ```
 */
export async function captureVideoFrame(
	video: HTMLVideoElement,
	filenamePrefix = 'tong-camera',
): Promise<Result<File, CaptureError>> {
	if (video.videoWidth === 0 || video.videoHeight === 0) {
		return err({ kind: 'no_video_signal' });
	}

	const canvas = document.createElement('canvas');
	canvas.width = video.videoWidth;
	canvas.height = video.videoHeight;

	const context = canvas.getContext('2d');
	if (context === null) {
		return err({ kind: 'canvas_unavailable' });
	}

	context.drawImage(video, 0, 0, canvas.width, canvas.height);

	const blob = await canvasToJpegBlob(canvas);
	if (blob === null) {
		return err({ kind: 'blob_conversion_failed' });
	}

	const capturedAt = Date.now();
	const file = new File([blob], `${filenamePrefix}-${String(capturedAt)}.jpg`, {
		type: 'image/jpeg',
		lastModified: capturedAt,
	});

	return ok(file);
}
