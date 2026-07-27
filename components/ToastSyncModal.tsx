/**
 * @module ToastSyncModal
 * @description Modal component for inspecting Toast promotions, manager/assistant store conflicts, and automated role deactivations.
 * @businessRules
 * - Maps Toast 'Manager' and 'Asst. Manager' jobs directly to system users.
 * - Detects existing active managers/assistants for a store and prompts to deactivate them when promoting new ones.
 * - Identifies system users whose roles have been removed in Toast for deactivation.
 * @dataFlow
 * - GET /api/admin/users/sync-toast -> Renders promotions & demotions -> POST /api/admin/users/sync-toast -> Triggers list refresh.
 */

'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, RefreshCw, Sparkles, ShieldAlert, CheckCircle2, UserPlus, UserX, AlertTriangle, ArrowRight } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

interface ToastSyncModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
}

export default function ToastSyncModal({ isOpen, onClose, onSuccess }: ToastSyncModalProps) {
    const { t } = useLanguage()
    const [mounted, setMounted] = useState(false)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    const [promotions, setPromotions] = useState<any[]>([])
    const [demotions, setDemotions] = useState<any[]>([])

    // Selection state
    const [selectedPromotions, setSelectedPromotions] = useState<Record<string, boolean>>({})
    const [deactivateConflicts, setDeactivateConflicts] = useState<Record<string, boolean>>({})
    const [selectedDemotions, setSelectedDemotions] = useState<Record<string, boolean>>({})

    useEffect(() => {
        setMounted(true)
        return () => setMounted(false)
    }, [])

    useEffect(() => {
        if (isOpen) {
            fetchSyncData()
        }
    }, [isOpen])

    const fetchSyncData = async () => {
        try {
            setLoading(true)
            const res = await fetch('/api/admin/users/sync-toast')
            const json = await res.json()

            if (json.success) {
                setPromotions(json.pendingPromotions || [])
                setDemotions(json.pendingDemotions || [])

                // Default all promotions selected
                const initPromos: Record<string, boolean> = {}
                const initConflicts: Record<string, boolean> = {}
                const pendingPromosList = json.pendingPromotions || []
                pendingPromosList.forEach((p: any) => {
                    initPromos[p.email] = true
                    if (p.conflict) {
                        initConflicts[p.email] = true
                    }
                })
                setSelectedPromotions(initPromos)
                setDeactivateConflicts(initConflicts)

                // Default all demotions selected
                const initDemos: Record<string, boolean> = {}
                const pendingDemosList = json.pendingDemotions || []
                pendingDemosList.forEach((d: any) => {
                    initDemos[d.id] = true
                })
                setSelectedDemotions(initDemos)

            } else {
                alert('Error al cargar datos de Toast: ' + json.error)
            }
        } catch (err: any) {
            console.error('Error fetching toast sync:', err)
            alert('Error de conexión al obtener datos de Toast')
        } finally {
            setLoading(false)
        }
    }

    const handleApply = async () => {
        try {
            setSaving(true)

            // Prepare promotions payload
            const promotionsToApply = promotions
                .filter(p => selectedPromotions[p.email])
                .map(p => ({
                    toast_guid: p.toast_guid,
                    email: p.email,
                    full_name: p.full_name,
                    phone: p.phone,
                    role: p.role,
                    store_id: p.store_id,
                    deactivateCurrentId: deactivateConflicts[p.email] && p.conflict ? p.conflict.id : null
                }))

            // Prepare demotions payload
            const demotionsToApply = demotions
                .filter(d => selectedDemotions[d.id])
                .map(d => ({ id: d.id }))

            const res = await fetch('/api/admin/users/sync-toast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    promotions: promotionsToApply,
                    demotions: demotionsToApply
                })
            })

            const json = await res.json()

            if (json.success) {
                alert(`✅ Sincronización Exitosa!\n- Promociones aplicadas: ${json.appliedPromotions}\n- Desactivaciones aplicadas: ${json.appliedDemotions}`)
                onSuccess()
                onClose()
            } else {
                alert('❌ Error al aplicar cambios: ' + json.error)
            }
        } catch (err: any) {
            console.error('Error applying toast sync:', err)
            alert('Error de conexión al guardar cambios.')
        } finally {
            setSaving(false)
        }
    }

    if (!isOpen || !mounted) return null

    return createPortal(
        <div className="fixed top-0 bottom-[calc(60px+env(safe-area-inset-bottom))] md:bottom-0 md:inset-0 left-0 right-0 z-50 flex items-center justify-center p-0 md:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full h-full md:h-auto md:max-h-[85vh] md:max-w-3xl rounded-none md:rounded-3xl shadow-2xl overflow-hidden flex flex-col border-none md:border md:border-gray-200 dark:md:border-slate-800">

                {/* HEADER */}
                <div className="p-5 md:p-6 bg-slate-900 text-white flex justify-between items-center shrink-0 border-b border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
                            <Sparkles size={20} />
                        </div>
                        <div>
                            <h2 className="font-black text-lg md:text-xl text-white tracking-tight flex items-center gap-2">
                                Sincronización & Promociones Toast
                            </h2>
                            <p className="text-xs text-slate-400">
                                Mapeo directo de roles Toast a Usuarios del Sistema
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* BODY CONTENT */}
                <div className="flex-1 overflow-y-auto p-5 md:p-6 space-y-6">

                    {loading ? (
                        <div className="py-16 text-center space-y-3">
                            <RefreshCw size={36} className="animate-spin text-amber-500 mx-auto" />
                            <p className="font-bold text-gray-700 dark:text-slate-300">Analizando puestos y empleados de Toast...</p>
                            <p className="text-xs text-gray-400">Buscando nuevas promociones y conflictos de sucursal</p>
                        </div>
                    ) : (
                        <>
                            {/* SECTION 1: PROMOTIONS */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="font-black text-base text-gray-900 dark:text-white flex items-center gap-2">
                                        <UserPlus size={18} className="text-emerald-500" />
                                        Promociones Detectadas en Toast ({promotions.length})
                                    </h3>
                                    <span className="text-xs text-gray-500 dark:text-slate-400 font-mono">
                                        Managers & Asistentes
                                    </span>
                                </div>

                                {promotions.length === 0 ? (
                                    <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center gap-2">
                                        <CheckCircle2 size={16} />
                                        Todos los Managers y Asistentes de Toast ya están sincronizados correctamente.
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {promotions.map((p, idx) => (
                                            <div key={idx} className="p-4 rounded-2xl bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 space-y-3">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="flex items-center gap-3">
                                                        <input
                                                            type="checkbox"
                                                            checked={!!selectedPromotions[p.email]}
                                                            onChange={(e) => setSelectedPromotions(prev => ({ ...prev, [p.email]: e.target.checked }))}
                                                            className="w-5 h-5 rounded-lg text-amber-600 focus:ring-amber-500 accent-amber-600 cursor-pointer"
                                                        />
                                                        <div>
                                                            <h4 className="font-black text-gray-900 dark:text-white text-sm">
                                                                {p.full_name}
                                                            </h4>
                                                            <p className="text-xs text-gray-500 dark:text-slate-400">
                                                                {p.email || 'Sin email registrado en Toast'}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-2">
                                                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                                                            {p.role === 'manager' ? 'Manager' : 'Asistente'}
                                                        </span>
                                                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                                            {p.store_name}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* CONFLICT WARNING */}
                                                {p.conflict && (
                                                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs space-y-2">
                                                        <div className="flex items-center gap-2 font-bold">
                                                            <AlertTriangle size={16} className="text-amber-500 shrink-0" />
                                                            <span>Conflicto Detectado: Ya existe un {p.role} activo en {p.store_name}</span>
                                                        </div>
                                                        <p className="text-[11px] text-amber-700 dark:text-amber-400 pl-6">
                                                            Usuario actual en sistema: <strong>{p.conflict.full_name}</strong> ({p.conflict.email})
                                                        </p>
                                                        <label className="flex items-center gap-2 pl-6 pt-1 text-xs font-bold text-amber-900 dark:text-amber-200 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={!!deactivateConflicts[p.email]}
                                                                onChange={(e) => setDeactivateConflicts(prev => ({ ...prev, [p.email]: e.target.checked }))}
                                                                className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 accent-amber-600"
                                                            />
                                                            Desactivar a {p.conflict.full_name} al promover al nuevo usuario
                                                        </label>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* SECTION 2: DEMOTIONS / DEACTIVATIONS */}
                            <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-slate-800">
                                <div className="flex items-center justify-between">
                                    <h3 className="font-black text-base text-gray-900 dark:text-white flex items-center gap-2">
                                        <UserX size={18} className="text-rose-500" />
                                        Degradaciones o Inactivos en Toast ({demotions.length})
                                    </h3>
                                    <span className="text-xs text-gray-500 dark:text-slate-400 font-mono">
                                        Usuarios a Desactivar
                                    </span>
                                </div>

                                {demotions.length === 0 ? (
                                    <div className="p-4 rounded-2xl bg-gray-100 dark:bg-slate-800/40 border border-gray-200 dark:border-slate-800 text-gray-600 dark:text-slate-400 text-xs font-bold flex items-center gap-2">
                                        <CheckCircle2 size={16} />
                                        No hay usuarios activos en el sistema que hayan sido degradados en Toast.
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {demotions.map((d) => (
                                            <div key={d.id} className="p-4 rounded-2xl bg-rose-500/5 border border-rose-500/20 flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-3">
                                                    <input
                                                        type="checkbox"
                                                        checked={!!selectedDemotions[d.id]}
                                                        onChange={(e) => setSelectedDemotions(prev => ({ ...prev, [d.id]: e.target.checked }))}
                                                        className="w-5 h-5 rounded-lg text-rose-600 focus:ring-rose-500 accent-rose-600 cursor-pointer"
                                                    />
                                                    <div>
                                                        <h4 className="font-black text-gray-900 dark:text-white text-sm">
                                                            {d.full_name}
                                                        </h4>
                                                        <p className="text-xs text-gray-500 dark:text-slate-400">
                                                            {d.email} • {d.store_name} ({d.role})
                                                        </p>
                                                    </div>
                                                </div>
                                                <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500/10 text-rose-600 border border-rose-500/20">
                                                    Ya no es {d.role} en Toast
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* FOOTER */}
                <div className="p-4 md:p-5 bg-gray-50 dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800 flex justify-end gap-3 shrink-0">
                    <button
                        onClick={onClose}
                        disabled={saving}
                        className="px-5 py-2.5 rounded-xl text-sm font-bold text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-800 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleApply}
                        disabled={saving || loading || (promotions.length === 0 && demotions.length === 0)}
                        className="px-6 py-2.5 rounded-xl text-sm font-black text-slate-900 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-500/20 flex items-center gap-2 transition-all"
                    >
                        {saving ? (
                            <>
                                <RefreshCw size={16} className="animate-spin" />
                                Aplicando Cambios...
                            </>
                        ) : (
                            <>
                                Aplicar Promociones & Sincronizar
                                <ArrowRight size={16} />
                            </>
                        )}
                    </button>
                </div>

            </div>
        </div>,
        document.body
    )
}
