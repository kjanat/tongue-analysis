import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import CameraCapture from './components/CameraCapture.tsx';
import DiagnosisResults from './components/DiagnosisResults.tsx';
import Guide from './components/Guide.tsx';
import LoadingSequence from './components/LoadingSequence.tsx';
import UploadArea from './components/UploadArea.tsx';
import type { Diagnosis } from './lib/diagnosis.ts';
import { type AnalysisError, type AnalysisStep, analyzeTongueFromUrl } from './lib/pipeline.ts';

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

const INITIAL: Phase = { kind: 'upload' };

function errorMessage(error: AnalysisError): string {
	switch (error.kind) {
		case 'image_load_failed':
			return 'Kon de afbeelding niet laden. Kies een andere foto en probeer opnieuw.';
		case 'canvas_unavailable':
			return 'Canvas niet beschikbaar in deze browser. Gebruik een moderne browser.';
		case 'mouth_crop_failed':
			return 'Mondregio kon niet worden uitgesneden. Gebruik een scherpere foto van dichterbij.';
		case 'face_detection_error':
			switch (error.error.kind) {
				case 'no_face_detected':
					return 'Geen gezicht gevonden. Zorg dat je gezicht volledig zichtbaar is.';
				case 'multiple_faces_detected':
					return 'Meerdere gezichten gedetecteerd. Gebruik een foto met slechts één persoon.';
				case 'mouth_not_visible':
					return 'Mond niet duidelijk zichtbaar. Open je mond en steek je tong uit.';
				case 'invalid_image_dimensions':
					return 'Ongeldige afbeeldingsafmetingen gedetecteerd. Gebruik een andere foto.';
				case 'model_load_failed':
					return 'Model kon niet geladen worden. Controleer je internetverbinding en probeer opnieuw.';
				case 'detection_failed':
					return 'Gezichtsdetectie mislukte. Probeer een foto met beter licht.';
			}
			return 'Gezichtsdetectie gaf een onbekende fout.';
		case 'tongue_segmentation_error':
			switch (error.error.kind) {
				case 'empty_input':
					return 'Lege mondregio ontvangen. Probeer een andere foto.';
				case 'allowed_mask_size_mismatch':
					return 'Interne mondmaskerfout opgetreden. Probeer opnieuw.';
				case 'no_tongue_pixels_detected':
					return 'Geen tong gevonden in de mondregio. Steek je tong verder uit.';
				case 'insufficient_pixels':
					return 'Te weinig tongpixels gedetecteerd. Gebruik een scherpere foto van dichterbij.';
			}
			return 'Tongsegmentatie gaf een onbekende fout.';
		case 'color_correction_error':
			switch (error.error.kind) {
				case 'mask_size_mismatch':
					return 'Interne maskfout tijdens kleurcorrectie. Probeer opnieuw.';
				case 'no_masked_pixels':
					return 'Geen bruikbare tongpixels na kleurcorrectie. Probeer beter licht.';
			}
			return 'Kleurcorrectie gaf een onbekende fout.';
		case 'inconclusive_color':
			return 'Kleurmeting was te onzeker. Zorg voor zichtbaar uitgestoken tong in egaal licht.';
	}

	return 'Onbekende analysefout opgetreden.';
}

function startLoadingPhase(imageUrl: string, analysisId: number): Phase {
	return {
		kind: 'loading',
		imageUrl,
		analysisId,
		step: 'loading_image',
	};
}

export default function App() {
	const [phase, setPhase] = useState<Phase>(INITIAL);
	const objectUrlRef = useRef<string | null>(null);
	const nextAnalysisIdRef = useRef(0);

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
		})();

		return () => {
			cancelled = true;
		};
	}, [loadingAnalysisId, loadingImageUrl]);

	const handleFileSelected = useCallback((file: File, imageUrl: string) => {
		void file;
		setPhase({ kind: 'preview', imageUrl });
	}, []);

	const handleAnalyze = useCallback(() => {
		setPhase((previous) => {
			if (previous.kind !== 'preview') return previous;
			nextAnalysisIdRef.current += 1;
			return startLoadingPhase(previous.imageUrl, nextAnalysisIdRef.current);
		});
	}, []);

	const handleRetry = useCallback(() => {
		setPhase((previous) => {
			if (previous.kind !== 'error') return previous;
			nextAnalysisIdRef.current += 1;
			return startLoadingPhase(previous.imageUrl, nextAnalysisIdRef.current);
		});
	}, []);

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

				{phase.kind === 'upload' && <UploadArea onFileSelected={handleFileSelected} />}
				{phase.kind === 'upload' && <CameraCapture onCapture={handleFileSelected} />}

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
						<div className='analysis-error'>
							<h3>Analyse mislukt</h3>
							<p>{errorMessage(phase.error)}</p>
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
		</>
	);
}
