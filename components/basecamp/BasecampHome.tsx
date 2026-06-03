/**
 * @module BasecampHome
 * @description Panel de inicio principal del emulador de Basecamp.
 *              Incluye saludo dinámico, The Lineup (línea de tiempo), cuadrícula de proyectos con estrellas y cambio de color, y actividad reciente.
 * @businessRules
 *   - Agrupar proyectos en destacados (pinned) y normales.
 *   - Permitir cambiar el color de cada proyecto (guardado en LocalStorage).
 *   - Mostrar el listado de personas activas.
 * @dataFlow
 *   - Recibe listado de proyectos y callback para actualizarlos.
 *   - Usa navigateTo para navegar entre secciones.
 */

'use client'

import React, { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n'
import { motion } from 'framer-motion'
import {
    Plus, FolderPlus, UserPlus, ShieldAlert, Star, Settings, Paintbrush,
    Calendar, CheckSquare, MessageSquare, PlusCircle, Flame, MessageCircle, FileText
} from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'

// Mapa de colores HSL con variables seguras compatibles con Tailwind
const COLOR_CLASSES: Record<string, { border: string; bg: string; text: string; dot: string }> = {
    white: { border: 'border-slate-200 dark:border-slate-700', bg: 'bg-[#fffdfa] dark:bg-slate-900', text: 'text-slate-800 dark:text-slate-200', dot: 'bg-slate-400' },
    yellow: { border: 'border-yellow-300 dark:border-yellow-700', bg: 'bg-yellow-50/50 dark:bg-yellow-950/20', text: 'text-yellow-900 dark:text-yellow-100', dot: 'bg-yellow-500' },
    orange: { border: 'border-orange-300 dark:border-orange-700', bg: 'bg-orange-50/50 dark:bg-orange-950/20', text: 'text-orange-900 dark:text-orange-100', dot: 'bg-orange-500' },
    red: { border: 'border-red-300 dark:border-red-700', bg: 'bg-red-50/50 dark:bg-red-950/20', text: 'text-red-900 dark:text-red-100', dot: 'bg-red-500' },
    pink: { border: 'border-pink-300 dark:border-pink-700', bg: 'bg-pink-50/50 dark:bg-pink-950/20', text: 'text-pink-900 dark:text-pink-100', dot: 'bg-pink-500' },
    purple: { border: 'border-purple-300 dark:border-purple-700', bg: 'bg-purple-50/50 dark:bg-purple-950/20', text: 'text-purple-900 dark:text-purple-100', dot: 'bg-purple-500' },
    blue: { border: 'border-blue-300 dark:border-blue-700', bg: 'bg-blue-50/50 dark:bg-blue-950/20', text: 'text-blue-900 dark:text-blue-100', dot: 'bg-blue-500' },
    green: { border: 'border-green-300 dark:border-green-700', bg: 'bg-green-50/50 dark:bg-green-950/20', text: 'text-green-900 dark:text-green-100', dot: 'bg-green-500' },
    brown: { border: 'border-amber-600/30 dark:border-amber-700/50', bg: 'bg-amber-50/30 dark:bg-amber-950/10', text: 'text-amber-900 dark:text-amber-100', dot: 'bg-amber-600' },
    gray: { border: 'border-gray-300 dark:border-gray-700', bg: 'bg-gray-50 dark:bg-gray-800/40', text: 'text-gray-800 dark:text-gray-200', dot: 'bg-gray-500' }
}

interface BasecampHomeProps {
    projects: any[]
    saveProjects: (projects: any[]) => void
    navigateTo: (params: { project?: string; tool?: string; section?: string }) => void
    userName: string
}

export default function BasecampHome({ projects, saveProjects, navigateTo, userName }: BasecampHomeProps) {
    const supabase = getSupabaseWithAuth()
    const { t } = useLanguage()

    const [activityFeed, setActivityFeed] = useState<any[]>([])
    const [loadingActivity, setLoadingActivity] = useState(true)

    const loadActivity = async () => {
        setLoadingActivity(true)
        try {
            const [commentsRes, messagesRes, todosRes, campfireRes, answersRes] = await Promise.all([
                supabase
                    .from('bc_comments')
                    .select('id, created_at, content, parent_type, parent_id, project:bc_projects(bc_id, name), author:bc_people(name)')
                    .order('created_at', { ascending: false })
                    .limit(10),
                supabase
                    .from('bc_messages')
                    .select('id, created_at, title, project:bc_projects(bc_id, name), author:bc_people(name)')
                    .order('created_at', { ascending: false })
                    .limit(10),
                supabase
                    .from('bc_todos')
                    .select('id, updated_at, title, is_completed, completed_at, project:bc_projects(bc_id, name), creator:bc_people(name)')
                    .order('updated_at', { ascending: false })
                    .limit(10),
                supabase
                    .from('bc_campfire_lines')
                    .select('id, created_at, content, project:bc_projects(bc_id, name), author:bc_people(name)')
                    .order('created_at', { ascending: false })
                    .limit(10),
                supabase
                    .from('bc_answers')
                    .select('id, created_at, content, project:bc_projects(bc_id, name), author:bc_people(name), question:bc_questions(title)')
                    .order('created_at', { ascending: false })
                    .limit(10)
            ])

            const items: any[] = []

            if (commentsRes.data) {
                commentsRes.data.forEach((c: any) => {
                    items.push({
                        id: `comment-${c.id}`,
                        timestamp: new Date(c.created_at),
                        dateStr: c.created_at,
                        userName: c.author?.name || 'Unknown',
                        type: 'comment',
                        text: c.parent_type === 'todo' ? 'basecamp.activity_comment_todo' : c.parent_type === 'message' ? 'basecamp.activity_comment_message' : 'basecamp.activity_comment_document',
                        detail: c.content?.replace(/<[^>]*>/g, '').substring(0, 60) + (c.content?.length > 60 ? '...' : ''),
                        projectBcId: c.project?.bc_id,
                        projectName: c.project?.name,
                        tool: c.parent_type === 'todo' ? 'todos' : c.parent_type === 'message' ? 'messages' : 'docs'
                    })
                })
            }

            if (messagesRes.data) {
                messagesRes.data.forEach((m: any) => {
                    items.push({
                        id: `message-${m.id}`,
                        timestamp: new Date(m.created_at),
                        dateStr: m.created_at,
                        userName: m.author?.name || 'Unknown',
                        type: 'message',
                        text: 'basecamp.activity_create_message',
                        detail: `"${m.title}"`,
                        projectBcId: m.project?.bc_id,
                        projectName: m.project?.name,
                        tool: 'messages'
                    })
                })
            }

            if (todosRes.data) {
                todosRes.data.forEach((t: any) => {
                    items.push({
                        id: `todo-${t.id}`,
                        timestamp: new Date(t.updated_at),
                        dateStr: t.updated_at,
                        userName: t.creator?.name || 'Unknown',
                        type: 'todo',
                        text: t.is_completed ? 'basecamp.activity_complete_todo' : 'basecamp.activity_create_todo',
                        detail: `"${t.title}"`,
                        projectBcId: t.project?.bc_id,
                        projectName: t.project?.name,
                        tool: 'todos'
                    })
                })
            }

            if (campfireRes.data) {
                campfireRes.data.forEach((cf: any) => {
                    items.push({
                        id: `campfire-${cf.id}`,
                        timestamp: new Date(cf.created_at),
                        dateStr: cf.created_at,
                        userName: cf.author?.name || 'Unknown',
                        type: 'campfire',
                        text: 'basecamp.activity_campfire_chat',
                        detail: `"${cf.content?.replace(/<[^>]*>/g, '').substring(0, 60)}${cf.content?.length > 60 ? '...' : ''}"`,
                        projectBcId: cf.project?.bc_id,
                        projectName: cf.project?.name,
                        tool: 'campfire'
                    })
                })
            }

            if (answersRes.data) {
                answersRes.data.forEach((a: any) => {
                    items.push({
                        id: `answer-${a.id}`,
                        timestamp: new Date(a.created_at),
                        dateStr: a.created_at,
                        userName: a.author?.name || 'Unknown',
                        type: 'answer',
                        text: 'basecamp.activity_answer_checkin',
                        detail: `"${a.content?.replace(/<[^>]*>/g, '').substring(0, 60)}${a.content?.length > 60 ? '...' : ''}"`,
                        projectBcId: a.project?.bc_id,
                        projectName: a.project?.name,
                        tool: 'checkins'
                    })
                })
            }

            // Sort descending
            items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            setActivityFeed(items.slice(0, 15))
        } catch (err: any) {
            console.error('Error combining activity feed:', err.message)
        } finally {
            setLoadingActivity(false)
        }
    }

    useEffect(() => {
        loadActivity()
    }, [projects])

    const formatActivityTime = (dateStr: string) => {
        const d = new Date(dateStr)
        const now = new Date()
        const diffMs = now.getTime() - d.getTime()
        const diffMin = Math.floor(diffMs / 60000)
        const diffHours = Math.floor(diffMin / 60)
        
        if (diffMin < 1) return t('basecamp.activity_time_just_now')
        if (diffMin < 60) return t('basecamp.activity_time_mins').replace('{n}', String(diffMin))
        if (diffHours < 24) return t('basecamp.activity_time_hrs').replace('{n}', String(diffHours))
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    }

    // Control del saludo según la hora local
    const getGreeting = () => {
        const hour = new Date().getHours()
        const shortName = userName.split(' ')[0]
        if (hour >= 6 && hour < 12) {
            return t('basecamp.greeting_morning').replace('{name}', shortName)
        } else if (hour >= 12 && hour < 18) {
            return t('basecamp.greeting_afternoon').replace('{name}', shortName)
        } else {
            return t('basecamp.greeting_evening').replace('{name}', shortName)
        }
    }

    // Estado del modal de crear proyecto
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [newProjectName, setNewProjectName] = useState('')
    const [newProjectDesc, setNewProjectDesc] = useState('')
    const [newProjectColor, setNewProjectColor] = useState('white')
    
    // Estado del popover de color activo por proyecto
    const [activeColorPickerId, setActiveColorPickerId] = useState<string | null>(null)

    const handleCreateProject = (e: React.FormEvent) => {
        e.preventDefault()
        if (!newProjectName.trim()) return

        const newProj = {
            id: String(Date.now()),
            name: newProjectName.trim(),
            description: newProjectDesc.trim() || 'Proyecto creado sin descripción.',
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
                className={`relative flex flex-col justify-between p-5 rounded-2xl border-2 ${colorStyles.border} ${colorStyles.bg} shadow-md hover:shadow-xl cursor-pointer transition-all duration-200 min-h-[170px] group`}
            >
                <div className="flex-1">
                    <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className={`text-base font-extrabold tracking-tight ${colorStyles.text} group-hover:underline`}>
                            {p.name}
                        </h3>
                        <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
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
                                    <Paintbrush size={14} />
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
                                                style={{ backgroundColor: cName === 'white' ? '#fffdfa' : cName === 'brown' ? '#d97706' : cName }}
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
                                <Star size={14} fill={p.is_pinned ? 'currentColor' : 'none'} />
                            </button>
                        </div>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-3">
                        {p.description || t('basecamp.no_description')}
                    </p>
                </div>

                {/* Colaboradores / Miembros */}
                <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800/80 pt-3 mt-4">
                    <div className="flex -space-x-1.5 overflow-hidden">
                        {(p.people || []).slice(0, 4).map((person: any, idx: number) => (
                            <div
                                key={idx}
                                className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 border-2 border-[#fffdf9] dark:border-slate-900 flex items-center justify-center text-[9px] font-black text-slate-600 dark:text-slate-200 uppercase"
                                title={`${person.name} (${person.role})`}
                            >
                                {person.name[0]}
                            </div>
                        ))}
                        {p.people && p.people.length > 4 && (
                            <div className="w-6 h-6 rounded-full bg-slate-100 border-2 border-white flex items-center justify-center text-[8px] font-bold text-slate-500">
                                +{p.people.length - 4}
                            </div>
                        )}
                    </div>
                    <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                        {p.peopleCount || 1} {p.peopleCount === 1 ? t('basecamp.project_person') : t('basecamp.project_people')}
                    </span>
                </div>
            </motion.div>
        )
    }

    return (
        <div className="flex-1 flex flex-col md:flex-row gap-8">
            {/* Sección Izquierda: Saludo, Lineup y Proyectos */}
            <div className="flex-1 flex flex-col gap-8">
                {/* Saludo */}
                <div>
                    <h1 className="text-3xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight leading-none mb-1">
                        {getGreeting()}
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                </div>

                {/* THE LINEUP (Classic timeline visualization) */}
                <div className="bg-[#F7F5F2] dark:bg-slate-800/50 border border-[#E8E6E1] dark:border-slate-800 p-5 rounded-2xl shadow-inner">
                    <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">
                        {t('basecamp.lineup')}
                    </h3>
                    <div className="relative border-l-2 border-[#1D7DB5]/30 pl-4 py-2 space-y-4">
                        <div className="absolute top-0 -left-[5px] w-2 h-2 rounded-full bg-[#1D7DB5]" />
                        
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <span className="text-xs font-bold text-[#1D7DB5] dark:text-blue-400">{t('basecamp.current_week')}</span>
                            <span className="text-[10px] text-slate-400">Mayo - Junio 2026</span>
                        </div>

                        {/* Líneas de proyectos simuladas en la línea temporal */}
                        <div className="space-y-2">
                            {projects.map((p, idx) => {
                                const colorStyles = COLOR_CLASSES[p.color] || COLOR_CLASSES.white
                                return (
                                    <div
                                        key={p.id}
                                        onClick={() => navigateTo({ project: p.id })}
                                        className="w-full flex items-center gap-3 p-2 rounded-xl bg-white dark:bg-slate-900 border border-[#E8E6E1] dark:border-slate-800 hover:border-[#1D7DB5]/60 cursor-pointer shadow-sm transition-all duration-200 hover:scale-[1.005]"
                                    >
                                        <div className={`w-3 h-3 rounded-full ${colorStyles.dot}`} />
                                        <span className="text-xs font-extrabold text-slate-700 dark:text-slate-200 flex-1 truncate">{p.name}</span>
                                        <span className="text-[10px] text-slate-400 dark:text-slate-500 hidden sm:inline">Hito: {idx === 0 ? t('dashboard.audits_month') : idx === 1 ? t('basecamp.activity_label_todo') : t('schedule.visit')}</span>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>

                {/* Proyectos Destacados (Pinned) */}
                {pinnedProjects.length > 0 && (
                    <div>
                        <h2 className="text-lg font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-4">
                            <Star size={18} className="text-amber-500" fill="currentColor" />
                            {t('basecamp.pinned_projects')}
                        </h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                            {pinnedProjects.map(p => renderProjectCard(p))}
                        </div>
                    </div>
                )}

                {/* Todos los Proyectos y Equipos */}
                <div>
                    <h2 className="text-lg font-extrabold text-slate-800 dark:text-slate-100 mb-4">
                        {t('basecamp.all_projects')}
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {otherProjects.map(p => renderProjectCard(p))}
                    </div>
                </div>
            </div>

            {/* Sección Derecha: Sidebar de Acciones Rápidas y Actividad Reciente */}
            <aside className="w-full md:w-[280px] flex flex-col gap-8 md:border-l md:border-slate-100 md:dark:border-slate-800/80 md:pl-8">
                {/* Botones de acción rápida */}
                <div className="space-y-3">
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] text-white font-extrabold text-xs shadow-md hover:shadow-lg transition-all"
                    >
                        <Plus size={16} />
                        <span>{t('basecamp.make_new_project')}</span>
                    </button>
                    
                    <button
                        onClick={() => alert('Folder added (simulation)')}
                        className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-200 font-bold text-xs shadow-sm transition-all"
                    >
                        <FolderPlus size={15} />
                        <span>{t('basecamp.add_folder')}</span>
                    </button>

                    <button
                        onClick={() => alert('Invite members (simulation)')}
                        className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-200 font-bold text-xs shadow-sm transition-all"
                    >
                        <UserPlus size={15} />
                        <span>{t('basecamp.invite_people')}</span>
                    </button>

                    <button
                        onClick={() => alert('Adminland Settings (simulation)')}
                        className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-200 font-bold text-xs shadow-sm transition-all"
                    >
                        <ShieldAlert size={15} />
                        <span>{t('basecamp.adminland')}</span>
                    </button>
                </div>

                {/* Actividad Reciente */}
                <div className="bg-white dark:bg-slate-900 border border-[#E8E6E1] dark:border-slate-800 p-4 rounded-2xl shadow-sm flex-1 flex flex-col min-h-[300px]">
                    <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">
                        {t('basecamp.recent_activity')}
                    </h3>
                    {loadingActivity ? (
                        <div className="flex-grow flex items-center justify-center py-8">
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#1D7DB5]"></div>
                        </div>
                    ) : activityFeed.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-8">{t('basecamp.activity_no_recent')}</p>
                    ) : (
                        <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1 no-scrollbar text-xs">
                            {activityFeed.map((act) => {
                                const dotColors: Record<string, string> = {
                                    comment: 'bg-blue-500',
                                    message: 'bg-purple-500',
                                    todo: 'bg-green-500',
                                    campfire: 'bg-orange-500',
                                    answer: 'bg-yellow-500'
                                }
                                return (
                                    <div key={act.id} className="border-l border-slate-200 dark:border-slate-700 pl-3 relative space-y-1">
                                        <div className={`absolute top-1 -left-[4px] w-2 h-2 rounded-full ${dotColors[act.type] || 'bg-slate-400'}`} />
                                        <p className="text-slate-400 text-[10px]">{formatActivityTime(act.dateStr)}</p>
                                        <p className="text-slate-700 dark:text-slate-300 font-bold">{act.userName}</p>
                                        <p className="text-slate-500">
                                            {t(act.text)}{' '}
                                            <span 
                                                className="underline cursor-pointer font-medium text-slate-700 dark:text-slate-300 hover:text-[#1D7DB5] dark:hover:text-blue-400" 
                                                onClick={() => navigateTo({ project: String(act.projectBcId), tool: act.tool })}
                                            >
                                                {act.detail}
                                            </span>
                                            {act.projectName && (
                                                <span className="text-[10px] text-slate-400 block mt-0.5">
                                                    {t('basecamp.activity_in_project').replace('{project}', act.projectName)}
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                    <button
                        onClick={() => navigateTo({ section: 'activity' })}
                        className="w-full text-center text-xs font-bold text-[#1D7DB5] dark:text-blue-400 hover:underline mt-4 block pt-2 border-t border-[#E8E6E1] dark:border-slate-800"
                    >
                        {t('basecamp.view_all_activity')}
                    </button>
                </div>
            </aside>

            {/* Modal para Crear Proyecto */}
            {showCreateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200">
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
                                            style={{ backgroundColor: cName === 'white' ? '#fffdfa' : cName === 'brown' ? '#d97706' : cName }}
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
