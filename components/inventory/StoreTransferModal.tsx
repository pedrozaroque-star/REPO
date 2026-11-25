'use client'

/**
 * @module components/inventory/StoreTransferModal
 * @description Modal bilingüe (`es`/`en`) para registrar, confirmar/rechazar y auditar
 *              Traspasos / Préstamos de bolsas e insumos entre sucursales de Tacos Gavilan.
 *
 * @businessRules
 * - Todo texto visible usa `useLanguage()` (`food_cost.store_transfers.*`) sin strings hardcodeados.
 * - Si el usuario es `admin` o `supervisor`, el traspaso se guarda directamente como `'confirmed'`.
 * - Si el usuario es `manager` o `asistente`, el traspaso nace como `'pending'` para ser confirmado
 *   por la sucursal contraparte o por un Supervisor/Admin.
 * - Al crear, confirmar, rechazar o cancelar un traspaso, invoca `onTransfersUpdated()` para
 *   recalcular de inmediato Orden Diaria o `Toast vs. Sobrantes`.
 *
 * @dataFlow
 * - `GET/POST/PATCH/DELETE /api/inventory/transfers` -> `StoreTransferModal` -> `onTransfersUpdated`.
 *
 * @notes
 * - Usa `formatStoreDisplayName` para nomenclatura interna estandarizada (`#14 Lynwood`, etc.).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Check, RefreshCw, Trash2, X } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { formatStoreDisplayName, sortStoresAlphabetically } from '@/lib/store-display'

interface StoreTransferRow {
  id: string
  transferDate: string
  fromStoreId: number
  fromStoreName: string
  toStoreId: number
  toStoreName: string
  inventoryItemId: string
  itemName: string
  itemSku: string | null
  itemUnitDesc: string | null
  quantity: number
  status: 'pending' | 'confirmed' | 'rejected' | string
  notes: string | null
  createdByUserId: number | null
  createdByName: string | null
  confirmedByUserId: number | null
  confirmedByName: string | null
  confirmedAt: string | null
  createdAt: string
}

interface StoreOption {
  id: number
  name: string
}

interface ItemOption {
  id: string
  name: string
  sku: string | null
  unitDesc: string | null
}

interface UserTransferContext {
  userId: number | null
  role: string
  isGlobal: boolean
  userStoreId: number | null
  todayLA: string
}

export interface StoreTransferModalProps {
  isOpen: boolean
  onClose: () => void
  defaultStoreId?: number | null
  defaultIngredientId?: string | null
  onTransfersUpdated?: () => void
}

function buildAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('teg_token')
    if (token) headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

export default function StoreTransferModal({
  isOpen,
  onClose,
  defaultStoreId = null,
  defaultIngredientId = null,
  onTransfersUpdated,
}: StoreTransferModalProps) {
  const { t } = useLanguage()

  const [loading, setLoading] = useState<boolean>(false)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const [transfers, setTransfers] = useState<StoreTransferRow[]>([])
  const [storesCatalog, setStoresCatalog] = useState<StoreOption[]>([])
  const [itemsCatalog, setItemsCatalog] = useState<ItemOption[]>([])
  const [userCtx, setUserCtx] = useState<UserTransferContext | null>(null)

  const [fromStoreId, setFromStoreId] = useState<string>('')
  const [toStoreId, setToStoreId] = useState<string>('')
  const [itemSearch, setItemSearch] = useState<string>('')
  const [selectedItemId, setSelectedItemId] = useState<string>('')
  const [quantity, setQuantity] = useState<string>('1')
  const [transferDate, setTransferDate] = useState<string>('')
  const [notes, setNotes] = useState<string>('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ includeCatalog: '1' })
      if (defaultStoreId && defaultStoreId > 0) {
        qs.set('storeId', String(defaultStoreId))
      }
      const res = await fetch(`/api/inventory/transfers?${qs.toString()}`, {
        credentials: 'include',
        headers: buildAuthHeaders(),
      })
      const json = await res.json()
      if (!res.ok) {
        setFeedback({ ok: false, text: String(json?.error || `HTTP ${res.status}`) })
        return
      }
      const formattedStores: StoreOption[] = sortStoresAlphabetically(
        (json.storesCatalog || []).map((s: StoreOption) => ({
          id: s.id,
          name: formatStoreDisplayName({ id: s.id, name: s.name }) || s.name,
        })),
        (s) => s.name
      )
      setStoresCatalog(formattedStores)
      setItemsCatalog(json.itemsCatalog || [])
      setTransfers(
        (json.transfers || []).map((tr: StoreTransferRow) => ({
          ...tr,
          fromStoreName: formatStoreDisplayName({ id: tr.fromStoreId, name: tr.fromStoreName }) || tr.fromStoreName,
          toStoreName: formatStoreDisplayName({ id: tr.toStoreId, name: tr.toStoreName }) || tr.toStoreName,
        }))
      )
      if (json.userContext) {
        setUserCtx(json.userContext)
        setTransferDate((prev) => prev || json.userContext.todayLA || '')
        const preferredFrom = defaultStoreId || json.userContext.userStoreId
        if (preferredFrom) {
          setFromStoreId((prev) => prev || String(preferredFrom))
        }
      }
      if (defaultIngredientId) {
        setSelectedItemId((prev) => prev || defaultIngredientId)
      }
    } catch (err: any) {
      setFeedback({ ok: false, text: String(err?.message || 'Error') })
    } finally {
      setLoading(false)
    }
  }, [defaultStoreId, defaultIngredientId])

  useEffect(() => {
    if (isOpen) {
      setFeedback(null)
      loadData()
    }
  }, [isOpen, loadData])

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase()
    if (!q) return itemsCatalog
    return itemsCatalog.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.sku && it.sku.toLowerCase().includes(q)) ||
        it.id === selectedItemId
    )
  }, [itemsCatalog, itemSearch, selectedItemId])

  const pendingTransfers = useMemo(
    () => transfers.filter((tr) => tr.status === 'pending'),
    [transfers]
  )

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setFeedback(null)
    try {
      const res = await fetch('/api/inventory/transfers', {
        method: 'POST',
        credentials: 'include',
        headers: buildAuthHeaders(),
        body: JSON.stringify({
          from_store_id: Number(fromStoreId),
          to_store_id: Number(toStoreId),
          inventory_item_id: selectedItemId,
          quantity: Number(quantity),
          transfer_date: transferDate,
          notes: notes.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setFeedback({ ok: false, text: String(json?.error || `HTTP ${res.status}`) })
        return
      }
      const isConfirmed = json?.transfer?.status === 'confirmed'
      setFeedback({
        ok: true,
        text: isConfirmed
          ? t('food_cost.store_transfers.created_ok_confirmed')
          : t('food_cost.store_transfers.created_ok_pending'),
      })
      setQuantity('1')
      setNotes('')
      await loadData()
      onTransfersUpdated?.()
    } catch (err: any) {
      setFeedback({ ok: false, text: String(err?.message || 'Error') })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDecision = async (id: string, action: 'confirm' | 'reject') => {
    setActionId(id)
    setFeedback(null)
    try {
      const res = await fetch('/api/inventory/transfers', {
        method: 'PATCH',
        credentials: 'include',
        headers: buildAuthHeaders(),
        body: JSON.stringify({ id, action }),
      })
      const json = await res.json()
      if (!res.ok) {
        setFeedback({ ok: false, text: String(json?.error || `HTTP ${res.status}`) })
        return
      }
      await loadData()
      onTransfersUpdated?.()
    } catch (err: any) {
      setFeedback({ ok: false, text: String(err?.message || 'Error') })
    } finally {
      setActionId(null)
    }
  }

  const handleDelete = async (id: string) => {
    setActionId(id)
    setFeedback(null)
    try {
      const res = await fetch(`/api/inventory/transfers?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: buildAuthHeaders(),
      })
      const json = await res.json()
      if (!res.ok) {
        setFeedback({ ok: false, text: String(json?.error || `HTTP ${res.status}`) })
        return
      }
      await loadData()
      onTransfersUpdated?.()
    } catch (err: any) {
      setFeedback({ ok: false, text: String(err?.message || 'Error') })
    } finally {
      setActionId(null)
    }
  }

  if (!isOpen) return null

  const renderStatusBadge = (status: string) => {
    if (status === 'confirmed') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
          {t('food_cost.store_transfers.status_confirmed')}
        </span>
      )
    }
    if (status === 'rejected') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
          {t('food_cost.store_transfers.status_rejected')}
        </span>
      )
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
        {t('food_cost.store_transfers.status_pending')}
      </span>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4 bg-slate-50/80 dark:bg-slate-900">
          <div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              {t('food_cost.store_transfers.modal_title')}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              {t('food_cost.store_transfers.modal_subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {feedback && (
            <div
              className={`rounded-xl px-4 py-3 text-xs font-bold border ${
                feedback.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200'
                  : 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200'
              }`}
            >
              {feedback.text}
            </div>
          )}

          {/* Pending Confirmations */}
          {pendingTransfers.length > 0 && (
            <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/20 p-4 space-y-2.5">
              <div className="text-xs font-black uppercase tracking-wider text-amber-900 dark:text-amber-300">
                ⏳ {t('food_cost.store_transfers.pending_section')} ({pendingTransfers.length})
              </div>
              <div className="space-y-2">
                {pendingTransfers.map((pt) => {
                  const canConfirm =
                    Boolean(userCtx?.isGlobal) ||
                    (userCtx?.userId !== null && pt.createdByUserId !== userCtx?.userId)
                  return (
                    <div
                      key={pt.id}
                      className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 rounded-lg px-3.5 py-2.5 border border-amber-200 dark:border-amber-900/60"
                    >
                      <div className="text-xs">
                        <span className="font-black text-slate-900 dark:text-white">
                          {pt.fromStoreName} → {pt.toStoreName}
                        </span>{' '}
                        · <span className="font-bold text-indigo-700 dark:text-indigo-300">{pt.quantity}</span>{' '}
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{pt.itemName}</span>{' '}
                        <span className="text-slate-500">({pt.transferDate})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {canConfirm && (
                          <button
                            type="button"
                            disabled={actionId === pt.id}
                            onClick={() => handleDecision(pt.id, 'confirm')}
                            className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            {t('food_cost.store_transfers.confirm_btn')}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={actionId === pt.id}
                          onClick={() => handleDecision(pt.id, 'reject')}
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
                        >
                          {t('food_cost.store_transfers.reject_btn')}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* New Transfer Form */}
          <form
            onSubmit={handleCreate}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 p-4 space-y-4"
          >
            <div className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
              {t('food_cost.store_transfers.new_section')}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('food_cost.store_transfers.from_store')}
                </label>
                <select
                  required
                  value={fromStoreId}
                  onChange={(e) => setFromStoreId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100"
                >
                  <option value="">{t('food_cost.store_transfers.select_store')}</option>
                  {storesCatalog.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('food_cost.store_transfers.to_store')}
                </label>
                <select
                  required
                  value={toStoreId}
                  onChange={(e) => setToStoreId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100"
                >
                  <option value="">{t('food_cost.store_transfers.select_store')}</option>
                  {storesCatalog
                    .filter((s) => String(s.id) !== fromStoreId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2 space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('food_cost.store_transfers.item_label')}
                </label>
                <input
                  type="text"
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder={t('food_cost.store_transfers.item_search_placeholder')}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100"
                />
                <select
                  required
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100"
                >
                  <option value="">{t('food_cost.store_transfers.select_item')}</option>
                  {filteredItems.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} {it.unitDesc ? `${it.unitDesc}` : ''} {it.sku ? `[${it.sku}]` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {t('food_cost.store_transfers.qty_label')}
                  </label>
                  <input
                    required
                    type="number"
                    min="0.25"
                    max="500"
                    step="0.25"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold text-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {t('food_cost.store_transfers.date_label')}
                  </label>
                  <input
                    required
                    type="date"
                    value={transferDate}
                    max={userCtx?.todayLA || undefined}
                    onChange={(e) => setTransferDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {t('food_cost.store_transfers.notes_label')}
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('food_cost.store_transfers.notes_placeholder')}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-800 dark:text-slate-100"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || !fromStoreId || !toStoreId || !selectedItemId || fromStoreId === toStoreId}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black shadow-sm disabled:opacity-50 cursor-pointer transition-all"
              >
                {submitting
                  ? t('food_cost.store_transfers.saving_btn')
                  : t('food_cost.store_transfers.submit_btn')}
              </button>
            </div>
          </form>

          {/* History Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                {t('food_cost.store_transfers.history_section')}
              </span>
              <button
                type="button"
                onClick={loadData}
                disabled={loading}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {transfers.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                {t('food_cost.store_transfers.empty_history')}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-bold">
                    <tr>
                      <th className="px-3 py-2">{t('food_cost.store_transfers.col_date')}</th>
                      <th className="px-3 py-2">{t('food_cost.store_transfers.col_flow')}</th>
                      <th className="px-3 py-2">{t('food_cost.store_transfers.col_item')}</th>
                      <th className="px-3 py-2 text-right">{t('food_cost.store_transfers.col_qty')}</th>
                      <th className="px-3 py-2">{t('food_cost.store_transfers.col_status')}</th>
                      <th className="px-3 py-2">{t('food_cost.store_transfers.col_by')}</th>
                      <th className="px-3 py-2 text-right">{t('food_cost.store_transfers.col_actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {transfers.map((tr) => {
                      const canDelete =
                        Boolean(userCtx?.isGlobal) ||
                        (tr.status === 'pending' && userCtx?.userId !== null && tr.createdByUserId === userCtx?.userId)
                      return (
                        <tr key={tr.id} className="bg-white dark:bg-slate-900">
                          <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {tr.transferDate}
                          </td>
                          <td className="px-3 py-2 font-bold text-slate-800 dark:text-slate-200">
                            {tr.fromStoreName} → {tr.toStoreName}
                          </td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                            <div>{tr.itemName}</div>
                            {tr.notes && <div className="text-[11px] text-slate-400">{tr.notes}</div>}
                          </td>
                          <td className="px-3 py-2 text-right font-black text-indigo-700 dark:text-indigo-300">
                            {tr.quantity}
                          </td>
                          <td className="px-3 py-2">{renderStatusBadge(tr.status)}</td>
                          <td className="px-3 py-2 text-[11px] text-slate-500">
                            <div>{tr.createdByName || '—'}</div>
                            {tr.confirmedByName && tr.status === 'confirmed' && (
                              <div className="text-emerald-600 dark:text-emerald-400">✓ {tr.confirmedByName}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {canDelete && (
                              <button
                                type="button"
                                disabled={actionId === tr.id}
                                onClick={() => handleDelete(tr.id)}
                                title={t('food_cost.store_transfers.delete_btn')}
                                className="p-1 rounded-md text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold cursor-pointer"
          >
            {t('food_cost.store_transfers.close_btn')}
          </button>
        </div>
      </div>
    </div>
  )
}
