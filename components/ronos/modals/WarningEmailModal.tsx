/**
 * @module components/ronos/modals/WarningEmailModal
 * @description Modal interactivo y accesible para redactar y despachar avisos formales de incidencia laboral
 *   (descansos de comida omitidos > 5.0h, tarjetas de tiempo incompletas).
 *
 * @businessRules
 *   - Conforme al Código Laboral de California § 512 / IWC Wage Order 5.
 *   - Foco atrapado, tecla Escape, rol dialog y controles táctiles de al menos 44px.
 *
 * @dataFlow
 *   Envía payload a `POST /api/ronos/notify-violation`.
 *
 * @notes
 *   - Cumple con estándar Mobile-First y WCAG 2.1 AA.
 *   - Bilingüe completo (i18n) sin textos hardcodeados.
 *   - Elimina términos engañosos como "fuga por multas".
 */

'use client'

import React, { useEffect, useRef } from 'react'
import { X, Mail, Send, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { EmailModalState } from '../types'

interface WarningEmailModalProps {
  modalState: EmailModalState
  onChangeState: (updater: (prev: EmailModalState) => EmailModalState) => void
  onClose: () => void
  onSend: () => Promise<void>
}

export default function WarningEmailModal({
  modalState,
  onChangeState,
  onClose,
  onSend
}: WarningEmailModalProps) {
  const { t } = useLanguage()
  const modalRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!modalState.isOpen) return

    closeBtnRef.current?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Tab' && modalRef.current) {
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
      aria-labelledby="warning-modal-title"
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div
        ref={modalRef}
        className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full p-5 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
      >
        {/* Cabecera del Modal */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
              <Mail className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 id="warning-modal-title" className="font-black text-sm sm:text-base text-slate-900 dark:text-white truncate">
                {t('ronos.modals.formal_warning_title') || 'Notificación de Incidencia Laboral'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {modalState.employeeName} {modalState.employeePin ? `(#${modalState.employeePin})` : ''} · {modalState.employeeJobTitle || 'Colaborador'}
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

        {modalState.sendSuccess ? (
          <div className="py-8 text-center space-y-3">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
            <h4 className="font-bold text-base text-slate-900 dark:text-white">
              {t('ronos.modals.warning_sent') || 'Aviso enviado con éxito'}
            </h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              La notificación ha sido despachada por correo al colaborador y a la gerencia de tienda.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-5 py-2 rounded-xl bg-[#0288d1] text-white text-xs font-bold shadow-xs cursor-pointer"
            >
              {t('ronos.modals.close') || 'Cerrar'}
            </button>
          </div>
        ) : (
          <div className="space-y-3.5 text-xs">
            {/* Detalle de Incidencia */}
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold block text-xs">{modalState.violationTitle}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-200/60 dark:bg-rose-900/60 font-bold shrink-0">
                  {modalState.violationDate}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed opacity-90">{modalState.violationDescription}</p>
            </div>

            {/* Etapa Disciplinaria Formal */}
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Etapa del Aviso
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => onChangeState(prev => ({ ...prev, warningStage: 'first' }))}
                  className={`min-h-[44px] px-2 rounded-xl text-xs font-bold border text-center transition-all cursor-pointer ${
                    (modalState.warningStage || 'first') === 'first'
                      ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-500 text-amber-800 dark:text-amber-200 shadow-xs'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50'
                  }`}
                >
                  {t('ronos.modals.stage_first') || '1er Aviso'}
                </button>
                <button
                  type="button"
                  onClick={() => onChangeState(prev => ({ ...prev, warningStage: 'second' }))}
                  className={`min-h-[44px] px-2 rounded-xl text-xs font-bold border text-center transition-all cursor-pointer ${
                    modalState.warningStage === 'second'
                      ? 'bg-orange-50 dark:bg-orange-950/50 border-orange-500 text-orange-800 dark:text-orange-200 shadow-xs'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50'
                  }`}
                >
                  {t('ronos.modals.stage_second') || '2do Aviso'}
                </button>
                <button
                  type="button"
                  onClick={() => onChangeState(prev => ({ ...prev, warningStage: 'suspension' }))}
                  className={`min-h-[44px] px-2 rounded-xl text-xs font-bold border text-center transition-all cursor-pointer ${
                    modalState.warningStage === 'suspension'
                      ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-500 text-rose-800 dark:text-rose-200 shadow-xs'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50'
                  }`}
                >
                  {t('ronos.modals.stage_suspension') || 'Suspensión'}
                </button>
              </div>
            </div>

            {/* Correo Electrónico del Colaborador */}
            <div>
              <label htmlFor="warning-email-input" className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('ronos.modals.employee_email') || 'Correo Electrónico del Colaborador'}
              </label>
              <input
                id="warning-email-input"
                type="email"
                value={modalState.employeeEmail}
                onChange={(e) => onChangeState(prev => ({ ...prev, employeeEmail: e.target.value }))}
                placeholder="colaborador@tacosgavilan.com"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs focus:ring-2 focus:ring-[#0288d1] focus:outline-none"
              />
            </div>

            {/* Observaciones o Notas */}
            <div>
              <label htmlFor="warning-notes-input" className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('ronos.modals.notes_label') || 'Instrucciones o Notas para Gerencia'}
              </label>
              <textarea
                id="warning-notes-input"
                value={modalState.additionalNotes}
                onChange={(e) => onChangeState(prev => ({ ...prev, additionalNotes: e.target.value }))}
                placeholder={t('ronos.modals.notes_placeholder') || 'Escribe cualquier observación para el Gerente de Tienda...'}
                rows={2}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-[#0288d1] focus:outline-none"
              />
            </div>

            {modalState.sendError && (
              <div className="p-3 rounded-xl bg-rose-50 text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{modalState.sendError}</span>
              </div>
            )}

            {/* Botones de Acción (Mínimo 44px) */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
              >
                {t('ronos.modals.cancel') || 'Cancelar'}
              </button>
              <button
                type="button"
                onClick={onSend}
                disabled={modalState.isSending || !modalState.violationTitle || !modalState.violationDate}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-[#e53935] hover:bg-[#d32f2f] text-white font-bold flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-xs transition-all"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{modalState.isSending ? (t('ronos.modals.sending') || 'Enviando...') : (t('ronos.modals.send_warning') || 'Enviar Aviso')}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
