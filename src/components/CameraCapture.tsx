/**
 * @module Live camera capture and real-time tongue analysis UI.
 * Opens a modal dialog with camera preview, photo capture, device switching,
 * and optional continuous live analysis via {@link useLiveAnalysis}.
 */

import type { MouseEvent, RefObject, SyntheticEvent } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useDeferredCameraRelease } from '../hooks/use-deferred-camera-release.ts';
import type { LiveMode } from '../hooks/use-live-analysis.ts';
import { useLiveAnalysis } from '../hooks/use-live-analysis.ts';
import { useLiveAnnouncements } from '../hooks/use-live-announcements.ts';
import { useMediaStream } from '../hooks/use-media-stream.ts';
import { captureErrorMessage, captureVideoFrame } from '../lib/capture-video-frame.ts';
import type { Diagnosis } from '../lib/diagnosis.ts';
import { formatUpdateTime } from '../lib/format-time.ts';
import type { AnalysisStep } from '../lib/pipeline.ts';
import { ANALYSIS_STEP_LABELS } from '../lib/pipeline.ts';
import { skipActiveViewTransition, withViewTransitionAndWait } from '../lib/view-transition.ts';

/**
 * Delay (ms) before the camera stream is automatically released after a tab switch.
 * Gives users time to return before requiring a manual restart.
 */
const CAMERA_RELEASE_DELAY_MS = 20_000;
const LIVE_PANEL_CLOSE_COLLAPSE_FALLBACK_MS = 180;
const MODAL_CLOSE_FALLBACK_MS = 240;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const DESKTOP_PREVIEW_ASPECT_RATIO = 16 / 9;
const MOBILE_PREVIEW_ASPECT_RATIO = 3 / 4;
const MOBILE_PREVIEW_MEDIA_QUERY = '(max-width: 700px) and (orientation: portrait)';

function getFallbackPreviewAspectRatio(): number {
	if (typeof window === 'undefined') {
		return DESKTOP_PREVIEW_ASPECT_RATIO;
	}

	return window.matchMedia(MOBILE_PREVIEW_MEDIA_QUERY).matches
		? MOBILE_PREVIEW_ASPECT_RATIO
		: DESKTOP_PREVIEW_ASPECT_RATIO;
}

function parseDurationMs(duration: string): number | null {
	if (duration.endsWith('ms')) {
		const value = Number.parseFloat(duration.slice(0, -2));
		return Number.isFinite(value) && value >= 0 ? value : null;
	}

	if (duration.endsWith('s')) {
		const value = Number.parseFloat(duration.slice(0, -1));
		return Number.isFinite(value) && value >= 0 ? value * 1000 : null;
	}

	return null;
}

function getLivePanelCloseCollapseMs(dialog: HTMLDialogElement | null): number {
	if (typeof window === 'undefined') {
		return LIVE_PANEL_CLOSE_COLLAPSE_FALLBACK_MS;
	}

	if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
		return 0;
	}

	const host = dialog ?? document.documentElement;
	const rawDuration = window
		.getComputedStyle(host)
		.getPropertyValue('--camera-live-collapse-ms')
		.trim();
	const parsedDuration = parseDurationMs(rawDuration);

	return parsedDuration ?? LIVE_PANEL_CLOSE_COLLAPSE_FALLBACK_MS;
}

function getModalCloseMs(dialog: HTMLDialogElement | null): number {
	if (typeof window === 'undefined') {
		return MODAL_CLOSE_FALLBACK_MS;
	}

	if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
		return 0;
	}

	const host = dialog ?? document.documentElement;
	const rawDuration = window
		.getComputedStyle(host)
		.getPropertyValue('--camera-modal-close-ms')
		.trim();
	const parsedDuration = parseDurationMs(rawDuration);

	return parsedDuration ?? MODAL_CLOSE_FALLBACK_MS;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

type HeroOwner = 'button' | 'dialog';

interface CloseRequestHandle {
	readonly promise: Promise<void>;
	readonly sequence: number;
	readonly isNew: boolean;
}

// ── Presentational Components ──────────────────

/**
 * Props for {@link CameraIdleActions}.
 */
interface CameraIdleActionsProps {
	/** Whether the camera was automatically paused due to a tab switch. */
	readonly cameraAutoPaused: boolean;
	/** Current camera error message, if any. */
	readonly error: string | null;
	/** Callback to start (or resume) the camera stream. */
	readonly onStart: () => void;
}

/**
 * Idle-state actions: a start/resume button and optional error/pause status messages.
 *
 * @param props - {@link CameraIdleActionsProps}
 */
function CameraIdleActions({ cameraAutoPaused, error, onStart }: CameraIdleActionsProps) {
	return (
		<div className='camera-idle-actions'>
			{cameraAutoPaused && (
				<div className='camera-status' aria-live='polite'>
					Camera gepauzeerd na tabwissel. Hervat wanneer je klaar bent.
				</div>
			)}
			<button type='button' className='camera-btn' onClick={onStart}>
				{cameraAutoPaused ? 'Hervat camera' : 'Start camera'}
			</button>
			{error !== null && (
				<div className='camera-status camera-error' role='alert'>
					{error}
				</div>
			)}
		</div>
	);
}

/**
 * Props for {@link CameraReadyControls}.
 */
interface CameraReadyControlsProps {
	/** Whether the device has more than one camera available. */
	readonly canSwitchCamera: boolean;
	/** Human-readable label of the active camera device. */
	readonly activeCameraLabel: string | undefined;
	/** Whether live analysis is currently running. */
	readonly isLiveRunning: boolean;
	/** Callback to capture a still frame from the video feed. */
	readonly onCapture: () => void;
	/** Callback to cycle to the next available camera. */
	readonly onSwitchCamera: () => void;
	/** Callback to toggle live analysis on/off. */
	readonly onLiveToggle: () => void;
}

/**
 * Action buttons shown when the camera stream is active: capture, switch camera, toggle live analysis.
 *
 * @param props - {@link CameraReadyControlsProps}
 */
function CameraReadyControls({
	canSwitchCamera,
	activeCameraLabel,
	isLiveRunning,
	onCapture,
	onSwitchCamera,
	onLiveToggle,
}: CameraReadyControlsProps) {
	return (
		<div className='camera-controls'>
			<button type='button' className='camera-btn camera-btn--primary' onClick={onCapture}>
				Foto maken
			</button>
			{canSwitchCamera && (
				<button
					type='button'
					className='camera-btn camera-btn--switch'
					onClick={onSwitchCamera}
					aria-label={activeCameraLabel !== undefined && activeCameraLabel !== ''
						? `Wissel camera. Huidig: ${activeCameraLabel}`
						: 'Wissel camera'}
				>
					Wissel camera
				</button>
			)}
			<button
				type='button'
				className='camera-btn camera-btn--live'
				data-running={isLiveRunning}
				onClick={onLiveToggle}
			>
				{isLiveRunning ? 'Stop live-analyse' : 'Start live-analyse'}
			</button>
		</div>
	);
}

/**
 * Props for {@link CameraStage}.
 */
interface CameraStageProps {
	/** Ref to the `<video>` element receiving the camera stream. */
	readonly videoRef: RefObject<HTMLVideoElement | null>;
	/** Aspect ratio used to reserve preview layout before stream metadata is available. */
	readonly previewAspectRatio: number;
	/** Whether a loading skeleton should overlay the preview area. */
	readonly showSkeleton: boolean;
	/** Whether the video has enough metadata to render at its final dimensions. */
	readonly videoReady: boolean;
	/** Ref to the debug overlay canvas (only rendered when `VITE_DEBUG_OVERLAY` is enabled). */
	readonly overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
	/** Whether the preview should be horizontally mirrored (true for user-facing cameras). */
	readonly mirrorPreview: boolean;
	/** Whether live analysis has been started at least once in this session. */
	readonly liveHasStarted: boolean;
	/** Derived status string for the live indicator dot: `'active'`, `'error'`, or `'idle'`. */
	readonly liveStatus: 'active' | 'error' | 'idle';
	/** Combined error from camera or live analysis, if any. */
	readonly activeError: string | null;
}

/**
 * Camera preview stage: video element, optional debug overlay canvas, live status dot, and error display.
 *
 * @param props - {@link CameraStageProps}
 */
function CameraStage({
	videoRef,
	previewAspectRatio,
	showSkeleton,
	videoReady,
	overlayCanvasRef,
	mirrorPreview,
	liveHasStarted,
	liveStatus,
	activeError,
}: CameraStageProps) {
	const mirrorValue = mirrorPreview ? 'true' : 'false';
	const skeletonVisible = showSkeleton ? 'true' : 'false';
	const videoReadyValue = videoReady ? 'true' : 'false';

	return (
		<div
			className='camera-stage'
			data-skeleton-visible={skeletonVisible}
			style={{ aspectRatio: String(previewAspectRatio) }}
		>
			<video
				ref={videoRef}
				className='camera-video'
				data-mirror={mirrorValue}
				data-ready={videoReadyValue}
				autoPlay
				muted
				playsInline
			/>
			{showSkeleton && (
				<div className='camera-skeleton' aria-hidden='true'>
					<span className='camera-skeleton-label'>Camera wordt voorbereid...</span>
				</div>
			)}
			{import.meta.env.VITE_DEBUG_OVERLAY === 'true' && (
				<canvas ref={overlayCanvasRef} className='camera-overlay' data-mirror={mirrorValue} />
			)}
			{liveHasStarted && <span className='camera-live-dot' data-status={liveStatus} aria-hidden='true' />}
			{activeError !== null && (
				<div className='camera-video-error' role='alert'>
					{activeError}
				</div>
			)}
		</div>
	);
}

/**
 * Props for {@link LiveDiagnosisPanel}.
 */
interface LiveDiagnosisPanelProps {
	/** Current live analysis mode from {@link useLiveAnalysis}. */
	readonly liveMode: LiveMode;
	/** Pipeline step currently executing in the live loop, or `null` if idle. */
	readonly liveStep: AnalysisStep | null;
	/** Error message from the most recent live analysis frame, if any. */
	readonly liveError: string | null;
	/** Most recent successful live diagnosis, or `null` if none yet. */
	readonly liveDiagnosis: Diagnosis | null;
	/** Timestamp (ms) of the last successful live diagnosis update. */
	readonly liveUpdatedAt: number | null;
	/** Whether the parent supports accepting a live diagnosis (i.e. `onLiveDiagnosis` prop was provided). */
	readonly canUseLiveDiagnosis: boolean;
	/** Callback to promote the current live diagnosis to a full result. */
	readonly onUseLiveDiagnosis: () => void;
	/** `true` while modal-close pre-collapse animation is running. */
	readonly closingForModalClose: boolean;
}

/**
 * Live analysis results panel: shows current step, most recent diagnosis summary,
 * last-updated timestamp, and a button to accept the live result.
 *
 * @param props - {@link LiveDiagnosisPanelProps}
 */
function LiveDiagnosisPanel({
	liveMode,
	liveStep,
	liveError,
	liveDiagnosis,
	liveUpdatedAt,
	canUseLiveDiagnosis,
	onUseLiveDiagnosis,
	closingForModalClose,
}: LiveDiagnosisPanelProps) {
	const isLiveRunning = liveMode === 'running';

	return (
		<div
			className='camera-live'
			data-closing={closingForModalClose}
			aria-hidden={closingForModalClose}
		>
			<div className='camera-live-header'>
				<span>Live</span>
				{isLiveRunning && liveStep !== null && (
					<span className='camera-live-step'>{ANALYSIS_STEP_LABELS[liveStep]}</span>
				)}
			</div>

			{isLiveRunning && liveDiagnosis === null && liveError === null && (
				<div className='camera-live-loading'>Analyse wordt gestart...</div>
			)}

			{liveDiagnosis !== null && (
				<div
					key={liveUpdatedAt}
					className='camera-live-diagnosis'
					data-stale={liveError !== null}
				>
					<div className='camera-live-type'>
						<span lang='zh'>{liveDiagnosis.type.nameZh}</span> - {liveDiagnosis.type.name}
					</div>
					<p>{liveDiagnosis.type.summary}</p>
					{liveUpdatedAt !== null && (
						<div className='camera-live-updated'>
							Laatst bijgewerkt: {formatUpdateTime(liveUpdatedAt)}
						</div>
					)}
					{canUseLiveDiagnosis && (
						<button
							type='button'
							className='camera-btn camera-btn--primary'
							onClick={onUseLiveDiagnosis}
							disabled={closingForModalClose}
							tabIndex={closingForModalClose ? -1 : undefined}
						>
							Toon dit live-resultaat
						</button>
					)}
				</div>
			)}
		</div>
	);
}

// ── Main Component ─────────────────────────────

/**
 * Props for {@link CameraCapture}.
 */
interface CameraCaptureProps {
	/** Callback when the user captures a still frame. Receives the blob as a `File` and its object URL. */
	readonly onCapture: (file: File, objectUrl: string) => void;
	/** Optional callback to bypass the upload flow and jump straight to results with a live diagnosis. */
	readonly onLiveDiagnosis?: (diagnosis: Diagnosis) => void;
}

/**
 * Full-featured camera modal with live preview, still capture, device switching,
 * and optional real-time tongue analysis.
 *
 * Opens as a `<dialog>` modal. Manages camera stream lifecycle via {@link useMediaStream},
 * real-time analysis via {@link useLiveAnalysis}, and auto-release on tab switch via
 * {@link useDeferredCameraRelease}.
 *
 * @param props - {@link CameraCaptureProps}
 * @returns A trigger button + modal dialog.
 *
 * @example
 * ```tsx
 * <CameraCapture
 *   onCapture={(file, url) => handleImage(file, url)}
 *   onLiveDiagnosis={(d) => showResults(d)}
 * />
 * ```
 */
export default function CameraCapture({ onCapture, onLiveDiagnosis }: CameraCaptureProps) {
	const modalDescId = useId();
	const dialogRef = useRef<HTMLDialogElement>(null);
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
	const modalTransitioningRef = useRef(false);
	const transitionClosingRef = useRef(false);
	const pendingCloseRef = useRef(false);
	const closeRequestSequenceRef = useRef(0);
	const activeCloseRequestSequenceRef = useRef<number | null>(null);
	const closeRequestPromiseRef = useRef<Promise<void> | null>(null);
	const closeRequestResolveRef = useRef<(() => void) | null>(null);
	const [cameraAutoPaused, setCameraAutoPaused] = useState(false);
	const [heroOwner, setHeroOwner] = useState<HeroOwner>('button');
	const [previewPrimed, setPreviewPrimed] = useState(false);
	const [previewAspectRatio, setPreviewAspectRatio] = useState(getFallbackPreviewAspectRatio);
	const [videoReady, setVideoReady] = useState(false);
	const [livePanelClosing, setLivePanelClosing] = useState(false);
	const [modalClosing, setModalClosing] = useState(false);
	/** Set to `true` when camera switch interrupted live analysis, so it auto-restarts. */
	const restartLiveAfterSwitchRef = useRef(false);

	const {
		mode,
		error,
		mirrorPreview,
		availableCameras,
		activeCameraId,
		canSwitchCamera,
		videoRef,
		start: startCamera,
		switchToNextCamera,
		reset: resetCamera,
		clearError: clearCameraError,
		setError: setCameraError,
	} = useMediaStream();

	const {
		liveMode,
		liveStep,
		liveError,
		liveDiagnosis,
		liveUpdatedAt,
		liveHasStarted,
		start: startLiveAnalysis,
		stop: stopLiveAnalysis,
		clearError: clearLiveError,
		reset: resetLiveAnalysis,
	} = useLiveAnalysis({
		videoRef,
		overlayCanvasRef,
		enabled: mode === 'ready',
	});

	const {
		outputRef: liveAnnouncementRef,
		announce: announceLiveStatus,
		reset: resetLiveAnnouncement,
	} = useLiveAnnouncements({
		liveHasStarted,
		liveMode,
		liveStep,
		liveDiagnosis,
		liveUpdatedAt,
		stepLabels: ANALYSIS_STEP_LABELS,
	});

	// ── Derived state ──────────────────────────

	const isIdle = mode === 'idle';
	const isReady = mode === 'ready';
	const isRequesting = mode === 'requesting';
	const showPreviewSkeleton = previewPrimed || isRequesting || (isReady && !videoReady);
	const isPreviewVisible = previewPrimed || isReady || isRequesting;
	const isCameraStarting = previewPrimed && isIdle;
	const isLiveRunning = liveMode === 'running';
	const cameraActive = !isIdle;
	const activeError = liveError ?? error;
	const liveStatus = liveError !== null ? 'error' : isLiveRunning ? 'active' : 'idle';
	const activeCameraLabel = availableCameras.find(
		(device) => device.deviceId === activeCameraId,
	)?.label;

	// ── Domain-level helpers ───────────────────

	const clearAllErrors = useCallback(() => {
		clearCameraError();
		clearLiveError();
	}, [clearCameraError, clearLiveError]);

	const endSession = useCallback(() => {
		restartLiveAfterSwitchRef.current = false;
		resetLiveAnnouncement();
		resetLiveAnalysis();
		resetCamera();
	}, [resetCamera, resetLiveAnalysis, resetLiveAnnouncement]);

	// ── Camera release ─────────────────────────

	const handleRelease = useCallback(() => {
		restartLiveAfterSwitchRef.current = false;
		stopLiveAnalysis();
		resetCamera();
		setCameraAutoPaused(true);
	}, [resetCamera, stopLiveAnalysis]);

	const { clear: clearReleaseTimer, schedule: scheduleCameraRelease } = useDeferredCameraRelease({
		active: cameraActive,
		onRelease: handleRelease,
		delayMs: CAMERA_RELEASE_DELAY_MS,
	});

	const beginCloseRequest = useCallback((): CloseRequestHandle => {
		const activeSequence = activeCloseRequestSequenceRef.current;
		const activePromise = closeRequestPromiseRef.current;

		if (activeSequence !== null && activePromise !== null) {
			return {
				promise: activePromise,
				sequence: activeSequence,
				isNew: false,
			};
		}

		const sequence = closeRequestSequenceRef.current + 1;
		closeRequestSequenceRef.current = sequence;
		activeCloseRequestSequenceRef.current = sequence;

		const promise = new Promise<void>((resolve) => {
			closeRequestResolveRef.current = resolve;
		});
		closeRequestPromiseRef.current = promise;

		return {
			promise,
			sequence,
			isNew: true,
		};
	}, []);

	const settleCloseRequest = useCallback((sequence: number): void => {
		if (activeCloseRequestSequenceRef.current !== sequence) {
			return;
		}

		closeRequestResolveRef.current?.();
		closeRequestResolveRef.current = null;
		closeRequestPromiseRef.current = null;
		activeCloseRequestSequenceRef.current = null;
	}, []);

	const finalizeModalClose = useCallback(
		(sequence: number | null) => {
			clearReleaseTimer();
			pendingCloseRef.current = false;
			setModalClosing(false);
			setLivePanelClosing(false);
			setPreviewPrimed(false);
			setHeroOwner('button');
			setCameraAutoPaused(false);
			endSession();

			if (sequence !== null) {
				settleCloseRequest(sequence);
			}
		},
		[clearReleaseTimer, endSession, settleCloseRequest],
	);

	// ── Handlers ───────────────────────────────

	const closeModalWithTransition = useCallback((): Promise<void> => {
		const closeRequest = beginCloseRequest();
		const { promise, sequence } = closeRequest;
		const dialog = dialogRef.current;

		// Dialog not yet open (early opening phase before showModal).
		if (dialog?.open !== true) {
			if (modalTransitioningRef.current && !transitionClosingRef.current) {
				pendingCloseRef.current = true;
				skipActiveViewTransition();
				return promise;
			}

			pendingCloseRef.current = false;
			if (!modalTransitioningRef.current || transitionClosingRef.current) {
				finalizeModalClose(sequence);
			}
			return promise;
		}

		// Already closing — attach to the in-flight close operation.
		if (transitionClosingRef.current) {
			return promise;
		}

		// Open transition still in flight — defer close but skip animation.
		if (modalTransitioningRef.current) {
			pendingCloseRef.current = true;
			skipActiveViewTransition();
			return promise;
		}

		// Freeze interaction immediately: transitionClosingRef gates all handlers.
		modalTransitioningRef.current = true;
		transitionClosingRef.current = true;
		pendingCloseRef.current = false;

		void (async () => {
			try {
				// Move focus out of controls that are about to collapse.
				closeButtonRef.current?.focus();

				// Start all close animations concurrently.
				setModalClosing(true);
				if (liveHasStarted) {
					setLivePanelClosing(true);
				}

				// Wait for the longest animation to finish.
				const collapseDelayMs = liveHasStarted ? getLivePanelCloseCollapseMs(dialog) : 0;
				const modalCloseDelayMs = getModalCloseMs(dialog);
				const longestDelay = Math.max(collapseDelayMs, modalCloseDelayMs);

				if (longestDelay > 0) {
					await delay(longestDelay);
				}

				const currentDialog = dialogRef.current;
				if (currentDialog?.open === true) {
					currentDialog.close();
				}
			} finally {
				transitionClosingRef.current = false;
				modalTransitioningRef.current = false;

				if (dialogRef.current?.open !== true) {
					finalizeModalClose(sequence);
				} else {
					setModalClosing(false);
					setLivePanelClosing(false);
					settleCloseRequest(sequence);
				}
			}
		})();

		return promise;
	}, [beginCloseRequest, finalizeModalClose, liveHasStarted, settleCloseRequest]);

	const handleCloseModal = useCallback(() => {
		void closeModalWithTransition();
	}, [closeModalWithTransition]);

	const closeModalImmediately = useCallback(() => {
		pendingCloseRef.current = false;
		modalTransitioningRef.current = false;
		transitionClosingRef.current = false;
		setModalClosing(false);
		setLivePanelClosing(false);

		const dialog = dialogRef.current;
		if (dialog?.open === true) {
			dialog.close();
			return;
		}

		finalizeModalClose(activeCloseRequestSequenceRef.current);
	}, [finalizeModalClose]);

	const handleDialogClose = useCallback(() => {
		if (transitionClosingRef.current) {
			return;
		}

		if (dialogRef.current?.open === true) {
			return;
		}

		modalTransitioningRef.current = false;
		finalizeModalClose(activeCloseRequestSequenceRef.current);
	}, [finalizeModalClose]);

	const handleStartCamera = useCallback(() => {
		clearReleaseTimer();
		restartLiveAfterSwitchRef.current = false;
		setPreviewPrimed(true);
		setVideoReady(false);
		setCameraAutoPaused(false);
		stopLiveAnalysis();
		void startCamera().finally(() => {
			setPreviewPrimed(false);
		});
	}, [clearReleaseTimer, startCamera, stopLiveAnalysis]);

	const handleOpenModal = useCallback(() => {
		clearReleaseTimer();
		const dialog = dialogRef.current;
		if (dialog === null || dialog.open || modalTransitioningRef.current) {
			return;
		}

		void (async () => {
			modalTransitioningRef.current = true;

			try {
				setCameraAutoPaused(false);
				clearAllErrors();
				setModalClosing(false);
				setLivePanelClosing(false);

				// Exclude header from this transition so the backdrop cross-fade darkens it.
				// Phase transitions keep app-header via the CSS custom property fallback.
				document.documentElement.style.setProperty('--header-vt-name', 'none');
				try {
					await withViewTransitionAndWait(() => {
						setHeroOwner('dialog');
						setPreviewPrimed(true);
						setVideoReady(false);
						dialog.showModal();
					});
				} catch {
					const currentDialog = dialogRef.current;
					if (currentDialog?.open !== true) {
						currentDialog?.showModal();
					}
					setPreviewPrimed(true);
					setVideoReady(false);
					setHeroOwner('dialog');
				} finally {
					document.documentElement.style.removeProperty('--header-vt-name');
				}
			} finally {
				modalTransitioningRef.current = false;
			}

			if (pendingCloseRef.current) {
				void closeModalWithTransition();
				return;
			}

			if (isIdle && dialogRef.current?.open === true) {
				handleStartCamera();
			}
		})();
	}, [clearAllErrors, clearReleaseTimer, closeModalWithTransition, handleStartCamera, isIdle]);

	const handlePageHidden = useCallback(() => {
		if (!cameraActive) return;
		stopLiveAnalysis();
		scheduleCameraRelease();
	}, [cameraActive, scheduleCameraRelease, stopLiveAnalysis]);

	// Restart live analysis after a camera switch completes.
	useEffect(() => {
		if (isReady && restartLiveAfterSwitchRef.current) {
			restartLiveAfterSwitchRef.current = false;
			startLiveAnalysis();
		}
	}, [isReady, startLiveAnalysis]);

	useEffect(() => {
		if (!cameraActive) {
			setPreviewAspectRatio(getFallbackPreviewAspectRatio());
			setVideoReady(false);
			return;
		}

		const video = videoRef.current;
		if (video === null) {
			setVideoReady(false);
			return;
		}

		const updateVideoGeometry = (): void => {
			if (video.videoWidth <= 0 || video.videoHeight <= 0) {
				return;
			}

			const detectedAspectRatio = video.videoWidth / video.videoHeight;
			setPreviewAspectRatio(detectedAspectRatio);
			setVideoReady(true);
		};

		updateVideoGeometry();
		video.addEventListener('loadedmetadata', updateVideoGeometry);
		video.addEventListener('resize', updateVideoGeometry);

		return () => {
			video.removeEventListener('loadedmetadata', updateVideoGeometry);
			video.removeEventListener('resize', updateVideoGeometry);
		};
	}, [cameraActive, videoRef]);

	useEffect(() => {
		if (cameraActive || videoReady) {
			return;
		}

		const mediaQuery = window.matchMedia(MOBILE_PREVIEW_MEDIA_QUERY);

		const syncFallbackAspectRatio = (): void => {
			setPreviewAspectRatio(
				mediaQuery.matches ? MOBILE_PREVIEW_ASPECT_RATIO : DESKTOP_PREVIEW_ASPECT_RATIO,
			);
		};

		syncFallbackAspectRatio();
		mediaQuery.addEventListener('change', syncFallbackAspectRatio);

		return () => {
			mediaQuery.removeEventListener('change', syncFallbackAspectRatio);
		};
	}, [cameraActive, videoReady]);

	useEffect(() => {
		const handleVisibilityChange = (): void => {
			if (document.visibilityState === 'visible') {
				clearReleaseTimer();
				return;
			}

			handlePageHidden();
		};

		document.addEventListener('visibilitychange', handleVisibilityChange);

		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			clearReleaseTimer();
		};
	}, [clearReleaseTimer, handlePageHidden]);

	const handleCapture = useCallback(() => {
		if (transitionClosingRef.current) return;

		const video = videoRef.current;
		if (video === null) {
			setCameraError('Geen camerabeeld beschikbaar om vast te leggen.');
			return;
		}

		void (async () => {
			const result = await captureVideoFrame(video);

			if (!result.ok) {
				setCameraError(captureErrorMessage(result.error));
				return;
			}

			// Ownership: caller (App.tsx) is responsible for revoking this URL via objectUrlRef
			const objectUrl = URL.createObjectURL(result.value);
			closeModalImmediately();
			onCapture(result.value, objectUrl);
		})();
	}, [closeModalImmediately, onCapture, setCameraError, videoRef]);

	const handleLiveToggle = useCallback(() => {
		if (transitionClosingRef.current) return;

		if (isLiveRunning) {
			resetLiveAnalysis();
			return;
		}

		startLiveAnalysis();
	}, [isLiveRunning, resetLiveAnalysis, startLiveAnalysis]);

	const handleSwitchCamera = useCallback(() => {
		if (transitionClosingRef.current) return;

		restartLiveAfterSwitchRef.current = isLiveRunning;
		stopLiveAnalysis();
		clearLiveError();
		void switchToNextCamera();
	}, [clearLiveError, isLiveRunning, stopLiveAnalysis, switchToNextCamera]);

	const handleUseLiveDiagnosis = useCallback(() => {
		if (liveDiagnosis === null || onLiveDiagnosis === undefined) return;
		clearReleaseTimer();
		announceLiveStatus(`Live-resultaat geselecteerd: ${liveDiagnosis.type.name}.`);
		closeModalImmediately();
		onLiveDiagnosis(liveDiagnosis);
	}, [
		announceLiveStatus,
		clearReleaseTimer,
		closeModalImmediately,
		liveDiagnosis,
		onLiveDiagnosis,
	]);

	const handleDialogMouseDown = useCallback(
		(event: MouseEvent<HTMLDialogElement>) => {
			const dialog = event.currentTarget;
			const rect = dialog.getBoundingClientRect();
			const clickedOutside = event.clientX < rect.left
				|| event.clientX > rect.right
				|| event.clientY < rect.top
				|| event.clientY > rect.bottom;
			if (clickedOutside) {
				void closeModalWithTransition();
			}
		},
		[closeModalWithTransition],
	);

	const handleDialogCancel = useCallback(
		(event: SyntheticEvent<HTMLDialogElement>) => {
			if (dialogRef.current?.open !== true) {
				return;
			}

			event.preventDefault();
			void closeModalWithTransition();
		},
		[closeModalWithTransition],
	);

	// ── Render ─────────────────────────────────

	return (
		<>
			<div className='camera-capture' data-hero-owner={heroOwner}>
				<button type='button' className='camera-btn camera-btn--primary' onClick={handleOpenModal}>
					Gebruik live camera
				</button>
			</div>

			<dialog
				ref={dialogRef}
				className='camera-modal'
				data-hero-owner={heroOwner}
				data-closing={modalClosing}
				aria-label='Live camera analyse'
				aria-describedby={modalDescId}
				onMouseDown={handleDialogMouseDown}
				onCancel={handleDialogCancel}
				onClose={handleDialogClose}
			>
				<p id={modalDescId} className='visually-hidden'>
					Maak een foto van je tong of gebruik live-analyse voor een tongdiagnose.
				</p>

				<div className='camera-modal-header'>
					<h3>Live camera</h3>
					<button
						ref={closeButtonRef}
						type='button'
						className='camera-btn camera-btn--ghost'
						onClick={handleCloseModal}
					>
						Sluiten
					</button>
				</div>

				<div className='camera-actions'>
					{isIdle && !isCameraStarting && (
						<CameraIdleActions
							cameraAutoPaused={cameraAutoPaused}
							error={error}
							onStart={handleStartCamera}
						/>
					)}

					{(isRequesting || isCameraStarting) && <div className='camera-status'>Camera wordt gestart...</div>}

					{isReady && (
						<CameraReadyControls
							canSwitchCamera={canSwitchCamera}
							activeCameraLabel={activeCameraLabel}
							isLiveRunning={isLiveRunning}
							onCapture={handleCapture}
							onSwitchCamera={handleSwitchCamera}
							onLiveToggle={handleLiveToggle}
						/>
					)}
				</div>

				<div className='camera-preview' data-visible={isPreviewVisible}>
					<CameraStage
						videoRef={videoRef}
						previewAspectRatio={previewAspectRatio}
						showSkeleton={showPreviewSkeleton}
						videoReady={videoReady}
						overlayCanvasRef={overlayCanvasRef}
						mirrorPreview={mirrorPreview}
						liveHasStarted={liveHasStarted}
						liveStatus={liveStatus}
						activeError={activeError}
					/>
				</div>

				<output
					ref={liveAnnouncementRef}
					className='visually-hidden'
					aria-live='polite'
					aria-atomic='true'
				/>

				{liveHasStarted && (
					<LiveDiagnosisPanel
						liveMode={liveMode}
						liveStep={liveStep}
						liveError={liveError}
						liveDiagnosis={liveDiagnosis}
						liveUpdatedAt={liveUpdatedAt}
						canUseLiveDiagnosis={onLiveDiagnosis !== undefined}
						onUseLiveDiagnosis={handleUseLiveDiagnosis}
						closingForModalClose={livePanelClosing}
					/>
				)}
			</dialog>
		</>
	);
}
