/**
 * @module components/ronos/modals/PhotoModal
 * @description Modal accesible para visualizar y rotar fotografías del reloj checador.
 *   - Permite rotar la imagen 90° para corregir orientaciones de cámaras en tienda.
 *   - Foco atrapado, tecla Escape, rol dialog y áreas táctiles de al menos 44px.
 *
 * @businessRules
 *   - Visualización protegida de solo lectura de la fotografía del checador.
 *
 * @dataFlow
 *   Invocado desde `StoreAttendanceTab` y `EmployeeDetailView`.
 *
 * @notes
 *   - Cumple con estándar Mobile-First y WCAG 2.1 AA.
 *   - Bilingüe completo (i18n).
 */

'use client'

import React, { useEffect, useRef } from 'react'
import { X, RotateCw, Camera } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { PhotoModalState } from '../types'

interface PhotoModalProps {
  modalState: PhotoModalState
  onClose: () => void
  onRotate: () => void
}

export default function PhotoModal({ modalState, onClose, onRotate }: PhotoModalProps) {
  const { t } = useLanguage()
  const modalRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!modalState.isOpen) return

    // Focus en el botón de cerrar al abrir
    closeBtnRef.current?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Tab' && modalRef.current) {
        // Atrapamiento de foco
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [modalState.isOpen, onClose])

  if (!modalState.isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="photo-modal-title"
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div
        ref={modalRef}
        className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4"
      >
        {/* Cabecera del Modal */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-sky-100 dark:bg-sky-950 text-[#0288d1] flex items-center justify-center shrink-0">
              <Camera className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 id="photo-modal-title" className="font-black text-sm sm:text-base text-slate-900 dark:text-white truncate">
                {modalState.title || t('ronos.modals.photo_title')} · {modalState.employeeName}
              </h3>
              <p className="text-xs text-slate-400 font-mono mt-0.5 truncate">
                {modalState.timestamp}
              </p>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label={t('ronos.modals.close') || 'Cerrar'}
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Visor de Imagen */}
        <div className="bg-slate-950 rounded-xl p-3 flex items-center justify-center min-h-[260px] max-h-[380px] overflow-hidden">
          <img
            src={modalState.photoUrl}
            alt={`Fotografía de ${modalState.employeeName}`}
            style={{ transform: `rotate(${modalState.rotation}deg)` }}
            className="max-h-72 max-w-full rounded object-contain transition-transform duration-300 shadow-md"
          />
        </div>

        {/* Barra de Acciones con Controles >= 44px */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={onRotate}
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 cursor-pointer transition-colors"
          >
            <RotateCw className="w-4 h-4 text-[#0288d1]" />
            <span>{t('ronos.modals.rotate') || 'Rotar Foto (90°)'}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-5 py-2 rounded-xl bg-[#0288d1] hover:bg-[#0277bd] text-white text-xs font-bold shadow-xs cursor-pointer transition-colors"
          >
            {t('ronos.modals.close') || 'Cerrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
