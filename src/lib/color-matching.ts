import type { ColorProfile } from './color-analysis.ts';
import type { TongueType } from '../data/tongue-types.ts';

// ── Hex → HSL conversion ───────────────────────────────────────

interface Hsl {
	readonly h: number;
	readonly s: number;
	readonly l: number;
}

/** Parse "#RRGGBB" hex string to HSL. */
function hexToHsl(hex: string): Hsl {
	const r = parseInt(hex.slice(1, 3), 16) / 255;
	const g = parseInt(hex.slice(3, 5), 16) / 255;
	const b = parseInt(hex.slice(5, 7), 16) / 255;

	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const d = max - min;

	if (d === 0) return { h: 0, s: 0, l: l * 100 };

	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

	let h: number;
	if (max === r) {
		h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
	} else if (max === g) {
		h = ((b - r) / d + 2) / 6;
	} else {
		h = ((r - g) / d + 4) / 6;
	}

	return { h: h * 360, s: s * 100, l: l * 100 };
}

// ── HSL distance ───────────────────────────────────────────────

/**
 * Compute weighted HSL distance between two colors.
 *
 * Hue is treated as circular (0° and 360° are identical).
 * Weights emphasize hue and lightness over saturation, matching
 * how TCM tongue color categories are distinguished.
 */
function hslDistance(a: Hsl, b: Hsl): number {
	// Circular hue difference (0–180)
	const rawHueDiff = Math.abs(a.h - b.h);
	const hueDiff = Math.min(rawHueDiff, 360 - rawHueDiff) / 180; // normalize 0–1

	const satDiff = Math.abs(a.s - b.s) / 100; // normalize 0–1
	const litDiff = Math.abs(a.l - b.l) / 100; // normalize 0–1

	// Weights: hue 1.0, saturation 0.5, lightness 0.8
	return Math.sqrt(
		hueDiff * hueDiff * 1.0
		+ satDiff * satDiff * 0.5
		+ litDiff * litDiff * 0.8,
	);
}

// ── Weight boosting ────────────────────────────────────────────

/** Minimum boost multiplier — no type becomes impossible. */
const MIN_BOOST = 0.3;

/** Maximum boost multiplier — no type becomes guaranteed. */
const MAX_BOOST = 3.0;

/**
 * Compute per-type weight multipliers from image color vs tongue type colors.
 *
 * Close color match → higher multiplier (up to 3.0×).
 * Distant match → lower multiplier (down to 0.3×).
 * These multiply the existing `TongueType.weight` in `selectType`.
 */
export function colorBoosts(
	profile: ColorProfile,
	types: readonly TongueType[],
): readonly number[] {
	const imageHsl: Hsl = { h: profile.hue, s: profile.saturation, l: profile.lightness };

	const distances = types.map((t) => hslDistance(imageHsl, hexToHsl(t.color.hex)));

	// Find range for normalization
	let minDist = Infinity;
	let maxDist = 0;
	for (const d of distances) {
		if (d < minDist) minDist = d;
		if (d > maxDist) maxDist = d;
	}

	const range = maxDist - minDist;

	// Map distance → boost: closest = MAX_BOOST, farthest = MIN_BOOST
	if (range < 0.001) {
		// All types equally distant — no boost differentiation
		return types.map(() => 1.0);
	}

	return distances.map((d) => {
		const similarity = 1 - (d - minDist) / range; // 0–1, 1 = closest
		return MIN_BOOST + similarity * (MAX_BOOST - MIN_BOOST);
	});
}
