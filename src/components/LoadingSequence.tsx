import { useEffect, useState } from 'react';

const STEPS = [
	'Tonglichaam detecteren',
	'Kleur & coating analyseren',
	'Meridianen in kaart brengen',
	'Vijf-elementenbalans berekenen',
	'TCM-diagnose genereren',
] as const;

interface LoadingSequenceProps {
	readonly onComplete: () => void;
}

function rand(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

type StepStatus = 'pending' | 'active' | 'done';

export default function LoadingSequence(
	{ onComplete }: LoadingSequenceProps,
) {
	const [stepIndex, setStepIndex] = useState(0);

	useEffect(() => {
		if (stepIndex > STEPS.length) return;

		if (stepIndex === STEPS.length) {
			const id = setTimeout(onComplete, 600);
			return () => { clearTimeout(id); };
		}

		const id = setTimeout(
			() => { setStepIndex((i) => i + 1); },
			rand(600, 1800),
		);
		return () => { clearTimeout(id); };
	}, [stepIndex, onComplete]);

	const progress = (stepIndex / STEPS.length) * 100;

	return (
		<div className='loading'>
			<div className='loading-text'>Qi-patroonherkenning actief...</div>
			<div className='loading-steps'>
				{STEPS.map((label, i) => {
					let status: StepStatus = 'pending';
					if (i < stepIndex) status = 'done';
					else if (i === stepIndex) status = 'active';
					return (
						<div key={label} className='loading-step' data-status={status}>
							{label}
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
