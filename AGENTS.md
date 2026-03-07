# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-07 **Commit:** e362520 **Branch:** master

## OVERVIEW

Dutch tongue diagnosis SPA. User uploads/captures tongue photo; real ML pipeline (MediaPipe face
detection → HSV tongue segmentation → gray-world color correction → OKLCh classification) feeds a
satirical TCM diagnosis generator. React 19 + Vite 8 beta + TypeScript 5.9 strict + Bun.

Hosted on GitHub Pages at `https://kjanat.github.io/tongue-analysis/`,
CNAME `https://tong.kajkowalski.nl/`.

## STRUCTURE

```tree
tongue-analysis/
├── src/
│   ├── main.tsx                  # React 19 entry (StrictMode + createRoot)
│   ├── App.tsx                   # Root: 5-phase state machine (upload→preview→loading→results|error)
│   ├── App.css                   # All component styles (~930 lines, plain CSS)
│   ├── index.css                 # Global reset
│   ├── components/
│   │   ├── CameraCapture.tsx     # Live camera with real-time analysis (430 lines)
│   │   ├── DiagnosisResults.tsx  # Results display
│   │   ├── Guide.tsx             # Interactive TCM guide
│   │   ├── LoadingSequence.tsx   # 7-step analysis progress animation
│   │   ├── TongueMap.tsx         # Tongue zone SVG visualization
│   │   └── UploadArea.tsx        # File upload with drag/drop
│   ├── hooks/
│   │   ├── use-live-analysis.ts  # MediaPipe pipeline for live video frames (439 lines)
│   │   └── use-media-stream.ts   # Camera stream lifecycle management (313 lines)
│   ├── data/
│   │   └── tongue-types.ts       # TCM domain data (organs, elements, zones, tongue types)
│   ├── lib/                      # Core pipeline — see src/lib/AGENTS.md
│   ├── types/
│   │   ├── package-bindings.d.ts # SYNC: must match vite.package-bindings.ts virtualModuleSource()
│   │   └── vite-env.d.ts
│   └── assets/                   # SVGs (tongue-map.svg, tongue.svg)
├── cli/
│   └── analyze.ts                # Bun CLI entry (headless analysis, `bunx tongue-analysis`)
├── scripts/
│   └── build.ts                  # Custom build orchestrator (replaces raw `vite build`)
├── vite.package-bindings.ts      # 460-line custom Vite plugin for MediaPipe WASM asset resolution
├── public/                       # Static assets (icons, OG image)
├── integration/                  # Manual test fixture images (not automated tests)
├── .github/workflows/pages.yml   # CI: bun install → build → GitHub Pages deploy
├── index.html                    # Vite entry HTML (Dutch meta, OG tags, Google Fonts)
└── vite.config.ts                # React plugin + React Compiler + package-bindings + svg-to-ico
```

## WHERE TO LOOK

| Task                 | Location                          | Notes                                                      |
| -------------------- | --------------------------------- | ---------------------------------------------------------- |
| Analysis pipeline    | `src/lib/pipeline.ts`             | Orchestrates all ML steps; `Result<T,E>` error handling    |
| Face detection       | `src/lib/face-detection.ts`       | MediaPipe FaceLandmarker, mouth region extraction          |
| Tongue segmentation  | `src/lib/tongue-segmentation.ts`  | HSV thresholding, connected components, centroid heuristic |
| Color correction     | `src/lib/color-correction.ts`     | Gray-world algorithm on masked tongue pixels               |
| Color classification | `src/lib/color-classification.ts` | OKLCh distance to TCM tongue types, confidence scoring     |
| Diagnosis generator  | `src/lib/diagnosis.ts`            | Seeded PRNG, maps classification → TCM diagnosis           |
| Legacy color         | `src/lib/color-analysis.ts`       | Canvas center-crop RGB→HSL extraction                      |
| Legacy matching      | `src/lib/color-matching.ts`       | HSL distance, weight boosting (used by old PRNG path)      |
| Result type          | `src/lib/result.ts`               | 17-line `Result<T,E>` discriminated union (`ok`/`err`)     |
| App state machine    | `src/App.tsx`                     | `Phase` discriminated union, 5 variants with `kind` tag    |
| Live camera          | `src/hooks/use-live-analysis.ts`  | Real-time video frame analysis loop                        |
| Camera stream        | `src/hooks/use-media-stream.ts`   | getUserMedia lifecycle, device enumeration                 |
| Domain data (TCM)    | `src/data/tongue-types.ts`        | Organs, elements, meridians, tongue type definitions       |
| Styles               | `src/App.css`                     | Single file, all component styles, section-divided         |
| MediaPipe assets     | `vite.package-bindings.ts`        | WASM copy, model download, CDN fallback, virtual module    |
| Build script         | `scripts/build.ts`                | Resolves env (GH Actions / CF Pages), runs tsc+vite        |
| CLI tool             | `cli/analyze.ts`                  | Headless analysis, polyfills `ImageData` for Bun runtime   |
| CI/deploy            | `.github/workflows/pages.yml`     | Triggers on `master`, path-filtered, no lint/test gates    |
| TS strictness        | `tsconfig.app.json`               | `noUncheckedIndexedAccess`, `erasableSyntaxOnly`           |
| Lint rules           | `eslint.config.js`                | Flat config, `strictTypeChecked` + 4 React plugins         |
| Formatting           | `.dprint.jsonc`                   | Remote shared config from kjanat/kjanat repo               |

## CONVENTIONS

### TypeScript (deviations from defaults)

- **`erasableSyntaxOnly`**: No enums, no namespaces, no parameter properties
- **`noUncheckedIndexedAccess`**: Array/record index returns `T | undefined`
- **`verbatimModuleSyntax`**: Must use `import type` for type-only imports
- **Explicit extensions**: All local imports use `.ts`/`.tsx` extensions
- **No barrel files**: Every import points to the source file directly
- **`readonly` everywhere**: All interface fields, all arrays (`readonly T[]`), `Readonly<Record<K,V>>`
- **Discriminated unions**: `Phase`, `Result`, all error types use `kind` tag
- **`as const` only**: No `as Type` assertions, no `any`, no `!` non-null assertions
- **`Result<T,E>` for expected failures**: Pipeline uses `ok()`/`err()`, not try/catch

### React

- **`function` declarations** for components (not arrow functions)
- **Default exports** for components, named exports for everything else
- **Prop interfaces not exported** (private to module, defined above component)
- **`handle` prefix** for event handlers, **`on` prefix** for callback props
- **`data-*` attributes** for state-driven styling (not className toggling)
- **Explicit `type='button'`** on all `<button>` elements
- **`lang='zh'`** on Chinese text spans
- **React Compiler** enabled (`babel-plugin-react-compiler`)

### Naming

- Components: **PascalCase** `.tsx`
- Logic/data modules: **kebab-case** `.ts`
- Module-level constants: **SCREAMING_SNAKE_CASE**
- CSS classes: **kebab-case**, BEM-ish
- Section dividers: `// ── Section Title ──────────────────`

### Formatting (dprint, NOT Prettier)

- **Tabs** (width 2), single quotes, LF
- Prettier explicitly disabled in `.zed/settings.json`
- Remote config: `github.com/kjanat/kjanat/configs/dprint.remote.json`

## ANTI-PATTERNS (THIS PROJECT)

- **No `any`** — enforced by `strictTypeChecked`
- **No `!` non-null assertions** — use `?.` or explicit null checks
- **No `as Type` assertions** — only `as const` allowed
- **No enums/namespaces** — enforced by `erasableSyntaxOnly`
- **No Prettier** — dprint only
- **No CSS modules/Tailwind/CSS-in-JS** — plain CSS with `data-*` state attributes
- **No barrel files** — no `index.ts` re-exports
- **No implicit coercion in templates** — use `String()` explicitly
- **No try/catch for expected failures** — use `Result<T,E>` from `src/lib/result.ts`

## COMMANDS

```bash
bun run dev       # Vite dev server (port 3000, strict)
bun run build     # Custom build: tsc -b → vite build (via scripts/build.ts)
bun run lint      # eslint .
bun run preview   # Full build + vite preview
bun run fmt       # dprint fmt
bun run cf-build  # Cloudflare Pages build variant
```

## NOTES

- **No tests**: Zero test infrastructure. Vitest would be natural fit if added.
- **No lint/fmt in CI**: Pipeline only runs build + deploy. Lint is local-only.
- **Vite 8 beta**: Pinned pre-release via `overrides` in package.json.
- **`master` branch**: Default branch is `master`, not `main`.
- **Robots blocked**: `vite-robots-txt` with `disallowAll` preset.
- **Empty `catch` blocks intentional**: SessionStorage may be unavailable in restricted browsing.
- **Build plugins in wrong section**: `vite-robots-txt`, `vite-svg-to-ico`, `hex-to-oklch` in `dependencies` instead of `devDependencies`.
- **Dutch locale**: `lang="nl"` on HTML, all UI text in Dutch.
- **Sole `@ts-expect-error`**: `cli/analyze.ts:10` — intentional `ImageData` global polyfill for Bun runtime.
- **Two input paths**: File upload (`UploadArea`) and live camera (`CameraCapture`). Camera can bypass preview/loading via `onLiveDiagnosis`.
- **Closeup fallback**: If face detection fails, pipeline retries with full-image analysis and relaxed thresholds.
- **Build-time env vars**: `VITE_COMMIT_SHA`, `VITE_BUILD_DATE`, `VITE_DEBUG_OVERLAY` injected by `scripts/build.ts`.
- **Cloudflare support**: `cf-build` script and `CF_PAGES_*` env var support exist but no CF workflow deployed.
- **`types/package-bindings.d.ts`**: Must stay in sync with `virtualModuleSource()` in `vite.package-bindings.ts`.
