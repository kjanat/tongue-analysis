import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import robot from "vite-robots-txt";
import svg from "vite-svg-to-ico";
import { packageBindingsPlugin } from "./vite.package-bindings.ts";

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		packageBindingsPlugin({
			assets: [
				{
					package: "@mediapipe/tasks-vision",
					path: "wasm",
					cdn: "jsdelivr",
				},
			],
		}),
		react({
			babel: {
				plugins: [["babel-plugin-react-compiler"]],
				targets: { browsers: ["baseline widely available"] },
			},
		}),
		svg({
			input: "src/assets/tongue.svg",
			emit: { inject: true, source: true },
			sharp: { resize: { kernel: "nearest" } },
		}),
		robot({ preset: "disallowAll" }),
	],
	server: {
		allowedHosts: ["propc-manjaro", "192.168.1.2"],
		host: "0.0.0.0",
		port: 3000,
		strictPort: true,
	},
});
