import { err, ok, type Result } from './result.ts';

type CaptureError =
	| { readonly kind: 'no_video_signal' }
	| { readonly kind: 'canvas_unavailable' }
	| { readonly kind: 'blob_conversion_failed' };

const CAPTURE_ERROR_MESSAGES: Readonly<Record<CaptureError['kind'], string>> = {
	no_video_signal: 'Geen camerabeeld beschikbaar om vast te leggen.',
	canvas_unavailable: 'Kon cameraframe niet verwerken.',
	blob_conversion_failed: 'Kon foto niet opslaan. Probeer opnieuw.',
};

export function captureErrorMessage(error: CaptureError): string {
	return CAPTURE_ERROR_MESSAGES[error.kind];
}

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
	return new Promise((resolve) => {
		canvas.toBlob(
			(blob) => {
				resolve(blob);
			},
			'image/jpeg',
			0.92,
		);
	});
}

export async function captureVideoFrame(
	video: HTMLVideoElement,
	filenamePrefix = 'tong-camera',
): Promise<Result<File, CaptureError>> {
	if (video.videoWidth === 0 || video.videoHeight === 0) {
		return err({ kind: 'no_video_signal' });
	}

	const canvas = document.createElement('canvas');
	canvas.width = video.videoWidth;
	canvas.height = video.videoHeight;

	const context = canvas.getContext('2d');
	if (context === null) {
		return err({ kind: 'canvas_unavailable' });
	}

	context.drawImage(video, 0, 0, canvas.width, canvas.height);

	const blob = await canvasToJpegBlob(canvas);
	if (blob === null) {
		return err({ kind: 'blob_conversion_failed' });
	}

	const capturedAt = Date.now();
	const file = new File([blob], `${filenamePrefix}-${String(capturedAt)}.jpg`, {
		type: 'image/jpeg',
		lastModified: capturedAt,
	});

	return ok(file);
}
