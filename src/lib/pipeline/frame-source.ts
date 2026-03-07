import type { FrameDimensions, FrameSource } from './types.ts';

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function loadImage(imageUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => {
			resolve(image);
		};
		image.onerror = () => {
			reject(new Error('Image load failed'));
		};
		image.src = imageUrl;
	});
}

export function getFrameDimensions(source: FrameSource): FrameDimensions | undefined {
	if ('naturalWidth' in source && source.naturalWidth > 0 && source.naturalHeight > 0) {
		return { width: source.naturalWidth, height: source.naturalHeight };
	}

	if ('videoWidth' in source && source.videoWidth > 0 && source.videoHeight > 0) {
		return { width: source.videoWidth, height: source.videoHeight };
	}

	return undefined;
}
