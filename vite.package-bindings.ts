/**
 * @module
 * Custom Vite plugin that resolves npm package assets (WASM files, ML models)
 * at build time, copies them into the output bundle, and exposes a virtual
 * module (`virtual:package-bindings`) for runtime URL resolution with
 * self-hosted/CDN fallback.
 *
 * The virtual module's runtime shape is declared in
 * `src/types/package-bindings.d.ts` and must stay in sync with
 * {@link generateVirtualModule}.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

// ── Public types ─────────────────────────────────────────────

/**
 * Controls whether the self-hosted copy or CDN URL is used as the primary
 * source at runtime. The other becomes the fallback.
 */
type AssetPrimary = 'self' | 'cdn';

/**
 * Configuration for a single npm package asset to be bundled and exposed
 * via the virtual module.
 *
 * @see {@link PackageBindingsPluginOptions}
 */
export interface PackageAssetConfig {
	/** npm package name, e.g. `"@mediapipe/tasks-vision"` */
	readonly package: string;
	/** Path within the package to the asset file or directory, e.g. `"wasm"` */
	readonly path: string;
	/** CDN provider for fallback/primary URL. Only jsdelivr is supported. */
	readonly cdn: 'jsdelivr';
	/** Whether self-hosted or CDN is primary (default: `'self'`) */
	readonly primary?: AssetPrimary;
}

/**
 * Configuration for a downloadable asset (e.g. ML model) that is fetched
 * at build time and cached locally.
 *
 * @see {@link PackageBindingsPluginOptions}
 */
export interface DownloadConfig {
	/** Stable binding id for runtime lookup via {@link getDownloadBinding} */
	readonly id: string;
	/** Absolute HTTP(S) URL for the downloadable asset */
	readonly url: string;
	/** Optional project-relative file path where the asset should be stored. Defaults to `.cache/package-bindings/downloads/<id><ext>`. */
	readonly path?: string;
}

/**
 * Top-level options for {@link packageBindingsPlugin}.
 */
export interface PackageBindingsPluginOptions {
	/** Package assets to copy into the bundle and serve via CDN fallback */
	readonly assets: readonly PackageAssetConfig[];
	/** Remote assets to download at build time and bundle */
	readonly downloads?: readonly DownloadConfig[];
}

// ── Internal types ───────────────────────────────────────────

/**
 * Fully resolved representation of a {@link PackageAssetConfig} after
 * locating the package on disk and computing mount paths.
 */
interface ResolvedAsset {
	/** npm package name */
	readonly packageName: string;
	/** Resolved semver version from the installed package.json */
	readonly version: string;
	/** Normalized forward-slash path within the package */
	readonly assetPath: string;
	/** Whether the asset path points to a directory (files are enumerated recursively) */
	readonly isDirectory: boolean;
	/** URL path segment where the asset is mounted in the dev server / bundle, e.g. `"pkg-assets/@mediapipe/tasks-vision/0.10.0/wasm"` */
	readonly localMountPath: string;
	/** Full jsdelivr CDN URL for this asset */
	readonly cdnUrl: string;
	/** Which URL source is primary at runtime */
	readonly primary: AssetPrimary;
	/** Individual files to emit, with absolute disk path and output bundle path */
	readonly files: readonly { readonly absolutePath: string; readonly emittedPath: string }[];
}

/**
 * Fully resolved representation of a {@link DownloadConfig} after
 * computing cache paths and bundle output paths.
 */
interface ResolvedDownload {
	/** Normalized download identifier */
	readonly id: string;
	/** Remote URL to fetch the asset from */
	readonly url: string;
	/** Project-relative cache path for the downloaded file */
	readonly outputPath: string;
	/** Absolute disk path for the cached download */
	readonly absolutePath: string;
	/** Output path within the Vite bundle */
	readonly emittedPath: string;
}

// ── Helpers ──────────────────────────────────────────────────

/** Vite virtual module specifier used in application `import` statements. */
const VIRTUAL_MODULE_ID = 'virtual:package-bindings';

/**
 * Vite-internal resolved id. The `\0` prefix is a Rollup convention that
 * prevents other plugins from processing this module.
 */
const RESOLVED_ID = `\0${VIRTUAL_MODULE_ID}`;

/** URL path prefix for self-hosted package assets in the bundle output. */
const MOUNT_BASE = 'pkg-assets';

/** URL path prefix for downloaded (non-npm) assets in the bundle output. */
const DOWNLOAD_MOUNT_BASE = 'download-assets';

/**
 * Parses a string env var into a boolean using common truthy/falsy conventions.
 * Returns `undefined` for unrecognized values to allow fallthrough in config resolution chains.
 *
 * @param value - Raw string value (e.g. `"true"`, `"0"`, `"yes"`)
 * @returns `true`, `false`, or `undefined` if the value doesn't match any known pattern
 */
function parseBoolean(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined;
	const trueValues = new Set(['1', 'true', 'yes', 'on']);
	const falseValues = new Set(['', '0', 'false', 'no', 'off']);

	const normalized = value.trim().toLowerCase();
	if (trueValues.has(normalized)) return true;
	if (falseValues.has(normalized)) return false;

	return undefined;
}

/**
 * Security check: verifies that `absolutePath` does not escape `rootPath`
 * via `..` traversal. Prevents asset configs from reading arbitrary files.
 *
 * @param rootPath - Trusted root directory (package root or project root)
 * @param absolutePath - Candidate path to validate
 * @returns `true` if `absolutePath` is within or equal to `rootPath`
 */
function isWithinRoot(rootPath: string, absolutePath: string): boolean {
	const relativePath = path.relative(rootPath, absolutePath);
	if (relativePath === '') return true;
	if (relativePath.startsWith('..')) return false;
	return !path.isAbsolute(relativePath);
}

/**
 * Validates and normalizes a download identifier. IDs are restricted to
 * `[A-Za-z0-9._-]` to ensure safe use as filenames and map keys.
 *
 * @param value - Raw download id string
 * @returns Trimmed, validated id
 * @throws If the id is empty or contains invalid characters
 */
function normalizeDownloadId(value: string): string {
	const normalized = value.trim();
	if (normalized === '') {
		throw new Error('[package-bindings] download id must not be empty.');
	}
	if (!/^[A-Za-z0-9._-]+$/.test(normalized)) {
		throw new Error(`[package-bindings] invalid download id '${value}'. Use [A-Za-z0-9._-].`);
	}

	return normalized;
}

/**
 * Derives a default cache path for a download when no explicit
 * {@link DownloadConfig.path} is provided. Uses the URL's file extension
 * (or `.bin` if none) under `.cache/package-bindings/downloads/`.
 *
 * @param downloadId - Normalized download identifier (used as filename stem)
 * @param downloadUrl - Remote URL (extension is extracted from its pathname)
 * @returns Project-relative cache path, e.g. `".cache/package-bindings/downloads/face-landmarker-model.task"`
 */
function defaultDownloadOutputPath(downloadId: string, downloadUrl: string): string {
	const parsedUrl = new URL(downloadUrl);
	const extension = path.posix.extname(parsedUrl.pathname);
	const suffix = extension === '' ? '.bin' : extension;
	return `.cache/package-bindings/downloads/${downloadId}${suffix}`;
}

/**
 * Locates an installed npm package's root directory and reads its version.
 * Walks up from the resolved entry point until it finds the package's own
 * `package.json` (matching by `name` field to handle hoisted layouts).
 *
 * @param projectRoot - Absolute path to the Vite project root
 * @param packageName - npm package name to locate
 * @returns Package root directory and semver version
 * @throws If the package is not installed or its `package.json` lacks a version
 */
function resolvePackageDir(projectRoot: string, packageName: string): {
	readonly root: string;
	readonly version: string;
} {
	const require = createRequire(path.join(projectRoot, 'package.json'));

	let entryPath: string;
	try {
		entryPath = require.resolve(packageName);
	} catch {
		throw new Error(`[package-bindings] package '${packageName}' not found.`);
	}

	let dir = path.dirname(entryPath);
	while (dir !== path.dirname(dir)) {
		const pkgJson = path.join(dir, 'package.json');
		if (existsSync(pkgJson)) {
			const parsed: unknown = JSON.parse(readFileSync(pkgJson, 'utf8'));
			if (typeof parsed === 'object' && parsed !== null && 'name' in parsed && parsed.name === packageName) {
				if (!('version' in parsed) || typeof parsed.version !== 'string') {
					throw new Error(`[package-bindings] missing version in '${pkgJson}'.`);
				}
				return { root: dir, version: parsed.version };
			}
		}
		dir = path.dirname(dir);
	}

	throw new Error(`[package-bindings] cannot locate package.json for '${packageName}'.`);
}

/**
 * Recursively enumerates all files under a directory. Symlinks and special
 * entries are skipped — only regular files are collected.
 *
 * @param dirPath - Absolute directory path to walk
 * @returns Flat array of absolute file paths
 */
function collectFiles(dirPath: string): readonly string[] {
	const results: string[] = [];
	for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
		const full = path.join(dirPath, entry.name);
		if (entry.isDirectory()) {
			results.push(...collectFiles(full));
		} else if (entry.isFile()) {
			results.push(full);
		}
	}
	return results;
}

/**
 * Resolves all {@link PackageAssetConfig} entries into {@link ResolvedAsset}
 * objects by locating packages on disk, validating paths, and computing
 * mount/CDN URLs.
 *
 * @param config - Resolved Vite config (provides `root`)
 * @param options - Plugin options containing asset declarations
 * @returns Resolved assets ready for serving/bundling
 * @throws If any asset path escapes its package, doesn't exist, or is an empty directory
 */
function resolveAssets(config: ResolvedConfig, options: PackageBindingsPluginOptions): readonly ResolvedAsset[] {
	return options.assets.map((asset) => {
		const pkg = resolvePackageDir(config.root, asset.package);
		const assetPath = asset.path.replace(/\\/g, '/');
		const absolutePath = path.resolve(pkg.root, assetPath);

		if (!isWithinRoot(pkg.root, absolutePath)) {
			throw new Error(`[package-bindings] asset '${asset.path}' escapes package '${asset.package}'.`);
		}
		if (!existsSync(absolutePath)) {
			throw new Error(`[package-bindings] asset '${asset.path}' not found in '${asset.package}'.`);
		}

		const stat = statSync(absolutePath);
		const isDirectory = stat.isDirectory();
		const mountPath = path.posix.join(MOUNT_BASE, asset.package, pkg.version, assetPath);
		const primary = asset.primary ?? 'self';

		const cdnUrl = `https://cdn.jsdelivr.net/npm/${asset.package}@${pkg.version}/${assetPath}`;

		const files = isDirectory
			? collectFiles(absolutePath).map((f) => ({
				absolutePath: f,
				emittedPath: path.posix.join(mountPath, path.relative(absolutePath, f).replace(/\\/g, '/')),
			}))
			: [{ absolutePath, emittedPath: mountPath }];

		if (files.length === 0) {
			throw new Error(`[package-bindings] directory '${asset.path}' in '${asset.package}' is empty.`);
		}

		return {
			packageName: asset.package,
			version: pkg.version,
			assetPath,
			isDirectory,
			localMountPath: mountPath,
			cdnUrl,
			primary,
			files,
		};
	});
}

/**
 * Resolves all {@link DownloadConfig} entries into {@link ResolvedDownload}
 * objects, validating ids, deduplicating paths, and computing output locations.
 *
 * @param config - Resolved Vite config (provides `root` for path resolution)
 * @param options - Plugin options containing download declarations
 * @returns Resolved downloads ready for fetching/bundling
 * @throws On duplicate ids, duplicate output paths, path traversal, or empty paths
 */
function resolveDownloads(config: ResolvedConfig, options: PackageBindingsPluginOptions): readonly ResolvedDownload[] {
	const requestedDownloads = options.downloads ?? [];
	const normalizedRoot = path.resolve(config.root);
	const seenIds = new Set<string>();
	const seenOutputPaths = new Set<string>();

	return requestedDownloads.map((download) => {
		const id = normalizeDownloadId(download.id);
		if (seenIds.has(id)) {
			throw new Error(`[package-bindings] duplicate download id '${id}'.`);
		}
		seenIds.add(id);

		const outputPath = (download.path ?? defaultDownloadOutputPath(id, download.url)).replace(/\\/g, '/').replace(
			/^\/+/,
			'',
		);
		const absolutePath = path.resolve(normalizedRoot, outputPath);

		if (seenOutputPaths.has(absolutePath)) {
			throw new Error(`[package-bindings] duplicate download output path '${outputPath}'.`);
		}
		seenOutputPaths.add(absolutePath);

		if (!isWithinRoot(normalizedRoot, absolutePath)) {
			throw new Error(`[package-bindings] download path '${outputPath}' escapes project root.`);
		}
		if (outputPath === '') {
			throw new Error(`[package-bindings] download path '${outputPath}' must target a file.`);
		}

		const outputExtension = path.posix.extname(outputPath);
		const remoteExtension = path.posix.extname(new URL(download.url).pathname);
		const suffix = outputExtension || remoteExtension || '.bin';
		const emittedPath = path.posix.join(DOWNLOAD_MOUNT_BASE, `${id}${suffix}`);

		return {
			id,
			url: download.url,
			outputPath,
			absolutePath,
			emittedPath,
		};
	});
}

/**
 * Ensures all download assets are available locally. Skips downloads that
 * already exist on disk (unless `BUILD_REFRESH_MODELS=true` forces re-download).
 * Failed downloads fall back to existing cached files or remote-only mode.
 *
 * @param downloads - Resolved download entries to fetch
 * @returns Set of download ids that are available locally (for dev server serving and bundle emission)
 */
async function ensureDownloads(downloads: readonly ResolvedDownload[]): Promise<ReadonlySet<string>> {
	const forceDownload = parseBoolean(process.env.BUILD_REFRESH_MODELS) === true;
	const locallyAvailable = new Set<string>();

	for (const download of downloads) {
		const fileExists = existsSync(download.absolutePath);
		if (fileExists && !forceDownload) {
			console.log(`[package-bindings] asset present: ${download.outputPath}`);
			locallyAvailable.add(download.id);
			continue;
		}

		console.log(`[package-bindings] downloading asset: ${download.url}`);
		try {
			await mkdir(path.dirname(download.absolutePath), { recursive: true });

			const controller = new AbortController();
			const timeoutMs = 30_000;
			const timer = setTimeout(() => {
				controller.abort();
			}, timeoutMs);
			let body: ArrayBuffer;
			try {
				const response = await fetch(download.url, { signal: controller.signal });
				if (!response.ok) {
					throw new Error(`download failed with status ${String(response.status)}`);
				}
				body = await response.arrayBuffer();
			} catch (fetchError) {
				clearTimeout(timer);
				if (fetchError instanceof DOMException && fetchError.name === 'AbortError') {
					throw new Error(`download timed out after ${String(timeoutMs)}ms`, { cause: fetchError });
				}
				throw fetchError;
			}
			clearTimeout(timer);
			await writeFile(download.absolutePath, Buffer.from(body));
			console.log(`[package-bindings] asset saved: ${download.outputPath}`);
			locallyAvailable.add(download.id);
		} catch (error) {
			if (fileExists) {
				console.warn(
					`[package-bindings] download failed, continuing with existing local file: ${download.outputPath}`,
					error,
				);
				locallyAvailable.add(download.id);
				continue;
			}

			console.warn(
				`[package-bindings] download failed and no local file: ${download.outputPath}; continuing with remote only`,
				error,
			);
		}
	}

	return locallyAvailable;
}

/**
 * Generates the JavaScript source for the `virtual:package-bindings` module.
 * Produces a self-contained ES module with lookup maps and accessor functions
 * for resolving asset URLs at runtime.
 *
 * SYNC: Runtime shape must match the declaration in
 * `src/types/package-bindings.d.ts`.
 *
 * @param assets - Resolved package assets to include in the manifest
 * @param downloads - Resolved download assets to include in the manifest
 * @param locallyAvailable - Set of download ids that were successfully cached locally
 * @returns ES module source string
 */
function generateVirtualModule(
	assets: readonly ResolvedAsset[],
	downloads: readonly ResolvedDownload[],
	locallyAvailable: ReadonlySet<string>,
): string {
	const manifest = assets.map((a) => ({
		package: a.packageName,
		version: a.version,
		path: a.assetPath,
		kind: a.isDirectory ? 'dir' : 'file',
		localPath: a.localMountPath,
		cdnUrl: a.cdnUrl,
		primary: a.primary,
	}));

	const downloadManifest = downloads.map((download) => ({
		id: download.id,
		path: download.emittedPath,
		remoteUrl: download.url,
		localAvailable: locallyAvailable.has(download.id),
	}));

	return `
const manifest = ${JSON.stringify(manifest, null, '\t')};
const downloadManifest = ${JSON.stringify(downloadManifest, null, '\t')};

function withBase(localPath, kind) {
	const base = import.meta.env.BASE_URL;
	const b = base.endsWith('/') ? base : base + '/';
	const p = localPath.startsWith('/') ? localPath.slice(1) : localPath;
	return b + p;
}

const entries = manifest.map((e) => {
	const localUrl = withBase(e.localPath, e.kind);
	const primaryUrl = e.primary === 'self' ? localUrl : e.cdnUrl;
	const fallbackUrl = e.primary === 'self' ? e.cdnUrl : localUrl;
	return { ...e, localUrl, primaryUrl, fallbackUrl };
});

export const packageBindingsManifest = entries;

const downloadEntries = downloadManifest.map((e) => {
	const localUrl = e.localAvailable ? withBase(e.path, 'file') : null;
	return { ...e, localUrl };
});

export const packageDownloadsManifest = downloadEntries;

const byKey = new Map(entries.map((e) => [e.package + '::' + e.path, e]));
const byDownloadId = new Map(downloadEntries.map((e) => [e.id, e]));
const byDownloadPath = new Map(downloadEntries.map((e) => [e.path, e]));

const byPackage = new Map();
for (const e of entries) {
	const list = byPackage.get(e.package);
	if (list) list.push(e); else byPackage.set(e.package, [e]);
}

export function getPackageAsset(packageName, assetPath) {
	const entry = byKey.get(packageName + '::' + assetPath);
	if (!entry) throw new Error('Unknown package asset: ' + packageName + '::' + assetPath);
	return entry;
}

export function getDownloadAsset(assetPath) {
	const entry = byDownloadPath.get(assetPath);
	if (!entry) throw new Error('Unknown download asset: ' + assetPath);
	return entry;
}

export function getDownloadBinding(downloadId) {
	const entry = byDownloadId.get(downloadId);
	if (!entry) throw new Error('Unknown download binding: ' + downloadId);
	return entry;
}

export function getPackageBinding(packageName) {
	const list = byPackage.get(packageName);
	if (!list) throw new Error('Unknown package: ' + packageName);
	const map = new Map(list.map((e) => [e.path, e]));

	function asset(assetPath) {
		const entry = map.get(assetPath);
		if (!entry) throw new Error('Unknown asset: ' + packageName + '::' + assetPath);
		return entry;
	}

	function url(assetPath, source) {
		const e = asset(assetPath);
		return (source ?? 'primary') === 'primary' ? e.primaryUrl : e.fallbackUrl;
	}

	return { package: packageName, asset, url };
}
`.trimStart();
}

/**
 * Returns a Content-Type header value for the dev server based on file extension.
 * Covers WASM, JS, JSON, CSS, and HTML; falls back to `application/octet-stream`.
 *
 * @param filePath - File path or URL pathname to derive MIME type from
 * @returns MIME type string with charset where applicable
 */
function mimeForPath(filePath: string): string {
	if (filePath.endsWith('.wasm')) return 'application/wasm';
	if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
	if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
	if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
	if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
	return 'application/octet-stream';
}

// ── Plugin ───────────────────────────────────────────────────

/**
 * Creates the `package-bindings` Vite plugin. Handles the full lifecycle:
 *
 * 1. **configResolved** — locates packages on disk, computes mount paths
 * 2. **buildStart** — downloads remote assets (ML models) with caching
 * 3. **resolveId/load** — serves the `virtual:package-bindings` module
 * 4. **configureServer** — dev server middleware for self-hosted asset serving
 * 5. **generateBundle** — emits all assets into the production bundle
 *
 * @param options - Asset and download declarations
 * @returns Vite plugin instance
 *
 * @example
 * ```ts
 * packageBindingsPlugin({
 * 	assets: [{
 * 		package: '@mediapipe/tasks-vision',
 * 		path: 'wasm',
 * 		cdn: 'jsdelivr',
 * 		primary: 'cdn',
 * 	}],
 * 	downloads: [{
 * 		id: 'face-landmarker-model',
 * 		url: 'https://storage.googleapis.com/.../face_landmarker.task',
 * 	}],
 * })
 * ```
 */
export function packageBindingsPlugin(options: PackageBindingsPluginOptions): Plugin {
	let assets: readonly ResolvedAsset[] = [];
	let downloads: readonly ResolvedDownload[] = [];
	let locallyAvailable: ReadonlySet<string> = new Set();
	let base = '/';

	return {
		name: 'package-bindings',

		configResolved(config) {
			assets = resolveAssets(config, options);
			downloads = resolveDownloads(config, options);
			const b = config.base;
			base = b === '/' ? '/' : (b.startsWith('/') ? b : `/${b}`);
			if (!base.endsWith('/')) base = `${base}/`;
		},

		async buildStart() {
			locallyAvailable = await ensureDownloads(downloads);
		},

		resolveId(id) {
			return id === VIRTUAL_MODULE_ID ? RESOLVED_ID : undefined;
		},

		load(id) {
			return id === RESOLVED_ID ? generateVirtualModule(assets, downloads, locallyAvailable) : undefined;
		},

		configureServer(server) {
			const urlToFile = new Map<string, string>();
			for (const asset of assets) {
				for (const file of asset.files) {
					urlToFile.set(`${base}${file.emittedPath}`, file.absolutePath);
				}
			}
			for (const download of downloads) {
				if (!locallyAvailable.has(download.id)) continue;
				urlToFile.set(`${base}${download.emittedPath}`, download.absolutePath);
			}

			server.middlewares.use((req, res, next) => {
				if (req.url === undefined) {
					next();
					return;
				}

				const pathname = new URL(req.url, 'http://localhost').pathname;
				const absolutePath = urlToFile.get(pathname);
				if (absolutePath === undefined) {
					next();
					return;
				}

				try {
					const content = readFileSync(absolutePath);
					res.writeHead(200, {
						'Content-Type': mimeForPath(pathname),
						'Content-Length': content.byteLength,
						'Cache-Control': 'no-cache',
					});
					res.end(content);
				} catch {
					res.writeHead(500).end('Failed to load package asset.');
				}
			});
		},

		generateBundle() {
			for (const asset of assets) {
				for (const file of asset.files) {
					this.emitFile({
						type: 'asset',
						fileName: file.emittedPath,
						source: readFileSync(file.absolutePath),
					});
				}
			}

			for (const download of downloads) {
				if (!existsSync(download.absolutePath)) continue;
				this.emitFile({
					type: 'asset',
					fileName: download.emittedPath,
					source: readFileSync(download.absolutePath),
				});
			}
		},
	};
}
