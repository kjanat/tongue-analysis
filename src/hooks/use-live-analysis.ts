import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Diagnosis } from '../lib/diagnosis.ts';
import type { MouthRegion, Point } from '../lib/face-detection.ts';
import { type AnalysisError, type AnalysisStep, analyzeTongueVideoFrame } from '../lib/pipeline.ts';

const LIVE_UPDATED_AT_THROTTLE_MS = 1000;
const DEBUG_OVERLAY_ENABLED = import.meta.env.VITE_DEBUG_OVERLAY === 'true';

export type LiveMode = 'idle' | 'running';

interface UseLiveAnalysisOptions {
	readonly videoRef: RefObject<HTMLVideoElement | null>;
	readonly overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
	readonly enabled: boolean;
}

interface UseLiveAnalysisResult {
	readonly liveMode: LiveMode;
	readonly liveStep: AnalysisStep | null;
	readonly liveError: string | null;
	readonly liveDiagnosis: Diagnosis | null;
	readonly liveUpdatedAt: number | null;
	readonly liveHasStarted: boolean;
	readonly start: () => void;
	readonly stop: () => void;
	readonly clearError: () => void;
	readonly reset: () => void;
}

function liveErrorMessage(error: AnalysisError): string {
	switch (error.kind) {
		case 'image_load_failed':
			return 'Frame laden mislukt. Houd je camera stil en probeer opnieuw.';
		case 'canvas_unavailable':
			return 'Canvas niet beschikbaar voor live-analyse.';
		case 'mouth_crop_failed':
			return 'Mondregio kon niet worden uitgesneden uit het videobeeld.';
		case 'face_detection_error':
			switch (error.error.kind) {
				case 'no_face_detected':
					return 'Geen gezicht gevonden in beeld.';
				case 'multiple_faces_detected':
					return 'Meerdere gezichten in beeld. Houd slechts een persoon in frame.';
				case 'mouth_not_visible':
					return 'Mond niet duidelijk zichtbaar. Open je mond en steek je tong uit.';
				case 'invalid_image_dimensions':
					return 'Videoframe heeft ongeldige afmetingen.';
				case 'model_load_failed':
					return 'Model kon niet geladen worden.';
				case 'detection_failed':
					return 'Gezichtsdetectie mislukte.';
			}
			return 'Gezichtsdetectie gaf een onbekende fout.';
		case 'poor_lighting':
			switch (error.issue) {
				case 'too_dark':
					return 'Te donker voor betrouwbare live-analyse.';
				case 'too_bright':
					return 'Te fel belicht voor betrouwbare live-analyse.';
				case 'high_contrast':
					return 'Te veel lichtcontrast. Gebruik egaal frontaal licht.';
			}
			return 'Belichting onvoldoende voor betrouwbare live-analyse.';
		case 'tongue_segmentation_error':
			switch (error.error.kind) {
				case 'empty_input':
					return 'Leeg frame ontvangen tijdens segmentatie.';
				case 'allowed_mask_size_mismatch':
					return 'Interne maskfout tijdens live-analyse.';
				case 'no_tongue_pixels_detected':
					return 'Tong niet duidelijk zichtbaar in beeld.';
				case 'multiple_regions_detected':
					return "Meerdere losse tongregio's gedetecteerd. Gebruik 1 duidelijke tong in beeld.";
				case 'insufficient_pixels':
					return 'Te weinig bruikbare tongpixels in dit frame.';
			}
			return 'Tongsegmentatie gaf een onbekende fout.';
		case 'color_correction_error':
			return 'Kleurcorrectie mislukte voor dit frame.';
		case 'inconclusive_color':
			return 'Frame is nog niet duidelijk genoeg. Houd je tong stil in egaal licht.';
	}

	return 'Onbekende live-analysefout.';
}

function isAnalysisError(value: unknown): value is AnalysisError {
	if (typeof value !== 'object' || value === null || !('kind' in value)) {
		return false;
	}

	switch (value.kind) {
		case 'image_load_failed':
		case 'canvas_unavailable':
		case 'mouth_crop_failed':
		case 'face_detection_error':
		case 'poor_lighting':
		case 'tongue_segmentation_error':
		case 'color_correction_error':
		case 'inconclusive_color':
			return true;
		default:
			return false;
	}
}

function scalePoint(
	point: Point,
	scaleX: number,
	scaleY: number,
): Point {
	return {
		x: point.x * scaleX,
		y: point.y * scaleY,
	};
}

function drawPolygon(
	context: CanvasRenderingContext2D,
	points: readonly Point[],
	strokeColor: string,
): void {
	const first = points[0];
	if (first === undefined) return;

	context.beginPath();
	context.moveTo(first.x, first.y);
	for (let i = 1; i < points.length; i++) {
		const point = points[i];
		if (point === undefined) continue;
		context.lineTo(point.x, point.y);
	}
	context.closePath();
	context.strokeStyle = strokeColor;
	context.lineWidth = 2;
	context.stroke();
}

function clearOverlayCanvas(canvas: HTMLCanvasElement | null): void {
	if (canvas === null) return;
	const context = canvas.getContext('2d');
	if (context === null) return;
	context.clearRect(0, 0, canvas.width, canvas.height);
}

function drawMouthRegionOverlay(
	canvas: HTMLCanvasElement,
	mouthRegion: MouthRegion,
	sourceWidth: number,
	sourceHeight: number,
): void {
	const context = canvas.getContext('2d');
	if (context === null) return;

	const displayWidth = canvas.clientWidth;
	const displayHeight = canvas.clientHeight;
	if (displayWidth <= 0 || displayHeight <= 0) return;

	const dpr = window.devicePixelRatio || 1;
	const targetWidth = Math.round(displayWidth * dpr);
	const targetHeight = Math.round(displayHeight * dpr);
	if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
		canvas.width = targetWidth;
		canvas.height = targetHeight;
	}

	context.setTransform(dpr, 0, 0, dpr, 0, 0);
	context.clearRect(0, 0, displayWidth, displayHeight);

	const scaleX = displayWidth / sourceWidth;
	const scaleY = displayHeight / sourceHeight;

	const scaledOuter = mouthRegion.outerLipPolygon.map((point) => scalePoint(point, scaleX, scaleY));
	const scaledInner = mouthRegion.innerLipPolygon.map((point) => scalePoint(point, scaleX, scaleY));

	const boxX = mouthRegion.boundingBox.x * scaleX;
	const boxY = mouthRegion.boundingBox.y * scaleY;
	const boxWidth = mouthRegion.boundingBox.width * scaleX;
	const boxHeight = mouthRegion.boundingBox.height * scaleY;

	context.strokeStyle = '#ffd166';
	context.lineWidth = 2;
	context.strokeRect(boxX, boxY, boxWidth, boxHeight);

	drawPolygon(context, scaledOuter, '#52ffa8');
	drawPolygon(context, scaledInner, '#7dd3ff');
}

export function useLiveAnalysis(options: UseLiveAnalysisOptions): UseLiveAnalysisResult {
	const { enabled, overlayCanvasRef, videoRef } = options;
	const [liveMode, setLiveMode] = useState<LiveMode>('idle');
	const [liveStep, setLiveStep] = useState<AnalysisStep | null>(null);
	const [liveError, setLiveError] = useState<string | null>(null);
	const [liveDiagnosis, setLiveDiagnosis] = useState<Diagnosis | null>(null);
	const [liveUpdatedAt, setLiveUpdatedAt] = useState<number | null>(null);
	const [liveHasStarted, setLiveHasStarted] = useState(false);
	const liveRunningRef = useRef(false);
	const liveRafRef = useRef<number | null>(null);
	const liveInFlightRef = useRef(false);
	const liveSessionIdRef = useRef(0);
	const lastVideoTimeRef = useRef(-1);
	const lastUpdatedAtRef = useRef(0);

	const isLiveActive = useCallback((): boolean => liveRunningRef.current, []);

	const stop = useCallback(() => {
		liveRunningRef.current = false;
		if (liveRafRef.current !== null) {
			window.cancelAnimationFrame(liveRafRef.current);
			liveRafRef.current = null;
		}

		liveInFlightRef.current = false;
		lastVideoTimeRef.current = -1;
		setLiveMode('idle');
		setLiveStep(null);
	}, []);

	const clearError = useCallback(() => {
		setLiveError(null);
	}, []);

	const reset = useCallback(() => {
		stop();
		clearOverlayCanvas(overlayCanvasRef.current);
		setLiveError(null);
		setLiveDiagnosis(null);
		setLiveUpdatedAt(null);
		setLiveHasStarted(false);
	}, [overlayCanvasRef, stop]);

	const runLiveAnalysis = useCallback(async () => {
		if (!isLiveActive() || liveInFlightRef.current) return;

		const video = videoRef.current;
		if (video === null || video.videoWidth === 0 || video.videoHeight === 0) {
			setLiveError('Videobeeld nog niet klaar voor analyse.');
			if (DEBUG_OVERLAY_ENABLED) {
				clearOverlayCanvas(overlayCanvasRef.current);
			}
			return;
		}

		if (video.currentTime === lastVideoTimeRef.current) {
			return;
		}

		const sessionId = liveSessionIdRef.current;
		const isCurrentSession = (): boolean => sessionId === liveSessionIdRef.current && isLiveActive();

		lastVideoTimeRef.current = video.currentTime;
		liveInFlightRef.current = true;

		try {
			const timestampMs = performance.now();
			const result = await analyzeTongueVideoFrame(video, timestampMs, {
				onStep: (step) => {
					if (!isCurrentSession()) return;
					setLiveStep(step);
				},
			});

			if (!isCurrentSession()) {
				return;
			}

			if (!result.ok) {
				if (
					DEBUG_OVERLAY_ENABLED
					&& result.error.kind === 'face_detection_error'
					&& result.error.error.kind === 'model_load_failed'
				) {
					console.error('Live face model load failed:', result.error.error.cause);
				}

				setLiveError(liveErrorMessage(result.error));
				if (DEBUG_OVERLAY_ENABLED) {
					clearOverlayCanvas(overlayCanvasRef.current);
				}
				return;
			}

			setLiveDiagnosis(result.value.diagnosis);
			setLiveError(null);

			const now = Date.now();
			if (now - lastUpdatedAtRef.current >= LIVE_UPDATED_AT_THROTTLE_MS) {
				setLiveUpdatedAt(now);
				lastUpdatedAtRef.current = now;
			}

			if (DEBUG_OVERLAY_ENABLED) {
				const overlayCanvas = overlayCanvasRef.current;
				const mouthRegion = result.value.mouthRegion;
				if (overlayCanvas !== null && mouthRegion !== null) {
					drawMouthRegionOverlay(overlayCanvas, mouthRegion, video.videoWidth, video.videoHeight);
				} else {
					clearOverlayCanvas(overlayCanvas);
				}
			}
		} catch (caughtError: unknown) {
			if (!isCurrentSession()) {
				return;
			}

			if (isAnalysisError(caughtError)) {
				setLiveError(liveErrorMessage(caughtError));
			} else {
				setLiveError('Onbekende live-analysefout.');
			}

			if (DEBUG_OVERLAY_ENABLED) {
				clearOverlayCanvas(overlayCanvasRef.current);
			}
		} finally {
			if (sessionId === liveSessionIdRef.current && isLiveActive()) {
				liveInFlightRef.current = false;
			}
		}
	}, [isLiveActive, overlayCanvasRef, videoRef]);

	const start = useCallback(() => {
		if (!enabled || liveRunningRef.current) return;

		liveSessionIdRef.current += 1;
		liveRunningRef.current = true;
		setLiveHasStarted(true);
		setLiveMode('running');
		setLiveStep('loading_model');
		setLiveError(null);
		lastVideoTimeRef.current = -1;

		const tick = (): void => {
			if (!liveRunningRef.current) return;
			void runLiveAnalysis().then(() => {
				if (liveRunningRef.current) {
					liveRafRef.current = window.requestAnimationFrame(tick);
				}
			});
		};

		liveRafRef.current = window.requestAnimationFrame(tick);
	}, [enabled, runLiveAnalysis]);

	useEffect(() => {
		return () => {
			stop();
		};
	}, [stop]);

	return {
		liveMode,
		liveStep,
		liveError,
		liveDiagnosis,
		liveUpdatedAt,
		liveHasStarted,
		start,
		stop,
		clearError,
		reset,
	};
}
