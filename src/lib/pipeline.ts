import type { TongueColorClassification } from './color-classification.ts';
import { classifyTongueColor } from './color-classification.ts';
import { applyGrayWorldCorrection } from './color-correction.ts';
import type { Diagnosis } from './diagnosis.ts';
import { generateDiagnosis } from './diagnosis.ts';
import type { MouthDetectionError, MouthRegion } from './face-detection.ts';
import { detectMouthRegion } from './face-detection.ts';
import { err, ok, type Result } from './result.ts';
import type { TongueSegmentationError } from './tongue-segmentation.ts';
import { segmentTongue } from './tongue-segmentation.ts';

export type AnalysisStep =
	| 'loading_image'
	| 'loading_model'
	| 'detecting_mouth'
	| 'segmenting_tongue'
	| 'correcting_color'
	| 'classifying_color'
	| 'building_diagnosis';

export type AnalysisError =
	| { readonly kind: 'image_load_failed'; readonly cause: unknown }
	| { readonly kind: 'canvas_unavailable' }
	| { readonly kind: 'mouth_crop_failed' }
	| { readonly kind: 'face_detection_error'; readonly error: MouthDetectionError }
	| { readonly kind: 'tongue_segmentation_error'; readonly error: TongueSegmentationError }
	| {
		readonly kind: 'inconclusive_color';
		readonly chroma: number;
		readonly confidence: number;
	}
	| {
		readonly kind: 'color_correction_error';
		readonly error: { readonly kind: 'mask_size_mismatch' } | { readonly kind: 'no_masked_pixels' };
	};

const STANDARD_MIN_CLASSIFIABLE_CHROMA = 0.03;
const STANDARD_MIN_CLASSIFIABLE_CONFIDENCE = 0.35;
const CLOSEUP_MIN_CLASSIFIABLE_CHROMA = 0.012;
const CLOSEUP_MIN_CLASSIFIABLE_CONFIDENCE = 0.12;

export interface AnalysisSuccess {
	readonly diagnosis: Diagnosis;
	readonly classification: TongueColorClassification;
	readonly mouthRegion: MouthRegion | null;
}

interface MouthCrop {
	readonly imageData: ImageData;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

interface Point2D {
	readonly x: number;
	readonly y: number;
}

interface AnalyzeTongueOptions {
	readonly onStep?: (step: AnalysisStep) => void;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function emitStep(
	step: AnalysisStep,
	options: AnalyzeTongueOptions | undefined,
): void {
	options?.onStep?.(step);
}

function loadImage(imageUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => {
			resolve(image);
		};
		image.onerror = () => {
			reject(new Error('Image load failed'));
		};
		image.src = imageUrl;
	});
}

function cropMouth(image: HTMLImageElement, mouth: MouthRegion): Result<MouthCrop, AnalysisError> {
	const width = image.naturalWidth;
	const height = image.naturalHeight;

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

	const canvas = document.createElement('canvas');
	canvas.width = cropWidth;
	canvas.height = cropHeight;

	const context = canvas.getContext('2d');
	if (context === null) {
		return err({ kind: 'canvas_unavailable' });
	}

	context.drawImage(image, x, y, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

	return ok({
		imageData: context.getImageData(0, 0, cropWidth, cropHeight),
		x,
		y,
		width: cropWidth,
		height: cropHeight,
	});
}

function cropFullImage(image: HTMLImageElement): Result<MouthCrop, AnalysisError> {
	const width = image.naturalWidth;
	const height = image.naturalHeight;

	if (width <= 0 || height <= 0) {
		return err({ kind: 'mouth_crop_failed' });
	}

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;

	const context = canvas.getContext('2d');
	if (context === null) {
		return err({ kind: 'canvas_unavailable' });
	}

	context.drawImage(image, 0, 0, width, height);

	return ok({
		imageData: context.getImageData(0, 0, width, height),
		x: 0,
		y: 0,
		width,
		height,
	});
}

function pointInPolygon(point: Point2D, polygon: readonly Point2D[]): boolean {
	let inside = false;

	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const a = polygon[i];
		const b = polygon[j];
		if (a === undefined || b === undefined) continue;

		const intersects = (a.y > point.y) !== (b.y > point.y)
			&& point.x < ((b.x - a.x) * (point.y - a.y)) / Math.max(b.y - a.y, 1e-6) + a.x;

		if (intersects) inside = !inside;
	}

	return inside;
}

function makeMouthOpeningMask(crop: MouthCrop, mouth: MouthRegion): Uint8Array {
	const relativePolygon = mouth.innerLipPolygon.map((point) => ({
		x: point.x - crop.x,
		y: point.y - crop.y,
	}));

	const mask = new Uint8Array(crop.width * crop.height);

	if (relativePolygon.length < 3) {
		return mask;
	}

	for (let y = 0; y < crop.height; y++) {
		for (let x = 0; x < crop.width; x++) {
			const inside = pointInPolygon({ x: x + 0.5, y: y + 0.5 }, relativePolygon);
			if (inside) {
				mask[y * crop.width + x] = 1;
			}
		}
	}

	return mask;
}

function makeFallbackAllowedMask(width: number, height: number): Uint8Array {
	const mask = new Uint8Array(width * height);

	const centerX = width * 0.5;
	const centerY = height * 0.64;
	const radiusX = width * 0.46;
	const radiusY = height * 0.4;
	const minY = Math.floor(height * 0.18);

	if (radiusX <= 0 || radiusY <= 0) {
		return mask;
	}

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

function fallbackMinimumPixels(width: number, height: number): number {
	return Math.max(200, Math.floor(width * height * 0.03));
}

export async function analyzeTongueImage(
	image: HTMLImageElement,
	options?: AnalyzeTongueOptions,
): Promise<Result<AnalysisSuccess, AnalysisError>> {
	emitStep('loading_model', options);
	emitStep('detecting_mouth', options);

	const mouthResult = await detectMouthRegion(image);
	const canUseCloseupFallback = !mouthResult.ok
		&& (mouthResult.error.kind === 'no_face_detected' || mouthResult.error.kind === 'mouth_not_visible');

	if (!mouthResult.ok && !canUseCloseupFallback) {
		return err({ kind: 'face_detection_error', error: mouthResult.error });
	}

	const cropResult = mouthResult.ok ? cropMouth(image, mouthResult.value) : cropFullImage(image);
	if (!cropResult.ok) {
		return cropResult;
	}

	const allowedMask = mouthResult.ok
		? makeMouthOpeningMask(cropResult.value, mouthResult.value)
		: makeFallbackAllowedMask(cropResult.value.width, cropResult.value.height);

	const minimumPixels = mouthResult.ok
		? undefined
		: fallbackMinimumPixels(cropResult.value.width, cropResult.value.height);

	emitStep('segmenting_tongue', options);
	const maskResult = segmentTongue(cropResult.value.imageData, {
		allowedMask,
		minimumPixels,
	});
	if (!maskResult.ok) {
		return err({ kind: 'tongue_segmentation_error', error: maskResult.error });
	}

	emitStep('correcting_color', options);
	const correctionResult = applyGrayWorldCorrection(cropResult.value.imageData, maskResult.value);
	if (!correctionResult.ok) {
		return err({ kind: 'color_correction_error', error: correctionResult.error });
	}

	emitStep('classifying_color', options);
	const classification = classifyTongueColor(correctionResult.value.averageTongueColor);
	const minChroma = mouthResult.ok ? STANDARD_MIN_CLASSIFIABLE_CHROMA : CLOSEUP_MIN_CLASSIFIABLE_CHROMA;
	const minConfidence = mouthResult.ok ? STANDARD_MIN_CLASSIFIABLE_CONFIDENCE : CLOSEUP_MIN_CLASSIFIABLE_CONFIDENCE;
	if (classification.oklch.c < minChroma && classification.confidence < minConfidence) {
		return err({
			kind: 'inconclusive_color',
			chroma: classification.oklch.c,
			confidence: classification.confidence,
		});
	}

	emitStep('building_diagnosis', options);
	const diagnosis = generateDiagnosis(classification);

	return ok({
		diagnosis,
		classification,
		mouthRegion: mouthResult.ok ? mouthResult.value : null,
	});
}

export async function analyzeTongueFromUrl(
	imageUrl: string,
	options?: AnalyzeTongueOptions,
): Promise<Result<AnalysisSuccess, AnalysisError>> {
	emitStep('loading_image', options);

	let image: HTMLImageElement;
	try {
		image = await loadImage(imageUrl);
	} catch (error) {
		return err({ kind: 'image_load_failed', cause: error });
	}

	return analyzeTongueImage(image, options);
}
