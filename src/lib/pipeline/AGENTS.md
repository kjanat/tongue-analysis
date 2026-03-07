# src/lib/pipeline — Pipeline Internals

Decomposed pipeline stages extracted from the former monolithic `pipeline.ts`. 7 files, ~915 lines total.

## WHERE TO LOOK

| File               | Lines | Role                                                             |
| ------------------ | ----- | ---------------------------------------------------------------- |
| `analysis-core.ts` | 234   | Core analysis loop: step orchestration, closeup fallback logic.  |
| `mask.ts`          | 174   | Inner lip polygon rasterization + fallback ellipse mask.         |
| `lighting.ts`      | 171   | Luminance histogram analysis, poor-lighting detection threshold. |
| `crop.ts`          | 128   | Mouth region → canvas `ImageData` cropping with padding.         |
| `frame-source.ts`  | 84    | Unified frame acquisition: URL load, direct ImageData, video.    |
| `types.ts`         | 70    | Shared ADTs: `FrameSource`, `FrameDimensions`, `MouthCrop`, etc. |
| `thresholds.ts`    | 54    | Numeric constants for segmentation, lighting, and confidence.    |

## DATA FLOW

```tree
pipeline.ts (entry points)
  └─ analysis-core.ts (core loop)
       ├─ frame-source.ts  → FrameSource (image/video/raw)
       ├─ crop.ts           → MouthCrop (ImageData + dimensions)
       ├─ mask.ts           → Uint8Array (binary pixel mask)
       ├─ lighting.ts       → poor-lighting check (before segmentation)
       └─ thresholds.ts     → constants used by all stages
```

## CONVENTIONS (beyond parent)

- **`FrameSource` ADT**: Discriminated union with `kind` tag (`'url'` | `'image_data'` | `'video'`). Parsed at boundary in `frame-source.ts`.
- **Threshold isolation**: All magic numbers live in `thresholds.ts`, not scattered across stages.
- **Mask fallback**: `mask.ts` tries inner-lip polygon rasterization first, falls back to axis-aligned ellipse if polygon has too few points.
- **Lighting gate**: `lighting.ts` checks luminance distribution *before* tongue segmentation to fast-fail on underexposed images.
- **`types.ts` is import-only**: Pure type definitions, no runtime code. All types use `readonly` fields.

## NOTES

- `analysis-core.ts` is the sole consumer of all other files in this directory.
- Closeup fallback (retry with full-image crop when face detection fails) is implemented in `analysis-core.ts`, not in `pipeline.ts`.
- `crop.ts` adds configurable padding around the mouth bounding box to capture surrounding tongue area.
- `mask.ts` exports `rasterizePolygonMask()` and `createEllipseMask()` independently — they can be tested in isolation.
