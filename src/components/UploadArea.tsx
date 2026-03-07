/**
 * @module File upload drop zone for tongue images.
 * Supports click-to-browse and drag-and-drop with MIME/size validation.
 */

import { useCallback, useRef, useState } from 'react';

/** Maximum accepted file size in bytes (10 MB). */
const MAX_FILE_SIZE = 10_000_000;

/**
 * Props for {@link UploadArea}.
 */
interface UploadAreaProps {
	/**
	 * Callback fired after a valid image is selected. Receives the raw `File` and a freshly created object URL.
	 *
	 * **Ownership:** The caller is responsible for revoking the object URL via
	 * {@link URL.revokeObjectURL} when it is no longer needed to avoid memory leaks.
	 */
	readonly onFileSelected: (file: File, objectUrl: string) => void;
}

/**
 * Drag-and-drop / click-to-browse upload zone.
 * Validates MIME type (image/*) and enforces a {@link MAX_FILE_SIZE} limit before
 * creating an object URL and forwarding to the parent via `onFileSelected`.
 *
 * @param props - {@link UploadAreaProps}
 * @returns Upload area UI with inline error display.
 *
 * @example
 * ```tsx
 * <UploadArea onFileSelected={(file, url) => console.log(file.name, url)} />
 * ```
 */
export default function UploadArea({ onFileSelected }: UploadAreaProps) {
	const [dragover, setDragover] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const handleFile = useCallback(
		(file: File) => {
			if (!file.type.startsWith('image/')) {
				setError('Alleen afbeeldingen zijn toegestaan (JPG, PNG, HEIC).');
				return;
			}
			if (file.size > MAX_FILE_SIZE) {
				setError('Bestand is te groot — maximaal 10 MB.');
				return;
			}
			setError(null);
			const url = URL.createObjectURL(file);
			onFileSelected(file, url);
		},
		[onFileSelected],
	);

	const handleClick = useCallback(() => {
		inputRef.current?.click();
	}, []);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		setDragover(true);
	}, []);

	const handleDragLeave = useCallback(() => {
		setDragover(false);
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			setDragover(false);
			const file = e.dataTransfer.files[0];
			if (file) handleFile(file);
		},
		[handleFile],
	);

	const handleInputChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (file) handleFile(file);
			e.target.value = '';
		},
		[handleFile],
	);

	return (
		<>
			<button
				type='button'
				className='upload-area'
				aria-label='Upload een foto van je tong. Klik of sleep een bestand hiernaartoe.'
				data-dragover={dragover}
				onClick={handleClick}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
			>
				<div className='upload-icon' aria-hidden='true'>
					👅
				</div>
				<div className='upload-text'>Upload een foto van je tong</div>
				<div className='upload-hint'>
					Steek je tong uit in goed licht &bull; JPG, PNG of HEIC
				</div>
			</button>
			{error !== null && (
				<div className='upload-error' role='alert'>
					{error}
				</div>
			)}
			<input
				ref={inputRef}
				type='file'
				accept='image/*'
				hidden
				onChange={handleInputChange}
			/>
		</>
	);
}
