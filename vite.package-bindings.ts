import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

type AssetPrimary = 'self' | 'cdn';
type AssetKind = 'file' | 'dir';
type CdnPreset = 'jsdelivr' | 'esm.sh' | 'unpkg';

interface CdnContext {
	readonly packageName: string;
	readonly version: string;
	readonly assetPath: string;
	readonly kind: AssetKind;
}

type CdnConfig =
	| CdnPreset
	| {
		readonly url?: string | ((context: CdnContext) => string);
		readonly baseUrl?: string;
	};

export interface PackageAssetConfig {
	readonly package: string;
	readonly version?: string;
	readonly path: string;
	readonly cdn: CdnConfig;
	readonly primary?: AssetPrimary;
}

export interface PackageBindingsPluginOptions {
	readonly assets: readonly PackageAssetConfig[];
	readonly mountBase?: string;
	readonly virtualModuleId?: string;
}

interface ResolvedAssetFile {
	readonly absolutePath: string;
	readonly emittedPath: string;
}

interface ResolvedPackageAsset {
	readonly packageName: string;
	readonly requestedVersion: string;
	readonly assetPath: string;
	readonly kind: AssetKind;
	readonly localPath: string;
	readonly cdnUrl: string;
	readonly primary: AssetPrimary;
	readonly files: readonly ResolvedAssetFile[];
}

interface SerializableResolvedPackageAsset {
	readonly packageName: string;
	readonly version: string;
	readonly path: string;
	readonly kind: AssetKind;
	readonly localPath: string;
	readonly cdnUrl: string;
	readonly primary: AssetPrimary;
}

const DEFAULT_VIRTUAL_MODULE_ID = 'virtual:package-bindings';
const DEFAULT_MOUNT_BASE = 'pkg-assets';

function normalizeBasePath(base: string): string {
	if (base === '/') return '/';
	const prefixed = base.startsWith('/') ? base : `/${base}`;
	return prefixed.endsWith('/') ? prefixed : `${prefixed}/`;
}

function normalizeMountBase(mountBase: string): string {
	const normalized = mountBase.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	if (normalized.length === 0) {
		throw new Error('packageBindingsPlugin: mountBase must not be empty.');
	}
	return normalized;
}

function normalizeAssetPath(assetPath: string): string {
	const normalized = assetPath.replace(/\\/g, '/');
	if (normalized.startsWith('/')) {
		throw new Error(`packageBindingsPlugin: asset path '${assetPath}' must be relative.`);
	}

	const clean = path.posix.normalize(normalized);
	if (clean === '.' || clean.length === 0) {
		throw new Error(`packageBindingsPlugin: asset path '${assetPath}' must not be empty.`);
	}

	if (clean === '..' || clean.startsWith('../')) {
		throw new Error(`packageBindingsPlugin: asset path '${assetPath}' escapes package root.`);
	}

	return clean;
}

function readPackageVersion(packageJsonPath: string): string {
	const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
	if (typeof parsed !== 'object' || parsed === null) {
		throw new Error(`packageBindingsPlugin: invalid package.json at '${packageJsonPath}'.`);
	}

	if (!('version' in parsed)) {
		throw new Error(`packageBindingsPlugin: missing version in '${packageJsonPath}'.`);
	}

	const version = parsed.version;
	if (typeof version !== 'string' || version.length === 0) {
		throw new Error(`packageBindingsPlugin: invalid version in '${packageJsonPath}'.`);
	}

	return version;
}

function resolvePackageRoot(root: string, packageName: string): {
	readonly packageRoot: string;
	readonly installedVersion: string;
} {
	const requireFromRoot = createRequire(path.join(root, 'package.json'));

	let packageEntryPath: string;
	try {
		packageEntryPath = requireFromRoot.resolve(packageName);
	} catch {
		throw new Error(`packageBindingsPlugin: package '${packageName}' not found from '${root}'.`);
	}

	let currentDirectory = path.dirname(packageEntryPath);
	let packageJsonPath: string | undefined;

	for (;;) {
		const candidatePath = path.join(currentDirectory, 'package.json');
		if (existsSync(candidatePath)) {
			const parsed: unknown = JSON.parse(readFileSync(candidatePath, 'utf8'));
			if (
				typeof parsed === 'object'
				&& parsed !== null
				&& 'name' in parsed
				&& parsed.name === packageName
			) {
				packageJsonPath = candidatePath;
				break;
			}
		}

		const parentDirectory = path.dirname(currentDirectory);
		if (parentDirectory === currentDirectory) {
			break;
		}

		currentDirectory = parentDirectory;
	}

	if (packageJsonPath === undefined) {
		throw new Error(
			`packageBindingsPlugin: unable to locate package.json for '${packageName}' from '${packageEntryPath}'.`,
		);
	}

	return {
		packageRoot: path.dirname(packageJsonPath),
		installedVersion: readPackageVersion(packageJsonPath),
	};
}

function withTrailingSlash(value: string): string {
	return value.endsWith('/') ? value : `${value}/`;
}

function maybeDirectoryUrl(url: string, kind: AssetKind): string {
	return kind === 'dir' ? withTrailingSlash(url) : url;
}

function cdnPresetUrl(preset: CdnPreset, context: CdnContext): string {
	switch (preset) {
		case 'jsdelivr':
			return `https://cdn.jsdelivr.net/npm/${context.packageName}@${context.version}/${context.assetPath}`;
		case 'unpkg':
			return `https://unpkg.com/${context.packageName}@${context.version}/${context.assetPath}`;
		case 'esm.sh':
			return `https://esm.sh/${context.packageName}@${context.version}/${context.assetPath}`;
	}
}

function resolveCdnUrl(config: CdnConfig, context: CdnContext): string {
	if (typeof config === 'string') {
		return maybeDirectoryUrl(cdnPresetUrl(config, context), context.kind);
	}

	if (config.url !== undefined) {
		if (typeof config.url === 'function') {
			return maybeDirectoryUrl(config.url(context), context.kind);
		}

		return maybeDirectoryUrl(
			config.url
				.replace(/\{package\}/g, context.packageName)
				.replace(/\{version\}/g, context.version)
				.replace(/\{path\}/g, context.assetPath),
			context.kind,
		);
	}

	if (config.baseUrl !== undefined) {
		const normalizedBase = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl;
		return maybeDirectoryUrl(
			`${normalizedBase}/${context.packageName}@${context.version}/${context.assetPath}`,
			context.kind,
		);
	}

	throw new Error(
		"packageBindingsPlugin: custom CDN config must define 'url' or 'baseUrl'.",
	);
}

function collectFilesRecursively(directoryPath: string): readonly string[] {
	const results: string[] = [];

	function walk(currentDirectory: string): void {
		const entries = readdirSync(currentDirectory, { withFileTypes: true });

		for (const entry of entries) {
			const absolutePath = path.join(currentDirectory, entry.name);
			if (entry.isDirectory()) {
				walk(absolutePath);
				continue;
			}

			if (entry.isFile()) {
				results.push(absolutePath);
			}
		}
	}

	walk(directoryPath);
	return results;
}

function toSerializableEntry(entry: ResolvedPackageAsset): SerializableResolvedPackageAsset {
	return {
		packageName: entry.packageName,
		version: entry.requestedVersion,
		path: entry.assetPath,
		kind: entry.kind,
		localPath: entry.localPath,
		cdnUrl: entry.cdnUrl,
		primary: entry.primary,
	};
}

// SYNC: Runtime shape must match the declaration in src/types/package-bindings.d.ts
function virtualModuleSource(entries: readonly ResolvedPackageAsset[]): string {
	const serializableEntries = entries.map(toSerializableEntry);
	return [
		`const rawEntries = ${JSON.stringify(serializableEntries, null, 2)};`,
		'',
		'function withBase(path, kind) {',
		'\tconst base = import.meta.env.BASE_URL;',
		"\tconst normalizedBase = base.endsWith('/') ? base : `${base}/`;",
		"\tconst normalizedPath = path.startsWith('/') ? path.slice(1) : path;",
		'\tconst url = `${normalizedBase}${normalizedPath}`;',
		"\treturn kind === 'dir' && !url.endsWith('/') ? `${url}/` : url;",
		'}',
		'',
		'export const packageBindingsManifest = rawEntries.map((entry) => {',
		'\tconst localUrl = withBase(entry.localPath, entry.kind);',
		"\tconst primaryUrl = entry.primary === 'self' ? localUrl : entry.cdnUrl;",
		"\tconst fallbackUrl = entry.primary === 'self' ? entry.cdnUrl : localUrl;",
		'',
		'\treturn {',
		'\t\tpackage: entry.packageName,',
		'\t\tversion: entry.version,',
		'\t\tpath: entry.path,',
		'\t\tkind: entry.kind,',
		'\t\tlocalPath: entry.localPath,',
		'\t\tlocalUrl,',
		'\t\tcdnUrl: entry.cdnUrl,',
		'\t\tprimary: entry.primary,',
		'\t\tprimaryUrl,',
		'\t\tfallbackUrl,',
		'\t};',
		'});',
		'',
		'const packageBindingsMap = new Map(',
		'\tpackageBindingsManifest.map((entry) => [`${entry.package}::${entry.path}`, entry]),',
		');',
		'',
		'const packageAssetByPackage = new Map();',
		'for (const entry of packageBindingsManifest) {',
		'\tconst existing = packageAssetByPackage.get(entry.package);',
		'\tif (existing === undefined) {',
		'\t\tpackageAssetByPackage.set(entry.package, [entry]);',
		'\t} else {',
		'\t\texisting.push(entry);',
		'\t}',
		'}',
		'',
		'export function getPackageAsset(packageName, assetPath) {',
		'\tconst key = `${packageName}::${assetPath}`;',
		'\tconst entry = packageBindingsMap.get(key);',
		'\tif (entry === undefined) {',
		"\t\tthrow new Error(`Unknown package asset '${key}'. Check packageBindingsPlugin config.`);",
		'\t}',
		'',
		'\treturn entry;',
		'}',
		'',
		'export function getPackageBinding(packageName) {',
		'\tconst entries = packageAssetByPackage.get(packageName);',
		'\tif (entries === undefined) {',
		"\t\tthrow new Error(`Unknown package '${packageName}'. Check packageBindingsPlugin config.`);",
		'\t}',
		'',
		'\tconst map = new Map(entries.map((entry) => [entry.path, entry]));',
		'',
		'\tfunction asset(assetPath) {',
		'\t\tconst entry = map.get(assetPath);',
		'\t\tif (entry === undefined) {',
		"\t\t\tthrow new Error(`Unknown package asset '${packageName}::${assetPath}'. Check packageBindingsPlugin config.`);",
		'\t\t}',
		'',
		'\t\treturn entry;',
		'\t}',
		'',
		"\tfunction url(assetPath, source = 'primary') {",
		'\t\tconst entry = asset(assetPath);',
		"\t\treturn source === 'primary' ? entry.primaryUrl : entry.fallbackUrl;",
		'\t}',
		'',
		'\treturn {',
		'\t\tpackage: packageName,',
		'\t\tasset,',
		'\t\turl,',
		'\t};',
		'}',
	].join('\n');
}

function mimeTypeForPath(filePath: string): string {
	if (filePath.endsWith('.wasm')) return 'application/wasm';
	if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
	if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
	if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
	if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
	return 'application/octet-stream';
}

function resolvePackageAssets(
	config: ResolvedConfig,
	options: PackageBindingsPluginOptions,
	logger: { readonly warn: (message: string) => void },
): readonly ResolvedPackageAsset[] {
	if (options.assets.length === 0) {
		throw new Error('packageBindingsPlugin: options.assets must contain at least one item.');
	}

	const mountBase = normalizeMountBase(options.mountBase ?? DEFAULT_MOUNT_BASE);
	const seenKey = new Set<string>();
	const seenEmittedFile = new Set<string>();
	const entries: ResolvedPackageAsset[] = [];

	for (const asset of options.assets) {
		if (asset.package.length === 0) {
			throw new Error('packageBindingsPlugin: asset.package must not be empty.');
		}

		const normalizedAssetPath = normalizeAssetPath(asset.path);
		const resolvedPackage = resolvePackageRoot(config.root, asset.package);

		if (asset.version !== undefined && asset.version !== resolvedPackage.installedVersion) {
			logger.warn(
				`packageBindingsPlugin: '${asset.package}' installed version is '${resolvedPackage.installedVersion}' but CDN version is '${asset.version}'.`,
			);
		}

		const absolutePath = path.resolve(resolvedPackage.packageRoot, normalizedAssetPath);
		const relativeToPackage = path.relative(resolvedPackage.packageRoot, absolutePath);
		const escapesPackageRoot = relativeToPackage.startsWith('..') || path.isAbsolute(relativeToPackage);
		if (escapesPackageRoot) {
			throw new Error(
				`packageBindingsPlugin: resolved asset '${asset.path}' escapes package '${asset.package}'.`,
			);
		}

		if (!existsSync(absolutePath)) {
			throw new Error(
				`packageBindingsPlugin: asset '${asset.path}' not found in '${asset.package}'.`,
			);
		}

		const requestedVersion = asset.version ?? resolvedPackage.installedVersion;
		const primary = asset.primary ?? 'self';
		const key = `${asset.package}::${normalizedAssetPath}`;

		if (seenKey.has(key)) {
			throw new Error(`packageBindingsPlugin: duplicate asset config for '${key}'.`);
		}
		seenKey.add(key);

		const baseLocalPath = path.posix.join(
			mountBase,
			asset.package,
			resolvedPackage.installedVersion,
			normalizedAssetPath,
		);

		const absoluteStat = statSync(absolutePath);

		if (!absoluteStat.isDirectory() && !absoluteStat.isFile()) {
			throw new Error(
				`packageBindingsPlugin: asset '${asset.path}' in '${asset.package}' must be a file or directory.`,
			);
		}

		const kind: AssetKind = absoluteStat.isDirectory() ? 'dir' : 'file';
		const files: ResolvedAssetFile[] = [];
		if (absoluteStat.isFile()) {
			if (seenEmittedFile.has(baseLocalPath)) {
				throw new Error(`packageBindingsPlugin: duplicate emitted asset path '${baseLocalPath}'.`);
			}
			seenEmittedFile.add(baseLocalPath);
			files.push({
				absolutePath,
				emittedPath: baseLocalPath,
			});
		} else {
			const directoryFiles = collectFilesRecursively(absolutePath);
			if (directoryFiles.length === 0) {
				throw new Error(
					`packageBindingsPlugin: directory asset '${asset.path}' in '${asset.package}' contains no files.`,
				);
			}

			for (const fileAbsolutePath of directoryFiles) {
				const fileRelativePath = path
					.relative(absolutePath, fileAbsolutePath)
					.replace(/\\/g, '/');
				const emittedPath = path.posix.join(baseLocalPath, fileRelativePath);

				if (seenEmittedFile.has(emittedPath)) {
					throw new Error(`packageBindingsPlugin: duplicate emitted asset path '${emittedPath}'.`);
				}
				seenEmittedFile.add(emittedPath);

				files.push({
					absolutePath: fileAbsolutePath,
					emittedPath,
				});
			}
		}

		const cdnUrl = resolveCdnUrl(asset.cdn, {
			packageName: asset.package,
			version: requestedVersion,
			assetPath: normalizedAssetPath,
			kind,
		});

		entries.push({
			packageName: asset.package,
			requestedVersion,
			assetPath: normalizedAssetPath,
			kind,
			localPath: kind === 'dir' ? withTrailingSlash(baseLocalPath) : baseLocalPath,
			cdnUrl,
			primary,
			files,
		});
	}

	return entries;
}

export function packageBindingsPlugin(
	options: PackageBindingsPluginOptions,
): Plugin {
	const virtualModuleId = options.virtualModuleId ?? DEFAULT_VIRTUAL_MODULE_ID;
	const resolvedVirtualModuleId = `\0${virtualModuleId}`;
	let resolvedConfig: ResolvedConfig | undefined;
	let resolvedEntries: readonly ResolvedPackageAsset[] = [];

	return {
		name: 'package-bindings',
		configResolved(config) {
			resolvedConfig = config;
			resolvedEntries = resolvePackageAssets(config, options, {
				warn(message) {
					config.logger.warn(message);
				},
			});
		},
		resolveId(id) {
			if (id === virtualModuleId) {
				return resolvedVirtualModuleId;
			}

			return undefined;
		},
		load(id) {
			if (id === resolvedVirtualModuleId) {
				return virtualModuleSource(resolvedEntries);
			}

			return undefined;
		},
		configureServer(server) {
			if (resolvedConfig === undefined) return;

			const urlToFile = new Map<string, ResolvedAssetFile>();
			const base = normalizeBasePath(resolvedConfig.base);

			for (const entry of resolvedEntries) {
				for (const file of entry.files) {
					urlToFile.set(`${base}${file.emittedPath}`, file);
				}
			}

			server.middlewares.use((req, res, next) => {
				if (req.url === undefined) {
					next();
					return;
				}

				const pathname = new URL(req.url, 'http://localhost').pathname;
				const file = urlToFile.get(pathname);
				if (file === undefined) {
					next();
					return;
				}

				try {
					const source = readFileSync(file.absolutePath);
					res.statusCode = 200;
					res.setHeader('Content-Type', mimeTypeForPath(file.emittedPath));
					res.setHeader('Cache-Control', 'no-cache');
					res.end(source);
				} catch {
					res.statusCode = 500;
					res.end('Failed to load package asset.');
				}
			});
		},
		generateBundle() {
			for (const entry of resolvedEntries) {
				for (const file of entry.files) {
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
