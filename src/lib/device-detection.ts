/**
 * @module device-detection
 * Heuristic mobile/touch device detection shared by camera-switching
 * ({@link useMediaStream}) and UI mode selection ({@link CameraCapture}).
 */

/**
 * Media query matching touch-first devices.
 * Pass to `matchMedia().addEventListener('change', …)` to re-evaluate
 * when the pointer capability changes at runtime (e.g. convertible laptops).
 */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';

/**
 * Heuristically detect touch-first / mobile environments.
 * Checks (in order): UA Client Hints → userAgent regex → media query.
 *
 * `NavigatorUAData` is absent from TS 5.9 DOM types, so the
 * `userAgentData` branch uses runtime shape checks instead of a cast.
 *
 * @returns `true` when the device is likely mobile-like.
 */
export function isLikelyMobileDevice(): boolean {
	if (typeof window === 'undefined' || typeof navigator === 'undefined') {
		return false;
	}

	// UA Client Hints (Chrome 89+, Edge 89+, Opera 75+).
	if ('userAgentData' in navigator) {
		const uaData: unknown = navigator.userAgentData;
		if (
			uaData != null
			&& typeof uaData === 'object'
			&& 'mobile' in uaData
			&& uaData.mobile === true
		) {
			return true;
		}
	}

	if (/android|iphone|ipad|ipod|mobile/.test(navigator.userAgent.toLowerCase())) {
		return true;
	}

	return window.matchMedia(COARSE_POINTER_QUERY).matches;
}
