# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-07 **Commit:** 782396c **Branch:** master

## OVERVIEW

Dutch tongue diagnosis SPA. User uploads/captures tongue photo; real ML pipeline (MediaPipe face
detection → HSV tongue segmentation → gray-world color correction → OKLCh classification) feeds a
satirical TCM diagnosis generator. React 19 + Vite 8 beta + TypeScript 5.9 strict + Bun.

Hosted on GitHub Pages at `https://kjanat.github.io/tongue-analysis/`,
CNAME `https://tong.kajkowalski.nl/`.

Preview builds are deployed to CF Pages on every PR automatically from Cloudflare's end to:

- `https://<8-char-SHA>.tongue-analysis.pages.dev`, e.g. `https://d200bead.tongue-analysis.pages.dev`
- `https://<truncated-branch-name>.tongue-analysis.pages.dev`, e.g. `https://claude-fix-camera-view-jumpi.tongue-analysis.pages.dev`

## STRUCTURE

```tree
tongue-analysis/
├── src/
│   ├── main.tsx                  # React 19 entry (StrictMode + createRoot)
│   ├── App.tsx                   # Root: 5-phase state machine (upload→preview→loading→results|error)
│   ├── App.css                   # All component styles (~1195 lines, plain CSS)
│   ├── index.css                 # Global reset + button font-family inherit
│   ├── components/               # 6 components — see src/components/AGENTS.md
│   │   ├── CameraCapture.tsx     # Live camera + real-time analysis (962 lines)
│   │   ├── DiagnosisResults.tsx  # Results display (181 lines)
│   │   ├── Guide.tsx             # Interactive TCM guide (127 lines)
│   │   ├── LoadingSequence.tsx   # 7-step analysis progress animation (86 lines)
│   │   ├── TongueMap.tsx         # Tongue zone SVG visualization (115 lines)
│   │   └── UploadArea.tsx        # File upload with drag/drop (120 lines)
│   ├── hooks/                    # 4 hooks — see src/hooks/AGENTS.md
│   │   ├── use-deferred-camera-release.ts  # Delayed camera cleanup on tab switch (81 lines)
│   │   ├── use-live-analysis.ts  # Real-time tongue analysis rAF loop (433 lines)
│   │   ├── use-live-announcements.ts  # ARIA screen reader announcements (123 lines)
│   │   └── use-media-stream.ts   # Camera stream lifecycle + device switching (534 lines)
│   ├── data/
│   │   └── tongue-types.ts       # TCM domain data (organs, elements, zones, tongue types)
│   ├── lib/                      # Core pipeline + utilities — see src/lib/AGENTS.md
│   ├── types/
│   │   ├── package-bindings.d.ts # SYNC: must match vite.package-bindings.ts virtualModuleSource()
│   │   └── vite-env.d.ts
│   └── assets/                   # SVGs (tongue-map.svg, tongue.svg)
├── cli/
│   └── analyze.ts                # Bun CLI entry (headless analysis, `bunx tongue-analysis`)
├── scripts/
│   └── build.ts                  # Custom build orchestrator (replaces raw `vite build`)
├── vite.package-bindings.ts      # 681-line custom Vite plugin for MediaPipe WASM asset resolution
├── public/                       # Static assets (icons, OG image)
├── integration/                  # Manual test fixture images (NOT automated tests, all gitignored)
├── .github/workflows/pages.yml   # CI: bun install → build → GitHub Pages deploy
├── index.html                    # Vite entry HTML (Dutch meta, OG tags, Google Fonts)
└── vite.config.ts                # React plugin + React Compiler + package-bindings + svg-to-ico
```

## WHERE TO LOOK

| Task               | Location                                   | Notes                                                    |
| ------------------ | ------------------------------------------ | -------------------------------------------------------- |
| Analysis pipeline  | `src/lib/`                                 | See `src/lib/AGENTS.md` for full pipeline breakdown      |
| App state machine  | `src/App.tsx`                              | `Phase` discriminated union, 5 variants with `kind` tag  |
| View transitions   | `src/lib/view-transition.ts`               | All `setPhase()` calls wrapped in `withViewTransition()` |
| Live camera        | `src/hooks/use-live-analysis.ts`           | Real-time video frame analysis loop                      |
| Camera stream      | `src/hooks/use-media-stream.ts`            | getUserMedia lifecycle, device enumeration               |
| ARIA announcements | `src/hooks/use-live-announcements.ts`      | Screen reader support during live analysis               |
| Camera cleanup     | `src/hooks/use-deferred-camera-release.ts` | Delayed camera release on tab switch                     |
| Debug overlay      | `src/lib/debug-overlay.ts`                 | DPR-aware bounding box + lip polygon canvas drawing      |
| Time formatting    | `src/lib/format-time.ts`                   | Shared Dutch locale time formatter                       |
| Math utilities     | `src/lib/math-utils.ts`                    | Shared `clamp()` used across pipeline stages             |
| Domain data (TCM)  | `src/data/tongue-types.ts`                 | Organs, elements, meridians, tongue type definitions     |
| Styles             | `src/App.css`                              | Single file, all component styles, section-divided       |
| MediaPipe assets   | `vite.package-bindings.ts`                 | WASM copy, model download, CDN fallback, virtual module  |
| Build script       | `scripts/build.ts`                         | Resolves env (GH Actions / CF Pages), runs tsc+vite      |
| CLI tool           | `cli/analyze.ts`                           | Headless analysis, polyfills `ImageData` for Bun runtime |
| CI/deploy          | `.github/workflows/pages.yml`              | Triggers on `master`, path-filtered, no lint/test gates  |
| TS strictness      | `tsconfig.app.json`                        | `noUncheckedIndexedAccess`, `erasableSyntaxOnly`         |
| Lint rules         | `eslint.config.js`                         | Flat config, `strictTypeChecked` + 4 React plugins       |
| Formatting         | `.dprint.jsonc`                            | Remote shared config from kjanat/kjanat repo             |

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
- **`as const satisfies`**: Const arrays with derived type aliases for runtime+compile-time safety

### React

- **`function` declarations** for components (not arrow functions)
- **Default exports** for components, named exports for everything else
- **Prop interfaces not exported** (private to module, defined above component)
- **`handle` prefix** for event handlers, **`on` prefix** for callback props
- **`data-*` attributes** for state-driven styling (not className toggling)
- **Explicit `type='button'`** on all `<button>` elements
- **`lang='zh'`** on Chinese text spans
- **React Compiler** enabled (`babel-plugin-react-compiler`)
- **`useId()`** for DOM IDs referenced by ARIA/SVG (no hardcoded ID strings)
- **View Transitions API** for phase changes — all `setPhase()` calls wrapped in `withViewTransition()`

### CSS

- **CSS custom properties** for animation timings (`--camera-hero-ms`, `--camera-modal-close-ms`, etc.), read at runtime via `getComputedStyle()`
- **GPU-composited transforms** preferred over layout-triggering properties (`transform: scaleX/scaleY` instead of `width`/`height` animations)
- **View transition pseudo-elements** (`::view-transition-*`) for cross-fade and hero animations between app phases

### Accessibility

- **`role='progressbar'`** with `aria-valuenow/min/max` on stepped progress indicators
- **`role='alert'`** on error containers for screen reader announcement
- **`role='img'`** with `aria-labelledby` on informational SVGs
- **`:focus-visible`** on interactive elements (not `:focus`)
- **`prefers-reduced-motion`** resets all animations/transitions and disables view transitions

### Naming

- Components: **PascalCase** `.tsx`
- Logic/data modules: **kebab-case** `.ts`
- Hooks: **`use-kebab-case`** `.ts`
- Module-level constants: **SCREAMING_SNAKE_CASE**
- CSS classes: **kebab-case**, BEM-ish
- Section dividers: `// ── Section Title ──────────────────`

### Formatting (dprint, NOT Prettier)

- **Tabs** (width 2), single quotes, LF
- Prettier explicitly disabled in `.zed/settings.json`
- Remote config: `github.com/kjanat/kjanat/configs/dprint.remote.json`

## ANTI-PATTERNS (THIS PROJECT)

- **No Prettier** — dprint only
- **No CSS modules/Tailwind/CSS-in-JS** — plain CSS with `data-*` state attributes
- **No implicit coercion in templates** — use `String()` explicitly
- **No `@ts-ignore`** — use `@ts-expect-error` with justification if unavoidable
- **No `eslint-disable`** — justified `eslint-disable-next-line` only (2 instances in `view-transition.ts` with explanations)

## COMMANDS

```bash
bun run dev       # Vite dev server (port 3000, strict)
bun run build     # Custom build: tsc -b → vite build (via scripts/build.ts)
bun run typecheck # tsgo --noEmit (native TS compiler preview)
bun run lint      # eslint .
bun run preview   # Full build + vite preview
bun run fmt       # dprint fmt
bun run analyze   # CLI tongue analysis (bun cli/analyze.ts)
bun run cf-build  # Cloudflare Pages build variant
```

## NOTES

- **No tests**: Zero test infrastructure. Vitest would be natural fit if added.
- **No lint/fmt in CI**: Pipeline only runs build + deploy. Lint is local-only.
- **Vite 8 beta**: Pinned pre-release via `overrides` in package.json.
- **`master` branch**: Default branch is `master`, not `main`.
- **Robots blocked**: `vite-robots-txt` with `disallowAll` preset.
- **Build plugins in wrong section**: `vite-robots-txt`, `vite-svg-to-ico` in `dependencies` instead of `devDependencies`. This is intentional by user. They are the user's own packages, and here for promo-type-shizz.
- **Dutch locale**: `lang="nl"` on HTML, all UI text in Dutch.
- **Sole `@ts-expect-error`**: `cli/analyze.ts:20` — intentional `ImageData` global polyfill for Bun runtime.
- **Two input paths**: File upload (`UploadArea`) and live camera (`CameraCapture`). Camera can bypass preview/loading via `onLiveDiagnosis`.
- **Closeup fallback**: If face detection fails, pipeline retries with full-image analysis and relaxed thresholds.
- **Build-time env vars**: `VITE_COMMIT_SHA`, `VITE_BUILD_DATE`, `VITE_DEBUG_OVERLAY` injected by `scripts/build.ts`.
- **Cloudflare support**: `cf-build` script and `CF_PAGES_*` env var support exist but no CF workflow deployed.
- **`types/package-bindings.d.ts`**: Must stay in sync with `virtualModuleSource()` in `vite.package-bindings.ts`. No automated verification — enforced by `SYNC:` comments only.
- **Three tsconfig zones**: `app` (src), `node` (vite config), `cli` (cli + scripts) — all via project references.
- **CLI shares browser source**: `cli/analyze.ts` imports from `src/lib/` and `src/data/` across tsconfig boundary.
- **Dual-purpose**: SPA + CLI tool (`bunx tongue-analysis`). Registered via `bin` field in package.json.
- **Build indirection**: `bun run build` → `bun bd` → `bun --bun scripts/build.ts` → spawns `tsc -b` + `vite build`.
- **`integration/` is misleading**: Contains local-only fixture images, not automated tests. All files gitignored.
- **Duplicated utilities**: `readGitCommitSha` in both `scripts/build.ts` and `vite.config.ts`; `parseBoolean` in both `scripts/build.ts` and `vite.package-bindings.ts`. Not shared — drift risk.
- **`tsgo` for typecheck**: `@typescript/native-preview` used for `bun run typecheck`, but `tsc -b` used in actual build. Two different TS compilers.
- **`gl` in devDependencies**: Native OpenGL bindings for headless WebGL / CLI canvas support.
- **Volta pin**: Node 24.13.0 pinned in package.json `volta` field.
- **Two `eslint-disable-next-line`**: Both in `view-transition.ts` — runtime browser feature guard + required `flushSync` for View Transitions API. Each has an inline justification comment.
- **Only `SYNC:` comments** as cross-file verification markers. No `TODO`, `FIXME`, `HACK`, `@ts-ignore`, `as any`.
