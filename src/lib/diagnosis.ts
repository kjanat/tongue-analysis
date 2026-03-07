import {
	type Element,
	ELEMENTS,
	MERIDIANS,
	ORGAN_ELEMENT,
	ORGAN_ZONE,
	type OrganName,
	type TongueType,
	ZONE_LABEL,
} from '../data/tongue-types.ts';
import type { TongueColorClassification } from './color-classification.ts';
import type { RgbColor } from './color-correction.ts';

export interface OrganZoneHit {
	readonly organ: OrganName;
	readonly zone: string;
}

export interface Diagnosis {
	readonly type: TongueType;
	readonly confidence: number;
	readonly observedColor: RgbColor;
	readonly elements: readonly { readonly name: string; readonly cls: Element; readonly val: number }[];
	readonly meridians: readonly { readonly name: string; readonly val: number }[];
	readonly organZones: readonly OrganZoneHit[];
	readonly patterns: readonly string[];
	readonly tips: readonly string[];
	readonly date: string;
}

const BASE_ELEMENT_VALUE = 38;
const AFFECTED_ELEMENT_BOOST = 42;

const BASE_MERIDIAN_VALUE = 32;
const AFFECTED_MERIDIAN_BOOST = 50;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

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

function topItems(items: readonly string[], limit: number): readonly string[] {
	return items.slice(0, limit);
}

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
		observedColor: averageColor,
		elements,
		meridians,
		organZones,
		patterns,
		tips,
		date,
	};
}
