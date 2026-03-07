/**
 * Maps every {@link AnalysisError} variant to a user-facing Dutch error
 * message. Each nested discriminated union is exhaustively matched so new
 * error kinds cause compile-time failures here.
 *
 * @module
 */

import type { AnalysisError } from './pipeline.ts';

/**
 * Produce a Dutch user-facing error message for a pipeline failure.
 *
 * Exhaustively matches the outer {@link AnalysisError} `kind` tag and,
 * where the variant carries a nested error union (`face_detection_error`,
 * `poor_lighting`, `tongue_segmentation_error`, `color_correction_error`),
 * exhaustively matches the inner `kind` as well. Unreachable fallback
 * returns after each inner switch guard against future variant additions
 * at runtime while TypeScript enforces exhaustiveness at compile time.
 *
 * All messages are written in Dutch to match the app's `lang="nl"` locale
 * and are phrased as actionable instructions the user can follow.
 *
 * @param error - The typed pipeline error produced by {@link analyzeTongue}
 *   or {@link analyzeTongueFrame}.
 * @returns A single-sentence Dutch string suitable for UI display.
 *
 * @example
 * ```ts
 * const result = await analyzeTongue(file, onStep);
 * if (!result.ok) {
 * 	const message = analysisErrorMessage(result.error);
 * 	showToast(message);
 * }
 * ```
 */
export function analysisErrorMessage(error: AnalysisError): string {
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
		case 'poor_lighting':
			switch (error.issue) {
				case 'too_dark':
					return 'Belichting is te donker voor betrouwbare tonganalyse. Gebruik helder frontaal licht zonder tegenlicht.';
				case 'too_bright':
					return 'Belichting is te fel of overbelicht. Vermijd directe flits en gebruik zacht, egaal licht.';
				case 'high_contrast':
					return 'Belichting heeft te harde schaduwen. Gebruik egaal licht van voren zonder sterke contrasten.';
			}
			return 'Belichting onvoldoende voor betrouwbare analyse.';
		case 'tongue_segmentation_error':
			switch (error.error.kind) {
				case 'empty_input':
					return 'Lege mondregio ontvangen. Probeer een andere foto.';
				case 'allowed_mask_size_mismatch':
					return 'Interne mondmaskerfout opgetreden. Probeer opnieuw.';
				case 'no_tongue_pixels_detected':
					return 'Tong niet duidelijk zichtbaar in de mondregio. Gebruik egaal licht van voren, open je mond verder en steek je tong uit.';
				case 'multiple_regions_detected':
					return "Meerdere losse tongregio's gevonden. Gebruik een close-up van slechts één tong.";
				case 'insufficient_pixels':
					return 'Te weinig bruikbare tongpixels gevonden. Ga dichterbij en zorg voor egaal frontaal licht zonder harde schaduwen.';
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
}
