import { useCallback, useEffect, useRef, useState } from 'react';
import type { Diagnosis } from '../lib/diagnosis.ts';
import type { MouthRegion, Point } from '../lib/face-detection.ts';
import { type AnalysisError, type AnalysisStep, analyzeTongueVideoFrame } from '../lib/pipeline.ts';

interface CameraCaptureProps {
	readonly onCapture: (file: File, objectUrl: string) => void;
	readonly onLiveDiagnosis?: (diagnosis: Diagnosis) => void;
}

type CameraMode = 'idle' | 'requesting' | 'ready';
type LiveMode = 'idle' | 'running';

const LIVE_STEP_LABELS: Readonly<Record<AnalysisStep, string>> = {
	loading_image: 'Foto laden',
	loading_model: 'Model initialiseren',
	detecting_mouth: 'Mondregio detecteren',
	segmenting_tongue: 'Tong segmenteren',
	correcting_color: 'Kleur normaliseren',
	classifying_color: 'Tongkleur classificeren',
	building_diagnosis: 'Diagnose opstellen',
};

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

function formatUpdateTime(timestampMs: number): string {
	return new Date(timestampMs).toLocaleTimeString('nl-NL', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
}

function isLiveRunning(liveRunningRef: Readonly<{ current: boolean }>): boolean {
	return liveRunningRef.current;
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

function stopStream(stream: MediaStream): void {
	for (const track of stream.getTracks()) {
		track.stop();
	}
}

function cameraErrorMessage(error: unknown): string {
	if (error instanceof DOMException) {
		switch (error.name) {
			case 'NotAllowedError':
				return 'Cameratoegang geweigerd. Geef toestemming en probeer opnieuw.';
			case 'NotFoundError':
				return 'Geen camera gevonden op dit apparaat.';
			case 'NotReadableError':
				return 'Camera is in gebruik door een andere app.';
			case 'OverconstrainedError':
				return 'Geen geschikte camera-instellingen beschikbaar.';
			case 'SecurityError':
				return 'Camera werkt alleen op een beveiligde verbinding (HTTPS).';
			default:
				return 'Kon camera niet starten. Probeer opnieuw.';
		}
	}

	return 'Kon camera niet starten. Probeer opnieuw.';
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
	const [mode, setMode] = useState<CameraMode>('idle');
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [liveMode, setLiveMode] = useState<LiveMode>('idle');
	const [liveStep, setLiveStep] = useState<AnalysisStep | null>(null);
	const [liveError, setLiveError] = useState<string | null>(null);
	const [liveDiagnosis, setLiveDiagnosis] = useState<Diagnosis | null>(null);
	const [liveUpdatedAt, setLiveUpdatedAt] = useState<number | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const videoRef = useRef<HTMLVideoElement>(null);
	const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
	const liveRunningRef = useRef(false);
	const liveRafRef = useRef<number | null>(null);
	const liveInFlightRef = useRef(false);
	const lastVideoTimeRef = useRef(-1);

	const stopLiveAnalysis = useCallback(() => {
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

	const stopCurrentStream = useCallback(() => {
		const stream = streamRef.current;
		if (stream !== null) {
			stopStream(stream);
			streamRef.current = null;
		}

		const video = videoRef.current;
		if (video !== null && video.srcObject !== null) {
			video.srcObject = null;
		}
	}, []);

	const handleCloseModal = useCallback(() => {
		stopLiveAnalysis();
		stopCurrentStream();
		clearOverlayCanvas(overlayCanvasRef.current);
		setMode('idle');
		setError(null);
		setLiveError(null);
		setLiveDiagnosis(null);
		setLiveUpdatedAt(null);
		setIsModalOpen(false);
	}, [stopCurrentStream, stopLiveAnalysis]);

	useEffect(() => {
		return () => {
			stopLiveAnalysis();
			stopCurrentStream();
		};
	}, [stopCurrentStream, stopLiveAnalysis]);

	useEffect(() => {
		if (!isModalOpen) return;

		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				handleCloseModal();
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [handleCloseModal, isModalOpen]);

	const runLiveAnalysis = useCallback(async () => {
		if (!isLiveRunning(liveRunningRef) || liveInFlightRef.current) return;

		const video = videoRef.current;
		if (video === null || video.videoWidth === 0 || video.videoHeight === 0) {
			setLiveError('Videobeeld nog niet klaar voor analyse.');
			if (import.meta.env.DEV) {
				clearOverlayCanvas(overlayCanvasRef.current);
			}
			return;
		}

		if (video.currentTime === lastVideoTimeRef.current) {
			return;
		}

		lastVideoTimeRef.current = video.currentTime;
		liveInFlightRef.current = true;

		const timestampMs = performance.now();
		const result = await analyzeTongueVideoFrame(video, timestampMs, {
			onStep: (step) => {
				if (!liveRunningRef.current) return;
				setLiveStep(step);
			},
		});

		if (!isLiveRunning(liveRunningRef)) {
			liveInFlightRef.current = false;
			return;
		}

		if (!result.ok) {
			if (
				import.meta.env.DEV
				&& result.error.kind === 'face_detection_error'
				&& result.error.error.kind === 'model_load_failed'
			) {
				console.error('Live face model load failed:', result.error.error.cause);
			}

			setLiveError(liveErrorMessage(result.error));
			if (import.meta.env.DEV) {
				clearOverlayCanvas(overlayCanvasRef.current);
			}
			liveInFlightRef.current = false;
			return;
		}

		setLiveDiagnosis(result.value.diagnosis);
		setLiveUpdatedAt(Date.now());
		setLiveError(null);

		if (import.meta.env.DEV) {
			const overlayCanvas = overlayCanvasRef.current;
			const mouthRegion = result.value.mouthRegion;
			if (overlayCanvas !== null && mouthRegion !== null) {
				drawMouthRegionOverlay(overlayCanvas, mouthRegion, video.videoWidth, video.videoHeight);
			} else {
				clearOverlayCanvas(overlayCanvas);
			}
		}

		liveInFlightRef.current = false;
	}, []);

	const startLiveAnalysis = useCallback(() => {
		if (mode !== 'ready' || liveRunningRef.current) return;

		liveRunningRef.current = true;
		setLiveMode('running');
		setLiveStep('loading_model');
		setLiveError(null);
		lastVideoTimeRef.current = -1;

		const tick = (): void => {
			if (!liveRunningRef.current) return;
			void runLiveAnalysis();
			liveRafRef.current = window.requestAnimationFrame(tick);
		};

		void runLiveAnalysis();
		liveRafRef.current = window.requestAnimationFrame(tick);
	}, [mode, runLiveAnalysis]);

	const handleStartCamera = useCallback(async () => {
		if (mode === 'requesting') return;

		stopLiveAnalysis();
		stopCurrentStream();
		setMode('requesting');
		setError(null);

		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: {
					facingMode: 'user',
				},
				audio: false,
			});

			streamRef.current = stream;

			const video = videoRef.current;
			if (video !== null) {
				video.srcObject = stream;
				await video.play().catch(() => undefined);
			}

			setMode('ready');
		} catch (cameraError) {
			setError(cameraErrorMessage(cameraError));
			setMode('idle');
		}
	}, [mode, stopCurrentStream, stopLiveAnalysis]);

	const handleOpenModal = useCallback(() => {
		setIsModalOpen(true);
		setError(null);
		setLiveError(null);
		if (mode === 'idle') {
			void handleStartCamera();
		}
	}, [handleStartCamera, mode]);

	const handleStopCamera = useCallback(() => {
		stopLiveAnalysis();
		stopCurrentStream();
		clearOverlayCanvas(overlayCanvasRef.current);
		setMode('idle');
	}, [stopCurrentStream, stopLiveAnalysis]);

	const handleCapture = useCallback(async () => {
		const video = videoRef.current;
		if (video === null || video.videoWidth === 0 || video.videoHeight === 0) {
			setError('Geen camerabeeld beschikbaar om vast te leggen.');
			return;
		}

		const canvas = document.createElement('canvas');
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;

		const context = canvas.getContext('2d');
		if (context === null) {
			setError('Kon cameraframe niet verwerken.');
			return;
		}

		context.drawImage(video, 0, 0, canvas.width, canvas.height);

		const blob = await canvasToJpegBlob(canvas);
		if (blob === null) {
			setError('Kon foto niet opslaan. Probeer opnieuw.');
			return;
		}

		const capturedAt = Date.now();
		const file = new File([blob], `tong-camera-${String(capturedAt)}.jpg`, {
			type: 'image/jpeg',
			lastModified: capturedAt,
		});

		const objectUrl = URL.createObjectURL(file);
		stopLiveAnalysis();
		stopCurrentStream();
		clearOverlayCanvas(overlayCanvasRef.current);
		setMode('idle');
		setIsModalOpen(false);
		setError(null);
		onCapture(file, objectUrl);
	}, [onCapture, stopCurrentStream, stopLiveAnalysis]);

	const handleLiveToggle = useCallback(() => {
		if (liveMode === 'running') {
			stopLiveAnalysis();
			return;
		}

		startLiveAnalysis();
	}, [liveMode, startLiveAnalysis, stopLiveAnalysis]);

	const handleUseLiveDiagnosis = useCallback(() => {
		if (liveDiagnosis === null || onLiveDiagnosis === undefined) return;
		handleCloseModal();
		onLiveDiagnosis(liveDiagnosis);
	}, [handleCloseModal, liveDiagnosis, onLiveDiagnosis]);

	return (
		<>
			<div className='camera-capture'>
				<button type='button' className='camera-btn camera-btn--primary' onClick={handleOpenModal}>
					Gebruik live camera
				</button>
			</div>

			{isModalOpen && (
				<div className='camera-modal-backdrop'>
					<div className='camera-modal' role='dialog' aria-modal='true' aria-label='Live camera analyse'>
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
								<button type='button' className='camera-btn' onClick={() => void handleStartCamera()}>
									Start camera
								</button>
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
									<button type='button' className='camera-btn camera-btn--ghost' onClick={handleStopCamera}>
										Stop camera
									</button>
								</div>
							)}
						</div>

						<div className='camera-preview' data-visible={mode === 'ready'}>
							<div className='camera-stage'>
								<video
									ref={videoRef}
									className='camera-video'
									autoPlay
									muted
									playsInline
								/>
								{import.meta.env.DEV && <canvas ref={overlayCanvasRef} className='camera-overlay' />}
							</div>
						</div>

						{import.meta.env.DEV && mode === 'ready' && (
							<div className='camera-status'>DEV: mondregio-overlay actief</div>
						)}

						{(liveMode === 'running' || liveDiagnosis !== null || liveError !== null) && (
							<div className='camera-live' aria-live='polite'>
								<div className='camera-live-header'>
									<span>Live-analyse</span>
									{liveMode === 'running' && liveStep !== null && (
										<span className='camera-live-step'>{LIVE_STEP_LABELS[liveStep]}</span>
									)}
								</div>

								{liveDiagnosis !== null && liveError === null && (
									<div className='camera-live-diagnosis'>
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

								{liveError !== null && <div className='camera-error'>{liveError}</div>}
							</div>
						)}

						{error !== null && (
							<div className='camera-error' role='alert'>
								{error}
							</div>
						)}
					</div>
				</div>
			)}
		</>
	);
}
