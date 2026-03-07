/**
 * @module Live camera capture and real-time tongue analysis UI.
 * Opens a modal dialog with camera preview, photo capture, device switching,
 * and optional continuous live analysis via {@link useLiveAnalysis}.
 */

import type { MouseEvent, RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDeferredCameraRelease } from '../hooks/use-deferred-camera-release.ts';
import type { LiveMode } from '../hooks/use-live-analysis.ts';
import { useLiveAnalysis } from '../hooks/use-live-analysis.ts';
import { useLiveAnnouncements } from '../hooks/use-live-announcements.ts';
import { useMediaStream } from '../hooks/use-media-stream.ts';
import { captureErrorMessage, captureVideoFrame } from '../lib/capture-video-frame.ts';
import type { Diagnosis } from '../lib/diagnosis.ts';
import { ANALYSIS_STEP_LABELS } from '../lib/pipeline.ts';
import type { AnalysisStep } from '../lib/pipeline.ts';

/**
 * Delay (ms) before the camera stream is automatically released after a tab switch.
 * Gives users time to return before requiring a manual restart.
 */
const CAMERA_RELEASE_DELAY_MS = 20_000;

/**
 * Format a timestamp as a Dutch locale time string (HH:MM:SS).
 *
 * @param timestampMs - Unix timestamp in milliseconds.
 * @returns Formatted time string, e.g. "14:32:07".
 */
function formatUpdateTime(timestampMs: number): string {
	return new Date(timestampMs).toLocaleTimeString('nl-NL', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
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
	/** Ref to the debug overlay canvas (only rendered when `VITE_DEBUG_OVERLAY` is enabled). */
	readonly overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
	/** Whether the preview should be horizontally mirrored (true for user-facing cameras). */
	readonly mirrorPreview: boolean;
	/** Whether live analysis has been started at least once in this session. */
	readonly liveHasStarted: boolean;
	/** Derived status string for the live indicator dot: `'active'`, `'error'`, or `'idle'`. */
	readonly liveStatus: string;
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
	overlayCanvasRef,
	mirrorPreview,
	liveHasStarted,
	liveStatus,
	activeError,
}: CameraStageProps) {
	const mirrorValue = mirrorPreview ? 'true' : 'false';

	return (
		<div className='camera-stage'>
			<video
				ref={videoRef}
				className='camera-video'
				data-mirror={mirrorValue}
				autoPlay
				muted
				playsInline
			/>
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
				<div className='camera-live-diagnosis' data-stale={liveError !== null}>
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
	const [cameraAutoPaused, setCameraAutoPaused] = useState(false);

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
	const isLiveRunning = liveMode === 'running';
	const cameraActive = !isIdle || isLiveRunning;
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

	const handleCloseModal = useCallback(() => {
		dialogRef.current?.close();
	}, []);

	const handleDialogClose = useCallback(() => {
		clearReleaseTimer();
		setCameraAutoPaused(false);
		endSession();
	}, [clearReleaseTimer, endSession]);

	const handleStartCamera = useCallback(() => {
		clearReleaseTimer();
		setCameraAutoPaused(false);
		stopLiveAnalysis();
		clearLiveError();
		void startCamera();
	}, [clearLiveError, clearReleaseTimer, startCamera, stopLiveAnalysis]);

	const handleOpenModal = useCallback(() => {
		clearReleaseTimer();
		const dialog = dialogRef.current;
		if (dialog !== null && !dialog.open) {
			dialog.showModal();
		}
		setCameraAutoPaused(false);
		clearAllErrors();
		if (isIdle) {
			handleStartCamera();
		}
	}, [clearAllErrors, clearReleaseTimer, handleStartCamera, isIdle]);

	const handlePageHidden = useCallback(() => {
		if (!cameraActive) return;
		stopLiveAnalysis();
		scheduleCameraRelease();
	}, [cameraActive, scheduleCameraRelease, stopLiveAnalysis]);

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

		void captureVideoFrame(video).then((result) => {
			if (!result.ok) {
				setCameraError(captureErrorMessage(result.error));
				return;
			}

			const objectUrl = URL.createObjectURL(result.value);
			dialogRef.current?.close();
			onCapture(result.value, objectUrl);
		});
	}, [onCapture, setCameraError, videoRef]);

	const handleLiveToggle = useCallback(() => {
		if (isLiveRunning) {
			stopLiveAnalysis();
			return;
		}

		startLiveAnalysis();
	}, [isLiveRunning, startLiveAnalysis, stopLiveAnalysis]);

	const handleSwitchCamera = useCallback(() => {
		stopLiveAnalysis();
		clearLiveError();
		void switchToNextCamera();
	}, [clearLiveError, stopLiveAnalysis, switchToNextCamera]);

	const handleUseLiveDiagnosis = useCallback(() => {
		if (liveDiagnosis === null || onLiveDiagnosis === undefined) return;
		clearReleaseTimer();
		announceLiveStatus(`Live-resultaat geselecteerd: ${liveDiagnosis.type.name}.`);
		dialogRef.current?.close();
		onLiveDiagnosis(liveDiagnosis);
	}, [announceLiveStatus, clearReleaseTimer, liveDiagnosis, onLiveDiagnosis]);

	const handleDialogMouseDown = useCallback((event: MouseEvent<HTMLDialogElement>) => {
		if (event.target === event.currentTarget) {
			handleCloseModal();
		}
	}, [handleCloseModal]);

	// ── Render ─────────────────────────────────

	return (
		<>
			<div className='camera-capture'>
				<button type='button' className='camera-btn camera-btn--primary' onClick={handleOpenModal}>
					Gebruik live camera
				</button>
			</div>

			<dialog
				ref={dialogRef}
				className='camera-modal'
				aria-label='Live camera analyse'
				aria-describedby='camera-modal-desc'
				onMouseDown={handleDialogMouseDown}
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

				<div className='camera-preview' data-visible={isReady || isRequesting}>
					<CameraStage
						videoRef={videoRef}
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
