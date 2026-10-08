/**
 * @module components/maintenance/MaintenanceQRModal
 * @description Modal interactivo para visualizar, descargar e imprimir códigos QR oficiales
 * y hojas de stickers de Registro de Proveedores y Mantenimiento de Tacos Gavilan.
 * @businessRules
 * - Permite generar el código QR genérico o personalizado con el UUID/código de cada sucursal.
 * - Los técnicos escanean el QR pegado en la campana, oficina o cuarto eléctrico y acceden
 *   directamente al formulario '/mantenimiento/registro?store={store_id}' con la tienda preseleccionada.
 * - Soporta descarga en alta resolución y ventana de impresión para pegado en sucursal.
 * @dataFlow
 * - Lista de sucursales -> Selección de tienda -> Generación de URL y QR con SVG/Canvas -> Impresión/Descarga.
 * @notes
 * - Bilingüe (Español / Inglés) vía useLanguage().
 * - Totalmente responsive.
 */

'use client'

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, QrCode, Download, Printer, ExternalLink,
  CheckCircle2, Sparkles, Building2, MapPin, Copy, Wrench
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { formatStoreName } from '@/lib/supabase'

interface Store {
  id: string
  name: string
  code?: string
  city?: string
}

interface MaintenanceQRModalProps {
  isOpen: boolean
  onClose: () => void
  stores: Store[]
}

const PRODUCTION_DOMAIN = typeof window !== 'undefined'
  ? window.location.origin
  : 'https://tacosgavilan.vercel.app'

export default function MaintenanceQRModal({
  isOpen,
  onClose,
  stores
}: MaintenanceQRModalProps) {
  const { t, language } = useLanguage()
  const isEs = language === 'es'

  const [selectedStoreId, setSelectedStoreId] = useState<string>('generic')
  const [copied, setCopied] = useState(false)

  if (!isOpen) return null

  // URL dinámica según tienda seleccionada
  const targetUrl = selectedStoreId === 'generic'
    ? `${PRODUCTION_DOMAIN}/mantenimiento/registro`
    : `${PRODUCTION_DOMAIN}/mantenimiento/registro?store=${selectedStoreId}`

  // Generador de QR usando QuickChart API (vectorial y fiable)
  const qrImageUrl = `https://quickchart.io/qr?text=${encodeURIComponent(targetUrl)}&size=500&margin=2&ecLevel=H&format=png`

  const selectedStore = stores.find(s => s.id === selectedStoreId)
  const storeLabel = selectedStore
    ? formatStoreName(selectedStore.name) + (selectedStore.code ? ` #${selectedStore.code}` : '')
    : (isEs ? 'Todas las Sucursales (Genérico)' : 'All Stores (Generic)')

  const handleCopyLink = () => {
    navigator.clipboard.writeText(targetUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const handlePrint = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>QR Proveedores - ${storeLabel} - Tacos Gavilan</title>
          <style>
            @page { size: letter portrait; margin: 0.5in; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              color: #0f172a;
              text-align: center;
              margin: 0;
              padding: 20px;
            }
            .sticker-card {
              border: 3px solid #dc2626;
              border-radius: 24px;
              padding: 30px 20px;
              max-width: 480px;
              margin: 0 auto;
              box-shadow: 0 4px 12px rgba(0,0,0,0.08);
            }
            .brand {
              font-size: 26px;
              font-weight: 900;
              color: #dc2626;
              text-transform: uppercase;
              letter-spacing: 1px;
              margin-bottom: 4px;
            }
            .tagline {
              font-size: 14px;
              font-weight: 700;
              color: #475569;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin-bottom: 18px;
            }
            .store-badge {
              display: inline-block;
              background-color: #fef2f2;
              border: 1px solid #fecaca;
              color: #991b1b;
              font-size: 16px;
              font-weight: 800;
              padding: 6px 18px;
              border-radius: 9999px;
              margin-bottom: 20px;
            }
            .qr-wrapper {
              background: #ffffff;
              padding: 14px;
              border-radius: 16px;
              display: inline-block;
              border: 2px solid #e2e8f0;
            }
            .qr-img {
              width: 260px;
              height: 260px;
              display: block;
            }
            .instructions {
              margin-top: 20px;
              font-size: 15px;
              font-weight: 600;
              line-height: 1.4;
              color: #1e293b;
            }
            .instructions-en {
              margin-top: 6px;
              font-size: 13px;
              font-weight: 500;
              color: #64748b;
            }
            .footer {
              margin-top: 24px;
              font-size: 11px;
              color: #94a3b8;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
          </style>
        </head>
        <body>
          <div class="sticker-card">
            <div class="brand">Tacos Gavilan</div>
            <div class="tagline">Bitácora Oficial de Mantenimiento y Proveedores</div>
            <div class="store-badge">${storeLabel}</div>
            
            <div class="qr-wrapper">
              <img class="qr-img" src="${qrImageUrl}" alt="QR Mantenimiento" />
            </div>

            <div class="instructions">
              ⚠️ ATENCIÓN TÉCNICOS Y PROVEEDORES:<br>
              Escanee este código con su celular para registrar su visita, evidencias de trabajo y firma del encargado.
            </div>

            <div class="instructions-en">
              ATTENTION SERVICE TECHNICIANS & CONTRACTORS:<br>
              Scan this QR code with your phone camera to log your service visit, before/after photos, and manager signature.
            </div>

            <div class="footer">
              Tacos Gavilan Enterprise System • www.tacosgavilan.com
            </div>
          </div>
          <script>
            window.onload = function() {
              window.print();
            }
          </script>
        </body>
      </html>
    `)
    printWindow.document.close()
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-700 w-full max-w-xl overflow-hidden flex flex-col max-h-[92vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-gray-700 bg-gradient-to-r from-red-50 to-amber-50 dark:from-red-950/20 dark:to-amber-950/20">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-red-600 text-white shadow-md shadow-red-600/20">
                <QrCode size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {t('maintenance.qr_modal_title')}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('maintenance.qr_modal_desc')}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 overflow-y-auto space-y-6">
            {/* Store selector */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 mb-2">
                {t('maintenance.select_store')}
              </label>
              <select
                value={selectedStoreId}
                onChange={(e) => setSelectedStoreId(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-medium text-sm focus:ring-2 focus:ring-red-500 focus:outline-none transition-shadow"
              >
                <option value="generic">
                  🌐 {isEs ? 'Enlace Genérico (Permite al técnico elegir la tienda)' : 'Generic Link (Technician selects store)'}
                </option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    📍 {formatStoreName(s.name)} {s.code ? `(#${s.code})` : ''} {s.city ? `— ${s.city}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* QR Sticker Preview */}
            <div className="flex flex-col items-center justify-center p-6 bg-gray-50 dark:bg-gray-900/60 rounded-3xl border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-3">
                <Wrench className="text-red-600 dark:text-red-400" size={18} />
                <span className="text-xs font-black tracking-widest text-red-700 dark:text-red-400 uppercase">
                  Tacos Gavilan • Mantenimiento
                </span>
              </div>

              <div className="px-3 py-1 rounded-full bg-red-100 dark:bg-red-950/80 text-red-700 dark:text-red-300 text-xs font-extrabold mb-4">
                {storeLabel}
              </div>

              <div className="p-4 bg-white rounded-2xl shadow-md border border-gray-200 dark:border-gray-600">
                <img
                  src={qrImageUrl}
                  alt={`QR ${storeLabel}`}
                  className="w-52 h-52 object-contain block"
                />
              </div>

              <p className="mt-4 text-xs font-semibold text-center text-gray-600 dark:text-gray-400 max-w-sm">
                {isEs
                  ? 'Pegue este código en la campana de cocina, cuarto de máquinas o tablero de control.'
                  : 'Display this QR code near kitchen hoods, machine room, or control panel.'}
              </p>
            </div>

            {/* Link Copy Box */}
            <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-900/40 rounded-2xl border border-gray-200 dark:border-gray-700">
              <input
                type="text"
                readOnly
                value={targetUrl}
                className="flex-1 bg-transparent text-xs text-gray-600 dark:text-gray-300 font-mono focus:outline-none select-all truncate"
              />
              <button
                onClick={handleCopyLink}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-xs font-bold text-gray-800 dark:text-gray-200 transition-colors shrink-0"
              >
                {copied ? <CheckCircle2 size={14} className="text-emerald-600" /> : <Copy size={14} />}
                <span>{copied ? t('maintenance.link_copied') : t('maintenance.copy_link')}</span>
              </button>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="p-6 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 flex flex-wrap items-center justify-between gap-3">
            <a
              href={targetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
            >
              <ExternalLink size={14} />
              <span>{t('maintenance.open_kiosk')}</span>
            </a>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              >
                {t('common.cancel')}
              </button>

              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-md shadow-red-600/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <Printer size={16} />
                <span>{t('maintenance.print_qr')}</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
