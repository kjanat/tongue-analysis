# src/components — UI Components

6 React components, flat structure. ~1,190 lines total. All styles in `src/App.css`.

## WHERE TO LOOK

| File                   | Lines | Role                                                                                                      |
| ---------------------- | ----- | --------------------------------------------------------------------------------------------------------- |
| `CameraCapture.tsx`    | 576   | Modal dialog: live camera, still capture, device switching, real-time analysis. Orchestrates all 4 hooks. |
| `DiagnosisResults.tsx` | 177   | Full diagnosis report: color, type, elements, meridians, organs, patterns, tips.                          |
| `Guide.tsx`            | 130   | Collapsible TCM reference guide. Embeds `TongueMap`.                                                      |
| `UploadArea.tsx`       | 119   | Drag-and-drop file upload with MIME/size validation (10MB limit).                                         |
| `TongueMap.tsx`        | 106   | Inline SVG organ-zone diagram. Accessible (`<title>`, `<desc>`, ARIA).                                    |
| `LoadingSequence.tsx`  | 79    | Stepped progress indicator mapping `AnalysisStep` to visual states.                                       |

## COMPONENT PATTERNS

- **`CameraCapture`** is the complexity hub — 4 private sub-components (`CameraIdleActions`, `CameraReadyControls`, `CameraStage`, `LiveDiagnosisPanel`), all unexported.
- **Two output paths from camera**: `onCapture` (still frame blob → upload flow) and `onLiveDiagnosis` (bypass upload, direct results).
- **`<dialog>` modal**: Native dialog element with backdrop click-to-close via `onMouseDown` target check.
- **Upload as `<button>`**: `UploadArea` wraps upload zone in `<button>` for keyboard accessibility.

## CONVENTIONS (beyond root)

- **Specific `data-*` attrs**: `data-mirror`, `data-status`, `data-visible`, `data-dragover` across components.
- **Debug gating**: Confidence values in `DiagnosisResults` only rendered when `VITE_DEBUG_OVERLAY` is truthy.
- **`<output>` as ARIA live region**: Used in `CameraCapture` for screen reader announcements.

## NOTES

- `TongueMap` draws from viewer/practitioner perspective (Galblaas left, Lever right in SVG).
- No co-located styles or tests — all styles in parent's `App.css`, zero test files.
