# src/hooks — React Hooks

Bridge between React UI and the ML analysis pipeline. 4 hooks, ~1,200 lines total.

## WHERE TO LOOK

| File                             | Lines | Role                                                                       |
| -------------------------------- | ----- | -------------------------------------------------------------------------- |
| `use-live-analysis.ts`           | 583   | rAF loop driving `analyzeTongueVideoFrame()` on live video. Heaviest hook. |
| `use-media-stream.ts`            | 413   | `getUserMedia` lifecycle: acquire, enumerate, switch, mirror-detect.       |
| `use-live-announcements.ts`      | 136   | ARIA live-region announcements for screen readers during analysis.         |
| `use-deferred-camera-release.ts` | 77    | Cancellable timer for delayed camera cleanup on tab switch.                |

## HOOK INTERACTION

```tree
CameraCapture.tsx
  ├─ useMediaStream()              → video stream, device list, mirror state
  ├─ useLiveAnalysis(videoRef)     → diagnosis, errors, step progress
  │     └─ calls analyzeTongueVideoFrame() from lib/pipeline.ts
  ├─ useLiveAnnouncements()        → screen reader output
  └─ useDeferredCameraRelease()    → tab-switch cleanup scheduling
```

## CONVENTIONS (beyond root)

- **Session-ID counters**: Both `useLiveAnalysis` and `useMediaStream` use monotonic counters to discard stale callbacks after stop/restart.
- **Frame deduplication**: `useLiveAnalysis` compares `video.currentTime` to skip duplicate frames at rAF rate.
- **Throttled state updates**: Live diagnosis updates throttled to 1s while rAF runs at display refresh rate.
- **Runtime type guards**: `isAnalysisError()` in `use-live-analysis.ts` mirrors the `AnalysisError` ADT with parallel const arrays + Sets for runtime validation from `catch` blocks.
- **Exhaustive switches**: Error message mapping uses compiler-enforced exhaustive `switch` over all error variants.

## NOTES

- `useLiveAnalysis` is the sole caller of `analyzeTongueVideoFrame()` — the only bridge from React to the video-mode pipeline.
- Debug overlay (DPR-aware bounding box + lip polygon drawing) only activates when `VITE_DEBUG_OVERLAY=true`.
- `useMediaStream` exposes `setError` for external error injection by `CameraCapture`.
- `useDeferredCameraRelease` uses cleanup-only `useEffect` (`() => clear`) for auto-teardown on unmount.
- `isFrontFacingTrack()` in `useMediaStream` uses `facingMode` then heuristic label matching (rear/back/environment) to decide mirroring.
