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
 */

'use client'

import React, { useState, useMemo, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n'
import { useAuth } from '@/components/ProtectedRoute'
import { motion } from 'framer-motion'
import {
    Plus, Star, Paintbrush, ChevronDown, RefreshCw, Loader2,
    Bell, MessageSquare, User, Search
} from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { resolveOrCreateTegPerson } from '@/lib/basecamp-person-resolver'

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
}

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
}: BasecampHomeProps) {
    const supabase = useMemo(() => getSupabaseWithAuth(), [])
    const { t } = useLanguage()
    const { user: authUser } = useAuth()

    // Estado del modal de crear proyecto
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [creatingProject, setCreatingProject] = useState(false)
    const [newProjectName, setNewProjectName] = useState('')
    const [newProjectDesc, setNewProjectDesc] = useState('')
    const [newProjectColor, setNewProjectColor] = useState('white')

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

    const handleCreateProject = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newProjectName.trim() || creatingProject) return

        setCreatingProject(true)
        try {
            const syntheticBcId = Date.now() * 1000 + Math.floor(Math.random() * 1000)
            const { data: inserted, error } = await supabase
                .from('bc_projects')
                .insert({
                    name: newProjectName.trim(),
                    description: newProjectDesc.trim() || '',
                    bc_id: syntheticBcId,
                    color: newProjectColor,
                    is_pinned: false,
                    is_archived: false,
                    member_count: 1,
                })
                .select('id, bc_id')
                .single()

            if (error || !inserted) {
                console.error('Failed to create project:', error)
                setSyncStatus({
                    type: 'error',
                    message: t('basecamp.project_create_error'),
                })
                return
            }

            // Register creator membership in bc_memberships
            const creatorPerson = await resolveOrCreateTegPerson(supabase, {
                email: authUser?.email,
                name: authUser?.name || userName,
                role: (authUser as any)?.role,
            })

            if (creatorPerson?.id) {
                await supabase.from('bc_memberships').upsert(
                    {
                        project_id: inserted.id,
                        person_id: creatorPerson.id,
                        role: 'creator',
                    },
                    { onConflict: 'project_id,person_id' }
                )
            }

            const creatorDisplay = creatorPerson?.name || userName
            const newProj = {
                id: String(inserted.bc_id),
                db_id: inserted.id,
                name: newProjectName.trim(),
                description: newProjectDesc.trim(),
                color: newProjectColor,
                is_pinned: false,
                peopleCount: 1,
                people: [{ id: creatorPerson?.id, name: creatorDisplay, role: 'creator' }],
            }

            saveProjects([...projects, newProj])
            setNewProjectName('')
            setNewProjectDesc('')
            setNewProjectColor('white')
            setShowCreateModal(false)
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
            {/* Top Navigation & Live Auto-Sync Bar */}
            <div className="w-full flex flex-wrap items-center justify-between gap-3 px-4 mb-4">
                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300 font-extrabold text-sm">
                    <div className="flex items-center gap-1">
                        <span className={`w-2.5 h-2.5 rounded-full inline-block mr-0.5 ${effectiveSyncing ? 'bg-blue-500 animate-ping' : 'bg-green-500 animate-pulse'}`} />
                        <span>{t('basecamp.brand_title')}</span>
                        <ChevronDown size={14} className="mt-0.5 text-slate-400" />
                    </div>
                    <span
                        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/60 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
                        title={t('basecamp.auto_sync_tooltip')}
                    >
                        <span>{effectiveSyncing ? t('basecamp.syncing_in_progress') : getSyncRelativeLabel()}</span>
                    </span>
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

            {/* Action Buttons Row */}
            <div className="flex flex-wrap justify-center gap-2 mb-10 w-full max-w-2xl px-4">
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold text-xs shadow-sm transition-all animate-in fade-in slide-in-from-bottom-2 duration-200"
                >
                    <Plus size={15} className="text-blue-500" />
                    <span>{t('basecamp.make_new_project')}</span>
                </button>

                <button
                    onClick={handleSyncBasecamp}
                    disabled={effectiveSyncing}
                    className={`flex items-center gap-2 px-4 py-2 border rounded-xl font-bold text-xs shadow-sm transition-all animate-in fade-in slide-in-from-bottom-2 duration-300 ${
                        effectiveSyncing
                            ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-800 text-blue-600 dark:text-blue-300 cursor-wait'
                            : 'bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/20 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                    }`}
                >
                    {effectiveSyncing ? (
                        <Loader2 size={14} className="text-blue-500 animate-spin" />
                    ) : (
                        <RefreshCw size={14} className="text-blue-500" />
                    )}
                    <span>{effectiveSyncing ? t('basecamp.syncing_in_progress') : t('basecamp.sync_with_basecamp')}</span>
                </button>
            </div>

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
                <h2 className="text-sm font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest text-left mb-4">
                    {t('basecamp.all_projects')}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                    {otherProjects.map((p) => renderProjectCard(p))}
                </div>
            </div>

            {/* Create Project Modal */}
            {showCreateModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
                    onClick={(e) => { if (e.target === e.currentTarget) setShowCreateModal(false) }}
                >
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200 text-left">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4">
                            {t('basecamp.make_new_project')}
                        </h3>
                        <form onSubmit={handleCreateProject} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">{t('basecamp.project_name_label')}</label>
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
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">{t('basecamp.project_desc_label')}</label>
                                <textarea
                                    value={newProjectDesc}
                                    onChange={(e) => setNewProjectDesc(e.target.value)}
                                    placeholder={t('basecamp.project_description_placeholder')}
                                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] text-sm h-20"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{t('basecamp.project_color_label')}</label>
                                <div className="flex gap-1.5 flex-wrap">
                                    {Object.keys(COLOR_CLASSES).map((cName) => (
                                        <button
                                            key={cName}
                                            type="button"
                                            onClick={() => setNewProjectColor(cName)}
                                            className={`w-7 h-7 rounded-full border-2 ${
                                                newProjectColor === cName ? 'border-[#1D7DB5] scale-110' : 'border-transparent'
                                            }`}
                                            style={{ backgroundColor: cName === 'white' ? '#ffffff' : cName === 'brown' ? '#8d5b4c' : cName }}
                                            title={t(`basecamp.color_${cName}`)}
                                        />
                                    ))}
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 pt-4">
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
                                    className="px-4 py-2 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] disabled:opacity-50 text-white font-extrabold text-xs shadow flex items-center gap-1.5"
                                >
                                    {creatingProject && <Loader2 size={12} className="animate-spin" />}
                                    <span>{t('basecamp.create')}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
