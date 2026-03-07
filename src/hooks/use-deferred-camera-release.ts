import { useCallback, useEffect, useRef } from 'react';

interface UseDeferredCameraReleaseInput {
	readonly active: boolean;
	readonly onRelease: () => void;
	readonly delayMs: number;
}

interface UseDeferredCameraReleaseResult {
	readonly clear: () => void;
	readonly schedule: () => void;
}

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
