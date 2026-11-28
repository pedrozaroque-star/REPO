/**
 * @module BasecampHome
 * @description Panel de inicio principal del módulo Basecamp.
 *              Replica el aspecto limpio de Basecamp moderno, centrado en el logo de Tacos Gavilan,
 *              con accesos rápidos a Hey!, Pings y Mi Espacio, botones de acción y cuadrícula de proyectos.
 * @businessRules
 *   - Mostrar los proyectos activos en una cuadrícula con estrellas para destacar y selector de color.
 *   - Utilizar el logo de Tacos Gavilan (/logo.png) centrado en el inicio.
 *   - Permitir la creación de nuevos proyectos en `bc_projects` registrando la membresía del creador en `bc_memberships`.
 * @dataFlow
 *   - Proyectos y callbacks vienen vía Props (`projects`, `saveProjects`, `navigateTo`, `onSync`, `onOpenHeyDrawer`).
 * @notes
 *   - Corrige inserción en `bc_projects` (`is_archived: false, member_count: 1` sin columna inexistente `status`).
 *   - Valida el resultado booleano de `onSync()` antes de mostrar banner de éxito y usa clases Tailwind estándar.
 *   - Autonomía Standalone (2026-11-21): píldora de modo para Admin (`🛡️ 100% Nativo TEG` / `🔗 Puente Basecamp Activo`), oculta sincronización externa en modo Standalone / no-admin, y modal nativo Admin `+ Nuevo proyecto` (`z-[120]`) con herramientas y selector de accesos (`list_manageable_people` + `create_project`).
 *   - Rediseño Ejecutivo Web + Móvil (2026-11-28): cabecera centrada con buscador tipo Spotlight de 1 toque, dock limpio `grid-cols-3` en móvil / `inline-flex` en desktop, y tarjetas ejecutivas de proyectos con acento superior de color, descripción `line-clamp-2` y avatares superpuestos.
 */

'use client'

import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { useLanguage } from '@/lib/i18n'
import { useAuth } from '@/components/ProtectedRoute'
import { motion } from 'framer-motion'
import {
    Plus, Star, Paintbrush, RefreshCw, Loader2,
    Bell, MessageSquare, User, Search, Users, Check, X
} from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import {
    canonicalizeBasecampEmail,
    isMaskedOrEmptyEmail,
    normalizePersonName,
} from '@/lib/basecamp-person-resolver'
import {
    ALL_CANONICAL_DOCK_TOOLS,
    CanonicalBasecampDockTool,
    isManagerOrSupervisorBcPerson,
    buildBasecampJsonHeaders,
} from '@/lib/basecamp-html'

// Mapa de colores ejecutivos alineados con Basecamp 4 / Linear (superficie limpia + acento superior de color)
const COLOR_CLASSES: Record<string, { border: string; bg: string; text: string; dot: string; accent: string; hover: string }> = {
    white: { border: 'border-slate-200/90 dark:border-slate-800', bg: 'bg-white dark:bg-slate-900', text: 'text-slate-900 dark:text-slate-100', dot: 'bg-[#1D7DB5]', accent: 'bg-gradient-to-r from-[#1D7DB5] to-sky-400', hover: 'hover:border-slate-300 dark:hover:border-slate-700' },
    blue: { border: 'border-blue-200/90 dark:border-blue-900/60', bg: 'bg-white dark:bg-slate-900', text: 'text-slate-900 dark:text-slate-100', dot: 'bg-blue-500', accent: 'bg-blue-500', hover: 'hover:border-blue-300 dark:hover:border-blue-700' },
    pink: { border: 'border-pink-200/90 dark:border-pink-900/60', bg: 'bg-white dark:bg-slate-900', text: 'text-slate-900 dark:text-slate-100', dot: 'bg-pink-500', accent: 'bg-pink-500', hover: 'hover:border-pink-300 dark:hover:border-pink-700' },
    yellow: { border: 'border-amber-200/90 dark:border-amber-900/60', bg: 'bg-white dark:bg-slate-900', text: 'text-slate-900 dark:text-slate-100', dot: 'bg-amber-400', accent: 'bg-amber-400', hover: 'hover:border-amber-300 dark:hover:border-amber-700' },
    orange: { border: 'border-orange-200/90 dark:border-orange-900/60', bg: 'bg-white dark:bg-slate-900', text: 'text-slate-900 dark:text-slate-100', dot: 'bg-orange-500', accent: 'bg-orange-500', hover: 'hover:border-orange-300 dark:hover:border-orange-700' },
    red: { border: 'border-red-200/90 dark:border-red-900/60', bg: 'bg-white dark:bg-slate-900', text: 'text-slate-900 dark:text-slate-100', dot: 'bg-red-500', accent: 'bg-red-500', hover: 'hover:border-red-300 dark:hover:border-red-700' },
    purple: { border: 'border-purple-200/90 dark:border-purple-900/60', bg: 'bg-white dark:bg-slate-900', text: 'text-slate-900 dark:text-slate-100', dot: 'bg-purple-500', accent: 'bg-purple-500', hover: 'hover:border-purple-300 dark:hover:border-purple-700' },
    green: { border: 'border-emerald-200/90 dark:border-emerald-900/60', bg: 'bg-white dark:bg-slate-900', text: 'text-slate-900 dark:text-slate-100', dot: 'bg-emerald-500', accent: 'bg-emerald-500', hover: 'hover:border-emerald-300 dark:hover:border-emerald-700' },
    brown: { border: 'border-amber-300/70 dark:border-amber-900/50', bg: 'bg-white dark:bg-slate-900', text: 'text-slate-900 dark:text-slate-100', dot: 'bg-[#8d5b4c]', accent: 'bg-[#8d5b4c]', hover: 'hover:border-amber-400 dark:hover:border-amber-700' },
    gray: { border: 'border-slate-200/90 dark:border-slate-800', bg: 'bg-white dark:bg-slate-900', text: 'text-slate-900 dark:text-slate-100', dot: 'bg-slate-500', accent: 'bg-slate-500', hover: 'hover:border-slate-300 dark:hover:border-slate-700' },
}

interface BasecampHomeProps {
    projects: any[]
    saveProjects: (projects: any[]) => void
    navigateTo: (params: { project?: string; tool?: string; section?: string; ping?: string }) => void
    userName: string
    onOpenSearch?: () => void
    onOpenHeyDrawer?: () => void
    unreadHeyCount?: number
    onSync?: () => Promise<boolean>
    isBackgroundSyncing?: boolean
    lastSyncedAt?: string | null
    isAdmin?: boolean
    isStandalone?: boolean
    onOpenModeModal?: () => void
    onRefreshProjects?: () => Promise<void> | void
}

const AVATAR_COLORS = ['#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#0D9488', '#DB2777', '#0284C7']
const getAvatarColor = (name: string): string => {
    const clean = (name || '?').trim() || '?'
    let hash = 0
    for (let i = 0; i < clean.length; i++) hash = clean.charCodeAt(i) + ((hash << 5) - hash)
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
const getInitials = (name: string): string => {
    const clean = (name || '').trim()
    if (!clean) return '?'
    const parts = clean.split(/\s+/).filter(Boolean)
    return parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : clean.slice(0, 2).toUpperCase()
}

const stripAccentsLower = (s?: string | null): string =>
    s ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() : ''

export default function BasecampHome({
    projects,
    saveProjects,
    navigateTo,
    userName,
    onOpenSearch,
    onOpenHeyDrawer,
    unreadHeyCount = 0,
    onSync,
    isBackgroundSyncing = false,
    lastSyncedAt = null,
    isAdmin = false,
    isStandalone = false,
    onOpenModeModal,
    onRefreshProjects,
}: BasecampHomeProps) {
    const supabase = useMemo(() => getSupabaseWithAuth(), [])
    const { t } = useLanguage()
    const { user: authUser } = useAuth()

    // Estado del modal Admin de crear proyecto
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [creatingProject, setCreatingProject] = useState(false)
    const [newProjectName, setNewProjectName] = useState('')
    const [newProjectDesc, setNewProjectDesc] = useState('')
    const [newProjectColor, setNewProjectColor] = useState('white')
    const [selectedTools, setSelectedTools] = useState<CanonicalBasecampDockTool[]>(() => [...ALL_CANONICAL_DOCK_TOOLS])
    const [manageablePeople, setManageablePeople] = useState<any[]>([])
    const [loadingPeople, setLoadingPeople] = useState(false)
    const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(() => new Set())
    const [memberSearch, setMemberSearch] = useState('')
    const [createError, setCreateError] = useState<string | null>(null)

    // Estado del popover de color activo por proyecto
    const [activeColorPickerId, setActiveColorPickerId] = useState<string | null>(null)

    // Estado de sincronización con Basecamp
    const [isSyncing, setIsSyncing] = useState(false)
    const [syncStatus, setSyncStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    const effectiveSyncing = isSyncing || isBackgroundSyncing

    useEffect(() => {
        if (!showCreateModal && !activeColorPickerId) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setShowCreateModal(false)
                setActiveColorPickerId(null)
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [showCreateModal, activeColorPickerId])

    const getSyncRelativeLabel = () => {
        if (!lastSyncedAt) return t('basecamp.auto_sync_live')
        const diffMins = Math.max(0, Math.floor((Date.now() - new Date(lastSyncedAt).getTime()) / 60000))
        if (diffMins < 1) return t('basecamp.synced_just_now')
        return `${t('basecamp.synced_mins_ago')} ${diffMins} ${t('basecamp.mins_ago_suffix')}`
    }

    const loadManageablePeople = useCallback(async () => {
        setLoadingPeople(true)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: buildBasecampJsonHeaders(),
                body: JSON.stringify({ action: 'list_manageable_people' }),
            })
            const data = await res.json().catch(() => ({}))
            let list: any[] = Array.isArray(data?.people) ? data.people : []
            if (list.length === 0) {
                const { data: fallbackPeople } = await supabase
                    .from('bc_people')
                    .select('id, bc_id, name, email, role, avatar_url, title')
                    .eq('is_active', true)
                    .order('name', { ascending: true })
                list = fallbackPeople || []
            }
            setManageablePeople(list)
            const selfEmail = canonicalizeBasecampEmail(authUser?.email)
            const selfMatch = list.find(
                (p) => selfEmail && !isMaskedOrEmptyEmail(p?.email) && canonicalizeBasecampEmail(p.email) === selfEmail
            )
            if (selfMatch?.id) {
                setSelectedMemberIds(new Set([selfMatch.id]))
            }
        } catch (err) {
            console.error('Error loading manageable people:', err)
        } finally {
            setLoadingPeople(false)
        }
    }, [authUser?.email, supabase])

    const openCreateModal = () => {
        setCreateError(null)
        setNewProjectName('')
        setNewProjectDesc('')
        setNewProjectColor('white')
        setSelectedTools([...ALL_CANONICAL_DOCK_TOOLS])
        setMemberSearch('')
        setShowCreateModal(true)
        void loadManageablePeople()
    }

    const toggleCreateTool = (toolKey: CanonicalBasecampDockTool) => {
        setSelectedTools((prev) => {
            if (prev.includes(toolKey)) {
                return prev.length > 1 ? prev.filter((k) => k !== toolKey) : prev
            }
            return [...prev, toolKey]
        })
    }

    const toggleMemberSelection = (personId: string) => {
        setSelectedMemberIds((prev) => {
            const next = new Set(prev)
            if (next.has(personId)) next.delete(personId)
            else next.add(personId)
            return next
        })
    }

    const handleSelectAllMembers = () => {
        setSelectedMemberIds(new Set(manageablePeople.map((p) => p.id).filter(Boolean)))
    }

    const handleSelectManagersOnly = () => {
        const selfEmail = canonicalizeBasecampEmail(authUser?.email)
        const ids = manageablePeople
            .filter(
                (p) =>
                    isManagerOrSupervisorBcPerson(p) ||
                    (selfEmail && !isMaskedOrEmptyEmail(p?.email) && canonicalizeBasecampEmail(p.email) === selfEmail)
            )
            .map((p) => p.id)
            .filter(Boolean)
        setSelectedMemberIds(new Set(ids))
    }

    const filteredManageablePeople = useMemo(() => {
        if (!memberSearch.trim()) return manageablePeople
        const q = stripAccentsLower(memberSearch.trim())
        const qNorm = normalizePersonName(memberSearch)
        return manageablePeople.filter((p) => {
            const cleanMail = isMaskedOrEmptyEmail(p?.email) ? '' : canonicalizeBasecampEmail(p?.email)
            return (
                stripAccentsLower(p?.name).includes(q) ||
                stripAccentsLower(cleanMail).includes(q) ||
                stripAccentsLower(`${p?.role || ''} ${p?.title || ''}`).includes(q) ||
                (qNorm.length > 0 && normalizePersonName(p?.name).includes(qNorm))
            )
        })
    }, [manageablePeople, memberSearch])

    const handleCreateProject = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newProjectName.trim() || creatingProject) return

        setCreatingProject(true)
        setCreateError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: buildBasecampJsonHeaders(),
                body: JSON.stringify({
                    action: 'create_project',
                    name: newProjectName.trim(),
                    description: newProjectDesc.trim(),
                    color: newProjectColor,
                    isPinned: false,
                    enabledTools: selectedTools,
                    memberPersonIds: Array.from(selectedMemberIds),
                }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || data?.error) {
                setCreateError(data?.error || t('basecamp.project_create_error'))
                return
            }
            await onRefreshProjects?.()
            setShowCreateModal(false)
            if (data?.project?.bc_id) {
                navigateTo({ project: String(data.project.bc_id) })
            }
        } catch (err: any) {
            setCreateError(err?.message || t('basecamp.project_create_error'))
        } finally {
            setCreatingProject(false)
        }
    }

    // Sincronizar desde Basecamp original → Supabase sin recargar la página completa
    const handleSyncBasecamp = async () => {
        if (effectiveSyncing) return
        setIsSyncing(true)
        setSyncStatus(null)
        try {
            if (onSync) {
                const ok = await onSync()
                if (ok) {
                    setSyncStatus({
                        type: 'success',
                        message: t('basecamp.synced_just_now'),
                    })
                    setTimeout(() => setSyncStatus(null), 4000)
                } else {
                    setSyncStatus({
                        type: 'error',
                        message: `${t('basecamp.sync_error_prefix')}${t('basecamp.sync_error_fallback')}`,
                    })
                }
                return
            }
            const res = await fetch('/api/basecamp/sync', { method: 'POST' })
            const data = await res.json().catch(() => ({}))
            if (res.ok && data.status !== 'failed') {
                const count = data.records_synced || 0
                setSyncStatus({
                    type: 'success',
                    message: `${t('basecamp.sync_complete_prefix')}${count}${t('basecamp.sync_records_updated')}`,
                })
                setTimeout(() => setSyncStatus(null), 4000)
            } else {
                setSyncStatus({
                    type: 'error',
                    message: `${t('basecamp.sync_error_prefix')}${data.error || t('basecamp.sync_error_fallback')}`,
                })
            }
        } catch (err: any) {
            setSyncStatus({
                type: 'error',
                message: `${t('basecamp.sync_conn_error_prefix')}${err.message}`,
            })
        } finally {
            setIsSyncing(false)
        }
    }

    const togglePin = (id: string, e: React.MouseEvent) => {
        e.stopPropagation()
        const updated = projects.map((p) => (p.id === id ? { ...p, is_pinned: !p.is_pinned } : p))
        saveProjects(updated)
    }

    const changeProjectColor = (id: string, color: string) => {
        const updated = projects.map((p) => (p.id === id ? { ...p, color } : p))
        saveProjects(updated)
        setActiveColorPickerId(null)
    }

    const pinnedProjects = projects.filter((p) => p.is_pinned)
    const otherProjects = projects.filter((p) => !p.is_pinned)

    const renderProjectCard = (p: any) => {
        const colorStyles = COLOR_CLASSES[p.color] || COLOR_CLASSES.white
        const countDisplay = p.peopleCount ?? (p.people?.length || 0)

        return (
            <motion.div
                layoutId={`project-${p.id}`}
                key={p.id}
                onClick={() => navigateTo({ project: p.id })}
                className={`relative flex flex-col justify-between p-4 sm:p-5 rounded-2xl border ${colorStyles.border} ${colorStyles.bg} ${colorStyles.hover} shadow-xs hover:shadow-md hover:-translate-y-0.5 cursor-pointer transition-all duration-200 min-h-[124px] sm:min-h-[138px] group min-w-0 text-left`}
            >
                {/* Top Executive Accent Bar */}
                <div className={`h-1 -mx-4 sm:-mx-5 -mt-4 sm:-mt-5 mb-3.5 rounded-t-2xl ${colorStyles.accent}`} />

                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2.5">
                        <h3 className={`text-[16px] sm:text-[17px] font-extrabold tracking-tight leading-snug line-clamp-2 break-words ${colorStyles.text} group-hover:text-[#1D7DB5] dark:group-hover:text-sky-400 transition-colors min-w-0 flex-1`}>
                            {p.name}
                        </h3>
                        <div className="flex items-center gap-0.5 shrink-0">
                            {isAdmin ? (
                                <div className="flex items-center gap-0.5 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                    <div className="relative">
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                setActiveColorPickerId(activeColorPickerId === p.id ? null : p.id)
                                            }}
                                            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                                            title={t('basecamp.project_color')}
                                        >
                                            <Paintbrush size={13} />
                                        </button>
                                        {activeColorPickerId === p.id && (
                                            <div className="absolute right-0 top-8 z-30 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2 shadow-2xl flex gap-1.5 flex-wrap w-[156px]">
                                                {Object.keys(COLOR_CLASSES).map((cName) => (
                                                    <button
                                                        key={cName}
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            changeProjectColor(p.id, cName)
                                                        }}
                                                        className="w-6 h-6 rounded-full border border-black/10 cursor-pointer"
                                                        style={{ backgroundColor: cName === 'white' ? '#ffffff' : cName === 'brown' ? '#8d5b4c' : cName }}
                                                        title={t(`basecamp.color_${cName}`)}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <button
                                        type="button"
                                        onClick={(e) => togglePin(p.id, e)}
                                        className={`p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer ${
                                            p.is_pinned ? 'text-amber-500' : 'text-slate-400 hover:text-amber-500'
                                        }`}
                                        title={p.is_pinned ? t('basecamp.unstar_project') : t('basecamp.star_project')}
                                    >
                                        <Star size={14} fill={p.is_pinned ? 'currentColor' : 'none'} />
                                    </button>
                                </div>
                            ) : p.is_pinned ? (
                                <span className="text-amber-500 p-1">
                                    <Star size={14} fill="currentColor" />
                                </span>
                            ) : null}

                            {isAdmin && p.is_pinned && (
                                <span className="hidden sm:inline-flex group-hover:hidden text-amber-500 p-1">
                                    <Star size={14} fill="currentColor" />
                                </span>
                            )}
                        </div>
                    </div>

                    {p.description && String(p.description).trim() && (
                        <p className="text-xs sm:text-[13px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed mt-1.5">
                            {p.description}
                        </p>
                    )}
                </div>

                {/* Colaboradores / Miembros */}
                <div className="flex items-center justify-between gap-2 pt-3 mt-3.5 border-t border-slate-100 dark:border-slate-800/80">
                    <div className="flex -space-x-2 overflow-hidden">
                        {(p.people || []).slice(0, 5).map((person: any, idx: number) => {
                            const pName = String(person?.name || '?').trim() || '?'
                            const avatarBg = getAvatarColor(pName)

                            return (
                                <div
                                    key={person?.id || idx}
                                    className="w-7 h-7 rounded-full ring-2 ring-white dark:ring-slate-900 flex items-center justify-center text-[10px] font-bold text-white uppercase shadow-2xs"
                                    style={{ backgroundColor: avatarBg }}
                                    title={person?.role ? `${pName} (${person.role})` : pName}
                                >
                                    {getInitials(pName)}
                                </div>
                            )
                        })}
                        {p.people && p.people.length > 5 && (
                            <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 ring-2 ring-white dark:ring-slate-900 flex items-center justify-center text-[9px] font-extrabold text-slate-600 dark:text-slate-300">
                                +{p.people.length - 5}
                            </div>
                        )}
                    </div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 shrink-0">
                        <Users size={12} className="text-slate-400" />
                        <span>{countDisplay} {countDisplay === 1 ? t('basecamp.project_person') : t('basecamp.project_people')}</span>
                    </span>
                </div>
            </motion.div>
        )
    }

    return (
        <div className="flex-1 flex flex-col items-center w-full max-w-5xl mx-auto py-1 sm:py-3 min-w-0">
            {/* Compact Executive Header + Spotlight Search + Quick Access Dock */}
            <div className="w-full flex flex-col items-center mb-6 sm:mb-8">
                {/* Brand Logo + Title + Autonomy Pill */}
                <div className="flex flex-col items-center text-center mb-3.5">
                    <img
                        src="/logo.png"
                        alt={t('basecamp.company_logo_alt')}
                        className="w-12 h-12 sm:w-14 sm:h-14 object-contain mb-2 drop-shadow-2xs"
                    />
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                        <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50 flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${effectiveSyncing && !isStandalone ? 'bg-blue-500 animate-ping' : 'bg-emerald-500'}`} />
                            <span>{t('basecamp.brand_title')}</span>
                        </h1>

                        {isAdmin && onOpenModeModal ? (
                            <button
                                type="button"
                                onClick={onOpenModeModal}
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[11px] font-bold transition-all cursor-pointer ${
                                    isStandalone
                                        ? 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                                        : 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-950/60 border-blue-200 dark:border-blue-800 text-[#1D7DB5] dark:text-sky-300'
                                }`}
                                title={t('basecamp.mode_settings_title')}
                            >
                                <span>{isStandalone ? '🛡️' : '🔗'}</span>
                                <span>{isStandalone ? t('basecamp.mode_standalone_badge') : t('basecamp.mode_hybrid_badge')}</span>
                            </button>
                        ) : (
                            <span
                                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/60 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
                                title={isStandalone ? t('basecamp.mode_standalone_badge') : t('basecamp.auto_sync_tooltip')}
                            >
                                <span>
                                    {isStandalone
                                        ? `🛡️ ${t('basecamp.mode_standalone_badge')}`
                                        : effectiveSyncing
                                            ? t('basecamp.syncing_in_progress')
                                            : getSyncRelativeLabel()}
                                </span>
                            </span>
                        )}
                    </div>
                </div>

                {/* Interactive Spotlight Search Bar (1-tap on mobile & web) */}
                {onOpenSearch && (
                    <button
                        type="button"
                        onClick={onOpenSearch}
                        className="w-full max-w-xl flex items-center justify-between gap-2.5 px-3.5 sm:px-4 h-10 sm:h-11 rounded-xl bg-slate-50 hover:bg-white dark:bg-slate-800/80 dark:hover:bg-slate-800 border border-slate-200/90 dark:border-slate-700/80 shadow-2xs hover:shadow-sm hover:border-[#1D7DB5]/50 transition-all text-left group cursor-pointer mb-3"
                    >
                        <span className="flex items-center gap-2.5 min-w-0 flex-1">
                            <Search size={16} className="text-[#1D7DB5] dark:text-sky-400 shrink-0 group-hover:scale-105 transition-transform" />
                            <span className="text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400 truncate">
                                {t('basecamp.search_placeholder')}
                            </span>
                        </span>
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-400 shrink-0">
                            Shift + J
                        </kbd>
                    </button>
                )}

                {/* Quick Access Row: grid-cols-3 on Mobile, inline-flex on Desktop */}
                <div className="w-full max-w-2xl flex flex-col sm:flex-row items-center justify-center gap-2">
                    <div className="w-full sm:w-auto grid grid-cols-3 sm:inline-flex items-center gap-1.5 sm:gap-2">
                        <button
                            type="button"
                            onClick={() => (onOpenHeyDrawer ? onOpenHeyDrawer() : navigateTo({ section: 'hey' }))}
                            className="relative flex items-center justify-center gap-1 sm:gap-1.5 h-9 px-2 sm:px-3.5 rounded-xl text-[11.5px] sm:text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all shadow-2xs cursor-pointer min-w-0"
                        >
                            <Bell size={14} className="text-amber-500 shrink-0" />
                            <span className="truncate">{t('basecamp.hey_short')}</span>
                            {unreadHeyCount > 0 && (
                                <span className="bg-red-500 text-white font-black text-[9px] min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center shrink-0">
                                    {unreadHeyCount}
                                </span>
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={() => navigateTo({ section: 'pings' })}
                            className="flex items-center justify-center gap-1 sm:gap-1.5 h-9 px-2 sm:px-3.5 rounded-xl text-[11.5px] sm:text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all shadow-2xs cursor-pointer min-w-0"
                        >
                            <MessageSquare size={14} className="text-[#1D7DB5] dark:text-sky-400 shrink-0" />
                            <span className="truncate">{t('basecamp.pings_short')}</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => navigateTo({ section: 'mystuff' })}
                            className="flex items-center justify-center gap-1 sm:gap-1.5 h-9 px-2 sm:px-3.5 rounded-xl text-[11.5px] sm:text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all shadow-2xs cursor-pointer min-w-0"
                        >
                            <User size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                            <span className="truncate">{t('basecamp.my_stuff')}</span>
                        </button>
                    </div>

                    {isAdmin && (
                        <div className="w-full sm:w-auto flex items-center justify-center gap-1.5 sm:gap-2">
                            <button
                                type="button"
                                onClick={openCreateModal}
                                className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 h-9 px-3.5 bg-[#1D7DB5] hover:bg-[#155D8A] text-white rounded-xl font-extrabold text-xs shadow-2xs transition-all cursor-pointer"
                            >
                                <Plus size={14} className="shrink-0" />
                                <span className="truncate">{t('basecamp.new_project_btn')}</span>
                            </button>

                            {!isStandalone && (
                                <button
                                    type="button"
                                    onClick={handleSyncBasecamp}
                                    disabled={effectiveSyncing}
                                    title={effectiveSyncing ? t('basecamp.syncing_in_progress') : t('basecamp.sync_with_basecamp')}
                                    className={`inline-flex items-center justify-center gap-1.5 h-9 px-3 border rounded-xl font-bold text-xs shadow-2xs transition-all shrink-0 ${
                                        effectiveSyncing
                                            ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-800 text-blue-600 dark:text-blue-300 cursor-wait'
                                            : 'bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/20 border-slate-200/90 dark:border-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer'
                                    }`}
                                >
                                    {effectiveSyncing ? (
                                        <Loader2 size={14} className="text-blue-500 animate-spin shrink-0" />
                                    ) : (
                                        <RefreshCw size={14} className="text-[#1D7DB5] shrink-0" />
                                    )}
                                    <span className="hidden md:inline">
                                        {effectiveSyncing ? t('basecamp.syncing_in_progress') : t('basecamp.sync_with_basecamp')}
                                    </span>
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Sync Status Banner */}
            {syncStatus && (
                <div className={`w-full max-w-2xl mx-auto mb-5 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-center transition-all animate-in fade-in slide-in-from-top-2 duration-300 ${
                    syncStatus.type === 'success'
                        ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                        : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                }`}>
                    {syncStatus.message}
                </div>
            )}

            {/* Pinned Projects Section */}
            {pinnedProjects.length > 0 && (
                <div className="w-full mb-8">
                    <h2 className="text-xs font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-widest text-left mb-3 flex items-center gap-1.5">
                        <Star size={13} className="text-amber-500" fill="currentColor" />
                        <span>{t('basecamp.pinned_projects')}</span>
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-5">
                        {pinnedProjects.map((p) => renderProjectCard(p))}
                    </div>
                </div>
            )}

            {/* All Projects Section */}
            <div className="w-full mb-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                    <h2 className="text-xs font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-widest text-left">
                        {t('basecamp.all_projects')}
                    </h2>
                    <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                        {otherProjects.length}
                    </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-5">
                    {otherProjects.map((p) => renderProjectCard(p))}
                </div>
            </div>

            {/* Admin Create Project Modal */}
            {isAdmin && showCreateModal && (
                <div
                    className="fixed inset-0 z-[120] flex items-center justify-center p-2.5 sm:p-4 bg-black/50 backdrop-blur-sm"
                    onClick={(e) => { if (e.target === e.currentTarget) setShowCreateModal(false) }}
                >
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full max-h-[90dvh] overflow-y-auto p-4 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-200 text-left">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
                            <h3 className="text-lg font-extrabold text-slate-800 dark:text-slate-100">
                                {t('basecamp.new_project_btn')}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setShowCreateModal(false)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                                title={t('basecamp.close_esc')}
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {createError && (
                            <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs font-bold text-red-700 dark:text-red-300">
                                {createError}
                            </div>
                        )}

                        <form onSubmit={handleCreateProject} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                                    {t('basecamp.project_name_label')}
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={newProjectName}
                                    onChange={(e) => setNewProjectName(e.target.value)}
                                    placeholder={t('basecamp.project_name_placeholder')}
                                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                                    {t('basecamp.project_desc_label')}
                                </label>
                                <textarea
                                    value={newProjectDesc}
                                    onChange={(e) => setNewProjectDesc(e.target.value)}
                                    placeholder={t('basecamp.project_description_placeholder')}
                                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] text-sm h-16"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                                    {t('basecamp.project_color_label')}
                                </label>
                                <div className="flex gap-1.5 flex-wrap">
                                    {Object.keys(COLOR_CLASSES).map((cName) => (
                                        <button
                                            key={cName}
                                            type="button"
                                            onClick={() => setNewProjectColor(cName)}
                                            className={`w-7 h-7 rounded-full border-2 ${
                                                newProjectColor === cName ? 'border-[#1D7DB5] scale-110' : 'border-slate-200 dark:border-slate-700'
                                            }`}
                                            style={{ backgroundColor: cName === 'white' ? '#ffffff' : cName === 'brown' ? '#8d5b4c' : cName }}
                                            title={t(`basecamp.color_${cName}`)}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Enabled Tools */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                                    {t('basecamp.project_tools_label')}
                                </label>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {(
                                        [
                                            { key: 'todoset', label: t('basecamp.todos') },
                                            { key: 'message_board', label: t('basecamp.message_board') },
                                            { key: 'chat', label: t('basecamp.campfire') },
                                            { key: 'vault', label: t('basecamp.docs_files') },
                                            { key: 'schedule', label: t('basecamp.schedule') },
                                            { key: 'questionnaire', label: t('basecamp.checkins') },
                                        ] as Array<{ key: CanonicalBasecampDockTool; label: string }>
                                    ).map((toolItem) => {
                                        const active = selectedTools.includes(toolItem.key)
                                        return (
                                            <button
                                                key={toolItem.key}
                                                type="button"
                                                onClick={() => toggleCreateTool(toolItem.key)}
                                                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                                                    active
                                                        ? 'bg-blue-50 dark:bg-blue-950/40 border-[#1D7DB5] text-[#1D7DB5] dark:text-blue-300'
                                                        : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-500'
                                                }`}
                                            >
                                                <span className={`w-4 h-4 rounded flex items-center justify-center border ${active ? 'bg-[#1D7DB5] border-[#1D7DB5] text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                                                    {active && <Check size={11} />}
                                                </span>
                                                <span className="truncate">{toolItem.label}</span>
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* People & Access Selector */}
                            <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                    <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                                        <Users size={13} className="text-[#1D7DB5]" />
                                        <span>{t('basecamp.members_modal_title')}</span>
                                    </label>
                                    <span className="text-[11px] font-extrabold text-[#1D7DB5] dark:text-blue-300">
                                        {selectedMemberIds.size} / {manageablePeople.length}
                                    </span>
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                                    {t('basecamp.members_modal_desc')}
                                </p>

                                <div className="flex flex-wrap gap-1.5 mb-2">
                                    <button
                                        type="button"
                                        onClick={handleSelectAllMembers}
                                        className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                                    >
                                        {t('basecamp.members_select_all')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSelectManagersOnly}
                                        className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-950/60 text-[11px] font-bold text-[#1D7DB5] dark:text-blue-300 cursor-pointer"
                                    >
                                        {t('basecamp.members_select_managers')}
                                    </button>
                                </div>

                                <div className="relative mb-2">
                                    <Search size={13} className="absolute left-3 top-2.5 text-slate-400" />
                                    <input
                                        type="text"
                                        value={memberSearch}
                                        onChange={(e) => setMemberSearch(e.target.value)}
                                        placeholder={t('basecamp.members_search_placeholder')}
                                        className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#1D7DB5]"
                                    />
                                </div>

                                <div className="max-h-44 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
                                    {loadingPeople ? (
                                        <div className="flex items-center justify-center py-6">
                                            <Loader2 size={18} className="animate-spin text-[#1D7DB5]" />
                                        </div>
                                    ) : filteredManageablePeople.length === 0 ? (
                                        <p className="text-xs text-slate-400 text-center py-4 italic">
                                            {t('basecamp.no_people_found')}
                                        </p>
                                    ) : (
                                        filteredManageablePeople.map((person) => {
                                            const checked = selectedMemberIds.has(person.id)
                                            const cleanEmail = isMaskedOrEmptyEmail(person.email)
                                                ? ''
                                                : canonicalizeBasecampEmail(person.email)
                                            const roleBadge = (person.title || person.role || '').trim()
                                            return (
                                                <label
                                                    key={person.id}
                                                    onClick={() => toggleMemberSelection(person.id)}
                                                    className={`flex items-center justify-between gap-2 px-3 py-2 cursor-pointer transition-colors ${
                                                        checked ? 'bg-blue-50/60 dark:bg-blue-950/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2.5 min-w-0">
                                                        <span className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${checked ? 'bg-[#1D7DB5] border-[#1D7DB5] text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                                                            {checked && <Check size={11} />}
                                                        </span>
                                                        <div className="min-w-0">
                                                            <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                                                                {person.name}
                                                            </p>
                                                            {cleanEmail && (
                                                                <p className="text-[10px] text-slate-400 truncate">{cleanEmail}</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {roleBadge && (
                                                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 shrink-0">
                                                            {roleBadge}
                                                        </span>
                                                    )}
                                                </label>
                                            )
                                        })
                                    )}
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                    {t('basecamp.cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={creatingProject || !newProjectName.trim()}
                                    className="px-4 py-2 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] disabled:opacity-50 text-white font-extrabold text-xs shadow flex items-center gap-1.5 cursor-pointer"
                                >
                                    {creatingProject && <Loader2 size={12} className="animate-spin" />}
                                    <span>{t('basecamp.project_create_submit')}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
