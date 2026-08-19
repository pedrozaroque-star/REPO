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
 *   - Fetch: Carga notificaciones de `bc_notifications` correspondientes a la persona logueada.
 *   - Escritura: Actualiza `is_read = true` para todas las notificaciones de este usuario.
 * @notes
 *   - Soporte multilingüe (ES/EN) con useLanguage.
 *   - Standalone: Las notificaciones se registran localmente en Supabase de forma autónoma.
 */

'use client'

import React, { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n'
import { Bell, BellOff, MessageSquare, ClipboardList, FolderOpen, Calendar, HelpCircle, Loader2 } from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { useAuth } from '@/components/ProtectedRoute'

interface HeyMenuProps {
    navigateTo: (params: { project?: string; tool?: string; section?: string }) => void
    clearCount: () => void
}

export default function HeyMenu({ navigateTo, clearCount }: HeyMenuProps) {
    const supabase = getSupabaseWithAuth()
    const { t } = useLanguage()
    const { user: authUser, loading: authLoading } = useAuth()
    const [notifications, setNotifications] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    const fetchNotifications = async () => {
        if (!authUser) return
        setLoading(true)
        try {
            // Fetch corresponding person record using authUser email from localStorage
            const { data: person } = await supabase
                .from('bc_people')
                .select('id')
                .eq('email', authUser.email || '')
                .limit(1)
                .single()

            if (person) {
                // Fetch notifications
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

                // Mark all as read in Supabase
                const unreadIds = dbNotifs?.filter(n => !n.is_read).map(n => n.id) || []
                if (unreadIds.length > 0) {
                    await supabase
                        .from('bc_notifications')
                        .update({ is_read: true })
                        .in('id', unreadIds)
                }

                // Clear parent header count
                clearCount()
            }
        } catch (err: any) {
            console.error('❌ [HeyMenu Fetch] Error:', err.message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (!authLoading && authUser) fetchNotifications()
    }, [authUser, authLoading])

    const getIcon = (recordingType: string | null) => {
        switch (recordingType) {
            case 'todo':
                return <ClipboardList size={16} className="text-purple-500" />
            case 'message':
                return <MessageSquare size={16} className="text-blue-500" />
            case 'campfire':
                return <MessageSquare size={16} className="text-blue-500" />
            case 'document':
                return <FolderOpen size={16} className="text-green-500" />
            case 'schedule':
                return <Calendar size={16} className="text-red-500" />
            case 'question':
            case 'answer':
                return <HelpCircle size={16} className="text-sky-500" />
            default:
                return <Bell size={16} className="text-slate-400" />
        }
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

    return (
        <div className="flex-1 max-w-2xl mx-auto w-full flex flex-col gap-6 text-left">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <h2 className="text-lg font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <Bell size={20} className="text-[#1D7DB5]" />
                    {t('basecamp.hey')}
                </h2>
                <span className="text-xs text-slate-455 dark:text-slate-500 uppercase tracking-widest">
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
                        const projectBcId = n.project?.bc_id ? String(n.project.bc_id) : undefined

                        return (
                            <div
                                key={n.id}
                                onClick={() => tool && projectBcId && navigateTo({ project: projectBcId, tool })}
                                className={`flex gap-4 p-4 rounded-2xl border transition-all cursor-pointer hover:shadow-md hover:bg-slate-50/50 dark:hover:bg-slate-800/40 relative ${
                                    !n.is_read
                                        ? 'bg-blue-50/30 border-blue-200/60 dark:bg-blue-950/5 dark:border-blue-900/20'
                                        : 'bg-white border-slate-200/50 dark:bg-slate-900 dark:border-slate-800'
                                }`}
                            >
                                {/* Punto de no leído */}
                                {!n.is_read && (
                                    <span className="absolute top-4 right-4 w-2 h-2 rounded-full bg-red-500" />
                                )}

                                {/* Icono de herramienta */}
                                <div className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-slate-850 flex items-center justify-center shadow-sm shrink-0 border border-slate-200/30 dark:border-slate-800/30">
                                    {getIcon(n.recording_type)}
                                </div>

                                {/* Información detallada */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline justify-between mb-1">
                                        <h4 className="text-xs font-bold text-slate-850 dark:text-slate-100">{n.title}</h4>
                                        <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 font-medium">
                                            {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-600 dark:text-slate-400 pr-4">
                                        {n.description}
                                    </p>
                                    {n.project?.name && (
                                        <span className="inline-block mt-2 text-[9px] font-black text-[#1D7DB5] dark:text-blue-400 uppercase tracking-widest bg-blue-50/50 dark:bg-blue-950/30 px-2 py-0.5 rounded border border-blue-100/40 dark:border-blue-900/20">
                                            {n.project.name}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            ) : (
                <div className="text-center py-12 flex flex-col items-center justify-center">
                    <BellOff size={48} className="text-slate-300 dark:text-slate-750 mb-3" />
                    <h3 className="text-sm font-extrabold text-slate-700 dark:text-slate-300 mb-1">
                        {t('basecamp.all_caught_up_title')}
                    </h3>
                    <p className="text-xs text-slate-450 dark:text-slate-500">
                        {t('basecamp.all_caught_up_desc')}
                    </p>
                </div>
            )}
        </div>
    )
}
