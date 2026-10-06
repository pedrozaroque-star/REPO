/**
 * @module components/StaffEvaluationQRModal
 * @description Modal interactivo para la visualización, descarga e impresión de códigos QR
 * y stickers oficiales de Evaluación de Personal (STAFF) de Tacos Gavilan.
 * Permite a gerentes y administradores obtener el QR genérico (con detección GPS automática
 * al estilo del feedback de clientes) o personalizado por sucursal específica.
 * @businessRules
 * - El código QR dirige a la ruta pública '/evaluacion/kiosk' sin requerir inicio de sesión.
 * - Soporta descarga en alta definición (PNG 300 DPI, vectorial SVG y plantilla PDF de 4 stickers).
 * - Ofrece función de impresión directa en el navegador optimizada para papel etiqueta/autoadhesivo.
 * @dataFlow
 * - Stores state -> URL constructora -> Previsualización -> Descarga / Impresión.
 * @notes
 * - Bilingüe (Español / Inglés) vía useLanguage().
 * - Totalmente responsive (móvil, tableta y escritorio).
 */

'use client'

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    X, QrCode, Download, Printer, ExternalLink,
    CheckCircle2, Sparkles, Building2, MapPin, Copy, FileText
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { formatStoreName } from '@/lib/supabase'

interface Store {
    id: number
    name: string
}

interface StaffEvaluationQRModalProps {
    isOpen: boolean
    onClose: () => void
    stores: Store[]
}

const PRODUCTION_DOMAIN = 'https://tacosgavilan.vercel.app'

export default function StaffEvaluationQRModal({
    isOpen,
    onClose,
    stores
}: StaffEvaluationQRModalProps) {
    const { t, language } = useLanguage()
    const isEs = language === 'es'

    const [selectedDestination, setSelectedDestination] = useState<string>('generic')
    const [copied, setCopied] = useState(false)
    const [activeTab, setActiveTab] = useState<'sticker' | 'qr'>('sticker')

    if (!isOpen) return null

    // URL dinámica según destino
    const targetUrl = selectedDestination === 'generic'
        ? `${PRODUCTION_DOMAIN}/evaluacion/kiosk`
        : `${PRODUCTION_DOMAIN}/evaluacion/kiosk?store=${selectedDestination}`

    const handleCopyUrl = async () => {
        try {
            await navigator.clipboard.writeText(targetUrl)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error('Error copying URL:', err)
        }
    }

    const handlePrint = () => {
        window.open('/plantilla_stickers_evaluacion.pdf', '_blank')
    }

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto bg-slate-950/80 backdrop-blur-sm print:p-0 print:bg-white">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[92vh]"
                >
                    {/* CABECERA */}
                    <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-gradient-to-r from-red-600/10 via-amber-500/10 to-transparent flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-red-600 text-white flex items-center justify-center shadow-md shadow-red-600/20">
                                <QrCode size={20} />
                            </div>
                            <div>
                                <h3 className="text-base sm:text-lg font-black text-slate-800 dark:text-white">
                                    {t('evaluaciones_staff.qr_modal_title')}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    {t('evaluaciones_staff.qr_modal_subtitle')}
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={onClose}
                            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-700 dark:text-slate-400 transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {/* CUERPO CON SCROLL */}
                    <div className="p-6 space-y-6 overflow-y-auto flex-1">
                        
                        {/* SELECTOR DE DESTINO */}
                        <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/60">
                            <label className="block text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                                {t('evaluaciones_staff.qr_select_destination')}
                            </label>
                            
                            <select
                                value={selectedDestination}
                                onChange={(e) => setSelectedDestination(e.target.value)}
                                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-white font-semibold text-sm focus:ring-2 focus:ring-red-500 focus:outline-none transition-all shadow-sm"
                            >
                                <option value="generic">
                                    ⭐ {t('evaluaciones_staff.qr_dest_generic')}
                                </option>
                                <optgroup label={isEs ? 'Fijar para Sucursal Específica' : 'Lock to Specific Store'}>
                                    {stores.map(s => (
                                        <option key={s.id} value={s.id}>
                                            📍 {formatStoreName(s.name)}
                                        </option>
                                    ))}
                                </optgroup>
                            </select>

                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 flex items-center gap-1.5">
                                <Sparkles size={13} className="text-amber-500 flex-shrink-0" />
                                {selectedDestination === 'generic'
                                    ? t('evaluaciones_staff.qr_dest_generic_desc')
                                    : (isEs 
                                        ? `Al escanearlo, preseleccionará automáticamente la sucursal seleccionada.`
                                        : `When scanned, it will automatically pre-select this store.`)}
                            </p>
                        </div>

                        {/* SELECTOR DE VISTA PREVIA (STICKER VS QR PURO) */}
                        <div className="flex items-center justify-center gap-2">
                            <button
                                type="button"
                                onClick={() => setActiveTab('sticker')}
                                className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${
                                    activeTab === 'sticker'
                                        ? 'bg-red-600 text-white shadow-sm'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                                }`}
                            >
                                {isEs ? '🏷️ Sticker Oficial Completo' : '🏷️ Full Official Sticker'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('qr')}
                                className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${
                                    activeTab === 'qr'
                                        ? 'bg-red-600 text-white shadow-sm'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                                }`}
                            >
                                {isEs ? '📱 Solo Código QR' : '📱 QR Code Only'}
                            </button>
                        </div>

                        {/* PREVISUALIZACIÓN CENTRAL */}
                        <div className="flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-950 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 relative group">
                            {activeTab === 'sticker' ? (
                                <div className="max-w-[280px] sm:max-w-[320px] rounded-2xl overflow-hidden shadow-xl border-2 border-red-500/30 transition-transform group-hover:scale-[1.01]">
                                    <img
                                        src="/sticker_evaluacion_staff.png"
                                        alt="Sticker Evaluación STAFF Tacos Gavilan"
                                        className="w-full h-auto object-contain bg-white"
                                    />
                                </div>
                            ) : (
                                <div className="p-4 bg-white rounded-2xl shadow-xl border border-slate-200">
                                    <img
                                        src="/qr_evaluacion_kiosk.png"
                                        alt="Código QR Evaluación STAFF"
                                        className="w-56 h-56 object-contain"
                                    />
                                </div>
                            )}

                            {/* URL pill con botón copiar */}
                            <div className="mt-4 flex items-center gap-2 bg-white dark:bg-slate-900 px-3.5 py-1.5 rounded-full border border-slate-200 dark:border-slate-800 shadow-sm max-w-full">
                                <span className="text-[11px] sm:text-xs font-mono font-bold text-slate-700 dark:text-slate-300 truncate">
                                    {targetUrl}
                                </span>
                                <button
                                    type="button"
                                    onClick={handleCopyUrl}
                                    className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                                    title={isEs ? 'Copiar enlace' : 'Copy URL'}
                                >
                                    {copied ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}
                                </button>
                                <a
                                    href={targetUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                                    title={isEs ? 'Abrir enlace' : 'Open link'}
                                >
                                    <ExternalLink size={14} />
                                </a>
                            </div>

                            <p className="text-[11px] text-slate-400 mt-2 text-center max-w-sm">
                                {t('evaluaciones_staff.qr_scan_instruction')}
                            </p>
                        </div>

                        {/* ACCIONES DE DESCARGA E IMPRESIÓN */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {/* Descargar Sticker PNG */}
                            <a
                                href="/sticker_evaluacion_staff.png"
                                download="Sticker_Evaluacion_STAFF_Tacos_Gavilan.png"
                                className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-md shadow-red-600/20 transition-all active:scale-95 text-center"
                            >
                                <Download size={16} />
                                <span>{t('evaluaciones_staff.qr_download_sticker')}</span>
                            </a>

                            {/* Descargar Hoja 4 Stickers en PDF */}
                            <a
                                href="/plantilla_stickers_evaluacion.pdf"
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs shadow-md transition-all active:scale-95 text-center"
                            >
                                <FileText size={16} />
                                <span>{t('evaluaciones_staff.qr_download_sheet')}</span>
                            </a>

                            {/* Descargar Solo QR PNG */}
                            <a
                                href="/qr_evaluacion_kiosk.png"
                                download="QR_Evaluacion_STAFF.png"
                                className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs border border-slate-200 dark:border-slate-700 transition-all active:scale-95 text-center"
                            >
                                <Download size={15} />
                                <span>{t('evaluaciones_staff.qr_download_png')}</span>
                            </a>

                            {/* Descargar Vectorial SVG */}
                            <a
                                href="/qr_evaluacion_kiosk.svg"
                                download="QR_Evaluacion_STAFF.svg"
                                className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs border border-slate-200 dark:border-slate-700 transition-all active:scale-95 text-center"
                            >
                                <Download size={15} />
                                <span>{t('evaluaciones_staff.qr_download_svg')}</span>
                            </a>
                        </div>
                    </div>

                    {/* PIE DEL MODAL */}
                    <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 flex items-center justify-between text-xs text-slate-500">
                        <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse" />
                            {isEs ? 'Listo para imprimir en papel autoadhesivo' : 'Ready to print on adhesive label paper'}
                        </span>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handlePrint}
                                className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm"
                            >
                                <Printer size={14} />
                                <span>{isEs ? 'Imprimir PDF' : 'Print PDF'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-3.5 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs transition-colors"
                            >
                                {isEs ? 'Cerrar' : 'Close'}
                            </button>
                        </div>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    )
}
