/**
 * @module Stepped progress indicator for the analysis pipeline.
 * Maps the current {@link AnalysisStep} to a visual checklist with a progress bar.
 */

import { ANALYSIS_STEPS } from '../lib/pipeline.ts';
import type { AnalysisStep } from '../lib/pipeline.ts';

/**
 * Visual state of a single step in the loading checklist.
 * - `pending` — not yet reached.
 * - `active` — currently executing.
 * - `done` — completed.
 */
type StepStatus = 'pending' | 'active' | 'done';

/**
 * Props for {@link LoadingSequence}.
 */
interface LoadingSequenceProps {
	/** The pipeline step currently being executed; drives which checklist item is highlighted. */
	readonly step: AnalysisStep;
}

/**
 * Resolve the index of the given step within {@link ANALYSIS_STEPS}.
 * Falls back to 0 if the step is not found (defensive; should not happen in practice).
 *
 * @param step - Current pipeline step identifier.
 * @returns Zero-based index into {@link ANALYSIS_STEPS}.
 */
function activeStepIndex(step: AnalysisStep): number {
	const index = ANALYSIS_STEPS.findIndex((entry) => entry.step === step);
	return index === -1 ? 0 : index;
}

/**
 * Animated progress indicator showing each {@link AnalysisStep} as a checklist item
 * with a continuous progress bar underneath.
 *
 * @param props - {@link LoadingSequenceProps}
 * @returns Loading UI with step list and progress bar.
 *
 * @example
 * ```tsx
 * <LoadingSequence step="correcting_color" />
 * ```
 */
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
			<div
				className='progress-bar'
				role='progressbar'
				aria-valuenow={Math.round(progress)}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-label='Analysevoortgang'
			>
				<div
					className='progress-fill'
					style={{ transform: `scaleX(${String(progress / 100)})` }}
				/>
			</div>
		</div>
	);
}
