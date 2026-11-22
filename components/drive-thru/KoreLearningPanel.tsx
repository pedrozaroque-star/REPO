/**
 * @module components/drive-thru/KoreLearningPanel
 * @description Panel de Aprendizaje Continuo (Continuous Learning Panel) de "Kore Drive-Thru" con
 *   sincronización bidireccional en vivo con la Contestadora IA de Llamadas (`phone_learning_items`
 *   y `phone_knowledge_base`).
 *   Muestra métricas de latencia, reglas activas y reglas sincronizadas con Llamadas, la bandeja de
 *   "Dudas para Definir Criterio" (`needs_owner_input`), la lista de "Reglas Aprendidas Activas"
 *   (`approved` / `auto_applied`), el canal de aplicación (`both | drive_thru_only | phone_only`),
 *   el origen (`Drive-Thru | Llamada Telefónica | Manual`) y el botón "Analizar Simulaciones Ahora".
 *
 * @businessRules
 * - Solo consulta y muta cuando `storeId > 0` (tiendas con Drive-Thru autorizadas para el usuario).
 * - Los roles globales (`isGlobalScope === true`) pueden marcar una regla o criterio como global
 *   (`applyAllStores` / `storeId: null`); los gerentes de sucursal operan exclusivamente sobre su
 *   propia tienda (`storeId`) para evitar rechazos 403.
 * - Aprobar una duda exige una instrucción no vacía (`ownerInstruction` o regla propuesta).
 * - Todo el texto visible pasa por `useLanguage()` (`lib/i18n.tsx`) en español e inglés.
 *
 * @dataFlow
 * - `GET /api/drive-thru/kore/learning?storeId=X` → `{ items: KoreLearningItemDto[], stats }`.
 * - `POST /api/drive-thru/kore/learning` → `{ action: 'analyze_now', storeId }` o
 *   `{ action: 'create_rule', storeId, questionOrTrigger, ownerInstruction }`.
 * - `PATCH /api/drive-thru/kore/learning` → `{ id, status: 'approved' | 'dismissed', ownerInstruction?, applyAllStores? }`.
 *
 * @notes
 * - Protegido contra condiciones de carrera al cambiar de sucursal (`reqIdRef`) y desmontaje (`mountedRef`).
 * - Los campos de texto (`<input>`, `<textarea>`) son elementos nativos estándar para que el modo
 *   Push-to-Talk con barra espaciadora del simulador no intercepte la escritura del gerente.
 */
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
    Sparkles, HelpCircle, CheckCircle2, Trash2, Plus, RefreshCw, Loader2,
    AlertTriangle, Gauge, BookOpen, MessageSquareQuote, PhoneCall, Pencil, X
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'

export type KoreAppliesToChannels = 'both' | 'drive_thru_only' | 'phone_only'

export function normalizeKoreChannels(raw: unknown): KoreAppliesToChannels {
    if (raw === 'drive_thru_only' || raw === 'phone_only') return raw
    return 'both'
}

export interface KoreLearningItemDto {
    id: string | number
    storeId: number | null
    sourceSessionId: string | null
    sourcePhoneCallId?: string | null
    sourceType: string | null
    itemKind: 'doubt_for_owner' | 'learned_rule' | 'synonym_fix' | 'latency_insight' | string
    status: 'needs_owner_input' | 'auto_applied' | 'approved' | 'dismissed' | string
    appliesToChannels?: KoreAppliesToChannels | string | null
    syncedKbId?: string | null
    syncedPhoneItemId?: string | null
    questionOrTrigger: string
    questionOrTriggerEn?: string | null
    customerQuote: string | null
    koreQuote: string | null
    proposedRuleEs: string | null
    proposedRuleEn: string | null
    ownerInstruction: string | null
    evidenceCount: number
    avgLatencyMs: number | null
    resolvedByName: string | null
    resolvedAt: string | null
    createdAt: string | null
}

export interface KoreLearningStatsDto {
    pendingDoubts: number
    activeRules: number
    syncedToPhoneCount: number
    analyzedSessions: number
    avgLatencyMs: number | null
}

interface KoreLearningPanelProps {
    storeId: number
    isGlobalScope: boolean
    /** Se incrementa al terminar una simulación para refrescar métricas/bandejas automáticamente. */
    refreshKey?: number
}

export type LearningItem = KoreLearningItemDto

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeKoreLearningDto(raw: Record<string, unknown>): KoreLearningItemDto {
    const rawStoreId = raw.storeId !== undefined ? raw.storeId : raw.store_id
    const parsedStoreId =
        rawStoreId !== null && rawStoreId !== undefined && Number.isFinite(Number(rawStoreId))
            ? Number(rawStoreId)
            : null
    const rawLat = raw.avgLatencyMs !== undefined ? raw.avgLatencyMs : raw.avg_latency_ms
    const qEs = String(raw.questionOrTrigger ?? raw.question_or_trigger ?? '')
    const rawQEn = raw.questionOrTriggerEn ?? raw.question_or_trigger_en ?? null
    const qEn = typeof rawQEn === 'string' && rawQEn.trim() ? rawQEn.trim() : null
    return {
        id: (raw.id as string | number) ?? '',
        storeId: parsedStoreId,
        sourceSessionId: typeof (raw.sourceSessionId ?? raw.source_session_id) === 'string' ? String(raw.sourceSessionId ?? raw.source_session_id) : null,
        sourcePhoneCallId: typeof (raw.sourcePhoneCallId ?? raw.source_phone_call_id) === 'string' ? String(raw.sourcePhoneCallId ?? raw.source_phone_call_id) : null,
        sourceType: typeof (raw.sourceType ?? raw.source_type) === 'string' ? String(raw.sourceType ?? raw.source_type) : null,
        itemKind: String(raw.itemKind ?? raw.item_kind ?? 'learned_rule'),
        status: String(raw.status ?? 'needs_owner_input'),
        appliesToChannels: normalizeKoreChannels(raw.appliesToChannels ?? raw.applies_to_channels),
        syncedKbId: typeof (raw.syncedKbId ?? raw.synced_kb_id) === 'string' ? String(raw.syncedKbId ?? raw.synced_kb_id) : null,
        syncedPhoneItemId: typeof (raw.syncedPhoneItemId ?? raw.synced_phone_item_id) === 'string' ? String(raw.syncedPhoneItemId ?? raw.synced_phone_item_id) : null,
        questionOrTrigger: qEs,
        questionOrTriggerEn: qEn,
        customerQuote: typeof (raw.customerQuote ?? raw.customer_quote) === 'string' ? String(raw.customerQuote ?? raw.customer_quote) : null,
        koreQuote: typeof (raw.koreQuote ?? raw.kore_quote) === 'string' ? String(raw.koreQuote ?? raw.kore_quote) : null,
        proposedRuleEs: typeof (raw.proposedRuleEs ?? raw.proposed_rule_es) === 'string' ? String(raw.proposedRuleEs ?? raw.proposed_rule_es) : null,
        proposedRuleEn: typeof (raw.proposedRuleEn ?? raw.proposed_rule_en) === 'string' ? String(raw.proposedRuleEn ?? raw.proposed_rule_en) : null,
        ownerInstruction: typeof (raw.ownerInstruction ?? raw.owner_instruction) === 'string' ? String(raw.ownerInstruction ?? raw.owner_instruction) : null,
        evidenceCount: Math.max(1, Number(raw.evidenceCount ?? raw.evidence_count ?? 1) || 1),
        avgLatencyMs: typeof rawLat === 'number' && Number.isFinite(rawLat) ? Math.round(rawLat) : null,
        resolvedByName: typeof (raw.resolvedByName ?? raw.resolved_by_name) === 'string' ? String(raw.resolvedByName ?? raw.resolved_by_name) : null,
        resolvedAt: typeof (raw.resolvedAt ?? raw.resolved_at) === 'string' ? String(raw.resolvedAt ?? raw.resolved_at) : null,
        createdAt: typeof (raw.createdAt ?? raw.created_at) === 'string' ? String(raw.createdAt ?? raw.created_at) : null,
    }
}

export function buildOrderedBilingualLines(
    textEs: string | null | undefined,
    textEn: string | null | undefined,
    lang: 'es' | 'en',
    fallbackText?: string | null
): { flag: string; langCode: 'ES' | 'EN'; text: string }[] {
    const cleanEs = String(textEs ?? '').trim()
    const cleanEn = String(textEn ?? '').trim()
    const cleanFallback = String(fallbackText ?? '').trim()
    const esEntry = cleanEs ? { flag: '🇲🇽', langCode: 'ES' as const, text: cleanEs } : null
    const enEntry = cleanEn ? { flag: '🇺🇸', langCode: 'EN' as const, text: cleanEn } : null
    const ordered = lang === 'en' ? [enEntry, esEntry] : [esEntry, enEntry]
    const nonEmpty = ordered.filter((x): x is { flag: string; langCode: 'ES' | 'EN'; text: string } => x !== null)
    if (nonEmpty.length > 0) return nonEmpty
    if (!cleanFallback) return []
    return [
        lang === 'en'
            ? { flag: '🇺🇸', langCode: 'EN', text: cleanFallback }
            : { flag: '🇲🇽', langCode: 'ES', text: cleanFallback },
    ]
}

function getAuthHeaders(): Record<string, string> {
    const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
    return {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
}

export default function KoreLearningPanel({ storeId, isGlobalScope, refreshKey = 0 }: KoreLearningPanelProps) {
    const { t, language } = useLanguage()

    const [items, setItems] = useState<KoreLearningItemDto[]>([])
    const [stats, setStats] = useState<KoreLearningStatsDto>({
        pendingDoubts: 0,
        activeRules: 0,
        syncedToPhoneCount: 0,
        analyzedSessions: 0,
        avgLatencyMs: null,
    })
    const [loading, setLoading] = useState(false)
    const [analyzing, setAnalyzing] = useState(false)
    const [busyId, setBusyId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [banner, setBanner] = useState<string | null>(null)

    // Borradores por ítem en "Dudas para Definir Criterio"
    const [draftText, setDraftText] = useState<Record<string, string>>({})
    const [draftGlobal, setDraftGlobal] = useState<Record<string, boolean>>({})
    const [draftChannels, setDraftChannels] = useState<Record<string, KoreAppliesToChannels>>({})

    // Edición inline de reglas activas
    const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
    const [editingRuleText, setEditingRuleText] = useState('')

    // Formulario "Agregar regla manual"
    const [showCreate, setShowCreate] = useState(false)
    const [newTrigger, setNewTrigger] = useState('')
    const [newInstruction, setNewInstruction] = useState('')
    const [newApplyAll, setNewApplyAll] = useState(false)
    const [newChannels, setNewChannels] = useState<KoreAppliesToChannels>('both')
    const [creating, setCreating] = useState(false)

    const mountedRef = useRef(true)
    const reqIdRef = useRef(0)

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [])

    const loadLearning = useCallback(async (targetStoreId: number) => {
        if (!Number.isInteger(targetStoreId) || targetStoreId <= 0) return
        const reqId = ++reqIdRef.current
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(`/api/drive-thru/kore/learning?storeId=${targetStoreId}`, {
                headers: getAuthHeaders(),
            })
            const data: unknown = await res.json().catch(() => null)
            if (reqId !== reqIdRef.current || !mountedRef.current) return
            if (!res.ok) {
                const msg = isPlainObject(data) && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
                throw new Error(msg)
            }
            const rawItems = isPlainObject(data) && Array.isArray(data.items) ? data.items : []
            const parsedItems = rawItems.filter(isPlainObject).map(normalizeKoreLearningDto)
            const rawStats = isPlainObject(data) && isPlainObject(data.stats) ? data.stats : {}
            setItems(parsedItems)
            setStats({
                pendingDoubts: Number(rawStats.pendingDoubts) || 0,
                activeRules: Number(rawStats.activeRules) || 0,
                syncedToPhoneCount: Number(rawStats.syncedToPhoneCount) || 0,
                analyzedSessions: Number(rawStats.analyzedSessions) || 0,
                avgLatencyMs:
                    typeof rawStats.avgLatencyMs === 'number' && Number.isFinite(rawStats.avgLatencyMs)
                        ? Math.round(rawStats.avgLatencyMs)
                        : null,
            })
        } catch (e) {
            if (reqId !== reqIdRef.current || !mountedRef.current) return
            setError(t('drive_thru.kore_learn_error', { message: e instanceof Error ? e.message : String(e) }))
        } finally {
            if (reqId === reqIdRef.current && mountedRef.current) setLoading(false)
        }
    }, [t])

    useEffect(() => {
        if (!Number.isInteger(storeId) || storeId <= 0) {
            reqIdRef.current += 1
            setItems([])
            setError(null)
            setLoading(false)
            return
        }
        void loadLearning(storeId)
    }, [storeId, refreshKey, loadLearning])

    const handleAnalyzeNow = async () => {
        if (analyzing || storeId <= 0) return
        setAnalyzing(true)
        setError(null)
        setBanner(null)
        try {
            const res = await fetch('/api/drive-thru/kore/learning', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ action: 'analyze_now', storeId }),
            })
            const data: unknown = await res.json().catch(() => null)
            if (!mountedRef.current) return
            if (!res.ok) {
                const msg = isPlainObject(data) && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
                throw new Error(msg)
            }
            const count =
                isPlainObject(data) && isPlainObject(data.analysis) && typeof data.analysis.analyzedSessionsCount === 'number'
                    ? data.analysis.analyzedSessionsCount
                    : isPlainObject(data) && typeof data.analyzedSessions === 'number'
                        ? data.analyzedSessions
                        : isPlainObject(data) && typeof data.analyzedCount === 'number'
                            ? data.analyzedCount
                            : isPlainObject(data) && isPlainObject(data.summary) && typeof data.summary.analyzedSessions === 'number'
                                ? data.summary.analyzedSessions
                                : 0
            setBanner(t('drive_thru.kore_learn_analyze_done', { sessions: count }))
            await loadLearning(storeId)
        } catch (e) {
            if (!mountedRef.current) return
            setError(t('drive_thru.kore_learn_error', { message: e instanceof Error ? e.message : String(e) }))
        } finally {
            if (mountedRef.current) setAnalyzing(false)
        }
    }

    const getDraftInstruction = (item: KoreLearningItemDto): string => {
        const key = String(item.id)
        if (key in draftText) return draftText[key]
        const fallback =
            item.ownerInstruction ||
            (language === 'en' ? item.proposedRuleEn || item.proposedRuleEs : item.proposedRuleEs || item.proposedRuleEn) ||
            ''
        return fallback
    }

    const getDraftChannels = (item: KoreLearningItemDto): KoreAppliesToChannels => {
        const key = String(item.id)
        if (key in draftChannels) return draftChannels[key]
        return normalizeKoreChannels(item.appliesToChannels)
    }

    const handleApproveDoubt = async (item: KoreLearningItemDto) => {
        if (!isGlobalScope && item.storeId === null) return
        const key = String(item.id)
        const instruction = getDraftInstruction(item).trim()
        if (!instruction) {
            setError(t('drive_thru.kore_learn_validation_err'))
            return
        }
        setBusyId(key)
        setError(null)
        setBanner(null)
        try {
            const applyAll = isGlobalScope ? Boolean(draftGlobal[key]) : false
            const appliesToChannels = getDraftChannels(item)
            const res = await fetch('/api/drive-thru/kore/learning', {
                method: 'PATCH',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    id: item.id,
                    status: 'approved',
                    ownerInstruction: instruction,
                    applyAllStores: applyAll,
                    appliesToChannels,
                }),
            })
            const data: unknown = await res.json().catch(() => null)
            if (!mountedRef.current) return
            if (!res.ok) {
                const msg = isPlainObject(data) && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
                throw new Error(msg)
            }
            setBanner(t('drive_thru.kore_learn_rule_saved'))
            await loadLearning(storeId)
        } catch (e) {
            if (!mountedRef.current) return
            setError(t('drive_thru.kore_learn_error', { message: e instanceof Error ? e.message : String(e) }))
        } finally {
            if (mountedRef.current) setBusyId(null)
        }
    }

    const handleDismissItem = async (id: string | number, itemStoreId: number | null) => {
        if (!isGlobalScope && itemStoreId === null) return
        const key = String(id)
        setBusyId(key)
        setError(null)
        setBanner(null)
        try {
            const res = await fetch('/api/drive-thru/kore/learning', {
                method: 'PATCH',
                headers: getAuthHeaders(),
                body: JSON.stringify({ id, status: 'dismissed' }),
            })
            const data: unknown = await res.json().catch(() => null)
            if (!mountedRef.current) return
            if (!res.ok) {
                const msg = isPlainObject(data) && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
                throw new Error(msg)
            }
            await loadLearning(storeId)
        } catch (e) {
            if (!mountedRef.current) return
            setError(t('drive_thru.kore_learn_error', { message: e instanceof Error ? e.message : String(e) }))
        } finally {
            if (mountedRef.current) setBusyId(null)
        }
    }

    const beginEditRule = (rule: KoreLearningItemDto) => {
        const preload =
            language === 'en'
                ? rule.proposedRuleEn || rule.ownerInstruction || rule.proposedRuleEs || ''
                : rule.ownerInstruction || rule.proposedRuleEs || rule.proposedRuleEn || ''
        setEditingRuleId(String(rule.id))
        setEditingRuleText(preload)
    }

    const handleSaveEditedRule = async (rule: KoreLearningItemDto) => {
        if (!isGlobalScope && rule.storeId === null) return
        const trimmed = editingRuleText.trim()
        if (!trimmed) {
            setError(t('drive_thru.kore_learn_validation_err'))
            return
        }
        const key = String(rule.id)
        setBusyId(key)
        setError(null)
        setBanner(null)
        try {
            const res = await fetch('/api/drive-thru/kore/learning', {
                method: 'PATCH',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    id: rule.id,
                    status: 'approved',
                    ownerInstruction: trimmed,
                    appliesToChannels: normalizeKoreChannels(rule.appliesToChannels),
                }),
            })
            const data: unknown = await res.json().catch(() => null)
            if (!mountedRef.current) return
            if (!res.ok) {
                const msg = isPlainObject(data) && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
                throw new Error(msg)
            }
            setEditingRuleId(null)
            setEditingRuleText('')
            setBanner(t('drive_thru.kore_learn_rule_saved'))
            await loadLearning(storeId)
        } catch (e) {
            if (!mountedRef.current) return
            setError(t('drive_thru.kore_learn_error', { message: e instanceof Error ? e.message : String(e) }))
        } finally {
            if (mountedRef.current) setBusyId(null)
        }
    }

    const handleUpdateRuleChannel = async (rule: KoreLearningItemDto, nextChannel: KoreAppliesToChannels) => {
        if (!isGlobalScope && rule.storeId === null) return
        const key = String(rule.id)
        setBusyId(key)
        setError(null)
        setBanner(null)
        try {
            const fallbackInstruction =
                rule.ownerInstruction || rule.proposedRuleEs || rule.proposedRuleEn || rule.questionOrTrigger
            const res = await fetch('/api/drive-thru/kore/learning', {
                method: 'PATCH',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    id: rule.id,
                    status: 'approved',
                    ownerInstruction: fallbackInstruction,
                    proposedRuleEs: rule.proposedRuleEs,
                    proposedRuleEn: rule.proposedRuleEn,
                    appliesToChannels: nextChannel,
                }),
            })
            const data: unknown = await res.json().catch(() => null)
            if (!mountedRef.current) return
            if (!res.ok) {
                const msg = isPlainObject(data) && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
                throw new Error(msg)
            }
            await loadLearning(storeId)
        } catch (e) {
            if (!mountedRef.current) return
            setError(t('drive_thru.kore_learn_error', { message: e instanceof Error ? e.message : String(e) }))
        } finally {
            if (mountedRef.current) setBusyId(null)
        }
    }

    const handleCreateManualRule = async () => {
        const trigger = newTrigger.trim()
        const instruction = newInstruction.trim()
        if (!trigger || !instruction) {
            setError(t('drive_thru.kore_learn_validation_err'))
            return
        }
        setCreating(true)
        setError(null)
        setBanner(null)
        try {
            const targetStore = isGlobalScope && newApplyAll ? null : storeId
            const res = await fetch('/api/drive-thru/kore/learning', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    action: 'create_rule',
                    storeId: targetStore,
                    questionOrTrigger: trigger,
                    ownerInstruction: instruction,
                    appliesToChannels: newChannels,
                }),
            })
            const data: unknown = await res.json().catch(() => null)
            if (!mountedRef.current) return
            if (!res.ok) {
                const msg = isPlainObject(data) && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
                throw new Error(msg)
            }
            setNewTrigger('')
            setNewInstruction('')
            setNewChannels('both')
            setShowCreate(false)
            setBanner(t('drive_thru.kore_learn_rule_saved'))
            await loadLearning(storeId)
        } catch (e) {
            if (!mountedRef.current) return
            setError(t('drive_thru.kore_learn_error', { message: e instanceof Error ? e.message : String(e) }))
        } finally {
            if (mountedRef.current) setCreating(false)
        }
    }

    if (!Number.isInteger(storeId) || storeId <= 0) return null

    const doubts = items.filter(it => it.status === 'needs_owner_input')
    const activeRules = items.filter(
        it => (it.status === 'approved' || it.status === 'auto_applied') && it.itemKind !== 'latency_insight'
    )

    const renderKindBadge = (kind: string) => {
        const label =
            kind === 'doubt_for_owner' ? t('drive_thru.kore_learn_kind_doubt')
                : kind === 'synonym_fix' ? t('drive_thru.kore_learn_kind_synonym')
                    : kind === 'latency_insight' ? t('drive_thru.kore_learn_kind_latency')
                        : t('drive_thru.kore_learn_kind_rule')
        return (
            <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {label}
            </span>
        )
    }

    const renderScopeBadge = (itemStoreId: number | null) => (
        <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
            {itemStoreId === null
                ? t('drive_thru.kore_learn_scope_all')
                : t('drive_thru.kore_learn_scope_store', { id: itemStoreId })}
        </span>
    )

    const renderOriginBadge = (item: KoreLearningItemDto) => {
        const isPhone =
            item.sourceType === 'phone_call' ||
            item.sourceType === 'phone_learning' ||
            Boolean(item.sourcePhoneCallId)
        const isManual = item.sourceType === 'manual_owner' || item.sourceType === 'manual'
        if (isPhone) {
            return (
                <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-cyan-50 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300">
                    {t('drive_thru.kore_learn_src_phone')}
                </span>
            )
        }
        if (isManual) {
            return (
                <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                    {t('drive_thru.kore_learn_src_manual')}
                </span>
            )
        }
        return (
            <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-orange-50 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300">
                {t('drive_thru.kore_learn_src_dt')}
            </span>
        )
    }

    const renderChannelBadge = (rawChannel: unknown) => {
        const ch = normalizeKoreChannels(rawChannel)
        const label =
            ch === 'drive_thru_only'
                ? t('drive_thru.kore_learn_channel_dt')
                : ch === 'phone_only'
                    ? t('drive_thru.kore_learn_channel_phone')
                    : t('drive_thru.kore_learn_channel_both')
        return (
            <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {label}
            </span>
        )
    }

    const renderSyncedPhoneBadge = (item: KoreLearningItemDto) => {
        const ch = normalizeKoreChannels(item.appliesToChannels)
        if (ch === 'drive_thru_only' || item.status === 'needs_owner_input') return null
        const rawRec = item as unknown as Record<string, unknown>
        const hasPhoneSync = Boolean(
            item.syncedKbId ||
                item.syncedPhoneItemId ||
                rawRec.synced_phone_item_id ||
                rawRec.synced_kb_id
        )
        if (!hasPhoneSync) return null
        return (
            <span className="px-2 py-0.5 rounded-md text-[11px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                {t('drive_thru.kore_learn_synced_badge')}
            </span>
        )
    }

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-4">
            {/* Encabezado */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-start gap-3">
                    <div className="p-2.5 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl shadow-md shadow-orange-500/20 shrink-0">
                        <Sparkles className="text-white" size={20} />
                    </div>
                    <div>
                        <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">{t('drive_thru.kore_learn_title')}</h3>
                        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-2xl">{t('drive_thru.kore_learn_subtitle')}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        type="button"
                        onClick={() => void handleAnalyzeNow()}
                        disabled={analyzing}
                        className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white text-xs sm:text-sm font-black shadow-sm transition-all active:scale-95 disabled:opacity-60 cursor-pointer"
                    >
                        {analyzing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                        <span>{analyzing ? t('drive_thru.kore_learn_analyzing') : t('drive_thru.kore_learn_analyze_btn')}</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => void loadLearning(storeId)}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        <span>{t('drive_thru.kore_refresh')}</span>
                    </button>
                </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <div className={`rounded-xl border p-3 ${
                    stats.pendingDoubts > 0
                        ? 'border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50'
                }`}>
                    <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <HelpCircle size={12} /> <span>{t('drive_thru.kore_learn_kpi_doubts')}</span>
                    </p>
                    <p className="text-2xl font-black tabular-nums text-slate-900 dark:text-white mt-0.5">{stats.pendingDoubts}</p>
                </div>
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/25 p-3">
                    <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                        <BookOpen size={12} /> <span>{t('drive_thru.kore_learn_kpi_rules')}</span>
                    </p>
                    <p className="text-2xl font-black tabular-nums text-emerald-700 dark:text-emerald-300 mt-0.5">{stats.activeRules}</p>
                </div>
                <div className="rounded-xl border border-cyan-200 dark:border-cyan-900/60 bg-cyan-50/60 dark:bg-cyan-950/25 p-3">
                    <p className="text-[11px] font-semibold text-cyan-800 dark:text-cyan-300 flex items-center gap-1">
                        <PhoneCall size={12} /> <span>{t('drive_thru.kore_learn_kpi_synced_phone')}</span>
                    </p>
                    <p className="text-2xl font-black tabular-nums text-cyan-800 dark:text-cyan-300 mt-0.5">{stats.syncedToPhoneCount}</p>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3">
                    <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{t('drive_thru.kore_learn_kpi_sessions')}</p>
                    <p className="text-2xl font-black tabular-nums text-slate-900 dark:text-white mt-0.5">{stats.analyzedSessions}</p>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3">
                    <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <Gauge size={12} /> <span>{t('drive_thru.kore_learn_kpi_latency')}</span>
                    </p>
                    <p className="text-2xl font-black tabular-nums text-slate-900 dark:text-white mt-0.5">
                        {stats.avgLatencyMs !== null ? t('drive_thru.kore_latency_unit_ms', { ms: stats.avgLatencyMs }) : '—'}
                    </p>
                </div>
            </div>

            {error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <span className="flex-1 break-words">{error}</span>
                    <button type="button" onClick={() => setError(null)} aria-label={t('drive_thru.kore_dismiss')} className="shrink-0 hover:opacity-70 cursor-pointer">
                        <X size={16} />
                    </button>
                </div>
            )}
            {banner && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                    <span>{banner}</span>
                    <button type="button" onClick={() => setBanner(null)} aria-label={t('drive_thru.kore_dismiss')} className="shrink-0 hover:opacity-70 cursor-pointer">
                        <X size={16} />
                    </button>
                </div>
            )}

            {loading && items.length === 0 ? (
                <p className="text-sm text-slate-400 py-4">{t('drive_thru.kore_learn_loading')}</p>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Bandeja 1: Dudas para Definir Criterio */}
                    <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/30 dark:bg-amber-950/15 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                            <h4 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                                <HelpCircle size={16} className="text-amber-500" />
                                <span>{t('drive_thru.kore_learn_doubts_title')}</span>
                            </h4>
                            <span className="px-2 py-0.5 rounded-full text-xs font-black bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 tabular-nums">
                                {doubts.length}
                            </span>
                        </div>

                        {doubts.length === 0 ? (
                            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 py-4">{t('drive_thru.kore_learn_doubts_empty')}</p>
                        ) : (
                            <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                                {doubts.map(item => {
                                    const key = String(item.id)
                                    const isRowBusy = busyId === key
                                    const canMutateItem = isGlobalScope || item.storeId !== null
                                    const activeUiLang: 'es' | 'en' = language === 'en' ? 'en' : 'es'
                                    const primaryTitle =
                                        activeUiLang === 'en'
                                            ? item.questionOrTriggerEn || item.questionOrTrigger
                                            : item.questionOrTrigger
                                    const proposedLines = buildOrderedBilingualLines(
                                        item.proposedRuleEs,
                                        item.proposedRuleEn,
                                        activeUiLang,
                                        item.ownerInstruction
                                    )
                                    return (
                                        <div key={key} className="rounded-xl border border-amber-200 dark:border-amber-800/70 bg-white dark:bg-slate-900 p-3.5 space-y-2.5 shadow-sm">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                {renderOriginBadge(item)}
                                                {renderKindBadge(item.itemKind)}
                                                {renderScopeBadge(item.storeId)}
                                                {renderChannelBadge(canMutateItem ? getDraftChannels(item) : item.appliesToChannels)}
                                                {renderSyncedPhoneBadge(item)}
                                                {item.evidenceCount > 1 && (
                                                    <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                                                        {t('drive_thru.kore_learn_evidence', { count: item.evidenceCount })}
                                                    </span>
                                                )}
                                            </div>

                                            <p className="text-sm font-bold text-slate-900 dark:text-white break-words">{primaryTitle}</p>

                                            {(item.customerQuote || item.koreQuote) && (
                                                <div className="rounded-lg bg-slate-50 dark:bg-slate-800/70 p-2.5 space-y-1 text-xs">
                                                    {item.customerQuote && (
                                                        <p className="text-slate-700 dark:text-slate-200 break-words">
                                                            <MessageSquareQuote size={12} className="inline mr-1 text-orange-500" />
                                                            <strong>{t('drive_thru.kore_learn_customer_said')}</strong> {item.customerQuote}
                                                        </p>
                                                    )}
                                                    {item.koreQuote && (
                                                        <p className="text-slate-600 dark:text-slate-300 break-words">
                                                            <strong>{t('drive_thru.kore_learn_kore_said')}</strong> {item.koreQuote}
                                                        </p>
                                                    )}
                                                </div>
                                            )}

                                            {proposedLines.length > 0 && (
                                                <div className="rounded-lg bg-slate-50/80 dark:bg-slate-800/50 px-2.5 py-2 space-y-1">
                                                    <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                                                        {t('drive_thru.kore_learn_proposed_rule')}
                                                    </p>
                                                    {proposedLines.map((line, idx) => (
                                                        <p
                                                            key={line.langCode}
                                                            className={idx === 0 ? 'text-xs text-slate-800 dark:text-slate-200 leading-relaxed break-words' : 'text-xs text-slate-500 dark:text-slate-400 leading-relaxed break-words'}
                                                        >
                                                            {line.flag} {line.text}
                                                        </p>
                                                    ))}
                                                </div>
                                            )}

                                            {canMutateItem && (
                                                <>
                                                    <div>
                                                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                                                            {t('drive_thru.kore_learn_instruction_label')}
                                                        </label>
                                                        <textarea
                                                            rows={2}
                                                            value={getDraftInstruction(item)}
                                                            disabled={isRowBusy}
                                                            onChange={e => setDraftText(prev => ({ ...prev, [key]: e.target.value }))}
                                                            placeholder={t('drive_thru.kore_learn_instruction_placeholder')}
                                                            className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"
                                                        />
                                                    </div>

                                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                                        <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                                            {t('drive_thru.kore_learn_channel_label')}
                                                        </label>
                                                        <select
                                                            value={getDraftChannels(item)}
                                                            disabled={isRowBusy}
                                                            onChange={e =>
                                                                setDraftChannels(prev => ({
                                                                    ...prev,
                                                                    [key]: normalizeKoreChannels(e.target.value),
                                                                }))
                                                            }
                                                            className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-orange-500 outline-none"
                                                        >
                                                            <option value="both">{t('drive_thru.kore_learn_channel_both')}</option>
                                                            <option value="drive_thru_only">{t('drive_thru.kore_learn_channel_dt')}</option>
                                                            <option value="phone_only">{t('drive_thru.kore_learn_channel_phone')}</option>
                                                        </select>
                                                    </div>

                                                    {isGlobalScope && (
                                                        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={Boolean(draftGlobal[key])}
                                                                disabled={isRowBusy}
                                                                onChange={e => setDraftGlobal(prev => ({ ...prev, [key]: e.target.checked }))}
                                                                className="rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                                                            />
                                                            <span>{t('drive_thru.kore_learn_apply_all')}</span>
                                                        </label>
                                                    )}

                                                    <div className="flex items-center gap-2 pt-1">
                                                        <button
                                                            type="button"
                                                            disabled={isRowBusy}
                                                            onClick={() => void handleApproveDoubt(item)}
                                                            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition-colors disabled:opacity-50 cursor-pointer"
                                                        >
                                                            {isRowBusy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                                                            <span>{isRowBusy ? t('drive_thru.kore_learn_saving') : t('drive_thru.kore_learn_approve_btn')}</span>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={isRowBusy}
                                                            onClick={() => void handleDismissItem(item.id, item.storeId)}
                                                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-300 disabled:opacity-50 cursor-pointer"
                                                        >
                                                            <Trash2 size={13} />
                                                            <span>{t('drive_thru.kore_learn_dismiss_btn')}</span>
                                                        </button>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {/* Bandeja 2: Reglas Aprendidas Activas */}
                    <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/25 dark:bg-emerald-950/15 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <h4 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                                <CheckCircle2 size={16} className="text-emerald-500" />
                                <span>{t('drive_thru.kore_learn_rules_title')}</span>
                            </h4>
                            <button
                                type="button"
                                onClick={() => setShowCreate(v => !v)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer"
                            >
                                <Plus size={13} />
                                <span>{showCreate ? t('drive_thru.kore_learn_cancel_btn') : t('drive_thru.kore_learn_add_rule_btn')}</span>
                            </button>
                        </div>

                        {showCreate && (
                            <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 p-3.5 space-y-2.5 shadow-sm">
                                <div>
                                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                                        {t('drive_thru.kore_learn_trigger_label')}
                                    </label>
                                    <input
                                        type="text"
                                        value={newTrigger}
                                        disabled={creating}
                                        onChange={e => setNewTrigger(e.target.value)}
                                        placeholder={t('drive_thru.kore_learn_trigger_placeholder')}
                                        className="w-full px-3 py-1.5 text-xs sm:text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                                        {t('drive_thru.kore_learn_instruction_label')}
                                    </label>
                                    <textarea
                                        rows={2}
                                        value={newInstruction}
                                        disabled={creating}
                                        onChange={e => setNewInstruction(e.target.value)}
                                        placeholder={t('drive_thru.kore_learn_instruction_placeholder')}
                                        className="w-full px-3 py-1.5 text-xs sm:text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                                    />
                                </div>
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                        {t('drive_thru.kore_learn_channel_label')}
                                    </label>
                                    <select
                                        value={newChannels}
                                        disabled={creating}
                                        onChange={e => setNewChannels(normalizeKoreChannels(e.target.value))}
                                        className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                                    >
                                        <option value="both">{t('drive_thru.kore_learn_channel_both')}</option>
                                        <option value="drive_thru_only">{t('drive_thru.kore_learn_channel_dt')}</option>
                                        <option value="phone_only">{t('drive_thru.kore_learn_channel_phone')}</option>
                                    </select>
                                </div>
                                {isGlobalScope && (
                                    <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={newApplyAll}
                                            disabled={creating}
                                            onChange={e => setNewApplyAll(e.target.checked)}
                                            className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                        />
                                        <span>{t('drive_thru.kore_learn_apply_all')}</span>
                                    </label>
                                )}
                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        disabled={creating}
                                        onClick={() => void handleCreateManualRule()}
                                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition-colors disabled:opacity-50 cursor-pointer"
                                    >
                                        {creating ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                                        <span>{creating ? t('drive_thru.kore_learn_saving') : t('drive_thru.kore_learn_save_rule')}</span>
                                    </button>
                                </div>
                            </div>
                        )}

                        {activeRules.length === 0 ? (
                            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 py-4">{t('drive_thru.kore_learn_rules_empty')}</p>
                        ) : (
                            <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
                                {activeRules.map(rule => {
                                    const key = String(rule.id)
                                    const isRowBusy = busyId === key
                                    const isEditing = editingRuleId === key
                                    const canMutateRule = isGlobalScope || rule.storeId !== null
                                    const currentChannel = normalizeKoreChannels(rule.appliesToChannels)
                                    const activeUiLang: 'es' | 'en' = language === 'en' ? 'en' : 'es'
                                    const primaryRuleTitle =
                                        activeUiLang === 'en'
                                            ? rule.questionOrTriggerEn || rule.questionOrTrigger
                                            : rule.questionOrTrigger
                                    const ruleLines = buildOrderedBilingualLines(
                                        rule.proposedRuleEs,
                                        rule.proposedRuleEn,
                                        activeUiLang,
                                        rule.ownerInstruction
                                    )
                                    return (
                                        <div key={key} className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-white dark:bg-slate-900 p-3 space-y-1.5 shadow-sm">
                                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                                                        rule.status === 'auto_applied'
                                                            ? 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                                                            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                                    }`}>
                                                        {rule.status === 'auto_applied'
                                                            ? t('drive_thru.kore_learn_status_auto')
                                                            : t('drive_thru.kore_learn_status_approved')}
                                                    </span>
                                                    {renderOriginBadge(rule)}
                                                    {renderKindBadge(rule.itemKind)}
                                                    {renderScopeBadge(rule.storeId)}
                                                    {renderSyncedPhoneBadge(rule)}
                                                    {canMutateRule ? (
                                                        <select
                                                            aria-label={t('drive_thru.kore_learn_channel_label')}
                                                            value={currentChannel}
                                                            disabled={isRowBusy}
                                                            onChange={e => void handleUpdateRuleChannel(rule, normalizeKoreChannels(e.target.value))}
                                                            className="px-2 py-0.5 text-[11px] font-semibold rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 outline-none cursor-pointer"
                                                        >
                                                            <option value="both">{t('drive_thru.kore_learn_channel_both')}</option>
                                                            <option value="drive_thru_only">{t('drive_thru.kore_learn_channel_dt')}</option>
                                                            <option value="phone_only">{t('drive_thru.kore_learn_channel_phone')}</option>
                                                        </select>
                                                    ) : (
                                                        renderChannelBadge(currentChannel)
                                                    )}
                                                </div>
                                                {canMutateRule && (
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            disabled={isRowBusy}
                                                            onClick={() => isEditing ? setEditingRuleId(null) : beginEditRule(rule)}
                                                            className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-50 cursor-pointer"
                                                        >
                                                            <Pencil size={12} />
                                                            <span>{isEditing ? t('drive_thru.kore_learn_cancel_btn') : t('drive_thru.kore_learn_edit_btn')}</span>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={isRowBusy}
                                                            onClick={() => void handleDismissItem(rule.id, rule.storeId)}
                                                            className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-50 cursor-pointer"
                                                        >
                                                            {isRowBusy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                                            <span>{t('drive_thru.kore_learn_dismiss_btn')}</span>
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <p className="text-xs font-bold text-slate-900 dark:text-white break-words">{primaryRuleTitle}</p>
                                            {isEditing ? (
                                                <div className="space-y-2 pt-1">
                                                    <textarea
                                                        rows={2}
                                                        value={editingRuleText}
                                                        disabled={isRowBusy}
                                                        onChange={e => setEditingRuleText(e.target.value)}
                                                        className="w-full px-3 py-1.5 text-xs sm:text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                                                    />
                                                    <div className="flex justify-end gap-2">
                                                        <button
                                                            type="button"
                                                            disabled={isRowBusy}
                                                            onClick={() => setEditingRuleId(null)}
                                                            className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer"
                                                        >
                                                            {t('drive_thru.kore_learn_cancel_btn')}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={isRowBusy}
                                                            onClick={() => void handleSaveEditedRule(rule)}
                                                            className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black disabled:opacity-50 cursor-pointer"
                                                        >
                                                            {isRowBusy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                                            <span>{isRowBusy ? t('drive_thru.kore_learn_saving') : t('drive_thru.kore_learn_save_changes_btn')}</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                ruleLines.length > 0 && (
                                                    <div className="space-y-1">
                                                        {ruleLines.map((line, idx) => (
                                                            <p
                                                                key={line.langCode}
                                                                className={idx === 0 ? 'text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed break-words' : 'text-xs text-slate-500 dark:text-slate-400 leading-relaxed break-words'}
                                                            >
                                                                {line.flag} {line.text}
                                                            </p>
                                                        ))}
                                                    </div>
                                                )
                                            )}
                                            {rule.resolvedByName && (
                                                <p className="text-[11px] text-slate-400">
                                                    {t('drive_thru.kore_learn_resolved_by', { name: rule.resolvedByName })}
                                                </p>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
