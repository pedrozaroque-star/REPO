/**
 * @module NewForYouDrawer
 * @description Panel lateral derecho de notificaciones (Hey!) y Pings para el emulador de Basecamp.
 *              Réplica exacta del menú lateral "New for you" del Basecamp original.
 * @businessRules
 *   - Permite iniciar pings (mensajes directos) con colaboradores.
 *   - Muestra notificaciones no leídas de bc_notifications con estados visuales claros (puntos naranjas/rojos).
 *   - Permite filtrar notificaciones en tiempo real con la caja de búsqueda inferior.
 *   - Permite marcar todas las notificaciones como leídas con un solo click.
 * @dataFlow
 *   - Entrada: Props isOpen, onClose, navigateTo.
 *   - Fetch: Carga notificaciones de bc_notifications y colaboradores de bc_people en Supabase.
 *   - Escritura: Actualiza la tabla bc_notifications al marcar como leídas.
 * @notes
 *   - Soporte bilingüe completo (ES/EN).
 *   - Utiliza framer-motion para transiciones suaves de entrada y salida lateral.
 */

'use client'

import React, { useState, useEffect } from 'react'
import { useLanguage } from '@/lib/i18n'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { useAuth } from '@/components/ProtectedRoute'
import { motion, AnimatePresence } from 'framer-motion'
import {
    Plus, Bell, CheckCircle2, MessageSquare, FileText, Calendar,
    HelpCircle, Search, X, Loader2, VolumeX, BellOff
} from 'lucide-react'

interface NewForYouDrawerProps {
    isOpen: boolean
    onClose: () => void
    navigateTo: (params: { project?: string; tool?: string; section?: string; ping?: string }) => void
}

export default function NewForYouDrawer({ isOpen, onClose, navigateTo }: NewForYouDrawerProps) {
    const supabase = getSupabaseWithAuth()
    const { t } = useLanguage()
    const { user: authUser, loading: authLoading } = useAuth()

    const [notifications, setNotifications] = useState<any[]>([])
    const [collaborators, setCollaborators] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [filterQuery, setFilterQuery] = useState('')
    const [isSnoozed, setIsSnoozed] = useState(false)
    const [showPingSelect, setShowPingSelect] = useState(false)

    // Load data — builds a dynamic activity feed from REAL Supabase data
    // Shows: tasks assigned to user, comments on user's tasks, messages in user's projects, recently completed tasks
    const loadDrawerData = async () => {
        if (!authUser) return
        try {
            // 1. Resolve current user in bc_people (try email, then name fallback)
            let personId: string | null = null
            const { data: personByEmail } = await supabase
                .from('bc_people')
                .select('id')
                .ilike('email', authUser.email || '')
                .limit(1)
                .single()

            if (personByEmail) {
                personId = personByEmail.id
            } else if (authUser.name) {
                const { data: personByName } = await supabase
                    .from('bc_people')
                    .select('id')
                    .ilike('name', `%${authUser.name}%`)
                    .limit(1)
                    .single()
                if (personByName) personId = personByName.id
            }

            const feedItems: any[] = []

            if (personId) {
                // Parallelize independent queries: memberships, myTasks, and people
                const thirtyDaysAgo = new Date()
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

                const [membershipsRes, myTasksRes, peopleRes] = await Promise.all([
                    supabase.from('bc_memberships').select('project_id').eq('person_id', personId),
                    supabase.from('bc_todo_assignees').select(`
                        todo:bc_todos(id, title, is_completed, updated_at, project_id,
                            project:bc_projects(bc_id, name)
                        )
                    `).eq('person_id', personId).limit(20),
                    supabase.from('bc_people').select('*').eq('is_active', true).order('name', { ascending: true })
                ])

                const myProjectIds = membershipsRes.data?.map(m => m.project_id) || []
                const myTasks = myTasksRes.data
                setCollaborators(peopleRes.data || [])

                if (myTasks) {
                    for (const row of myTasks) {
                        const todo = (row as any).todo
                        if (!todo || !todo.updated_at) continue
                        feedItems.push({
                            id: `todo-${todo.id}`,
                            type: 'todo',
                            title: todo.title,
                            description: todo.is_completed
                                ? t('basecamp.task_completed_notif')
                                : t('basecamp.task_assigned_notif'),
                            project: todo.project,
                            created_at: todo.updated_at,
                            is_read: todo.is_completed ? true : false,
                        })
                    }
                }

                if (myProjectIds.length > 0) {
                    const sevenDaysAgo = new Date()
                    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

                    // Parallelize recentComments and recentMessages
                    const [recentCommentsRes, recentMessagesRes] = await Promise.all([
                        supabase.from('bc_comments').select(`
                            id, content, created_at, parent_type,
                            author:bc_people(name),
                            project:bc_projects(bc_id, name)
                        `).in('project_id', myProjectIds).gte('created_at', sevenDaysAgo.toISOString()).order('created_at', { ascending: false }).limit(15),
                        supabase.from('bc_messages').select(`
                            id, title, created_at, comments_count,
                            author:bc_people(name),
                            project:bc_projects(bc_id, name)
                        `).in('project_id', myProjectIds).gte('created_at', sevenDaysAgo.toISOString()).order('created_at', { ascending: false }).limit(10)
                    ])

                    if (recentCommentsRes.data) {
                        for (const c of recentCommentsRes.data) {
                            const authorName = (Array.isArray(c.author) ? (c.author as any)[0]?.name : (c.author as any)?.name) || '?'
                            const plainText = (c.content || '').replace(/<[^>]*>/g, '').slice(0, 80)
                            feedItems.push({
                                id: `comment-${c.id}`,
                                type: c.parent_type === 'message' ? 'message' : 'todo',
                                title: `💬 ${authorName}`,
                                description: plainText || t('basecamp.new_comment_notif'),
                                project: c.project,
                                created_at: c.created_at,
                                is_read: false,
                            })
                        }
                    }

                    if (recentMessagesRes.data) {
                        for (const m of recentMessagesRes.data) {
                            const authorName = (Array.isArray(m.author) ? (m.author as any)[0]?.name : (m.author as any)?.name) || '?'
                            feedItems.push({
                                id: `msg-${m.id}`,
                                type: 'message',
                                title: m.title || t('basecamp.new_msg_notif'),
                                description: `📢 ${authorName}${m.comments_count ? ` · ${m.comments_count} 💬` : ''}`,
                                project: m.project,
                                created_at: m.created_at,
                                is_read: false,
                            })
                        }
                    }
                }
            } else {
                // If no personId, still fetch people
                const { data: people } = await supabase.from('bc_people').select('*').eq('is_active', true).order('name', { ascending: true })
                setCollaborators(people || [])
            }

            // Sort all feed items by date descending, dedupe, and limit to 40
            feedItems.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            const uniqueItems = feedItems.filter((item, idx, arr) => arr.findIndex(i => i.id === item.id) === idx).slice(0, 40)
            setNotifications(uniqueItems)
        } catch (err: any) {
            console.error('Error loading drawer data:', err.message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (isOpen && !authLoading && authUser) {
            loadDrawerData()
        }
    }, [isOpen, authUser, authLoading])

    // Mark all as read — just clears the visual state (feed is dynamic, not stored)
    const handleMarkAllRead = async () => {
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    }

    const getIcon = (type: string | null) => {
        switch (type) {
            case 'todo':
                return <CheckCircle2 size={16} className="text-green-500 shrink-0" />
            case 'message':
            case 'campfire':
                return <MessageSquare size={16} className="text-blue-500 shrink-0" />
            case 'document':
                return <FileText size={16} className="text-green-600 shrink-0" />
            case 'schedule':
                return <Calendar size={16} className="text-red-500 shrink-0" />
            default:
                return <Bell size={16} className="text-slate-400 shrink-0" />
        }
    }

    const getToolName = (type: string | null) => {
        if (!type) return undefined
        const t = type.toLowerCase()
        if (t.includes('todo') || t.includes('list')) return 'todos'
        if (t.includes('message') || t.includes('board')) return 'messages'
        if (t.includes('chat') || t.includes('campfire')) return 'campfire'
        if (t.includes('document') || t.includes('doc') || t.includes('file') || t.includes('upload')) return 'docs'
        if (t.includes('schedule') || t.includes('event') || t.includes('calendar')) return 'schedule'
        if (t.includes('checkin') || t.includes('question') || t.includes('answer')) return 'checkins'
        return undefined
    }

    // Filter notifications
    const filteredNotifications = notifications.filter(n => {
        if (!filterQuery) return true
        const q = filterQuery.toLowerCase()
        return (
            (n.title && n.title.toLowerCase().includes(q)) ||
            (n.description && n.description.toLowerCase().includes(q)) ||
            (n.project?.name && n.project.name.toLowerCase().includes(q))
        )
    })

    const filteredCollaborators = collaborators.filter(c => {
        if (c.email === authUser?.email) return false
        if (!filterQuery) return true
        const q = filterQuery.toLowerCase()
        return (
            c.name.toLowerCase().includes(q) ||
            (c.email && c.email.toLowerCase().includes(q))
        )
    })

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
                    />

                    {/* Drawer container */}
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 220 }}
                        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[380px] bg-[#f4f7f6] dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col font-sans"
                    >
                        {/* Header: Pings */}
                        <div className="p-4 border-b border-slate-200/60 dark:border-slate-800">
                            <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">
                                Pings
                            </h3>

                            {/* Yellow helper sticky-note box */}
                            <div className="bg-[#fffccf] border border-[#f0ea99] text-slate-700 p-3 rounded-lg text-[10px] leading-relaxed mb-4 shadow-sm text-left">
                                {t('basecamp.pings_helper_note')}
                            </div>

                            {/* Horizontal actions list */}
                            <div className="flex gap-4 items-center">
                                <button
                                    onClick={() => setShowPingSelect(!showPingSelect)}
                                    className="flex flex-col items-center gap-1 group focus:outline-none"
                                >
                                    <div className="w-10 h-10 rounded-full border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 flex items-center justify-center text-slate-400 group-hover:text-blue-500 transition-colors bg-white dark:bg-slate-800">
                                        <Plus size={18} />
                                    </div>
                                    <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400">Ping</span>
                                </button>

                                {/* Collaborator quick list */}
                                <div className="flex -space-x-1.5 overflow-hidden">
                                    {collaborators.filter(c => c.email !== authUser?.email).slice(0, 4).map((c, i) => (
                                        <button
                                            key={c.id}
                                            onClick={() => {
                                                navigateTo({ section: 'pings', ping: c.name })
                                                onClose()
                                            }}
                                            className="w-10 h-10 rounded-full bg-blue-500 text-white font-extrabold border-2 border-[#f4f7f6] dark:border-slate-900 flex items-center justify-center text-[10px] uppercase shadow-sm hover:-translate-y-0.5 transition-transform"
                                            title={c.name}
                                        >
                                            {c.name[0]}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Dropdown search for ping collaborators */}
                            {showPingSelect && (
                                <div className="mt-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2 max-h-[160px] overflow-y-auto shadow-lg text-left no-scrollbar">
                                    <p className="text-[9px] font-black text-slate-400 uppercase mb-2 px-2">
                                        {t('basecamp.start_chat_with')}
                                    </p>
                                    {collaborators.filter(c => c.email !== authUser?.email).map(c => (
                                        <button
                                            key={c.id}
                                            onClick={() => {
                                                navigateTo({ section: 'pings', ping: c.name })
                                                setShowPingSelect(false)
                                                onClose()
                                            }}
                                            className="w-full text-xs font-bold text-slate-700 dark:text-slate-300 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 text-left block truncate"
                                        >
                                            {c.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Mid Section: New For You (Notifications) */}
                        <div className="flex-1 overflow-y-auto p-4 flex flex-col no-scrollbar">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                                    {t('basecamp.new_for_you_title')}
                                </h3>
                                <button
                                    onClick={handleMarkAllRead}
                                    className="text-[10px] font-bold text-[#1D7DB5] hover:underline"
                                >
                                    {t('basecamp.mark_all_read')}
                                </button>
                            </div>

                            {loading ? (
                                <div className="flex-1 flex items-center justify-center">
                                    <Loader2 className="w-6 h-6 text-[#1D7DB5] animate-spin" />
                                </div>
                            ) : filteredNotifications.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 text-center py-12">
                                    <BellOff size={32} className="mb-2 opacity-50" />
                                    <p className="text-xs italic">{t('basecamp.no_new_activity')}</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {filteredNotifications.map((n) => {
                                        const tool = getToolName(n.type)
                                        const projectBcId = n.project?.bc_id ? String(n.project.bc_id) : undefined

                                        return (
                                            <div
                                                key={n.id}
                                                onClick={() => {
                                                    if (tool && projectBcId) {
                                                        navigateTo({ project: projectBcId, tool })
                                                        onClose()
                                                    }
                                                }}
                                                className={`flex gap-3 p-3 rounded-xl border transition-all cursor-pointer hover:bg-white dark:hover:bg-slate-800 hover:shadow-sm relative text-left ${
                                                    !n.is_read
                                                        ? 'bg-orange-50/20 border-orange-200/50 dark:bg-orange-950/5 dark:border-orange-900/10'
                                                        : 'bg-slate-100/50 border-transparent dark:bg-slate-800/30'
                                                }`}
                                            >
                                                {/* Unread badge dot */}
                                                {!n.is_read && (
                                                    <span className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-orange-500" />
                                                )}

                                                <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-800 flex items-center justify-center shadow-inner shrink-0 border border-slate-200/40">
                                                    {getIcon(n.type)}
                                                </div>

                                                <div className="flex-1 min-w-0 text-xs">
                                                    <h4 className="font-bold text-slate-800 dark:text-slate-150 truncate leading-tight pr-4">
                                                        {n.title}
                                                    </h4>
                                                    <p className="text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">
                                                        {n.description}
                                                    </p>
                                                    <div className="flex items-center gap-1.5 mt-2">
                                                        {n.project?.name && (
                                                            <span className="text-[9px] font-black text-[#1D7DB5] dark:text-blue-400 uppercase tracking-wider bg-blue-50/50 dark:bg-blue-950/20 px-1.5 py-0.5 rounded border border-blue-100/30">
                                                                {n.project.name}
                                                            </span>
                                                        )}
                                                        <span className="text-[8px] text-slate-400 dark:text-slate-500 font-semibold">
                                                            {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Footer Section: Filter, Snooze, Close */}
                        <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-[#eef2f1] dark:bg-slate-900/90 flex gap-2 items-center">
                            {/* Search box */}
                            <div className="relative flex-1">
                                <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                                <input
                                    type="text"
                                    value={filterQuery}
                                    onChange={(e) => setFilterQuery(e.target.value)}
                                    placeholder={t('basecamp.filter_placeholder')}
                                    className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#1D7DB5]"
                                />
                            </div>

                            {/* Snooze (Shhhh...) */}
                            <button
                                onClick={() => setIsSnoozed(!isSnoozed)}
                                className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all flex items-center gap-1 ${
                                    isSnoozed
                                        ? 'bg-orange-500 border-orange-600 text-white shadow-inner'
                                        : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                                }`}
                                title={isSnoozed ? t('basecamp.snooze_active') : t('basecamp.snooze')}
                            >
                                <VolumeX size={13} />
                                <span className="hidden sm:inline">Shhhh...</span>
                            </button>

                            {/* Close */}
                            <button
                                onClick={onClose}
                                className="p-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 text-slate-600 dark:text-slate-300 transition-colors"
                            >
                                <X size={15} />
                            </button>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    )
}
