
import { motion, AnimatePresence } from 'framer-motion'
import { X, Mail, ShieldCheck } from 'lucide-react'

interface GmailConnectModalProps {
    isOpen: boolean
    onClose: () => void
}

export function GmailConnectModal({ isOpen, onClose }: GmailConnectModalProps) {
    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
                    >
                        {/* Modal */}
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-100 dark:border-slate-800"
                        >
                            {/* Header Gradient */}
                            <div className="bg-gradient-to-r from-blue-600 to-red-500 h-2 w-full" />

                            <div className="p-8 text-center relative">
                                <button
                                    onClick={onClose}
                                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                                >
                                    <X size={20} />
                                </button>

                                <div className="w-20 h-20 bg-white dark:bg-slate-800 rounded-full shadow-lg mx-auto flex items-center justify-center mb-6 relative z-10 -mt-2">
                                    <svg viewBox="0 0 24 24" className="w-10 h-10"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
                                </div>

                                <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-3">
                                    Conexión Requerida
                                </h2>

                                <p className="text-gray-600 dark:text-gray-300 mb-6 text-sm leading-relaxed">
                                    Para publicar horarios, debes verificar tu identidad conectando tu cuenta de <strong>Gmail Tacos Gavilan</strong>.
                                </p>

                                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 mb-8 text-left flex gap-3">
                                    <ShieldCheck className="text-blue-600 shrink-0 mt-0.5" size={20} />
                                    <div className="text-xs text-blue-800 dark:text-blue-200">
                                        <span className="font-bold block mb-1">¿Por qué es obligatorio?</span>
                                        Tus empleados recibirán el horario desde <b>TU</b> correo. Esto genera confianza y evita que los correos terminen en SPAM.
                                    </div>
                                </div>

                                <a
                                    href="/api/auth/google/start?returnUrl=/planificador"
                                    className="w-full bg-white border border-gray-300 text-gray-700 py-3.5 px-4 rounded-xl font-bold hover:bg-gray-50 hover:shadow-lg transition-all flex items-center justify-center gap-3 group"
                                >
                                    <svg viewBox="0 0 24 24" className="w-5 h-5 group-hover:scale-110 transition-transform"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
                                    Conectar mi Gmail Ahora
                                </a>

                                <button
                                    onClick={onClose}
                                    className="mt-4 text-xs font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                >
                                    Cancelar y volver al borrador
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    )
}
