/**
 * @module MyStuffPage
 * @description Espacio personal del usuario ("Mi Espacio").
 *              Centraliza las asignaciones de tareas del usuario, su calendario de proyectos, sus documentos y su historial de actividad reciente desde Supabase.
 * @businessRules
 *   - Agrupar tareas asignadas al usuario de forma clara en todos los proyectos de los que es miembro.
 *   - Mostrar eventos e hitos de los proyectos del usuario.
 * @dataFlow
 *   - Entrada: Props `navigateTo` y `currentUserName`.
 *   - Fetch: Resuelve el usuario en `bc_people` por email, y realiza consultas a `bc_todos`, `bc_schedule_entries`, `bc_documents` y `bc_comments` correspondientes.
 * @notes
 *   - Soporte multilingüe (ES/EN) con useLanguage.
 *   - Elimina la simulación visual estática por completo.
 */

'use client'

import React, { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n'
import { ClipboardList, Calendar, History, FileText, CheckCircle2, Loader2 } from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { useAuth } from '@/components/ProtectedRoute'

interface MyStuffPageProps {
    navigateTo: (params: { project?: string; tool?: string; section?: string }) => void
    currentUserName: string
}

export default function MyStuffPage({ navigateTo, currentUserName }: MyStuffPageProps) {
    const supabase = getSupabaseWithAuth()
    const { t } = useLanguage()
    const { user, loading: authLoading } = useAuth()
    const [loading, setLoading] = useState(true)
    const [myTasks, setMyTasks] = useState<any[]>([])
    const [myEvents, setMyEvents] = useState<any[]>([])
    const [myDocs, setMyDocs] = useState<any[]>([])
    const [myActivity, setMyActivity] = useState<any[]>([])

    useEffect(() => {
        if (authLoading || !user) return

        const loadMyStuff = async () => {
            setLoading(true)
            try {
                // 2. Resolve person record in bc_people
                const { data: person } = await supabase
                    .from('bc_people')
                    .select('id')
                    .eq('email', user.email || '')
                    .limit(1)
                    .single()

                if (!person) {
                    setLoading(false)
                    return
                }

                const personId = person.id

                // 3. Fetch Tasks assigned to this user
                const { data: tasks, error: tasksErr } = await supabase
                    .from('bc_todos')
                    .select(`
                        id, title, is_completed, updated_at,
                        project:bc_projects(bc_id, name),
                        todolist:bc_todolists(name),
                        bc_todo_assignees!inner(person_id)
                    `)
                    .eq('bc_todo_assignees.person_id', personId)
                    .order('updated_at', { ascending: false })

                if (tasksErr) throw tasksErr
                setMyTasks(tasks || [])

                // 4. Fetch Events in projects the user is a member of
                const { data: memberships } = await supabase
                    .from('bc_memberships')
                    .select('project_id')
                    .eq('person_id', personId)

                const userProjectIds = memberships?.map(m => m.project_id) || []

                if (userProjectIds.length > 0) {
                    const { data: events, error: eventsErr } = await supabase
                        .from('bc_schedule_entries')
                        .select(`
                            id, title, starts_at,
                            project:bc_projects(bc_id, name)
                        `)
                        .in('project_id', userProjectIds)
                        .gte('starts_at', new Date().toISOString())
                        .order('starts_at', { ascending: true })
                        .limit(10)

                    if (eventsErr) throw eventsErr
                    setMyEvents(events || [])
                }

                // 5. Fetch Documents created by this user
                const { data: docs, error: docsErr } = await supabase
                    .from('bc_documents')
                    .select(`
                        id, title, updated_at,
                        project:bc_projects(bc_id, name)
                    `)
                    .eq('author_person_id', personId)
                    .order('updated_at', { ascending: false })
                    .limit(5)

                if (docsErr) throw docsErr
                setMyDocs(docs || [])

                // 6. Fetch Recent Comments/Activity by this user
                const { data: comments, error: commsErr } = await supabase
                    .from('bc_comments')
                    .select(`
                        id, content, created_at, parent_type, parent_id,
                        project:bc_projects(bc_id, name)
                    `)
                    .eq('author_person_id', personId)
                    .order('created_at', { ascending: false })
                    .limit(5)

                if (commsErr) throw commsErr
                setMyActivity(comments || [])

            } catch (err: any) {
                console.error('❌ [MyStuffPage Fetch] Error:', err.message)
            } finally {
                setLoading(false)
            }
        }

        loadMyStuff()
    }, [user, authLoading])

    const getMonthName = (dateStr: string) => {
        const date = new Date(dateStr)
        return date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()
    }

    const getDayNum = (dateStr: string) => {
        const date = new Date(dateStr)
        return date.getDate()
    }

    return (
        <div className="flex-1 max-w-4xl mx-auto w-full flex flex-col gap-6 sm:gap-8 px-4 sm:px-0 text-left">
            {/* Cabecera de Mi Espacio */}
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-black text-slate-855 dark:text-slate-100 flex items-center gap-2">
                        {t('basecamp.my_stuff')}
                    </h2>
                    <p className="text-[10px] text-slate-450 dark:text-slate-400 uppercase tracking-widest mt-0.5 font-semibold">
                        {t('basecamp.my_stuff_sub')}
                    </p>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 text-[#1D7DB5] animate-spin" />
                </div>
            ) : (
                /* Cuadrícula de Contenidos */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* 1. MIS ASIGNACIONES */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex flex-col min-h-[300px]">
                        <h3 className="text-sm font-extrabold text-slate-805 dark:text-slate-200 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3 mb-4">
                            <ClipboardList size={18} className="text-[#1D7DB5]" />
                            {t('basecamp.my_assignments')}
                        </h3>
                        
                        {myTasks.length > 0 ? (
                            <div className="space-y-3 flex-1 overflow-y-auto max-h-[320px] pr-1 no-scrollbar">
                                {myTasks.map((task) => (
                                    <div
                                        key={task.id}
                                        onClick={() => navigateTo({ project: String(task.project?.bc_id), tool: 'todos' })}
                                        className="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 hover:border-blue-200/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-all cursor-pointer text-xs"
                                    >
                                        <CheckCircle2 size={16} className={task.is_completed ? 'text-green-500 shrink-0' : 'text-slate-355 shrink-0'} />
                                        <div className="min-w-0 flex-1">
                                            <p className={`font-bold truncate ${task.is_completed ? 'line-through text-slate-400' : 'text-slate-750 dark:text-slate-200'}`}>
                                                {task.title}
                                            </p>
                                            <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 font-semibold">
                                                {task.project?.name || t('basecamp.my_stuff_project')} • {task.todolist?.name || t('basecamp.my_stuff_list')}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-slate-450 dark:text-slate-500 text-center py-12 italic my-auto">
                                {t('basecamp.no_assignments_desc')}
                            </p>
                        )}
                    </div>

                    {/* 2. MI AGENDA / CALENDARIO */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex flex-col min-h-[300px]">
                        <h3 className="text-sm font-extrabold text-slate-805 dark:text-slate-200 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3 mb-4">
                            <Calendar size={18} className="text-[#1D7DB5]" />
                            {t('basecamp.my_schedule_title')}
                        </h3>

                        {myEvents.length > 0 ? (
                            <div className="space-y-3 flex-1 overflow-y-auto max-h-[320px] pr-1 no-scrollbar">
                                {myEvents.map((e) => (
                                    <div
                                        key={e.id}
                                        onClick={() => navigateTo({ project: String(e.project?.bc_id), tool: 'schedule' })}
                                        className="flex items-center gap-3 p-2 rounded-xl border border-slate-100 dark:border-slate-800 hover:border-blue-200/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-all cursor-pointer text-xs"
                                    >
                                        <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200/40 dark:border-blue-900/30 w-10 h-10 rounded-lg flex flex-col items-center justify-center shrink-0">
                                            <span className="text-[8px] font-black uppercase text-[#1D7DB5] leading-none mb-0.5">{getMonthName(e.starts_at)}</span>
                                            <span className="text-sm font-extrabold text-slate-800 dark:text-slate-200 leading-none">
                                                {getDayNum(e.starts_at)}
                                            </span>
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="font-bold text-slate-700 dark:text-slate-300 truncate">{e.title}</p>
                                            <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 font-semibold">{e.project?.name}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-slate-450 dark:text-slate-500 text-center py-12 italic my-auto">
                                {t('basecamp.no_schedule_desc')}
                            </p>
                        )}
                    </div>

                    {/* 3. MIS DOCUMENTOS */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex flex-col min-h-[220px]">
                        <h3 className="text-sm font-extrabold text-slate-805 dark:text-slate-200 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3 mb-4">
                            <FileText size={18} className="text-[#1D7DB5]" />
                            {t('basecamp.docs_files')}
                        </h3>
                        {myDocs.length > 0 ? (
                            <div className="space-y-2 flex-1 text-xs overflow-y-auto max-h-[160px] no-scrollbar">
                                {myDocs.map((doc) => (
                                    <div
                                        key={doc.id}
                                        onClick={() => navigateTo({ project: String(doc.project?.bc_id), tool: 'docs' })}
                                        className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-all cursor-pointer"
                                    >
                                        <p className="font-bold text-slate-700 dark:text-slate-300 truncate">{doc.title}</p>
                                        <p className="text-[9px] text-slate-400 mt-1 font-semibold">
                                            {t('basecamp.modified_label')}: {new Date(doc.updated_at).toLocaleDateString()} • {doc.project?.name}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-slate-450 dark:text-slate-500 text-center py-6 italic my-auto">
                                {t('basecamp.no_docs_desc')}
                            </p>
                        )}
                    </div>

                    {/* 4. MI HISTORIAL DE ACTIVIDAD */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex flex-col min-h-[220px]">
                        <h3 className="text-sm font-extrabold text-slate-805 dark:text-slate-200 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3 mb-4">
                            <History size={18} className="text-[#1D7DB5]" />
                            {t('basecamp.my_activity')}
                        </h3>
                        {myActivity.length > 0 ? (
                            <div className="space-y-3 flex-1 text-xs text-slate-600 dark:text-slate-400 pl-2 overflow-y-auto max-h-[160px] no-scrollbar text-left">
                                {myActivity.map((act) => (
                                    <div key={act.id} className="border-l border-slate-200 dark:border-slate-700 pl-3 relative py-0.5">
                                        <div className="absolute top-1.5 -left-[4px] w-2 h-2 rounded-full bg-[#1D7DB5]" />
                                        <p className="text-[8px] text-slate-400 font-bold uppercase">
                                            {new Date(act.created_at).toLocaleDateString()} {new Date(act.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                        <p className="text-slate-700 dark:text-slate-300 mt-0.5">
                                            {act.parent_type === 'todo'
                                                ? t('basecamp.commented_on_todo')
                                                : act.parent_type === 'message'
                                                ? t('basecamp.commented_on_message')
                                                : t('basecamp.commented_on_document')}{' '}
                                            {t('basecamp.commented_in_project')}{' '}
                                            <strong className="font-extrabold">{act.project?.name}</strong>
                                        </p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-slate-450 dark:text-slate-500 text-center py-6 italic my-auto">
                                {t('basecamp.no_activity_desc')}
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
