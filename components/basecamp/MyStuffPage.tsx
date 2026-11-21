/**
 * @module MyStuffPage
 * @description Espacio personal del usuario ("Mi Espacio").
 *              Centraliza las asignaciones de tareas del usuario, su calendario de proyectos, sus documentos y su historial de actividad reciente desde Supabase.
 * @businessRules
 *   - Agrupar tareas asignadas al usuario de forma clara en todos los proyectos de los que es miembro.
 *   - Mostrar eventos próximos e hitos de los proyectos del usuario respetando `all_day` vs hora exacta en `America/Los_Angeles`.
 * @dataFlow
 *   - Entrada: Props `navigateTo` y `currentUserName`.
 *   - Fetch: Resuelve al usuario en `bc_people` vía `resolveOrCreateTegPerson`, y consulta `bc_todos`, `bc_schedule_entries`, `bc_documents` y `bc_comments`.
 *   - Realtime: Suscripción activa para refrescar asignaciones, eventos, documentos y comentarios en vivo.
 * @notes
 *   - Soporte multilingüe (ES/EN) con `useLanguage()` y zona horaria `America/Los_Angeles`.
 *   - Evita desfases de medianoche/UTC en eventos `all_day` y elimina clases Tailwind fuera de escala.
 */

'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useLanguage } from '@/lib/i18n'
import { ClipboardList, Calendar, History, FileText, CheckCircle2, Loader2 } from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { useAuth } from '@/components/ProtectedRoute'
import { resolveOrCreateTegPerson } from '@/lib/basecamp-person-resolver'

interface MyStuffPageProps {
    navigateTo: (params: {
        project?: string
        tool?: string
        section?: string
        todoId?: string
        messageId?: string
        docId?: string
    }) => void
    currentUserName: string
}

function getPacificTodayYMD(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date())
}

export default function MyStuffPage({ navigateTo, currentUserName }: MyStuffPageProps) {
    const supabase = useMemo(() => getSupabaseWithAuth(), [])
    const { t, language } = useLanguage()
    const locale = language === 'es' ? 'es-MX' : 'en-US'
    const { user, loading: authLoading } = useAuth()
    const [loading, setLoading] = useState(true)
    const [personId, setPersonId] = useState<string | null>(null)
    const [myTasks, setMyTasks] = useState<any[]>([])
    const [myEvents, setMyEvents] = useState<any[]>([])
    const [myDocs, setMyDocs] = useState<any[]>([])
    const [myActivity, setMyActivity] = useState<any[]>([])

    const loadMyStuff = useCallback(async (opts?: { silent?: boolean }) => {
        if (!user) return
        if (!opts?.silent) setLoading(true)
        try {
            const person = await resolveOrCreateTegPerson(supabase, {
                email: user.email,
                name: user.name || currentUserName,
                role: (user as any)?.role,
            })

            if (!person?.id) {
                setMyTasks([])
                setMyEvents([])
                setMyDocs([])
                setMyActivity([])
                return
            }

            const resolvedId = person.id
            setPersonId(resolvedId)

            const [tasksRes, membershipsRes, docsRes, commsRes] = await Promise.all([
                supabase
                    .from('bc_todos')
                    .select(`
                        id, title, is_completed, created_at, updated_at,
                        project:bc_projects(bc_id, name),
                        todolist:bc_todolists(name),
                        bc_todo_assignees!inner(person_id)
                    `)
                    .eq('bc_todo_assignees.person_id', resolvedId)
                    .order('is_completed', { ascending: true })
                    .order('created_at', { ascending: false }),
                supabase
                    .from('bc_memberships')
                    .select('project_id')
                    .eq('person_id', resolvedId),
                supabase
                    .from('bc_documents')
                    .select(`
                        id, title, updated_at,
                        project:bc_projects(bc_id, name)
                    `)
                    .eq('author_person_id', resolvedId)
                    .order('updated_at', { ascending: false })
                    .limit(10),
                supabase
                    .from('bc_comments')
                    .select(`
                        id, content, created_at, parent_type, parent_id,
                        project:bc_projects(bc_id, name)
                    `)
                    .eq('author_person_id', resolvedId)
                    .order('created_at', { ascending: false })
                    .limit(10),
            ])

            setMyTasks(tasksRes.data || [])
            setMyDocs(docsRes.data || [])
            setMyActivity(commsRes.data || [])

            const userProjectIds = membershipsRes.data?.map((m: any) => m.project_id) || []
            if (userProjectIds.length > 0) {
                const todayYMD = getPacificTodayYMD()
                const queryFloor = `${todayYMD}T00:00:00Z`
                const { data: events } = await supabase
                    .from('bc_schedule_entries')
                    .select(`
                        id, title, starts_at, ends_at, all_day,
                        project:bc_projects(bc_id, name)
                    `)
                    .in('project_id', userProjectIds)
                    .or(`starts_at.gte.${queryFloor},ends_at.gte.${queryFloor}`)
                    .order('starts_at', { ascending: true })
                    .limit(20)

                const nowMs = Date.now()
                const upcoming = (events || []).filter((ev: any) => {
                    if (!ev.starts_at) return false
                    if (ev.all_day) {
                        const endYMD = String(ev.ends_at || ev.starts_at).slice(0, 10)
                        return endYMD >= todayYMD
                    }
                    const endRef = ev.ends_at ? new Date(ev.ends_at).getTime() : new Date(ev.starts_at).getTime()
                    return endRef >= nowMs - 60 * 60 * 1000
                })

                setMyEvents(upcoming.slice(0, 10))
            } else {
                setMyEvents([])
            }
        } catch (err: any) {
            console.error('❌ [MyStuffPage Fetch] Error:', err.message)
        } finally {
            if (!opts?.silent) setLoading(false)
        }
    }, [user, currentUserName, supabase])

    useEffect(() => {
        if (authLoading) return
        if (!user) {
            setLoading(false)
            return
        }
        loadMyStuff()
    }, [user, authLoading, loadMyStuff])

    useEffect(() => {
        if (!personId) return
        const channel = supabase
            .channel(`bc-my-stuff-${personId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bc_todos' }, () => loadMyStuff({ silent: true }))
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bc_todo_assignees', filter: `person_id=eq.${personId}` }, () => loadMyStuff({ silent: true }))
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bc_documents', filter: `author_person_id=eq.${personId}` }, () => loadMyStuff({ silent: true }))
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bc_comments', filter: `author_person_id=eq.${personId}` }, () => loadMyStuff({ silent: true }))
            .on('postgres_changes', { event: '*', schema: 'public', table: 'bc_schedule_entries' }, () => loadMyStuff({ silent: true }))
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [personId, supabase, loadMyStuff])

    const getEventMonthAndDay = (ev: any) => {
        const raw = String(ev?.starts_at || '')
        if (!raw) return { month: '', day: '' }
        if (ev?.all_day) {
            const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
            if (m) {
                const localNoon = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)
                return {
                    month: localNoon.toLocaleDateString(locale, { month: 'short' }).toUpperCase(),
                    day: String(Number(m[3])),
                }
            }
        }
        const d = new Date(raw)
        if (Number.isNaN(d.getTime())) return { month: '', day: '' }
        return {
            month: d.toLocaleDateString(locale, { month: 'short', timeZone: 'America/Los_Angeles' }).toUpperCase(),
            day: d.toLocaleDateString(locale, { day: 'numeric', timeZone: 'America/Los_Angeles' }),
        }
    }

    return (
        <div className="flex-1 max-w-4xl mx-auto w-full flex flex-col gap-6 sm:gap-8 px-4 sm:px-0 text-left">
            {/* Cabecera de Mi Espacio */}
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        {t('basecamp.my_stuff')}
                    </h2>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-widest mt-0.5 font-semibold">
                        {t('basecamp.my_stuff_sub')}
                    </p>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 text-[#1D7DB5] animate-spin" />
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* 1. MIS ASIGNACIONES */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex flex-col min-h-[300px]">
                        <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-200 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3 mb-4">
                            <ClipboardList size={18} className="text-[#1D7DB5]" />
                            {t('basecamp.my_assignments')}
                        </h3>

                        {myTasks.length > 0 ? (
                            <div className="space-y-3 flex-1 overflow-y-auto max-h-[320px] pr-1 no-scrollbar">
                                {myTasks.map((task) => {
                                    const proj = Array.isArray(task.project) ? task.project[0] : task.project
                                    const tlist = Array.isArray(task.todolist) ? task.todolist[0] : task.todolist
                                    return (
                                        <div
                                            key={task.id}
                                            onClick={() => {
                                                if (proj?.bc_id) {
                                                    navigateTo({ project: String(proj.bc_id), tool: 'todos', todoId: task.id })
                                                }
                                            }}
                                            className="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 hover:border-blue-200/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-all cursor-pointer text-xs"
                                        >
                                            <CheckCircle2 size={16} className={task.is_completed ? 'text-green-500 shrink-0' : 'text-slate-300 dark:text-slate-600 shrink-0'} />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <p className={`font-bold truncate ${task.is_completed ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-200'}`}>
                                                        {task.title}
                                                    </p>
                                                    {task.created_at && (
                                                        <span className="text-[9.5px] font-medium text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded whitespace-nowrap">
                                                            {new Date(task.created_at).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' })} · {new Date(task.created_at).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' })}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 font-semibold">
                                                    {proj?.name || t('basecamp.my_stuff_project')} • {tlist?.name || t('basecamp.my_stuff_list')}
                                                </p>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-12 italic my-auto">
                                {t('basecamp.no_assignments_desc')}
                            </p>
                        )}
                    </div>

                    {/* 2. MI AGENDA / CALENDARIO */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex flex-col min-h-[300px]">
                        <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-200 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3 mb-4">
                            <Calendar size={18} className="text-[#1D7DB5]" />
                            {t('basecamp.my_schedule_title')}
                        </h3>

                        {myEvents.length > 0 ? (
                            <div className="space-y-3 flex-1 overflow-y-auto max-h-[320px] pr-1 no-scrollbar">
                                {myEvents.map((e) => {
                                    const proj = Array.isArray(e.project) ? e.project[0] : e.project
                                    const { month, day } = getEventMonthAndDay(e)
                                    return (
                                        <div
                                            key={e.id}
                                            onClick={() => {
                                                if (proj?.bc_id) {
                                                    navigateTo({ project: String(proj.bc_id), tool: 'schedule' })
                                                }
                                            }}
                                            className="flex items-center gap-3 p-2 rounded-xl border border-slate-100 dark:border-slate-800 hover:border-blue-200/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-all cursor-pointer text-xs"
                                        >
                                            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200/40 dark:border-blue-900/30 w-10 h-10 rounded-lg flex flex-col items-center justify-center shrink-0">
                                                <span className="text-[8px] font-black uppercase text-[#1D7DB5] leading-none mb-0.5">{month}</span>
                                                <span className="text-sm font-extrabold text-slate-800 dark:text-slate-200 leading-none">
                                                    {day}
                                                </span>
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="font-bold text-slate-700 dark:text-slate-300 truncate">{e.title}</p>
                                                <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 font-semibold">
                                                    {proj?.name}
                                                    {e.all_day ? ` • ${t('basecamp.all_day')}` : e.starts_at ? ` • ${new Date(e.starts_at).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' })}` : ''}
                                                </p>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-12 italic my-auto">
                                {t('basecamp.no_schedule_desc')}
                            </p>
                        )}
                    </div>

                    {/* 3. MIS DOCUMENTOS */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex flex-col min-h-[220px]">
                        <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-200 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3 mb-4">
                            <FileText size={18} className="text-[#1D7DB5]" />
                            {t('basecamp.docs_files')}
                        </h3>
                        {myDocs.length > 0 ? (
                            <div className="space-y-2 flex-1 text-xs overflow-y-auto max-h-[160px] no-scrollbar">
                                {myDocs.map((doc) => {
                                    const proj = Array.isArray(doc.project) ? doc.project[0] : doc.project
                                    return (
                                        <div
                                            key={doc.id}
                                            onClick={() => {
                                                if (proj?.bc_id) {
                                                    navigateTo({ project: String(proj.bc_id), tool: 'docs', docId: doc.id })
                                                }
                                            }}
                                            className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-all cursor-pointer"
                                        >
                                            <p className="font-bold text-slate-700 dark:text-slate-300 truncate">{doc.title}</p>
                                            <p className="text-[9px] text-slate-400 mt-1 font-semibold">
                                                {t('basecamp.modified_label')}: {doc.updated_at ? new Date(doc.updated_at).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' }) : ''} • {proj?.name}
                                            </p>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-6 italic my-auto">
                                {t('basecamp.no_docs_desc')}
                            </p>
                        )}
                    </div>

                    {/* 4. MI HISTORIAL DE ACTIVIDAD */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex flex-col min-h-[220px]">
                        <h3 className="text-sm font-extrabold text-slate-800 dark:text-slate-200 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3 mb-4">
                            <History size={18} className="text-[#1D7DB5]" />
                            {t('basecamp.my_activity')}
                        </h3>
                        {myActivity.length > 0 ? (
                            <div className="space-y-3 flex-1 text-xs text-slate-600 dark:text-slate-400 pl-2 overflow-y-auto max-h-[160px] no-scrollbar text-left">
                                {myActivity.map((act) => {
                                    const proj = Array.isArray(act.project) ? act.project[0] : act.project
                                    const tool =
                                        act.parent_type === 'todo'
                                            ? 'todos'
                                            : act.parent_type === 'message'
                                            ? 'messages'
                                            : 'docs'
                                    return (
                                        <div
                                            key={act.id}
                                            onClick={() => {
                                                if (!proj?.bc_id) return
                                                const nav: {
                                                    project: string
                                                    tool: string
                                                    todoId?: string
                                                    messageId?: string
                                                    docId?: string
                                                } = { project: String(proj.bc_id), tool }
                                                if (act.parent_id) {
                                                    if (tool === 'todos') nav.todoId = String(act.parent_id)
                                                    else if (tool === 'messages') nav.messageId = String(act.parent_id)
                                                    else if (tool === 'docs') nav.docId = String(act.parent_id)
                                                }
                                                navigateTo(nav)
                                            }}
                                            className="border-l border-slate-200 dark:border-slate-700 pl-3 relative py-0.5 cursor-pointer hover:opacity-80 transition-opacity"
                                        >
                                            <div className="absolute top-1.5 -left-[4px] w-2 h-2 rounded-full bg-[#1D7DB5]" />
                                            <p className="text-[8px] text-slate-400 font-bold uppercase">
                                                {act.created_at ? `${new Date(act.created_at).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' })} ${new Date(act.created_at).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' })}` : ''}
                                            </p>
                                            <p className="text-slate-700 dark:text-slate-300 mt-0.5">
                                                {act.parent_type === 'todo'
                                                    ? t('basecamp.commented_on_todo')
                                                    : act.parent_type === 'message'
                                                    ? t('basecamp.commented_on_message')
                                                    : t('basecamp.commented_on_document')}{' '}
                                                {t('basecamp.commented_in_project')}{' '}
                                                <strong className="font-extrabold">{proj?.name}</strong>
                                            </p>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-6 italic my-auto">
                                {t('basecamp.no_activity_desc')}
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
