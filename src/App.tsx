import { useCallback, useEffect, useRef, useState } from 'react';
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

// ── Session persistence ─────────────────────────────────────

const SESSION_KEY = 'tongue:fileInfo';

function isFileInfo(value: unknown): value is FileInfo {
	if (typeof value !== 'object' || value === null) return false;
	if (!('name' in value) || !('size' in value) || !('lastModified' in value)) return false;
	return typeof value.name === 'string' && typeof value.size === 'number' && typeof value.lastModified === 'number';
}

function loadSavedPhase(): Phase {
	try {
		const raw = sessionStorage.getItem(SESSION_KEY);
		if (raw === null) return INITIAL;
		const parsed: unknown = JSON.parse(raw);
		if (!isFileInfo(parsed)) return INITIAL;
		return { kind: 'results', diagnosis: generateDiagnosis(parsed) };
	} catch {
		return INITIAL;
	}
}

// ─────────────────────────────────────────────────────────────

export default function App() {
	const [phase, setPhase] = useState<Phase>(loadSavedPhase);
	const objectUrlRef = useRef<string | null>(null);
	const fileInfoRef = useRef<FileInfo | null>(null);

	// Revoke previous object URL when leaving preview/loading phases
	useEffect(() => {
		const prev = objectUrlRef.current;
		if (phase.kind === 'preview' || phase.kind === 'loading') {
			objectUrlRef.current = phase.imageUrl;
		} else if (prev !== null) {
			URL.revokeObjectURL(prev);
			objectUrlRef.current = null;
		}
	}, [phase]);

	// Persist fileInfo to sessionStorage when entering results
	useEffect(() => {
		if (phase.kind === 'results' && fileInfoRef.current !== null) {
			try {
				sessionStorage.setItem(SESSION_KEY, JSON.stringify(fileInfoRef.current));
			} catch { /* storage unavailable */ }
		}
	}, [phase]);

	const handleFileSelected = useCallback(
		(file: File, imageUrl: string) => {
			const fileInfo: FileInfo = {
				name: file.name,
				size: file.size,
				lastModified: file.lastModified,
			};
			fileInfoRef.current = fileInfo;
			setPhase({ kind: 'preview', imageUrl, fileInfo });
		},
		[],
	);

	const handleAnalyze = useCallback(() => {
		setPhase((prev) => {
			if (prev.kind !== 'preview') return prev;
			return { kind: 'loading', imageUrl: prev.imageUrl, fileInfo: prev.fileInfo };
		});
	}, []);

	const handleLoadingComplete = useCallback(() => {
		setPhase((prev) => {
			if (prev.kind !== 'loading') return prev;
			return { kind: 'results', diagnosis: generateDiagnosis(prev.fileInfo) };
		});
	}, []);

	const handleRestart = useCallback(() => {
		setPhase(INITIAL);
		fileInfoRef.current = null;
		try {
			sessionStorage.removeItem(SESSION_KEY);
		} catch { /* storage unavailable */ }
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
