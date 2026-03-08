/**
 * Numeric utility functions shared across the analysis pipeline.
 * @module
 */

/**
 * Clamps a number to the inclusive range `[min, max]`.
 *
 * @param value - The number to clamp.
 * @param min - Lower bound (inclusive).
 * @param max - Upper bound (inclusive).
 * @returns The clamped value.
 *
 * @example
 * ```ts
 * clamp(150, 0, 100); // 100
 * clamp(-5, 0, 255);  // 0
 * ```
 */
export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
