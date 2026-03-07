# src/lib — Analysis Pipeline & Utilities

Client-side ML pipeline: image → face detection → tongue segmentation → color correction → OKLCh classification → diagnosis.
Plus shared utilities (debug overlay, view transitions, time formatting, math utils, result type).

## PIPELINE FLOW

```tree
analyzeTongueFromUrl(url)           pipeline.ts (orchestrator, 234 lines)
  │
  ├─ loadImage(url)                 pipeline/frame-source.ts
  ├─ detectMouthRegion(image)       face-detection.ts   → Result<MouthRegion, MouthDetectionError>
  │    └─ closeup fallback (see pipeline/AGENTS.md)
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
| `pipeline.ts`               | 237   | Orchestrator. Delegates to `pipeline/analysis-core.ts`. Closeup fallback. |
| `face-detection.ts`         | 626   | MediaPipe FaceLandmarker. Singleton model. Mouth landmark extraction.     |
| `tongue-segmentation.ts`    | 601   | HSV thresholding → erode/dilate → connected-component BFS → centroid.     |
| `color-correction.ts`       | 260   | Gray-world on masked pixels. Returns corrected `ImageData` + avg RGB.     |
| `diagnosis.ts`              | 205   | Maps `TongueColorClassification` → satirical TCM `Diagnosis`.             |
| `color-classification.ts`   | 251   | RGB→OKLCh conversion. Distance to TCM type reference colors.              |
| `color-analysis.ts`         | 186   | **Legacy.** Canvas center-crop RGB→HSL. Used by old PRNG path.            |
| `color-matching.ts`         | 139   | **Legacy.** OKLCH Gaussian weight boosting for old diagnosis.             |
| `debug-overlay.ts`          | 128   | DPR-aware debug canvas drawing (bounding box + lip polygons). Pure.       |
| `capture-video-frame.ts`    | 126   | Captures single video frame as JPEG File via offscreen canvas.            |
| `view-transition.ts`        | 101   | View Transitions API helpers. `withViewTransition()`, stale cancellation. |
| `analysis-error-message.ts` | 96    | Exhaustive Dutch error message mapping for all `AnalysisError` variants.  |
| `oklch-distance.ts`         | 72    | Weighted Euclidean distance in OKLCh with circular hue handling.          |
| `result.ts`                 | 71    | `Result<T,E>` discriminated union. `ok(value)` / `err(error)`.            |
| `math-utils.ts`             | 22    | Shared `clamp()` used across pipeline stages.                             |
| `format-time.ts`            | 19    | Shared Dutch locale time formatter (`formatUpdateTime`).                  |

### pipeline/ subdirectory — see `src/lib/pipeline/AGENTS.md`

Decomposed pipeline internals (7 files, ~900 lines), extracted from the former monolithic `pipeline.ts`.

## ERROR TYPES

Every pipeline stage has its own discriminated union error type (`kind` tag):

- **`MouthDetectionError`** — `invalid_image_dimensions`, `model_load_failed`, `detection_failed`, `no_face_detected`, `multiple_faces_detected`, `mouth_not_visible`
- **`TongueSegmentationError`** — `empty_input`, `allowed_mask_size_mismatch`, `no_tongue_pixels_detected`, `multiple_regions_detected`, `insufficient_pixels`
- **`ColorCorrectionError`** — `mask_size_mismatch`, `no_masked_pixels`
- **`AnalysisError`** (pipeline-level) — wraps above + `image_load_failed`, `canvas_unavailable`, `mouth_crop_failed`, `poor_lighting`, `inconclusive_color`

`poor_lighting` is a secondary diagnostic invoked *after* segmentation failure or color-gate failure — `detectLightingIssue()` runs in the error-handling path of `analysis-core.ts`, not as a pre-check before segmentation.

## CONVENTIONS (beyond root)

- **Singleton model**: `face-detection.ts` caches the MediaPipe `FaceLandmarker` instance. Call `releaseFaceLandmarker()` to free.
- **Two detection modes**: `detectMouthRegion(image)` for stills, `detectMouthRegionForVideo(video, timestamp)` for live frames. Different MediaPipe API calls.
- **Legacy modules**: `color-analysis.ts` and `color-matching.ts` are from the old PRNG-only path. Still imported by the diagnosis generator for seeded randomness.
- **View transition helpers**: `view-transition.ts` wraps the browser View Transitions API with stale-transition cancellation and `prefers-reduced-motion` bypass.
- **Pure utility modules**: `debug-overlay.ts`, `math-utils.ts`, `format-time.ts`, `view-transition.ts` have zero React coupling (pure functions).
- **External deps**: `@mediapipe/tasks-vision`, `hex-to-oklch`, `virtual:package-bindings` (Vite virtual module).
- **Internal data dep**: `src/data/tongue-types.ts` — TCM reference colors, organ zones, element mappings.
