import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import robot from 'vite-robots-txt';
import svg from 'vite-svg-to-ico';

// https://vite.dev/config/
export default defineConfig({
	plugins: [
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
});
