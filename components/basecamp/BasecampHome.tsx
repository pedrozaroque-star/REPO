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
 */

'use client'

import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { useLanguage } from '@/lib/i18n'
import { useAuth } from '@/components/ProtectedRoute'
import { motion } from 'framer-motion'
import {
    Plus, Star, Paintbrush, ChevronDown, RefreshCw, Loader2,
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

// Mapa de colores pastel alineados con Basecamp usando escalas Tailwind válidas (50..950)
const COLOR_CLASSES: Record<string, { border: string; bg: string; text: string; dot: string; hover: string }> = {
    white: { border: 'border-slate-200/80 dark:border-slate-800', bg: 'bg-[#ffffff] dark:bg-slate-900', text: 'text-slate-800 dark:text-slate-200', dot: 'bg-slate-400', hover: 'hover:border-slate-300' },
    blue: { border: 'border-[#cce5ff] dark:border-blue-900/60', bg: 'bg-[#e2f0ff] dark:bg-blue-950/20', text: 'text-[#004085] dark:text-blue-200', dot: 'bg-blue-500', hover: 'hover:border-[#99cbff]' },
    pink: { border: 'border-[#ffdae0] dark:border-pink-900/60', bg: 'bg-[#ffeef2] dark:bg-pink-950/20', text: 'text-[#721c24] dark:text-pink-200', dot: 'bg-pink-500', hover: 'hover:border-[#ffb3c1]' },
    yellow: { border: 'border-[#ffeeba] dark:border-yellow-900/60', bg: 'bg-[#fffdec] dark:bg-yellow-950/20', text: 'text-[#856404] dark:text-yellow-200', dot: 'bg-yellow-500', hover: 'hover:border-[#ffd966]' },
    orange: { border: 'border-[#ffe2cf] dark:border-orange-900/60', bg: 'bg-[#fff3eb] dark:bg-orange-950/20', text: 'text-[#b25b00] dark:text-orange-200', dot: 'bg-orange-500', hover: 'hover:border-[#ffc49e]' },
    red: { border: 'border-[#f8d7da] dark:border-red-900/60', bg: 'bg-[#fdf2f2] dark:bg-red-950/20', text: 'text-[#721c24] dark:text-red-200', dot: 'bg-red-500', hover: 'hover:border-[#f5c6cb]' },
    purple: { border: 'border-[#ebdbff] dark:border-purple-900/60', bg: 'bg-[#f8f0ff] dark:bg-purple-950/20', text: 'text-[#592b9b] dark:text-purple-200', dot: 'bg-purple-500', hover: 'hover:border-[#d6b3ff]' },
    green: { border: 'border-[#c3e6cb] dark:border-green-900/60', bg: 'bg-[#ebfbf0] dark:bg-green-950/20', text: 'text-[#155724] dark:text-green-200', dot: 'bg-green-500', hover: 'hover:border-[#a1dbb2]' },
    brown: { border: 'border-[#eeddcc] dark:border-amber-900/40', bg: 'bg-[#faf6f0] dark:bg-amber-950/10', text: 'text-[#5a3825] dark:text-amber-200', dot: 'bg-[#8d5b4c]', hover: 'hover:border-[#ddbb99]' },
    gray: { border: 'border-slate-300 dark:border-slate-700', bg: 'bg-slate-50 dark:bg-slate-800/40', text: 'text-slate-800 dark:text-slate-200', dot: 'bg-gray-500', hover: 'hover:border-slate-400' },
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
                className={`relative flex flex-col justify-between p-4 sm:p-6 rounded-2xl border-2 ${colorStyles.border} ${colorStyles.bg} ${colorStyles.hover} shadow-sm hover:shadow-md cursor-pointer transition-all duration-200 min-h-[160px] group`}
            >
                <div className="flex-1">
                    <div className="flex items-start justify-between gap-3 mb-2">
                        <h3 className={`text-base font-extrabold tracking-tight ${colorStyles.text} group-hover:underline text-left`}>
                            {p.name}
                        </h3>
                        {isAdmin && (
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {/* Selector de color */}
                                <div className="relative">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            setActiveColorPickerId(activeColorPickerId === p.id ? null : p.id)
                                        }}
                                        className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-slate-500"
                                        title={t('basecamp.project_color')}
                                    >
                                        <Paintbrush size={13} />
                                    </button>
                                    {activeColorPickerId === p.id && (
                                        <div className="absolute right-0 top-6 z-30 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2 shadow-2xl flex gap-1 flex-wrap w-[150px]">
                                            {Object.keys(COLOR_CLASSES).map((cName) => (
                                                <button
                                                    key={cName}
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        changeProjectColor(p.id, cName)
                                                    }}
                                                    className="w-6 h-6 rounded-full border border-black/10"
                                                    style={{ backgroundColor: cName === 'white' ? '#ffffff' : cName === 'brown' ? '#8d5b4c' : cName }}
                                                    title={t(`basecamp.color_${cName}`)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Botón destacar */}
                                <button
                                    onClick={(e) => togglePin(p.id, e)}
                                    className={`p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 ${
                                        p.is_pinned ? 'text-amber-500' : 'text-slate-400'
                                    }`}
                                    title={p.is_pinned ? t('basecamp.unstar_project') : t('basecamp.star_project')}
                                >
                                    <Star size={13} fill={p.is_pinned ? 'currentColor' : 'none'} />
                                </button>
                            </div>
                        )}
                    </div>
                    {p.is_pinned && (
                        <div className="absolute top-6 right-6 text-amber-500 group-hover:hidden">
                            <Star size={14} fill="currentColor" />
                        </div>
                    )}
                </div>

                {/* Colaboradores / Miembros */}
                <div className="flex items-center justify-between pt-3 border-t border-black/5 dark:border-white/5">
                    <div className="flex -space-x-1.5 overflow-hidden">
                        {(p.people || []).slice(0, 5).map((person: any, idx: number) => {
                            const colors = ['#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c']
                            const pName = String(person?.name || '?').trim() || '?'
                            const charCode = pName.charCodeAt(0)
                            const avatarBg = colors[charCode % colors.length]

                            return (
                                <div
                                    key={person?.id || idx}
                                    className="w-6 h-6 rounded-full border-2 border-white dark:border-slate-900 flex items-center justify-center text-[9px] font-black text-white uppercase shadow-sm"
                                    style={{ backgroundColor: avatarBg }}
                                    title={person?.role ? `${pName} (${person.role})` : pName}
                                >
                                    {pName[0]}
                                </div>
                            )
                        })}
                        {p.people && p.people.length > 5 && (
                            <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 border-2 border-white dark:border-slate-900 flex items-center justify-center text-[8px] font-bold text-slate-500">
                                +{p.people.length - 5}
                            </div>
                        )}
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">
                        {countDisplay} {countDisplay === 1 ? t('basecamp.project_person') : t('basecamp.project_people')}
                    </span>
                </div>
            </motion.div>
        )
    }

    const hintParts = t('basecamp.search_jump_hint').split('Shift + J')

    return (
        <div className="flex-1 flex flex-col items-center w-full max-w-5xl mx-auto py-4">
            {/* Top Navigation & Live Auto-Sync / Autonomy Mode Bar */}
            <div className="w-full flex flex-wrap items-center justify-between gap-3 px-4 mb-4">
                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300 font-extrabold text-sm flex-wrap">
                    <div className="flex items-center gap-1">
                        <span className={`w-2.5 h-2.5 rounded-full inline-block mr-0.5 ${effectiveSyncing && !isStandalone ? 'bg-blue-500 animate-ping' : 'bg-emerald-500 animate-pulse'}`} />
                        <span>{t('basecamp.brand_title')}</span>
                        <ChevronDown size={14} className="mt-0.5 text-slate-400" />
                    </div>
                    {isAdmin && onOpenModeModal ? (
                        <button
                            type="button"
                            onClick={onOpenModeModal}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-extrabold transition-all shadow-sm cursor-pointer ${
                                isStandalone
                                    ? 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                                    : 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-950/60 border-blue-300 dark:border-blue-700 text-[#1D7DB5] dark:text-blue-300'
                            }`}
                            title={t('basecamp.mode_settings_title')}
                        >
                            <span>{isStandalone ? '🛡️' : '🔗'}</span>
                            <span>{isStandalone ? t('basecamp.mode_standalone_badge') : t('basecamp.mode_hybrid_badge')}</span>
                        </button>
                    ) : (
                        <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/60 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
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

                {/* Quick Access Bar: Hey!, Pings, My Stuff, Find */}
                <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                        type="button"
                        onClick={() => (onOpenHeyDrawer ? onOpenHeyDrawer() : navigateTo({ section: 'hey' }))}
                        className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-slate-600 dark:text-slate-300 bg-white/80 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all shadow-sm"
                    >
                        <Bell size={13} className="text-[#1D7DB5]" />
                        <span>{t('basecamp.hey_short')}</span>
                        {unreadHeyCount > 0 && (
                            <span className="ml-0.5 bg-red-500 text-white font-black text-[9px] min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center">
                                {unreadHeyCount}
                            </span>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={() => navigateTo({ section: 'pings' })}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-slate-600 dark:text-slate-300 bg-white/80 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all shadow-sm"
                    >
                        <MessageSquare size={13} className="text-[#1D7DB5]" />
                        <span>{t('basecamp.pings_short')}</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => navigateTo({ section: 'mystuff' })}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-slate-600 dark:text-slate-300 bg-white/80 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all shadow-sm"
                    >
                        <User size={13} className="text-[#1D7DB5]" />
                        <span>{t('basecamp.my_stuff')}</span>
                    </button>

                    {onOpenSearch && (
                        <button
                            type="button"
                            onClick={onOpenSearch}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-slate-600 dark:text-slate-300 bg-white/80 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all shadow-sm"
                        >
                            <Search size={13} className="text-[#1D7DB5]" />
                            <span>{t('basecamp.find')}</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Centered Tacos Gavilan Logo */}
            <div className="flex flex-col items-center mb-6">
                <img
                    src="/logo.png"
                    alt={t('basecamp.company_logo_alt')}
                    className="h-20 sm:h-28 object-contain mb-2"
                />
            </div>

            {/* Jump Hint */}
            <div
                onClick={onOpenSearch}
                className="border border-slate-200/60 dark:border-slate-800 bg-[#fffdf9] dark:bg-slate-900 px-4 py-1.5 rounded-lg text-xs font-semibold text-slate-500 dark:text-slate-400 mb-8 shadow-inner cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
            >
                {hintParts.length > 1 ? (
                    <span>
                        {hintParts[0]}
                        <kbd className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-[10px] mx-0.5 font-bold">Shift</kbd> + <kbd className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-[10px] mx-0.5 font-bold">J</kbd>
                        {hintParts[1]}
                    </span>
                ) : (
                    <span>{t('basecamp.search_jump_hint')}</span>
                )}
            </div>

            {/* Admin Action Buttons Row */}
            {isAdmin && (
                <div className="flex flex-wrap justify-center gap-2 mb-10 w-full max-w-2xl px-4">
                    <button
                        type="button"
                        onClick={openCreateModal}
                        className="flex items-center gap-2 px-4 py-2 bg-[#1D7DB5] hover:bg-[#155D8A] text-white rounded-xl font-extrabold text-xs shadow-sm transition-all cursor-pointer"
                    >
                        <Plus size={15} />
                        <span>{t('basecamp.new_project_btn')}</span>
                    </button>

                    {!isStandalone && (
                        <button
                            type="button"
                            onClick={handleSyncBasecamp}
                            disabled={effectiveSyncing}
                            className={`flex items-center gap-2 px-4 py-2 border rounded-xl font-bold text-xs shadow-sm transition-all ${
                                effectiveSyncing
                                    ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-800 text-blue-600 dark:text-blue-300 cursor-wait'
                                    : 'bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/20 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer'
                            }`}
                        >
                            {effectiveSyncing ? (
                                <Loader2 size={14} className="text-blue-500 animate-spin" />
                            ) : (
                                <RefreshCw size={14} className="text-blue-500" />
                            )}
                            <span>{effectiveSyncing ? t('basecamp.syncing_in_progress') : t('basecamp.sync_with_basecamp')}</span>
                        </button>
                    )}
                </div>
            )}

            {/* Sync Status Banner */}
            {syncStatus && (
                <div className={`w-full max-w-2xl mx-auto mb-6 px-4 py-3 rounded-xl text-sm font-semibold text-center transition-all animate-in fade-in slide-in-from-top-2 duration-300 ${
                    syncStatus.type === 'success'
                        ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                        : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                }`}>
                    {syncStatus.message}
                </div>
            )}

            {/* Pinned Projects Section */}
            {pinnedProjects.length > 0 && (
                <div className="w-full mb-10 px-4">
                    <h2 className="text-sm font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest text-left mb-4 flex items-center gap-1.5">
                        <Star size={14} className="text-amber-500" fill="currentColor" />
                        {t('basecamp.pinned_projects')}
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                        {pinnedProjects.map((p) => renderProjectCard(p))}
                    </div>
                </div>
            )}

            {/* All Projects Section */}
            <div className="w-full px-4 mb-12">
                <div className="flex items-center justify-between gap-3 mb-4">
                    <h2 className="text-sm font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest text-left">
                        {t('basecamp.all_projects')}
                    </h2>
                    {isAdmin && (
                        <button
                            type="button"
                            onClick={openCreateModal}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-[#1D7DB5] dark:text-blue-300 text-xs font-extrabold shadow-sm transition-all cursor-pointer"
                        >
                            <Plus size={14} />
                            <span>{t('basecamp.new_project_btn')}</span>
                        </button>
                    )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                    {otherProjects.map((p) => renderProjectCard(p))}
                </div>
            </div>

            {/* Admin Create Project Modal */}
            {isAdmin && showCreateModal && (
                <div
                    className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
                    onClick={(e) => { if (e.target === e.currentTarget) setShowCreateModal(false) }}
                >
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl animate-in zoom-in-95 duration-200 text-left">
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
