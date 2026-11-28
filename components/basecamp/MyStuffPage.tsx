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
 *   - Privacidad estricta por proyecto (`bc_memberships` / `allowedProjectIds`): filtra asignaciones, documentos, calendario y actividad para que usuarios no-admin solo vean proyectos autorizados.
 *   - Rediseño Móvil + Web (2026-11-28): tarjetas limpias `min-w-0`, títulos `line-clamp-2` sin truncamiento agresivo y extractos HTML enriquecidos usando `BASECAMP_RICH_CONTENT_CSS` + `formatBasecampRichHtmlForDisplay`.
 */

'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useLanguage } from '@/lib/i18n'
import { ClipboardList, Calendar, History, FileText, CheckCircle2 } from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { useAuth } from '@/components/ProtectedRoute'
import {
    resolveOrCreateTegPerson,
    canonicalizeBasecampEmail,
    canonicalizeBasecampDisplayName,
    stripTegAuthorBanner,
} from '@/lib/basecamp-person-resolver'
import {
    BASECAMP_RICH_CONTENT_CSS,
    BASECAMP_IMAGE_HOVER_CSS,
    formatBasecampRichHtmlForDisplay,
    rewriteBasecampHtmlUrls,
    transformBasecampMentionsToPills,
    sanitizeBasecampHtml,
} from '@/lib/basecamp-html'

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
    allowedProjectIds?: string[]
    isAdmin?: boolean
}

function getPacificTodayYMD(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date())
}

export default function MyStuffPage({
    navigateTo,
    currentUserName,
    allowedProjectIds,
    isAdmin = false,
}: MyStuffPageProps) {
    const supabase = useMemo(() => getSupabaseWithAuth(), [])
    const { t, language } = useLanguage()
    const locale = language === 'es' ? 'es-MX' : 'en-US'
    const { user, loading: authLoading } = useAuth()
    const effectiveIsAdmin = Boolean(
        isAdmin || ['admin', 'administrador'].includes(String((user as any)?.role || '').trim().toLowerCase())
    )
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
                email: canonicalizeBasecampEmail(user.email),
                name: canonicalizeBasecampDisplayName(user.name || currentUserName, user.email),
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
                        id, title, is_completed, created_at, updated_at, project_id,
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
                        id, title, updated_at, project_id,
                        project:bc_projects(bc_id, name)
                    `)
                    .eq('author_person_id', resolvedId)
                    .order('updated_at', { ascending: false })
                    .limit(10),
                supabase
                    .from('bc_comments')
                    .select(`
                        id, content, created_at, parent_type, parent_id, project_id,
                        project:bc_projects(bc_id, name)
                    `)
                    .eq('author_person_id', resolvedId)
                    .order('created_at', { ascending: false })
                    .limit(10),
            ])

            const rawMemberIds: string[] = membershipsRes.data?.map((m: any) => m.project_id).filter(Boolean) || []
            const passedSet = Array.isArray(allowedProjectIds) ? new Set(allowedProjectIds) : null
            const userProjectIds: string[] = effectiveIsAdmin
                ? Array.isArray(allowedProjectIds) && allowedProjectIds.length > 0
                    ? allowedProjectIds
                    : rawMemberIds
                : passedSet
                    ? rawMemberIds.filter((id) => passedSet.has(id))
                    : rawMemberIds
            const allowedSet = new Set<string>(userProjectIds)

            setMyTasks(
                (tasksRes.data || []).filter((r: any) => effectiveIsAdmin || (r.project_id && allowedSet.has(r.project_id)))
            )
            setMyDocs(
                (docsRes.data || []).filter((r: any) => effectiveIsAdmin || (r.project_id && allowedSet.has(r.project_id)))
            )
            setMyActivity(
                (commsRes.data || []).filter((r: any) => effectiveIsAdmin || (r.project_id && allowedSet.has(r.project_id)))
            )

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
    }, [user, currentUserName, supabase, effectiveIsAdmin, allowedProjectIds])

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
        <div className="flex-1 max-w-5xl mx-auto w-full flex flex-col gap-4 sm:gap-6 px-0 sm:px-1 min-w-0 text-left">
            <style dangerouslySetInnerHTML={{ __html: `${BASECAMP_RICH_CONTENT_CSS}\n${BASECAMP_IMAGE_HOVER_CSS}` }} />
            {/* Cabecera de Mi Espacio */}
            <div className="border-b border-slate-200/80 dark:border-slate-800 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 min-w-0">
                <div className="min-w-0">
                    <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-slate-50 tracking-tight flex items-center gap-2">
                        {t('basecamp.my_stuff')}
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-widest mt-0.5 font-semibold">
                        {t('basecamp.my_stuff_sub')}
                    </p>
                </div>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 min-w-0" aria-busy="true">
                    {[0, 1, 2, 3].map((idx) => (
                        <div
                            key={idx}
                            className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 rounded-2xl shadow-xs space-y-3 min-h-[220px]"
                        >
                            <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                                <div className="w-7 h-7 rounded-lg animate-pulse bg-slate-100 dark:bg-slate-800" />
                                <div className="h-4 w-36 rounded animate-pulse bg-slate-100 dark:bg-slate-800" />
                            </div>
                            <div className="space-y-2.5 pt-1">
                                <div className="h-3.5 w-4/5 rounded animate-pulse bg-slate-100 dark:bg-slate-800" />
                                <div className="h-3 w-3/5 rounded animate-pulse bg-slate-100/70 dark:bg-slate-800/70" />
                                <div className="h-3.5 w-3/4 rounded animate-pulse bg-slate-100 dark:bg-slate-800" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 min-w-0">
                    {/* 1. MIS ASIGNACIONES */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 rounded-2xl shadow-xs flex flex-col min-h-[260px] min-w-0 overflow-hidden">
                        <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3 mb-3.5 min-w-0">
                            <span className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                                <ClipboardList size={15} />
                            </span>
                            <span className="truncate">{t('basecamp.my_assignments')}</span>
                            <span className="ml-auto text-[11px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full shrink-0">
                                {myTasks.length}
                            </span>
                        </h3>

                        {myTasks.length > 0 ? (
                            <div className="space-y-2.5 flex-1 overflow-y-auto max-h-[320px] pr-1 no-scrollbar min-w-0">
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
                                            className="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-all cursor-pointer text-xs min-w-0"
                                        >
                                            <CheckCircle2 size={16} className={`mt-0.5 shrink-0 ${task.is_completed ? 'text-emerald-500' : 'text-slate-300 dark:text-slate-600'}`} />
                                            <div className="min-w-0 flex-1">
                                                <p className={`font-bold leading-snug line-clamp-2 break-words ${task.is_completed ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-100'}`}>
                                                    {task.title}
                                                </p>
                                                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                                                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold truncate max-w-[200px]">
                                                        {proj?.name || t('basecamp.my_stuff_project')} · {tlist?.name || t('basecamp.my_stuff_list')}
                                                    </span>
                                                    {task.created_at && (
                                                        <span className="text-[9.5px] font-medium text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded whitespace-nowrap">
                                                            {new Date(task.created_at).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' })}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-10 italic my-auto">
                                {t('basecamp.no_assignments_desc')}
                            </p>
                        )}
                    </div>

                    {/* 2. MI AGENDA / CALENDARIO */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 rounded-2xl shadow-xs flex flex-col min-h-[260px] min-w-0 overflow-hidden">
                        <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3 mb-3.5 min-w-0">
                            <span className="w-7 h-7 rounded-lg bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                                <Calendar size={15} />
                            </span>
                            <span className="truncate">{t('basecamp.my_schedule_title')}</span>
                            <span className="ml-auto text-[11px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full shrink-0">
                                {myEvents.length}
                            </span>
                        </h3>

                        {myEvents.length > 0 ? (
                            <div className="space-y-2.5 flex-1 overflow-y-auto max-h-[320px] pr-1 no-scrollbar min-w-0">
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
                                            className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-all cursor-pointer text-xs min-w-0"
                                        >
                                            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200/50 dark:border-blue-900/40 w-10 h-10 rounded-lg flex flex-col items-center justify-center shrink-0">
                                                <span className="text-[8px] font-black uppercase text-[#1D7DB5] dark:text-sky-400 leading-none mb-0.5">{month}</span>
                                                <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100 leading-none">
                                                    {day}
                                                </span>
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="font-bold text-slate-800 dark:text-slate-200 line-clamp-2 break-words leading-snug">{e.title}</p>
                                                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 font-medium truncate">
                                                    {proj?.name}
                                                    {e.all_day ? ` · ${t('basecamp.all_day')}` : e.starts_at ? ` · ${new Date(e.starts_at).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' })}` : ''}
                                                </p>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-10 italic my-auto">
                                {t('basecamp.no_schedule_desc')}
                            </p>
                        )}
                    </div>

                    {/* 3. MIS DOCUMENTOS */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 rounded-2xl shadow-xs flex flex-col min-h-[220px] min-w-0 overflow-hidden">
                        <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3 mb-3.5 min-w-0">
                            <span className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                                <FileText size={15} />
                            </span>
                            <span className="truncate">{t('basecamp.docs_files')}</span>
                            <span className="ml-auto text-[11px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full shrink-0">
                                {myDocs.length}
                            </span>
                        </h3>
                        {myDocs.length > 0 ? (
                            <div className="space-y-2 flex-1 text-xs overflow-y-auto max-h-[180px] no-scrollbar min-w-0">
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
                                            className="p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-all cursor-pointer min-w-0"
                                        >
                                            <p className="font-bold text-slate-800 dark:text-slate-200 line-clamp-2 break-words leading-snug">{doc.title}</p>
                                            <p className="text-[10px] text-slate-400 mt-1 font-medium truncate">
                                                {t('basecamp.modified_label')}: {doc.updated_at ? new Date(doc.updated_at).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' }) : ''} · {proj?.name}
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
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 rounded-2xl shadow-xs flex flex-col min-h-[220px] min-w-0 overflow-hidden">
                        <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3 mb-3.5 min-w-0">
                            <span className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-[#1D7DB5] dark:text-sky-400 flex items-center justify-center shrink-0">
                                <History size={15} />
                            </span>
                            <span className="truncate">{t('basecamp.my_activity')}</span>
                            <span className="ml-auto text-[11px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full shrink-0">
                                {myActivity.length}
                            </span>
                        </h3>
                        {myActivity.length > 0 ? (
                            <div className="space-y-3 flex-1 text-xs text-slate-600 dark:text-slate-400 pl-2 overflow-y-auto max-h-[180px] no-scrollbar text-left min-w-0">
                                {myActivity.map((act) => {
                                    const proj = Array.isArray(act.project) ? act.project[0] : act.project
                                    const tool =
                                        act.parent_type === 'todo'
                                            ? 'todos'
                                            : act.parent_type === 'message'
                                            ? 'messages'
                                            : 'docs'
                                    const { cleanHtml } = stripTegAuthorBanner(act.content || '')
                                    const formattedHtml = cleanHtml
                                        ? formatBasecampRichHtmlForDisplay(
                                              sanitizeBasecampHtml(
                                                  transformBasecampMentionsToPills(rewriteBasecampHtmlUrls(cleanHtml))
                                              )
                                          )
                                        : ''
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
                                            className="border-l border-slate-200 dark:border-slate-700 pl-3 relative py-0.5 cursor-pointer hover:opacity-85 transition-opacity min-w-0"
                                        >
                                            <div className="absolute top-1.5 -left-[4px] w-2 h-2 rounded-full bg-[#1D7DB5]" />
                                            <p className="text-[9px] text-slate-400 font-bold uppercase">
                                                {act.created_at ? `${new Date(act.created_at).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' })} ${new Date(act.created_at).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' })}` : ''}
                                            </p>
                                            <p className="text-slate-700 dark:text-slate-300 mt-0.5 break-words">
                                                {act.parent_type === 'todo'
                                                    ? t('basecamp.commented_on_todo')
                                                    : act.parent_type === 'message'
                                                    ? t('basecamp.commented_on_message')
                                                    : t('basecamp.commented_on_document')}{' '}
                                                {t('basecamp.commented_in_project')}{' '}
                                                <strong className="font-extrabold text-slate-900 dark:text-slate-100">{proj?.name}</strong>
                                            </p>
                                            {formattedHtml && (
                                                <div
                                                    className="bc-rich-text text-xs! leading-snug! text-slate-500 dark:text-slate-400 mt-1 max-h-12 overflow-hidden pointer-events-none"
                                                    dangerouslySetInnerHTML={{ __html: formattedHtml }}
                                                />
                                            )}
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
