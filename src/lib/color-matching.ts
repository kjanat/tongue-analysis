import { hexToOklch, isAchromatic, type Oklch, rgbToOklch } from 'hex-to-oklch';
import type { TongueType } from '../data/tongue-types.ts';
import type { ColorProfile } from './color-analysis.ts';

// ── HSL profile → OKLCH conversion ─────────────────────────────

interface Rgb {
	readonly r: number;
	readonly g: number;
	readonly b: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function normalizeHueDegrees(hue: number): number {
	return ((hue % 360) + 360) % 360;
}

function hslToRgb(h: number, s: number, l: number): Rgb {
	const hue = normalizeHueDegrees(h) / 360;
	const sat = clamp(s, 0, 100) / 100;
	const lit = clamp(l, 0, 100) / 100;

	if (sat === 0) {
		const gray = Math.round(lit * 255);
		return { r: gray, g: gray, b: gray };
	}

	const q = lit < 0.5 ? lit * (1 + sat) : lit + sat - lit * sat;
	const p = 2 * lit - q;

	function hueToChannel(t: number): number {
		const wrapped = (t + 1) % 1;
		if (wrapped < 1 / 6) return p + (q - p) * 6 * wrapped;
		if (wrapped < 1 / 2) return q;
		if (wrapped < 2 / 3) return p + (q - p) * (2 / 3 - wrapped) * 6;
		return p;
	}

	return {
		r: Math.round(hueToChannel(hue + 1 / 3) * 255),
		g: Math.round(hueToChannel(hue) * 255),
		b: Math.round(hueToChannel(hue - 1 / 3) * 255),
	};
}

function profileToOklch(profile: ColorProfile): Oklch {
	const rgb = hslToRgb(profile.hue, profile.saturation, profile.lightness);
	return rgbToOklch(rgb);
}

// ── OKLCH distance ──────────────────────────────────────────────

const LIGHTNESS_WEIGHT = 1;
const CHROMA_WEIGHT = 1;
const HUE_WEIGHT = 1;

/**
 * Typical upper bound of sRGB chroma in OKLCH.
 *
 * Normalizing by this keeps ΔC on a comparable 0–1-ish scale with
 * normalized ΔL and circular Δh.
 */
const CHROMA_SCALE = 0.4;

/**
 * Compute weighted OKLCH distance between two colors.
 *
 * Hue is circular (0° and 360° are identical). For achromatic
 * colors, hue is ignored because it is perceptually meaningless.
 */
function oklchDistance(a: Oklch, b: Oklch): number {
	const lightnessDiff = Math.abs(a.l - b.l);
	const chromaDiff = Math.abs(a.c - b.c) / CHROMA_SCALE;

	const rawHueDiff = Math.abs(a.h - b.h);
	const hueDiff = isAchromatic(a) || isAchromatic(b)
		? 0
		: Math.min(rawHueDiff, 360 - rawHueDiff) / 180;

	return Math.sqrt(
		lightnessDiff * lightnessDiff * LIGHTNESS_WEIGHT
			+ chromaDiff * chromaDiff * CHROMA_WEIGHT
			+ hueDiff * hueDiff * HUE_WEIGHT,
	);
}

// ── Weight boosting ────────────────────────────────────────────

/** Minimum boost — distant colors still selectable. */
const MIN_BOOST = 0.3;

/** Maximum boost — close matches strongly favoured. */
const MAX_BOOST = 3.0;

/**
 * Sharpness of the exponential falloff.
 *
 * Higher = narrower "cone" around each type color.
 *
 * At k=5: d=0 → 1.0, d=0.2 → 0.82, d=0.5 → 0.29, d=0.8 → 0.04.
 */
const FALLOFF_K = 5;

/**
 * Compute per-type weight multipliers from image color vs tongue type colors.
 *
 * Uses absolute Gaussian-style falloff: `exp(-k * d²)`.
 *
 * When image color is far from ALL types, all boosts ≈ `MIN_BOOST`,
 * so the `PRNG` dominates. Only genuinely close matches get meaningful lift.
 */
export function colorBoosts(
	profile: ColorProfile,
	types: readonly TongueType[],
): readonly number[] {
	const imageOklch = profileToOklch(profile);

	return types.map((t) => {
		const d = oklchDistance(imageOklch, hexToOklch(t.color.hex));
		const similarity = Math.exp(-FALLOFF_K * d * d); // 0–1, absolute
		return MIN_BOOST + similarity * (MAX_BOOST - MIN_BOOST);
	});
}
