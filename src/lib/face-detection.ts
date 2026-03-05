import {
	FaceLandmarker,
	type FaceLandmarkerResult,
	FilesetResolver,
	type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import { err, ok, type Result } from './result.ts';

export interface Point {
	readonly x: number;
	readonly y: number;
}

export interface BoundingBox {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface MouthRegion {
	readonly boundingBox: BoundingBox;
	readonly outerLipPolygon: readonly Point[];
	readonly innerLipPolygon: readonly Point[];
}

export type MouthDetectionError =
	| { readonly kind: 'invalid_image_dimensions' }
	| { readonly kind: 'model_load_failed'; readonly cause: unknown }
	| { readonly kind: 'detection_failed'; readonly cause: unknown }
	| { readonly kind: 'no_face_detected' }
	| { readonly kind: 'multiple_faces_detected'; readonly count: number }
	| { readonly kind: 'mouth_not_visible' };

const MEDIAPIPE_WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';
const FACE_LANDMARKER_MODEL_URL =
	'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const OUTER_LIP_INDICES = /* dprint-ignore */ [
	61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 185, 40, 39, 37, 0, 267, 269, 270, 409
] as const;

const INNER_LIP_INDICES = /* dprint-ignore */ [
	78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 191, 80, 81, 82, 13, 312, 311, 310, 415
] as const;

const BOUNDING_BOX_PADDING = 0.15;
const MIN_INNER_MOUTH_OPENING_HEIGHT_RATIO = 0.08;

interface ImageDimensions {
	readonly width: number;
	readonly height: number;
}

let cachedFaceLandmarker: FaceLandmarker | undefined;
let faceLandmarkerPromise: Promise<FaceLandmarker> | undefined;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function isValidDimension(value: number): boolean {
	return Number.isFinite(value) && value > 0;
}

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

function createPoint(landmark: NormalizedLandmark, dimensions: ImageDimensions): Point {
	const x = clamp(landmark.x, 0, 1) * dimensions.width;
	const y = clamp(landmark.y, 0, 1) * dimensions.height;
	return { x, y };
}

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

async function createFaceLandmarker(): Promise<FaceLandmarker> {
	const wasmFileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE_URL);

	return FaceLandmarker.createFromOptions(wasmFileset, {
		baseOptions: {
			modelAssetPath: FACE_LANDMARKER_MODEL_URL,
		},
		runningMode: 'IMAGE',
		numFaces: 2,
		minFaceDetectionConfidence: 0.5,
		minFacePresenceConfidence: 0.5,
		minTrackingConfidence: 0.5,
		outputFaceBlendshapes: false,
		outputFacialTransformationMatrixes: false,
	});
}

async function getFaceLandmarker(): Promise<FaceLandmarker> {
	if (cachedFaceLandmarker !== undefined) {
		return cachedFaceLandmarker;
	}

	faceLandmarkerPromise ??= createFaceLandmarker();

	try {
		const faceLandmarker = await faceLandmarkerPromise;
		cachedFaceLandmarker = faceLandmarker;
		return faceLandmarker;
	} catch (error) {
		faceLandmarkerPromise = undefined;
		throw error;
	}
}

export function releaseFaceLandmarker(): void {
	cachedFaceLandmarker?.close();
	cachedFaceLandmarker = undefined;
	faceLandmarkerPromise = undefined;
}

export async function detectMouthRegion(
	image: TexImageSource,
): Promise<Result<MouthRegion, MouthDetectionError>> {
	const dimensions = getImageDimensions(image);
	if (dimensions === undefined) {
		return err({ kind: 'invalid_image_dimensions' });
	}

	let faceLandmarker: FaceLandmarker;
	try {
		faceLandmarker = await getFaceLandmarker();
	} catch (error) {
		return err({ kind: 'model_load_failed', cause: error });
	}

	let result: FaceLandmarkerResult;
	try {
		result = faceLandmarker.detect(image);
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
