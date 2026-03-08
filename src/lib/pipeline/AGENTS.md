# src/lib/pipeline — Pipeline Internals

Decomposed pipeline stages extracted from the former monolithic `pipeline.ts`. 7 files, ~1,065 lines total.

## WHERE TO LOOK

| File               | Lines | Role                                                                               |
| ------------------ | ----- | ---------------------------------------------------------------------------------- |
| `analysis-core.ts` | 240   | Core analysis loop: step orchestration, closeup fallback logic.                    |
| `thresholds.ts`    | 194   | All numeric constants for segmentation, lighting, confidence, and pipeline tuning. |
| `mask.ts`          | 176   | Inner lip polygon rasterization + fallback ellipse mask.                           |
| `lighting.ts`      | 171   | Luminance histogram analysis, poor-lighting detection threshold.                   |
| `crop.ts`          | 147   | Mouth bounding-box/image intersection → canvas `ImageData` crop.                   |
| `types.ts`         | 70    | Shared ADTs: `FrameSource`, `FrameDimensions`, `MouthCrop`, etc.                   |
| `frame-source.ts`  | 67    | Unified frame acquisition: URL load, direct ImageData, video.                      |

## DATA FLOW

```tree
pipeline.ts (entry points)
  └─ analysis-core.ts (core loop)
       ├─ frame-source.ts  → FrameSource (image/video/raw)
       ├─ crop.ts           → MouthCrop (ImageData + dimensions)
       ├─ mask.ts           → Uint8Array (binary pixel mask)
       ├─ lighting.ts       → poor-lighting check (after segmentation/color-gate failure)
       └─ thresholds.ts     → constants used by all stages
```

## CONVENTIONS (beyond parent)

- **`FrameSource` ADT**: Discriminated union with `kind` tag (`'url'` | `'image_data'` | `'video'`). Parsed at boundary in `frame-source.ts`.
- **Threshold isolation**: All magic numbers live in `thresholds.ts`, not scattered across stages. Grouped by pipeline phase: segmentation, lighting, confidence, crop, and pipeline-level constants.
- **Mask fallback**: `mask.ts` tries inner-lip polygon rasterization first, falls back to axis-aligned ellipse if polygon has too few points.
- **Lighting diagnostic**: `lighting.ts` checks luminance distribution as a secondary diagnostic *after* segmentation or color-gate failure, providing actionable "improve lighting" errors instead of generic ones.
- **`types.ts` is import-only**: Pure type definitions, no runtime code. All types use `readonly` fields.

## NOTES

- `analysis-core.ts` is the sole consumer of all other files in this directory.
- Closeup fallback (retry with full-image crop when face detection fails) is implemented in `analysis-core.ts`, not in `pipeline.ts`.
- `crop.ts` computes the intersection of the mouth bounding box with image bounds; padding is applied upstream in `face-detection.ts`.
- `mask.ts` exports `makeMouthOpeningMask()`, `makeFallbackAllowedMask()`, and `fallbackMinimumPixels()` — independently testable.
