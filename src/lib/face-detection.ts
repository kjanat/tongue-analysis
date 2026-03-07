/**
 * MediaPipe-based face landmark detection for mouth region extraction.
 *
 * Loads a FaceLandmarker model (with primary/fallback asset resolution),
 * detects exactly one face, and extracts inner + outer lip polygons with
 * a padded bounding box. Supports both single-image and video-frame modes
 * via a shared singleton landmarker instance.
 *
 * @module
 */

import {
	FaceLandmarker,
	type FaceLandmarkerResult,
	FilesetResolver,
	type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import { type AssetSource, getDownloadBinding, getPackageBinding } from 'virtual:package-bindings';
import { clamp } from './math-utils.ts';
import { err, ok, type Result } from './result.ts';

/** 2D point in pixel coordinates (not normalized). */
export interface Point {
	/** Horizontal position in pixels from the left edge. */
	readonly x: number;
	/** Vertical position in pixels from the top edge. */
	readonly y: number;
}

/** Axis-aligned rectangle in pixel coordinates. */
export interface BoundingBox {
	/** Left edge x-coordinate in pixels. */
	readonly x: number;
	/** Top edge y-coordinate in pixels. */
	readonly y: number;
	/** Horizontal extent in pixels. */
	readonly width: number;
	/** Vertical extent in pixels. */
	readonly height: number;
}

/**
 * Detected mouth geometry extracted from face landmarks.
 *
 * Contains both lip contour polygons and a padded {@link BoundingBox}
 * enclosing the outer lip polygon. Used downstream by
 * {@link segmentTongue} to constrain the search area.
 */
export interface MouthRegion {
	/** Padded axis-aligned bounding box around {@link outerLipPolygon}. */
	readonly boundingBox: BoundingBox;
	/** Closed polygon tracing the outer lip contour (≥8 points when valid). */
	readonly outerLipPolygon: readonly Point[];
	/** Closed polygon tracing the inner lip contour (≥6 points when valid). */
	readonly innerLipPolygon: readonly Point[];
}

/**
 * Discriminated union of mouth detection failure modes.
 *
 * Each variant has a `kind` tag for exhaustive pattern matching.
 *
 * - `invalid_image_dimensions` — source has zero or non-finite dimensions.
 * - `model_load_failed` — WASM or model asset failed to load (both primary and fallback).
 * - `detection_failed` — MediaPipe inference threw at runtime.
 * - `no_face_detected` — zero faces in the frame.
 * - `multiple_faces_detected` — more than one face; ambiguous which mouth to use.
 * - `mouth_not_visible` — face found but mouth is closed, occluded, or too few landmarks.
 */
export type MouthDetectionError =
	| { readonly kind: 'invalid_image_dimensions' }
	| { readonly kind: 'model_load_failed'; readonly cause: unknown }
	| { readonly kind: 'detection_failed'; readonly cause: unknown }
	| { readonly kind: 'no_face_detected' }
	| { readonly kind: 'multiple_faces_detected'; readonly count: number }
	| { readonly kind: 'mouth_not_visible' };

/** MediaPipe running mode — determines whether temporal tracking is used. */
type DetectionMode = 'IMAGE' | 'VIDEO';

/** Resolved WASM fileset returned by {@link FilesetResolver.forVisionTasks}. */
type VisionWasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

/**
 * Discriminated union of detection inputs.
 *
 * - `IMAGE` — single still image, any {@link TexImageSource}.
 * - `VIDEO` — video frame requiring a monotonic timestamp for tracking.
 */
type DetectionInput =
	| {
		readonly mode: 'IMAGE';
		readonly source: TexImageSource;
	}
	| {
		readonly mode: 'VIDEO';
		readonly source: HTMLVideoElement;
		/** Monotonically increasing timestamp in ms; must never decrease between calls. */
		readonly timestampMs: number;
	};

/**
 * The model file isn't part of the npm package — it's downloaded from Google Storage by
 * the package-bindings Vite plugin. WASM ships with `@mediapipe/tasks-vision` and is managed
 * by the same plugin. The model primary/fallback follows WASM source:
 * self-hosted WASM → local model primary; CDN WASM → remote model primary.
 */
const MEDIAPIPE_BINDING = getPackageBinding('@mediapipe/tasks-vision');

/** Downloaded face landmarker model asset (primary + fallback URLs). */
const FACE_LANDMARKER_MODEL = getDownloadBinding('face-landmarker-model');

/** Whether the primary WASM source is self-hosted or CDN; drives model URL selection. */
const WASM_PRIMARY = MEDIAPIPE_BINDING.asset('wasm').primary;

/**
 * MediaPipe Face Mesh landmark indices forming the outer lip contour.
 * 20 points tracing the vermilion border in a closed loop.
 * Reference: https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png
 */
const OUTER_LIP_INDICES = /* dprint-ignore */ [
	61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 185, 40, 39, 37, 0, 267, 269, 270, 409
] as const;

/**
 * MediaPipe Face Mesh landmark indices forming the inner lip contour.
 * 20 points tracing the inner (mucosal) lip boundary in a closed loop.
 */
const INNER_LIP_INDICES = /* dprint-ignore */ [
	78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 191, 80, 81, 82, 13, 312, 311, 310, 415
] as const;

/**
 * Fractional padding added to each side of the lip bounding box.
 * 0.15 = 15% of the lip region's width/height on each side,
 * ensuring the tongue below the lower lip is captured.
 */
const BOUNDING_BOX_PADDING = 0.15;

/**
 * Minimum ratio of inner mouth opening height to outer bounding box height.
 * Below 0.08 the mouth is considered closed (tongue not visible).
 */
const MIN_INNER_MOUTH_OPENING_HEIGHT_RATIO = 0.08;

/** Width and height extracted from a {@link TexImageSource}. */
interface ImageDimensions {
	readonly width: number;
	readonly height: number;
}

// ── Singleton FaceLandmarker Cache ────────────────────
// A single FaceLandmarker is reused across calls. Mode is switched lazily
// via `setOptions` when toggling between IMAGE and VIDEO.

/** Cached landmarker instance; `undefined` until first successful creation. */
let cachedFaceLandmarker: FaceLandmarker | undefined;

/** In-flight creation promise; prevents duplicate parallel instantiations. */
let faceLandmarkerPromise: Promise<FaceLandmarker> | undefined;

/** Running mode of {@link cachedFaceLandmarker}; tracked to avoid redundant `setOptions` calls. */
let currentMode: DetectionMode | undefined;

/**
 * Monotonically increasing counter, incremented on every {@link releaseFaceLandmarker} call.
 *
 * Captured before each `await` in {@link getFaceLandmarker} and re-checked after. If the counter
 * changed while awaiting, a release raced the in-flight creation; the just-created landmarker
 * must be discarded rather than assigned to {@link cachedFaceLandmarker}.
 */
let releaseGeneration = 0;

/**
 * Resolve the WASM fileset base URL for a given asset source.
 *
 * @param source - `'primary'` or `'fallback'`.
 * @returns Base URL string suitable for {@link FilesetResolver.forVisionTasks}.
 */
function wasmBaseUrl(source: AssetSource): string {
	return MEDIAPIPE_BINDING.url('wasm', source);
}

/**
 * Resolve the face landmarker model URL for a given asset source.
 *
 * When WASM is self-hosted, primary model is local and fallback is remote (and vice versa).
 * If no local model URL exists (model not downloaded at build time), always returns remote.
 *
 * @param source - `'primary'` or `'fallback'`.
 * @returns Absolute URL to the `.task` model file.
 */
function modelUrl(source: AssetSource): string {
	const { localUrl, remoteUrl } = FACE_LANDMARKER_MODEL;
	if (localUrl === null) return remoteUrl;

	if (source === 'primary') {
		return WASM_PRIMARY === 'cdn' ? remoteUrl : localUrl;
	}

	return WASM_PRIMARY === 'cdn' ? localUrl : remoteUrl;
}

/**
 * Check whether a numeric dimension is usable (finite and positive).
 *
 * @param value - Dimension value to validate.
 * @returns `true` if `value` is a finite number greater than zero.
 */
function isValidDimension(value: number): boolean {
	return Number.isFinite(value) && value > 0;
}

/**
 * Extract pixel dimensions from any {@link TexImageSource} variant.
 *
 * Tries `videoWidth/Height`, `naturalWidth/Height`, `displayWidth/Height`,
 * then `width/height` — in that priority order — returning the first valid pair.
 * Handles `HTMLVideoElement`, `HTMLImageElement`, `VideoFrame`, `ImageBitmap`,
 * `HTMLCanvasElement`, and `OffscreenCanvas`.
 *
 * @param image - Any WebGL-compatible image source.
 * @returns Dimensions if extractable, `undefined` if source has no valid size.
 */
function getImageDimensions(image: TexImageSource): ImageDimensions | undefined {
	if ('videoWidth' in image && 'videoHeight' in image) {
		if (isValidDimension(image.videoWidth) && isValidDimension(image.videoHeight)) {
			return { width: image.videoWidth, height: image.videoHeight };
		}
	}

	if ('naturalWidth' in image && 'naturalHeight' in image) {
		if (isValidDimension(image.naturalWidth) && isValidDimension(image.naturalHeight)) {
			return { width: image.naturalWidth, height: image.naturalHeight };
		}
	}

	if ('displayWidth' in image && 'displayHeight' in image) {
		if (isValidDimension(image.displayWidth) && isValidDimension(image.displayHeight)) {
			return { width: image.displayWidth, height: image.displayHeight };
		}
	}

	if ('width' in image && 'height' in image) {
		if (typeof image.width === 'number' && typeof image.height === 'number') {
			if (isValidDimension(image.width) && isValidDimension(image.height)) {
				return { width: image.width, height: image.height };
			}
		}
	}

	return undefined;
}

/**
 * Convert a normalized MediaPipe landmark (0–1) to a pixel-space {@link Point}.
 *
 * Coordinates are clamped to [0, 1] before scaling to guard against
 * out-of-frame landmarks that MediaPipe occasionally produces.
 *
 * @param landmark - Normalized landmark from MediaPipe (x, y in [0, 1]).
 * @param dimensions - Target image dimensions for denormalization.
 * @returns Pixel-space point.
 */
function createPoint(landmark: NormalizedLandmark, dimensions: ImageDimensions): Point {
	const x = clamp(landmark.x, 0, 1) * dimensions.width;
	const y = clamp(landmark.y, 0, 1) * dimensions.height;
	return { x, y };
}

/**
 * Gather a subset of face landmarks into a pixel-space polygon.
 *
 * Skips any index whose landmark is missing (defensive against partial detections).
 *
 * @param landmarks - Full set of 478 normalized face landmarks from MediaPipe.
 * @param indices - Landmark indices to collect (e.g. {@link OUTER_LIP_INDICES}).
 * @param dimensions - Image dimensions for denormalization.
 * @returns Ordered array of pixel-space {@link Point}s.
 */
function collectPolygon(
	landmarks: readonly NormalizedLandmark[],
	indices: readonly number[],
	dimensions: ImageDimensions,
): readonly Point[] {
	const points: Point[] = [];

	for (const index of indices) {
		const landmark = landmarks[index];
		if (landmark === undefined) continue;
		points.push(createPoint(landmark, dimensions));
	}

	return points;
}

/**
 * Compute a padded axis-aligned bounding box around a set of points.
 *
 * Adds {@link BOUNDING_BOX_PADDING} on each side (relative to the tight extent),
 * then clamps to image bounds. Returns `undefined` if no points are provided.
 *
 * @param points - Polygon points in pixel space.
 * @param dimensions - Image dimensions for clamping.
 * @returns Padded bounding box, or `undefined` if `points` is empty.
 */
function computeBoundingBox(
	points: readonly Point[],
	dimensions: ImageDimensions,
): BoundingBox | undefined {
	const firstPoint = points[0];
	if (firstPoint === undefined) return undefined;

	let minX = firstPoint.x;
	let maxX = firstPoint.x;
	let minY = firstPoint.y;
	let maxY = firstPoint.y;

	for (const point of points) {
		minX = Math.min(minX, point.x);
		maxX = Math.max(maxX, point.x);
		minY = Math.min(minY, point.y);
		maxY = Math.max(maxY, point.y);
	}

	const width = maxX - minX;
	const height = maxY - minY;
	const paddingX = width * BOUNDING_BOX_PADDING;
	const paddingY = height * BOUNDING_BOX_PADDING;

	const x = clamp(minX - paddingX, 0, dimensions.width);
	const y = clamp(minY - paddingY, 0, dimensions.height);
	const paddedMaxX = clamp(maxX + paddingX, 0, dimensions.width);
	const paddedMaxY = clamp(maxY + paddingY, 0, dimensions.height);

	return {
		x,
		y,
		width: Math.max(0, paddedMaxX - x),
		height: Math.max(0, paddedMaxY - y),
	};
}

/**
 * Instantiate a {@link FaceLandmarker} with project-standard options.
 *
 * Configured for up to 2 faces (to detect the `multiple_faces_detected` error),
 * 50% confidence thresholds, and no blendshapes/transformation matrices
 * (unused by the mouth-extraction pipeline).
 *
 * @param wasmFileset - Pre-resolved WASM fileset.
 * @param mode - `'IMAGE'` or `'VIDEO'` running mode.
 * @param modelAssetPath - URL to the `.task` model file.
 * @returns Promise resolving to a configured FaceLandmarker.
 */
function createFaceLandmarkerWithOptions(
	wasmFileset: VisionWasmFileset,
	mode: DetectionMode,
	modelAssetPath: string,
): Promise<FaceLandmarker> {
	return FaceLandmarker.createFromOptions(wasmFileset, {
		baseOptions: {
			modelAssetPath,
		},
		runningMode: mode,
		numFaces: 2,
		minFaceDetectionConfidence: 0.5,
		minFacePresenceConfidence: 0.5,
		minTrackingConfidence: 0.5,
		outputFaceBlendshapes: false,
		outputFacialTransformationMatrixes: false,
	});
}

/**
 * Create a FaceLandmarker with primary/fallback asset resolution.
 *
 * Tries the primary WASM + model source first; on failure, falls back to
 * the alternate source. This handles CDN outages and missing local builds.
 *
 * @param mode - Running mode for the new instance.
 * @returns Promise resolving to a FaceLandmarker.
 * @throws If both primary and fallback sources fail.
 */
async function createFaceLandmarker(mode: DetectionMode): Promise<FaceLandmarker> {
	try {
		const primaryWasmFileset = await FilesetResolver.forVisionTasks(wasmBaseUrl('primary'));
		return await createFaceLandmarkerWithOptions(primaryWasmFileset, mode, modelUrl('primary'));
	} catch (primaryError: unknown) {
		console.warn('Primary WASM/model source failed, trying fallback:', primaryError);
		const fallbackWasmFileset = await FilesetResolver.forVisionTasks(wasmBaseUrl('fallback'));
		return createFaceLandmarkerWithOptions(
			fallbackWasmFileset,
			mode,
			modelUrl('fallback'),
		);
	}
}

/**
 * Get or create the singleton {@link FaceLandmarker}, switching mode if needed.
 *
 * Lazy-initializes on first call and caches the instance. Concurrent callers
 * share the same in-flight promise to prevent duplicate model loads.
 * If creation fails, the promise is cleared so the next call retries.
 *
 * @param mode - Desired running mode.
 * @returns Promise resolving to the cached (or newly created) FaceLandmarker.
 * @throws If model creation fails (propagated to caller for wrapping in {@link MouthDetectionError}).
 */
async function getFaceLandmarker(mode: DetectionMode): Promise<FaceLandmarker> {
	if (cachedFaceLandmarker !== undefined) {
		if (currentMode !== mode) {
			await cachedFaceLandmarker.setOptions({ runningMode: mode });
			currentMode = mode;
		}
		return cachedFaceLandmarker;
	}

	// Capture generation before yielding so we can detect a concurrent release.
	const gen = releaseGeneration;

	faceLandmarkerPromise ??= createFaceLandmarker(mode);

	let faceLandmarker: FaceLandmarker;
	try {
		faceLandmarker = await faceLandmarkerPromise;
	} catch (error) {
		faceLandmarkerPromise = undefined;
		throw error;
	}

	// A concurrent releaseFaceLandmarker() ran while we were awaiting.
	// The landmarker we just created is now orphaned — close it and bail.
	if (gen !== releaseGeneration) {
		faceLandmarker.close();
		throw new Error('FaceLandmarker released during initialization');
	}

	cachedFaceLandmarker = faceLandmarker;

	// Concurrent callers may have shared this promise (via ??=) but requested
	// a different mode than the one createFaceLandmarker was called with.
	// Bring the landmarker into the correct mode before returning.
	if (currentMode !== mode) {
		await faceLandmarker.setOptions({ runningMode: mode });
	}
	currentMode = mode;

	return faceLandmarker;
}

/**
 * Dispose the singleton FaceLandmarker and free its WASM resources.
 *
 * Safe to call even if no landmarker was created. Subsequent detection
 * calls will re-initialize a fresh instance.
 *
 * @example
 * ```ts
 * // Clean up when the camera component unmounts
 * useEffect(() => () => releaseFaceLandmarker(), []);
 * ```
 */
export function releaseFaceLandmarker(): void {
	releaseGeneration++;
	cachedFaceLandmarker?.close();
	cachedFaceLandmarker = undefined;
	faceLandmarkerPromise = undefined;
	currentMode = undefined;
}

/**
 * Dispatch landmark detection to the correct MediaPipe method based on input mode.
 *
 * @param faceLandmarker - Initialized landmarker instance.
 * @param input - Image or video frame input (discriminated on `mode`).
 * @returns Raw MediaPipe detection result.
 */
function detectLandmarks(
	faceLandmarker: FaceLandmarker,
	input: DetectionInput,
): FaceLandmarkerResult {
	if (input.mode === 'VIDEO') {
		return faceLandmarker.detectForVideo(input.source, input.timestampMs);
	}

	return faceLandmarker.detect(input.source);
}

/**
 * Core mouth detection pipeline shared by image and video entry points.
 *
 * Steps: validate dimensions → load/get landmarker → run inference →
 * validate single face → extract lip polygons → check mouth opening →
 * compute padded bounding box.
 *
 * @param input - Discriminated image or video frame input.
 * @returns {@link MouthRegion} on success, or a typed {@link MouthDetectionError}.
 */
async function detectMouthRegionInternal(
	input: DetectionInput,
): Promise<Result<MouthRegion, MouthDetectionError>> {
	const dimensions = getImageDimensions(input.source);
	if (dimensions === undefined) {
		return err({ kind: 'invalid_image_dimensions' });
	}

	let faceLandmarker: FaceLandmarker;
	try {
		faceLandmarker = await getFaceLandmarker(input.mode);
	} catch (error) {
		return err({ kind: 'model_load_failed', cause: error });
	}

	let result: FaceLandmarkerResult;
	try {
		result = detectLandmarks(faceLandmarker, input);
	} catch (error) {
		return err({ kind: 'detection_failed', cause: error });
	}

	const faces = result.faceLandmarks;
	if (faces.length === 0) {
		return err({ kind: 'no_face_detected' });
	}

	if (faces.length > 1) {
		return err({ kind: 'multiple_faces_detected', count: faces.length });
	}

	const face = faces[0];
	if (face === undefined) {
		return err({ kind: 'no_face_detected' });
	}

	const outerLipPolygon = collectPolygon(face, OUTER_LIP_INDICES, dimensions);
	const innerLipPolygon = collectPolygon(face, INNER_LIP_INDICES, dimensions);

	if (outerLipPolygon.length < 8 || innerLipPolygon.length < 6) {
		return err({ kind: 'mouth_not_visible' });
	}

	const boundingBox = computeBoundingBox(outerLipPolygon, dimensions);
	if (boundingBox === undefined || boundingBox.width === 0 || boundingBox.height === 0) {
		return err({ kind: 'mouth_not_visible' });
	}

	const innerBoundingBox = computeBoundingBox(innerLipPolygon, dimensions);
	if (innerBoundingBox === undefined || innerBoundingBox.height === 0) {
		return err({ kind: 'mouth_not_visible' });
	}

	const openingHeightRatio = innerBoundingBox.height / boundingBox.height;
	if (openingHeightRatio < MIN_INNER_MOUTH_OPENING_HEIGHT_RATIO) {
		return err({ kind: 'mouth_not_visible' });
	}

	return ok({
		boundingBox,
		outerLipPolygon,
		innerLipPolygon,
	});
}

/**
 * Detect the mouth region in a still image.
 *
 * Delegates to {@link detectMouthRegionInternal} in `IMAGE` mode.
 *
 * @param image - Any WebGL-compatible image source (canvas, img, bitmap, etc.).
 * @returns {@link MouthRegion} on success, or a typed {@link MouthDetectionError}.
 *
 * @example
 * ```ts
 * const result = await detectMouthRegion(canvasElement);
 * if (result.ok) {
 *   const { boundingBox, outerLipPolygon } = result.value;
 * }
 * ```
 */
export async function detectMouthRegion(
	image: TexImageSource,
): Promise<Result<MouthRegion, MouthDetectionError>> {
	return detectMouthRegionInternal({
		mode: 'IMAGE',
		source: image,
	});
}

/**
 * Detect the mouth region in a live video frame.
 *
 * Delegates to {@link detectMouthRegionInternal} in `VIDEO` mode,
 * enabling MediaPipe's temporal tracking for smoother results.
 *
 * @param videoFrame - Active `<video>` element with a playing stream.
 * @param timestampMs - Monotonically increasing frame timestamp in milliseconds.
 *   Must never decrease between calls; typically sourced from `performance.now()`.
 * @returns {@link MouthRegion} on success, or a typed {@link MouthDetectionError}.
 *
 * @example
 * ```ts
 * const result = await detectMouthRegionForVideo(videoEl, performance.now());
 * if (!result.ok && result.error.kind === 'mouth_not_visible') {
 *   showPrompt('Open your mouth wider');
 * }
 * ```
 */
export async function detectMouthRegionForVideo(
	videoFrame: HTMLVideoElement,
	timestampMs: number,
): Promise<Result<MouthRegion, MouthDetectionError>> {
	return detectMouthRegionInternal({
		mode: 'VIDEO',
		source: videoFrame,
		timestampMs,
	});
}
