/**
 * Shared time formatting for Dutch locale display.
 *
 * @module
 */

/**
 * Format a millisecond timestamp as Dutch locale time (`HH:MM:SS`).
 *
 * @param timestampMs - Unix timestamp in milliseconds.
 * @returns Formatted time string, e.g. `"14:32:07"`.
 */
export function formatUpdateTime(timestampMs: number): string {
	return new Date(timestampMs).toLocaleTimeString('nl-NL', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
}
