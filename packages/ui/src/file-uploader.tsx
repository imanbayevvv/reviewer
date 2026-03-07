import { clsx } from 'clsx';
import { useCallback, useRef, useState } from 'react';

interface FileUploaderProps {
  label?: string;
  accept?: string;
  previewUrl?: string | null;
  onFile: (file: File) => void;
  onRemove?: () => void;
  className?: string;
}

export function FileUploader({ label, accept = 'image/*', previewUrl, onFile, onRemove, className }: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }, [onFile]);

  return (
    <div data-testid="logo-uploader" className={clsx('flex flex-col gap-2', className)}>
      {label && <span className="text-body-lg text-neutral-600">{label}</span>}
      {previewUrl ? (
        <div className="relative h-20 w-20 rounded-md overflow-hidden border border-[rgba(0,0,0,0.1)]">
          <img src={previewUrl} alt="Upload preview" className="h-full w-full object-cover" />
          {onRemove && (
            <button
              onClick={onRemove}
              className="absolute top-1 right-1 h-5 w-5 rounded-full bg-neutral-900 text-white flex items-center justify-center text-body-sm"
            >
              &times;
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={clsx(
            'flex h-20 w-20 items-center justify-center rounded-md border-2 border-dashed transition-colors',
            dragOver ? 'border-neutral-500 bg-neutral-100' : 'border-[rgba(0,0,0,0.1)]',
          )}
        >
          <span className="text-neutral-400 text-heading-md">+</span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
    </div>
  );
}
