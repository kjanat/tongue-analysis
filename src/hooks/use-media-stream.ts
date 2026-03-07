/**
 * @module use-media-stream
 * Manages a `getUserMedia` video stream lifecycle: acquisition, device
 * enumeration, camera switching, mirror detection, and teardown.
 * Consumed by {@link CameraCapture} to provide the `<video>` element
 * that {@link useLiveAnalysis} reads frames from.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Camera acquisition state machine.
 * - `'idle'` — no stream active; initial state and state after {@link UseMediaStreamResult.stop}.
 * - `'requesting'` — `getUserMedia` in flight; UI should show a spinner.
 * - `'ready'` — stream acquired and `<video>` playing.
 */
export type CameraMode = 'idle' | 'requesting' | 'ready';

/**
 * Return value of {@link useMediaStream}.
 */
interface UseMediaStreamResult {
	/** Current acquisition state. @see {@link CameraMode} */
	readonly mode: CameraMode;
	/** Dutch user-facing error from the last failed acquisition, or `null`. */
	readonly error: string | null;
	/** `true` when the active track is front-facing and the preview should be CSS-mirrored. */
	readonly mirrorPreview: boolean;
	/** All video-input devices known after the most recent `enumerateDevices` call. */
	readonly availableCameras: readonly MediaDeviceInfo[];
	/** `deviceId` of the currently active camera, or `null` before first acquisition. */
	readonly activeCameraId: string | null;
	/** Convenience: `availableCameras.length > 1`. */
	readonly canSwitchCamera: boolean;
	/** Ref to attach to the `<video>` element that will display the stream. */
	readonly videoRef: RefObject<HTMLVideoElement | null>;
	/** Acquire a stream using the last-preferred camera (or front-facing default). */
	readonly start: () => Promise<void>;
	/** Cycle to the next camera in {@link UseMediaStreamResult.availableCameras}. No-op if fewer than 2 cameras. */
	readonly switchToNextCamera: () => Promise<void>;
	/** Stop the stream, detach from the video element, and return to `'idle'`. */
	readonly stop: () => void;
	/** {@link UseMediaStreamResult.stop} + clear any lingering error. */
	readonly reset: () => void;
	/** Clear the error without stopping the stream. */
	readonly clearError: () => void;
	/** Set an external error message (e.g. from the analysis layer). */
	readonly setError: (message: string) => void;
}

/**
 * Stop all tracks on a `MediaStream`, releasing the camera hardware.
 *
 * @param stream - Stream to tear down.
 */
function stopStream(stream: MediaStream): void {
	for (const track of stream.getTracks()) {
		track.stop();
	}
}

/**
 * Map a `getUserMedia` / `video.play()` error to a Dutch user-facing string.
 * Handles `TypeError` (insecure context) and the standard `DOMException` names
 * defined in the Media Capture spec.
 *
 * @param error - Caught exception from camera acquisition.
 * @returns Localised (Dutch) description suitable for display.
 */
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

/**
 * Determine whether a video track is front-facing (selfie camera).
 * Checks `facingMode` first; falls back to heuristic label matching
 * for devices that don't report a facing mode (desktop webcams).
 * Defaults to `true` (mirror) when indeterminate, because most
 * single-camera devices are front-facing.
 *
 * @param track - Active video track to inspect.
 * @returns `true` if the track should be mirrored in the preview.
 */
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

/**
 * Check the first video track of a stream to decide whether the
 * preview should be horizontally mirrored.
 *
 * @param stream - Newly acquired `MediaStream`.
 * @returns `true` when the stream's video track is front-facing.
 * @see {@link isFrontFacingTrack}
 */
function shouldMirrorPreview(stream: MediaStream): boolean {
	const videoTrack = stream.getVideoTracks()[0];
	if (videoTrack === undefined) return false;
	return isFrontFacingTrack(videoTrack);
}

/**
 * Extract the `deviceId` from a track's settings.
 * Returns `null` when the browser doesn't expose it (e.g. before permission grant).
 *
 * @param track - Video track to query.
 * @returns Device ID string, or `null`.
 */
function getTrackDeviceId(track: MediaStreamTrack): string | null {
	const deviceId = track.getSettings().deviceId;
	if (typeof deviceId === 'string' && deviceId !== '') {
		return deviceId;
	}

	return null;
}

/**
 * Build `MediaTrackConstraints` for `getUserMedia`.
 * When a preferred camera is known, pins to that device via `exact`;
 * otherwise requests the front-facing camera as a soft preference.
 *
 * @param preferredCameraId - Device ID to target, or `null` for default.
 * @returns Constraints object for the `video` track.
 */
/**
 * Soft resolution target passed as `ideal` so the browser picks the
 * highest resolution the camera supports without ever over-constraining.
 */
const MAX_IDEAL_DIMENSION = 4096;

function buildVideoConstraints(preferredCameraId: string | null): MediaTrackConstraints {
	const resolution = {
		width: { ideal: MAX_IDEAL_DIMENSION },
		height: { ideal: MAX_IDEAL_DIMENSION },
	};

	if (preferredCameraId !== null) {
		return {
			deviceId: {
				exact: preferredCameraId,
			},
			...resolution,
		};
	}

	return {
		facingMode: 'user',
		...resolution,
	};
}

/**
 * Filter a device list down to video-input devices only.
 *
 * @param devices - Full list from `navigator.mediaDevices.enumerateDevices()`.
 * @returns Subset where `kind === 'videoinput'`.
 */
function toVideoInputDevices(devices: readonly MediaDeviceInfo[]): readonly MediaDeviceInfo[] {
	return devices.filter((device) => device.kind === 'videoinput');
}

/**
 * Manage a `getUserMedia` video stream with device switching and teardown.
 *
 * Handles the full lifecycle: secure-context check, stream acquisition,
 * device enumeration, camera cycling, mirror detection, autoplay errors,
 * and cleanup on unmount. Uses a monotonic request-ID counter to discard
 * responses from superseded requests (e.g. rapid start/stop).
 *
 * @returns Stream state and imperative controls.
 *
 * @example
 * ```tsx
 * const camera = useMediaStream();
 * // <video ref={camera.videoRef} />
 * // camera.start() to acquire, camera.stop() to release
 * // camera.switchToNextCamera() to cycle devices
 * ```
 */
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
						stopStream(stream);
						if (streamRef.current === stream) {
							streamRef.current = null;
						}

						if (video.srcObject === stream) {
							video.srcObject = null;
						}

						setMirrorPreview(false);
						setError('Automatisch afspelen mislukt. Tik op het videobeeld om te starten.');
						setMode('idle');
						return;
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
