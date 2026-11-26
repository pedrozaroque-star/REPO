/**
 * @module components/customer-app-v2/modals/ProductCustomizerModal
 * @description Hoja de detalle de platillo del menú vivo para Tacos Gavilan App V2:
 * muestra fotografía de alta resolución, precio vigente en sucursal, grupos de modificadores
 * (obligatorios y opcionales con costos adicionales en USD) para estimar el platillo antes de ordenar,
 * guardado opcional en favoritos y enlace directo verificado `<a target="_blank" rel="noopener noreferrer">`
 * para ordenar en la sucursal activa.
 *
 * @businessRules
 * - Cero bolsas locales sin salida: el pedido y pago se realizan directamente en el portal oficial de la sucursal.
 * - Muestra el nombre canónico de sucursal mediante `formatCustomerStoreName(currentStore, lang)`.
 * - Textos 100% bilingües vía `t('mobile_legal.*')`.
 *
 * @dataFlow
 * - Abierto cuando `ctrl.customizingItem !== null` -> permite inspeccionar modificadores y lanzar pedido directo.
 *
 * @notes
 * - 2026-11-24: Convertido de carrito local sin checkout a inspector en vivo de platillos + lanzamiento directo verificado.
 */

'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Check, ExternalLink, Heart, Minus, Plus, X } from 'lucide-react'
import { matchShowcaseDishForLiveItem } from '../data/catalog'
import type { CustomerAppV2Controller } from '../hooks/useCustomerAppV2'
import type { LiveModifierGroup, LiveModifierOption, SelectedModifierChoice } from '../types'
import { formatCustomerStoreName } from '@/lib/customer-store-names'

export function ProductCustomizerModal({ ctrl }: { ctrl: CustomerAppV2Controller }) {
  const {
    lang,
    customizingItem,
    setCustomizingItem,
    currentStore,
    fulfillmentMode,
    currentOrderOnlineUrl,
    recordOrderHandoff,
    v2AccessToken,
    isDemoPreview,
    saveLiveItemToServerFavorites,
    t,
  } = ctrl

  const [selectedByGroup, setSelectedByGroup] = useState<Record<string, SelectedModifierChoice[]>>({})
  const [quantity, setQuantity] = useState(1)

  useEffect(() => {
    setSelectedByGroup({})
    setQuantity(1)
  }, [customizingItem?.guid])

  const modifierGroups: LiveModifierGroup[] = useMemo(
    () => customizingItem?.modifierGroups || [],
    [customizingItem]
  )

  const selectedList = useMemo(
    () => Object.values(selectedByGroup).flat(),
    [selectedByGroup]
  )

  const unitWithMods = useMemo(() => {
    const base = Number(customizingItem?.price || 0)
    const mods = selectedList.reduce((sum, m) => sum + (Number(m.price) || 0), 0)
    return base + mods
  }, [customizingItem?.price, selectedList])

  if (!customizingItem) return null

  const fallbackImg =
    customizingItem.imageUrl || matchShowcaseDishForLiveItem(customizingItem.name)?.image || '/logo.png?v=75'

  const branchName = formatCustomerStoreName(currentStore, lang)

  const toggleOption = (group: LiveModifierGroup, opt: LiveModifierOption) => {
    const choice: SelectedModifierChoice = {
      optionGroupGuid: group.guid,
      guid: opt.guid,
      name: opt.name,
      price: Number(opt.price || 0),
    }

    setSelectedByGroup((prev) => {
      const current = prev[group.guid] || []
      const exists = current.some((c) => c.guid === opt.guid)

      if (group.maxSelections === 1) {
        if (exists && group.minSelections === 0) {
          return { ...prev, [group.guid]: [] }
        }
        return { ...prev, [group.guid]: [choice] }
      }

      if (exists) {
        return {
          ...prev,
          [group.guid]: current.filter((c) => c.guid !== opt.guid),
        }
      }

      const maxCap = group.maxSelections > 0 ? group.maxSelections : 99
      if (current.length >= maxCap) {
        return prev
      }
      return {
        ...prev,
        [group.guid]: [...current, choice],
      }
    })
  }

  return (
    <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col justify-end">
      <div className="bg-[#18181b] rounded-t-3xl border-t border-[#FDC82F]/45 max-h-[85%] flex flex-col overflow-hidden shadow-2xl">
        {/* Top Photo + Title */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={fallbackImg}
              alt={customizingItem.name}
              className="w-12 h-12 rounded-xl object-contain bg-black border border-white/10 shrink-0"
            />
            <div className="min-w-0">
              <h4 className="v2-outfit text-sm font-black text-white truncate">
                {customizingItem.name}
              </h4>
              <p className="text-xs font-black text-[#FFC72C]">
                ${Number(customizingItem.price || 0).toFixed(2)} USD
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {v2AccessToken && !isDemoPreview && (
              <button
                type="button"
                onClick={() => saveLiveItemToServerFavorites(customizingItem)}
                title={t('mobile_legal.v2_customizer_save_fav')}
                className="p-2 rounded-full bg-white/10 text-white hover:text-[#DA291C] hover:bg-white/20 cursor-pointer"
              >
                <Heart size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setCustomizingItem(null)}
              className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Modifiers Scroll Area */}
        <div className="p-4 overflow-y-auto no-scrollbar space-y-4">
          {customizingItem.description && (
            <p className="text-xs text-white/75 leading-relaxed">
              {customizingItem.description}
            </p>
          )}

          <div className="p-2.5 rounded-xl bg-black/45 border border-[#FFC72C]/25 text-[11px] text-white/75 leading-relaxed">
            {t('mobile_legal.v2_customizer_live_preview_note')}
          </div>

          {modifierGroups.map((group) => {
            const current = selectedByGroup[group.guid] || []
            const isReq = group.minSelections > 0
            return (
              <div key={group.guid} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-white uppercase tracking-wider">
                    {group.name}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                      isReq
                        ? 'bg-[#DA291C]/25 border border-[#DA291C]/60 text-red-200'
                        : 'bg-white/10 text-white/65'
                    }`}
                  >
                    {isReq
                      ? `${t('mobile_legal.v2_customizer_required')} (${group.minSelections})`
                      : t('mobile_legal.v2_customizer_optional')}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {group.options.map((opt) => {
                    const selected = current.some((c) => c.guid === opt.guid)
                    return (
                      <button
                        key={opt.guid}
                        type="button"
                        onClick={() => toggleOption(group, opt)}
                        className={`w-full px-3 py-2.5 rounded-xl border text-left flex items-center justify-between gap-2 cursor-pointer transition-all ${
                          selected
                            ? 'bg-[#DA291C]/20 border-[#FDC82F] text-white'
                            : 'bg-black/40 border-white/10 text-white/80 hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${
                              selected
                                ? 'bg-[#FDC82F] border-[#FDC82F] text-[#121212]'
                                : 'border-white/30'
                            }`}
                          >
                            {selected && <Check size={11} strokeWidth={3} />}
                          </span>
                          <span className="text-xs font-bold truncate">{opt.name}</span>
                        </div>
                        {opt.price > 0 && (
                          <span className="text-xs font-black text-[#FFC72C] shrink-0">
                            +${Number(opt.price).toFixed(2)}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Sticky Direct Order Footer */}
        <div className="p-4 border-t border-white/10 bg-[#141416] space-y-2.5 shrink-0">
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/70 font-bold">
              {t('mobile_legal.v2_customizer_estimated_total')}
            </span>
            <span className="text-sm font-black text-[#FFC72C]">
              ${(unitWithMods * quantity).toFixed(2)} USD
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="inline-flex items-center gap-2 px-2.5 py-2.5 rounded-xl bg-black/60 border border-white/15">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="text-white/80 hover:text-white cursor-pointer"
              >
                <Minus size={14} />
              </button>
              <span className="text-xs font-black text-white min-w-[18px] text-center">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                className="text-white/80 hover:text-white cursor-pointer"
              >
                <Plus size={14} />
              </button>
            </div>

            <a
              href={currentOrderOnlineUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                recordOrderHandoff(currentStore, fulfillmentMode)
                setCustomizingItem(null)
              }}
              className="flex-1 py-3 px-3 rounded-xl bg-gradient-to-r from-[#DA291C] to-[#b81d13] hover:from-[#e63225] hover:to-[#c92015] text-white text-xs font-black uppercase tracking-wider border border-[#FDC82F]/55 flex items-center justify-center gap-1.5 text-center"
            >
              <span className="truncate">
                {t('mobile_legal.v2_customizer_order_at_branch')} {branchName}
              </span>
              <ExternalLink size={12} className="text-[#FFC72C] shrink-0" />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
