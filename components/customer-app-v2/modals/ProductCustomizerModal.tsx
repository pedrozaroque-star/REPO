/**
 * @module components/customer-app-v2/modals/ProductCustomizerModal
 * @description Modal de personalización de platillos del menú vivo Toast POS para Tacos Gavilan App V2:
 * soporta grupos de modificadores obligatorios u opcionales (selección única radio o múltiple checkbox),
 * nota de cocina, selector de cantidad y cálculo en tiempo real del precio unitario más modificadores.
 *
 * @businessRules
 * - Impide agregar a la bolsa mientras falte algún grupo obligatorio (`minSelections > 0`).
 * - Respeta `maxSelections` al alternar múltiples modificadores.
 * - Textos 100% bilingües vía `t('mobile_legal.*')`.
 *
 * @dataFlow
 * - Abierto cuando `ctrl.customizingItem !== null` -> al confirmar invoca `ctrl.addLineToBag`.
 *
 * @notes
 * - Empareja foto oficial de showcase cuando Toast no proporciona `imageUrl`.
 */

'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Check, Minus, Plus, X } from 'lucide-react'
import { matchShowcaseDishForLiveItem } from '../data/catalog'
import type { CustomerAppV2Controller } from '../hooks/useCustomerAppV2'
import type { LiveModifierGroup, LiveModifierOption, SelectedModifierChoice } from '../types'

export function ProductCustomizerModal({ ctrl }: { ctrl: CustomerAppV2Controller }) {
  const { customizingItem, setCustomizingItem, addLineToBag, t } = ctrl

  const [selectedByGroup, setSelectedByGroup] = useState<Record<string, SelectedModifierChoice[]>>({})
  const [notes, setNotes] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    setSelectedByGroup({})
    setNotes('')
    setQuantity(1)
    setValidationError(null)
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

  const toggleOption = (group: LiveModifierGroup, opt: LiveModifierOption) => {
    setValidationError(null)
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

  const handleConfirmAdd = () => {
    for (const grp of modifierGroups) {
      const count = (selectedByGroup[grp.guid] || []).length
      if (count < grp.minSelections) {
        setValidationError(`${t('mobile_legal.v2_customizer_must_select')} (${grp.name})`)
        return
      }
    }

    addLineToBag({
      itemGuid: customizingItem.guid,
      name: customizingItem.name,
      unitPrice: Number(customizingItem.price || 0),
      quantity,
      modifiers: selectedList,
      specialInstructions: notes.trim() || undefined,
      imageUrl: fallbackImg,
    })
    setCustomizingItem(null)
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
                ${Number(customizingItem.price || 0).toFixed(2)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCustomizingItem(null)}
            className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 cursor-pointer shrink-0"
          >
            <X size={15} />
          </button>
        </div>

        {/* Modifiers Scroll Area */}
        <div className="p-4 overflow-y-auto no-scrollbar space-y-4">
          {customizingItem.description && (
            <p className="text-xs text-white/70 leading-relaxed">
              {customizingItem.description}
            </p>
          )}

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

          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-white/65 mb-1">
              {t('mobile_legal.v2_customizer_notes_label')}
            </label>
            <input
              type="text"
              maxLength={140}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('mobile_legal.v2_customizer_notes_placeholder')}
              className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white placeholder-white/40 focus:outline-none focus:border-[#FFC72C]"
            />
          </div>

          {validationError && (
            <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 text-xs font-bold">
              {validationError}
            </div>
          )}
        </div>

        {/* Sticky Add Footer */}
        <div className="p-4 border-t border-white/10 bg-[#141416] flex items-center gap-3 shrink-0">
          <div className="inline-flex items-center gap-2 px-2.5 py-2 rounded-xl bg-black/60 border border-white/15">
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

          <button
            type="button"
            onClick={handleConfirmAdd}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#DA291C] to-[#b81d13] text-white text-xs font-black uppercase tracking-wider border border-[#FDC82F]/55 cursor-pointer"
          >
            {t('mobile_legal.v2_customizer_add_to_bag')} · ${(unitWithMods * quantity).toFixed(2)}
          </button>
        </div>
      </div>
    </div>
  )
}
