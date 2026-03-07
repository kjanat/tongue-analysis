# src/lib — Analysis Pipeline & Utilities

Client-side ML pipeline: image → face detection → tongue segmentation → color correction → OKLCh classification → diagnosis.
Plus shared utilities (debug overlay, time formatting, math utils, result type).

## PIPELINE FLOW

```tree
analyzeTongueFromUrl(url)           pipeline.ts (orchestrator, 234 lines)
  │
  ├─ loadImage(url)                 pipeline/frame-source.ts
  ├─ detectMouthRegion(image)       face-detection.ts   → Result<MouthRegion, MouthDetectionError>
  │    └─ closeup fallback: if face detection fails, retries with full-image crop + relaxed thresholds
  ├─ segmentTongue(imageData)       tongue-segmentation.ts → Result<TongueMask, TongueSegmentationError>
  ├─ applyGrayWorldCorrection()     color-correction.ts → Result<ColorCorrectionResult, ColorCorrectionError>
  ├─ classifyTongueColor()          color-classification.ts → TongueColorClassification
  └─ generateDiagnosis()            diagnosis.ts → Diagnosis
```

Three entry points in `pipeline.ts`:

- `analyzeTongueFromUrl(url, onStep)` — file upload path (loads image from URL)
- `analyzeTongueImage(imageData, onStep)` — direct ImageData input
- `analyzeTongueVideoFrame(video, timestamp)` — live camera frame (uses video-mode MediaPipe)

All return `Result<AnalysisSuccess, AnalysisError>`.

## WHERE TO LOOK

| File                        | Lines | Role                                                                      |
| --------------------------- | ----- | ------------------------------------------------------------------------- |
| `pipeline.ts`               | 234   | Orchestrator. Delegates to `pipeline/analysis-core.ts`. Closeup fallback. |
| `face-detection.ts`         | 619   | MediaPipe FaceLandmarker. Singleton model. Mouth landmark extraction.     |
| `tongue-segmentation.ts`    | 590   | HSV thresholding → erode/dilate → connected-component BFS → centroid.     |
| `color-correction.ts`       | 260   | Gray-world on masked pixels. Returns corrected `ImageData` + avg RGB.     |
| `color-classification.ts`   | 134   | RGB→OKLCh conversion. Distance to TCM type reference colors.              |
| `diagnosis.ts`              | 193   | Maps `TongueColorClassification` → satirical TCM `Diagnosis`.             |
| `oklch-distance.ts`         | 72    | Weighted Euclidean distance in OKLCh with circular hue handling.          |
| `result.ts`                 | 71    | `Result<T,E>` discriminated union. `ok(value)` / `err(error)`.            |
| `capture-video-frame.ts`    | 126   | Captures single video frame as JPEG File via offscreen canvas.            |
| `analysis-error-message.ts` | 96    | Exhaustive Dutch error message mapping for all `AnalysisError` variants.  |
| `debug-overlay.ts`          | 128   | DPR-aware debug canvas drawing (bounding box + lip polygons). Pure.       |
| `math-utils.ts`             | 22    | Shared `clamp()` used across pipeline stages.                             |
| `format-time.ts`            | 19    | Shared Dutch locale time formatter (`formatUpdateTime`).                  |
| `color-analysis.ts`         | 186   | **Legacy.** Canvas center-crop RGB→HSL. Used by old PRNG path.            |
| `color-matching.ts`         | 139   | **Legacy.** OKLCH Gaussian weight boosting for old diagnosis.             |

### pipeline/ subdirectory — see `src/lib/pipeline/AGENTS.md`

Decomposed pipeline internals, extracted from the former monolithic `pipeline.ts`:

| File                        | Lines | Role                                                              |
| --------------------------- | ----- | ----------------------------------------------------------------- |
| `pipeline/analysis-core.ts` | 237   | Core analysis logic: step orchestration, closeup fallback.        |
| `pipeline/crop.ts`          | 129   | Image cropping from mouth landmarks to canvas `ImageData`.        |
| `pipeline/mask.ts`          | 174   | Polygon rasterization (inner lip) + fallback ellipse mask.        |
| `pipeline/lighting.ts`      | 171   | Luminance histogram analysis, poor-lighting detection.            |
| `pipeline/types.ts`         | 70    | Shared types: `FrameSource`, `FrameDimensions`, `MouthCrop`, etc. |
| `pipeline/frame-source.ts`  | 66    | Unified frame acquisition (URL load / direct ImageData / video).  |
| `pipeline/thresholds.ts`    | 54    | Threshold constants for segmentation, lighting, and confidence.   |

## ERROR TYPES

Every pipeline stage has its own discriminated union error type (`kind` tag):

- **`MouthDetectionError`** — `invalid_image_dimensions`, `model_load_failed`, `detection_failed`, `no_face_detected`, `multiple_faces_detected`, `mouth_not_visible`
- **`TongueSegmentationError`** — `empty_input`, `allowed_mask_size_mismatch`, `no_tongue_pixels_detected`, `multiple_regions_detected`, `insufficient_pixels`
- **`ColorCorrectionError`** — `mask_size_mismatch`, `no_masked_pixels`
- **`AnalysisError`** (pipeline-level) — wraps above + `image_load_failed`, `canvas_unavailable`, `mouth_crop_failed`, `poor_lighting`, `inconclusive_color`

`poor_lighting` is checked between face detection and segmentation (validates luminance distribution).

## CONVENTIONS (beyond root)

- **Singleton model**: `face-detection.ts` caches the MediaPipe `FaceLandmarker` instance. Call `releaseFaceLandmarker()` to free.
- **Two detection modes**: `detectMouthRegion(image)` for stills, `detectMouthRegionForVideo(video, timestamp)` for live frames. Different MediaPipe API calls.
- **Legacy modules**: `color-analysis.ts` and `color-matching.ts` are from the old PRNG-only path. Still imported by the diagnosis generator for seeded randomness.
- **Pure utility modules**: `debug-overlay.ts`, `math-utils.ts`, `format-time.ts` have zero React coupling (pure functions).
- **External deps**: `@mediapipe/tasks-vision`, `hex-to-oklch`, `virtual:package-bindings` (Vite virtual module).
- **Internal data dep**: `src/data/tongue-types.ts` — TCM reference colors, organ zones, element mappings.
