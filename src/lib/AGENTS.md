# src/lib — Analysis Pipeline

Client-side ML pipeline: image → face detection → tongue segmentation → color correction → classification → diagnosis.

## PIPELINE FLOW

```tree
analyzeTongueFromUrl(url)           pipeline.ts (orchestrator, 101 lines)
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

| File                      | Lines | Role                                                                      |
| ------------------------- | ----- | ------------------------------------------------------------------------- |
| `pipeline.ts`             | 101   | Orchestrator. Delegates to `pipeline/analysis-core.ts`. Closeup fallback. |
| `face-detection.ts`       | 344   | MediaPipe FaceLandmarker. Singleton model. Mouth landmark extraction.     |
| `tongue-segmentation.ts`  | 362   | HSV thresholding → connected components → centroid heuristic.             |
| `color-correction.ts`     | 158   | Gray-world on masked pixels. Returns corrected `ImageData` + avg RGB.     |
| `color-classification.ts` | 95    | RGB→OKLCh conversion. Distance to TCM type reference colors.              |
| `diagnosis.ts`            | 106   | Maps `TongueColorClassification` → satirical TCM `Diagnosis`.             |
| `result.ts`               | 17    | `Result<T,E>` discriminated union. `ok(value)` / `err(error)`.            |
| `color-analysis.ts`       | 136   | **Legacy.** Canvas center-crop RGB→HSL. Used by old PRNG path.            |
| `color-matching.ts`       | 126   | **Legacy.** HSL distance + weight boosting for old diagnosis.             |

### pipeline/ subdirectory

Decomposed pipeline internals, extracted from the former monolithic `pipeline.ts`:

| File                        | Lines | Role                                                              |
| --------------------------- | ----- | ----------------------------------------------------------------- |
| `pipeline/analysis-core.ts` | 149   | Core analysis logic: step orchestration, closeup fallback.        |
| `pipeline/crop.ts`          | 72    | Image cropping from mouth landmarks to canvas `ImageData`.        |
| `pipeline/frame-source.ts`  | 30    | Unified frame acquisition (URL load / direct ImageData / video).  |
| `pipeline/lighting.ts`      | 102   | Luminance histogram analysis, poor-lighting detection.            |
| `pipeline/mask.ts`          | 71    | Tongue mask application, allowed-region mask construction.        |
| `pipeline/thresholds.ts`    | 13    | Threshold constants for segmentation and lighting checks.         |
| `pipeline/types.ts`         | 27    | Shared types: `AnalysisStep`, `AnalysisSuccess`, `AnalysisError`. |

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
