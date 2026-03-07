import type { MouthRegion } from '../face-detection.ts';
import type { AnalysisError } from '../pipeline.ts';
import { err, ok, type Result } from '../result.ts';
import { clamp, getFrameDimensions } from './frame-source.ts';
import type { FrameSource, MouthCrop } from './types.ts';

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

	context.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);

	return ok({
		imageData: context.getImageData(0, 0, sw, sh),
		x: sx,
		y: sy,
		width: sw,
		height: sh,
	});
}

export function cropMouth(
	source: FrameSource,
	mouth: MouthRegion,
): Result<MouthCrop, AnalysisError> {
	const dimensions = getFrameDimensions(source);
	if (dimensions === undefined) {
		return err({ kind: 'mouth_crop_failed' });
	}

	const { width, height } = dimensions;
	if (width <= 0 || height <= 0) {
		return err({ kind: 'mouth_crop_failed' });
	}

	const x = clamp(Math.floor(mouth.boundingBox.x), 0, width - 1);
	const y = clamp(Math.floor(mouth.boundingBox.y), 0, height - 1);
	const cropWidth = clamp(Math.floor(mouth.boundingBox.width), 1, width - x);
	const cropHeight = clamp(Math.floor(mouth.boundingBox.height), 1, height - y);

	if (cropWidth <= 0 || cropHeight <= 0) {
		return err({ kind: 'mouth_crop_failed' });
	}

	return createCanvasCrop(source, x, y, cropWidth, cropHeight);
}

export function cropFullImage(source: FrameSource): Result<MouthCrop, AnalysisError> {
	const dimensions = getFrameDimensions(source);
	if (dimensions === undefined) {
		return err({ kind: 'mouth_crop_failed' });
	}

	const { width, height } = dimensions;
	if (width <= 0 || height <= 0) {
		return err({ kind: 'mouth_crop_failed' });
	}

	return createCanvasCrop(source, 0, 0, width, height);
}
