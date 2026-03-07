import react from '@vitejs/plugin-react';
import { spawnSync } from 'node:child_process';
import { env } from 'node:process';
import { defineConfig } from 'vite';
import robot from 'vite-robots-txt';
import svg from 'vite-svg-to-ico';
import { packageBindingsPlugin } from './vite.package-bindings.ts';

function readGitCommitSha(): string | undefined {
	const result = spawnSync('git', ['rev-parse', 'HEAD'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
	});

	if (result.status !== 0) return undefined;
	return result.stdout.trim() || undefined;
}

// https://vite.dev/config/
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
			allowedHosts: ['propc-manjaro', '192.168.1.2'],
			host: '0.0.0.0',
			port: 3000,
			strictPort: true,
		},
	};
});
