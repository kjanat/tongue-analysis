/**
 * Core orchestrator for single-frame tongue analysis.
 *
 * Receives a frame source and a face-detection result, then drives the
 * remaining pipeline stages: crop, lighting check, HSV segmentation,
 * gray-world colour correction, OKLCh classification, and diagnosis
 * generation. Falls back to full-image analysis when face detection fails
 * with a recoverable error.
 *
 * @module
 */

import { classifyTongueColor } from '../color-classification.ts';
import { applyGrayWorldCorrection } from '../color-correction.ts';
import { generateDiagnosis } from '../diagnosis.ts';
import type { MouthDetectionError, MouthRegion } from '../face-detection.ts';
import { err, ok, type Result } from '../result.ts';
import { segmentTongue } from '../tongue-segmentation.ts';

import type { AnalysisError, AnalysisStep, AnalysisSuccess, AnalyzeTongueOptions } from '../pipeline.ts';
import { cropFullImage, cropMouth } from './crop.ts';
import { detectLightingIssue } from './lighting.ts';
import { fallbackMinimumPixels, makeFallbackAllowedMask, makeMouthOpeningMask } from './mask.ts';
import {
	CLOSEUP_MIN_CLASSIFIABLE_CHROMA,
	CLOSEUP_MIN_CLASSIFIABLE_CONFIDENCE,
	STANDARD_MIN_CLASSIFIABLE_CHROMA,
	STANDARD_MIN_CLASSIFIABLE_CONFIDENCE,
} from './thresholds.ts';
import type { FrameSource } from './types.ts';

/**
 * Forward a pipeline step notification to the caller.
 *
 * Duplicated from the public API module to avoid a circular import;
 * both call through to {@link AnalyzeTongueOptions.onStep}. A throwing
 * callback is swallowed so a faulty observer cannot break the pipeline.
 *
 * @param step - Pipeline stage identifier.
 * @param options - Caller options containing the optional callback.
 */
function emitStep(step: AnalysisStep, options?: AnalyzeTongueOptions): void {
	try {
		options?.onStep?.(step);
	} catch { /* observer must not break the pipeline */ }
}

/**
 * Determine whether a face-detection failure qualifies for closeup fallback.
 *
 * The fallback path analyses the entire frame with relaxed thresholds,
 * which is appropriate when the image is already a tongue closeup.
 * Only recoverable detection errors (no face, mouth not visible, model
 * load failure, generic detection failure) trigger the fallback;
 * `multiple_faces_detected` is considered a hard error.
 *
 * @param mouthResult - Result from MediaPipe face detection.
 * @returns `true` if the error kind permits full-image fallback.
 */
function shouldUseCloseupFallback(
	mouthResult: Result<MouthRegion, MouthDetectionError>,
): boolean {
	return (
		!mouthResult.ok
		&& (
			mouthResult.error.kind === 'no_face_detected'
			|| mouthResult.error.kind === 'mouth_not_visible'
			|| mouthResult.error.kind === 'model_load_failed'
			|| mouthResult.error.kind === 'detection_failed'
		)
	);
}

/**
 * Produce a cropped image region and its spatial mask for segmentation.
 *
 * When face detection succeeded, crops the mouth bounding box and builds
 * a polygon-based mask from the inner lip landmarks. On fallback, uses
 * the full frame with an elliptical mask approximating a tongue closeup.
 *
 * @param source - The original image or video element.
 * @param mouthResult - Face detection result; determines crop strategy.
 * @returns Crop data, allowed-pixel mask, optional minimum pixel count,
 *   the mouth region (or `null`), and whether the fallback path was used.
 */
function resolveCrop(
	source: FrameSource,
	mouthResult: Result<MouthRegion, MouthDetectionError>,
): Result<
	{
		readonly crop: import('./types.ts').MouthCrop;
		readonly allowedMask: Uint8Array;
		readonly minimumPixels: number | undefined;
		readonly mouthRegion: MouthRegion | null;
		readonly usedFallback: boolean;
	},
	AnalysisError
> {
	const usedFallback = !mouthResult.ok;
	const cropResult = mouthResult.ok
		? cropMouth(source, mouthResult.value)
		: cropFullImage(source);

	if (!cropResult.ok) return cropResult;

	let allowedMask: Uint8Array;
	let minimumPixels: number | undefined;

	if (mouthResult.ok) {
		allowedMask = makeMouthOpeningMask(cropResult.value, mouthResult.value);
		minimumPixels = undefined;
	} else {
		const fallback = makeFallbackAllowedMask(cropResult.value.width, cropResult.value.height);
		allowedMask = fallback.mask;
		minimumPixels = fallbackMinimumPixels(cropResult.value.width, cropResult.value.height, fallback.allowedPixels);
	}

	return ok({
		crop: cropResult.value,
		allowedMask,
		minimumPixels,
		mouthRegion: mouthResult.ok ? mouthResult.value : null,
		usedFallback,
	});
}

/**
 * Check lighting quality and wrap any detected issue as an {@link AnalysisError}.
 *
 * Used as a secondary diagnostic: when segmentation or classification
 * fails, this determines whether poor lighting was the root cause.
 *
 * @param imageData - RGBA pixel data of the cropped region.
 * @param allowedMask - Per-pixel mask (1 = include in analysis).
 * @returns An `AnalysisError` with `kind: 'poor_lighting'` if an issue
 *   is detected, otherwise `undefined`.
 */
function mapLightingError(
	imageData: ImageData,
	allowedMask: Uint8Array,
): AnalysisError | undefined {
	const issue = detectLightingIssue(imageData, allowedMask);
	if (issue === undefined) return undefined;

	return { kind: 'poor_lighting', ...issue };
}

/**
 * Run the full post-detection pipeline on a single frame.
 *
 * Orchestration sequence:
 * 1. Decide whether to fall back to full-image analysis.
 * 2. Crop the mouth region (or full frame) and build the allowed mask.
 * 3. Segment tongue pixels via HSV thresholds.
 * 4. Apply gray-world colour correction on the tongue mask.
 * 5. Classify the corrected colour in OKLCh space.
 * 6. Gate on chroma/confidence thresholds (tighter for standard path,
 *    relaxed for closeup fallback).
 * 7. Generate a satirical TCM diagnosis.
 *
 * At steps 3 and 5, lighting is checked as a secondary diagnostic
 * when the primary operation fails, so the user gets an actionable
 * error ("improve your lighting") rather than a generic one.
 *
 * @param source - The drawable element containing the frame.
 * @param mouthResult - Result of face/mouth detection on this frame.
 * @param options - Optional progress callback.
 * @returns `Result.ok` with {@link AnalysisSuccess}, or `Result.err`
 *   with {@link AnalysisError}.
 *
 * @example
 * ```ts
 * const mouth = await detectMouthRegion(image);
 * const result = analyzeTongueFrame(image, mouth);
 * ```
 */
export function analyzeTongueFrame(
	source: FrameSource,
	mouthResult: Result<MouthRegion, MouthDetectionError>,
	options?: AnalyzeTongueOptions,
): Result<AnalysisSuccess, AnalysisError> {
	const canUseCloseupFallback = shouldUseCloseupFallback(mouthResult);

	if (!mouthResult.ok && !canUseCloseupFallback) {
		return err({ kind: 'face_detection_error', error: mouthResult.error });
	}

	const prepared = resolveCrop(source, mouthResult);
	if (!prepared.ok) return prepared;

	const { crop, allowedMask, minimumPixels, mouthRegion, usedFallback } = prepared.value;

	emitStep('segmenting_tongue', options);
	const maskResult = segmentTongue(crop.imageData, { allowedMask, minimumPixels });
	if (!maskResult.ok) {
		const lightingError = mapLightingError(crop.imageData, allowedMask);
		if (lightingError !== undefined) return err(lightingError);

		return err({ kind: 'tongue_segmentation_error', error: maskResult.error });
	}

	emitStep('correcting_color', options);
	const correctionResult = applyGrayWorldCorrection(crop.imageData, maskResult.value);
	if (!correctionResult.ok) {
		return err({ kind: 'color_correction_error', error: correctionResult.error });
	}

	emitStep('classifying_color', options);
	const classification = classifyTongueColor(correctionResult.value.averageTongueColor);

	const minChroma = usedFallback
		? CLOSEUP_MIN_CLASSIFIABLE_CHROMA
		: STANDARD_MIN_CLASSIFIABLE_CHROMA;
	const minConfidence = usedFallback
		? CLOSEUP_MIN_CLASSIFIABLE_CONFIDENCE
		: STANDARD_MIN_CLASSIFIABLE_CONFIDENCE;

	// Both conditions required: low chroma alone is valid (pale tongue types like
	// qi-deficiëntie are naturally desaturated), and low confidence alone still
	// carries useful signal. Only reject when there's genuinely nothing to work with.
	if (classification.oklch.c < minChroma && classification.confidence < minConfidence) {
		const lightingError = mapLightingError(crop.imageData, allowedMask);
		if (lightingError !== undefined) return err(lightingError);

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
		mouthRegion,
	});
}
