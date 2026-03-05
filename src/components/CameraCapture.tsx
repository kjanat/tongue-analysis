import { useCallback, useEffect, useRef, useState } from 'react';

interface CameraCaptureProps {
	readonly onCapture: (file: File, objectUrl: string) => void;
}

type CameraMode = 'idle' | 'requesting' | 'ready';

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

export default function CameraCapture({ onCapture }: CameraCaptureProps) {
	const [mode, setMode] = useState<CameraMode>('idle');
	const [error, setError] = useState<string | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const videoRef = useRef<HTMLVideoElement>(null);

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

	useEffect(() => {
		return () => {
			stopCurrentStream();
		};
	}, [stopCurrentStream]);

	const handleStartCamera = useCallback(async () => {
		if (mode === 'requesting') return;

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
	}, [mode, stopCurrentStream]);

	const handleStopCamera = useCallback(() => {
		stopCurrentStream();
		setMode('idle');
	}, [stopCurrentStream]);

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
		stopCurrentStream();
		setMode('idle');
		setError(null);
		onCapture(file, objectUrl);
	}, [onCapture, stopCurrentStream]);

	return (
		<div className='camera-capture' data-mode={mode}>
			<div className='camera-actions'>
				{mode === 'idle' && (
					<button type='button' className='camera-btn' onClick={() => void handleStartCamera()}>
						Gebruik camera
					</button>
				)}

				{mode === 'requesting' && <div className='camera-status'>Camera wordt gestart...</div>}

				{mode === 'ready' && (
					<div className='camera-controls'>
						<button type='button' className='camera-btn camera-btn--primary' onClick={() => void handleCapture()}>
							Foto maken
						</button>
						<button type='button' className='camera-btn camera-btn--ghost' onClick={handleStopCamera}>
							Stop camera
						</button>
					</div>
				)}
			</div>

			<div className='camera-preview' data-visible={mode === 'ready'}>
				<video
					ref={videoRef}
					className='camera-video'
					autoPlay
					muted
					playsInline
				/>
			</div>

			{error !== null && (
				<div className='camera-error' role='alert'>
					{error}
				</div>
			)}
		</div>
	);
}
