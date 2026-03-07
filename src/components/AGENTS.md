# src/components — UI Components

6 React components, flat structure. ~1,598 lines total. All styles in `src/App.css`.

## WHERE TO LOOK

| File                   | Lines | Role                                                                                                      |
| ---------------------- | ----- | --------------------------------------------------------------------------------------------------------- |
| `CameraCapture.tsx`    | 964   | Modal dialog: live camera, still capture, device switching, real-time analysis. Orchestrates all 4 hooks. |
| `DiagnosisResults.tsx` | 181   | Full diagnosis report: color, type, elements, meridians, organs, patterns, tips.                          |
| `Guide.tsx`            | 127   | Collapsible TCM reference guide. Embeds `TongueMap`.                                                      |
| `UploadArea.tsx`       | 125   | Drag-and-drop file upload with MIME/size validation (10MB limit).                                         |
| `TongueMap.tsx`        | 115   | Inline SVG organ-zone diagram with `useId()` for unique SVG IDs. Accessible (`role='img'`, ARIA).         |
| `LoadingSequence.tsx`  | 86    | Stepped progress indicator with `role='progressbar'` and `aria-valuenow/min/max`.                         |

## COMPONENT PATTERNS

- **`CameraCapture`** is the complexity hub — 4 private sub-components (`CameraIdleActions`, `CameraReadyControls`, `CameraStage`, `LiveDiagnosisPanel`), all unexported.
- **Two output paths from camera**: `onCapture` (still frame blob → upload flow) and `onLiveDiagnosis` (bypass upload, direct results).
- **`<dialog>` modal**: Native dialog element with backdrop bounding-rect check for click-to-close.
- **View Transitions**: Modal open uses `withViewTransitionAndWait()` for hero animation between camera button and dialog.
- **Sequenced close**: `closeModalWithTransition()` orchestrates collapse live panel → fade modal → close dialog via CSS custom property timings (`parseDurationMs()` reads `--camera-modal-close-ms` etc. from `getComputedStyle()`).
- **Preview priming**: `previewPrimed` + `previewAspectRatio` states with skeleton loader until first video frame renders.
- **Upload as `<button>`**: `UploadArea` wraps upload zone in `<button>` for keyboard accessibility. File input reset (`input.value = ''`) enables re-selecting the same file.

## CONVENTIONS (beyond root)

- **Specific `data-*` attrs**: `data-mirror`, `data-status`, `data-visible`, `data-dragover`, `data-hero-owner`, `data-closing`, `data-skeleton-visible`, `data-ready`, `data-stale`, `data-reveal-phase`, `data-running`.
- **Debug gating**: Confidence values in `DiagnosisResults` only rendered when `VITE_DEBUG_OVERLAY` is truthy.
- **`<output>` as ARIA live region**: Used in `CameraCapture` for screen reader announcements.
- **`useId()` for SVG IDs**: `TongueMap` generates unique `<linearGradient>` IDs via React's `useId()` to avoid DOM collisions.
- **Index-prefixed keys**: `DiagnosisResults` uses `${String(i)}-${value}` keys for lists with non-unique string items.

## NOTES

- `TongueMap` draws from viewer/practitioner perspective (Galblaas left, Lever right in SVG).
- No co-located styles or tests — all styles in parent's `App.css`, zero test files.
