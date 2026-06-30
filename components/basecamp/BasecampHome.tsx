/**
 * @module BasecampHome
 * @description Panel de inicio principal del emulador de Basecamp.
 *              Rediseñado para replicar el aspecto limpio del Basecamp moderno, centrado en el logo del negocio,
 *              con botones de acción alineados y cuadrícula de proyectos en colores pastel elegantes.
 * @businessRules
 *   - Mostrar los proyectos en una cuadrícula con estrellas para destacar y selector de color.
 *   - Utilizar el logo de Tacos Gavilan (/logo.png) centrado en el inicio.
 *   - Permitir la creación de nuevos proyectos a través del formulario modal.
 * @notes
 *   - Se removió la sección lateral de actividad reciente y The Lineup para delegarlos al dock inferior y al cajón derecho.
 *   - Los colores de las tarjetas ahora usan un esquema pastel premium alineado con Basecamp 4.
 * @dataFlow
 *   - Proyectos y callback para actualizarlos vienen vía Props.
 *   - Navegación controlada a través del callback `navigateTo`.
 */

'use client'

import React, { useState } from 'react'
import { useLanguage } from '@/lib/i18n'
import { motion } from 'framer-motion'
import {
    Plus, FolderPlus, UserPlus, ShieldAlert, Star, Paintbrush,
    Calendar, CheckSquare, MessageSquare, ChevronDown, RefreshCw, Loader2
} from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'

// Mapa de colores HSL pastel idénticos a los del screenshot de Basecamp
const COLOR_CLASSES: Record<string, { border: string; bg: string; text: string; dot: string; hover: string }> = {
    white: { border: 'border-slate-200/80 dark:border-slate-800', bg: 'bg-[#ffffff] dark:bg-slate-900', text: 'text-slate-800 dark:text-slate-200', dot: 'bg-slate-400', hover: 'hover:border-slate-350' },
    blue: { border: 'border-[#cce5ff] dark:border-blue-900/60', bg: 'bg-[#e2f0ff] dark:bg-blue-950/20', text: 'text-[#004085] dark:text-blue-200', dot: 'bg-blue-500', hover: 'hover:border-[#99cbff]' },
    pink: { border: 'border-[#ffdae0] dark:border-pink-900/60', bg: 'bg-[#ffeef2] dark:bg-pink-950/20', text: 'text-[#721c24] dark:text-pink-200', dot: 'bg-pink-500', hover: 'hover:border-[#ffb3c1]' },
    yellow: { border: 'border-[#ffeeba] dark:border-yellow-900/60', bg: 'bg-[#fffdec] dark:bg-yellow-950/20', text: 'text-[#856404] dark:text-yellow-250', dot: 'bg-yellow-500', hover: 'hover:border-[#ffd966]' },
    orange: { border: 'border-[#ffe2cf] dark:border-orange-900/60', bg: 'bg-[#fff3eb] dark:bg-orange-950/20', text: 'text-[#b25b00] dark:text-orange-200', dot: 'bg-orange-500', hover: 'hover:border-[#ffc49e]' },
    red: { border: 'border-[#f8d7da] dark:border-red-900/60', bg: 'bg-[#fdf2f2] dark:bg-red-950/20', text: 'text-[#721c24] dark:text-red-200', dot: 'bg-red-500', hover: 'hover:border-[#f5c6cb]' },
    purple: { border: 'border-[#ebdbff] dark:border-purple-900/60', bg: 'bg-[#f8f0ff] dark:bg-purple-950/20', text: 'text-[#592b9b] dark:text-purple-200', dot: 'bg-purple-500', hover: 'hover:border-[#d6b3ff]' },
    green: { border: 'border-[#c3e6cb] dark:border-green-900/60', bg: 'bg-[#ebfbf0] dark:bg-green-950/20', text: 'text-[#155724] dark:text-green-200', dot: 'bg-green-500', hover: 'hover:border-[#a1dbb2]' },
    brown: { border: 'border-[#eeddcc] dark:border-amber-900/40', bg: 'bg-[#faf6f0] dark:bg-amber-950/10', text: 'text-[#5a3825] dark:text-amber-200', dot: 'bg-[#8d5b4c]', hover: 'hover:border-[#ddbb99]' },
    gray: { border: 'border-slate-300 dark:border-slate-700', bg: 'bg-slate-50 dark:bg-slate-800/40', text: 'text-slate-800 dark:text-slate-200', dot: 'bg-gray-500', hover: 'hover:border-slate-400' }
}

interface BasecampHomeProps {
    projects: any[]
    saveProjects: (projects: any[]) => void
    navigateTo: (params: { project?: string; tool?: string; section?: string }) => void
    userName: string
    onOpenSearch?: () => void
}

export default function BasecampHome({ projects, saveProjects, navigateTo, userName, onOpenSearch }: BasecampHomeProps) {
    const { t } = useLanguage()

    // Estado del modal de crear proyecto
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [newProjectName, setNewProjectName] = useState('')
    const [newProjectDesc, setNewProjectDesc] = useState('')
    const [newProjectColor, setNewProjectColor] = useState('white')
    
    // Estado del popover de color activo por proyecto
    const [activeColorPickerId, setActiveColorPickerId] = useState<string | null>(null)

    // Estado de sincronización con Basecamp
    const [isSyncing, setIsSyncing] = useState(false)
    const [syncStatus, setSyncStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    const handleCreateProject = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newProjectName.trim()) return

        // INSERT into Supabase bc_projects
        const supabase = getSupabaseWithAuth()
        const { data: inserted, error } = await supabase
            .from('bc_projects')
            .insert({
                name: newProjectName.trim(),
                description: newProjectDesc.trim() || '',
                bc_id: Date.now(), // unique fake bc_id
                color: newProjectColor,
                is_pinned: false,
                status: 'active',
            })
            .select('id, bc_id')
            .single()

        if (error || !inserted) {
            console.error('Failed to create project:', error)
            return
        }

        const newProj = {
            id: String(inserted.bc_id),
            db_id: inserted.id,
            name: newProjectName.trim(),
            description: newProjectDesc.trim(),
            color: newProjectColor,
            is_pinned: false,
            peopleCount: 1,
            people: [{ name: userName, role: 'Creator' }]
        }

        saveProjects([...projects, newProj])
        setNewProjectName('')
        setNewProjectDesc('')
        setNewProjectColor('white')
        setShowCreateModal(false)
    }

    // Sincronizar desde Basecamp original → Supabase (ONE-WAY, lectura solamente)
    const handleSyncBasecamp = async () => {
        if (isSyncing) return
        setIsSyncing(true)
        setSyncStatus(null)
        try {
            const res = await fetch('/api/basecamp/sync', { method: 'POST' })
            const data = await res.json()
            if (res.ok && data.status !== 'failed') {
                const count = data.records_synced || 0
                setSyncStatus({
                    type: 'success',
                    message: t('language') === 'es'
                        ? `✅ Sincronización completa — ${count} registros actualizados`
                        : `✅ Sync complete — ${count} records updated`
                })
                // Reload page after 2 seconds to show fresh data
                setTimeout(() => window.location.reload(), 2000)
            } else {
                setSyncStatus({
                    type: 'error',
                    message: t('language') === 'es'
                        ? `❌ Error: ${data.error || 'Falló la sincronización'}`
                        : `❌ Error: ${data.error || 'Sync failed'}`
                })
            }
        } catch (err: any) {
            setSyncStatus({
                type: 'error',
                message: t('language') === 'es'
                    ? `❌ Error de conexión: ${err.message}`
                    : `❌ Connection error: ${err.message}`
            })
        } finally {
            setIsSyncing(false)
        }
    }

    const togglePin = (id: string, e: React.MouseEvent) => {
        e.stopPropagation()
        const updated = projects.map(p => p.id === id ? { ...p, is_pinned: !p.is_pinned } : p)
        saveProjects(updated)
    }

    const changeProjectColor = (id: string, color: string) => {
        const updated = projects.map(p => p.id === id ? { ...p, color } : p)
        saveProjects(updated)
        setActiveColorPickerId(null)
    }

    // Dividir proyectos
    const pinnedProjects = projects.filter(p => p.is_pinned)
    const otherProjects = projects.filter(p => !p.is_pinned)

    // Renderizar tarjeta de proyecto
    const renderProjectCard = (p: any) => {
        const colorStyles = COLOR_CLASSES[p.color] || COLOR_CLASSES.white
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
                                        {Object.keys(COLOR_CLASSES).map(cName => (
                                            <button
                                                key={cName}
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    changeProjectColor(p.id, cName)
                                                }}
                                                className={`w-6 h-6 rounded-full border border-black/10`}
                                                style={{ backgroundColor: cName === 'white' ? '#ffffff' : cName === 'brown' ? '#8d5b4c' : cName }}
                                                title={cName}
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
                    {/* Star always visible if pinned */}
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
                            const charCode = (person.name || 'P').charCodeAt(0)
                            const avatarBg = colors[charCode % colors.length]

                            return (
                                <div
                                    key={idx}
                                    className="w-6 h-6 rounded-full border-2 border-white dark:border-slate-900 flex items-center justify-center text-[9px] font-black text-white uppercase shadow-sm"
                                    style={{ backgroundColor: avatarBg }}
                                    title={`${person.name} (${person.role})`}
                                >
                                    {person.name[0]}
                                </div>
                            )
                        })}
                        {p.people && p.people.length > 5 && (
                            <div className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 border-2 border-white dark:border-slate-900 flex items-center justify-center text-[8px] font-bold text-slate-500">
                                +{p.people.length - 5}
                            </div>
                        )}
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-550">
                        {p.peopleCount || 1} {p.peopleCount === 1 ? t('basecamp.project_person') : t('basecamp.project_people')}
                    </span>
                </div>
            </motion.div>
        )
    }

    return (
        <div className="flex-1 flex flex-col items-center w-full max-w-5xl mx-auto py-4">
            {/* Header: Center top selector */}
            <div className="flex items-center gap-1 text-slate-655 dark:text-slate-350 font-extrabold text-sm mb-4 cursor-pointer hover:opacity-85">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block mr-0.5" />
                <span>Basecamp</span>
                <ChevronDown size={14} className="mt-0.5 text-slate-400" />
            </div>

            {/* Centered Tacos Gavilan Logo */}
            <div className="flex flex-col items-center mb-6">
                <img 
                    src="/logo.png" 
                    alt="Tacos Gavilan Logo" 
                    className="h-20 sm:h-28 object-contain mb-2"
                />
            </div>

            {/* Jump Hint */}
            <div 
                onClick={onOpenSearch}
                className="border border-slate-200/60 dark:border-slate-850 bg-[#fffdf9] dark:bg-slate-900 px-4 py-1.5 rounded-lg text-xs font-semibold text-slate-455 dark:text-slate-400 mb-8 shadow-inner cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-850 transition-all"
            >
                {t('language') === 'es' ? (
                    <span>Presione <kbd className="bg-slate-100 dark:bg-slate-850 px-1 py-0.5 rounded border text-[10px] mx-0.5 font-bold">Shift</kbd> + <kbd className="bg-slate-100 dark:bg-slate-850 px-1 py-0.5 rounded border text-[10px] mx-0.5 font-bold">J</kbd> en cualquier momento para buscar o saltar</span>
                ) : (
                    <span>Press <kbd className="bg-slate-100 dark:bg-slate-850 px-1 py-0.5 rounded border text-[10px] mx-0.5 font-bold">Shift</kbd> + <kbd className="bg-slate-100 dark:bg-slate-850 px-1 py-0.5 rounded border text-[10px] mx-0.5 font-bold">J</kbd> anytime to search or jump</span>
                )}
            </div>

            {/* Action Buttons Row */}
            <div className="flex flex-wrap justify-center gap-2 mb-10 w-full max-w-2xl px-4">
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-850 hover:bg-slate-55 dark:hover:bg-slate-800 border border-slate-250 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold text-xs shadow-sm transition-all animate-in fade-in slide-in-from-bottom-2 duration-200"
                >
                    <Plus size={15} className="text-blue-500" />
                    <span>{t('basecamp.make_new_project')}</span>
                </button>
                
                <button
                    onClick={handleSyncBasecamp}
                    disabled={isSyncing}
                    className={`flex items-center gap-2 px-4 py-2 border rounded-xl font-bold text-xs shadow-sm transition-all animate-in fade-in slide-in-from-bottom-2 duration-600 ${
                        isSyncing
                            ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-800 text-blue-600 dark:text-blue-300 cursor-wait'
                            : 'bg-white dark:bg-slate-855 hover:bg-blue-50 dark:hover:bg-blue-950/20 border-slate-250 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                    }`}
                >
                    {isSyncing ? (
                        <Loader2 size={14} className="text-blue-500 animate-spin" />
                    ) : (
                        <RefreshCw size={14} className="text-blue-500" />
                    )}
                    <span>{isSyncing
                        ? (t('language') === 'es' ? 'Sincronizando...' : 'Syncing...')
                        : (t('language') === 'es' ? 'Sincronizar con Basecamp' : 'Sync with Basecamp')
                    }</span>
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
                    <h2 className="text-sm font-black text-slate-400 dark:text-slate-550 uppercase tracking-widest text-left mb-4 flex items-center gap-1.5">
                        <Star size={14} className="text-amber-500" fill="currentColor" />
                        {t('basecamp.pinned_projects')}
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                        {pinnedProjects.map(p => renderProjectCard(p))}
                    </div>
                </div>
            )}

            {/* All Projects Section */}
            <div className="w-full px-4 mb-12">
                <h2 className="text-sm font-black text-slate-400 dark:text-slate-550 uppercase tracking-widest text-left mb-4">
                    {t('basecamp.all_projects')}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                    {otherProjects.map(p => renderProjectCard(p))}
                </div>
            </div>

            {/* Create Project Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
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
                                    {Object.keys(COLOR_CLASSES).map(cName => (
                                        <button
                                            key={cName}
                                            type="button"
                                            onClick={() => setNewProjectColor(cName)}
                                            className={`w-7 h-7 rounded-full border-2 ${
                                                newProjectColor === cName ? 'border-[#1D7DB5] scale-110' : 'border-transparent'
                                            }`}
                                            style={{ backgroundColor: cName === 'white' ? '#ffffff' : cName === 'brown' ? '#8d5b4c' : cName }}
                                            title={cName}
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
                                    className="px-4 py-2 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] text-white font-extrabold text-xs shadow"
                                >
                                    {t('basecamp.create')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
