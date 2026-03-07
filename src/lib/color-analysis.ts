/**
 * Client-side color extraction via Canvas pixel sampling.
 *
 * Downscales an image, samples the center 40%, and computes an averaged
 * HSL {@link ColorProfile}. Used by the upload path in `App.tsx` to feed
 * {@link colorBoosts} in `color-matching.ts`.
 *
 * @module
 */

// ── Client-side color extraction via Canvas ────────────────────

/**
 * Dominant color profile extracted from the center region of an image.
 *
 * HSL ranges follow CSS convention: hue 0–360, saturation/lightness 0–100.
 * Consumed by {@link colorBoosts} (via HSL→OKLCH conversion) and stored
 * in the analysis result for display.
 */
export interface ColorProfile {
	/** Dominant hue (0–360). Clamped to 0 when achromatic (saturation < 5). */
	readonly hue: number;
	/** Average saturation (0–100). */
	readonly saturation: number;
	/** Average lightness (0–100). */
	readonly lightness: number;
}

// ── RGB → HSL conversion ───────────────────────────────────────

/**
 * Convert sRGB channel values to HSL.
 *
 * @param r - Red channel (0–255).
 * @param g - Green channel (0–255).
 * @param b - Blue channel (0–255).
 * @returns Object with `h` (0–360), `s` (0–100), `l` (0–100).
 *
 * @example
 * ```ts
 * const { h, s, l } = rgbToHsl(255, 0, 0);
 * // { h: 0, s: 100, l: 50 }
 * ```
 */
export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;

	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const l = (max + min) / 2;
	const d = max - min;

	if (d === 0) return { h: 0, s: 0, l: l * 100 };

	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

	let h: number;
	if (max === rn) {
		h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
	} else if (max === gn) {
		h = ((bn - rn) / d + 2) / 6;
	} else {
		h = ((rn - gn) / d + 4) / 6;
	}

	return { h: h * 360, s: s * 100, l: l * 100 };
}

// ── Canvas pixel sampling ──────────────────────────────────────

/**
 * Downscale target in pixels (width and height).
 *
 * 50×50 = 2 500 pixels — small enough to iterate in <1ms,
 * large enough to preserve dominant color signal.
 */
const SAMPLE_SIZE = 50;

/**
 * Fraction of the image to crop from center (0–1).
 *
 * 0.4 = center 40% of each axis → 16% of total area. Avoids background
 * contamination at the edges while capturing the tongue's core region.
 */
const CENTER_CROP = 0.4;

/**
 * Load image from URL into an `HTMLImageElement`.
 *
 * Uses blob URLs from `URL.createObjectURL` — no CORS concerns.
 *
 * @param url - Blob URL or data URL of the image.
 * @returns Resolves when the image is fully decoded.
 */
function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			resolve(img);
		};
		img.onerror = () => {
			reject(new Error('Image load failed'));
		};
		img.src = url;
	});
}

/**
 * Extract the dominant color profile from the center region of an image.
 *
 * Draws to an off-DOM `<canvas>` (never appended), downscales to
 * {@link SAMPLE_SIZE}×{@link SAMPLE_SIZE}, samples the center
 * {@link CENTER_CROP} fraction, and returns averaged HSL values.
 * Hue is averaged circularly (via atan2 of sin/cos sums) to avoid
 * the 359°+1° → 180° wraparound artifact.
 *
 * @param imageUrl - Blob URL or data URL of the tongue image.
 * @returns Averaged {@link ColorProfile}, or `undefined` on failure (corrupt image, canvas unsupported).
 *
 * @example
 * ```ts
 * const profile = await extractColor(URL.createObjectURL(file));
 * if (profile) {
 *   console.log(profile.hue, profile.saturation, profile.lightness);
 * }
 * ```
 */
export async function extractColor(imageUrl: string): Promise<ColorProfile | undefined> {
	try {
		const img = await loadImage(imageUrl);

		const canvas = document.createElement('canvas');
		canvas.width = SAMPLE_SIZE;
		canvas.height = SAMPLE_SIZE;

		const ctx = canvas.getContext('2d');
		if (ctx === null) return undefined;

		// Draw downscaled image
		ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

		// Compute center crop bounds
		const margin = Math.floor((SAMPLE_SIZE * (1 - CENTER_CROP)) / 2);
		const cropSize = SAMPLE_SIZE - margin * 2;
		const data = ctx.getImageData(margin, margin, cropSize, cropSize).data;

		// Accumulate HSL values
		let hSin = 0;
		let hCos = 0;
		let sSum = 0;
		let lSum = 0;
		const pixelCount = cropSize * cropSize;

		for (let i = 0; i < data.length; i += 4) {
			const r = data[i];
			const g = data[i + 1];
			const b = data[i + 2];
			if (r === undefined || g === undefined || b === undefined) continue;

			const hsl = rgbToHsl(r, g, b);

			// Circular mean for hue (prevents 359° + 1° averaging to 180°)
			const hRad = (hsl.h * Math.PI) / 180;
			hSin += Math.sin(hRad);
			hCos += Math.cos(hRad);

			sSum += hsl.s;
			lSum += hsl.l;
		}

		const avgHue = ((Math.atan2(hSin / pixelCount, hCos / pixelCount) * 180) / Math.PI + 360) % 360;
		const avgSat = sSum / pixelCount;
		const avgLit = lSum / pixelCount;

		return {
			// Clamp hue to 0 when achromatic to avoid meaningless hue values
			hue: avgSat < 5 ? 0 : Math.round(avgHue * 10) / 10,
			saturation: Math.round(avgSat * 10) / 10,
			lightness: Math.round(avgLit * 10) / 10,
		};
	} catch {
		return undefined;
	}
}
