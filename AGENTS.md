# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-04 **Commit:** 896dd26 **Branch:** master

## OVERVIEW

Satirical Dutch tongue diagnosis SPA. User uploads tongue photo, seeded PRNG generates fake TCM diagnosis from file metadata (name, size, lastModified) — no actual image analysis. React 19 + Vite 8 beta + TypeScript 5.9 strict + Bun.

## STRUCTURE

```tree
tongue-analysis/
├── src/
│   ├── main.tsx                  # React 19 entry (StrictMode + createRoot)
│   ├── App.tsx                   # Root: phase state machine (discriminated union)
│   ├── App.css                   # All component styles (~590 lines, plain CSS)
│   ├── index.css                 # Global reset
│   ├── components/
│   │   ├── DiagnosisResults.tsx  # Results display
│   │   ├── Guide.tsx             # Interactive TCM guide
│   │   ├── LoadingSequence.tsx   # Fake analysis loading animation
│   │   ├── TongueMap.tsx         # Tongue zone SVG visualization
│   │   └── UploadArea.tsx        # File upload with drag/drop
│   ├── data/
│   │   └── tongue-types.ts       # TCM domain data (organs, elements, zones, tongue types)
│   └── lib/
│       └── diagnosis.ts          # Core engine: seeded PRNG (mulberry32), deterministic diagnosis
├── public/                       # Static assets (icons, OG image)
├── .github/workflows/pages.yml   # CI: bun install → tsc -b → vite build → GitHub Pages
├── index.html                    # Vite entry HTML (Dutch meta, OG tags, Google Fonts)
└── vite.config.ts                # React plugin + React Compiler + svg-to-ico + robots
```

## WHERE TO LOOK

| Task              | Location                      | Notes                                                       |
| ----------------- | ----------------------------- | ----------------------------------------------------------- |
| Diagnosis logic   | `src/lib/diagnosis.ts`        | Seeded PRNG from file metadata, all generation              |
| Domain data (TCM) | `src/data/tongue-types.ts`    | Organs, elements, meridians, tongue types                   |
| App state machine | `src/App.tsx`                 | `Phase` discriminated union: upload→preview→loading→results |
| Styles            | `src/App.css`                 | Single file, all component styles, section-divided          |
| CI/deploy         | `.github/workflows/pages.yml` | Triggers on `master`, path-filtered                         |
| TS strictness     | `tsconfig.app.json`           | `noUncheckedIndexedAccess`, `erasableSyntaxOnly`            |
| Lint rules        | `eslint.config.js`            | Flat config, `strictTypeChecked` + React plugins            |
| Formatting        | `.dprint.jsonc`               | Remote shared config from kjanat/kjanat repo                |

## CONVENTIONS

### TypeScript (deviations from defaults)

- **`erasableSyntaxOnly`**: No enums, no namespaces, no parameter properties
- **`noUncheckedIndexedAccess`**: Array/record index returns `T | undefined`
- **`verbatimModuleSyntax`**: Must use `import type` for type-only imports
- **Explicit extensions**: All local imports use `.ts`/`.tsx` extensions
- **No barrel files**: Every import points to the source file directly
- **`readonly` everywhere**: All interface fields, all arrays (`readonly T[]`), `Readonly<Record<K,V>>` for lookup tables
- **Discriminated unions**: `Phase` type with `kind` tag for app state machine
- **Type guards**: `isFileInfo(value: unknown): value is FileInfo` for runtime validation
- **`as const` only**: No `as Type` assertions, no `any`, no `!` non-null assertions

### React

- **`function` declarations** for components (not arrow functions)
- **Default exports** for components, named exports for everything else
- **Prop interfaces not exported** (private to module, defined above component)
- **`handle` prefix** for event handlers, **`on` prefix** for callback props
- **`data-*` attributes** for state-driven styling (not className toggling)
- **Explicit `type='button'`** on all `<button>` elements
- **`lang='zh'`** on Chinese text spans
- **React Compiler** enabled (`babel-plugin-react-compiler` in Vite config)

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

## COMMANDS

```bash
bun run dev       # Vite dev server
bun run build     # tsc -b && vite build
bun run lint      # eslint .
bun run preview   # Preview production build
bun run fmt       # dprint fmt
```

## NOTES

- **No tests**: Zero test infrastructure. Vitest would be natural fit if added.
- **No lint/fmt in CI**: Pipeline only runs build + deploy. Lint is local-only.
- **Vite 8 beta**: Pinned pre-release via `overrides` in package.json.
- **`master` branch**: Default branch is `master`, not `main`.
- **Robots blocked**: `vite-robots-txt` with `disallowAll` preset.
- **SessionStorage**: Used for phase persistence. Empty `catch` blocks are intentional (storage unavailable in restricted browsing).
- **Build plugins in wrong section**: `vite-robots-txt` and `vite-svg-to-ico` are in `dependencies` instead of `devDependencies`.
- **Dutch locale**: `lang="nl"` on HTML, all UI text in Dutch.
