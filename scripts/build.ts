#!/usr/bin/env bun

/**
 * @module
 * Custom build orchestrator that resolves build metadata from CI environments
 * (GitHub Actions, Cloudflare Pages) or local git, then runs `tsc -b` and
 * `vite build` with injected env vars.
 *
 * Invoked via `bun run build` → `bun --bun scripts/build.ts`.
 */

import { spawn, spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Branch names that are considered production deployments. Non-production
 * branches get the debug overlay enabled by default on Cloudflare Pages.
 */
const PRODUCTION_BRANCHES = new Set(['master', 'main']);

/**
 * Resolved build-time values injected as `VITE_*` env vars into the
 * Vite build process.
 *
 * @see {@link build}
 */
interface BuildMetadata {
	/** `"true"` to enable debug overlay, `""` to disable */
	readonly debugOverlay: string;
	/** Full git commit SHA for version display */
	readonly commitSha: string;
	/** ISO 8601 build timestamp */
	readonly buildDate: string;
}

/**
 * Subset of the GitHub Actions event payload (from `$GITHUB_EVENT_PATH`)
 * used to extract deterministic timestamps for reproducible builds.
 */
interface GithubEventPayload {
	readonly head_commit?: {
		readonly timestamp?: string;
	};
	readonly repository?: {
		readonly updated_at?: string;
	};
}

/**
 * Type guard for plain objects. Used for safe JSON payload traversal.
 *
 * @param value - Value to check
 * @returns `true` if `value` is a non-null object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * Safely extracts a nested object property from an unknown value.
 *
 * @param value - Parent value to inspect
 * @param key - Property key to extract
 * @returns The nested object, or `undefined` if not found or not an object
 */
function getObjectProperty(value: unknown, key: string): object | undefined {
	if (!isRecord(value)) return undefined;
	const nested = value[key];
	if (typeof nested === 'object' && nested !== null) {
		return nested;
	}

	return undefined;
}

/**
 * Safely extracts a string property from an unknown value.
 *
 * @param value - Parent value to inspect
 * @param key - Property key to extract
 * @returns The string value, or `undefined` if not found or not a string
 */
function getStringProperty(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) return undefined;
	const nested = value[key];
	if (typeof nested === 'string') {
		return nested;
	}

	return undefined;
}

/**
 * Parses a string env var into a boolean using common truthy/falsy conventions.
 *
 * @param value - Raw string value (e.g. `"true"`, `"0"`, `"yes"`)
 * @returns `true`, `false`, or `undefined` if unrecognized
 */
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

/**
 * Parses a date string and normalizes it to ISO 8601 format.
 * Rejects unparseable values rather than producing invalid dates.
 *
 * @param value - Raw date string from env or event payload
 * @returns ISO 8601 string, or `undefined` if input is empty/unparseable
 */
function normalizeTimestamp(value: string | undefined): string | undefined {
	if (value === undefined || value === '') return undefined;

	const parsed = Date.parse(value);
	if (Number.isNaN(parsed)) return undefined;

	return new Date(parsed).toISOString();
}

/**
 * Trims whitespace and coerces empty strings to `undefined`.
 * Standardizes env var reading to avoid blank-but-defined pitfalls.
 *
 * @param value - Raw string (typically from `process.env`)
 * @returns Trimmed string, or `undefined` if blank/missing
 */
function trimOrUndefined(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	return trimmed === '' ? undefined : trimmed;
}

/**
 * Reads a CLI argument value. Supports both `--name=value` and `--name value` forms.
 *
 * @param name - Argument name without `--` prefix
 * @returns Trimmed value, or `undefined` if not provided
 *
 * @example
 * ```ts
 * // bun scripts/build.ts --target=cloudflare
 * readArgValue('target') // => "cloudflare"
 * ```
 */
function readArgValue(name: string): string | undefined {
	const prefix = `--${name}=`;
	const exact = `--${name}`;
	const args = process.argv.slice(2);

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === undefined) continue;

		if (arg.startsWith(prefix)) {
			return trimOrUndefined(arg.slice(prefix.length));
		}

		if (arg === exact) {
			return trimOrUndefined(args[i + 1]);
		}
	}

	return undefined;
}

/**
 * Formats a byte count as a human-readable string (KiB or MiB).
 *
 * @param value - Size in bytes
 * @returns Formatted string, e.g. `"142.3 KiB"` or `"1.52 MiB"`
 */
function formatBytes(value: number): string {
	const kb = value / 1024;
	if (kb < 1024) return `${kb.toFixed(1)} KiB`;
	return `${(kb / 1024).toFixed(2)} MiB`;
}

/**
 * Async file/directory existence check using `fs.access`.
 *
 * @param path - Absolute path to check
 * @returns `true` if the path exists and is accessible
 */
async function exists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Recursively sums the size of all files in a directory.
 * Used to report `dist/` bundle size after build.
 *
 * @param directoryPath - Absolute directory path to measure
 * @returns Total size in bytes (0 if directory doesn't exist)
 */
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

/**
 * Reads the current git HEAD SHA via `git rev-parse HEAD`.
 * Fallback when no CI-provided SHA is available.
 *
 * @returns Full 40-char SHA, or `undefined` if git fails
 */
function readGitCommitSha(): string | undefined {
	const result = spawnSync('git', ['rev-parse', 'HEAD'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
	});

	if (result.status !== 0) return undefined;
	return trimOrUndefined(result.stdout);
}

/**
 * Reads and parses the GitHub Actions event payload from `$GITHUB_EVENT_PATH`.
 * Extracts only the timestamp fields needed for deterministic build dates.
 *
 * @returns Parsed payload subset, or `undefined` if not in GitHub Actions or parsing fails
 */
async function readGithubEventPayload(): Promise<GithubEventPayload | undefined> {
	const eventPath = trimOrUndefined(process.env.GITHUB_EVENT_PATH);
	if (eventPath === undefined) return undefined;

	try {
		const raw = await readFile(eventPath, 'utf8');
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

/**
 * Resolves the commit SHA from the first available source:
 * `VITE_COMMIT_SHA` → `GITHUB_SHA` → `CF_PAGES_COMMIT_SHA` → `CF_COMMIT_SHA` → local git → `"unknown"`.
 *
 * @returns Commit SHA string (never undefined)
 */
function resolveCommitSha(): string {
	const explicit = trimOrUndefined(process.env.VITE_COMMIT_SHA);
	if (explicit !== undefined) return explicit;

	const githubSha = trimOrUndefined(process.env.GITHUB_SHA);
	if (githubSha !== undefined) return githubSha;

	const cloudflareSha = trimOrUndefined(process.env.CF_PAGES_COMMIT_SHA) ?? trimOrUndefined(process.env.CF_COMMIT_SHA);
	if (cloudflareSha !== undefined) return cloudflareSha;

	return readGitCommitSha() ?? 'unknown';
}

/**
 * Resolves the build date from the first available source:
 * `VITE_BUILD_DATE` → GitHub event `head_commit.timestamp` → `repository.updated_at` → `new Date()`.
 * Prefers CI-provided timestamps for reproducibility.
 *
 * @returns ISO 8601 timestamp string
 */
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

/**
 * Determines whether the debug overlay should be enabled. Checks multiple
 * env vars in priority order, with special handling for Cloudflare Pages
 * non-production branches.
 *
 * @param target - Build target (`"default"` or `"cloudflare"`)
 * @returns `"true"` to enable, `""` (empty string) to disable
 */
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

/**
 * Spawns a child process with inherited stdio and rejects on non-zero exit.
 *
 * @param command - Executable path
 * @param args - Command arguments
 * @param env - Optional environment variables (defaults to inherited)
 */
async function run(command: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: 'inherit',
			env: env ? { ...process.env, ...env } : undefined,
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

/**
 * Main build entry point. Resolves metadata, runs `tsc -b` for type checking,
 * then `vite build` with injected env vars. Logs final `dist/` size.
 *
 * Accepts `--target` CLI arg or `BUILD_TARGET` env var (default: `"default"`).
 */
async function build(): Promise<void> {
	const target = readArgValue('target') ?? trimOrUndefined(process.env.BUILD_TARGET) ?? 'default';

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
	await run(bunExecutable, ['--bun', 'run', 'vite', 'build'], {
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
