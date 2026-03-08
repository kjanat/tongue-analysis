/**
 * @module Application entry point.
 * Mounts the {@link App} component into the DOM under React 19 StrictMode.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
