import { useCallback, useState } from 'react';
import './App.css';
import DiagnosisResults from './components/DiagnosisResults.tsx';
import Guide from './components/Guide.tsx';
import LoadingSequence from './components/LoadingSequence.tsx';
import UploadArea from './components/UploadArea.tsx';
import { type Diagnosis, type FileInfo, generateDiagnosis } from './lib/diagnosis.ts';

// ── Phase state machine ─────────────────────────────────────

type Phase =
	| { readonly kind: 'upload' }
	| { readonly kind: 'preview'; readonly imageUrl: string; readonly fileInfo: FileInfo }
	| { readonly kind: 'loading'; readonly imageUrl: string; readonly fileInfo: FileInfo }
	| { readonly kind: 'results'; readonly diagnosis: Diagnosis };

const INITIAL: Phase = { kind: 'upload' };

// ─────────────────────────────────────────────────────────────

export default function App() {
	const [phase, setPhase] = useState<Phase>(INITIAL);

	const handleFileSelected = useCallback(
		(file: File, imageUrl: string) => {
			const fileInfo: FileInfo = {
				name: file.name,
				size: file.size,
				lastModified: file.lastModified,
			};
			setPhase({ kind: 'preview', imageUrl, fileInfo });
		},
		[],
	);

	const handleAnalyze = useCallback(() => {
		if (phase.kind !== 'preview') return;
		setPhase({ kind: 'loading', imageUrl: phase.imageUrl, fileInfo: phase.fileInfo });
	}, [phase]);

	const handleLoadingComplete = useCallback(() => {
		if (phase.kind !== 'loading') return;
		const diagnosis = generateDiagnosis(phase.fileInfo);
		setPhase({ kind: 'results', diagnosis });
	}, [phase]);

	const handleRestart = useCallback(() => {
		setPhase(INITIAL);
	}, []);

	return (
		<>
			<div className='bg-pattern' />
			<main className='container'>
				<header className='app-header'>
					<div className='chinese-title' lang='zh'>
						舌診
					</div>
					<h1>Tongdiagnose</h1>
					<p className='subtitle'>
						Traditionele Chinese Geneeskunde — AI-analyse
					</p>
				</header>

				{/* Upload phase */}
				{phase.kind === 'upload' && <UploadArea onFileSelected={handleFileSelected} />}

				{/* Preview phase */}
				{phase.kind === 'preview' && (
					<>
						<div className='preview-container'>
							<img src={phase.imageUrl} alt='Tongfoto preview' />
						</div>
						<button
							type='button'
							className='analyze-btn'
							onClick={handleAnalyze}
						>
							Analyseer Tong
						</button>
					</>
				)}

				{/* Loading phase */}
				{phase.kind === 'loading' && <LoadingSequence onComplete={handleLoadingComplete} />}

				{/* Results phase */}
				{phase.kind === 'results' && (
					<DiagnosisResults
						diagnosis={phase.diagnosis}
						onRestart={handleRestart}
					/>
				)}

				{/* Disclaimer — always visible */}
				<div className='disclaimer'>
					⚠️ Dit is een experimentele AI-analyse gebaseerd op principes uit de Traditionele Chinese Geneeskunde.
					Raadpleeg altijd een gekwalificeerde TCM-arts voor een professionele diagnose.
				</div>

				{/* Interactive guide — only after results */}
				{phase.kind === 'results' && <Guide />}
			</main>
		</>
	);
}
