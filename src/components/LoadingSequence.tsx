import { ANALYSIS_STEPS } from '../lib/pipeline.ts';
import type { AnalysisStep } from '../lib/pipeline.ts';

type StepStatus = 'pending' | 'active' | 'done';

interface LoadingSequenceProps {
	readonly step: AnalysisStep;
}

function activeStepIndex(step: AnalysisStep): number {
	const index = ANALYSIS_STEPS.findIndex((entry) => entry.step === step);
	return index === -1 ? 0 : index;
}

export default function LoadingSequence({ step }: LoadingSequenceProps) {
	const index = activeStepIndex(step);
	const progress = ((index + 1) / ANALYSIS_STEPS.length) * 100;

	return (
		<div className='loading'>
			<div className='loading-text'>Analyse loopt...</div>
			<div className='loading-steps'>
				{ANALYSIS_STEPS.map((entry, i) => {
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
