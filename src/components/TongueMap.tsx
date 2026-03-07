/**
 * @module Inline SVG tongue organ-zone map based on TCM tongue diagnosis.
 * Drawn from the viewer/practitioner perspective (looking at patient's tongue):
 * Galblaas (viewer L / patient R), Lever (viewer R / patient L).
 *
 * Zones top-to-bottom: Nier+Blaas (root), Lever+Milt/Maag+Galblaas (middle),
 * Longen (above tip), Hart (tip).
 */

import { useId } from 'react';

/**
 * SVG path data for the organic tongue outline.
 * Tip at bottom (y ~308), root at top (y ~16). Fits within a 260x325 viewBox.
 * Hand-tuned cubic Bezier curves to approximate a natural tongue silhouette.
 */
const OUTLINE =
	'M130 308 C98 316 58 298 42 258 C28 222 22 190 22 160 C22 122 28 86 44 62 C56 42 78 28 106 22 Q130 16 154 22 C182 28 204 42 216 62 C232 86 238 122 238 160 C238 190 232 222 218 258 C202 298 162 316 130 308Z';

/**
 * SVG tongue organ-zone diagram for the {@link Guide} component.
 * Renders a labeled tongue silhouette with zone dividers, a radial gradient,
 * and organ labels positioned per TCM conventions.
 *
 * @returns An accessible SVG wrapped in a container div.
 *
 * @example
 * ```tsx
 * <TongueMap />
 * ```
 */
export default function TongueMap() {
	const id = useId();
	const clipId = `${id}-clip`;
	const gradId = `${id}-grad`;
	const titleId = `${id}-title`;
	const descId = `${id}-desc`;

	return (
		<div className='tongue-map-container'>
			<svg
				viewBox='0 0 260 325'
				role='img'
				aria-labelledby={titleId}
				aria-describedby={descId}
			>
				<title id={titleId}>TCM Tong-orgaanzone kaart</title>
				<desc id={descId}>
					Schematische tong met orgaanzones volgens de Traditionele Chinese Geneeskunde. Vanuit het perspectief van de
					kijker: Galblaas links, Lever rechts, Hart aan de punt, Longen daarboven, Milt en Maag in het midden, Nieren
					achterin aan de zijkanten, Blaas centraal achterin.
				</desc>

				<defs>
					<clipPath id={clipId}>
						<path d={OUTLINE} />
					</clipPath>
					<radialGradient id={gradId} cx='50%' cy='45%' r='55%'>
						<stop offset='0%' stopColor='#f0b0ac' />
						<stop offset='100%' stopColor='#e09090' />
					</radialGradient>
				</defs>

				{/* Tongue body */}
				<path d={OUTLINE} fill={`url(#${gradId})`} stroke='#a06060' strokeWidth='2.5' />

				{/* Zone dividers — clipped to tongue outline */}
				<g clipPath={`url(#${clipId})`} fill='none' stroke='#804050' strokeWidth='1.8'>
					{/* Hart | Longen */}
					<path d='M0 270 Q130 263 260 270' />
					{/* Longen | Middle */}
					<path d='M0 218 Q130 211 260 218' />
					{/* Middle | Back */}
					<path d='M0 128 Q130 121 260 128' />
					{/* Left column (middle + back only) */}
					<path d='M83 220 C84 170 88 90 106 16' />
					{/* Right column (middle + back only) */}
					<path d='M177 220 C176 170 172 90 154 16' />
				</g>

				{/* Subtle median groove */}
				<line
					x1='130'
					y1='268'
					x2='130'
					y2='40'
					stroke='#c08888'
					strokeWidth='0.6'
					opacity='0.3'
					clipPath={`url(#${clipId})`}
				/>

				{/* Labels */}
				<g
					fontFamily='Inter, sans-serif'
					fontWeight='bold'
					fontStyle='italic'
					textAnchor='middle'
					fill='#2a1010'
				>
					<text x='130' y='295' fontSize='15'>Hart</text>
					<text x='130' y='249' fontSize='14'>Longen</text>
					<text x='54' y='170' fontSize='12'>Gal-</text>
					<text x='54' y='184' fontSize='12'>blaas</text>
					<text x='130' y='168' fontSize='14'>Milt</text>
					<text x='130' y='186' fontSize='14'>Maag</text>
					<text x='206' y='180' fontSize='14'>Lever</text>
					<text x='56' y='80' fontSize='13'>Nier</text>
					<text x='130' y='80' fontSize='14'>Blaas</text>
					<text x='204' y='80' fontSize='13'>Nier</text>
				</g>
			</svg>
		</div>
	);
}
