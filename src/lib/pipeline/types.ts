/**
 * Shared types for the tongue analysis pipeline.
 *
 * These structures flow between pipeline stages: frame acquisition,
 * face detection, mouth cropping, lighting analysis, and segmentation.
 *
 * @module
 */

/**
 * A drawable media element that can be painted onto a canvas.
 *
 * Used as the input source for both still-image and video-frame analysis paths.
 * See {@link analyzeTongueImage} and {@link analyzeTongueVideoFrame}.
 */
export type FrameSource = HTMLImageElement | HTMLVideoElement;

/** Pixel dimensions of a frame or region. */
export interface FrameDimensions {
	/** Width in pixels. */
	readonly width: number;
	/** Height in pixels. */
	readonly height: number;
}

/** A 2D coordinate in pixel space, origin at top-left. */
export interface Point2D {
	/** Horizontal offset from left edge. */
	readonly x: number;
	/** Vertical offset from top edge. */
	readonly y: number;
}

/**
 * Cropped mouth region extracted from a full frame.
 *
 * Coordinates are relative to the original frame, allowing
 * the crop to be overlaid back onto the source image.
 */
export interface MouthCrop {
	/** Raw RGBA pixel data of the cropped region. */
	readonly imageData: ImageData;
	/** Left edge of the crop in the original frame. */
	readonly x: number;
	/** Top edge of the crop in the original frame. */
	readonly y: number;
	/** Crop width in pixels. */
	readonly width: number;
	/** Crop height in pixels. */
	readonly height: number;
}

/**
 * Luminance statistics computed from a mouth-region sample.
 *
 * Used by {@link detectLightingIssue} to reject frames with
 * insufficient or uneven illumination before color analysis.
 */
export interface LightingStats {
	/** Average luminance across sampled pixels (0–255). */
	readonly meanLuminance: number;
	/** Standard deviation of luminance; high values indicate uneven lighting. */
	readonly stdDevLuminance: number;
	/** Fraction of pixels below the `DARK_PIXEL_LUMINANCE` threshold. */
	readonly darkRatio: number;
	/** Fraction of pixels above the `BRIGHT_PIXEL_LUMINANCE` threshold. */
	readonly brightRatio: number;
	/** Number of pixels included in the sample. */
	readonly sampleCount: number;
}
