import type { TongueColorClassification } from './color-classification.ts';
import { classifyTongueColor } from './color-classification.ts';
import { applyGrayWorldCorrection } from './color-correction.ts';
import type { Diagnosis } from './diagnosis.ts';
import { generateDiagnosis } from './diagnosis.ts';
import type { MouthDetectionError, MouthRegion } from './face-detection.ts';
import { detectMouthRegion, detectMouthRegionForVideo } from './face-detection.ts';
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
	| {
		readonly kind: 'poor_lighting';
		readonly issue: 'too_dark' | 'too_bright' | 'high_contrast';
		readonly meanLuminance: number;
		readonly darkRatio: number;
		readonly brightRatio: number;
	}
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

const DARK_PIXEL_LUMINANCE = 40;
const BRIGHT_PIXEL_LUMINANCE = 215;
const MIN_MEAN_LUMINANCE = 42;
const MAX_MEAN_LUMINANCE = 220;
const MAX_DARK_RATIO = 0.52;
const MAX_BRIGHT_RATIO = 0.45;
const MAX_STD_DEV = 70;

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

interface FrameDimensions {
	readonly width: number;
	readonly height: number;
}

interface Point2D {
	readonly x: number;
	readonly y: number;
}

interface LightingStats {
	readonly meanLuminance: number;
	readonly stdDevLuminance: number;
	readonly darkRatio: number;
	readonly brightRatio: number;
	readonly sampleCount: number;
}

type FrameSource = HTMLImageElement | HTMLVideoElement;

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

function getFrameDimensions(source: FrameSource): FrameDimensions | undefined {
	if ('naturalWidth' in source && source.naturalWidth > 0 && source.naturalHeight > 0) {
		return { width: source.naturalWidth, height: source.naturalHeight };
	}

	if ('videoWidth' in source && source.videoWidth > 0 && source.videoHeight > 0) {
		return { width: source.videoWidth, height: source.videoHeight };
	}

	return undefined;
}

function cropMouth(source: FrameSource, mouth: MouthRegion): Result<MouthCrop, AnalysisError> {
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

	const canvas = document.createElement('canvas');
	canvas.width = cropWidth;
	canvas.height = cropHeight;

	const context = canvas.getContext('2d');
	if (context === null) {
		return err({ kind: 'canvas_unavailable' });
	}

	context.drawImage(source, x, y, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

	return ok({
		imageData: context.getImageData(0, 0, cropWidth, cropHeight),
		x,
		y,
		width: cropWidth,
		height: cropHeight,
	});
}

function cropFullImage(source: FrameSource): Result<MouthCrop, AnalysisError> {
	const dimensions = getFrameDimensions(source);
	if (dimensions === undefined) {
		return err({ kind: 'mouth_crop_failed' });
	}

	const { width, height } = dimensions;

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

	context.drawImage(source, 0, 0, width, height);

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

		const deltaY = b.y - a.y;
		const intersects = (a.y > point.y) !== (b.y > point.y)
			&& point.x < ((b.x - a.x) * (point.y - a.y)) / deltaY + a.x;

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

function computeLightingStats(
	imageData: ImageData,
	allowedMask: Uint8Array,
): LightingStats | undefined {
	let luminanceSum = 0;
	let luminanceSquaredSum = 0;
	let darkCount = 0;
	let brightCount = 0;
	let sampleCount = 0;

	for (let pixelIndex = 0; pixelIndex < allowedMask.length; pixelIndex++) {
		if (allowedMask[pixelIndex] !== 1) continue;

		const channelIndex = pixelIndex * 4;
		const r = imageData.data[channelIndex];
		const g = imageData.data[channelIndex + 1];
		const b = imageData.data[channelIndex + 2];
		if (r === undefined || g === undefined || b === undefined) continue;

		const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		luminanceSum += luminance;
		luminanceSquaredSum += luminance * luminance;
		sampleCount++;

		if (luminance < DARK_PIXEL_LUMINANCE) darkCount++;
		if (luminance > BRIGHT_PIXEL_LUMINANCE) brightCount++;
	}

	if (sampleCount === 0) return undefined;

	const meanLuminance = luminanceSum / sampleCount;
	const variance = Math.max(0, luminanceSquaredSum / sampleCount - meanLuminance * meanLuminance);
	const stdDevLuminance = Math.sqrt(variance);

	return {
		meanLuminance,
		stdDevLuminance,
		darkRatio: darkCount / sampleCount,
		brightRatio: brightCount / sampleCount,
		sampleCount,
	};
}

function detectLightingIssue(
	imageData: ImageData,
	allowedMask: Uint8Array,
):
	| {
		readonly issue: 'too_dark' | 'too_bright' | 'high_contrast';
		readonly meanLuminance: number;
		readonly darkRatio: number;
		readonly brightRatio: number;
	}
	| undefined
{
	const stats = computeLightingStats(imageData, allowedMask);
	if (stats === undefined || stats.sampleCount < 50) return undefined;

	if (stats.meanLuminance < MIN_MEAN_LUMINANCE || stats.darkRatio > MAX_DARK_RATIO) {
		return {
			issue: 'too_dark',
			meanLuminance: stats.meanLuminance,
			darkRatio: stats.darkRatio,
			brightRatio: stats.brightRatio,
		};
	}

	if (stats.meanLuminance > MAX_MEAN_LUMINANCE || stats.brightRatio > MAX_BRIGHT_RATIO) {
		return {
			issue: 'too_bright',
			meanLuminance: stats.meanLuminance,
			darkRatio: stats.darkRatio,
			brightRatio: stats.brightRatio,
		};
	}

	if (stats.stdDevLuminance > MAX_STD_DEV && (stats.darkRatio > 0.18 || stats.brightRatio > 0.18)) {
		return {
			issue: 'high_contrast',
			meanLuminance: stats.meanLuminance,
			darkRatio: stats.darkRatio,
			brightRatio: stats.brightRatio,
		};
	}

	return undefined;
}

function shouldUseCloseupFallback(
	mouthResult: Result<MouthRegion, MouthDetectionError>,
): boolean {
	return !mouthResult.ok
		&& (
			mouthResult.error.kind === 'no_face_detected'
			|| mouthResult.error.kind === 'mouth_not_visible'
			|| mouthResult.error.kind === 'model_load_failed'
			|| mouthResult.error.kind === 'detection_failed'
		);
}

function analyzeTongueFrame(
	source: FrameSource,
	mouthResult: Result<MouthRegion, MouthDetectionError>,
	options?: AnalyzeTongueOptions,
): Result<AnalysisSuccess, AnalysisError> {
	const canUseCloseupFallback = shouldUseCloseupFallback(mouthResult);

	if (!mouthResult.ok && !canUseCloseupFallback) {
		return err({ kind: 'face_detection_error', error: mouthResult.error });
	}

	const cropResult = mouthResult.ok ? cropMouth(source, mouthResult.value) : cropFullImage(source);
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
		const lightingIssue = detectLightingIssue(cropResult.value.imageData, allowedMask);
		if (lightingIssue !== undefined) {
			return err({
				kind: 'poor_lighting',
				issue: lightingIssue.issue,
				meanLuminance: lightingIssue.meanLuminance,
				darkRatio: lightingIssue.darkRatio,
				brightRatio: lightingIssue.brightRatio,
			});
		}

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
		const lightingIssue = detectLightingIssue(cropResult.value.imageData, allowedMask);
		if (lightingIssue !== undefined) {
			return err({
				kind: 'poor_lighting',
				issue: lightingIssue.issue,
				meanLuminance: lightingIssue.meanLuminance,
				darkRatio: lightingIssue.darkRatio,
				brightRatio: lightingIssue.brightRatio,
			});
		}

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

export async function analyzeTongueImage(
	image: HTMLImageElement,
	options?: AnalyzeTongueOptions,
): Promise<Result<AnalysisSuccess, AnalysisError>> {
	emitStep('loading_model', options);
	emitStep('detecting_mouth', options);

	const mouthResult = await detectMouthRegion(image);

	return analyzeTongueFrame(image, mouthResult, options);
}

export async function analyzeTongueVideoFrame(
	videoFrame: HTMLVideoElement,
	timestampMs: number,
	options?: AnalyzeTongueOptions,
): Promise<Result<AnalysisSuccess, AnalysisError>> {
	emitStep('loading_model', options);
	emitStep('detecting_mouth', options);

	const mouthResult = await detectMouthRegionForVideo(videoFrame, timestampMs);

	return analyzeTongueFrame(videoFrame, mouthResult, options);
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
