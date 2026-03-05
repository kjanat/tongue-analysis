import type { Diagnosis } from '../lib/diagnosis.ts';

interface DiagnosisResultsProps {
	readonly diagnosis: Diagnosis;
	readonly onRestart: () => void;
}

export default function DiagnosisResults(
	{ diagnosis, onRestart }: DiagnosisResultsProps,
) {
	const { type, confidence, observedColor, elements, meridians, organZones, patterns, tips, date } = diagnosis;

	return (
		<>
			<div className='results' aria-live='polite' aria-atomic='true'>
				{/* Header with type name */}
				<div className='results-header fade-in'>
					<h2 lang='zh'>診斷結果</h2>
					<div className='diagnosis-name'>
						<span lang='zh'>{type.nameZh}</span> — {type.name}
					</div>
					<div className='diagnosis-date'>Analyseresultaat — {date}</div>
				</div>

				{/* Summary */}
				<div className='result-card fade-in'>
					<p className='summary'>{type.summary}</p>
					<p style={{ marginTop: '0.6rem' }}>
						<strong>Detectiebetrouwbaarheid:</strong> {Math.round(confidence * 100)}%
					</p>
				</div>

				{/* Visual observation */}
				<div className='result-card fade-in'>
					<h3>Visuele Observatie</h3>
					<div className='detected-color'>
						<span
							className='detected-color-swatch'
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
						<p style={{ marginTop: '0.5rem' }}>
							<strong>Symptomen:</strong> {type.symptoms.join(', ')}
						</p>
					)}
				</div>

				{/* Five-element balance */}
				<div className='result-card fade-in'>
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
				<div className='result-card fade-in'>
					<h3>Meridiaan-Activiteit</h3>
					<div className='meridian-chart'>
						{meridians.map((m) => (
							<div key={m.name} className='meridian-item'>
								<div className='meridian-bar'>
									<div
										className='meridian-fill'
										style={{ height: `${String(m.val)}%` }}
									/>
								</div>
								<div className='meridian-label'>{m.name}</div>
							</div>
						))}
					</div>
				</div>

				{/* Organ zones */}
				{organZones.length > 0 && (
					<div className='result-card fade-in'>
						<h3>Orgaanzones</h3>
						<p>
							{organZones.map((o, i) => (
								<span key={o.organ}>
									{i > 0 && <br />}
									De <strong>{o.zone}</strong> toont activiteit gerelateerd aan de <strong>{o.organ}</strong>.
								</span>
							))}
						</p>
					</div>
				)}

				{/* TCM patterns */}
				<div className='result-card fade-in'>
					<h3>TCM-Patroonherkenning</h3>
					{patterns.map((p) => (
						<p key={p} style={{ marginTop: '0.4rem' }}>
							{p}
						</p>
					))}
				</div>

				{/* Recommendations */}
				<div className='result-card fade-in'>
					<h3>Aanbevelingen</h3>
					{tips.map((t) => <p key={t}>&bull; {t}</p>)}
				</div>
			</div>

			<button type='button' className='restart-btn' onClick={onRestart}>
				&#8635; Nieuwe analyse
			</button>
		</>
	);
}
