/**
 * View Transitions API helper for phase changes.
 *
 * Uses the callback signature (`startViewTransition(cb)`) for broadest
 * browser support — the options-object overload is not yet universal.
 * Wraps the update in `flushSync` so React commits synchronously inside
 * the snapshot window.
 *
 * @module
 */

import { flushSync } from 'react-dom';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

/** Tracks the in-flight transition so rapid phase changes skip stale animations. */
let activeTransition: ViewTransition | undefined;

/**
 * Start a managed View Transition when supported.
 *
 * Returns `null` when motion reduction is active or the API is unavailable,
 * after running the update immediately.
 *
 * @param update - Synchronous callback that mutates React state.
 */
export function startManagedViewTransition(update: () => void): ViewTransition | null {
	if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
		// eslint-disable-next-line react-dom/no-flush-sync -- consistent synchronous commit across all code paths
		flushSync(update);
		return null;
	}

	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime guard for browsers without View Transitions API
	if (!document.startViewTransition) {
		// eslint-disable-next-line react-dom/no-flush-sync -- consistent synchronous commit across all code paths
		flushSync(update);
		return null;
	}

	activeTransition?.skipTransition();

	const transition = document.startViewTransition(() => {
		// eslint-disable-next-line react-dom/no-flush-sync -- required: View Transitions API needs synchronous DOM commit inside callback
		flushSync(update);
	});
	activeTransition = transition;

	const clearActiveTransition = (): void => {
		if (activeTransition === transition) {
			activeTransition = undefined;
		}
	};

	void transition.finished.then(clearActiveTransition, clearActiveTransition);

	return transition;
}

/**
 * Run a DOM update inside a View Transition when the browser supports it.
 *
 * - Bails to a plain `update()` call when `prefers-reduced-motion: reduce`
 *   matches or the API is unavailable.
 * - Cancels any in-flight transition's animation (via `skipTransition()`)
 *   before starting a new one, preventing visual stacking.
 * - Uses `flushSync` to force React to commit synchronously so the
 *   browser captures accurate old/new snapshots.
 *
 * @param update - Synchronous callback that mutates React state (e.g. `setPhase(...)`).
 */
export function withViewTransition(update: () => void): void {
	startManagedViewTransition(update);
}

/**
 * Run an update in a managed View Transition and resolve when animation settles.
 *
 * Resolves immediately when transitions are unavailable or reduced motion is active.
 * Any skipped/replaced transition is swallowed so callers can sequence follow-up UI work.
 *
 * @param update - Synchronous callback that mutates React state.
 */
export function withViewTransitionAndWait(update: () => void): Promise<void> {
	const transition = startManagedViewTransition(update);
	if (transition === null) {
		return Promise.resolve();
	}

	return transition.finished.then(() => undefined).catch((error: unknown) => {
		if (isAbortError(error)) {
			return;
		}

		throw error;
	});
}
