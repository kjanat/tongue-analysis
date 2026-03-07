/**
 * @module
 * Vite environment variable type augmentations. Extends the built-in
 * `ImportMetaEnv` with project-specific build-time variables injected
 * by {@link vite.config.ts} and {@link scripts/build.ts}.
 */

/// <reference types="vite/client" />

/**
 * Build-time environment variables injected via Vite's `define` config.
 * All values are JSON-stringified at build time, so they arrive as
 * strings at runtime.
 *
 * @see {@link vite.config.ts} for injection logic
 * @see {@link scripts/build.ts} for resolution order
 */
interface ImportMetaEnv {
	/** `"true"` when the debug overlay should be visible. Enabled by default in dev, disabled in production. */
	readonly VITE_DEBUG_OVERLAY?: string;
	/** Full git commit SHA for version display. Falls back to `"sha-err"` if unavailable. */
	readonly VITE_COMMIT_SHA?: string;
	/** ISO 8601 build timestamp for version display. */
	readonly VITE_BUILD_DATE?: string;
}

/** Augments Vite's `ImportMeta` with typed env access. */
interface ImportMeta {
	readonly env: ImportMetaEnv;
}
