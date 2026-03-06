import { useCallback, useRef } from 'react';
import { useLiveAnalysis } from '../hooks/use-live-analysis.ts';
import { useMediaStream } from '../hooks/use-media-stream.ts';
import type { Diagnosis } from '../lib/diagnosis.ts';
import type { AnalysisStep } from '../lib/pipeline.ts';

interface CameraCaptureProps {
	readonly onCapture: (file: File, objectUrl: string) => void;
	readonly onLiveDiagnosis?: (diagnosis: Diagnosis) => void;
}

const LIVE_STEP_LABELS: Readonly<Record<AnalysisStep, string>> = {
	loading_image: 'Foto laden',
	loading_model: 'Model initialiseren',
	detecting_mouth: 'Mondregio detecteren',
	segmenting_tongue: 'Tong segmenteren',
	correcting_color: 'Kleur normaliseren',
	classifying_color: 'Tongkleur classificeren',
	building_diagnosis: 'Diagnose opstellen',
};

function formatUpdateTime(timestampMs: number): string {
	return new Date(timestampMs).toLocaleTimeString('nl-NL', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
}

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
	return new Promise((resolve) => {
		canvas.toBlob(
			(blob) => {
				resolve(blob);
			},
			'image/jpeg',
			0.92,
		);
	});
}

export default function CameraCapture({ onCapture, onLiveDiagnosis }: CameraCaptureProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

	const {
		mode,
		error,
		videoRef,
		start: startCamera,
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

	const handleCloseModal = useCallback(() => {
		dialogRef.current?.close();
	}, []);

	const handleDialogClose = useCallback(() => {
		resetLiveAnalysis();
		resetCamera();
	}, [resetCamera, resetLiveAnalysis]);

	const handleStartCamera = useCallback(async () => {
		stopLiveAnalysis();
		clearLiveError();
		await startCamera();
	}, [clearLiveError, startCamera, stopLiveAnalysis]);

	const handleOpenModal = useCallback(() => {
		dialogRef.current?.showModal();
		clearCameraError();
		clearLiveError();
		if (mode === 'idle') {
			void handleStartCamera();
		}
	}, [clearCameraError, clearLiveError, handleStartCamera, mode]);

	const handleCapture = useCallback(async () => {
		const video = videoRef.current;
		if (video === null || video.videoWidth === 0 || video.videoHeight === 0) {
			setCameraError('Geen camerabeeld beschikbaar om vast te leggen.');
			return;
		}

		const canvas = document.createElement('canvas');
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;

		const context = canvas.getContext('2d');
		if (context === null) {
			setCameraError('Kon cameraframe niet verwerken.');
			return;
		}

		context.drawImage(video, 0, 0, canvas.width, canvas.height);

		const blob = await canvasToJpegBlob(canvas);
		if (blob === null) {
			setCameraError('Kon foto niet opslaan. Probeer opnieuw.');
			return;
		}

		const capturedAt = Date.now();
		const file = new File([blob], `tong-camera-${String(capturedAt)}.jpg`, {
			type: 'image/jpeg',
			lastModified: capturedAt,
		});

		const objectUrl = URL.createObjectURL(file);
		dialogRef.current?.close();
		onCapture(file, objectUrl);
	}, [onCapture, setCameraError, videoRef]);

	const handleLiveToggle = useCallback(() => {
		if (liveMode === 'running') {
			stopLiveAnalysis();
			return;
		}

		startLiveAnalysis();
	}, [liveMode, startLiveAnalysis, stopLiveAnalysis]);

	const handleUseLiveDiagnosis = useCallback(() => {
		if (liveDiagnosis === null || onLiveDiagnosis === undefined) return;
		dialogRef.current?.close();
		onLiveDiagnosis(liveDiagnosis);
	}, [liveDiagnosis, onLiveDiagnosis]);

	const handleDialogMouseDown = useCallback((event: React.MouseEvent<HTMLDialogElement>) => {
		if (event.target === event.currentTarget) {
			handleCloseModal();
		}
	}, [handleCloseModal]);

	const activeError = liveError ?? error;

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
					{mode === 'idle' && (
						<>
							<button type='button' className='camera-btn' onClick={() => void handleStartCamera()}>
								Start camera
							</button>
							{error !== null && <div className='camera-status camera-error' role='alert'>{error}</div>}
						</>
					)}

					{mode === 'requesting' && <div className='camera-status'>Camera wordt gestart...</div>}

					{mode === 'ready' && (
						<div className='camera-controls'>
							<button type='button' className='camera-btn camera-btn--primary' onClick={() => void handleCapture()}>
								Foto maken
							</button>
							<button
								type='button'
								className='camera-btn camera-btn--live'
								data-running={liveMode === 'running'}
								onClick={handleLiveToggle}
							>
								{liveMode === 'running' ? 'Stop live-analyse' : 'Start live-analyse'}
							</button>
						</div>
					)}
				</div>

				<div className='camera-preview' data-visible={mode === 'ready' || mode === 'requesting'}>
					<div className='camera-stage'>
						<video
							ref={videoRef}
							className='camera-video'
							autoPlay
							muted
							playsInline
						/>
						{import.meta.env.VITE_DEBUG_OVERLAY === 'true' && (
							<canvas ref={overlayCanvasRef} className='camera-overlay' />
						)}
						{liveHasStarted && (
							<span
								className='camera-live-dot'
								data-status={liveError !== null ? 'error' : liveMode === 'running' ? 'active' : 'idle'}
								aria-hidden='true'
							/>
						)}
						{activeError !== null && <div className='camera-video-error' role='alert'>{activeError}</div>}
					</div>
				</div>

				{import.meta.env.VITE_DEBUG_OVERLAY === 'true' && mode === 'ready' && (
					<div className='camera-status'>DEBUG: mondregio-overlay actief</div>
				)}

				{liveHasStarted && (
					<div className='camera-live' aria-live='polite'>
						<div className='camera-live-header'>
							<span>Live</span>
							{liveMode === 'running' && liveStep !== null && (
								<span className='camera-live-step'>{LIVE_STEP_LABELS[liveStep]}</span>
							)}
						</div>

						{liveMode === 'running' && liveDiagnosis === null && liveError === null && (
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
								{onLiveDiagnosis !== undefined && (
									<button
										type='button'
										className='camera-btn camera-btn--primary'
										onClick={handleUseLiveDiagnosis}
									>
										Toon dit live-resultaat
									</button>
								)}
							</div>
						)}
					</div>
				)}
			</dialog>
		</>
	);
}
