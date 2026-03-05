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
		readonly kind: 'color_correction_error';
		readonly error: { readonly kind: 'mask_size_mismatch' } | { readonly kind: 'no_masked_pixels' };
	};

export interface AnalysisSuccess {
	readonly diagnosis: Diagnosis;
	readonly classification: TongueColorClassification;
	readonly mouthRegion: MouthRegion;
}

interface MouthCrop {
	readonly imageData: ImageData;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
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

export async function analyzeTongueImage(
	image: HTMLImageElement,
	options?: AnalyzeTongueOptions,
): Promise<Result<AnalysisSuccess, AnalysisError>> {
	emitStep('loading_model', options);
	emitStep('detecting_mouth', options);

	const mouthResult = await detectMouthRegion(image);
	if (!mouthResult.ok) {
		return err({ kind: 'face_detection_error', error: mouthResult.error });
	}

	const cropResult = cropMouth(image, mouthResult.value);
	if (!cropResult.ok) {
		return cropResult;
	}

	emitStep('segmenting_tongue', options);
	const maskResult = segmentTongue(cropResult.value.imageData);
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

	emitStep('building_diagnosis', options);
	const diagnosis = generateDiagnosis(classification);

	return ok({
		diagnosis,
		classification,
		mouthRegion: mouthResult.value,
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
