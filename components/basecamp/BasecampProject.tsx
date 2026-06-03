/**
 * @module BasecampProject
 * @description Vista detallada de un proyecto de Basecamp.
 *              Muestra cabecera de proyecto, medidor de aguja de progreso, integrantes y tarjetas con vistas previas de las 6 herramientas principales.
 * @businessRules
 *   - El medidor de aguja gira en consonancia al porcentaje de tareas completadas de To-dos, o de forma manual.
 *   - Cada tarjeta de herramienta proporciona una vista previa concisa de su contenido actual (p. ej. últimos mensajes o chats).
 * @dataFlow
 *   - Pasa la navegación a través de navigateTo(project, tool).
 *   - Permite destacar o quitar destacado directamente.
 */

'use client'

import React, { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n'
import {
    Star, MessageSquare, ClipboardList, FolderOpen, Calendar, HelpCircle,
    Mail, ArrowLeft, Plus, Trash2, Sliders, PlayCircle
} from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'

// Variables HSL de colores
const COLOR_CLASSES: Record<string, { border: string; bg: string; text: string; dot: string; theme: string }> = {
    white: { border: 'border-slate-200 dark:border-slate-700', bg: 'bg-white dark:bg-slate-900', text: 'text-slate-800 dark:text-slate-200', dot: 'bg-slate-400', theme: 'var(--recording-color-canvas)' },
    yellow: { border: 'border-yellow-300 dark:border-yellow-700', bg: 'bg-yellow-50/50 dark:bg-yellow-950/20', text: 'text-yellow-900 dark:text-yellow-100', dot: 'bg-yellow-500', theme: 'var(--recording-color-yellow)' },
    orange: { border: 'border-orange-300 dark:border-orange-700', bg: 'bg-orange-50/50 dark:bg-orange-950/20', text: 'text-orange-900 dark:text-orange-100', dot: 'bg-orange-500', theme: 'var(--recording-color-orange)' },
    red: { border: 'border-red-300 dark:border-red-700', bg: 'bg-red-50/50 dark:bg-red-950/20', text: 'text-red-900 dark:text-red-100', dot: 'bg-red-500', theme: 'var(--recording-color-red)' },
    pink: { border: 'border-pink-300 dark:border-pink-700', bg: 'bg-pink-50/50 dark:bg-pink-950/20', text: 'text-pink-900 dark:text-pink-100', dot: 'bg-pink-500', theme: 'var(--recording-color-pink)' },
    purple: { border: 'border-purple-300 dark:border-purple-700', bg: 'bg-purple-50/50 dark:bg-purple-950/20', text: 'text-purple-900 dark:text-purple-100', dot: 'bg-purple-500', theme: 'var(--recording-color-purple)' },
    blue: { border: 'border-blue-300 dark:border-blue-700', bg: 'bg-blue-50/50 dark:bg-blue-950/20', text: 'text-blue-900 dark:text-blue-100', dot: 'bg-blue-500', theme: 'var(--recording-color-blue)' },
    green: { border: 'border-green-300 dark:border-green-700', bg: 'bg-green-50/50 dark:bg-green-950/20', text: 'text-green-900 dark:text-green-100', dot: 'bg-green-500', theme: 'var(--recording-color-green)' },
    brown: { border: 'border-amber-600/30 dark:border-amber-700/50', bg: 'bg-amber-50/30 dark:bg-amber-950/10', text: 'text-amber-900 dark:text-amber-100', dot: 'bg-amber-600', theme: 'var(--recording-color-sand)' },
    gray: { border: 'border-gray-300 dark:border-gray-700', bg: 'bg-gray-50 dark:bg-gray-850/40', text: 'text-gray-800 dark:text-gray-200', dot: 'bg-gray-500', theme: 'var(--recording-color-primary)' }
}

interface BasecampProjectProps {
    project: any
    navigateTo: (params: { project?: string; tool?: string; section?: string }) => void
    saveProjects: (projects: any[]) => void
    projects: any[]
    currentUserName: string
}

export default function BasecampProject({ project, navigateTo, saveProjects, projects, currentUserName }: BasecampProjectProps) {
    const supabase = getSupabaseWithAuth()
    const { t } = useLanguage()

    // Progreso de aguja
    const [progressPercent, setProgressPercent] = useState(34)
    const [showNeedleModal, setShowNeedleModal] = useState(false)
    const [manualProgress, setManualProgress] = useState(34)

    // Previsualizaciones de herramientas reales desde Supabase
    const [lastChat, setLastChat] = useState<any[]>([])
    const [lastTodos, setLastTodos] = useState<any[]>([])
    const [lastMessages, setLastMessages] = useState<any[]>([])
    const [docsCount, setDocsCount] = useState(0)
    const [eventsCount, setEventsCount] = useState(0)

    useEffect(() => {
        const fetchProjectDetails = async () => {
            if (!project.db_id) return

            try {
                // 1. Calculate Real Progress from To-do lists
                const { data: dbLists } = await supabase
                    .from('bc_todolists')
                    .select('completed_count, total_count')
                    .eq('project_id', project.db_id)

                let totalCompleted = 0
                let totalTasks = 0
                if (dbLists && dbLists.length > 0) {
                    dbLists.forEach((l) => {
                        totalCompleted += l.completed_count || 0
                        totalTasks += l.total_count || 0
                    })
                }

                const pct = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0
                setProgressPercent(pct)
                setManualProgress(pct)

                // 2. Fetch last 3 todos (tasks)
                const { data: dbTodos } = await supabase
                    .from('bc_todos')
                    .select('id, title, is_completed')
                    .eq('project_id', project.db_id)
                    .order('created_at', { ascending: false })
                    .limit(3)

                if (dbTodos) {
                    setLastTodos(dbTodos.map((t) => ({
                        id: t.id,
                        task_name: t.title,
                        is_completed: t.is_completed
                    })))
                }

                // 3. Fetch last 3 chat lines from campfire
                const { data: dbChat } = await supabase
                    .from('bc_campfire_lines')
                    .select('id, content, author:bc_people(name)')
                    .eq('project_id', project.db_id)
                    .order('created_at', { ascending: false })
                    .limit(3)

                if (dbChat) {
                    // Reverse to show chronologically (oldest to newest)
                    const mappedChat = dbChat.map((c) => ({
                        author: (c.author as any)?.name || 'Unknown',
                        message: c.content
                    })).reverse()
                    setLastChat(mappedChat)
                }

                // 4. Fetch last 2 messages
                const { data: dbMessages } = await supabase
                    .from('bc_messages')
                    .select('id, title, author:bc_people(name)')
                    .eq('project_id', project.db_id)
                    .order('created_at', { ascending: false })
                    .limit(2)

                if (dbMessages) {
                    setLastMessages(dbMessages.map((m) => ({
                        title: m.title,
                        author: (m.author as any)?.name || 'Unknown'
                    })))
                }

                // 5. Fetch documents count
                const { count: docCount } = await supabase
                    .from('bc_documents')
                    .select('*', { count: 'exact', head: true })
                    .eq('project_id', project.db_id)

                setDocsCount(docCount || 0)

                // 6. Fetch events count
                const { count: evCount } = await supabase
                    .from('bc_schedule_entries')
                    .select('*', { count: 'exact', head: true })
                    .eq('project_id', project.db_id)

                setEventsCount(evCount || 0)
            } catch (err: any) {
                console.error('Error loading project dashboard:', err.message)
            }
        }

        fetchProjectDetails()
    }, [project.id, project.db_id])

    const handleUpdateNeedle = (e: React.FormEvent) => {
        e.preventDefault()
        setProgressPercent(manualProgress)
        setShowNeedleModal(false)
    }

    const togglePin = () => {
        const updated = projects.map(p => p.id === project.id ? { ...p, is_pinned: !p.is_pinned } : p)
        saveProjects(updated)
    }

    // Calcular el ángulo de rotación de la aguja: 0% es -90deg, 100% es +90deg
    const needleRotationAngle = -90 + (progressPercent / 100) * 180

    const colorStyles = COLOR_CLASSES[project.color] || COLOR_CLASSES.white

    return (
        <div className="flex-1 flex flex-col gap-6">
            {/* Cabecera del Proyecto */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <button
                            onClick={() => navigateTo({})}
                            className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 font-bold"
                        >
                            Basecamp
                        </button>
                        <span className="text-slate-300">/</span>
                        <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">{project.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-2">
                            {project.name}
                        </h1>
                        <button
                            onClick={togglePin}
                            className={`p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 ${
                                project.is_pinned ? 'text-amber-500' : 'text-slate-400'
                            }`}
                            title={project.is_pinned ? t('basecamp.unstar_project') : t('basecamp.star_project')}
                        >
                            <Star size={16} fill={project.is_pinned ? 'currentColor' : 'none'} />
                        </button>
                    </div>
                </div>

                {/* Colaboradores del proyecto */}
                <div className="flex items-center gap-3">
                    <div className="flex -space-x-1.5 overflow-hidden">
                        {(project.people || []).map((person: any, idx: number) => (
                            <div
                                key={idx}
                                className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 border-2 border-white dark:border-slate-900 flex items-center justify-center text-xs font-black text-slate-700 dark:text-slate-200 uppercase shadow-sm"
                                title={`${person.name} (${person.role})`}
                            >
                                {person.name[0]}
                            </div>
                        ))}
                    </div>
                    <button
                        onClick={() => alert('Invite members (simulation)')}
                        className="flex items-center justify-center w-8 h-8 rounded-full border border-dashed border-slate-300 hover:border-slate-500 text-slate-400 hover:text-slate-600 transition-colors"
                        title="Invitar personas"
                    >
                        <Plus size={16} />
                    </button>
                </div>
            </div>

            {/* Fila del Medidor de Aguja (The Gauge) */}
            <div className="bg-[#fcfaf6] dark:bg-slate-800/30 border border-slate-200/60 dark:border-slate-800/50 p-6 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-6 shadow-inner">
                <div className="flex-1 text-center md:text-left">
                    <h3 className="text-sm font-black text-slate-700 dark:text-slate-300 mb-1">
                        {t('basecamp.project_progress')}
                    </h3>
                    <p className="text-xs text-slate-550 dark:text-slate-400 max-w-md">
                        {t('basecamp.project_progress_desc')}
                    </p>
                </div>

                {/* Gráfico de la Aguja */}
                <div className="flex flex-col items-center gap-3">
                    <div className="relative w-[220px] h-[110px] overflow-hidden flex items-end justify-center">
                        {/* El semi-círculo de fondo */}
                        <div className="absolute w-[200px] h-[200px] rounded-full border-8 border-slate-200 dark:border-slate-700 top-2" />
                        
                        {/* Arco de progreso relleno */}
                        <svg className="absolute w-[200px] h-[100px] top-2 overflow-visible" viewBox="0 0 200 100">
                            <path
                                d="M 10 100 A 90 90 0 0 1 190 100"
                                fill="none"
                                stroke="#e2e8f0"
                                strokeWidth="8"
                                className="dark:stroke-slate-700"
                            />
                            <path
                                d="M 10 100 A 90 90 0 0 1 190 100"
                                fill="none"
                                stroke="#4BAE4F"
                                strokeWidth="8"
                                strokeDasharray="282"
                                strokeDashoffset={282 - (progressPercent / 100) * 282}
                                style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                            />
                        </svg>

                        {/* Pin de la aguja */}
                        <div className="absolute bottom-0 w-8 h-8 rounded-full bg-slate-800 dark:bg-slate-600 border-4 border-white dark:border-slate-900 z-20 flex items-center justify-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-white" />
                        </div>

                        {/* La Aguja */}
                        <div
                            className="absolute bottom-4 w-1.5 h-20 bg-slate-800 dark:bg-slate-200 origin-bottom rounded-t-full z-10 transition-transform duration-500 ease-out"
                            style={{ transform: `rotate(${needleRotationAngle}deg)` }}
                        />

                        {/* Valor en porcentaje */}
                        <span className="absolute bottom-1 right-2 text-2xl font-black text-slate-800 dark:text-slate-100">
                            {progressPercent}%
                        </span>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowNeedleModal(true)}
                            className="px-3 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 shadow-sm"
                        >
                            {t('basecamp.move_needle')}
                        </button>
                    </div>
                </div>
            </div>

            {/* Cuadrícula de 6 Herramientas (Dock Cards) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* 1. CAMPFIRE */}
                <div
                    onClick={() => navigateTo({ project: project.id, tool: 'campfire' })}
                    className="bg-[#fffdfa] dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 hover:shadow-lg cursor-pointer transition-shadow min-h-[220px] flex flex-col justify-between"
                >
                    <div>
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/85 pb-2 mb-3">
                            <h2 className="text-sm font-extrabold text-slate-850 dark:text-slate-100 flex items-center gap-2">
                                <MessageSquare size={16} className="text-orange-500" />
                                {t('basecamp.campfire')}
                            </h2>
                            <span className="text-[10px] text-orange-500 font-black">CHAT</span>
                        </div>
                        {/* Campfire preview */}
                        <div className="space-y-2 mt-2">
                            {lastChat.length > 0 ? (
                                lastChat.map((c, idx) => (
                                    <div key={idx} className="text-xs">
                                        <span className="font-extrabold text-slate-700 dark:text-slate-350">{c.author.split(' ')[0]}: </span>
                                        <span className="text-slate-500 dark:text-slate-400 line-clamp-1">{c.message}</span>
                                    </div>
                                ))
                            ) : (
                                <p className="text-xs text-slate-400 dark:text-slate-500 italic mt-4 text-center">
                                    {t('basecamp.welcome_campfire')}
                                </p>
                            )}
                        </div>
                    </div>
                    <span className="text-[10px] font-extrabold text-[#1D7DB5] mt-4 uppercase">{t('basecamp.campfire_sub')} →</span>
                </div>

                {/* 2. MESSAGE BOARD */}
                <div
                    onClick={() => navigateTo({ project: project.id, tool: 'messages' })}
                    className="bg-[#fffdfa] dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 hover:shadow-lg cursor-pointer transition-shadow min-h-[220px] flex flex-col justify-between"
                >
                    <div>
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/85 pb-2 mb-3">
                            <h2 className="text-sm font-extrabold text-slate-850 dark:text-slate-100 flex items-center gap-2">
                                <Mail size={16} className="text-blue-500" />
                                {t('basecamp.message_board')}
                            </h2>
                            <span className="text-[10px] text-blue-500 font-black">ANUNCIOS</span>
                        </div>
                        {/* Messages Board preview */}
                        <div className="space-y-2 mt-2">
                            {lastMessages.length > 0 ? (
                                lastMessages.map((m, idx) => (
                                    <div key={idx} className="text-xs border-b border-slate-50 dark:border-slate-800/30 pb-1.5">
                                        <span className="font-bold text-slate-700 dark:text-slate-300 block line-clamp-1">{m.title}</span>
                                        <span className="text-[10px] text-slate-400">{m.author}</span>
                                    </div>
                                ))
                            ) : (
                                <p className="text-xs text-slate-400 dark:text-slate-500 italic mt-4 text-center">
                                    {t('basecamp.no_messages')}
                                </p>
                            )}
                        </div>
                    </div>
                    <span className="text-[10px] font-extrabold text-[#1D7DB5] mt-4 uppercase">{t('basecamp.view_board')} →</span>
                </div>

                {/* 3. TO-DOS */}
                <div
                    onClick={() => navigateTo({ project: project.id, tool: 'todos' })}
                    className="bg-[#fffdfa] dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 hover:shadow-lg cursor-pointer transition-shadow min-h-[220px] flex flex-col justify-between"
                >
                    <div>
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/85 pb-2 mb-3">
                            <h2 className="text-sm font-extrabold text-slate-850 dark:text-slate-100 flex items-center gap-2">
                                <ClipboardList size={16} className="text-green-600" />
                                {t('basecamp.todos')}
                            </h2>
                            <span className="text-[10px] text-green-600 font-black">TAREAS</span>
                        </div>
                        {/* Todos preview */}
                        <div className="space-y-1.5 mt-2">
                            {lastTodos.length > 0 ? (
                                lastTodos.slice(0, 3).map((t, idx) => (
                                    <div key={idx} className="flex items-center gap-2 text-xs">
                                        <input
                                            type="checkbox"
                                            checked={t.is_completed}
                                            readOnly
                                            className="rounded text-[#1D7DB5] focus:ring-[#1D7DB5]"
                                        />
                                        <span className={`truncate flex-1 ${t.is_completed ? 'line-through text-slate-400' : 'text-slate-650 dark:text-slate-300'}`}>
                                            {t.task_name}
                                        </span>
                                    </div>
                                ))
                            ) : (
                                <p className="text-xs text-slate-400 dark:text-slate-500 italic mt-4 text-center">
                                    {t('basecamp.no_todos')}
                                </p>
                            )}
                        </div>
                    </div>
                    <span className="text-[10px] font-extrabold text-[#1D7DB5] mt-4 uppercase">{t('basecamp.manage_tasks')} →</span>
                </div>

                {/* 4. DOCS & FILES */}
                <div
                    onClick={() => navigateTo({ project: project.id, tool: 'docs' })}
                    className="bg-[#fffdfa] dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 hover:shadow-lg cursor-pointer transition-shadow min-h-[220px] flex flex-col justify-between"
                >
                    <div>
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/85 pb-2 mb-3">
                            <h2 className="text-sm font-extrabold text-slate-850 dark:text-slate-100 flex items-center gap-2">
                                <FolderOpen size={16} className="text-yellow-500" />
                                {t('basecamp.docs_files')}
                            </h2>
                            <span className="text-[10px] text-yellow-500 font-black">ARCHIVOS</span>
                        </div>
                        {/* Files count info */}
                        <div className="mt-4 text-center">
                            <span className="text-3xl font-black text-slate-700 dark:text-slate-300">{docsCount || 2}</span>
                            <p className="text-xs text-slate-450 dark:text-slate-400 mt-1">{t('basecamp.docs_files_created')}</p>
                        </div>
                    </div>
                    <span className="text-[10px] font-extrabold text-[#1D7DB5] mt-4 uppercase">{t('basecamp.explore_docs')} →</span>
                </div>

                {/* 5. SCHEDULE */}
                <div
                    onClick={() => navigateTo({ project: project.id, tool: 'schedule' })}
                    className="bg-[#fffdfa] dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 hover:shadow-lg cursor-pointer transition-shadow min-h-[220px] flex flex-col justify-between"
                >
                    <div>
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/85 pb-2 mb-3">
                            <h2 className="text-sm font-extrabold text-slate-850 dark:text-slate-100 flex items-center gap-2">
                                <Calendar size={16} className="text-purple-500" />
                                {t('basecamp.schedule')}
                            </h2>
                            <span className="text-[10px] text-purple-500 font-black">FECHAS</span>
                        </div>
                        {/* Events summary */}
                        <div className="mt-4 text-center">
                            <span className="text-3xl font-black text-slate-700 dark:text-slate-300">{eventsCount || 1}</span>
                            <p className="text-xs text-slate-450 dark:text-slate-400 mt-1">{t('basecamp.events_scheduled')}</p>
                        </div>
                    </div>
                    <span className="text-[10px] font-extrabold text-[#1D7DB5] mt-4 uppercase">{t('basecamp.view_calendar')} →</span>
                </div>

                {/* 6. AUTOMATIC CHECK-INS */}
                <div
                    onClick={() => navigateTo({ project: project.id, tool: 'checkins' })}
                    className="bg-[#fffdfa] dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 hover:shadow-lg cursor-pointer transition-shadow min-h-[220px] flex flex-col justify-between"
                >
                    <div>
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/85 pb-2 mb-3">
                            <h2 className="text-sm font-extrabold text-slate-850 dark:text-slate-100 flex items-center gap-2">
                                <HelpCircle size={16} className="text-amber-700" />
                                {t('basecamp.checkins')}
                            </h2>
                            <span className="text-[10px] text-amber-700 font-black">PREGUNTAS</span>
                        </div>
                        {/* Check-ins question preview */}
                        <div className="mt-2 text-xs">
                            <p className="font-extrabold text-slate-700 dark:text-slate-300">{t('basecamp.checkin_question_title')}</p>
                            <p className="text-slate-400 mt-1">{t('basecamp.checkin_question_desc')}</p>
                        </div>
                    </div>
                    <span className="text-[10px] font-extrabold text-[#1D7DB5] mt-4 uppercase">{t('basecamp.view_answers')} →</span>
                </div>
            </div>

            {/* Modal para Ajustar Progreso de Aguja */}
            {showNeedleModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200">
                        <h3 className="text-lg font-bold text-slate-855 dark:text-slate-100 mb-4">
                            {t('basecamp.move_needle')}
                        </h3>
                        <form onSubmit={handleUpdateNeedle} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{t('basecamp.progress_percentage')}</label>
                                <div className="flex items-center gap-4">
                                    <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        value={manualProgress}
                                        onChange={(e) => setManualProgress(Number(e.target.value))}
                                        className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[#1D7DB5]"
                                    />
                                    <span className="text-xl font-black text-slate-850 dark:text-slate-200 w-12 text-right">
                                        {manualProgress}%
                                    </span>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowNeedleModal(false)}
                                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                    {t('basecamp.cancel')}
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] text-white font-extrabold text-xs shadow"
                                >
                                    {t('basecamp.adjust_needle')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
