/**
 * @module use-live-analysis
 * Continuous real-time tongue analysis loop driven by `requestAnimationFrame`.
 * Feeds video frames from a live camera into {@link analyzeTongueVideoFrame},
 * throttles state updates, and optionally renders a debug overlay showing
 * detected mouth regions.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { clearOverlayCanvas, drawMouthRegionOverlay } from '../lib/debug-overlay.ts';
import type { Diagnosis } from '../lib/diagnosis.ts';
import { type AnalysisError, type AnalysisStep, analyzeTongueVideoFrame } from '../lib/pipeline.ts';

/**
 * Minimum interval (ms) between React state updates during live analysis.
 * Prevents excessive re-renders while the rAF loop runs at display refresh rate.
 * The analysis loop still runs every frame; only UI-facing state writes are throttled.
 */
const LIVE_UPDATED_AT_THROTTLE_MS = 1000;

/**
 * Whether to render the debug overlay (mouth bounding box + lip polygons).
 * Controlled by the `VITE_DEBUG_OVERLAY` build-time env var.
 */
const DEBUG_OVERLAY_ENABLED = import.meta.env.VITE_DEBUG_OVERLAY === 'true';

/**
 * All top-level {@link AnalysisError} `kind` discriminants.
 * Used by {@link isAnalysisError} to validate unknown catch-block values.
 * `satisfies` ensures every element is a valid `AnalysisError['kind']`.
 */
const ANALYSIS_ERROR_KINDS = [
	'image_load_failed',
	'canvas_unavailable',
	'mouth_crop_failed',
	'face_detection_error',
	'poor_lighting',
	'tongue_segmentation_error',
	'color_correction_error',
	'inconclusive_color',
] as const satisfies readonly AnalysisError['kind'][];

/** O(1) lookup set derived from {@link ANALYSIS_ERROR_KINDS}. */
const ANALYSIS_ERROR_KIND_SET = new Set<string>(ANALYSIS_ERROR_KINDS);

/**
 * Whether the live analysis rAF loop is currently active.
 * - `'idle'` — loop stopped, no frames being processed.
 * - `'running'` — loop active, frames dispatched each animation frame.
 */
export type LiveMode = 'idle' | 'running';

/**
 * Configuration for {@link useLiveAnalysis}.
 */
interface UseLiveAnalysisOptions {
	/** Ref to the `<video>` element supplying camera frames. */
	readonly videoRef: RefObject<HTMLVideoElement | null>;
	/** Ref to a `<canvas>` layered over the video for debug drawing. */
	readonly overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
	/**
	 * Master enable flag. When flipped to `false`, the loop stops
	 * immediately and all state resets.
	 */
	readonly enabled: boolean;
}

/**
 * Return value of {@link useLiveAnalysis}.
 * Analysis-derived fields (`liveStep`, `liveError`, `liveDiagnosis`, `liveUpdatedAt`)
 * are throttled to {@link LIVE_UPDATED_AT_THROTTLE_MS}; control fields
 * (`liveMode`, `liveHasStarted`) update immediately.
 */
interface UseLiveAnalysisResult {
	/** Current loop state. @see {@link LiveMode} */
	readonly liveMode: LiveMode;
	/** Last pipeline step reported, or `null` when idle. */
	readonly liveStep: AnalysisStep | null;
	/** Dutch user-facing error from the most recent failed frame, or `null`. */
	readonly liveError: string | null;
	/** Most recent successful {@link Diagnosis}, or `null`. */
	readonly liveDiagnosis: Diagnosis | null;
	/** `Date.now()` timestamp of the last state update, for staleness checks. */
	readonly liveUpdatedAt: number | null;
	/** `true` once {@link UseLiveAnalysisResult.start} has been called at least once in this mount. */
	readonly liveHasStarted: boolean;
	/** Begin the rAF analysis loop. No-op if already running or `enabled` is `false`. */
	readonly start: () => void;
	/**
	 * Stop the loop, cancel pending rAF, clear overlay and analysis state.
	 * Preserves {@link UseLiveAnalysisResult.liveHasStarted} so the live
	 * diagnosis panel stays mounted across camera switches.
	 */
	readonly stop: () => void;
	/** Clear {@link UseLiveAnalysisResult.liveError} without stopping the loop. */
	readonly clearError: () => void;
	/**
	 * Full teardown: stops the loop and resets {@link UseLiveAnalysisResult.liveHasStarted},
	 * unmounting the live diagnosis panel. Use at end of session.
	 */
	readonly reset: () => void;
}

/**
 * Map an {@link AnalysisError} to a Dutch user-facing string.
 * Matches every top-level variant; nested sub-variants are exhaustively
 * matched for `face_detection_error`, `poor_lighting`, and
 * `tongue_segmentation_error`. The `color_correction_error` variant
 * uses a single catch-all message since both inner kinds indicate
 * transient frame issues in live mode.
 *
 * @param error - Typed pipeline error from {@link analyzeTongueVideoFrame}.
 * @returns Localised (Dutch) description suitable for display in the camera UI.
 */
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
				default: {
					const _exhaustive: never = error.error;
					return _exhaustive;
				}
			}
		case 'poor_lighting':
			switch (error.issue) {
				case 'too_dark':
					return 'Te donker voor betrouwbare live-analyse.';
				case 'too_bright':
					return 'Te fel belicht voor betrouwbare live-analyse.';
				case 'high_contrast':
					return 'Te veel lichtcontrast. Gebruik egaal frontaal licht.';
				default: {
					const _exhaustive: never = error.issue;
					return _exhaustive;
				}
			}
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
				default: {
					const _exhaustive: never = error.error;
					return _exhaustive;
				}
			}
		case 'color_correction_error':
			return 'Kleurcorrectie mislukte voor dit frame.';
		case 'inconclusive_color':
			return 'Frame is nog niet duidelijk genoeg. Houd je tong stil in egaal licht.';
		default: {
			const _exhaustive: never = error;
			return _exhaustive;
		}
	}
}

/**
 * Runtime type guard for {@link AnalysisError}.
 * Needed because `catch` blocks yield `unknown`. Validates only the
 * top-level `kind` discriminant via {@link ANALYSIS_ERROR_KIND_SET};
 * nested sub-variant structure is enforced by TypeScript in
 * {@link liveErrorMessage} via exhaustive switches.
 *
 * @param value - Caught exception of unknown shape.
 * @returns `true` when `value` has a recognised `AnalysisError` top-level `kind`.
 */
function isAnalysisError(value: unknown): value is AnalysisError {
	return (
		typeof value === 'object'
		&& value !== null
		&& 'kind' in value
		&& typeof value.kind === 'string'
		&& ANALYSIS_ERROR_KIND_SET.has(value.kind)
	);
}

/**
 * Drives continuous tongue analysis on a live camera feed.
 *
 * Runs a `requestAnimationFrame` loop that:
 * 1. Skips duplicate frames (same `video.currentTime`).
 * 2. Calls {@link analyzeTongueVideoFrame} for each new frame.
 * 3. Throttles React state updates to {@link LIVE_UPDATED_AT_THROTTLE_MS}.
 * 4. Optionally draws a debug overlay via {@link drawMouthRegionOverlay}.
 *
 * Session IDs prevent stale callbacks from updating state after a
 * stop/restart cycle.
 *
 * @param options - Video ref, overlay canvas ref, and enable flag.
 * @returns Live analysis state and imperative controls.
 *
 * @example
 * ```tsx
 * const live = useLiveAnalysis({
 * 	videoRef,
 * 	overlayCanvasRef,
 * 	enabled: cameraReady,
 * });
 * // start/stop via live.start() / live.stop()
 * // read live.liveDiagnosis for the latest result
 * ```
 */
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
		clearOverlayCanvas(overlayCanvasRef.current);
		setLiveMode('idle');
		setLiveStep(null);
		setLiveError(null);
		setLiveDiagnosis(null);
		setLiveUpdatedAt(null);
		// Intentionally does NOT reset liveHasStarted — preserves the live
		// diagnosis panel across camera switches. Use reset() for full teardown.
		// eslint-disable-next-line react-hooks/exhaustive-deps -- overlayCanvasRef is a useRef return (identity-stable)
	}, []);

	const clearError = useCallback(() => {
		setLiveError(null);
	}, []);

	const reset = useCallback(() => {
		stop();
		setLiveHasStarted(false);
	}, [stop]);

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
		const shouldUpdateState = Date.now() - lastUpdatedAtRef.current >= LIVE_UPDATED_AT_THROTTLE_MS;

		lastVideoTimeRef.current = video.currentTime;
		liveInFlightRef.current = true;

		try {
			const timestampMs = performance.now();
			const result = await analyzeTongueVideoFrame(video, timestampMs, {
				onStep: (step) => {
					if (!isCurrentSession()) return;
					if (shouldUpdateState) setLiveStep(step);
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

				if (shouldUpdateState) {
					const now = Date.now();
					setLiveError(liveErrorMessage(result.error));
					setLiveUpdatedAt(now);
					lastUpdatedAtRef.current = now;
				}
				if (DEBUG_OVERLAY_ENABLED) {
					clearOverlayCanvas(overlayCanvasRef.current);
				}
				return;
			}

			if (shouldUpdateState) {
				const now = Date.now();
				setLiveDiagnosis(result.value.diagnosis);
				setLiveError(null);
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

			if (shouldUpdateState) {
				const now = Date.now();
				if (isAnalysisError(caughtError)) {
					setLiveError(liveErrorMessage(caughtError));
				} else {
					setLiveError('Onbekende live-analysefout.');
				}
				setLiveUpdatedAt(now);
				lastUpdatedAtRef.current = now;
			}

			if (DEBUG_OVERLAY_ENABLED) {
				clearOverlayCanvas(overlayCanvasRef.current);
			}
		} finally {
			if (sessionId === liveSessionIdRef.current && isLiveActive()) {
				liveInFlightRef.current = false;
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- overlayCanvasRef, videoRef are useRef returns (identity-stable)
	}, [isLiveActive]);

	const start = useCallback(() => {
		if (!enabled || liveRunningRef.current) return;

		liveSessionIdRef.current += 1;
		liveRunningRef.current = true;
		setLiveHasStarted(true);
		setLiveMode('running');
		setLiveStep('loading_model');
		setLiveError(null);
		lastVideoTimeRef.current = -1;
		lastUpdatedAtRef.current = 0;

		const tick = (): void => {
			if (!liveRunningRef.current) return;
			void runLiveAnalysis()
				.catch((error: unknown) => {
					// runLiveAnalysis handles all expected errors internally.
					// This catch prevents silent swallowing if catch/finally
					// blocks themselves throw (e.g. setState after unmount).
					console.error('Unhandled live-analysis rejection:', error);
				})
				.finally(() => {
					if (liveRunningRef.current) {
						liveRafRef.current = window.requestAnimationFrame(tick);
					}
				});
		};

		liveRafRef.current = window.requestAnimationFrame(tick);
	}, [enabled, runLiveAnalysis]);

	useEffect(() => {
		if (!enabled) stop();
	}, [enabled, stop]);

	useEffect(() => {
		return () => {
			reset();
		};
	}, [reset]);

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
