import type { MouseEvent, RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDeferredCameraRelease } from '../hooks/use-deferred-camera-release.ts';
import type { LiveMode } from '../hooks/use-live-analysis.ts';
import { useLiveAnalysis } from '../hooks/use-live-analysis.ts';
import { useLiveAnnouncements } from '../hooks/use-live-announcements.ts';
import { useMediaStream } from '../hooks/use-media-stream.ts';
import { captureErrorMessage, captureVideoFrame } from '../lib/capture-video-frame.ts';
import type { Diagnosis } from '../lib/diagnosis.ts';
import type { AnalysisStep } from '../lib/pipeline.ts';

// ── Constants ──────────────────────────────────

const LIVE_STEP_LABELS: Readonly<Record<AnalysisStep, string>> = {
	loading_image: 'Foto laden',
	loading_model: 'Model initialiseren',
	detecting_mouth: 'Mondregio detecteren',
	segmenting_tongue: 'Tong segmenteren',
	correcting_color: 'Kleur normaliseren',
	classifying_color: 'Tongkleur classificeren',
	building_diagnosis: 'Diagnose opstellen',
};

const CAMERA_RELEASE_DELAY_MS = 20_000;

function formatUpdateTime(timestampMs: number): string {
	return new Date(timestampMs).toLocaleTimeString('nl-NL', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
}

// ── Presentational Components ──────────────────

interface CameraIdleActionsProps {
	readonly cameraAutoPaused: boolean;
	readonly error: string | null;
	readonly onStart: () => void;
}

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

interface CameraReadyControlsProps {
	readonly canSwitchCamera: boolean;
	readonly activeCameraLabel: string | undefined;
	readonly isLiveRunning: boolean;
	readonly onCapture: () => void;
	readonly onSwitchCamera: () => void;
	readonly onLiveToggle: () => void;
}

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

interface CameraStageProps {
	readonly videoRef: RefObject<HTMLVideoElement | null>;
	readonly overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
	readonly mirrorPreview: boolean;
	readonly liveHasStarted: boolean;
	readonly liveStatus: string;
	readonly activeError: string | null;
}

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

interface LiveDiagnosisPanelProps {
	readonly liveMode: LiveMode;
	readonly liveStep: AnalysisStep | null;
	readonly liveError: string | null;
	readonly liveDiagnosis: Diagnosis | null;
	readonly liveUpdatedAt: number | null;
	readonly canUseLiveDiagnosis: boolean;
	readonly onUseLiveDiagnosis: () => void;
}

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
				{isLiveRunning && liveStep !== null && <span className='camera-live-step'>{LIVE_STEP_LABELS[liveStep]}</span>}
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

interface CameraCaptureProps {
	readonly onCapture: (file: File, objectUrl: string) => void;
	readonly onLiveDiagnosis?: (diagnosis: Diagnosis) => void;
}

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
			stepLabels: LIVE_STEP_LABELS,
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

	const handleStartCamera = useCallback(async () => {
		clearReleaseTimer();
		setCameraAutoPaused(false);
		stopLiveAnalysis();
		clearLiveError();
		await startCamera();
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
			void handleStartCamera();
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

	const handleCapture = useCallback(async () => {
		const video = videoRef.current;
		if (video === null) {
			setCameraError('Geen camerabeeld beschikbaar om vast te leggen.');
			return;
		}

		const result = await captureVideoFrame(video);
		if (!result.ok) {
			setCameraError(captureErrorMessage(result.error));
			return;
		}

		const objectUrl = URL.createObjectURL(result.value);
		dialogRef.current?.close();
		onCapture(result.value, objectUrl);
	}, [onCapture, setCameraError, videoRef]);

	const handleLiveToggle = useCallback(() => {
		if (isLiveRunning) {
			stopLiveAnalysis();
			return;
		}

		startLiveAnalysis();
	}, [isLiveRunning, startLiveAnalysis, stopLiveAnalysis]);

	const handleSwitchCamera = useCallback(async () => {
		stopLiveAnalysis();
		clearLiveError();
		await switchToNextCamera();
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
							onStart={() => void handleStartCamera()}
						/>
					)}

					{isRequesting && <div className='camera-status'>Camera wordt gestart...</div>}

					{isReady && (
						<CameraReadyControls
							canSwitchCamera={canSwitchCamera}
							activeCameraLabel={activeCameraLabel}
							isLiveRunning={isLiveRunning}
							onCapture={() => void handleCapture()}
							onSwitchCamera={() => void handleSwitchCamera()}
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
