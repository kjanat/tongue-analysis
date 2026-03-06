#!/usr/bin/env bun

import { file, write } from 'bun';
import { spawn, spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const MODEL_URL =
	'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const MODEL_PATH = 'public/mediapipe/models/face_landmarker.task';
const PRODUCTION_BRANCHES = new Set(['master', 'main']);

interface BuildMetadata {
	readonly debugOverlay: string;
	readonly commitSha: string;
	readonly buildDate: string;
}

interface GithubEventPayload {
	readonly head_commit?: {
		readonly timestamp?: string;
	};
	readonly repository?: {
		readonly updated_at?: string;
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function getObjectProperty(value: unknown, key: string): object | undefined {
	if (!isRecord(value)) return undefined;
	const nested = value[key];
	if (typeof nested === 'object' && nested !== null) {
		return nested;
	}

	return undefined;
}

function getStringProperty(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) return undefined;
	const nested = value[key];
	if (typeof nested === 'string') {
		return nested;
	}

	return undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined;

	const normalized = value.trim().toLowerCase();
	if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
		return true;
	}

	if (
		normalized === '' || normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off'
	) {
		return false;
	}

	return undefined;
}

function normalizeTimestamp(value: string | undefined): string | undefined {
	if (value === undefined || value === '') return undefined;

	const parsed = Date.parse(value);
	if (Number.isNaN(parsed)) return undefined;

	return new Date(parsed).toISOString();
}

function trimOrUndefined(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	return trimmed === '' ? undefined : trimmed;
}

function readArgValue(name: string): string | undefined {
	const prefix = `--${name}=`;
	for (const arg of process.argv.slice(2)) {
		if (!arg.startsWith(prefix)) continue;
		return trimOrUndefined(arg.slice(prefix.length));
	}

	return undefined;
}

function formatBytes(value: number): string {
	const kb = value / 1024;
	if (kb < 1024) return `${kb.toFixed(1)} KiB`;
	return `${(kb / 1024).toFixed(2)} MiB`;
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function directorySizeBytes(directoryPath: string): Promise<number> {
	if (!(await exists(directoryPath))) {
		return 0;
	}

	let total = 0;
	const entries = await readdir(directoryPath, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = join(directoryPath, entry.name);

		if (entry.isDirectory()) {
			total += await directorySizeBytes(fullPath);
			continue;
		}

		if (!entry.isFile()) continue;

		const fileStats = await stat(fullPath);
		total += fileStats.size;
	}

	return total;
}

async function ensureModelFile(): Promise<void> {
	const modelExists = await exists(MODEL_PATH);
	const forceDownload = parseBoolean(process.env.BUILD_REFRESH_MODELS) === true;

	if (modelExists && !forceDownload) {
		console.log(`[build] model present: ${MODEL_PATH}`);
		return;
	}

	await mkdir(dirname(MODEL_PATH), { recursive: true });
	console.log(`[build] downloading model: ${MODEL_URL}`);

	try {
		const response = await fetch(MODEL_URL);
		if (!response.ok) {
			throw new Error(`model download failed with status ${String(response.status)}`);
		}

		const body = await response.arrayBuffer();
		const fileBuffer = Buffer.from(body);
		await write(MODEL_PATH, fileBuffer);
		console.log(`[build] model saved: ${MODEL_PATH} (${formatBytes(fileBuffer.byteLength)})`);
	} catch (error) {
		if (modelExists) {
			console.warn('[build] model download failed, continuing with existing local model:', error);
			return;
		}

		console.warn(
			`[build] model download failed and no local model at ${MODEL_PATH}; continuing with runtime fallback (${MODEL_URL})`,
			error,
		);
		return;
	}
}

function readGitCommitSha(): string | undefined {
	const result = spawnSync('git', ['rev-parse', 'HEAD'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
	});

	if (result.status !== 0) return undefined;
	return trimOrUndefined(result.stdout);
}

async function readGithubEventPayload(): Promise<GithubEventPayload | undefined> {
	const eventPath = trimOrUndefined(process.env.GITHUB_EVENT_PATH);
	if (eventPath === undefined) return undefined;

	try {
		const raw = await file(eventPath).text();
		const parsed: unknown = JSON.parse(raw);
		const headCommit = getObjectProperty(parsed, 'head_commit');
		const repository = getObjectProperty(parsed, 'repository');

		return {
			head_commit: headCommit === undefined
				? undefined
				: { timestamp: getStringProperty(headCommit, 'timestamp') },
			repository: repository === undefined
				? undefined
				: { updated_at: getStringProperty(repository, 'updated_at') },
		};
	} catch (error) {
		console.warn('[build] failed to parse GITHUB_EVENT_PATH:', error);
	}

	return undefined;
}

function resolveCommitSha(): string {
	const explicit = trimOrUndefined(process.env.VITE_COMMIT_SHA);
	if (explicit !== undefined) return explicit;

	const githubSha = trimOrUndefined(process.env.GITHUB_SHA);
	if (githubSha !== undefined) return githubSha;

	const cloudflareSha = trimOrUndefined(process.env.CF_PAGES_COMMIT_SHA) ?? trimOrUndefined(process.env.CF_COMMIT_SHA);
	if (cloudflareSha !== undefined) return cloudflareSha;

	return readGitCommitSha() ?? 'unknown';
}

async function resolveBuildDate(): Promise<string> {
	const explicit = normalizeTimestamp(trimOrUndefined(process.env.VITE_BUILD_DATE));
	if (explicit !== undefined) return explicit;

	const payload = await readGithubEventPayload();
	const fromHeadCommit = normalizeTimestamp(payload?.head_commit?.timestamp);
	if (fromHeadCommit !== undefined) return fromHeadCommit;

	const fromRepository = normalizeTimestamp(payload?.repository?.updated_at);
	if (fromRepository !== undefined) return fromRepository;

	return new Date().toISOString();
}

function resolveDebugOverlay(target: string): string {
	const explicit = parseBoolean(process.env.VITE_DEBUG_OVERLAY);
	if (explicit !== undefined) return explicit ? 'true' : '';

	const fromBuildDevMode = parseBoolean(process.env.BUILD_DEV_MODE);
	if (fromBuildDevMode !== undefined) return fromBuildDevMode ? 'true' : '';

	const buildEnv = trimOrUndefined(process.env.BUILD_ENV)?.toLowerCase();
	if (buildEnv === 'dev' || buildEnv === 'development' || buildEnv === 'preview') {
		return 'true';
	}

	if (target === 'cloudflare') {
		const cfBranch = trimOrUndefined(process.env.CF_PAGES_BRANCH);
		if (cfBranch !== undefined && !PRODUCTION_BRANCHES.has(cfBranch)) {
			return 'true';
		}
	}

	if (process.env.NODE_ENV === 'development') {
		return 'true';
	}

	return '';
}

async function run(command: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: 'inherit',
			env,
		});

		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(`command failed: ${command} ${args.join(' ')} (exit ${String(code)})`));
		});
	});
}

async function build(): Promise<void> {
	const target = readArgValue('target') ?? trimOrUndefined(process.env.BUILD_TARGET) ?? 'default';

	await ensureModelFile();

	const metadata: BuildMetadata = {
		debugOverlay: resolveDebugOverlay(target),
		commitSha: resolveCommitSha(),
		buildDate: await resolveBuildDate(),
	};

	console.log('[build] target:       ', target);
	console.log('[build] debug overlay:', metadata.debugOverlay === 'true' ? 'enabled' : 'disabled');
	console.log('[build] commit sha:   ', metadata.commitSha);
	console.log('[build] build date:   ', metadata.buildDate);

	const bunExecutable = process.execPath;
	await run(bunExecutable, ['run', 'tsc', '-b']);
	await run(bunExecutable, ['run', 'vite', 'build'], {
		...process.env,
		VITE_DEBUG_OVERLAY: metadata.debugOverlay,
		VITE_COMMIT_SHA: metadata.commitSha,
		VITE_BUILD_DATE: metadata.buildDate,
	});

	const distSize = await directorySizeBytes('dist');
	console.log(`[build] dist size: ${formatBytes(distSize)} (${String(distSize)} bytes)`);
}

try {
	await build();
} catch (error) {
	console.error('[build] failed:', error);
	process.exit(1);
}
