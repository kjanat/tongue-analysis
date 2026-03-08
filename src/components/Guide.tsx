/**
 * @module Interactive TCM reference guide.
 * Three collapsible sections: the 10 tongue types, the organ-zone diagram ({@link TongueMap}),
 * and the 4 diagnostic axes (color, coating, shape, moisture).
 */

import { useId } from 'react';
import { TONGUE_TYPES } from '../data/tongue-types.ts';
import TongueMap from './TongueMap.tsx';

/**
 * Collapsible reference guide for Traditional Chinese Medicine tongue diagnosis.
 * Renders below the results panel to educate the user on TCM tongue classification.
 * All text is in Dutch.
 *
 * @returns A `<section>` with three `<details>` blocks.
 *
 * @example
 * ```tsx
 * <Guide />
 * ```
 */
export default function Guide() {
	const headingId = useId();

	return (
		<section className='guide' aria-labelledby={headingId}>
			<h2 id={headingId} lang='zh'>舌診指南</h2>

			{/* ── 10 tongue types ─────────────────────────────── */}
			<details>
				<summary>De 10 tongtypen</summary>
				<div className='guide-content'>
					<div className='type-cards'>
						{TONGUE_TYPES.map((t) => (
							<div key={t.id} className='type-card'>
								<div className='type-card-header'>
									<span
										className='type-color-swatch'
										role='img'
										style={{ backgroundColor: t.color.hex }}
										aria-label={`Tongkleur: ${t.color.label}`}
									/>
									<div>
										<span className='type-name'>{t.name}</span>
										<span className='type-name-zh' lang='zh'>
											{t.nameZh}
										</span>
									</div>
								</div>
								<div className='type-card-detail'>
									<strong>Kleur:</strong> {t.color.label} &bull; <strong>Beslag:</strong> {t.coating}
									<br />
									<strong>Vorm:</strong> {t.shape} &bull; <strong>Vocht:</strong> {t.moisture}
								</div>
								{t.symptoms.length > 0 && (
									<div className='type-card-symptoms'>
										{t.symptoms.map((s) => (
											<span key={s} className='symptom-tag'>
												{s}
											</span>
										))}
									</div>
								)}
							</div>
						))}
					</div>
				</div>
			</details>

			{/* ── Organ zone map ──────────────────────────────── */}
			<details>
				<summary>Orgaanzonediagram</summary>
				<div className='guide-content'>
					<TongueMap />
					{/* Accessible text fallback */}
					<ul className='axes-list'>
						<li>
							<strong>Tongpunt:</strong> Hart
						</li>
						<li>
							<strong>Boven de punt:</strong> Longen
						</li>
						<li>
							<strong>Linkerrand:</strong> Lever
						</li>
						<li>
							<strong>Rechterrand:</strong> Galblaas
						</li>
						<li>
							<strong>Centrum:</strong> Milt &amp; Maag
						</li>
						<li>
							<strong>Wortel:</strong> Nieren &amp; Blaas
						</li>
					</ul>
				</div>
			</details>

			{/* ── 4 diagnostic axes ──────────────────────────── */}
			<details>
				<summary>De 4 diagnostische assen</summary>
				<div className='guide-content'>
					<ul className='axes-list'>
						<li>
							<strong>Kleur (色 sè):</strong>{' '}
							Een gezonde tong is lichtroze. Rood duidt op hitte, bleek op tekort (Qi of Bloed), paars op
							bloed-stagnatie.
						</li>
						<li>
							<strong>Beslag (苔 tāi):</strong>{' '}
							Een dun wit laagje is normaal. Dik wit beslag wijst op Damp, geel op Hitte. Geen beslag duidt op
							Yin-tekort.
						</li>
						<li>
							<strong>Vorm (形 xíng):</strong>{' '}
							Gezwollen met tandafdrukken wijst op Milt-Qi-tekort. Dun en smal op Bloed-tekort. Scheurtjes op
							Yin-deficiëntie.
						</li>
						<li>
							<strong>Vochtigheid (津 jīn):</strong>{' '}
							Balans is ideaal. Een natte tong wijst op verstoorde Yang-energie. Een droge tong op te veel hitte
							(Yin-deficiëntie).
						</li>
					</ul>
				</div>
			</details>
		</section>
	);
}
