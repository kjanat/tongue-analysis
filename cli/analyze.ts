#!/usr/bin/env -S xvfb-run -a node

// ── ImageData polyfill for non-browser runtimes ────────────────
//
// segmentTongue and applyGrayWorldCorrection consume/construct ImageData.
// Bun doesn't provide it. This shim satisfies both read and construction
// patterns used in src/lib/. It's a data container — not analysis logic.

if (typeof globalThis.ImageData === 'undefined') {
	// @ts-expect-error — assigning to a read-only global on purpose
	globalThis.ImageData = class ImageData {
		readonly data: Uint8ClampedArray;
		readonly width: number;
		readonly height: number;
		readonly colorSpace: PredefinedColorSpace = 'srgb';

		constructor(data: Uint8ClampedArray, width: number, height: number) {
			this.data = data;
			this.width = width;
			this.height = height;
		}
	};
}

// ── Imports (after polyfill) ───────────────────────────────────

import sharp from 'sharp';
import { TONGUE_TYPES } from '../src/data/tongue-types.ts';
import { classifyTongueColor } from '../src/lib/color-classification.ts';
import { applyGrayWorldCorrection, type RgbColor } from '../src/lib/color-correction.ts';
import { generateDiagnosis } from '../src/lib/diagnosis.ts';
import { segmentTongue } from '../src/lib/tongue-segmentation.ts';

// ── CLI argument parsing ───────────────────────────────────────

const imagePath = process.argv[2];
if (imagePath === undefined || imagePath.startsWith('-')) {
	console.error('Usage: tongue-analysis <path-to-image>');
	process.exit(1);
}

// ── Image loading (CLI I/O) ────────────────────────────────────

async function loadImagePixels(filePath: string): Promise<{
	readonly data: Uint8ClampedArray;
	readonly width: number;
	readonly height: number;
}> {
	const image = sharp(filePath).removeAlpha().ensureAlpha();
	const { width, height } = await image.metadata();

	if (width === undefined || height === undefined || width === 0 || height === 0) {
		throw new Error(`Invalid image dimensions: ${String(width)}x${String(height)}`);
	}

	const rawBuffer = await image.raw().toBuffer();

	return {
		data: new Uint8ClampedArray(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength),
		width,
		height,
	};
}

// ── Output formatting (CLI presentation) ───────────────────────

function formatRgb(color: RgbColor): string {
	return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

function printSection(title: string): void {
	console.log(`\n${'='.repeat(60)}`);
	console.log(` ${title}`);
	console.log('='.repeat(60));
}

// ── Main ───────────────────────────────────────────────────────

const pixels = await loadImagePixels(imagePath);
const imageData = new ImageData(
	pixels.data as Uint8ClampedArray<ArrayBuffer>,
	pixels.width,
	pixels.height,
);

// Step 1: Segment tongue from image
const segmentResult = segmentTongue(imageData);
if (!segmentResult.ok) {
	console.error(`Tongue segmentation failed: ${segmentResult.error.kind}`);
	if (segmentResult.error.kind === 'insufficient_pixels') {
		console.error(
			`  found ${String(segmentResult.error.count)} pixels, need ${String(segmentResult.error.minimumRequired)}`,
		);
	}
	if (segmentResult.error.kind === 'multiple_regions_detected') {
		console.error(
			`  found ${String(segmentResult.error.componentCount)} regions, largest covers ${
				(
					segmentResult.error.largestComponentRatio * 100
				).toFixed(1)
			}%`,
		);
	}
	process.exit(2);
}

const tongueMask = segmentResult.value;
console.log(
	`Segmented ${String(tongueMask.pixelCount)} tongue pixels from ${String(pixels.width)}x${
		String(pixels.height)
	} image`,
);

// Step 2: Gray-world color correction
const correctionResult = applyGrayWorldCorrection(imageData, tongueMask);
if (!correctionResult.ok) {
	console.error(`Color correction failed: ${correctionResult.error.kind}`);
	process.exit(2);
}

const averageColor = correctionResult.value.averageTongueColor;
console.log(`Average tongue color: ${formatRgb(averageColor)}`);

// Step 3: Classify tongue color
const classification = classifyTongueColor(averageColor, TONGUE_TYPES);

// Step 4: Generate diagnosis
const diagnosis = generateDiagnosis(classification);

// ── Print results ──────────────────────────────────────────────

printSection('CLASSIFICATION');
console.log(`  Matched type:  ${diagnosis.type.name} (${diagnosis.type.nameZh})`);
console.log(`  Type color:    ${diagnosis.type.color.label} ${diagnosis.type.color.hex}`);
console.log(`  Confidence:    ${(diagnosis.confidence * 100).toFixed(1)}%`);
console.log(`  Observed:      ${formatRgb(diagnosis.observedColor)}`);

printSection('RANKINGS');
for (const match of classification.rankings) {
	const bar = '#'.repeat(Math.round(match.score * 30));
	const marker = match.type.id === classification.matchedType.id ? ' <--' : '';
	console.log(
		`  ${match.type.name.padEnd(20)} d=${match.distance.toFixed(4)}  score=${match.score.toFixed(3)}  ${bar}${marker}`,
	);
}

printSection('OKLCH');
console.log(
	`  L=${classification.oklch.l.toFixed(4)}  C=${classification.oklch.c.toFixed(4)}  h=${
		classification.oklch.h.toFixed(1)
	}`,
);

printSection('DIAGNOSIS');
console.log(`  Summary:  ${diagnosis.type.summary}`);

if (diagnosis.type.symptoms.length > 0) {
	console.log(`  Symptoms: ${diagnosis.type.symptoms.join(', ')}`);
}

console.log(`  Coating:  ${diagnosis.type.coating}`);
console.log(`  Shape:    ${diagnosis.type.shape}`);
console.log(`  Moisture: ${diagnosis.type.moisture}`);

if (diagnosis.organZones.length > 0) {
	printSection('AFFECTED ORGANS & ZONES');
	for (const oz of diagnosis.organZones) {
		console.log(`  ${oz.organ.padEnd(12)} -> ${oz.zone}`);
	}
}

if (diagnosis.elements.length > 0) {
	printSection('FIVE ELEMENTS');
	for (const el of diagnosis.elements) {
		const bar = '#'.repeat(Math.round(el.val / 3));
		console.log(`  ${el.name.padEnd(14)} ${String(el.val).padStart(3)}  ${bar}`);
	}
}

if (diagnosis.meridians.length > 0) {
	printSection('MERIDIANS');
	for (const m of diagnosis.meridians) {
		const bar = '#'.repeat(Math.round(m.val / 3));
		console.log(`  ${m.name.padEnd(12)} ${String(m.val).padStart(3)}  ${bar}`);
	}
}

if (diagnosis.patterns.length > 0) {
	printSection('QI PATTERNS');
	for (const p of diagnosis.patterns) {
		console.log(`  - ${p}`);
	}
}

if (diagnosis.tips.length > 0) {
	printSection('ADVICE');
	for (const t of diagnosis.tips) {
		console.log(`  - ${t}`);
	}
}

console.log(`\nDate: ${diagnosis.date}`);
