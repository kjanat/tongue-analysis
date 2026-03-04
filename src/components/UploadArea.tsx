import { useCallback, useRef, useState } from 'react';

const MAX_FILE_SIZE = 10_000_000;

interface UploadAreaProps {
	readonly onFileSelected: (file: File, objectUrl: string) => void;
}

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
