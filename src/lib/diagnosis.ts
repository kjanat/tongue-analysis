import {
	type Element,
	ELEMENTS,
	MERIDIANS,
	ORGAN_ELEMENT,
	ORGAN_ZONE,
	type OrganName,
	TONGUE_TYPES,
	type TongueType,
	ZONE_LABEL,
} from '../data/tongue-types.ts';

// ── Seeded PRNG (mulberry32) ────────────────────────────────────

function mulberry32(seed: number): () => number {
	let s = seed | 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Simple string → 32-bit hash (djb2). */
function hashString(str: string): number {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
	}
	return hash;
}

export interface FileInfo {
	readonly name: string;
	readonly size: number;
	readonly lastModified: number;
}

/** Derive a seed from file metadata so same photo → same result. */
function seedFromFile(file: FileInfo): number {
	return hashString(`${file.name}:${String(file.size)}:${String(file.lastModified)}`);
}

// ── Seeded helpers ──────────────────────────────────────────────

function makeHelpers(rng: () => number) {
	function rand(min: number, max: number): number {
		return Math.floor(rng() * (max - min + 1)) + min;
	}

	function pick<T>(arr: readonly T[]): T {
		const item = arr[Math.floor(rng() * arr.length)];
		if (item === undefined) throw new Error('pick from empty array');
		return item;
	}

	/** Pick `n` unique items from `arr`. */
	function pickN<T>(arr: readonly T[], n: number): T[] {
		const pool = [...arr];
		const result: T[] = [];
		for (let i = 0; i < Math.min(n, pool.length); i++) {
			const idx = Math.floor(rng() * pool.length);
			const item = pool[idx];
			if (item === undefined) throw new Error('pickN index out of bounds');
			result.push(item);
			pool.splice(idx, 1);
		}
		return result;
	}

	return { rand, pick, pickN };
}

// ── Element / meridian derivation ───────────────────────────────

const BASE_ELEMENT_VALUE = 55;
const AFFECTED_BOOST = 30;

/**
 * Derive five-element balance from affected organs.
 *
 * Affected elements get boosted; others stay near baseline + jitter.
 */
function deriveElements(
	affectedOrgans: readonly OrganName[],
	jitter: (base: number) => number,
): readonly { name: string; cls: Element; val: number }[] {
	const boosts = new Map<Element, number>();
	for (const organ of affectedOrgans) {
		const el = ORGAN_ELEMENT[organ];
		boosts.set(el, (boosts.get(el) ?? 0) + AFFECTED_BOOST);
	}
	return ELEMENTS.map((e) => ({
		name: e.name,
		cls: e.cls,
		val: Math.min(100, jitter(BASE_ELEMENT_VALUE + (boosts.get(e.cls) ?? 0))),
	}));
}

const BASE_MERIDIAN_VALUE = 45;
const MERIDIAN_BOOST = 35;

/** Derive meridian activity from affected organs. */
function deriveMeridians(
	affectedOrgans: readonly OrganName[],
	jitter: (base: number) => number,
): readonly { name: string; val: number }[] {
	const affected: ReadonlySet<string> = new Set(affectedOrgans);
	return MERIDIANS.map((m) => ({
		name: m,
		val: Math.min(
			100,
			jitter(BASE_MERIDIAN_VALUE + (affected.has(m) ? MERIDIAN_BOOST : 0)),
		),
	}));
}

// ── Diagnosis result ────────────────────────────────────────────

export interface OrganZoneHit {
	readonly organ: OrganName;
	readonly zone: string;
}

export interface Diagnosis {
	readonly type: TongueType;
	readonly elements: readonly { readonly name: string; readonly cls: Element; readonly val: number }[];
	readonly meridians: readonly { readonly name: string; readonly val: number }[];
	readonly organZones: readonly OrganZoneHit[];
	readonly patterns: readonly string[];
	readonly tips: readonly string[];
	readonly date: string;
}

// ── Weighted random type selection ──────────────────────────────

function selectType(rng: () => number): TongueType {
	const totalWeight = TONGUE_TYPES.reduce((sum, t) => sum + t.weight, 0);
	let roll = rng() * totalWeight;
	for (const t of TONGUE_TYPES) {
		roll -= t.weight;
		if (roll < 0) return t;
	}
	const fallback = TONGUE_TYPES[TONGUE_TYPES.length - 1];
	if (fallback === undefined) throw new Error('TONGUE_TYPES is empty');
	return fallback;
}

// ── Main generator ──────────────────────────────────────────────

export function generateDiagnosis(file: FileInfo): Diagnosis {
	const seed = seedFromFile(file);
	const rng = mulberry32(seed);
	const { rand, pickN } = makeHelpers(rng);

	const type = selectType(rng);

	const jitter = (base: number) => Math.max(10, Math.min(100, base + rand(-8, 8)));

	const elements = deriveElements(type.affectedOrgans, jitter);
	const meridians = deriveMeridians(type.affectedOrgans, jitter);

	const organZones: OrganZoneHit[] = type.affectedOrgans.map((organ) => ({
		organ,
		zone: ZONE_LABEL[ORGAN_ZONE[organ]],
	}));

	const patterns = pickN(type.qiPatterns, 2);
	const tips = pickN(type.advice, 2);

	const date = new Date().toLocaleDateString('nl-NL', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});

	return { type, elements, meridians, organZones, patterns, tips, date };
}
