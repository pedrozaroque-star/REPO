import React, { useCallback, useState } from 'react'
import { UploadCloud, X, FileImage, Loader2 } from 'lucide-react'

interface ImageDropzoneProps {
    onUpload: (files: File[]) => Promise<void>
    disabled?: boolean
}

// Compresor inteligente del lado del cliente para esquivar el límite de 4MB de Vercel
const compressImage = async (file: File): Promise<File> => {
    // Si la imagen ya pesa menos de 1.5MB y es JPG, pasa directo intacta
    if (file.size < 1.5 * 1024 * 1024 && file.type === 'image/jpeg') return file;

    return new Promise((resolve) => {
        const img = new window.Image();
        const reader = new FileReader();

        reader.onload = (e) => {
            img.src = e.target?.result as string;
        };

        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            // Limitar a máximo 4K (3840x2160)
            const MAX_WIDTH = 3840;
            const MAX_HEIGHT = 2160;

            if (width > MAX_WIDTH) {
                height = Math.round((height * MAX_WIDTH) / width);
                width = MAX_WIDTH;
            }
            if (height > MAX_HEIGHT) {
                width = Math.round((width * MAX_HEIGHT) / height);
                height = MAX_HEIGHT;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            
            if (ctx) {
                // Rellenar fondo negro por si era PNG transparente
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
            }
            
            // 85% a 90% es visualmente idéntico pero quita el 70% del peso en MB
            canvas.toBlob((blob) => {
                if (blob) {
                    const newFileName = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
                    resolve(new File([blob], newFileName, { type: 'image/jpeg' }));
                } else {
                    resolve(file); // Fallback si falla
                }
            }, 'image/jpeg', 0.88); 
        };

        reader.onerror = () => resolve(file);
        reader.readAsDataURL(file);
    });
};

export default function ImageDropzone({ onUpload, disabled }: ImageDropzoneProps) {
    const [isDragActive, setIsDragActive] = useState(false)
    const [isUploading, setIsUploading] = useState(false)

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (!disabled) setIsDragActive(true)
    }, [disabled])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragActive(false)
    }, [])

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragActive(false)
        if (disabled) return

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const files = Array.from(e.dataTransfer.files).filter(file =>
                file.type.startsWith('image/jpeg') || file.type.startsWith('image/png')
            )

            if (files.length > 0) {
                setIsUploading(true)
                try {
                    // Procesar todas las imágenes antes de mandarlas
                    const compressedFiles = await Promise.all(files.map(compressImage))
                    await onUpload(compressedFiles)
                } finally {
                    setIsUploading(false)
                }
            } else {
                alert('Solo se permiten imágenes JPG y PNG.')
            }
        }
    }, [onUpload, disabled])

    const handleChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const files = Array.from(e.target.files).filter(file =>
                file.type.startsWith('image/jpeg') || file.type.startsWith('image/png')
            )

            if (files.length > 0) {
                setIsUploading(true)
                try {
                    const compressedFiles = await Promise.all(files.map(compressImage))
                    await onUpload(compressedFiles)
                } finally {
                    setIsUploading(false)
                }
            } else {
                alert('Solo se permiten imágenes JPG y PNG.')
            }

            // Reset input
            e.target.value = ''
        }
    }, [onUpload])

    return (
        <div
            onDragEnter={handleDragEnter}
            onDragOver={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative w-full border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center transition-all ${disabled
                    ? 'bg-gray-50 border-gray-200 opacity-60 cursor-not-allowed dark:bg-slate-800/50 dark:border-slate-700'
                    : isDragActive
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 dark:border-indigo-400 scale-[1.02]'
                        : 'border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-gray-400 dark:bg-slate-800/50 dark:border-slate-700 dark:hover:bg-slate-800'
                }`}
        >
            <input
                type="file"
                multiple
                accept="image/jpeg,image/png"
                onChange={handleChange}
                disabled={disabled || isUploading}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />

            {isUploading ? (
                <div className="flex flex-col items-center text-indigo-500">
                    <Loader2 className="w-10 h-10 mb-3 animate-spin" />
                    <p className="font-bold tracking-tight">Subiendo imágenes...</p>
                </div>
            ) : (
                <div className="flex flex-col items-center text-gray-500 dark:text-slate-400 pointer-events-none">
                    <div className={`p-4 rounded-full mb-3 ${isDragActive ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400' : 'bg-white text-gray-400 dark:bg-slate-900 shadow-sm'}`}>
                        <UploadCloud className="w-8 h-8" />
                    </div>
                    <p className="font-semibold text-lg text-gray-700 dark:text-slate-200 mb-1">
                        {isDragActive ? '¡Suelta las imágenes aquí!' : 'Arrastra y suelta imágenes'}
                    </p>
                    <p className="text-sm font-medium opacity-80 mb-3">
                        O haz click para buscar en tus archivos
                    </p>
                    <div className="flex gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest bg-white dark:bg-slate-900 px-2 py-1 rounded shadow-sm">JPG</span>
                        <span className="text-[10px] font-black uppercase tracking-widest bg-white dark:bg-slate-900 px-2 py-1 rounded shadow-sm">PNG</span>
                    </div>
                </div>
            )}
        </div>
    )
}
