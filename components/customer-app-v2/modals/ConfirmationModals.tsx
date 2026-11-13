/**
 * @module components/customer-app-v2/modals/ConfirmationModals
 * @description Modales de confirmación crítica para Tacos Gavilan App V2:
 * reinicio de sesión y limpieza completa de bolsa (`wrapperResetModalOpen`),
 * cambio entre Pickup y Delivery (`pendingModeSwitch`) y confirmación de eliminación
 * permanente de cuenta (`v2DeleteModalOpen`) con manejo explícito de errores del backend.
 *
 * @businessRules
 * - Si `/api/mobile/user/delete` falla o está en Demo #12, el modal conserva abierto el error
 *   explícito (`deleteAccountError`) sin fingir que la cuenta fue borrada.
 * - Textos 100% bilingües vía `t('mobile_legal.*')`.
 *
 * @dataFlow
 * - Consume `ctrl` (`handleWrapperResetConfirm`, `handleConfirmModeSwitch`, `handleConfirmDeleteV2Account`).
 *
 * @notes
 * - Reemplaza confirmaciones silenciosas por verificación estricta de estado HTTP.
 */

'use client'

import React from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import type { CustomerAppV2Controller } from '../hooks/useCustomerAppV2'

export function ConfirmationModals({ ctrl }: { ctrl: CustomerAppV2Controller }) {
  const {
    t,
    wrapperResetModalOpen,
    setWrapperResetModalOpen,
    handleWrapperResetConfirm,
    pendingModeSwitch,
    setPendingModeSwitch,
    handleConfirmModeSwitch,
    v2DeleteModalOpen,
    setV2DeleteModalOpen,
    deletingV2Account,
    deleteAccountError,
    setDeleteAccountError,
    handleConfirmDeleteV2Account,
  } = ctrl

  return (
    <>
      {wrapperResetModalOpen && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-5">
          <div className="w-full max-w-sm rounded-2xl bg-[#1c1c1e] border border-white/15 p-5 space-y-4 shadow-2xl">
            <h4 className="text-base font-black text-white">
              {t('mobile_legal.wrapper_reset_modal_title')}
            </h4>
            <p className="text-xs text-white/75 leading-relaxed">
              {t('mobile_legal.wrapper_reset_modal_desc')}
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setWrapperResetModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold cursor-pointer"
              >
                {t('mobile_legal.wrapper_reset_cancel_btn')}
              </button>
              <button
                type="button"
                onClick={handleWrapperResetConfirm}
                className="flex-1 py-2.5 rounded-xl bg-[#DA291C] hover:bg-[#b81d13] text-white text-xs font-black uppercase cursor-pointer"
              >
                {t('mobile_legal.wrapper_reset_confirm_btn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingModeSwitch && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-5">
          <div className="w-full max-w-sm rounded-2xl bg-[#1c1c1e] border border-white/15 p-5 space-y-4 shadow-2xl">
            <h4 className="text-base font-black text-white">
              {t('mobile_legal.wrapper_switch_mode_title')}
            </h4>
            <p className="text-xs text-white/75 leading-relaxed">
              {t('mobile_legal.wrapper_switch_mode_desc')}
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingModeSwitch(null)}
                className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold cursor-pointer"
              >
                {t('mobile_legal.wrapper_reset_cancel_btn')}
              </button>
              <button
                type="button"
                onClick={handleConfirmModeSwitch}
                className="flex-1 py-2.5 rounded-xl bg-[#DA291C] hover:bg-[#b81d13] text-white text-xs font-black uppercase cursor-pointer"
              >
                {t('mobile_legal.wrapper_switch_mode_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {v2DeleteModalOpen && (
        <div className="absolute inset-0 z-[70] bg-black/85 backdrop-blur-sm flex items-center justify-center p-5">
          <div className="w-full max-w-sm rounded-2xl bg-[#1c1c1e] border border-red-500/40 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-red-400">
              <Trash2 size={18} />
              <h4 className="text-base font-black text-white">
                {t('mobile_legal.v2_delete_modal_title')}
              </h4>
            </div>
            <p className="text-xs text-white/75 leading-relaxed">
              {t('mobile_legal.v2_delete_modal_desc')}
            </p>

            {deleteAccountError && (
              <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 text-xs font-bold flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                <span>{deleteAccountError}</span>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setDeleteAccountError(null)
                  setV2DeleteModalOpen(false)
                }}
                disabled={deletingV2Account}
                className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold cursor-pointer"
              >
                {t('mobile_legal.v2_cancel_edit_btn')}
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteV2Account}
                disabled={deletingV2Account}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase cursor-pointer disabled:opacity-60"
              >
                {deletingV2Account
                  ? t('mobile_legal.delete_deleting')
                  : t('mobile_legal.v2_delete_modal_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
