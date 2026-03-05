import type { Diagnosis } from '../lib/diagnosis.ts';

interface DiagnosisResultsProps {
	readonly diagnosis: Diagnosis;
	readonly onRestart: () => void;
}

interface RgbColor {
	readonly r: number;
	readonly g: number;
	readonly b: number;
}

function clampChannel(value: number): number {
	return Math.min(255, Math.max(0, Math.round(value)));
}

function clampUnit(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function fallbackColorFromHex(hex: string): RgbColor {
	const sanitized = hex.startsWith('#') ? hex.slice(1) : hex;
	if (sanitized.length !== 6) {
		return { r: 128, g: 128, b: 128 };
	}

	const r = Number.parseInt(sanitized.slice(0, 2), 16);
	const g = Number.parseInt(sanitized.slice(2, 4), 16);
	const b = Number.parseInt(sanitized.slice(4, 6), 16);

	if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
		return { r: 128, g: 128, b: 128 };
	}

	return {
		r: clampChannel(r),
		g: clampChannel(g),
		b: clampChannel(b),
	};
}

function readObservedColor(diagnosis: unknown, fallbackHex: string): RgbColor {
	if (typeof diagnosis !== 'object' || diagnosis === null || !('observedColor' in diagnosis)) {
		return fallbackColorFromHex(fallbackHex);
	}

	const observedColor = diagnosis.observedColor;
	if (typeof observedColor !== 'object' || observedColor === null) {
		return fallbackColorFromHex(fallbackHex);
	}

	if (!('r' in observedColor) || !('g' in observedColor) || !('b' in observedColor)) {
		return fallbackColorFromHex(fallbackHex);
	}

	const r = observedColor.r;
	const g = observedColor.g;
	const b = observedColor.b;
	if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') {
		return fallbackColorFromHex(fallbackHex);
	}

	if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
		return fallbackColorFromHex(fallbackHex);
	}

	return {
		r: clampChannel(r),
		g: clampChannel(g),
		b: clampChannel(b),
	};
}

function readConfidence(diagnosis: unknown): number {
	if (typeof diagnosis !== 'object' || diagnosis === null || !('confidence' in diagnosis)) {
		return 0.5;
	}

	const confidence = diagnosis.confidence;
	if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
		return 0.5;
	}

	return clampUnit(confidence);
}

export default function DiagnosisResults(
	{ diagnosis, onRestart }: DiagnosisResultsProps,
) {
	const { type, elements, meridians, organZones, patterns, tips, date } = diagnosis;
	const confidence = readConfidence(diagnosis);
	const observedColor = readObservedColor(diagnosis, type.color.hex);

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
					{import.meta.env.DEV && (
						<p style={{ marginTop: '0.6rem' }}>
							<strong>Detectiebetrouwbaarheid:</strong> {Math.round(confidence * 100)}%
						</p>
					)}
				</div>

				{/* Visual observation */}
				<div className='result-card fade-in'>
					<h3>Visuele Observatie</h3>
					<div className='detected-color'>
						<span
							className='detected-color-swatch'
							style={{
								backgroundColor: import.meta.env.DEV
									? `rgb(${String(observedColor.r)} ${String(observedColor.g)} ${
										String(observedColor.b)
									})`
									: type.color.hex,
							}}
						/>
						<span>
							{import.meta.env.DEV
								? (
									<>
										Gemeten kleur: rgb({String(observedColor.r)}, {String(observedColor.g)},{' '}
										{String(observedColor.b)})
									</>
								)
								: (
									<>
										Tongtype: <span lang='zh'>{type.nameZh}</span> — {type.name}
									</>
								)}
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
