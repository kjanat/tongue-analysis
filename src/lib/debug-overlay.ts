/**
 * Debug overlay drawing for live tongue analysis.
 * Renders mouth bounding box and lip polygons onto a canvas layered over the
 * video element. Only active when `VITE_DEBUG_OVERLAY=true`.
 *
 * Pure canvas functions — zero React coupling.
 *
 * @module
 */

import type { MouthRegion, Point } from './face-detection.ts';

/**
 * Scale a {@link Point} from source (video) coordinates to display (canvas CSS) coordinates.
 *
 * @param point - Original point in video-pixel space.
 * @param scaleX - Horizontal ratio `displayWidth / sourceWidth`.
 * @param scaleY - Vertical ratio `displayHeight / sourceHeight`.
 * @returns New {@link Point} in display-pixel space.
 */
function scalePoint(
	point: Point,
	scaleX: number,
	scaleY: number,
): Point {
	return {
		x: point.x * scaleX,
		y: point.y * scaleY,
	};
}

/**
 * Stroke a closed polygon path on the debug overlay canvas.
 *
 * @param context - 2D rendering context of the overlay canvas.
 * @param points - Ordered vertices (already in display-pixel space).
 * @param strokeColor - CSS color string for the outline.
 */
function drawPolygon(
	context: CanvasRenderingContext2D,
	points: readonly Point[],
	strokeColor: string,
): void {
	const first = points[0];
	if (first === undefined) return;

	context.beginPath();
	context.moveTo(first.x, first.y);
	for (let i = 1; i < points.length; i++) {
		const point = points[i];
		if (point === undefined) continue;
		context.lineTo(point.x, point.y);
	}
	context.closePath();
	context.strokeStyle = strokeColor;
	context.lineWidth = 2;
	context.stroke();
}

/**
 * Erase all content from the debug overlay canvas.
 * Safe to call with `null` (no-ops silently).
 *
 * @param canvas - The overlay canvas element, or `null`.
 */
export function clearOverlayCanvas(canvas: HTMLCanvasElement | null): void {
	if (canvas === null) return;
	const context = canvas.getContext('2d');
	if (context === null) return;
	context.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * Render a debug overlay for a detected {@link MouthRegion}.
 * Draws three elements scaled from video to display coordinates:
 * - Yellow (`#ffd166`) bounding box around the mouth.
 * - Green (`#52ffa8`) outer lip polygon.
 * - Blue (`#7dd3ff`) inner lip polygon.
 *
 * Handles DPR scaling so lines stay sharp on high-density displays.
 *
 * @param canvas - Overlay `<canvas>` positioned over the video.
 * @param mouthRegion - Detected mouth geometry in video-pixel space.
 * @param sourceWidth - Width of the source video in pixels.
 * @param sourceHeight - Height of the source video in pixels.
 */
export function drawMouthRegionOverlay(
	canvas: HTMLCanvasElement,
	mouthRegion: MouthRegion,
	sourceWidth: number,
	sourceHeight: number,
): void {
	const context = canvas.getContext('2d');
	if (context === null) return;

	const displayWidth = canvas.clientWidth;
	const displayHeight = canvas.clientHeight;
	if (displayWidth <= 0 || displayHeight <= 0) return;

	const dpr = window.devicePixelRatio || 1;
	const targetWidth = Math.round(displayWidth * dpr);
	const targetHeight = Math.round(displayHeight * dpr);
	if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
		canvas.width = targetWidth;
		canvas.height = targetHeight;
	}

	context.setTransform(dpr, 0, 0, dpr, 0, 0);
	context.clearRect(0, 0, displayWidth, displayHeight);

	const scaleX = displayWidth / sourceWidth;
	const scaleY = displayHeight / sourceHeight;

	const scaledOuter = mouthRegion.outerLipPolygon.map((point) => scalePoint(point, scaleX, scaleY));
	const scaledInner = mouthRegion.innerLipPolygon.map((point) => scalePoint(point, scaleX, scaleY));

	const boxX = mouthRegion.boundingBox.x * scaleX;
	const boxY = mouthRegion.boundingBox.y * scaleY;
	const boxWidth = mouthRegion.boundingBox.width * scaleX;
	const boxHeight = mouthRegion.boundingBox.height * scaleY;

	context.strokeStyle = '#ffd166';
	context.lineWidth = 2;
	context.strokeRect(boxX, boxY, boxWidth, boxHeight);

	drawPolygon(context, scaledOuter, '#52ffa8');
	drawPolygon(context, scaledInner, '#7dd3ff');
}
