import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export type CameraMode = 'idle' | 'requesting' | 'ready';

interface UseMediaStreamResult {
	readonly mode: CameraMode;
	readonly error: string | null;
	readonly mirrorPreview: boolean;
	readonly availableCameras: readonly MediaDeviceInfo[];
	readonly activeCameraId: string | null;
	readonly canSwitchCamera: boolean;
	readonly videoRef: RefObject<HTMLVideoElement | null>;
	readonly start: () => Promise<void>;
	readonly switchToNextCamera: () => Promise<void>;
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
	if (error instanceof TypeError) {
		return 'Camera vereist een beveiligde verbinding (HTTPS).';
	}

	if (error instanceof DOMException) {
		switch (error.name) {
			case 'AbortError':
				return 'Camera starten afgebroken. Probeer opnieuw.';
			case 'InvalidStateError':
				return 'Camera is tijdelijk niet beschikbaar. Herlaad de pagina en probeer opnieuw.';
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

function isFrontFacingTrack(track: MediaStreamTrack): boolean {
	const facingMode = track.getSettings().facingMode;
	if (facingMode === 'user') return true;
	if (facingMode === 'environment') return false;

	const label = track.label.toLowerCase();
	if (label.includes('rear') || label.includes('back') || label.includes('environment')) {
		return false;
	}

	return true;
}

function shouldMirrorPreview(stream: MediaStream): boolean {
	const videoTrack = stream.getVideoTracks()[0];
	if (videoTrack === undefined) return false;
	return isFrontFacingTrack(videoTrack);
}

function getTrackDeviceId(track: MediaStreamTrack): string | null {
	const deviceId = track.getSettings().deviceId;
	if (typeof deviceId === 'string' && deviceId !== '') {
		return deviceId;
	}

	return null;
}

function buildVideoConstraints(preferredCameraId: string | null): MediaTrackConstraints {
	if (preferredCameraId !== null) {
		return {
			deviceId: {
				exact: preferredCameraId,
			},
		};
	}

	return {
		facingMode: 'user',
	};
}

function toVideoInputDevices(devices: readonly MediaDeviceInfo[]): readonly MediaDeviceInfo[] {
	return devices.filter((device) => device.kind === 'videoinput');
}

export function useMediaStream(): UseMediaStreamResult {
	const [mode, setMode] = useState<CameraMode>('idle');
	const [error, setError] = useState<string | null>(null);
	const [mirrorPreview, setMirrorPreview] = useState(false);
	const [availableCameras, setAvailableCameras] = useState<readonly MediaDeviceInfo[]>([]);
	const [activeCameraId, setActiveCameraId] = useState<string | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const videoRef = useRef<HTMLVideoElement>(null);
	const preferredCameraIdRef = useRef<string | null>(null);
	const requestIdRef = useRef(0);

	const refreshAvailableCameras = useCallback(
		async (isCurrentRequest: () => boolean, fallbackActiveCameraId: string | null): Promise<void> => {
			try {
				const devices = await navigator.mediaDevices.enumerateDevices();
				if (!isCurrentRequest()) return;

				const videoDevices = toVideoInputDevices(devices);
				setAvailableCameras(videoDevices);

				const firstCameraId = videoDevices[0]?.deviceId ?? null;
				const requestedCameraId = fallbackActiveCameraId ?? firstCameraId;
				const hasRequestedCamera = requestedCameraId !== null
					? videoDevices.some((device) => device.deviceId === requestedCameraId)
					: false;
				const nextActiveCameraId = hasRequestedCamera
					? requestedCameraId
					: firstCameraId;

				setActiveCameraId(nextActiveCameraId);
				preferredCameraIdRef.current = nextActiveCameraId;
			} catch (enumerateError: unknown) {
				if (import.meta.env.DEV) {
					console.warn('enumerateDevices() failed:', enumerateError);
				}

				if (!isCurrentRequest()) return;
				setAvailableCameras([]);
				setActiveCameraId(fallbackActiveCameraId);
				preferredCameraIdRef.current = fallbackActiveCameraId;
			}
		},
		[],
	);

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
		setMirrorPreview(false);
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

	const startWithCameraId = useCallback(async (requestedCameraId: string | null) => {
		if (mode === 'requesting') return;
		const previousPreferredCameraId = preferredCameraIdRef.current;
		if (!window.isSecureContext) {
			setError('Camera vereist een beveiligde verbinding (HTTPS).');
			setMirrorPreview(false);
			setMode('idle');
			return;
		}

		const requestId = requestIdRef.current + 1;
		requestIdRef.current = requestId;
		const isCurrentRequest = (): boolean => requestIdRef.current === requestId;

		stopCurrentStream();
		setMode('requesting');
		setError(null);
		setMirrorPreview(false);

		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: buildVideoConstraints(requestedCameraId),
				audio: false,
			});

			if (!isCurrentRequest()) {
				stopStream(stream);
				return;
			}

			setMirrorPreview(shouldMirrorPreview(stream));
			const videoTrack = stream.getVideoTracks()[0];
			const resolvedCameraId = videoTrack === undefined
				? requestedCameraId
				: getTrackDeviceId(videoTrack) ?? requestedCameraId;
			setActiveCameraId(resolvedCameraId);
			preferredCameraIdRef.current = resolvedCameraId;
			void refreshAvailableCameras(isCurrentRequest, resolvedCameraId);

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
			preferredCameraIdRef.current = previousPreferredCameraId;
			setError(cameraErrorMessage(cameraError));
			setMirrorPreview(false);
			setMode('idle');
		}
	}, [mode, refreshAvailableCameras, stopCurrentStream]);

	const start = useCallback(async () => {
		await startWithCameraId(preferredCameraIdRef.current);
	}, [startWithCameraId]);

	const switchToNextCamera = useCallback(async () => {
		if (mode !== 'ready') return;
		if (availableCameras.length < 2) return;

		const activeIndex = availableCameras.findIndex((device) => device.deviceId === activeCameraId);
		const nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % availableCameras.length;
		const nextCamera = availableCameras[nextIndex];
		if (nextCamera === undefined) return;

		await startWithCameraId(nextCamera.deviceId);
	}, [activeCameraId, availableCameras, mode, startWithCameraId]);

	useEffect(() => {
		return () => {
			requestIdRef.current += 1;
			stopCurrentStream();
		};
	}, [stopCurrentStream]);

	return {
		mode,
		error,
		mirrorPreview,
		availableCameras,
		activeCameraId,
		canSwitchCamera: availableCameras.length > 1,
		videoRef,
		start,
		switchToNextCamera,
		stop,
		reset,
		clearError,
		setError: setErrorMessage,
	};
}
