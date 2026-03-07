import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { Diagnosis } from '../lib/diagnosis.ts';
import type { AnalysisStep } from '../lib/pipeline.ts';
import type { LiveMode } from './use-live-analysis.ts';

interface UseLiveAnnouncementsInput {
	readonly liveHasStarted: boolean;
	readonly liveMode: LiveMode;
	readonly liveStep: AnalysisStep | null;
	readonly liveDiagnosis: Diagnosis | null;
	readonly liveUpdatedAt: number | null;
	readonly stepLabels: Readonly<Record<AnalysisStep, string>>;
}

interface UseLiveAnnouncementsResult {
	readonly outputRef: RefObject<HTMLOutputElement | null>;
	readonly announce: (message: string) => void;
	readonly reset: () => void;
}

function formatUpdateTime(timestampMs: number): string {
	return new Date(timestampMs).toLocaleTimeString('nl-NL', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
}

export function useLiveAnnouncements({
	liveHasStarted,
	liveMode,
	liveStep,
	liveDiagnosis,
	liveUpdatedAt,
	stepLabels,
}: UseLiveAnnouncementsInput): UseLiveAnnouncementsResult {
	const outputRef = useRef<HTMLOutputElement>(null);
	const announcedStepRef = useRef<AnalysisStep | null>(null);
	const announcedDiagnosisRef = useRef<string | null>(null);
	const announcedUpdatedAtRef = useRef<number | null>(null);

	const announce = useCallback((message: string) => {
		const output = outputRef.current;
		if (output !== null) {
			output.textContent = message;
		}
	}, []);

	const reset = useCallback(() => {
		announcedStepRef.current = null;
		announcedDiagnosisRef.current = null;
		announcedUpdatedAtRef.current = null;
		announce('');
	}, [announce]);

	// Announcement priority: step > diagnosis > timestamp.
	// Early returns enforce this — a new liveStep (vs announcedStepRef.current)
	// always wins over a new liveDiagnosis (vs announcedDiagnosisRef.current),
	// which always wins over a new liveUpdatedAt (vs announcedUpdatedAtRef.current).
	useEffect(() => {
		if (!liveHasStarted) {
			reset();
			return;
		}

		if (liveMode === 'running' && liveStep !== null && liveStep !== announcedStepRef.current) {
			announcedStepRef.current = liveStep;
			announce(`Analyse stap: ${stepLabels[liveStep]}.`);
			return;
		}

		if (liveDiagnosis !== null) {
			const diagnosisKey = `${liveDiagnosis.type.id}|${liveDiagnosis.type.summary}`;
			if (diagnosisKey !== announcedDiagnosisRef.current) {
				announcedDiagnosisRef.current = diagnosisKey;
				announcedUpdatedAtRef.current = liveUpdatedAt;
				announce(
					`Live-diagnose: ${liveDiagnosis.type.name}. ${liveDiagnosis.type.summary}`,
				);
				return;
			}
		}

		if (liveUpdatedAt !== null && liveUpdatedAt !== announcedUpdatedAtRef.current) {
			announcedUpdatedAtRef.current = liveUpdatedAt;
			announce(`Live-resultaat bijgewerkt om ${formatUpdateTime(liveUpdatedAt)}.`);
		}
	}, [announce, liveDiagnosis, liveHasStarted, liveMode, liveStep, liveUpdatedAt, reset, stepLabels]);

	return { outputRef, announce, reset };
}
