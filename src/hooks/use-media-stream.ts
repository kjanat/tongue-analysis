/**
 * @module use-media-stream
 * Manages a `getUserMedia` video stream lifecycle: acquisition, device
 * enumeration, camera switching, mirror detection, and teardown.
 * Consumed by {@link CameraCapture} to provide the `<video>` element
 * that {@link useLiveAnalysis} reads frames from.
 */

import { isLikelyMobileDevice } from '$lib/device-detection.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Camera acquisition state machine.
 * - `'idle'` — no stream active; initial state and state after {@link UseMediaStreamResult.stop}.
 * - `'requesting'` — `getUserMedia` in flight; UI should show a spinner.
 * - `'ready'` — stream acquired and `<video>` playing.
 */
export type CameraMode = 'idle' | 'requesting' | 'ready';

/** Coarse front/back bucket used for UI mirroring and mobile camera switching. */
type CameraFacing = 'front' | 'back';

/** Error shown when the active camera track ends unexpectedly. */
const TRACK_ENDED_ERROR = 'Camera is gestopt of losgekoppeld. Start opnieuw.';

/** Error shown when the active camera track temporarily stops delivering frames. */
const TRACK_MUTED_ERROR = 'Camera levert tijdelijk geen beeld. Controleer het apparaat en probeer opnieuw.';

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
	/** Start a specific camera by device ID. No-op when already active. */
	readonly selectCamera: (cameraId: string) => Promise<void>;
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
 * Convert a track-reported `facingMode` into the hook's simplified facing model.
 *
 * @param facingMode - Raw facing mode string from track settings/capabilities.
 * @returns `'front'`, `'back'`, or `null` when the mode is missing/unsupported.
 */
function facingFromMode(facingMode: string | undefined): CameraFacing | null {
	if (facingMode === 'user') return 'front';
	if (facingMode === 'environment') return 'back';
	return null;
}

/**
 * Determine a video track's facing direction.
 * Uses track settings first, then capabilities when available.
 *
 * @param track - Active video track to inspect.
 * @returns Facing direction, or `null` when the browser provides no signal.
 */
function getTrackFacing(track: MediaStreamTrack): CameraFacing | null {
	const settingFacing = facingFromMode(track.getSettings().facingMode);
	if (settingFacing !== null) {
		return settingFacing;
	}

	const capabilities = track.getCapabilities();
	if (!('facingMode' in capabilities)) {
		return null;
	}

	const capabilityFacingModes = capabilities.facingMode;
	if (capabilityFacingModes === undefined) {
		return null;
	}

	if (capabilityFacingModes.includes('user')) {
		return 'front';
	}

	if (capabilityFacingModes.includes('environment')) {
		return 'back';
	}

	return null;
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
 * Extract the `groupId` from a track's settings.
 * Useful when a browser reports a transient `deviceId` but keeps a stable group.
 *
 * @param track - Video track to query.
 * @returns Group ID string, or `null`.
 */
function getTrackGroupId(track: MediaStreamTrack): string | null {
	const groupId = track.getSettings().groupId;
	if (typeof groupId === 'string' && groupId !== '') {
		return groupId;
	}

	return null;
}

// ── Camera Helpers ──────────────────

/**
 * Reconcile the current stream with the latest enumerated camera list.
 * Prefers exact IDs, then stable `groupId`, then previously learned facing data.
 *
 * @param videoDevices - Enumerated `videoinput` devices.
 * @param fallbackActiveCameraId - Last known camera ID to preserve when possible.
 * @param activeTrackDeviceId - `deviceId` read from the active track, if available.
 * @param activeTrackGroupId - `groupId` read from the active track, if available.
 * @param activeTrackFacing - Facing derived from the active track, if available.
 * @param cameraFacingById - Previously observed facing per stable device ID.
 * @returns Best matching camera ID from the latest enumeration result.
 */
function findMatchingCameraId(
	videoDevices: readonly MediaDeviceInfo[],
	fallbackActiveCameraId: string | null,
	activeTrackDeviceId: string | null,
	activeTrackGroupId: string | null,
	activeTrackFacing: CameraFacing | null,
	cameraFacingById: ReadonlyMap<string, CameraFacing>,
): string | null {
	if (fallbackActiveCameraId !== null) {
		const exactMatch = videoDevices.find((device) => device.deviceId === fallbackActiveCameraId);
		if (exactMatch !== undefined) {
			return exactMatch.deviceId;
		}
	}

	if (activeTrackDeviceId !== null) {
		const trackDeviceMatch = videoDevices.find((device) => device.deviceId === activeTrackDeviceId);
		if (trackDeviceMatch !== undefined) {
			return trackDeviceMatch.deviceId;
		}
	}

	if (activeTrackGroupId !== null) {
		const groupMatches = videoDevices.filter((device) => device.groupId === activeTrackGroupId);
		if (groupMatches.length === 1) {
			return groupMatches[0]?.deviceId ?? null;
		}

		if (activeTrackFacing !== null) {
			const groupFacingMatch = groupMatches.find(
				(device) => cameraFacingById.get(device.deviceId) === activeTrackFacing,
			);
			if (groupFacingMatch !== undefined) {
				return groupFacingMatch.deviceId;
			}
		}
	}

	if (activeTrackFacing !== null) {
		const knownFacingMatch = videoDevices.find(
			(device) => cameraFacingById.get(device.deviceId) === activeTrackFacing,
		);
		if (knownFacingMatch !== undefined) {
			return knownFacingMatch.deviceId;
		}
	}

	return videoDevices[0]?.deviceId ?? null;
}

/**
 * Soft resolution target passed as `ideal` so the browser picks the
 * highest resolution the camera supports without ever over-constraining.
 */
const MAX_IDEAL_DIMENSION = 4096;

/**
 * Build `MediaTrackConstraints` for `getUserMedia`.
 * Uses `getSupportedConstraints()` so unsupported keys are omitted entirely.
 *
 * @param preferredCameraId - Device ID to target, or `null` for default selection.
 * @returns Constraints object for the `video` track.
 */
function buildVideoConstraints(preferredCameraId: string | null): MediaTrackConstraints {
	const supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
	const constraints: MediaTrackConstraints = {};

	if (supportedConstraints.width === true) {
		constraints.width = { ideal: MAX_IDEAL_DIMENSION };
	}

	if (supportedConstraints.height === true) {
		constraints.height = { ideal: MAX_IDEAL_DIMENSION };
	}

	if (preferredCameraId !== null && supportedConstraints.deviceId === true) {
		constraints.deviceId = {
			exact: preferredCameraId,
		};
		return constraints;
	}

	if (supportedConstraints.facingMode === true) {
		constraints.facingMode = 'user';
	}

	return constraints;
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
	const activeTrackCleanupRef = useRef<(() => void) | null>(null);
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

	/**
	 * Re-enumerate cameras and reconcile the active selection with the current stream.
	 *
	 * @param isCurrentRequest - Guard that rejects stale async completions.
	 * @param fallbackActiveCameraId - Camera ID to preserve if reconciliation is ambiguous.
	 * @param activeTrackDeviceId - `deviceId` from the active track, if available.
	 * @param activeTrackGroupId - `groupId` from the active track, if available.
	 * @param activeTrackFacing - Facing derived from the active track, if available.
	 * @returns The reconciled active camera ID.
	 */
	const refreshAvailableCameras = useCallback(
		async (
			isCurrentRequest: () => boolean,
			fallbackActiveCameraId: string | null,
			activeTrackDeviceId: string | null,
			activeTrackGroupId: string | null,
			activeTrackFacing: CameraFacing | null,
		): Promise<string | null> => {
			try {
				const devices = await navigator.mediaDevices.enumerateDevices();
				if (!isCurrentRequest()) return fallbackActiveCameraId;

				const videoDevices = toVideoInputDevices(devices);
				setAvailableCameras(videoDevices);

				const nextActiveCameraId = findMatchingCameraId(
					videoDevices,
					fallbackActiveCameraId,
					activeTrackDeviceId,
					activeTrackGroupId,
					activeTrackFacing,
					cameraFacingByIdRef.current,
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

	/**
	 * Detach lifecycle listeners, stop the current stream, and clear the bound `<video>`.
	 * Safe to call repeatedly.
	 */
	const stopCurrentStream = useCallback(() => {
		activeTrackCleanupRef.current?.();
		activeTrackCleanupRef.current = null;
		activeCameraFacingRef.current = null;

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

	/** Cancel any in-flight request and return the hook to the idle state. */
	const stop = useCallback(() => {
		requestIdRef.current += 1;
		stopCurrentStream();
		setMirrorPreview(false);
		updateMode('idle');
	}, [stopCurrentStream, updateMode]);

	/** Fully reset the camera state, including any surfaced user-facing error. */
	const reset = useCallback(() => {
		stop();
		setError(null);
	}, [stop]);

	/** Clear the current user-facing camera error without touching the stream. */
	const clearError = useCallback(() => {
		setError(null);
	}, []);

	/**
	 * Expose a setter for non-camera layers to surface a camera-related error in the shared UI.
	 *
	 * @param message - Error text to display to the user.
	 */
	const setErrorMessage = useCallback((message: string) => {
		setError(message);
	}, []);

	/**
	 * Cache the observed facing for a stable device ID so future switches can avoid label parsing.
	 *
	 * @param cameraId - Stable device ID from enumeration.
	 * @param facing - Facing observed from a live track.
	 */
	const rememberCameraFacing = useCallback((cameraId: string | null, facing: CameraFacing | null) => {
		activeCameraFacingRef.current = facing;
		if (cameraId !== null && facing !== null) {
			cameraFacingByIdRef.current.set(cameraId, facing);
		}
	}, []);

	/**
	 * Subscribe to lifecycle events on the active track so revocation/ejection is reflected in UI state.
	 *
	 * @param track - Active video track to observe.
	 * @param isCurrentRequest - Guard that rejects events from superseded requests.
	 */
	const bindTrackLifecycle = useCallback((track: MediaStreamTrack, isCurrentRequest: () => boolean) => {
		activeTrackCleanupRef.current?.();

		const handleEnded = (): void => {
			if (!isCurrentRequest()) return;

			stopCurrentStream();
			setMirrorPreview(false);
			setError(TRACK_ENDED_ERROR);
			updateMode('idle');
			void refreshAvailableCameras(
				isCurrentRequest,
				preferredCameraIdRef.current,
				getTrackDeviceId(track),
				getTrackGroupId(track),
				getTrackFacing(track),
			);
		};

		const handleMute = (): void => {
			if (!isCurrentRequest()) return;
			if (modeRef.current !== 'ready') return;
			setError(TRACK_MUTED_ERROR);
		};

		const handleUnmute = (): void => {
			if (!isCurrentRequest()) return;
			setError((currentError) => currentError === TRACK_MUTED_ERROR ? null : currentError);
		};

		track.addEventListener('ended', handleEnded);
		track.addEventListener('mute', handleMute);
		track.addEventListener('unmute', handleUnmute);

		activeTrackCleanupRef.current = () => {
			track.removeEventListener('ended', handleEnded);
			track.removeEventListener('mute', handleMute);
			track.removeEventListener('unmute', handleUnmute);
		};
	}, [refreshAvailableCameras, stopCurrentStream, updateMode]);

	/**
	 * Acquire a camera stream, optionally targeting a specific device.
	 * Handles teardown, retry-on-overconstrained, enumeration, and autoplay setup.
	 *
	 * @param requestedCameraId - Explicit camera ID to request, or `null` for browser selection.
	 */
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
			const trackFacing = videoTrack === undefined ? null : getTrackFacing(videoTrack);
			setMirrorPreview(trackFacing === 'front');
			const resolvedCameraId = videoTrack === undefined
				? requestedCameraId
				: getTrackDeviceId(videoTrack) ?? requestedCameraId;
			const trackGroupId = videoTrack === undefined ? null : getTrackGroupId(videoTrack);
			// Prefer the requestedCameraId (from enumerateDevices) over the
			// resolved track ID (from getSettings). track.getSettings().deviceId
			// can differ from the enumerateDevices() deviceId on some devices,
			// which breaks switchToNextCamera's index lookup and causes
			// alternating reload/switch behavior.
			const effectiveCameraId = requestedCameraId ?? resolvedCameraId;
			setActiveCameraId(effectiveCameraId);
			preferredCameraIdRef.current = effectiveCameraId;
			rememberCameraFacing(effectiveCameraId, trackFacing);
			streamRef.current = stream;
			// Normalise the active camera against enumerateDevices() before the
			// UI becomes ready again. Otherwise the switch button can read a
			// transient track ID and spend one tap re-opening the current camera.
			await refreshAvailableCameras(
				isCurrentRequest,
				effectiveCameraId,
				resolvedCameraId,
				trackGroupId,
				trackFacing,
			);
			rememberCameraFacing(preferredCameraIdRef.current, trackFacing);
			if (videoTrack !== undefined) {
				bindTrackLifecycle(videoTrack, isCurrentRequest);
			}

			const video = videoRef.current;
			if (video !== null) {
				if (!isCurrentRequest()) {
					if (streamRef.current === stream) {
						streamRef.current = null;
					}
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
						: getTrackFacing(fallbackTrack);
					setMirrorPreview(fallbackTrackFacing === 'front');
					const fallbackDeviceId = fallbackTrack === undefined
						? null
						: getTrackDeviceId(fallbackTrack);
					const fallbackGroupId = fallbackTrack === undefined ? null : getTrackGroupId(fallbackTrack);
					setActiveCameraId(fallbackDeviceId);
					preferredCameraIdRef.current = fallbackDeviceId;
					rememberCameraFacing(fallbackDeviceId, fallbackTrackFacing);
					streamRef.current = fallbackStream;
					await refreshAvailableCameras(
						isCurrentRequest,
						fallbackDeviceId,
						fallbackDeviceId,
						fallbackGroupId,
						fallbackTrackFacing,
					);
					rememberCameraFacing(preferredCameraIdRef.current, fallbackTrackFacing);
					if (fallbackTrack !== undefined) {
						bindTrackLifecycle(fallbackTrack, isCurrentRequest);
					}
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
						if (streamRef.current === fallbackStream) {
							streamRef.current = null;
						}
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
	}, [bindTrackLifecycle, refreshAvailableCameras, rememberCameraFacing, stopCurrentStream, updateMode]);

	/** Start the previously preferred camera, or the browser-default front-facing choice. */
	const start = useCallback(async () => {
		await startWithCameraId(preferredCameraIdRef.current);
	}, [startWithCameraId]);

	/**
	 * Cycle to the next camera.
	 * On mobile, prefers switching between known front/back devices before falling back to simple cycling.
	 */
	const switchToNextCamera = useCallback(async () => {
		if (modeRef.current !== 'ready') return;
		if (availableCameras.length < 2) return;

		const activeCameraIdForCycle = preferredCameraIdRef.current ?? activeCameraId;
		const activeIndex = availableCameras.findIndex((device) => device.deviceId === activeCameraIdForCycle);
		const activeFacing = activeCameraFacingRef.current
			?? (activeCameraIdForCycle === null
				? null
				: cameraFacingByIdRef.current.get(activeCameraIdForCycle)
					?? null);

		if (isLikelyMobileDevice() && activeFacing !== null) {
			const targetFacing: CameraFacing = activeFacing === 'front' ? 'back' : 'front';

			for (let offset = 1; offset <= availableCameras.length; offset += 1) {
				const nextIndex = activeIndex < 0
					? offset - 1
					: (activeIndex + offset) % availableCameras.length;
				const candidate = availableCameras[nextIndex];
				if (candidate === undefined) continue;

				const candidateFacing = cameraFacingByIdRef.current.get(candidate.deviceId);
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

	/**
	 * Select a specific enumerated camera by ID.
	 *
	 * @param cameraId - Stable `MediaDeviceInfo.deviceId` chosen by the user.
	 */
	const selectCamera = useCallback(async (cameraId: string) => {
		if (modeRef.current !== 'ready') return;
		if (cameraId === '') return;

		const activeCameraIdForSelection = preferredCameraIdRef.current ?? activeCameraId;
		if (activeCameraIdForSelection === cameraId) return;

		await startWithCameraId(cameraId);
	}, [activeCameraId, startWithCameraId]);

	/** Keep the camera list fresh when hardware or permission state changes. */
	useEffect(() => {
		const mediaDevices = navigator.mediaDevices;
		if (typeof mediaDevices.addEventListener !== 'function') {
			return;
		}

		let cancelled = false;
		const handleDeviceChange = (): void => {
			const stream = streamRef.current;
			const activeTrack = stream?.getVideoTracks()[0];

			void refreshAvailableCameras(
				() => !cancelled,
				preferredCameraIdRef.current,
				activeTrack === undefined ? null : getTrackDeviceId(activeTrack),
				activeTrack === undefined ? null : getTrackGroupId(activeTrack),
				activeTrack === undefined ? null : getTrackFacing(activeTrack),
			);
		};

		mediaDevices.addEventListener('devicechange', handleDeviceChange);
		return () => {
			cancelled = true;
			mediaDevices.removeEventListener('devicechange', handleDeviceChange);
		};
	}, [refreshAvailableCameras]);

	/** Release camera resources when the hook owner unmounts. */
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
		selectCamera,
		stop,
		reset,
		clearError,
		setError: setErrorMessage,
	};
}
