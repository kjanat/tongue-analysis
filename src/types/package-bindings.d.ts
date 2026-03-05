declare module 'virtual:package-bindings' {
	type AssetPrimary = 'self' | 'cdn';
	type AssetKind = 'file' | 'dir';
	type AssetSource = 'primary' | 'fallback';

	export interface PackageAsset {
		readonly package: string;
		readonly version: string;
		readonly path: string;
		readonly kind: AssetKind;
		readonly localPath: string;
		readonly localUrl: string;
		readonly cdnUrl: string;
		readonly primary: AssetPrimary;
		readonly primaryUrl: string;
		readonly fallbackUrl: string;
	}

	export interface PackageAssetBinding {
		readonly package: string;
		readonly asset: (assetPath: string) => PackageAsset;
		readonly url: (assetPath: string, source?: AssetSource) => string;
	}

	export const packageBindingsManifest: readonly PackageAsset[];

	export function getPackageAsset(packageName: string, assetPath: string): PackageAsset;
	export function getPackageBinding(packageName: string): PackageAssetBinding;
}
