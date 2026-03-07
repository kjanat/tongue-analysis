/**
 * @module Live camera capture and real-time tongue analysis UI.
 * Opens a modal dialog with camera preview, photo capture, device switching,
 * and optional continuous live analysis via {@link useLiveAnalysis}.
 */

import type { MouseEvent, RefObject, SyntheticEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDeferredCameraRelease } from '../hooks/use-deferred-camera-release.ts';
import type { LiveMode } from '../hooks/use-live-analysis.ts';
import { useLiveAnalysis } from '../hooks/use-live-analysis.ts';
import { useLiveAnnouncements } from '../hooks/use-live-announcements.ts';
import { useMediaStream } from '../hooks/use-media-stream.ts';
import { captureErrorMessage, captureVideoFrame } from '../lib/capture-video-frame.ts';
import type { Diagnosis } from '../lib/diagnosis.ts';
import { formatUpdateTime } from '../lib/format-time.ts';
import { ANALYSIS_STEP_LABELS } from '../lib/pipeline.ts';
import type { AnalysisStep } from '../lib/pipeline.ts';
import { withViewTransitionAndWait } from '../lib/view-transition.ts';

/**
 * Delay (ms) before the camera stream is automatically released after a tab switch.
 * Gives users time to return before requiring a manual restart.
 */
const CAMERA_RELEASE_DELAY_MS = 20_000;
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

type HeroOwner = 'button' | 'dialog';

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
		<>
			{cameraAutoPaused && (
				<div className='camera-status' aria-live='polite'>
					Camera gepauzeerd na tabwissel. Hervat wanneer je klaar bent.
				</div>
			)}
			<button type='button' className='camera-btn' onClick={onStart}>
				{cameraAutoPaused ? 'Hervat camera' : 'Start camera'}
			</button>
			{error !== null && <div className='camera-status camera-error' role='alert'>{error}</div>}
		</>
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
				<canvas
					ref={overlayCanvasRef}
					className='camera-overlay'
					data-mirror={mirrorValue}
				/>
			)}
			{liveHasStarted && (
				<span
					className='camera-live-dot'
					data-status={liveStatus}
					aria-hidden='true'
				/>
			)}
			{activeError !== null && <div className='camera-video-error' role='alert'>{activeError}</div>}
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
}: LiveDiagnosisPanelProps) {
	const isLiveRunning = liveMode === 'running';
	const revealPhase = liveUpdatedAt !== null && liveUpdatedAt % 2 === 0 ? 'a' : 'b';

	return (
		<div className='camera-live'>
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
					className='camera-live-diagnosis'
					data-stale={liveError !== null}
					data-reveal-phase={revealPhase}
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
	const dialogRef = useRef<HTMLDialogElement>(null);
	const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
	const modalTransitioningRef = useRef(false);
	const pendingCloseRef = useRef(false);
	const [cameraAutoPaused, setCameraAutoPaused] = useState(false);
	const [heroOwner, setHeroOwner] = useState<HeroOwner>('button');
	const [previewPrimed, setPreviewPrimed] = useState(false);
	const [previewAspectRatio, setPreviewAspectRatio] = useState(getFallbackPreviewAspectRatio);
	const [videoReady, setVideoReady] = useState(false);
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

	const { outputRef: liveAnnouncementRef, announce: announceLiveStatus, reset: resetLiveAnnouncement } =
		useLiveAnnouncements({
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
	const isLiveRunning = liveMode === 'running';
	const cameraActive = !isIdle;
	const activeError = liveError ?? error;
	const liveStatus = liveError !== null ? 'error' : isLiveRunning ? 'active' : 'idle';
	const activeCameraLabel = availableCameras.find((device) => device.deviceId === activeCameraId)?.label;

	// ── Domain-level helpers ───────────────────

	const clearAllErrors = useCallback(() => {
		clearCameraError();
		clearLiveError();
	}, [clearCameraError, clearLiveError]);

	const endSession = useCallback(() => {
		resetLiveAnnouncement();
		resetLiveAnalysis();
		resetCamera();
	}, [resetCamera, resetLiveAnalysis, resetLiveAnnouncement]);

	// ── Camera release ─────────────────────────

	const handleRelease = useCallback(() => {
		stopLiveAnalysis();
		resetCamera();
		setCameraAutoPaused(true);
	}, [resetCamera, stopLiveAnalysis]);

	const { clear: clearReleaseTimer, schedule: scheduleCameraRelease } = useDeferredCameraRelease({
		active: cameraActive,
		onRelease: handleRelease,
		delayMs: CAMERA_RELEASE_DELAY_MS,
	});

	// ── Handlers ───────────────────────────────

	const closeModalWithTransition = useCallback(async (): Promise<void> => {
		const dialog = dialogRef.current;
		if (dialog?.open !== true) {
			pendingCloseRef.current = false;
			return;
		}
		if (modalTransitioningRef.current) {
			pendingCloseRef.current = true;
			return;
		}

		modalTransitioningRef.current = true;
		pendingCloseRef.current = false;

		try {
			try {
				await withViewTransitionAndWait(() => {
					setHeroOwner('button');
					dialog.close();
				});
			} catch {
				setHeroOwner('button');
				const currentDialog = dialogRef.current;
				if (currentDialog?.open === true) {
					currentDialog.close();
				}
			}
		} finally {
			modalTransitioningRef.current = false;
		}
	}, []);

	const handleCloseModal = useCallback(() => {
		void closeModalWithTransition();
	}, [closeModalWithTransition]);

	const handleDialogClose = useCallback(() => {
		clearReleaseTimer();
		modalTransitioningRef.current = false;
		pendingCloseRef.current = false;
		setPreviewPrimed(false);
		setHeroOwner('button');
		setCameraAutoPaused(false);
		endSession();
	}, [clearReleaseTimer, endSession]);

	const handleStartCamera = useCallback(() => {
		clearReleaseTimer();
		setPreviewPrimed(true);
		setVideoReady(false);
		setCameraAutoPaused(false);
		stopLiveAnalysis();
		clearLiveError();
		void startCamera().finally(() => {
			setPreviewPrimed(false);
		});
	}, [clearLiveError, clearReleaseTimer, startCamera, stopLiveAnalysis]);

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

			if (!videoReady) {
				setPreviewAspectRatio(detectedAspectRatio);
				setVideoReady(true);
				return;
			}

			setPreviewAspectRatio(detectedAspectRatio);
		};

		updateVideoGeometry();
		video.addEventListener('loadedmetadata', updateVideoGeometry);
		video.addEventListener('resize', updateVideoGeometry);

		return () => {
			video.removeEventListener('loadedmetadata', updateVideoGeometry);
			video.removeEventListener('resize', updateVideoGeometry);
		};
	}, [cameraActive, videoReady, videoRef]);

	useEffect(() => {
		if (cameraActive || videoReady) {
			return;
		}

		const mediaQuery = window.matchMedia(MOBILE_PREVIEW_MEDIA_QUERY);

		const syncFallbackAspectRatio = (): void => {
			setPreviewAspectRatio(mediaQuery.matches ? MOBILE_PREVIEW_ASPECT_RATIO : DESKTOP_PREVIEW_ASPECT_RATIO);
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
			await closeModalWithTransition();
			onCapture(result.value, objectUrl);
		})();
	}, [closeModalWithTransition, onCapture, setCameraError, videoRef]);

	const handleLiveToggle = useCallback(() => {
		if (isLiveRunning) {
			resetLiveAnalysis();
			return;
		}

		startLiveAnalysis();
	}, [isLiveRunning, resetLiveAnalysis, startLiveAnalysis]);

	const handleSwitchCamera = useCallback(() => {
		restartLiveAfterSwitchRef.current = isLiveRunning;
		stopLiveAnalysis();
		clearLiveError();
		void switchToNextCamera();
	}, [clearLiveError, isLiveRunning, stopLiveAnalysis, switchToNextCamera]);

	const handleUseLiveDiagnosis = useCallback(() => {
		if (liveDiagnosis === null || onLiveDiagnosis === undefined) return;
		clearReleaseTimer();
		announceLiveStatus(`Live-resultaat geselecteerd: ${liveDiagnosis.type.name}.`);
		void (async () => {
			await closeModalWithTransition();
			onLiveDiagnosis(liveDiagnosis);
		})();
	}, [announceLiveStatus, clearReleaseTimer, closeModalWithTransition, liveDiagnosis, onLiveDiagnosis]);

	const handleDialogMouseDown = useCallback((event: MouseEvent<HTMLDialogElement>) => {
		const dialog = event.currentTarget;
		const rect = dialog.getBoundingClientRect();
		const clickedOutside = event.clientX < rect.left
			|| event.clientX > rect.right
			|| event.clientY < rect.top
			|| event.clientY > rect.bottom;
		if (clickedOutside) {
			void closeModalWithTransition();
		}
	}, [closeModalWithTransition]);

	const handleDialogCancel = useCallback((event: SyntheticEvent<HTMLDialogElement>) => {
		if (dialogRef.current?.open !== true) {
			return;
		}

		event.preventDefault();
		void closeModalWithTransition();
	}, [closeModalWithTransition]);

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
				aria-label='Live camera analyse'
				aria-describedby='camera-modal-desc'
				onMouseDown={handleDialogMouseDown}
				onCancel={handleDialogCancel}
				onClose={handleDialogClose}
			>
				<p id='camera-modal-desc' className='visually-hidden'>
					Maak een foto van je tong of gebruik live-analyse voor een tongdiagnose.
				</p>

				<div className='camera-modal-header'>
					<h3>Live camera</h3>
					<button
						type='button'
						className='camera-btn camera-btn--ghost'
						onClick={handleCloseModal}
					>
						Sluiten
					</button>
				</div>

				<div className='camera-actions'>
					{isIdle && (
						<CameraIdleActions
							cameraAutoPaused={cameraAutoPaused}
							error={error}
							onStart={handleStartCamera}
						/>
					)}

					{isRequesting && <div className='camera-status'>Camera wordt gestart...</div>}

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

				<output ref={liveAnnouncementRef} className='visually-hidden' aria-live='polite' aria-atomic='true' />

				{liveHasStarted && (
					<LiveDiagnosisPanel
						liveMode={liveMode}
						liveStep={liveStep}
						liveError={liveError}
						liveDiagnosis={liveDiagnosis}
						liveUpdatedAt={liveUpdatedAt}
						canUseLiveDiagnosis={onLiveDiagnosis !== undefined}
						onUseLiveDiagnosis={handleUseLiveDiagnosis}
					/>
				)}
			</dialog>
		</>
	);
}
