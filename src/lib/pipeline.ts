import type { TongueColorClassification } from './color-classification.ts';
import type { Diagnosis } from './diagnosis.ts';
import type { MouthDetectionError, MouthRegion } from './face-detection.ts';
import { detectMouthRegion, detectMouthRegionForVideo } from './face-detection.ts';
import type { LightingIssue } from './pipeline/lighting.ts';
import { err, type Result } from './result.ts';

import { analyzeTongueFrame } from './pipeline/analysis-core.ts';
import { loadImage } from './pipeline/frame-source.ts';

export const ANALYSIS_STEPS = [
	{ step: 'loading_image', label: 'Foto laden' },
	{ step: 'loading_model', label: 'Model initialiseren' },
	{ step: 'detecting_mouth', label: 'Mondregio detecteren' },
	{ step: 'segmenting_tongue', label: 'Tong segmenteren' },
	{ step: 'correcting_color', label: 'Kleur normaliseren' },
	{ step: 'classifying_color', label: 'Tongkleur classificeren' },
	{ step: 'building_diagnosis', label: 'Diagnose opstellen' },
] as const;

export type AnalysisStep = (typeof ANALYSIS_STEPS)[number]['step'];

export const ANALYSIS_STEP_LABELS: Readonly<Record<AnalysisStep, string>> = Object.fromEntries(
	ANALYSIS_STEPS.map(({ step, label }) => [step, label]),
) as Record<AnalysisStep, string>;

export type AnalysisError =
	| { readonly kind: 'image_load_failed'; readonly cause: unknown }
	| { readonly kind: 'canvas_unavailable' }
	| { readonly kind: 'mouth_crop_failed' }
	| { readonly kind: 'face_detection_error'; readonly error: MouthDetectionError }
	| ({ readonly kind: 'poor_lighting' } & LightingIssue)
	| {
		readonly kind: 'tongue_segmentation_error';
		readonly error: import('./tongue-segmentation.ts').TongueSegmentationError;
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

export interface AnalysisSuccess {
	readonly diagnosis: Diagnosis;
	readonly classification: TongueColorClassification;
	readonly mouthRegion: MouthRegion | null;
}

export interface AnalyzeTongueOptions {
	readonly onStep?: (step: AnalysisStep) => void;
}

export function emitStep(
	step: AnalysisStep,
	options?: AnalyzeTongueOptions,
): void {
	options?.onStep?.(step);
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
	} catch (cause) {
		return err({ kind: 'image_load_failed', cause });
	}

	return analyzeTongueImage(image, options);
}
