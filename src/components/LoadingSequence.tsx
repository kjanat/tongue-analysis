import { ANALYSIS_STEP_LABELS } from '../lib/pipeline.ts';
import type { AnalysisStep } from '../lib/pipeline.ts';

const STEP_ORDER: readonly AnalysisStep[] = [
	'loading_image',
	'loading_model',
	'detecting_mouth',
	'segmenting_tongue',
	'correcting_color',
	'classifying_color',
	'building_diagnosis',
];

type StepStatus = 'pending' | 'active' | 'done';

interface LoadingSequenceProps {
	readonly step: AnalysisStep;
}

function activeStepIndex(step: AnalysisStep): number {
	const index = STEP_ORDER.indexOf(step);
	return index === -1 ? 0 : index;
}

export default function LoadingSequence({ step }: LoadingSequenceProps) {
	const index = activeStepIndex(step);
	const progress = ((index + 1) / STEP_ORDER.length) * 100;

	return (
		<div className='loading'>
			<div className='loading-text'>Analyse loopt...</div>
			<div className='loading-steps'>
				{STEP_ORDER.map((stepKey, i) => {
					const status: StepStatus = i < index
						? 'done'
						: i === index
						? 'active'
						: 'pending';

					return (
						<div key={stepKey} className='loading-step' data-status={status}>
							{ANALYSIS_STEP_LABELS[stepKey]}
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
