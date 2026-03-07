# src/hooks — React Hooks

Bridge between React UI and the ML analysis pipeline. 4 hooks, ~1,110 lines total.

## WHERE TO LOOK

| File                             | Lines | Role                                                                       |
| -------------------------------- | ----- | -------------------------------------------------------------------------- |
| `use-live-analysis.ts`           | 492   | rAF loop driving `analyzeTongueVideoFrame()` on live video. Heaviest hook. |
| `use-media-stream.ts`            | 413   | `getUserMedia` lifecycle: acquire, enumerate, switch, mirror-detect.       |
| `use-live-announcements.ts`      | 123   | ARIA live-region announcements for screen readers during analysis.         |
| `use-deferred-camera-release.ts` | 81    | Cancellable timer for delayed camera cleanup on tab switch.                |

## HOOK INTERACTION

```tree
CameraCapture.tsx
  ├─ useMediaStream()              → video stream, device list, mirror state
  ├─ useLiveAnalysis(videoRef)     → diagnosis, errors, step progress
  │     └─ calls analyzeTongueVideoFrame() from lib/pipeline.ts
  │     └─ delegates debug drawing to lib/debug-overlay.ts
  ├─ useLiveAnnouncements()        → screen reader output
  └─ useDeferredCameraRelease()    → tab-switch cleanup scheduling
```

## CONVENTIONS (beyond root)

- **Session-ID counters**: Both `useLiveAnalysis` and `useMediaStream` use monotonic counters to discard stale callbacks after stop/restart.
- **Frame deduplication**: `useLiveAnalysis` compares `video.currentTime` to skip duplicate frames at rAF rate.
- **Throttled state updates**: Live diagnosis updates throttled to 1s while rAF runs at display refresh rate.
- **Runtime type guards**: `isAnalysisError()` in `use-live-analysis.ts` mirrors the `AnalysisError` ADT with `as const satisfies` arrays + derived type aliases for compile-time exhaustiveness.
- **Exhaustive switches**: Error message mapping uses compiler-enforced exhaustive `switch` with `never` guards on all variants.
- **`useLayoutEffect` for ref sync**: `use-deferred-camera-release.ts` syncs callback ref via `useLayoutEffect` to satisfy React Compiler lint rules (no ref writes during render).
- **Shared time formatting**: Both `CameraCapture` and `useLiveAnnouncements` import `formatUpdateTime` from `lib/format-time.ts` (deduplicated).

## NOTES

- `useLiveAnalysis` is the sole caller of `analyzeTongueVideoFrame()` — the only bridge from React to the video-mode pipeline.
- Debug overlay drawing (DPR-aware bounding box + lip polygon) extracted to `src/lib/debug-overlay.ts`. Only activates when `VITE_DEBUG_OVERLAY=true`.
- `useMediaStream` exposes `setError` for external error injection by `CameraCapture`.
- `useDeferredCameraRelease` uses cleanup-only `useEffect` (`() => clear`) for auto-teardown on unmount.
- `isFrontFacingTrack()` in `useMediaStream` uses `facingMode` then heuristic label matching (rear/back/environment) to decide mirroring.
