import type { MouthRegion } from '../face-detection.ts';
import type { MouthCrop, Point2D } from './types.ts';

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

export function makeFallbackAllowedMask(width: number, height: number): Uint8Array {
	const mask = new Uint8Array(width * height);

	const centerX = width * 0.5;
	const centerY = height * 0.64;
	const radiusX = width * 0.46;
	const radiusY = height * 0.4;
	const minY = Math.floor(height * 0.18);

	if (radiusX <= 0 || radiusY <= 0) return mask;

	for (let y = minY; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const dx = (x + 0.5 - centerX) / radiusX;
			const dy = (y + 0.5 - centerY) / radiusY;
			if (dx * dx + dy * dy <= 1) {
				mask[y * width + x] = 1;
			}
		}
	}

	return mask;
}

export function fallbackMinimumPixels(width: number, height: number): number {
	const minimumPixels = Math.max(200, Math.floor(width * height * 0.03));
	const allowedMask = makeFallbackAllowedMask(width, height);

	let allowedPixels = 0;
	for (const pixel of allowedMask) {
		allowedPixels += pixel;
	}

	return Math.min(allowedPixels, minimumPixels);
}
