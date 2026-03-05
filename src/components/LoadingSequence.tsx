import type { AnalysisStep } from '../lib/pipeline.ts';

const STEPS: readonly { readonly step: AnalysisStep; readonly label: string }[] = [
	{ step: 'loading_image', label: 'Foto laden' },
	{ step: 'loading_model', label: 'Model initialiseren' },
	{ step: 'detecting_mouth', label: 'Mondregio detecteren' },
	{ step: 'segmenting_tongue', label: 'Tong segmenteren' },
	{ step: 'correcting_color', label: 'Kleur normaliseren' },
	{ step: 'classifying_color', label: 'Tongkleur classificeren' },
	{ step: 'building_diagnosis', label: 'Diagnose opstellen' },
] as const;

type StepStatus = 'pending' | 'active' | 'done';

interface LoadingSequenceProps {
	readonly step: AnalysisStep;
}

function activeStepIndex(step: AnalysisStep): number {
	const index = STEPS.findIndex((entry) => entry.step === step);
	return index === -1 ? 0 : index;
}

export default function LoadingSequence({ step }: LoadingSequenceProps) {
	const index = activeStepIndex(step);
	const progress = ((index + 1) / STEPS.length) * 100;

	return (
		<div className='loading'>
			<div className='loading-text'>Analyse loopt...</div>
			<div className='loading-steps'>
				{STEPS.map((entry, i) => {
					const status: StepStatus = i < index
						? 'done'
						: i === index
						? 'active'
						: 'pending';

					return (
						<div key={entry.step} className='loading-step' data-status={status}>
							{entry.label}
						</div>
					);
				})}
			</div>
			<div className='progress-bar'>
				<div
					className='progress-fill'
					style={{ width: `${String(progress)}%` }}
				/>
			</div>
		</div>
	);
}
