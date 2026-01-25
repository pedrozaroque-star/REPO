import { X, Printer } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from '../lib/utils'

export function PrintModal({ isOpen, onClose, url }: any) {
    if (!isOpen) return null

    const handlePrint = () => {
        const iframe = document.getElementById('print-frame') as HTMLIFrameElement
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.print()
        } else {
            toast.error('Error al cargar la vista de impresión')
        }
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 sm:p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full h-full max-w-5xl flex flex-col overflow-hidden relative"
            >
                {/* Header */}
                <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/50">
                    <h2 className="text-lg font-bold flex items-center gap-2 text-gray-800 dark:text-white">
                        <Printer size={20} />
                        Vista Previa
                    </h2>
                    <div className="flex gap-2">
                        <button
                            onClick={handlePrint}
                            className="bg-black dark:bg-white dark:text-black text-white px-4 py-2 rounded-md font-bold text-sm hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors flex items-center gap-2"
                        >
                            <Printer size={16} /> Imprimir Ahora
                        </button>
                        <button onClick={onClose} className="p-2 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-full transition-colors text-gray-500 dark:text-gray-400">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Iframe content */}
                <div className="flex-1 bg-gray-100 dark:bg-slate-950 overflow-hidden relative">
                    <iframe
                        id="print-frame"
                        src={url}
                        className="w-full h-full border-0 block"
                        title="Print Preview"
                    />
                </div>
            </motion.div>
        </div>
    )
}
