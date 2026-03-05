import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

export interface PackageBindingsPluginOptions {
	readonly assets: readonly PackageAssetConfig[];
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

// ── Helpers ──────────────────────────────────────────────────

const VIRTUAL_MODULE_ID = 'virtual:package-bindings';
const RESOLVED_ID = `\0${VIRTUAL_MODULE_ID}`;
const MOUNT_BASE = 'pkg-assets';

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

		if (!absolutePath.startsWith(pkg.root)) {
			throw new Error(`[package-bindings] asset '${asset.path}' escapes package '${asset.package}'.`);
		}
		if (!existsSync(absolutePath)) {
			throw new Error(`[package-bindings] asset '${asset.path}' not found in '${asset.package}'.`);
		}

		const stat = statSync(absolutePath);
		const isDirectory = stat.isDirectory();
		const mountPath = path.posix.join(MOUNT_BASE, asset.package, pkg.version, assetPath);
		const primary = asset.primary ?? 'self';

		const cdnUrl = `https://cdn.jsdelivr.net/npm/${asset.package}@${pkg.version}/${assetPath}${isDirectory ? '/' : ''}`;

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
			localMountPath: isDirectory ? `${mountPath}/` : mountPath,
			cdnUrl,
			primary,
			files,
		};
	});
}

// SYNC: Runtime shape must match the declaration in src/types/package-bindings.d.ts
function generateVirtualModule(assets: readonly ResolvedAsset[]): string {
	const manifest = assets.map((a) => ({
		package: a.packageName,
		version: a.version,
		path: a.assetPath,
		kind: a.isDirectory ? 'dir' : 'file',
		localPath: a.localMountPath,
		cdnUrl: a.cdnUrl,
		primary: a.primary,
	}));

	return `
const manifest = ${JSON.stringify(manifest, null, '\t')};

function withBase(localPath, kind) {
	const base = import.meta.env.BASE_URL;
	const b = base.endsWith('/') ? base : base + '/';
	const p = localPath.startsWith('/') ? localPath.slice(1) : localPath;
	const url = b + p;
	return kind === 'dir' && !url.endsWith('/') ? url + '/' : url;
}

const entries = manifest.map((e) => {
	const localUrl = withBase(e.localPath, e.kind);
	const primaryUrl = e.primary === 'self' ? localUrl : e.cdnUrl;
	const fallbackUrl = e.primary === 'self' ? e.cdnUrl : localUrl;
	return { ...e, localUrl, primaryUrl, fallbackUrl };
});

export const packageBindingsManifest = entries;

const byKey = new Map(entries.map((e) => [e.package + '::' + e.path, e]));

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
	let base = '/';

	return {
		name: 'package-bindings',

		configResolved(config) {
			assets = resolveAssets(config, options);
			const b = config.base;
			base = b === '/' ? '/' : (b.startsWith('/') ? b : `/${b}`);
			if (!base.endsWith('/')) base = `${base}/`;
		},

		resolveId(id) {
			return id === VIRTUAL_MODULE_ID ? RESOLVED_ID : undefined;
		},

		load(id) {
			return id === RESOLVED_ID ? generateVirtualModule(assets) : undefined;
		},

		configureServer(server) {
			const urlToFile = new Map<string, string>();
			for (const asset of assets) {
				for (const file of asset.files) {
					urlToFile.set(`${base}${file.emittedPath}`, file.absolutePath);
				}
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
		},
	};
}
