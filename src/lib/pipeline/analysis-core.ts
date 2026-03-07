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

function emitStep(step: AnalysisStep, options?: AnalyzeTongueOptions): void {
	options?.onStep?.(step);
}

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

function mapLightingError(
	imageData: ImageData,
	allowedMask: Uint8Array,
): AnalysisError | undefined {
	const issue = detectLightingIssue(imageData, allowedMask);
	if (issue === undefined) return undefined;

	return { kind: 'poor_lighting', ...issue };
}

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
