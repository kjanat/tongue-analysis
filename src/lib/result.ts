/**
 * Railway-oriented error handling via discriminated union.
 *
 * Replaces try/catch for expected failures throughout the analysis pipeline.
 * Pattern-match on `ok` to narrow to success or failure branch.
 *
 * @module
 */

/**
 * Discriminated union representing either a success value or a typed error.
 *
 * @typeParam T - The success value type.
 * @typeParam E - The error type.
 *
 * @example
 * ```ts
 * function parse(input: string): Result<number, 'NaN'> {
 *   const n = Number(input);
 *   return Number.isNaN(n) ? err('NaN') : ok(n);
 * }
 *
 * const result = parse('42');
 * if (result.ok) {
 *   console.log(result.value); // 42
 * } else {
 *   console.error(result.error); // 'NaN'
 * }
 * ```
 */
export type Result<T, E> =
	| {
		readonly ok: true;
		readonly value: T;
	}
	| {
		readonly ok: false;
		readonly error: E;
	};

/**
 * Construct a success {@link Result}.
 *
 * @param value - The success payload.
 * @returns A `Result` with `ok: true` and the given value.
 *
 * @example
 * ```ts
 * const result = ok(42);
 * // { ok: true, value: 42 }
 * ```
 */
export function ok<T>(value: T): Result<T, never> {
	return { ok: true, value };
}

/**
 * Construct a failure {@link Result}.
 *
 * @param error - The error payload.
 * @returns A `Result` with `ok: false` and the given error.
 *
 * @example
 * ```ts
 * const result = err('not_found');
 * // { ok: false, error: 'not_found' }
 * ```
 */
export function err<E>(error: E): Result<never, E> {
	return { ok: false, error };
}
