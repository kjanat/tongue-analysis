/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_DEBUG_OVERLAY: string;
	readonly VITE_COMMIT_SHA: string;
	readonly VITE_BUILD_DATE: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
