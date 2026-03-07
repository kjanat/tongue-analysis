import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

// ── Public types ─────────────────────────────────────────────

type AssetPrimary = 'self' | 'cdn';

export interface PackageAssetConfig {
	/** npm package name */
	readonly package: string;
	/** Path within the package to the asset file or directory */
	readonly path: string;
	/** jsdelivr CDN base for fallback/primary URL */
	readonly cdn: 'jsdelivr';
	/** Whether self-hosted or CDN is primary (default: 'self') */
	readonly primary?: AssetPrimary;
}

export interface DownloadConfig {
	/** Stable binding id for runtime lookup */
	readonly id: string;
	/** Absolute HTTP(S) URL for downloadable asset */
	readonly url: string;
	/** Optional project-relative file path where the asset should be stored */
	readonly path?: string;
}

export interface PackageBindingsPluginOptions {
	readonly assets: readonly PackageAssetConfig[];
	readonly downloads?: readonly DownloadConfig[];
}

// ── Internal types ───────────────────────────────────────────

interface ResolvedAsset {
	readonly packageName: string;
	readonly version: string;
	readonly assetPath: string;
	readonly isDirectory: boolean;
	readonly localMountPath: string;
	readonly cdnUrl: string;
	readonly primary: AssetPrimary;
	readonly files: readonly { readonly absolutePath: string; readonly emittedPath: string }[];
}

interface ResolvedDownload {
	readonly id: string;
	readonly url: string;
	readonly outputPath: string;
	readonly absolutePath: string;
	readonly emittedPath: string;
}

// ── Helpers ──────────────────────────────────────────────────

const VIRTUAL_MODULE_ID = 'virtual:package-bindings';
const RESOLVED_ID = `\0${VIRTUAL_MODULE_ID}`;
const MOUNT_BASE = 'pkg-assets';
const DOWNLOAD_MOUNT_BASE = 'download-assets';

function parseBoolean(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined;
	const trueValues = new Set(['1', 'true', 'yes', 'on']);
	const falseValues = new Set(['', '0', 'false', 'no', 'off']);

	const normalized = value.trim().toLowerCase();
	if (trueValues.has(normalized)) return true;
	if (falseValues.has(normalized)) return false;

	return undefined;
}

function isWithinRoot(rootPath: string, absolutePath: string): boolean {
	const relativePath = path.relative(rootPath, absolutePath);
	if (relativePath === '') return true;
	if (relativePath.startsWith('..')) return false;
	return !path.isAbsolute(relativePath);
}

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

function defaultDownloadOutputPath(downloadId: string, downloadUrl: string): string {
	const parsedUrl = new URL(downloadUrl);
	const extension = path.posix.extname(parsedUrl.pathname);
	const suffix = extension === '' ? '.bin' : extension;
	return `.cache/package-bindings/downloads/${downloadId}${suffix}`;
}

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
			const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
			let response: Response;
			try {
				response = await fetch(download.url, { signal: controller.signal });
			} catch (fetchError) {
				clearTimeout(timer);
				if (fetchError instanceof DOMException && fetchError.name === 'AbortError') {
					throw new Error(`download timed out after ${String(timeoutMs)}ms`, { cause: fetchError });
				}
				throw fetchError;
			}
			clearTimeout(timer);

			if (!response.ok) {
				throw new Error(`download failed with status ${String(response.status)}`);
			}

			const body = await response.arrayBuffer();
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

// SYNC: Runtime shape must match the declaration in src/types/package-bindings.d.ts
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

function mimeForPath(filePath: string): string {
	if (filePath.endsWith('.wasm')) return 'application/wasm';
	if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
	if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
	if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
	if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
	return 'application/octet-stream';
}

// ── Plugin ───────────────────────────────────────────────────

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
