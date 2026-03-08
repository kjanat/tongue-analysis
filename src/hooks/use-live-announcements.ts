/**
 * Accessibility announcements for the live camera analysis mode.
 *
 * Drives an `<output>` element (ARIA live region) with step progress,
 * diagnosis results, and timestamp updates so screen readers can
 * follow the analysis without visual cues.
 *
 * @module
 */

import type { Diagnosis } from '$lib/diagnosis.ts';
import { formatUpdateTime } from '$lib/format-time.ts';
import type { AnalysisStep } from '$lib/pipeline.ts';
import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { LiveMode } from './use-live-analysis.ts';

/** Input configuration for {@link useLiveAnnouncements}. */
interface UseLiveAnnouncementsInput {
	/** Whether the live camera session has been started at least once. */
	readonly liveHasStarted: boolean;
	/** Current live analysis mode (`'idle'` or `'running'`). */
	readonly liveMode: LiveMode;
	/** Currently executing pipeline step, or `null` when idle. */
	readonly liveStep: AnalysisStep | null;
	/** Most recent diagnosis result, or `null` before first analysis. */
	readonly liveDiagnosis: Diagnosis | null;
	/** Timestamp (ms) of the most recent result update. */
	readonly liveUpdatedAt: number | null;
	/** Map from {@link AnalysisStep} to Dutch display label. */
	readonly stepLabels: Readonly<Record<AnalysisStep, string>>;
}

/** Return value of {@link useLiveAnnouncements}. */
interface UseLiveAnnouncementsResult {
	/** Ref to attach to an `<output>` element serving as ARIA live region. */
	readonly outputRef: RefObject<HTMLOutputElement | null>;
	/** Imperatively set the live region text content. */
	readonly announce: (message: string) => void;
	/** Clear all tracked state and the live region text. */
	readonly reset: () => void;
}

/**
 * Manage ARIA live-region announcements during live tongue analysis.
 *
 * Announcement priority: step progress > new diagnosis > timestamp update.
 * Deduplicates by tracking the last announced value for each category.
 *
 * @param input - Live analysis state to derive announcements from.
 * @returns Refs and imperative controls for the `<output>` live region.
 *
 * @example
 * ```tsx
 * const { outputRef, announce } = useLiveAnnouncements({
 *   liveHasStarted, liveMode, liveStep, liveDiagnosis, liveUpdatedAt, stepLabels,
 * });
 * return <output ref={outputRef} className="sr-only" />;
 * ```
 */
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
