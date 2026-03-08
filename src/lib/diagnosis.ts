/**
 * Transforms a {@link TongueColorClassification} into a full satirical TCM
 * {@link Diagnosis} by deriving Five-Element scores, meridian activity,
 * organ-zone mappings, and lifestyle tips.
 *
 * @module
 */

import {
	type Element,
	ELEMENTS,
	MERIDIANS,
	ORGAN_ELEMENT,
	ORGAN_ZONE,
	type OrganName,
	type TongueType,
	ZONE_LABEL,
} from '$data/tongue-types.ts';
import { computeDisplayConfidence, type TongueColorClassification } from './color-classification.ts';
import type { RgbColor } from './color-correction.ts';
import { clamp } from './math-utils.ts';

/**
 * Single organ-to-tongue-zone mapping used in diagnosis results.
 *
 * Produced by looking up each affected organ in {@link ORGAN_ZONE} and
 * resolving its human-readable label via {@link ZONE_LABEL}.
 */
export interface OrganZoneHit {
	/** TCM organ name (e.g. `'Lever'`, `'Hart'`). */
	readonly organ: OrganName;
	/** Dutch label of the tongue zone this organ maps to (e.g. `'Zijkanten'`). */
	readonly zone: string;
}

/**
 * Complete diagnosis output rendered by {@link DiagnosisResults}.
 *
 * Every field is derived deterministically from a single
 * {@link TongueColorClassification} — no randomness involved.
 */
export interface Diagnosis {
	/** The matched {@link TongueType} definition including name, description, and advice. */
	readonly type: TongueType;
	/** Classification confidence in `[0, 1]`. Higher means a closer color match. */
	readonly confidence: number;
	/**
	 * User-facing confidence in `[0, 1]`. Blends perceptual match quality with
	 * margin over the runner-up. Higher than {@link confidence} for typical inputs.
	 * Use this for display; use {@link confidence} for internal gating.
	 */
	readonly displayConfidence: number;
	/** Mean RGB of the segmented tongue pixels after color correction. */
	readonly observedColor: RgbColor;
	/** Five-Element (Wu Xing) scores, each clamped to `[10, 100]`. */
	readonly elements: readonly { readonly name: string; readonly cls: Element; readonly val: number }[];
	/** Meridian activity scores, each clamped to `[10, 100]`. */
	readonly meridians: readonly { readonly name: string; readonly val: number }[];
	/** Organs flagged by the matched tongue type, with their tongue-map zones. */
	readonly organZones: readonly OrganZoneHit[];
	/** Top qi-pattern descriptions from the matched tongue type (max 2). */
	readonly patterns: readonly string[];
	/** Top lifestyle tips from the matched tongue type (max 2). */
	readonly tips: readonly string[];
	/** Human-readable date string in Dutch locale (e.g. `'7 maart 2026'`). */
	readonly date: string;
}

/**
 * Default element score when the element has no affected organs.
 * Chosen so unaffected elements still render visibly on the radar chart.
 */
const BASE_ELEMENT_VALUE = 38;

/**
 * Additive boost per affected organ sharing this element.
 * Stacks when multiple organs map to the same element (e.g. two Wood organs).
 */
const AFFECTED_ELEMENT_BOOST = 42;

/**
 * Default meridian score when the meridian's organ is unaffected.
 * Lower than {@link BASE_ELEMENT_VALUE} to give elements visual dominance.
 */
const BASE_MERIDIAN_VALUE = 32;

/**
 * Additive boost applied when a meridian's organ is in the affected set.
 * Only applied once per meridian (no stacking).
 */
const AFFECTED_MERIDIAN_BOOST = 50;

/**
 * Compute Five-Element (Wu Xing) scores from affected organs.
 *
 * Each element starts at {@link BASE_ELEMENT_VALUE} and receives
 * {@link AFFECTED_ELEMENT_BOOST} for every organ that maps to it
 * via {@link ORGAN_ELEMENT}. Result is clamped to `[10, 100]`.
 *
 * @param affectedOrgans - Organs flagged by the matched tongue type.
 * @returns Scored element array matching {@link ELEMENTS} order.
 */
function deriveElements(affectedOrgans: readonly OrganName[]): readonly { name: string; cls: Element; val: number }[] {
	const boosts = new Map<Element, number>();
	for (const organ of affectedOrgans) {
		const element = ORGAN_ELEMENT[organ];
		boosts.set(element, (boosts.get(element) ?? 0) + AFFECTED_ELEMENT_BOOST);
	}

	return ELEMENTS.map((element) => ({
		name: element.name,
		cls: element.cls,
		val: clamp(BASE_ELEMENT_VALUE + (boosts.get(element.cls) ?? 0), 10, 100),
	}));
}

/**
 * Compute meridian activity scores from affected organs.
 *
 * Meridian names correspond 1:1 to organ names. Each starts at
 * {@link BASE_MERIDIAN_VALUE} and gets {@link AFFECTED_MERIDIAN_BOOST}
 * if its organ is in the affected set. Clamped to `[10, 100]`.
 *
 * @param affectedOrgans - Organs flagged by the matched tongue type.
 * @returns Scored meridian array matching {@link MERIDIANS} order.
 */
function deriveMeridians(affectedOrgans: readonly OrganName[]): readonly { name: string; val: number }[] {
	const affectedMeridians: ReadonlySet<string> = new Set(affectedOrgans);

	return MERIDIANS.map((name) => ({
		name,
		val: clamp(
			BASE_MERIDIAN_VALUE + (affectedMeridians.has(name) ? AFFECTED_MERIDIAN_BOOST : 0),
			10,
			100,
		),
	}));
}

/**
 * Take the first N items from an array.
 *
 * @param items - Source array.
 * @param limit - Maximum number of items to return.
 * @returns Slice of at most `limit` items from the front.
 */
function topItems(items: readonly string[], limit: number): readonly string[] {
	return items.slice(0, limit);
}

/**
 * Build a complete {@link Diagnosis} from a color classification result.
 *
 * Derives Five-Element scores, meridian activity, organ-zone hits,
 * top qi-patterns, and lifestyle tips. Date is formatted in Dutch locale.
 *
 * @param classification - Output of {@link classifyTongueColor} containing
 *   the matched tongue type, average color, and confidence score.
 * @returns A fully populated {@link Diagnosis} ready for rendering.
 *
 * @example
 * ```ts
 * const correction = applyGrayWorldCorrection(imageData, tongueMask);
 * if (!correction.ok) {
 * 	throw new Error(correction.error.kind);
 * }
 *
 * const classification = classifyTongueColor(correction.value.averageTongueColor);
 * const diagnosis = generateDiagnosis(classification);
 * console.log(diagnosis.type.name, diagnosis.confidence);
 * ```
 */
export function generateDiagnosis(classification: TongueColorClassification): Diagnosis {
	const { matchedType, averageColor, confidence } = classification;

	const elements = deriveElements(matchedType.affectedOrgans);
	const meridians = deriveMeridians(matchedType.affectedOrgans);

	const organZones: OrganZoneHit[] = matchedType.affectedOrgans.map((organ) => ({
		organ,
		zone: ZONE_LABEL[ORGAN_ZONE[organ]],
	}));

	const patterns = topItems(matchedType.qiPatterns, 2);
	const tips = topItems(matchedType.advice, 2);

	const date = new Date().toLocaleDateString('nl-NL', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});

	return {
		type: matchedType,
		confidence,
		displayConfidence: computeDisplayConfidence(classification),
		observedColor: averageColor,
		elements,
		meridians,
		organZones,
		patterns,
		tips,
		date,
	};
}
