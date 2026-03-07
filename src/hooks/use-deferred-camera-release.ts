/**
 * Deferred camera resource cleanup with cancellable timer.
 *
 * Schedules the {@link releaseFaceLandmarker} callback after a delay,
 * allowing the user to resume the camera without re-initializing
 * MediaPipe if they return quickly.
 *
 * @module
 */

import { useCallback, useEffect, useRef } from 'react';

/** Input configuration for {@link useDeferredCameraRelease}. */
interface UseDeferredCameraReleaseInput {
	/** Whether the deferred release mechanism is active. */
	readonly active: boolean;
	/** Callback invoked after the delay to release camera resources. */
	readonly onRelease: () => void;
	/** Delay in milliseconds before triggering release. */
	readonly delayMs: number;
}

/** Return value of {@link useDeferredCameraRelease}. */
interface UseDeferredCameraReleaseResult {
	/** Cancel any pending release timer. */
	readonly clear: () => void;
	/** Start (or restart) the deferred release countdown. */
	readonly schedule: () => void;
}

/**
 * Schedule a delayed camera resource release with cancellation support.
 *
 * When the user leaves live mode, this schedules cleanup after a grace period.
 * If they return before the timer fires, call `clear()` to cancel.
 * Auto-cleans up on unmount.
 *
 * @param input - Configuration with activation flag, release callback, and delay.
 * @returns Timer controls: {@link UseDeferredCameraReleaseResult.schedule schedule} and {@link UseDeferredCameraReleaseResult.clear clear}.
 *
 * @example
 * ```ts
 * const { clear, schedule } = useDeferredCameraRelease({
 *   active: !isCameraOpen,
 *   onRelease: releaseFaceLandmarker,
 *   delayMs: 30_000,
 * });
 * ```
 */
export function useDeferredCameraRelease({
	active,
	onRelease,
	delayMs,
}: UseDeferredCameraReleaseInput): UseDeferredCameraReleaseResult {
	const timerRef = useRef<number | null>(null);

	const clear = useCallback(() => {
		if (timerRef.current !== null) {
			window.clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	const schedule = useCallback(() => {
		clear();
		if (!active) return;

		timerRef.current = window.setTimeout(() => {
			onRelease();
			timerRef.current = null;
		}, delayMs);
	}, [active, clear, delayMs, onRelease]);

	useEffect(() => clear, [clear]);

	return { clear, schedule };
}
