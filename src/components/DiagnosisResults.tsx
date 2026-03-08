/**
 * @module Renders a complete TCM tongue diagnosis report.
 * Displays observed color, tongue type, five-element balance, meridian activity,
 * organ zones, pattern recognition, and lifestyle recommendations.
 */

import { clampChannel } from '$lib/color-correction.ts';
import type { RgbColor } from '$lib/color-correction.ts';
import type { Diagnosis } from '$lib/diagnosis.ts';

/**
 * Props for {@link DiagnosisResults}.
 */
interface DiagnosisResultsProps {
	/** The full diagnosis produced by the analysis pipeline. */
	readonly diagnosis: Diagnosis;
	/** Callback to reset the app back to the upload phase. */
	readonly onRestart: () => void;
}

/**
 * Clamp all three channels of an {@link RgbColor} to the 0-255 integer range.
 * Prevents invalid CSS `rgb()` values from pipeline rounding artifacts.
 *
 * @param color - Potentially out-of-range RGB color from the pipeline.
 * @returns Clamped copy safe for CSS rendering.
 */
function clampColor(color: RgbColor): RgbColor {
	return {
		r: clampChannel(color.r),
		g: clampChannel(color.g),
		b: clampChannel(color.b),
	};
}

/**
 * Full diagnosis results panel.
 * Sections: header (tongue type), summary, visual observation (color swatch + attributes),
 * five-element badges, meridian bar chart, organ zones, TCM patterns, and recommendations.
 *
 * @param props - {@link DiagnosisResultsProps}
 * @returns Results UI with a "new analysis" restart button.
 *
 * @example
 * ```tsx
 * <DiagnosisResults diagnosis={diagnosis} onRestart={() => setPhase({ kind: 'upload' })} />
 * ```
 */
export default function DiagnosisResults(
	{ diagnosis, onRestart }: DiagnosisResultsProps,
) {
	const { type, elements, meridians, organZones, patterns, tips, date } = diagnosis;
	const confidence = Math.min(1, Math.max(0, diagnosis.confidence));
	const observedColor = clampColor(diagnosis.observedColor);

	return (
		<>
			<div className='results' aria-live='polite'>
				{/* Header with type name */}
				<div className='results-header'>
					<h2 lang='zh'>診斷結果</h2>
					<div className='diagnosis-name'>
						<span lang='zh'>{type.nameZh}</span> — {type.name}
					</div>
					<div className='diagnosis-date'>Analyseresultaat — {date}</div>
				</div>

				{/* Summary */}
				<div className='result-card'>
					<p className='summary'>{type.summary}</p>
					{import.meta.env.VITE_DEBUG_OVERLAY === 'true' && (
						<p className='result-card-debug'>
							<strong>Detectiebetrouwbaarheid:</strong> {Math.round(confidence * 100)}%
						</p>
					)}
				</div>

				{/* Visual observation */}
				<div className='result-card'>
					<h3>Visuele Observatie</h3>
					<div className='detected-color'>
						<span
							className='detected-color-swatch'
							aria-hidden='true'
							style={{
								backgroundColor: `rgb(${String(observedColor.r)} ${String(observedColor.g)} ${
									String(observedColor.b)
								})`,
							}}
						/>
						<span>
							Gemeten kleur: rgb({String(observedColor.r)}, {String(observedColor.g)}, {String(observedColor.b)})
						</span>
					</div>
					<p>
						<strong>Kleur:</strong> {type.color.label}
						<br />
						<strong>Beslag:</strong> {type.coating}
						<br />
						<strong>Vorm:</strong> {type.shape}
						<br />
						<strong>Vochtigheid:</strong> {type.moisture}
					</p>
					{type.symptoms.length > 0 && (
						<p className='result-card-spaced'>
							<strong>Symptomen:</strong> {type.symptoms.join(', ')}
						</p>
					)}
				</div>

				{/* Five-element balance */}
				<div className='result-card'>
					<h3>Vijf-Elementenbalans</h3>
					<div className='element-badges'>
						{elements.map((e) => (
							<span key={e.cls} className='element-badge' data-element={e.cls}>
								{e.name} {e.val}%
							</span>
						))}
					</div>
				</div>

				{/* Meridian activity */}
				<div className='result-card'>
					<h3>Meridiaan-Activiteit</h3>
					<div className='meridian-chart'>
						{meridians.map((m) => (
							<div key={m.name} className='meridian-item'>
								<div className='meridian-bar'>
									<div
										className='meridian-fill'
										style={{ transform: `scaleY(${String(m.val / 100)})` }}
									/>
								</div>
								<div className='meridian-label'>
									{m.name}
									<span className='visually-hidden'>{String(m.val)}%</span>
								</div>
							</div>
						))}
					</div>
				</div>

				{/* Organ zones */}
				{organZones.length > 0 && (
					<div className='result-card'>
						<h3>Orgaanzones</h3>
						<p>
							{organZones.map((o, i) => (
								<span key={o.organ}>
									{i > 0 && <br />}
									De <strong>{o.zone}</strong> toont activiteit gerelateerd aan <strong>{o.organ}</strong>.
								</span>
							))}
						</p>
					</div>
				)}

				{/* TCM patterns */}
				<div className='result-card'>
					<h3>TCM-Patroonherkenning</h3>
					<ul>
						{patterns.map((p, i) => <li key={`${String(i)}-${p}`}>{p}</li>)}
					</ul>
				</div>

				{/* Recommendations */}
				<div className='result-card'>
					<h3>Aanbevelingen</h3>
					<ul>
						{tips.map((t, i) => <li key={`${String(i)}-${t}`}>{t}</li>)}
					</ul>
				</div>
			</div>

			<button type='button' className='restart-btn' onClick={onRestart}>
				<span aria-hidden='true'>&#8635;</span>Nieuwe analyse
			</button>
		</>
	);
}
