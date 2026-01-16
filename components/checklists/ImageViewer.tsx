import React, { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { getEmbeddableImageUrl } from '@/lib/imageUtils'

interface ImageViewerProps {
    isOpen: boolean
    onClose: () => void
    images: string[]
    currentIndex: number
    onNext: () => void
    onPrev: () => void
}

export function ImageViewer({ isOpen, onClose, images, currentIndex, onNext, onPrev }: ImageViewerProps) {

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen) return
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowRight') onNext()
            if (e.key === 'ArrowLeft') onPrev()
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isOpen, onNext, onPrev, onClose])

    if (!isOpen) return null

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[10000] bg-black/95 flex items-center justify-center backdrop-blur-sm"
                    onClick={onClose}
                >
                    {/* Close Button */}
                    <button
                        className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition z-20"
                        onClick={onClose}
                    >
                        <X size={24} />
                    </button>

                    {/* Navigation Buttons */}
                    {images.length > 1 && (
                        <>
                            <button
                                className="absolute left-4 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition z-20"
                                onClick={(e) => { e.stopPropagation(); onPrev() }}
                            >
                                <ChevronLeft size={32} />
                            </button>
                            <button
                                className="absolute right-4 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition z-20"
                                onClick={(e) => { e.stopPropagation(); onNext() }}
                            >
                                <ChevronRight size={32} />
                            </button>
                        </>
                    )}

                    {/* Image Container */}
                    <div className="relative w-full h-full max-w-7xl max-h-screen p-4 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                        {(() => {
                            const currentUrl = getEmbeddableImageUrl(images[currentIndex])
                            const isVideo = currentUrl?.toLowerCase().match(/\.(mp4|webm|ogg|mov)$/)

                            return isVideo ? (
                                <motion.video
                                    key={`vid-${currentIndex}`}
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                    src={currentUrl}
                                    className="max-w-full max-h-full object-contain rounded-lg shadow-2xl bg-black"
                                    controls
                                    autoPlay
                                    playsInline
                                />
                            ) : (
                                <motion.img
                                    key={currentIndex}
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                    src={currentUrl}
                                    alt="Evidence Fullscreen"
                                    className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                                />
                            )
                        })()}

                        {/* Counter */}
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/50 backdrop-blur rounded-full text-white text-sm font-medium">
                            {currentIndex + 1} / {images.length}
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
