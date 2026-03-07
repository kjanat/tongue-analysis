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

/** Tracks the in-flight transition so rapid phase changes skip stale animations. */
let activeTransition: ViewTransition | undefined;

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
	if (window.matchMedia(REDUCED_MOTION_QUERY).matches) {
		update();
		return;
	}

	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime guard for browsers without View Transitions API
	if (!document.startViewTransition) {
		update();
		return;
	}

	activeTransition?.skipTransition();

	const transition = document.startViewTransition(() => {
		// eslint-disable-next-line react-dom/no-flush-sync -- required: View Transitions API needs synchronous DOM commit inside callback
		flushSync(update);
	});
	activeTransition = transition;

	void transition.finished.then(() => {
		if (activeTransition === transition) {
			activeTransition = undefined;
		}
	});
}
