/**
 * @module ToastSyncModal
 * @description Modal component for inspecting Toast promotions, manager/assistant store conflicts, and automated role deactivations.
 * @businessRules
 * - Maps Toast 'Manager' and 'Asst. Manager' jobs directly to system users.
 * - Detects existing active managers for a store and prompts to deactivate them when promoting new ones.
 * - Identifies system users whose roles have been removed in Toast for deactivation.
 * - Keys selection state by unique identifier (`toast_guid || existing_user.id || email`) and allows inline email entry for Toast employees missing an email.
 * @dataFlow
 * - GET /api/admin/users/sync-toast -> Renders promotions & demotions -> POST /api/admin/users/sync-toast -> Triggers list refresh.
 * @notes
 * - Uses `getValidBrowserTegToken()` for authenticated API requests and 100% bilingual `t('usuarios.toast_sync.*')` i18n keys.
 */

'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, RefreshCw, Sparkles, CheckCircle2, UserPlus, UserX, AlertTriangle, ArrowRight, Mail } from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { getValidBrowserTegToken } from '@/lib/supabase'
import { formatStoreDisplayName } from '@/lib/store-display'

interface ToastSyncModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function getPromoKey(p: any, idx = 0): string {
    return String(p?.toast_guid || p?.existing_user?.id || p?.user_id || p?.email || `promo_${idx}`)
}

function getAuthHeaders(withJson = false): Record<string, string> {
    const headers: Record<string, string> = {}
    if (withJson) {
        headers['Content-Type'] = 'application/json'
    }
    const validToken = getValidBrowserTegToken()
    const fallbackToken = typeof window !== 'undefined' ? window.localStorage.getItem('teg_token') : null
    const token = validToken || fallbackToken
    if (token) {
        headers['Authorization'] = `Bearer ${token}`
    }
    return headers
}

export default function ToastSyncModal({ isOpen, onClose, onSuccess }: ToastSyncModalProps) {
    const { t } = useLanguage()
    const [mounted, setMounted] = useState(false)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    const [promotions, setPromotions] = useState<any[]>([])
    const [demotions, setDemotions] = useState<any[]>([])

    // Selection & inline email state keyed by unique promo key
    const [selectedPromotions, setSelectedPromotions] = useState<Record<string, boolean>>({})
    const [customEmails, setCustomEmails] = useState<Record<string, string>>({})
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

    const isValidEmail = (email?: string) => {
        if (!email) return false
        return EMAIL_REGEX.test(email.trim())
    }

    const getResolvedEmail = (p: any, key: string): string => {
        const raw = p?.email && String(p.email).trim() ? String(p.email).trim() : (customEmails[key] || '').trim()
        return raw.toLowerCase()
    }

    const fetchSyncData = async () => {
        try {
            setLoading(true)
            const res = await fetch('/api/admin/users/sync-toast', {
                headers: getAuthHeaders(false)
            })
            const json = await res.json()

            if (json.success) {
                const pendingPromosList = json.pendingPromotions || []
                const pendingDemosList = json.pendingDemotions || []
                setPromotions(pendingPromosList)
                setDemotions(pendingDemosList)

                const initPromos: Record<string, boolean> = {}
                const initConflicts: Record<string, boolean> = {}
                const initEmails: Record<string, string> = {}

                pendingPromosList.forEach((p: any, idx: number) => {
                    const key = getPromoKey(p, idx)
                    const existingEmail = (p.email || p.existing_user?.email || '').trim()
                    if (existingEmail) {
                        initEmails[key] = existingEmail
                    }
                    // Only auto-select promotions that already have a valid email
                    initPromos[key] = isValidEmail(existingEmail)
                    if (p.conflict) {
                        initConflicts[key] = true
                    }
                })
                setCustomEmails(initEmails)
                setSelectedPromotions(initPromos)
                setDeactivateConflicts(initConflicts)

                // Default all demotions selected
                const initDemos: Record<string, boolean> = {}
                pendingDemosList.forEach((d: any) => {
                    initDemos[String(d.id)] = true
                })
                setSelectedDemotions(initDemos)

            } else {
                alert(`${t('usuarios.toast_sync.error_load')} ${json.error}`)
            }
        } catch (err: any) {
            console.error('Error fetching toast sync:', err)
            alert(t('usuarios.toast_sync.error_connection'))
        } finally {
            setLoading(false)
        }
    }

    const handleCustomEmailChange = (key: string, value: string) => {
        setCustomEmails(prev => ({ ...prev, [key]: value }))
        const valid = isValidEmail(value)
        setSelectedPromotions(prev => ({
            ...prev,
            [key]: valid ? true : false
        }))
    }

    const handleApply = async () => {
        try {
            setSaving(true)

            // Prepare promotions payload
            const promotionsToApply = promotions
                .map((p, idx) => {
                    const key = getPromoKey(p, idx)
                    const resolvedEmail = getResolvedEmail(p, key)
                    return { p, key, resolvedEmail }
                })
                .filter(({ key, resolvedEmail }) => selectedPromotions[key] && isValidEmail(resolvedEmail))
                .map(({ p, key, resolvedEmail }) => ({
                    toast_guid: p.toast_guid,
                    email: resolvedEmail,
                    full_name: p.full_name,
                    phone: p.phone,
                    role: p.role,
                    store_id: p.store_id,
                    deactivateCurrentId: deactivateConflicts[key] && p.conflict ? p.conflict.id : null
                }))

            // Prepare demotions payload
            const demotionsToApply = demotions
                .filter(d => selectedDemotions[String(d.id)])
                .map(d => ({ id: d.id }))

            const res = await fetch('/api/admin/users/sync-toast', {
                method: 'POST',
                headers: getAuthHeaders(true),
                body: JSON.stringify({
                    promotions: promotionsToApply,
                    demotions: demotionsToApply
                })
            })

            const json = await res.json()

            if (json.success) {
                alert(
                    `${t('usuarios.toast_sync.sync_success_title')}\n` +
                    `- ${t('usuarios.toast_sync.sync_success_promotions')} ${json.appliedPromotions}\n` +
                    `- ${t('usuarios.toast_sync.sync_success_demotions')} ${json.appliedDemotions}`
                )
                onSuccess()
                onClose()
            } else {
                alert(`❌ ${t('usuarios.toast_sync.error_apply')} ${json.error}`)
            }
        } catch (err: any) {
            console.error('Error applying toast sync:', err)
            alert(t('usuarios.toast_sync.error_save_connection'))
        } finally {
            setSaving(false)
        }
    }

    if (!isOpen || !mounted) return null

    const getRoleLabel = (role?: string) => {
        const norm = String(role || '').trim().toLowerCase()
        if (norm === 'manager') return t('usuarios.roles.manager')
        if (norm === 'asistente') return t('usuarios.roles.asistente')
        return role || ''
    }

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
                                {t('usuarios.toast_sync.title')}
                            </h2>
                            <p className="text-xs text-slate-400">
                                {t('usuarios.toast_sync.subtitle')}
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
                            <p className="font-bold text-gray-700 dark:text-slate-300">{t('usuarios.toast_sync.loading_title')}</p>
                            <p className="text-xs text-gray-400">{t('usuarios.toast_sync.loading_subtitle')}</p>
                        </div>
                    ) : (
                        <>
                            {/* SECTION 1: PROMOTIONS */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="font-black text-base text-gray-900 dark:text-white flex items-center gap-2">
                                        <UserPlus size={18} className="text-emerald-500" />
                                        {t('usuarios.toast_sync.promotions_title')} ({promotions.length})
                                    </h3>
                                    <span className="text-xs text-gray-500 dark:text-slate-400 font-mono">
                                        {t('usuarios.toast_sync.promotions_badge')}
                                    </span>
                                </div>

                                {promotions.length === 0 ? (
                                    <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center gap-2">
                                        <CheckCircle2 size={16} />
                                        {t('usuarios.toast_sync.promotions_empty')}
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {promotions.map((p, idx) => {
                                            const key = getPromoKey(p, idx)
                                            const hasToastEmail = Boolean(p.email && String(p.email).trim())
                                            const resolvedEmail = getResolvedEmail(p, key)
                                            const emailValid = isValidEmail(resolvedEmail)

                                            return (
                                                <div key={key} className="p-4 rounded-2xl bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 space-y-3">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="flex items-start gap-3 flex-1 min-w-0">
                                                            <input
                                                                type="checkbox"
                                                                disabled={!emailValid}
                                                                checked={Boolean(selectedPromotions[key] && emailValid)}
                                                                onChange={(e) => setSelectedPromotions(prev => ({ ...prev, [key]: e.target.checked }))}
                                                                className="mt-1 w-5 h-5 rounded-lg text-amber-600 focus:ring-amber-500 accent-amber-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                                            />
                                                            <div className="flex-1 min-w-0">
                                                                <h4 className="font-black text-gray-900 dark:text-white text-sm">
                                                                    {p.full_name}
                                                                </h4>
                                                                {hasToastEmail ? (
                                                                    <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
                                                                        {p.email}
                                                                    </p>
                                                                ) : (
                                                                    <div className="mt-2 space-y-1.5">
                                                                        <label className="block text-[11px] font-bold text-amber-700 dark:text-amber-400">
                                                                            {t('usuarios.toast_sync.no_email_in_toast')}
                                                                        </label>
                                                                        <div className="relative max-w-sm">
                                                                            <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                                                            <input
                                                                                type="email"
                                                                                value={customEmails[key] || ''}
                                                                                onChange={(e) => handleCustomEmailChange(key, e.target.value)}
                                                                                placeholder={t('usuarios.toast_sync.email_input_placeholder')}
                                                                                className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-400/50 dark:border-amber-500/40 text-xs font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500/30"
                                                                            />
                                                                        </div>
                                                                        {!emailValid && (
                                                                            <p className="text-[10px] font-bold text-rose-500">
                                                                                {t('usuarios.toast_sync.email_required_hint')}
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-2 shrink-0">
                                                            <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                                                                {getRoleLabel(p.role)}
                                                            </span>
                                                            <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                                                {formatStoreDisplayName(p.store_name)}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {/* CONFLICT WARNING */}
                                                    {p.conflict && (
                                                        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs space-y-2">
                                                            <div className="flex items-center gap-2 font-bold">
                                                                <AlertTriangle size={16} className="text-amber-500 shrink-0" />
                                                                <span>
                                                                    {t('usuarios.toast_sync.conflict_title')} {getRoleLabel(p.role)} {t('usuarios.toast_sync.conflict_active_in')} {formatStoreDisplayName(p.store_name)}
                                                                </span>
                                                            </div>
                                                            <p className="text-[11px] text-amber-700 dark:text-amber-400 pl-6">
                                                                {t('usuarios.toast_sync.conflict_current_user')} <strong>{p.conflict.full_name}</strong> ({p.conflict.email})
                                                            </p>
                                                            <label className="flex items-center gap-2 pl-6 pt-1 text-xs font-bold text-amber-900 dark:text-amber-200 cursor-pointer">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={!!deactivateConflicts[key]}
                                                                    onChange={(e) => setDeactivateConflicts(prev => ({ ...prev, [key]: e.target.checked }))}
                                                                    className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 accent-amber-600"
                                                                />
                                                                {t('usuarios.toast_sync.conflict_deactivate_prefix')} {p.conflict.full_name} {t('usuarios.toast_sync.conflict_deactivate_suffix')}
                                                            </label>
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* SECTION 2: DEMOTIONS / DEACTIVATIONS */}
                            <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-slate-800">
                                <div className="flex items-center justify-between">
                                    <h3 className="font-black text-base text-gray-900 dark:text-white flex items-center gap-2">
                                        <UserX size={18} className="text-rose-500" />
                                        {t('usuarios.toast_sync.demotions_title')} ({demotions.length})
                                    </h3>
                                    <span className="text-xs text-gray-500 dark:text-slate-400 font-mono">
                                        {t('usuarios.toast_sync.demotions_badge')}
                                    </span>
                                </div>

                                {demotions.length === 0 ? (
                                    <div className="p-4 rounded-2xl bg-gray-100 dark:bg-slate-800/40 border border-gray-200 dark:border-slate-800 text-gray-600 dark:text-slate-400 text-xs font-bold flex items-center gap-2">
                                        <CheckCircle2 size={16} />
                                        {t('usuarios.toast_sync.demotions_empty')}
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {demotions.map((d) => {
                                            const dKey = String(d.id)
                                            return (
                                                <div key={dKey} className="p-4 rounded-2xl bg-rose-500/5 border border-rose-500/20 flex items-center justify-between gap-3">
                                                    <div className="flex items-center gap-3">
                                                        <input
                                                            type="checkbox"
                                                            checked={!!selectedDemotions[dKey]}
                                                            onChange={(e) => setSelectedDemotions(prev => ({ ...prev, [dKey]: e.target.checked }))}
                                                            className="w-5 h-5 rounded-lg text-rose-600 focus:ring-rose-500 accent-rose-600 cursor-pointer"
                                                        />
                                                        <div>
                                                            <h4 className="font-black text-gray-900 dark:text-white text-sm">
                                                                {d.full_name}
                                                            </h4>
                                                            <p className="text-xs text-gray-500 dark:text-slate-400">
                                                                {d.email} • {formatStoreDisplayName(d.store_name)} ({getRoleLabel(d.role)})
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500/10 text-rose-600 border border-rose-500/20">
                                                        {t('usuarios.toast_sync.no_longer_role')} {getRoleLabel(d.role)} {t('usuarios.toast_sync.in_toast')}
                                                    </span>
                                                </div>
                                            )
                                        })}
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
                        {t('usuarios.toast_sync.btn_cancel')}
                    </button>
                    <button
                        onClick={handleApply}
                        disabled={saving || loading || (promotions.length === 0 && demotions.length === 0)}
                        className="px-6 py-2.5 rounded-xl text-sm font-black text-slate-900 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-500/20 flex items-center gap-2 transition-all"
                    >
                        {saving ? (
                            <>
                                <RefreshCw size={16} className="animate-spin" />
                                {t('usuarios.toast_sync.btn_applying')}
                            </>
                        ) : (
                            <>
                                {t('usuarios.toast_sync.btn_apply')}
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
