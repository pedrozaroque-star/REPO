/**
 * @module HeyMenu
 * @description Módulo de notificaciones (Hey!) para alertar sobre nuevas actividades en los proyectos.
 *              Conecta directamente con la tabla `bc_notifications` en Supabase.
 *              Limpia el contador de notificaciones no leídas al abrirse y permite navegar directamente al ítem causante.
 * @businessRules
 *   - Mostrar alertas ordenadas cronológicamente con marcas visuales de no leído.
 *   - Proporcionar enlaces rápidos para redirigir al proyecto y herramienta correctos.
 *   - Marcar todas las notificaciones del usuario como leídas al cargar el componente.
 * @dataFlow
 *   - Entrada: Props `navigateTo` y `clearCount`.
 *   - Fetch: Resuelve la persona logueada vía `resolveOrCreateTegPerson` y carga `bc_notifications`.
 *   - Realtime: Escucha cambios en `bc_notifications` para actualizar la bandeja en vivo.
 *   - Escritura: Actualiza `is_read = true` para las notificaciones no leídas de este usuario.
 * @notes
 *   - Soporte multilingüe (ES/EN) con `useLanguage()` y zona horaria `America/Los_Angeles`.
 *   - Resuelve emails con mayúsculas, correos enmascarados (`•`) y variantes de nombre sin errores 406.
 */

'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useLanguage } from '@/lib/i18n'
import { Bell, BellOff, MessageSquare, ClipboardList, FolderOpen, Calendar, HelpCircle, Loader2 } from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { useAuth } from '@/components/ProtectedRoute'
import { resolveOrCreateTegPerson, stripTegAuthorBanner } from '@/lib/basecamp-person-resolver'

interface HeyMenuProps {
    navigateTo: (params: {
        project?: string
        tool?: string
        section?: string
        todoId?: string
        messageId?: string
        docId?: string
    }) => void
    clearCount: () => void
}

function cleanNotificationText(raw?: string | null): string {
    if (!raw) return ''
    const { cleanHtml } = stripTegAuthorBanner(raw)
    return cleanHtml
        .replace(/<bc-attachment[\s\S]*?<\/bc-attachment>/gi, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim()
}

export default function HeyMenu({ navigateTo, clearCount }: HeyMenuProps) {
    const supabase = useMemo(() => getSupabaseWithAuth(), [])
    const { t, language } = useLanguage()
    const locale = language === 'es' ? 'es-MX' : 'en-US'
    const { user: authUser, loading: authLoading } = useAuth()
    const [notifications, setNotifications] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [personId, setPersonId] = useState<string | null>(null)

    const fetchNotifications = useCallback(async (opts?: { silent?: boolean }) => {
        if (!authUser) return
        if (!opts?.silent) setLoading(true)
        try {
            const person = await resolveOrCreateTegPerson(supabase, {
                email: authUser.email,
                name: authUser.name,
                role: (authUser as any)?.role,
            })

            if (person?.id) {
                setPersonId(person.id)

                const { data: dbNotifs, error } = await supabase
                    .from('bc_notifications')
                    .select(`
                        *,
                        project:bc_projects(bc_id, name)
                    `)
                    .eq('person_id', person.id)
                    .order('created_at', { ascending: false })
                    .limit(50)

                if (error) throw error
                setNotifications(dbNotifs || [])

                const unreadIds = (dbNotifs || []).filter((n: any) => !n.is_read).map((n: any) => n.id)
                if (unreadIds.length > 0) {
                    await supabase
                        .from('bc_notifications')
                        .update({ is_read: true })
                        .in('id', unreadIds)
                }

                clearCount()
            } else {
                setNotifications([])
            }
        } catch (err: any) {
            console.error('❌ [HeyMenu Fetch] Error:', err.message)
        } finally {
            if (!opts?.silent) setLoading(false)
        }
    }, [authUser, supabase, clearCount])

    useEffect(() => {
        if (!authLoading && authUser) {
            fetchNotifications()
        } else if (!authLoading && !authUser) {
            setLoading(false)
        }
    }, [authUser, authLoading, fetchNotifications])

    useEffect(() => {
        if (!personId) return
        const channel = supabase
            .channel(`bc-hey-menu-${personId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'bc_notifications',
                    filter: `person_id=eq.${personId}`,
                },
                () => {
                    fetchNotifications({ silent: true })
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [personId, supabase, fetchNotifications])

    const getIcon = (recordingType: string | null) => {
        const rt = (recordingType || '').toLowerCase()
        if (rt.includes('todo') || rt.includes('list')) {
            return <ClipboardList size={16} className="text-purple-500" />
        }
        if (rt.includes('message') || rt.includes('board') || rt.includes('campfire') || rt.includes('chat')) {
            return <MessageSquare size={16} className="text-blue-500" />
        }
        if (rt.includes('doc') || rt.includes('file') || rt.includes('upload')) {
            return <FolderOpen size={16} className="text-green-500" />
        }
        if (rt.includes('schedule') || rt.includes('event') || rt.includes('calendar')) {
            return <Calendar size={16} className="text-red-500" />
        }
        if (rt.includes('question') || rt.includes('answer') || rt.includes('checkin')) {
            return <HelpCircle size={16} className="text-sky-500" />
        }
        return <Bell size={16} className="text-slate-400" />
    }

    const getToolName = (recordingType: string | null) => {
        if (!recordingType) return undefined
        const rt = recordingType.toLowerCase()
        if (rt.includes('todo') || rt.includes('list')) return 'todos'
        if (rt.includes('message') || rt.includes('board')) return 'messages'
        if (rt.includes('chat') || rt.includes('campfire')) return 'campfire'
        if (rt.includes('document') || rt.includes('doc') || rt.includes('file') || rt.includes('upload')) return 'docs'
        if (rt.includes('schedule') || rt.includes('event') || rt.includes('calendar')) return 'schedule'
        if (rt.includes('checkin') || rt.includes('question') || rt.includes('answer')) return 'checkins'
        return undefined
    }

    const formatNotifDateTime = (dateStr?: string | null) => {
        if (!dateStr) return ''
        const d = new Date(dateStr)
        if (Number.isNaN(d.getTime())) return ''
        const datePart = d.toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
            timeZone: 'America/Los_Angeles',
        })
        const timePart = d.toLocaleTimeString(locale, {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: 'America/Los_Angeles',
        })
        return `${datePart} · ${timePart}`
    }

    return (
        <div className="flex-1 max-w-2xl mx-auto w-full flex flex-col gap-6 text-left">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <h2 className="text-lg font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <Bell size={20} className="text-[#1D7DB5]" />
                    {t('basecamp.hey')}
                </h2>
                <span className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                    {t('basecamp.hey_sub')}
                </span>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 text-[#1D7DB5] animate-spin" />
                </div>
            ) : notifications.length > 0 ? (
                <div className="space-y-4">
                    {notifications.map((n) => {
                        const tool = getToolName(n.recording_type)
                        const proj = Array.isArray(n.project) ? n.project[0] : n.project
                        const projectBcId = proj?.bc_id ? String(proj.bc_id) : undefined
                        const cleanDesc = cleanNotificationText(n.description)

                        return (
                            <div
                                key={n.id}
                                onClick={() => {
                                    if (!tool || !projectBcId) return
                                    const navParams: {
                                        project: string
                                        tool: string
                                        todoId?: string
                                        messageId?: string
                                        docId?: string
                                    } = { project: projectBcId, tool }
                                    if (n.recording_id) {
                                        if (tool === 'todos') navParams.todoId = String(n.recording_id)
                                        else if (tool === 'messages') navParams.messageId = String(n.recording_id)
                                        else if (tool === 'docs') navParams.docId = String(n.recording_id)
                                    }
                                    navigateTo(navParams)
                                }}
                                className={`flex gap-4 p-4 rounded-2xl border transition-all cursor-pointer hover:shadow-md hover:bg-slate-50/50 dark:hover:bg-slate-800/40 relative ${
                                    !n.is_read
                                        ? 'bg-blue-50/30 border-blue-200/60 dark:bg-blue-950/10 dark:border-blue-900/30'
                                        : 'bg-white border-slate-200/50 dark:bg-slate-900 dark:border-slate-800'
                                }`}
                            >
                                {!n.is_read && (
                                    <span className="absolute top-4 right-4 w-2 h-2 rounded-full bg-red-500" />
                                )}

                                <div className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center shadow-sm shrink-0 border border-slate-200/30 dark:border-slate-700/50">
                                    {getIcon(n.recording_type)}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline justify-between gap-2 mb-1">
                                        <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{n.title}</h4>
                                        <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 font-medium">
                                            {formatNotifDateTime(n.created_at)}
                                        </span>
                                    </div>
                                    {cleanDesc && (
                                        <p className="text-xs text-slate-600 dark:text-slate-400 pr-4">
                                            {cleanDesc}
                                        </p>
                                    )}
                                    {proj?.name && (
                                        <span className="inline-block mt-2 text-[9px] font-black text-[#1D7DB5] dark:text-blue-400 uppercase tracking-widest bg-blue-50/50 dark:bg-blue-950/30 px-2 py-0.5 rounded border border-blue-100/40 dark:border-blue-900/20">
                                            {proj.name}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            ) : (
                <div className="text-center py-12 flex flex-col items-center justify-center">
                    <BellOff size={48} className="text-slate-300 dark:text-slate-700 mb-3" />
                    <h3 className="text-sm font-extrabold text-slate-700 dark:text-slate-300 mb-1">
                        {t('basecamp.all_caught_up_title')}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        {t('basecamp.all_caught_up_desc')}
                    </p>
                </div>
            )}
        </div>
    )
}
