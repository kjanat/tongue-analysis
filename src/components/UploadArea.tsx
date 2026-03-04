import { useCallback, useRef, useState } from 'react';

const MAX_FILE_SIZE = 10_000_000;

interface UploadAreaProps {
	readonly onFileSelected: (file: File, dataUrl: string) => void;
}

export default function UploadArea({ onFileSelected }: UploadAreaProps) {
	const [dragover, setDragover] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const handleFile = useCallback(
		(file: File) => {
			if (!file.type.startsWith('image/')) return;
			if (file.size > MAX_FILE_SIZE) return;
			const reader = new FileReader();
			reader.onload = (e) => {
				const result = e.target?.result;
				if (typeof result === 'string') {
					onFileSelected(file, result);
				}
			};
			reader.readAsDataURL(file);
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
			if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
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
