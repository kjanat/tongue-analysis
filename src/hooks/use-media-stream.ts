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
	const requestIdRef = useRef(0);

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

	const stop = useCallback(() => {
		requestIdRef.current += 1;
		stopCurrentStream();
		setMode('idle');
	}, [stopCurrentStream]);

	const reset = useCallback(() => {
		stop();
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

		const requestId = requestIdRef.current + 1;
		requestIdRef.current = requestId;
		const isCurrentRequest = (): boolean => requestIdRef.current === requestId;

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

			if (!isCurrentRequest()) {
				stopStream(stream);
				return;
			}

			streamRef.current = stream;

			const video = videoRef.current;
			if (video !== null) {
				if (!isCurrentRequest()) {
					stopStream(stream);
					return;
				}

				video.srcObject = stream;
				try {
					await video.play();
				} catch (playError: unknown) {
					if (import.meta.env.DEV) {
						console.warn('video.play() failed:', playError);
					}

					if (!isCurrentRequest()) {
						stopStream(stream);
						return;
					}

					if (playError instanceof DOMException && playError.name !== 'AbortError') {
						setError('Automatisch afspelen mislukt. Tik op het videobeeld om te starten.');
					}
				}
			}

			if (!isCurrentRequest()) {
				stopStream(stream);
				return;
			}

			setMode('ready');
		} catch (cameraError) {
			if (!isCurrentRequest()) return;
			setError(cameraErrorMessage(cameraError));
			setMode('idle');
		}
	}, [mode, stopCurrentStream]);

	useEffect(() => {
		return () => {
			requestIdRef.current += 1;
			stopCurrentStream();
		};
	}, [stopCurrentStream]);

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
