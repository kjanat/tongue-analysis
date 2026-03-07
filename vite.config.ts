/**
 * @module
 * Vite configuration for the tongue-analysis SPA — wires up MediaPipe WASM
 * asset resolution, React Compiler, SVG-to-ICO favicon generation, and
 * build-time env var injection.
 */

import react from '@vitejs/plugin-react';
import { spawnSync } from 'node:child_process';
import { env } from 'node:process';
import { defineConfig } from 'vite';
import robot from 'vite-robots-txt';
import svg from 'vite-svg-to-ico';
import { packageBindingsPlugin } from './vite.package-bindings.ts';

/**
 * Vite config factory. Switches asset strategy based on `command`:
 * dev server self-hosts WASM assets; production builds use jsdelivr CDN as primary.
 *
 * Injects three build-time env vars via `define`:
 * - `VITE_DEBUG_OVERLAY` — `"true"` in dev, from env otherwise
 * - `VITE_COMMIT_SHA` — current git HEAD or env override
 * - `VITE_BUILD_DATE` — ISO 8601 timestamp
 *
 * @see {@link readGitCommitSha} for SHA resolution fallback
 * @see {@link packageBindingsPlugin} for WASM/model asset handling
 */
export default defineConfig(({ command }) => {
	return {
		define: {
			'import.meta.env.VITE_DEBUG_OVERLAY': JSON.stringify(
				env.VITE_DEBUG_OVERLAY ?? (String(command === 'serve')),
			),
			'import.meta.env.VITE_COMMIT_SHA': JSON.stringify(
				env.VITE_COMMIT_SHA ?? readGitCommitSha() ?? 'sha-err',
			),
			'import.meta.env.VITE_BUILD_DATE': JSON.stringify(
				env.VITE_BUILD_DATE ?? new Date().toISOString(),
			),
		},
		plugins: [
			packageBindingsPlugin({
				assets: [{
					package: '@mediapipe/tasks-vision',
					path: 'wasm',
					cdn: 'jsdelivr',
					primary: command === 'serve' ? 'self' : 'cdn',
				}],
				downloads: [{
					id: 'face-landmarker-model',
					url:
						'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
				}],
			}),
			react({
				babel: {
					plugins: [['babel-plugin-react-compiler']],
					targets: { browsers: ['baseline widely available'] },
				},
			}),
			svg({
				input: 'src/assets/tongue.svg',
				emit: { inject: true, source: true },
				sharp: { resize: { kernel: 'nearest' } },
			}),
			robot({ preset: 'disallowAll' }),
		],
		server: {
			port: 3000,
			strictPort: true,
			host: true,
			allowedHosts: true,
		},
	};
});

/**
 * Shells out to `git rev-parse HEAD` to read the current commit SHA.
 * Used as last-resort fallback when neither `VITE_COMMIT_SHA` env var
 * nor CI-provided values are available.
 *
 * @returns Full 40-char SHA, or `undefined` if git is unavailable or not in a repo.
 *
 * @example
 * ```ts
 * const sha = readGitCommitSha() ?? 'sha-err';
 * ```
 */
function readGitCommitSha(): string | undefined {
	const result = spawnSync('git', ['rev-parse', 'HEAD'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
	});

	if (result.status !== 0) return undefined;
	return result.stdout.trim() || undefined;
}
