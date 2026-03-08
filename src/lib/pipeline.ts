/**
 * Public entry points and shared types for the tongue analysis pipeline.
 *
 * Consumers call {@link analyzeTongueImage}, {@link analyzeTongueVideoFrame},
 * or {@link analyzeTongueFromUrl}; each acquires a frame source, runs face
 * detection, and delegates to the internal orchestrator in `analysis-core.ts`.
 * Progress is reported via the optional {@link AnalyzeTongueOptions.onStep}
 * callback using {@link AnalysisStep} identifiers.
 *
 * @module
 */

import type { TongueColorClassification } from './color-classification.ts';
import type { Diagnosis } from './diagnosis.ts';
import type { MouthDetectionError, MouthRegion } from './face-detection.ts';
import { detectMouthRegion, detectMouthRegionForVideo } from './face-detection.ts';
import type { LightingIssue } from './pipeline/lighting.ts';
import { err, type Result } from './result.ts';
import type { TongueSegmentationError } from './tongue-segmentation.ts';

import { analyzeTongueFrame } from './pipeline/analysis-core.ts';
import { loadImage } from './pipeline/frame-source.ts';

/**
 * Ordered pipeline stages displayed to the user during analysis.
 *
 * Each entry maps a machine-readable {@link AnalysisStep} identifier to a
 * Dutch UI label. The array order matches the execution sequence.
 */
export const ANALYSIS_STEPS = [
	{ step: 'loading_image', label: 'Foto laden' },
	{ step: 'loading_model', label: 'Model initialiseren' },
	{ step: 'detecting_mouth', label: 'Mondregio detecteren' },
	{ step: 'segmenting_tongue', label: 'Tong segmenteren' },
	{ step: 'correcting_color', label: 'Kleur normaliseren' },
	{ step: 'classifying_color', label: 'Tongkleur classificeren' },
	{ step: 'building_diagnosis', label: 'Diagnose opstellen' },
] as const;

/** Union of all pipeline step identifiers, derived from {@link ANALYSIS_STEPS}. */
export type AnalysisStep = (typeof ANALYSIS_STEPS)[number]['step'];

/**
 * Lookup table mapping each {@link AnalysisStep} to its Dutch display label.
 *
 * Derived from {@link ANALYSIS_STEPS} so labels are defined in one place.
 * The `satisfies` constraint guarantees the resulting record covers every step.
 */
export const ANALYSIS_STEP_LABELS = Object.fromEntries(
	ANALYSIS_STEPS.map((entry) => [entry.step, entry.label]),
) as Record<AnalysisStep, string>;

/**
 * Discriminated union of all failure modes in the analysis pipeline.
 *
 * Tagged by `kind`; each variant carries context specific to its failure.
 * Consumers pattern-match on `kind` to render localised error messages.
 *
 * Variants:
 * - `image_load_failed` — The source URL could not be fetched or decoded.
 *   `cause` preserves the original browser error for debugging.
 * - `canvas_unavailable` — `document.createElement('canvas').getContext('2d')`
 *   returned `null`, typically in non-browser environments.
 * - `mouth_crop_failed` — The frame had zero or negative dimensions, or the
 *   bounding box produced an empty crop region.
 * - `face_detection_error` — MediaPipe face detection returned a terminal
 *   error that doesn't qualify for closeup fallback (e.g. `multiple_faces_detected`).
 * - `poor_lighting` — Lighting stats exceeded rejection thresholds;
 *   intersected with {@link LightingIssue} for diagnostic detail.
 * - `tongue_segmentation_error` — HSV segmentation found insufficient tongue
 *   pixels within the allowed mask region.
 * - `inconclusive_color` — Color classification succeeded but chroma and
 *   confidence fell below minimum thresholds, making the result unreliable.
 * - `color_correction_error` — Gray-world correction failed due to a mask/
 *   image size mismatch or an empty mask producing no reference pixels.
 */
export type AnalysisError =
	| { readonly kind: 'image_load_failed'; readonly cause: unknown }
	| { readonly kind: 'canvas_unavailable' }
	| { readonly kind: 'mouth_crop_failed' }
	| { readonly kind: 'face_detection_error'; readonly error: MouthDetectionError }
	| ({ readonly kind: 'poor_lighting' } & LightingIssue)
	| {
		readonly kind: 'tongue_segmentation_error';
		readonly error: TongueSegmentationError;
	}
	| {
		readonly kind: 'inconclusive_color';
		readonly chroma: number;
		readonly confidence: number;
	}
	| {
		readonly kind: 'color_correction_error';
		readonly error:
			| { readonly kind: 'mask_size_mismatch' }
			| { readonly kind: 'no_masked_pixels' };
	};

/** Successful pipeline result carrying everything the UI needs to render. */
export interface AnalysisSuccess {
	/** Satirical TCM diagnosis generated from the colour classification. */
	readonly diagnosis: Diagnosis;
	/** OKLCh-based tongue colour classification with confidence score. */
	readonly classification: TongueColorClassification;
	/** Detected mouth bounding box, or `null` when the closeup fallback was used. */
	readonly mouthRegion: MouthRegion | null;
}

/** Configuration bag for {@link analyzeTongueImage} and siblings. */
export interface AnalyzeTongueOptions {
	/**
	 * Progress callback invoked before each pipeline stage begins.
	 *
	 * @param step - The {@link AnalysisStep} about to execute.
	 */
	readonly onStep?: (step: AnalysisStep) => void;
}

/**
 * Notify the caller that a pipeline stage is starting.
 *
 * No-ops when `options` or `options.onStep` is absent. A throwing
 * callback is swallowed so a faulty observer cannot break the pipeline.
 *
 * @param step - The pipeline stage about to begin.
 * @param options - Caller-provided options containing the progress callback.
 *
 * @example
 * ```ts
 * emitStep('detecting_mouth', { onStep: (s) => console.log(s) });
 * ```
 */
export function emitStep(
	step: AnalysisStep,
	options?: AnalyzeTongueOptions,
): void {
	try {
		options?.onStep?.(step);
	} catch { /* observer must not break the pipeline */ }
}

/**
 * Analyse a tongue from a still image element.
 *
 * Runs MediaPipe face detection, then delegates to {@link analyzeTongueFrame}
 * for segmentation, colour correction, classification, and diagnosis.
 *
 * @param image - A fully loaded `HTMLImageElement` (must have `naturalWidth > 0`).
 * @param options - Optional progress callback; see {@link AnalyzeTongueOptions}.
 * @returns `Result.ok` with {@link AnalysisSuccess}, or `Result.err` with {@link AnalysisError}.
 *
 * @example
 * ```ts
 * const img = document.querySelector('img');
 * if (img instanceof HTMLImageElement) {
 *   const result = await analyzeTongueImage(img, { onStep: console.log });
 *   if (result.ok) console.log(result.value.diagnosis);
 * }
 * ```
 */
export async function analyzeTongueImage(
	image: HTMLImageElement,
	options?: AnalyzeTongueOptions,
): Promise<Result<AnalysisSuccess, AnalysisError>> {
	emitStep('loading_model', options);
	emitStep('detecting_mouth', options);

	const mouthResult = await detectMouthRegion(image);
	return analyzeTongueFrame(image, mouthResult, options);
}

/**
 * Analyse a single video frame from a live camera feed.
 *
 * Uses the video-specific MediaPipe detection API (which requires a
 * monotonically increasing timestamp), then delegates to {@link analyzeTongueFrame}.
 *
 * @param videoFrame - A playing `HTMLVideoElement` with `videoWidth > 0`.
 * @param timestampMs - Monotonically increasing timestamp in milliseconds,
 *   required by MediaPipe's video-mode detection API.
 * @param options - Optional progress callback; see {@link AnalyzeTongueOptions}.
 * @returns `Result.ok` with {@link AnalysisSuccess}, or `Result.err` with {@link AnalysisError}.
 *
 * @example
 * ```ts
 * const result = await analyzeTongueVideoFrame(videoEl, performance.now());
 * ```
 */
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

/**
 * Load an image from a URL and run the full analysis pipeline.
 *
 * Wraps {@link loadImage} + {@link analyzeTongueImage}; returns
 * `image_load_failed` if the URL cannot be fetched or decoded.
 *
 * @param imageUrl - Absolute or data-URI URL of the tongue photo.
 * @param options - Optional progress callback; see {@link AnalyzeTongueOptions}.
 * @returns `Result.ok` with {@link AnalysisSuccess}, or `Result.err` with {@link AnalysisError}.
 *
 * @example
 * ```ts
 * const result = await analyzeTongueFromUrl('data:image/png;base64,...');
 * ```
 */
export async function analyzeTongueFromUrl(
	imageUrl: string,
	options?: AnalyzeTongueOptions,
): Promise<Result<AnalysisSuccess, AnalysisError>> {
	emitStep('loading_image', options);

	let image: HTMLImageElement;
	try {
		image = await loadImage(imageUrl);
	} catch (cause) {
		return err({ kind: 'image_load_failed', cause });
	}

	return analyzeTongueImage(image, options);
}
