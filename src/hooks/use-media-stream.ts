import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export type CameraMode = 'idle' | 'requesting' | 'ready';

interface UseMediaStreamResult {
	readonly mode: CameraMode;
	readonly error: string | null;
	readonly videoRef: RefObject<HTMLVideoElement | null>;
	readonly start: () => Promise<void>;
	readonly stop: () => void;
	readonly reset: () => void;
	readonly clearError: () => void;
	readonly setError: (message: string) => void;
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

export function useMediaStream(): UseMediaStreamResult {
	const [mode, setMode] = useState<CameraMode>('idle');
	const [error, setError] = useState<string | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const videoRef = useRef<HTMLVideoElement>(null);

	const stop = useCallback(() => {
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

	const reset = useCallback(() => {
		stop();
		setMode('idle');
		setError(null);
	}, [stop]);

	const clearError = useCallback(() => {
		setError(null);
	}, []);

	const setErrorMessage = useCallback((message: string) => {
		setError(message);
	}, []);

	const start = useCallback(async () => {
		if (mode === 'requesting') return;

		stop();
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
				try {
					await video.play();
				} catch (playError: unknown) {
					if (import.meta.env.DEV) {
						console.warn('video.play() failed:', playError);
					}

					if (playError instanceof DOMException && playError.name !== 'AbortError') {
						setError('Automatisch afspelen mislukt. Tik op het videobeeld om te starten.');
					}
				}
			}

			setMode('ready');
		} catch (cameraError) {
			setError(cameraErrorMessage(cameraError));
			setMode('idle');
		}
	}, [mode, stop]);

	useEffect(() => {
		return () => {
			stop();
		};
	}, [stop]);

	return {
		mode,
		error,
		videoRef,
		start,
		stop,
		reset,
		clearError,
		setError: setErrorMessage,
	};
}
