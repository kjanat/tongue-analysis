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
type CameraFacing = 'front' | 'back';

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

function facingFromTrack(track: MediaStreamTrack): CameraFacing {
	return isFrontFacingTrack(track) ? 'front' : 'back';
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

function normalizeCameraLabel(label: string): string {
	return label.trim().toLowerCase();
}

function isRearFacingLabel(label: string): boolean {
	return label.includes('rear')
		|| label.includes('back')
		|| label.includes('environment')
		|| label.includes('world');
}

function isFrontFacingLabel(label: string): boolean {
	return label.includes('front')
		|| label.includes('user')
		|| label.includes('face');
}

function facingFromLabel(label: string): CameraFacing | null {
	const normalizedLabel = normalizeCameraLabel(label);
	if (normalizedLabel === '') return null;
	if (isRearFacingLabel(normalizedLabel)) return 'back';
	if (isFrontFacingLabel(normalizedLabel)) return 'front';
	return null;
}

function isLikelyMobileDevice(): boolean {
	if (typeof navigator === 'undefined' || typeof window === 'undefined') {
		return false;
	}

	const userAgentData = (
		navigator as Navigator & {
			readonly userAgentData?: {
				readonly mobile?: boolean;
			};
		}
	).userAgentData;
	if (userAgentData?.mobile === true) {
		return true;
	}

	const userAgent = navigator.userAgent.toLowerCase();
	if (/android|iphone|ipad|ipod|mobile/.test(userAgent)) {
		return true;
	}

	return window.matchMedia('(pointer: coarse)').matches;
}

function findMatchingCameraId(
	videoDevices: readonly MediaDeviceInfo[],
	fallbackActiveCameraId: string | null,
	activeTrackLabel: string | null,
	activeTrackIsFrontFacing: boolean | null,
): string | null {
	if (fallbackActiveCameraId !== null) {
		const exactMatch = videoDevices.find((device) => device.deviceId === fallbackActiveCameraId);
		if (exactMatch !== undefined) {
			return exactMatch.deviceId;
		}
	}

	if (activeTrackLabel !== null) {
		const normalizedTrackLabel = normalizeCameraLabel(activeTrackLabel);
		const labelMatch = videoDevices.find((device) =>
			normalizeCameraLabel(device.label) === normalizedTrackLabel
		);
		if (labelMatch !== undefined) {
			return labelMatch.deviceId;
		}
	}

	if (activeTrackIsFrontFacing !== null) {
		const orientationMatch = videoDevices.find((device) => {
			const label = normalizeCameraLabel(device.label);
			if (label === '') return false;

			if (activeTrackIsFrontFacing) {
				return isFrontFacingLabel(label) || !isRearFacingLabel(label);
			}

			return isRearFacingLabel(label);
		});
		if (orientationMatch !== undefined) {
			return orientationMatch.deviceId;
		}
	}

	return videoDevices[0]?.deviceId ?? null;
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
 * Grace period (ms) after stopping camera tracks before requesting new ones.
 * Mobile camera HALs (especially Android) release hardware asynchronously;
 * an immediate `getUserMedia` can fail with `NotReadableError`.
 */
const CAMERA_RELEASE_DELAY_MS = 300;

/** Resolve after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
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
	const cameraFacingByIdRef = useRef(new Map<string, CameraFacing>());
	const activeCameraFacingRef = useRef<CameraFacing | null>(null);
	const requestIdRef = useRef(0);
	/**
	 * Synchronous mirror of {@link mode} that is always current,
	 * even inside stale closures. Prevents overlapping `getUserMedia`
	 * calls when rapid taps outrace React's batched re-renders.
	 */
	const modeRef = useRef<CameraMode>('idle');

	/** Update both React state and synchronous ref in lockstep. */
	const updateMode = useCallback((next: CameraMode) => {
		modeRef.current = next;
		setMode(next);
	}, []);

	const refreshAvailableCameras = useCallback(
		async (
			isCurrentRequest: () => boolean,
			fallbackActiveCameraId: string | null,
			activeTrackLabel: string | null,
			activeTrackIsFrontFacing: boolean | null,
		): Promise<string | null> => {
			try {
				const devices = await navigator.mediaDevices.enumerateDevices();
				if (!isCurrentRequest()) return fallbackActiveCameraId;

				const videoDevices = toVideoInputDevices(devices);
				setAvailableCameras(videoDevices);

				const nextActiveCameraId = findMatchingCameraId(
					videoDevices,
					fallbackActiveCameraId,
					activeTrackLabel,
					activeTrackIsFrontFacing,
				);

				setActiveCameraId(nextActiveCameraId);
				preferredCameraIdRef.current = nextActiveCameraId;
				return nextActiveCameraId;
			} catch (enumerateError: unknown) {
				if (import.meta.env.DEV) {
					console.warn('enumerateDevices() failed:', enumerateError);
				}

				if (!isCurrentRequest()) return fallbackActiveCameraId;
				setAvailableCameras([]);
				setActiveCameraId(fallbackActiveCameraId);
				preferredCameraIdRef.current = fallbackActiveCameraId;
				return fallbackActiveCameraId;
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
		updateMode('idle');
	}, [stopCurrentStream, updateMode]);

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

	const rememberCameraFacing = useCallback((cameraId: string | null, facing: CameraFacing | null) => {
		activeCameraFacingRef.current = facing;
		if (cameraId !== null && facing !== null) {
			cameraFacingByIdRef.current.set(cameraId, facing);
		}
	}, []);

	const startWithCameraId = useCallback(async (requestedCameraId: string | null) => {
		// Guard uses ref — immune to stale closures from React's batched renders.
		if (modeRef.current === 'requesting') return;
		const previousPreferredCameraId = preferredCameraIdRef.current;
		if (!window.isSecureContext) {
			setError('Camera vereist een beveiligde verbinding (HTTPS).');
			setMirrorPreview(false);
			updateMode('idle');
			return;
		}

		const requestId = requestIdRef.current + 1;
		requestIdRef.current = requestId;
		const isCurrentRequest = (): boolean => requestIdRef.current === requestId;

		// Track whether an old stream was active — mobile hardware needs a
		// grace period between track.stop() and the next getUserMedia call.
		const hadActiveStream = streamRef.current !== null;
		stopCurrentStream();
		updateMode('requesting');
		setError(null);
		setMirrorPreview(false);

		try {
			// Mobile camera HALs release hardware asynchronously after track.stop().
			// Without a grace period, getUserMedia can fail with NotReadableError.
			if (hadActiveStream) {
				await delay(CAMERA_RELEASE_DELAY_MS);
				if (!isCurrentRequest()) return;
			}

			const stream = await navigator.mediaDevices.getUserMedia({
				video: buildVideoConstraints(requestedCameraId),
				audio: false,
			});

			if (!isCurrentRequest()) {
				stopStream(stream);
				return;
			}

			const videoTrack = stream.getVideoTracks()[0];
			const trackFacing = videoTrack === undefined ? null : facingFromTrack(videoTrack);
			setMirrorPreview(trackFacing === 'front');
			const resolvedCameraId = videoTrack === undefined
				? requestedCameraId
				: getTrackDeviceId(videoTrack) ?? requestedCameraId;
			// Prefer the requestedCameraId (from enumerateDevices) over the
			// resolved track ID (from getSettings). track.getSettings().deviceId
			// can differ from the enumerateDevices() deviceId on some devices,
			// which breaks switchToNextCamera's index lookup and causes
			// alternating reload/switch behavior.
			const effectiveCameraId = requestedCameraId ?? resolvedCameraId;
			setActiveCameraId(effectiveCameraId);
			preferredCameraIdRef.current = effectiveCameraId;
			rememberCameraFacing(effectiveCameraId, trackFacing);
			// Normalise the active camera against enumerateDevices() before the
			// UI becomes ready again. Otherwise the switch button can read a
			// transient track ID and spend one tap re-opening the current camera.
			await refreshAvailableCameras(
				isCurrentRequest,
				effectiveCameraId,
				videoTrack?.label ?? null,
				trackFacing === 'front',
			);
			rememberCameraFacing(preferredCameraIdRef.current, trackFacing);

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
						updateMode('idle');
						return;
					}
				}
			}

			if (!isCurrentRequest()) {
				stopStream(stream);
				return;
			}

			updateMode('ready');
		} catch (cameraError) {
			if (!isCurrentRequest()) return;

			// On OverconstrainedError (stale deviceId, iOS quirks), retry with
			// relaxed constraints instead of giving up. Also helps on iOS Safari
			// where facingMode is more reliable than deviceId.
			// Fallback uses 'environment' (rear) intentionally: the user
			// explicitly requested a *different* camera (via switch), so
			// falling back to rear gives the best chance of a usable
			// alternative rather than re-acquiring the same front camera.
			if (
				requestedCameraId !== null
				&& cameraError instanceof DOMException
				&& cameraError.name === 'OverconstrainedError'
			) {
				try {
					const fallbackStream = await navigator.mediaDevices.getUserMedia({
						video: { facingMode: 'environment' },
						audio: false,
					});
					if (!isCurrentRequest()) {
						stopStream(fallbackStream);
						return;
					}
					// Continue with the fallback stream — reuse the success
					// path below by assigning and returning early.
					const fallbackTrack = fallbackStream.getVideoTracks()[0];
					const fallbackTrackFacing = fallbackTrack === undefined
						? null
						: facingFromTrack(fallbackTrack);
					setMirrorPreview(fallbackTrackFacing === 'front');
					const fallbackDeviceId = fallbackTrack === undefined
						? null
						: getTrackDeviceId(fallbackTrack);
					setActiveCameraId(fallbackDeviceId);
					preferredCameraIdRef.current = fallbackDeviceId;
					rememberCameraFacing(fallbackDeviceId, fallbackTrackFacing);
					await refreshAvailableCameras(
						isCurrentRequest,
						fallbackDeviceId,
						fallbackTrack?.label ?? null,
						fallbackTrackFacing === 'front',
					);
					rememberCameraFacing(preferredCameraIdRef.current, fallbackTrackFacing);

					streamRef.current = fallbackStream;
					const video = videoRef.current;
					if (video !== null) {
						video.srcObject = fallbackStream;
						try {
							await video.play();
						} catch (playError: unknown) {
							// AbortError from rapid switching is benign; real
							// autoplay failures mean the stream is unusable.
							if (playError instanceof DOMException && playError.name !== 'AbortError') {
								stopStream(fallbackStream);
								if (streamRef.current === fallbackStream) streamRef.current = null;
								if (video.srcObject === fallbackStream) video.srcObject = null;
								setMirrorPreview(false);
								setError('Automatisch afspelen mislukt. Tik op het videobeeld om te starten.');
								updateMode('idle');
								return;
							}
						}
					}
					if (!isCurrentRequest()) {
						stopStream(fallbackStream);
						return;
					}
					updateMode('ready');
					return;
				} catch {
					// Fallback also failed — fall through to normal error handling
					if (!isCurrentRequest()) return;
				}
			}

			preferredCameraIdRef.current = previousPreferredCameraId;
			setError(cameraErrorMessage(cameraError));
			setMirrorPreview(false);
			updateMode('idle');
		}
	}, [refreshAvailableCameras, rememberCameraFacing, stopCurrentStream, updateMode]);

	const start = useCallback(async () => {
		await startWithCameraId(preferredCameraIdRef.current);
	}, [startWithCameraId]);

	const switchToNextCamera = useCallback(async () => {
		if (modeRef.current !== 'ready') return;
		if (availableCameras.length < 2) return;

		const activeCameraIdForCycle = preferredCameraIdRef.current ?? activeCameraId;
		const activeIndex = availableCameras.findIndex((device) => device.deviceId === activeCameraIdForCycle);
		const activeFacing = activeCameraFacingRef.current
			?? (activeCameraIdForCycle === null
				? null
				: cameraFacingByIdRef.current.get(activeCameraIdForCycle)
					?? availableCameras.reduce<CameraFacing | null>((resolvedFacing, device) => {
						if (resolvedFacing !== null || device.deviceId !== activeCameraIdForCycle) {
							return resolvedFacing;
						}

						return facingFromLabel(device.label);
					}, null));

		if (isLikelyMobileDevice() && activeFacing !== null) {
			const targetFacing: CameraFacing = activeFacing === 'front' ? 'back' : 'front';

			for (let offset = 1; offset <= availableCameras.length; offset += 1) {
				const nextIndex = activeIndex < 0
					? offset - 1
					: (activeIndex + offset) % availableCameras.length;
				const candidate = availableCameras[nextIndex];
				if (candidate === undefined) continue;

				const candidateFacing = cameraFacingByIdRef.current.get(candidate.deviceId)
					?? facingFromLabel(candidate.label);
				if (candidateFacing === targetFacing) {
					await startWithCameraId(candidate.deviceId);
					return;
				}
			}
		}

		const nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % availableCameras.length;
		const nextCamera = availableCameras[nextIndex];
		if (nextCamera === undefined) return;

		await startWithCameraId(nextCamera.deviceId);
	}, [activeCameraId, availableCameras, startWithCameraId]);

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
