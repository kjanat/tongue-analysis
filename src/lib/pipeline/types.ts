export type FrameSource = HTMLImageElement | HTMLVideoElement;

export interface FrameDimensions {
	readonly width: number;
	readonly height: number;
}

export interface Point2D {
	readonly x: number;
	readonly y: number;
}

export interface MouthCrop {
	readonly imageData: ImageData;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface LightingStats {
	readonly meanLuminance: number;
	readonly stdDevLuminance: number;
	readonly darkRatio: number;
	readonly brightRatio: number;
	readonly sampleCount: number;
}
