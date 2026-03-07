/**
 * @module Root application component and state machine.
 * Orchestrates the 5-phase tongue analysis flow: upload, preview, loading, results, error.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import CameraCapture from './components/CameraCapture.tsx';
import DiagnosisResults from './components/DiagnosisResults.tsx';
import Guide from './components/Guide.tsx';
import LoadingSequence from './components/LoadingSequence.tsx';
import UploadArea from './components/UploadArea.tsx';
import { analysisErrorMessage } from './lib/analysis-error-message.ts';
import type { Diagnosis } from './lib/diagnosis.ts';
import { releaseFaceLandmarker } from './lib/face-detection.ts';
import { type AnalysisError, type AnalysisStep, analyzeTongueFromUrl } from './lib/pipeline.ts';
import { withViewTransition } from './lib/view-transition.ts';

/**
 * Discriminated union driving the entire UI state machine.
 * Each variant's `kind` tag determines which section of the UI renders.
 *
 * - **`upload`** — initial state; shows {@link UploadArea} and {@link CameraCapture}.
 * - **`preview`** — user selected an image; shows preview with "Analyse" button.
 *   `imageUrl` is an object URL owned by the component (revoked on phase exit).
 * - **`loading`** — pipeline is running. `analysisId` is a monotonic counter used
 *   to discard stale results when the user retries before the previous run completes.
 *   `step` tracks the current {@link AnalysisStep} for the progress UI.
 * - **`results`** — analysis succeeded; renders {@link DiagnosisResults} and {@link Guide}.
 * - **`error`** — analysis failed; shows the source image, error message, and retry/restart actions.
 */
type Phase =
	| { readonly kind: 'upload' }
	| { readonly kind: 'preview'; readonly imageUrl: string }
	| {
		readonly kind: 'loading';
		readonly imageUrl: string;
		readonly analysisId: number;
		readonly step: AnalysisStep;
	}
	| { readonly kind: 'results'; readonly diagnosis: Diagnosis }
	| { readonly kind: 'error'; readonly imageUrl: string; readonly error: AnalysisError };

/** Sentinel value for the initial upload phase. */
const INITIAL: Phase = { kind: 'upload' };

/**
 * Construct a loading phase with the first pipeline step pre-selected.
 *
 * @param imageUrl - Object URL of the image to analyze.
 * @param analysisId - Monotonic ID to correlate progress callbacks with the active run.
 * @returns A `loading` {@link Phase} variant.
 */
function startLoadingPhase(imageUrl: string, analysisId: number): Phase {
	return {
		kind: 'loading',
		imageUrl,
		analysisId,
		step: 'loading_image',
	};
}

/**
 * Root application component.
 * Manages the {@link Phase} state machine, object URL lifecycle, and analysis pipeline invocation.
 * Renders the appropriate UI section for each phase and wires up all user interactions.
 *
 * @returns The full application UI.
 *
 * @example
 * ```tsx
 * <App />
 * ```
 */
export default function App() {
	const [phase, setPhase] = useState<Phase>(INITIAL);
	const objectUrlRef = useRef<string | null>(null);
	const nextAnalysisIdRef = useRef(0);

	useEffect(() => {
		return () => {
			releaseFaceLandmarker();
		};
	}, []);

	const loadingAnalysisId = phase.kind === 'loading' ? phase.analysisId : null;
	const loadingImageUrl = phase.kind === 'loading' ? phase.imageUrl : null;

	useEffect(() => {
		const previousUrl = objectUrlRef.current;
		if (phase.kind === 'preview' || phase.kind === 'loading' || phase.kind === 'error') {
			objectUrlRef.current = phase.imageUrl;
			return;
		}

		if (previousUrl !== null) {
			URL.revokeObjectURL(previousUrl);
			objectUrlRef.current = null;
		}
	}, [phase]);

	useEffect(() => {
		if (loadingAnalysisId === null || loadingImageUrl === null) return;

		let cancelled = false;

		void (async () => {
			const result = await analyzeTongueFromUrl(loadingImageUrl, {
				onStep: (step) => {
					if (cancelled) return;

					setPhase((previous) => {
						if (previous.kind !== 'loading' || previous.analysisId !== loadingAnalysisId) {
							return previous;
						}

						if (previous.step === step) return previous;

						return {
							...previous,
							step,
						};
					});
				},
			});

			withViewTransition(() => {
				setPhase((previous) => {
					if (previous.kind !== 'loading' || previous.analysisId !== loadingAnalysisId) {
						return previous;
					}

					if (!result.ok) {
						return {
							kind: 'error',
							imageUrl: loadingImageUrl,
							error: result.error,
						};
					}

					return {
						kind: 'results',
						diagnosis: result.value.diagnosis,
					};
				});
			});
		})();

		return () => {
			cancelled = true;
		};
	}, [loadingAnalysisId, loadingImageUrl]);

	const handleImageSelected = useCallback((_file: File, imageUrl: string) => {
		withViewTransition(() => {
			setPhase({ kind: 'preview', imageUrl });
		});
	}, []);

	const handleAnalyze = useCallback(() => {
		withViewTransition(() => {
			setPhase((previous) => {
				if (previous.kind !== 'preview') return previous;
				nextAnalysisIdRef.current += 1;
				return startLoadingPhase(previous.imageUrl, nextAnalysisIdRef.current);
			});
		});
	}, []);

	const handleRetry = useCallback(() => {
		withViewTransition(() => {
			setPhase((previous) => {
				if (previous.kind !== 'error') return previous;
				nextAnalysisIdRef.current += 1;
				return startLoadingPhase(previous.imageUrl, nextAnalysisIdRef.current);
			});
		});
	}, []);

	const handleRestart = useCallback(() => {
		withViewTransition(() => {
			setPhase(INITIAL);
		});
	}, []);

	const handleUseLiveDiagnosis = useCallback((diagnosis: Diagnosis) => {
		withViewTransition(() => {
			setPhase({
				kind: 'results',
				diagnosis,
			});
		});
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

				{phase.kind === 'upload' && (
					<>
						<UploadArea onFileSelected={handleImageSelected} />
						<CameraCapture onCapture={handleImageSelected} onLiveDiagnosis={handleUseLiveDiagnosis} />
					</>
				)}

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

				{phase.kind === 'loading' && <LoadingSequence step={phase.step} />}

				{phase.kind === 'error' && (
					<>
						<div className='preview-container'>
							<img src={phase.imageUrl} alt='Tongfoto voor foutmelding' />
						</div>
						<div className='analysis-error' role='alert'>
							<h3>Analyse mislukt</h3>
							<p>{analysisErrorMessage(phase.error)}</p>
						</div>
						<div className='error-actions'>
							<button
								type='button'
								className='analyze-btn'
								onClick={handleRetry}
							>
								Opnieuw proberen
							</button>
							<button type='button' className='restart-btn' onClick={handleRestart}>
								Nieuwe foto kiezen
							</button>
						</div>
					</>
				)}

				{phase.kind === 'results' && (
					<DiagnosisResults
						diagnosis={phase.diagnosis}
						onRestart={handleRestart}
					/>
				)}

				{phase.kind === 'results' && <Guide />}

				<div className='disclaimer'>
					Dit is een experimentele AI-analyse gebaseerd op principes uit de Traditionele Chinese Geneeskunde. Raadpleeg
					altijd een gekwalificeerde TCM-arts voor een professionele diagnose.
				</div>
			</main>
			{import.meta.env.VITE_DEBUG_OVERLAY === 'true' && (
				<footer className='debug-footer'>
					debug {import.meta.env.DEV ? 'mode' : 'build'} &middot;{' '}
					{(import.meta.env.VITE_COMMIT_SHA?.slice(0, 7) ?? '?') + (import.meta.env.DEV ? '+dev' : '')} &middot;{' '}
					{import.meta.env.VITE_BUILD_DATE ?? '?'}
				</footer>
			)}
		</>
	);
}
