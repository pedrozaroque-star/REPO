/**
 * @module Basecamp Page Controller
 * @description Módulo de enrutamiento y estado principal para la integración real de Basecamp.
 *              Controla las vistas de Home, Proyecto y Herramientas a través de URL SearchParams.
 * @businessRules
 *   - Soporte bilingüe (ES/EN) a través de useLanguage.
 *   - Persistencia de datos real en la base de datos Supabase con sincronización bidireccional API.
 *   - Integración fluida con la sesión de usuario de SM TEG.
 * @dataFlow
 *   - Lee 'project', 'tool', 'ping' y 'section' de useSearchParams.
 *   - Consulta proyectos y membresías de Supabase.
 *   - Proporciona las herramientas principales (Campfire, To-dos, Message Board, etc.) conectadas a Supabase.
 * @notes
 *   - Envuelto en React Suspense para evitar errores de compilación estática en Next.js.
 */

'use client'

import React, { Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useLanguage } from '@/lib/i18n'
import { useAuth } from '@/components/ProtectedRoute'
import BasecampHome from '@/components/basecamp/BasecampHome'
import BasecampProject from '@/components/basecamp/BasecampProject'
import PingsDrawer from '@/components/basecamp/PingsDrawer'
import HeyMenu from '@/components/basecamp/HeyMenu'
import MyStuffPage from '@/components/basecamp/MyStuffPage'
import ToolCampfire from '@/components/basecamp/ToolCampfire'
import ToolTodos from '@/components/basecamp/ToolTodos'
import ToolMessages from '@/components/basecamp/ToolMessages'
import ToolDocs from '@/components/basecamp/ToolDocs'
import ToolSchedule from '@/components/basecamp/ToolSchedule'
import ToolCheckins from '@/components/basecamp/ToolCheckins'
import NewForYouDrawer from '@/components/basecamp/NewForYouDrawer'
import {
    Home, MessageSquare, Bell, User, Search, ArrowLeft, Users, Briefcase, KeyRound, RefreshCw, HelpCircle,
    CheckSquare, FileText, Mail, Loader2, Play, FolderOpen
} from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'

const formatSearchDateTime = (dateStr: string, language: string) => {
    if (!dateStr) return ''
    try {
        const d = new Date(dateStr)
        const optionsDate: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
        const optionsTime: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true }
        const datePart = d.toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US', optionsDate)
        const timePart = d.toLocaleTimeString(language === 'es' ? 'es-ES' : 'en-US', optionsTime).toLowerCase()
        return `${datePart} ${timePart}`
    } catch {
        return ''
    }
}

function BasecampWorkspace() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { t, language } = useLanguage()
    const { user } = useAuth()

    const projectId = searchParams.get('project')
    const toolId = searchParams.get('tool')
    const section = searchParams.get('section') // 'pings' | 'hey' | 'mystuff' | 'activity' | 'find'
    const pingUser = searchParams.get('ping') // email or name of chat partner

    const [projects, setProjects] = useState<any[]>([])
    const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null)
    const [loading, setLoading] = useState(true)
    const [syncing, setSyncing] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [showSearchModal, setShowSearchModal] = useState(false)
    const [searchResults, setSearchResults] = useState<any[]>([])
    const [searchLoading, setSearchLoading] = useState(false)
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [unreadHeyCount, setUnreadHeyCount] = useState(0)
    const [heyDrawerOpen, setHeyDrawerOpen] = useState(false)
    const [currentTodoId, setCurrentTodoId] = useState<string | null>(searchParams.get('todoId'))

    useEffect(() => {
        setCurrentTodoId(searchParams.get('todoId'))
    }, [searchParams])

    const currentUserName = user?.name || 'Carlos Roque'

    // 1. Fetch authorization status and projects
    const checkAuthAndLoadProjects = async () => {
        setLoading(true)
        try {
            // Check status via API (uses service_role internally)
            const statusRes = await fetch('/api/basecamp/status')
            if (!statusRes.ok) throw new Error('Failed to get status')
            const { authorized } = await statusRes.json()
            setIsAuthorized(authorized)

            if (authorized) {
                // Use authenticated Supabase client (JWT token adds 'authenticated' role for RLS)
                const supabase = getSupabaseWithAuth()

                // Fetch projects with memberships
                const { data: dbProjects, error } = await supabase
                    .from('bc_projects')
                    .select(`
                        *,
                        bc_memberships(
                            role,
                            person:bc_people(id, name, email, avatar_url, role)
                        )
                    `)
                    .order('name', { ascending: true })

                if (error) {
                    console.error('Error loading projects:', error.message)
                } else if (dbProjects && dbProjects.length > 0) {
                    // Map to UI friendly structure
                    const formatted = dbProjects.map((p: any) => {
                        const members = p.bc_memberships?.map((m: any) => ({
                            id: m.person?.id,
                            name: m.person?.name || 'Unknown',
                            email: m.person?.email || '',
                            role: m.role || 'user',
                            avatar: m.person?.avatar_url
                        })) || []

                        return {
                            id: String(p.bc_id), // UI expects string IDs
                            db_id: p.id,        // Save DB UUID as db_id
                            name: p.name,
                            description: p.description,
                            color: p.color || 'white',
                            is_pinned: p.is_pinned || false,
                            peopleCount: members.length,
                            people: members
                        }
                    })
                    setProjects(formatted)
                }

                // Fetch unread notifications count
                const { data: dbPeople } = await supabase
                    .from('bc_people')
                    .select('id')
                    .eq('email', user?.email || '')
                    .limit(1)
                    .single()

                if (dbPeople) {
                    const { count } = await supabase
                        .from('bc_notifications')
                        .select('*', { count: 'exact', head: true })
                        .eq('person_id', dbPeople.id)
                        .eq('is_read', false)

                    setUnreadHeyCount(count || 0)
                }
            }
        } catch (err: any) {
            console.error('Error loading Basecamp workspace:', err.message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        checkAuthAndLoadProjects()
    }, [user])

    const saveProjects = async (updated: any[]) => {
        const supabase = getSupabaseWithAuth()
        try {
            // Find which project color or pin changed and update Supabase
            for (const up of updated) {
                const orig = projects.find(p => p.id === up.id)
                if (orig && (orig.color !== up.color || orig.is_pinned !== up.is_pinned)) {
                    console.log(`💾 Saving project ${up.name} color/pin to Supabase...`, { color: up.color, is_pinned: up.is_pinned })
                    const { error } = await supabase
                        .from('bc_projects')
                        .update({
                            color: up.color,
                            is_pinned: up.is_pinned
                        })
                        .eq('bc_id', Number(up.id))

                    if (error) {
                        console.error(`❌ Error updating project ${up.name}:`, error.message)
                    }
                }
            }
        } catch (err: any) {
            console.error('Error in saveProjects:', err.message)
        }
        setProjects(updated)
    }

    // Trigger full manual sync
    const handleSync = async () => {
        setSyncing(true)
        try {
            console.log('🔄 Triggering sync...')
            const res = await fetch('/api/basecamp/sync', { method: 'POST' })
            const data = await res.json().catch(() => ({}))
            
            if (res.status === 409) {
                // A sync was already running in the background — not a failure, just wait and refresh data
                console.log('⏳ Sync is already running in background, refreshing local data...')
                await new Promise(r => setTimeout(r, 2000))
                await checkAuthAndLoadProjects()
                return
            }

            if (!res.ok || data.status === 'failed') {
                throw new Error(data.error || 'Sync endpoint returned error')
            }
            console.log('✅ Sync completed!')
            await checkAuthAndLoadProjects()
        } catch (err: any) {
            console.error('Sync failed:', err.message)
            alert('Error al sincronizar: ' + err.message)
        } finally {
            setSyncing(false)
        }
    }

    const navigateTo = (params: { project?: string; tool?: string; section?: string; ping?: string; tab?: string; todoId?: string }) => {
        const query = new URLSearchParams()
        if (params.project) query.set('project', params.project)
        if (params.tool) query.set('tool', params.tool)
        if (params.section) query.set('section', params.section)
        if (params.ping) query.set('ping', params.ping)
        if (params.tab) query.set('tab', params.tab)
        if (params.todoId) {
            query.set('todoId', params.todoId)
            setCurrentTodoId(params.todoId)
        } else {
            setCurrentTodoId(null)
        }
        router.push(`/basecamp?${query.toString()}`)
    }

    const currentProject = projects.find(p => p.id === projectId)

    // Helper to strip HTML tags for search previews
    const stripHtml = (html: string) => {
        if (!html) return ''
        return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
    }

    // Helper to extract image and video URLs from HTML content
    const extractMediaUrls = (html: string) => {
        const media: { type: 'image' | 'video'; url: string }[] = []
        if (!html) return media

        // Extract <img> tags
        const imgRegex = /<img[^>]+src="([^">]+)"/gi
        let match
        while ((match = imgRegex.exec(html)) !== null) {
            const url = match[1]
            if (!url.includes('attachment-icon')) {
                media.push({ type: 'image', url })
            }
        }

        // Extract <video> or <source> tags
        const videoRegex = /<video[^>]+src="([^">]+)"/gi
        while ((match = videoRegex.exec(html)) !== null) {
            media.push({ type: 'video', url: match[1] })
        }
        const sourceRegex = /<source[^>]+src="([^">]+)"/gi
        while ((match = sourceRegex.exec(html)) !== null) {
            media.push({ type: 'video', url: match[1] })
        }

        return media
    }

    // ── Global search across Supabase tables with debounce ──
    const executeSearch = useCallback(async (query: string) => {
        if (query.trim().length < 3) {
            setSearchResults([])
            setSearchLoading(false)
            return
        }
        setSearchLoading(true)
        try {
            const supabase = getSupabaseWithAuth()
            const pattern = `%${query}%`

            const [todosRes, messagesRes, docsRes, peopleRes] = await Promise.all([
                supabase
                    .from('bc_todos')
                    .select('id, title, description, created_at, project_id')
                    .or(`title.ilike.${pattern},description.ilike.${pattern}`)
                    .order('created_at', { ascending: false })
                    .limit(10),
                supabase
                    .from('bc_messages')
                    .select('id, title, content, created_at, project_id')
                    .or(`title.ilike.${pattern},content.ilike.${pattern}`)
                    .order('created_at', { ascending: false })
                    .limit(10),
                supabase
                    .from('bc_documents')
                    .select('id, title, content, created_at, project_id')
                    .or(`title.ilike.${pattern},content.ilike.${pattern}`)
                    .order('created_at', { ascending: false })
                    .limit(10),
                supabase
                    .from('bc_people')
                    .select('id, name, email')
                    .ilike('name', pattern)
                    .limit(10),
            ])

            const results: any[] = []

            // Projects (local filter — always fast)
            const matchedProjects = projects.filter(p =>
                p.name.toLowerCase().includes(query.toLowerCase())
            )
            matchedProjects.forEach(p => {
                results.push({ type: 'project', id: p.id, label: p.name, projectId: p.id })
            })

            // Todos
            if (todosRes.data) {
                todosRes.data.forEach((row: any) => {
                    const proj = projects.find(p => p.db_id === row.project_id)
                    if (proj) {
                        results.push({
                            type: 'todo',
                            id: row.id,
                            label: row.title,
                            projectId: proj.id,
                            projectName: proj.name,
                            createdAt: row.created_at,
                            description: row.description,
                            media: extractMediaUrls(row.description),
                        })
                    }
                })
            }

            // Messages
            if (messagesRes.data) {
                messagesRes.data.forEach((row: any) => {
                    const proj = projects.find(p => p.db_id === row.project_id)
                    if (proj) {
                        results.push({
                            type: 'message',
                            id: row.id,
                            label: row.title,
                            projectId: proj.id,
                            projectName: proj.name,
                            createdAt: row.created_at,
                            description: row.content,
                            media: extractMediaUrls(row.content),
                        })
                    }
                })
            }

            // Documents
            if (docsRes.data) {
                docsRes.data.forEach((row: any) => {
                    const proj = projects.find(p => p.db_id === row.project_id)
                    if (proj) {
                        results.push({
                            type: 'document',
                            id: row.id,
                            label: row.title,
                            projectId: proj.id,
                            projectName: proj.name,
                            createdAt: row.created_at,
                            description: row.content,
                            media: extractMediaUrls(row.content),
                        })
                    }
                })
            }

            // People
            if (peopleRes.data) {
                peopleRes.data.forEach((row: any) => {
                    results.push({ type: 'person', id: row.id, label: row.name, email: row.email })
                })
            }

            setSearchResults(results)
        } catch (err) {
            console.error('Global search error:', err)
            setSearchResults([])
        } finally {
            setSearchLoading(false)
        }
    }, [projects])

    const handleSearchInput = useCallback((value: string) => {
        setSearchQuery(value)
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
        if (value.trim().length < 3) {
            setSearchResults([])
            setSearchLoading(false)
            return
        }
        setSearchLoading(true)
        searchTimerRef.current = setTimeout(() => {
            executeSearch(value)
        }, 250)
    }, [executeSearch])

    // Cleanup search debounce timer on unmount
    useEffect(() => {
        return () => {
            if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
        }
    }, [])

    // Keyboard shortcut Shift + J / Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (showSearchModal) {
                    e.preventDefault()
                    setSearchQuery('')
                    setSearchResults([])
                    setShowSearchModal(false)
                }
            } else if (e.key === 'J' && e.shiftKey) {
                e.preventDefault()
                setShowSearchModal(true)
            } else if (e.key === 'h' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
                navigateTo({})
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [projects, showSearchModal])

    if (loading) {
        return (
            <div className="w-full min-h-[60vh] flex items-center justify-center bg-[#f4f1ea] dark:bg-slate-950 rounded-2xl">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#1D7DB5] mx-auto mb-4"></div>
                    <p className="text-slate-600 dark:text-slate-400 text-sm font-semibold">{t('basecamp.loading_bc')}</p>
                </div>
            </div>
        )
    }

    // Render connection view if not authorized
    if (isAuthorized === false) {
        return (
            <div className="w-full min-h-[70vh] bg-[#f4f1ea] dark:bg-slate-950 p-6 rounded-2xl flex items-center justify-center font-sans">
                <div className="max-w-md w-full bg-[#fffdf9] dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 text-center shadow-xl">
                    <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-950/40 text-[#1D7DB5] dark:text-blue-400 flex items-center justify-center mx-auto mb-6 shadow-inner">
                        <KeyRound size={32} />
                    </div>
                    <h2 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 mb-2">{t('basecamp.connect_bc_title')}</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                        {t('basecamp.connect_bc_desc')}
                    </p>
                    <a
                        href="/api/basecamp/auth"
                        className="inline-flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] active:bg-[#0E4A6E] text-white font-extrabold text-sm shadow-md hover:shadow-lg transition-all"
                    >
                        <span>{t('basecamp.connect_bc_btn')}</span>
                    </a>
                </div>
            </div>
        )
    }

    // Render sync required view if authorized but no projects exist
    if (projects.length === 0 && !syncing) {
        return (
            <div className="w-full min-h-[70vh] bg-[#f4f1ea] dark:bg-slate-950 p-6 rounded-2xl flex items-center justify-center font-sans">
                <div className="max-w-md w-full bg-[#fffdf9] dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 text-center shadow-xl">
                    <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:blue-400 flex items-center justify-center mx-auto mb-6 shadow-inner">
                        <RefreshCw size={32} />
                    </div>
                    <h2 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 mb-2">{t('basecamp.initial_sync_title')}</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                        {t('basecamp.initial_sync_desc')}
                    </p>
                    <button
                        onClick={handleSync}
                        className="inline-flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] text-white font-extrabold text-sm shadow-md transition-all animate-pulse"
                    >
                        <RefreshCw size={16} />
                        <span>{t('basecamp.sync_now')}</span>
                    </button>
                </div>
            </div>
        )
    }

    // Render full-screen sync overlay ONLY on first-time initial download when no projects exist yet
    if (syncing && projects.length === 0) {
        return (
            <div className="w-full min-h-[70vh] bg-[#f4f1ea] dark:bg-slate-950 p-6 rounded-2xl flex items-center justify-center font-sans">
                <div className="max-w-md w-full bg-[#fffdf9] dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 text-center shadow-xl">
                    <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-950/40 text-[#1D7DB5] flex items-center justify-center mx-auto mb-6 shadow-inner">
                        <RefreshCw size={32} className="animate-spin" />
                    </div>
                    <h2 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 mb-2">{t('basecamp.syncing_title')}</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                        {t('basecamp.syncing_desc')}
                    </p>
                    <div className="w-full bg-slate-200 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden relative">
                        <div className="bg-[#1D7DB5] h-full absolute inset-y-0 left-0 w-3/4 animate-pulse rounded-full"></div>
                    </div>
                </div>
            </div>
        )
    }

    const renderBasecampHeader = () => {
        return (
            <header className="w-full bg-[#fcfaf6] dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 py-2.5 px-3 sm:px-6 flex items-center justify-between gap-3 rounded-t-2xl shadow-sm">
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={() => navigateTo({})}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-xs font-semibold text-slate-700 dark:text-slate-200"
                    >
                        <Home size={14} />
                        <span className="hidden sm:inline">{t('basecamp.home')}</span>
                    </button>
                    {projectId && (
                        <button
                            onClick={() => navigateTo({ project: projectId })}
                            className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                        >
                            <ArrowLeft size={12} />
                            <span className="truncate max-w-[80px] sm:max-w-xs font-semibold">{currentProject?.name}</span>
                        </button>
                    )}
                </div>

                <div className="flex items-center justify-end gap-1 overflow-x-auto no-scrollbar py-0.5 flex-1">
                    <button
                        onClick={() => setShowSearchModal(true)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all shrink-0"
                    >
                        <Search size={13} />
                        <span>{t('basecamp.find')}</span>
                    </button>

                    <button
                        onClick={handleSync}
                        disabled={syncing}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all border shrink-0 ${
                            syncing
                                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 border-blue-200 dark:border-blue-800 cursor-not-allowed opacity-80'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border-dashed border-blue-300 dark:border-slate-700 hover:border-blue-400'
                        }`}
                        title={syncing ? t('basecamp.syncing_in_progress') : t('basecamp.sync_btn')}
                    >
                        <RefreshCw size={13} className={syncing ? 'animate-spin text-blue-500' : ''} />
                        <span>{syncing ? t('basecamp.syncing_in_progress') : t('basecamp.sync_btn')}</span>
                    </button>
                </div>

                <div className="hidden md:flex items-center gap-2 shrink-0">
                    <div className="w-8 h-8 rounded-full bg-[#1D7DB5] text-white font-bold flex items-center justify-center text-xs shadow-inner">
                        {currentUserName[0]}
                    </div>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate max-w-[120px]">{currentUserName.split(' ')[0]}</span>
                </div>
            </header>
        )
    }

    const renderWorkspaceContent = () => {
        console.log("🖥️ [BasecampPage] renderWorkspaceContent called:", {
            projectId,
            currentProjectName: currentProject?.name,
            toolId,
            todoIdParam: searchParams.get('todoId'),
            section
        })
        if (section === 'hey') {
            return <HeyMenu navigateTo={navigateTo} clearCount={() => setUnreadHeyCount(0)} />
        }
        if (section === 'pings' || pingUser) {
            return <PingsDrawer activeUser={pingUser} navigateTo={navigateTo} currentUserName={currentUserName} />
        }
        if (section === 'mystuff') {
            return <MyStuffPage navigateTo={navigateTo} currentUserName={currentUserName} />
        }

        if (projectId && currentProject) {
            if (toolId) {
                const normTool = toolId.toLowerCase()
                switch (normTool) {
                    case 'campfire':
                    case 'chat':
                    case 'chats':
                        return <ToolCampfire project={currentProject} currentUserName={currentUserName} />
                    case 'todos':
                    case 'todo':
                    case 'todolist':
                    case 'todolists':
                        return (
                            <ToolTodos
                                project={currentProject}
                                currentUserName={currentUserName}
                                selectedTodoId={currentTodoId || undefined}
                                onCloseDetail={() => {
                                    setCurrentTodoId(null)
                                    const query = new URLSearchParams(window.location.search)
                                    query.delete('todoId')
                                    router.push(`/basecamp?${query.toString()}`)
                                }}
                                navigateTo={navigateTo}
                            />
                        )
                    case 'messages':
                    case 'message':
                    case 'message_board':
                    case 'message-board':
                        return <ToolMessages project={currentProject} currentUserName={currentUserName} />
                    case 'docs':
                    case 'doc':
                    case 'document':
                    case 'documents':
                    case 'vault':
                    case 'uploads':
                    case 'files':
                    case 'file':
                        return <ToolDocs project={currentProject} currentUserName={currentUserName} />
                    case 'schedule':
                    case 'event':
                    case 'events':
                    case 'calendar':
                        return <ToolSchedule project={currentProject} currentUserName={currentUserName} />
                    case 'checkins':
                    case 'checkin':
                    case 'question':
                    case 'questions':
                    case 'answer':
                    case 'answers':
                        return <ToolCheckins project={currentProject} currentUserName={currentUserName} />
                    default:
                        return <BasecampProject project={currentProject} navigateTo={navigateTo} saveProjects={saveProjects} projects={projects} currentUserName={currentUserName} onOpenSearch={() => setShowSearchModal(true)} />
                }
            }
            return <BasecampProject project={currentProject} navigateTo={navigateTo} saveProjects={saveProjects} projects={projects} currentUserName={currentUserName} onOpenSearch={() => setShowSearchModal(true)} />
        }

        return <BasecampHome projects={projects} saveProjects={saveProjects} navigateTo={navigateTo} userName={currentUserName} onOpenSearch={() => setShowSearchModal(true)} />
    }

    const isHome = !projectId && !toolId && !section && !pingUser

    return (
        <div className="relative w-full min-h-[85vh] bg-[#f4f1ea] dark:bg-slate-950 p-2 sm:p-4 md:p-6 rounded-2xl border border-slate-200/60 dark:border-slate-800/80 shadow-2xl flex flex-col font-sans pb-24">
            {!isHome && renderBasecampHeader()}
            
            <main className={`flex-1 bg-[#fffdf9] dark:bg-slate-900 rounded-2xl p-4 sm:p-6 md:p-8 min-h-[60vh] flex flex-col ${!isHome ? 'border-x border-b border-slate-200 dark:border-slate-800 rounded-t-none' : 'border border-slate-200/60 dark:border-slate-800'}`}>
                {renderWorkspaceContent()}
            </main>


            {/* Modal de Búsqueda global (Find) */}
            {showSearchModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
                    onClick={(e) => { if (e.target === e.currentTarget) { setSearchQuery(''); setSearchResults([]); setShowSearchModal(false) } }}
                >
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
                            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                <Search size={20} className="text-[#1D7DB5]" />
                                {t('basecamp.find')}
                            </h3>
                            <button
                                onClick={() => { setSearchQuery(''); setSearchResults([]); setShowSearchModal(false) }}
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-bold text-xs"
                                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #e2e8f0' }}
                            >
                                Esc
                            </button>
                        </div>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => handleSearchInput(e.target.value)}
                            placeholder={t('basecamp.search_placeholder')}
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1D7DB5]"
                            autoFocus
                        />

                        {/* Hint: min 3 chars */}
                        {searchQuery.trim().length > 0 && searchQuery.trim().length < 3 && (
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-3 text-center">
                                {t('basecamp.search_min_chars')}
                            </p>
                        )}

                        {/* Loading indicator */}
                        {searchLoading && (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '24px 0' }}>
                                <Loader2 size={18} className="animate-spin" style={{ color: '#1D7DB5' }} />
                                <span className="text-sm text-slate-500 dark:text-slate-400 font-semibold">{t('basecamp.search_searching')}</span>
                            </div>
                        )}

                                       {!searchLoading && searchQuery.trim().length >= 3 && (
                            <div className="mt-4 max-h-[480px] overflow-y-auto flex flex-col gap-4">
                                {searchResults.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '24px 0' }}>
                                        <Search size={32} style={{ margin: '0 auto 8px', color: '#94a3b8' }} />
                                        <p className="text-sm text-slate-500 dark:text-slate-400 font-semibold">
                                            {t('basecamp.search_no_results')} &ldquo;{searchQuery}&rdquo;
                                        </p>
                                    </div>
                                ) : (
                                    <>
                                        {/* Group: Projects */}
                                        {searchResults.filter(r => r.type === 'project').length > 0 && (
                                            <div className="flex flex-col gap-1">
                                                <p style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', padding: '6px 4px 2px' }}>
                                                    {t('basecamp.search_type_projects')}
                                                </p>
                                                {searchResults.filter(r => r.type === 'project').map(r => (
                                                    <button
                                                        key={`proj-${r.id}`}
                                                        onClick={() => { navigateTo({ project: r.projectId }); setSearchQuery(''); setSearchResults([]); setShowSearchModal(false) }}
                                                        className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-left transition-colors"
                                                        style={{ border: '1px solid transparent' }}
                                                    >
                                                        <Briefcase size={16} style={{ color: '#3b82f6', flexShrink: 0 }} />
                                                        <div style={{ minWidth: 0 }}>
                                                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</p>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        {/* Group: Todos (Sorted newest to oldest) */}
                                        {searchResults.filter(r => r.type === 'todo').length > 0 && (
                                            <div className="flex flex-col gap-2.5">
                                                <p style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', padding: '6px 4px 2px' }}>
                                                    {t('basecamp.search_type_tasks')}
                                                </p>
                                                {searchResults
                                                    .filter(r => r.type === 'todo')
                                                    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
                                                    .map(r => (
                                                        <button
                                                            key={`todo-${r.id}`}
                                                            onClick={() => { navigateTo({ project: r.projectId, tool: 'todos', todoId: r.id }); setSearchQuery(''); setSearchResults([]); setShowSearchModal(false) }}
                                                            className="w-full flex flex-col gap-2 p-3.5 rounded-xl bg-slate-50/50 hover:bg-slate-100 dark:bg-slate-800/30 dark:hover:bg-slate-800/70 border border-slate-150 dark:border-slate-800 text-left transition-all duration-200 shadow-sm"
                                                        >
                                                            <div className="flex items-center gap-2 w-full">
                                                                <CheckSquare size={16} className="text-green-600 flex-shrink-0" />
                                                                <span className="text-sm font-extrabold text-slate-800 dark:text-slate-200 flex-1 truncate">
                                                                    {r.label}
                                                                </span>
                                                                {r.createdAt && (
                                                                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 flex-shrink-0">
                                                                        {formatSearchDateTime(r.createdAt, language)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#1D7DB5] uppercase tracking-wider">
                                                                <span>{t('basecamp.search_in_project')}:</span>
                                                                <span className="bg-blue-50 dark:bg-blue-950/30 px-1.5 py-0.5 rounded">
                                                                    {r.projectName}
                                                                </span>
                                                            </div>
                                                            {r.description && (
                                                                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                                                                    {stripHtml(r.description)}
                                                                </p>
                                                            )}
                                                            {r.media && r.media.length > 0 && (
                                                                <div className="flex flex-wrap gap-2 mt-1">
                                                                    {r.media.slice(0, 5).map((m: any, idx: number) => {
                                                                        if (m.type === 'image') {
                                                                            return (
                                                                                <img 
                                                                                    key={idx}
                                                                                    src={m.url} 
                                                                                    alt="Preview thumbnail" 
                                                                                    className="w-12 h-12 rounded-lg object-cover border border-slate-200 dark:border-slate-700 bg-white"
                                                                                />
                                                                            )
                                                                        } else if (m.type === 'video') {
                                                                            return (
                                                                                <div key={idx} className="relative w-12 h-12 rounded-lg bg-slate-950 border border-slate-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                                                                                    <video src={m.url} className="w-full h-full object-cover opacity-80" muted preload="metadata" />
                                                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                                                                        <Play size={10} className="text-white fill-white" />
                                                                                    </div>
                                                                                </div>
                                                                            )
                                                                        }
                                                                        return null
                                                                    })}
                                                                    {r.media.length > 5 && (
                                                                        <div className="w-12 h-12 rounded-lg bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-500">
                                                                            +{r.media.length - 5}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </button>
                                                    ))}
                                            </div>
                                        )}

                                        {/* Group: Messages (Sorted newest to oldest) */}
                                        {searchResults.filter(r => r.type === 'message').length > 0 && (
                                            <div className="flex flex-col gap-2.5">
                                                <p style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', padding: '6px 4px 2px' }}>
                                                    {t('basecamp.search_type_messages')}
                                                </p>
                                                {searchResults
                                                    .filter(r => r.type === 'message')
                                                    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
                                                    .map(r => (
                                                        <button
                                                            key={`msg-${r.id}`}
                                                            onClick={() => { navigateTo({ project: r.projectId, tool: 'messages' }); setSearchQuery(''); setSearchResults([]); setShowSearchModal(false) }}
                                                            className="w-full flex flex-col gap-2 p-3.5 rounded-xl bg-slate-50/50 hover:bg-slate-100 dark:bg-slate-800/30 dark:hover:bg-slate-800/70 border border-slate-150 dark:border-slate-800 text-left transition-all duration-200 shadow-sm"
                                                        >
                                                            <div className="flex items-center gap-2 w-full">
                                                                <Mail size={16} className="text-amber-500 flex-shrink-0" />
                                                                <span className="text-sm font-extrabold text-slate-800 dark:text-slate-200 flex-1 truncate">
                                                                    {r.label}
                                                                </span>
                                                                {r.createdAt && (
                                                                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 flex-shrink-0">
                                                                        {formatSearchDateTime(r.createdAt, language)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#1D7DB5] uppercase tracking-wider">
                                                                <span>{t('basecamp.search_in_project')}:</span>
                                                                <span className="bg-blue-50 dark:bg-blue-950/30 px-1.5 py-0.5 rounded">
                                                                    {r.projectName}
                                                                </span>
                                                            </div>
                                                            {r.description && (
                                                                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                                                                    {stripHtml(r.description)}
                                                                </p>
                                                            )}
                                                            {r.media && r.media.length > 0 && (
                                                                <div className="flex flex-wrap gap-2 mt-1">
                                                                    {r.media.slice(0, 5).map((m: any, idx: number) => {
                                                                        if (m.type === 'image') {
                                                                            return (
                                                                                <img 
                                                                                    key={idx}
                                                                                    src={m.url} 
                                                                                    alt="Preview thumbnail" 
                                                                                    className="w-12 h-12 rounded-lg object-cover border border-slate-200 dark:border-slate-700 bg-white"
                                                                                />
                                                                            )
                                                                        } else if (m.type === 'video') {
                                                                            return (
                                                                                <div key={idx} className="relative w-12 h-12 rounded-lg bg-slate-950 border border-slate-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                                                                                    <video src={m.url} className="w-full h-full object-cover opacity-80" muted preload="metadata" />
                                                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                                                                        <Play size={10} className="text-white fill-white" />
                                                                                    </div>
                                                                                </div>
                                                                            )
                                                                        }
                                                                        return null
                                                                    })}
                                                                    {r.media.length > 5 && (
                                                                        <div className="w-12 h-12 rounded-lg bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-500">
                                                                            +{r.media.length - 5}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </button>
                                                    ))}
                                            </div>
                                        )}

                                        {/* Group: Documents (Sorted newest to oldest) */}
                                        {searchResults.filter(r => r.type === 'document').length > 0 && (
                                            <div className="flex flex-col gap-2.5">
                                                <p style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', padding: '6px 4px 2px' }}>
                                                    {t('basecamp.search_type_documents')}
                                                </p>
                                                {searchResults
                                                    .filter(r => r.type === 'document')
                                                    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
                                                    .map(r => (
                                                        <button
                                                            key={`doc-${r.id}`}
                                                            onClick={() => { navigateTo({ project: r.projectId, tool: 'docs' }); setSearchQuery(''); setSearchResults([]); setShowSearchModal(false) }}
                                                            className="w-full flex flex-col gap-2 p-3.5 rounded-xl bg-slate-50/50 hover:bg-slate-100 dark:bg-slate-800/30 dark:hover:bg-slate-800/70 border border-slate-150 dark:border-slate-800 text-left transition-all duration-200 shadow-sm"
                                                        >
                                                            <div className="flex items-center gap-2 w-full">
                                                                <FolderOpen size={16} className="text-blue-500 flex-shrink-0" />
                                                                <span className="text-sm font-extrabold text-slate-800 dark:text-slate-200 flex-1 truncate">
                                                                    {r.label}
                                                                </span>
                                                                {r.createdAt && (
                                                                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 flex-shrink-0">
                                                                        {formatSearchDateTime(r.createdAt, language)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#1D7DB5] uppercase tracking-wider">
                                                                <span>{t('basecamp.search_in_project')}:</span>
                                                                <span className="bg-blue-50 dark:bg-blue-950/30 px-1.5 py-0.5 rounded">
                                                                    {r.projectName}
                                                                </span>
                                                            </div>
                                                            {r.description && (
                                                                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                                                                    {stripHtml(r.description)}
                                                                </p>
                                                            )}
                                                            {r.media && r.media.length > 0 && (
                                                                <div className="flex flex-wrap gap-2 mt-1">
                                                                    {r.media.slice(0, 5).map((m: any, idx: number) => {
                                                                        if (m.type === 'image') {
                                                                            return (
                                                                                <img 
                                                                                    key={idx}
                                                                                    src={m.url} 
                                                                                    alt="Preview thumbnail" 
                                                                                    className="w-12 h-12 rounded-lg object-cover border border-slate-200 dark:border-slate-700 bg-white"
                                                                                />
                                                                            )
                                                                        } else if (m.type === 'video') {
                                                                            return (
                                                                                <div key={idx} className="relative w-12 h-12 rounded-lg bg-slate-950 border border-slate-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                                                                                    <video src={m.url} className="w-full h-full object-cover opacity-80" muted preload="metadata" />
                                                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                                                                        <Play size={10} className="text-white fill-white" />
                                                                                    </div>
                                                                                </div>
                                                                            )
                                                                        }
                                                                        return null
                                                                    })}
                                                                    {r.media.length > 5 && (
                                                                        <div className="w-12 h-12 rounded-lg bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-500">
                                                                            +{r.media.length - 5}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </button>
                                                    ))}
                                            </div>
                                        )}

                                        {/* Group: People */}
                                        {searchResults.filter(r => r.type === 'person').length > 0 && (
                                            <div className="flex flex-col gap-1">
                                                <p style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', padding: '6px 4px 2px' }}>
                                                    {t('basecamp.search_type_people')}
                                                </p>
                                                {searchResults.filter(r => r.type === 'person').map(r => (
                                                    <div
                                                        key={`person-${r.id}`}
                                                        className="w-full flex items-center gap-3 p-2.5 rounded-lg text-left bg-slate-50/30 dark:bg-slate-800/10 border border-slate-100 dark:border-slate-800"
                                                    >
                                                        <User size={16} style={{ color: '#ec4899', flexShrink: 0 }} />
                                                        <div style={{ minWidth: 0, flex: 1 }}>
                                                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{r.label}</p>
                                                            {r.email && <p style={{ fontSize: 10, color: '#94a3b8' }}>{r.email}</p>}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}

                        {/* Bottom hint */}
                        {searchQuery.trim().length === 0 && (
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-3 text-center">
                                {t('basecamp.jump_description')}
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default function BasecampPage() {
    const { t } = useLanguage()
    return (
        <Suspense fallback={
            <div className="w-full min-h-[60vh] flex items-center justify-center bg-[#f4f1ea] dark:bg-slate-950 rounded-2xl">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#1D7DB5] mx-auto mb-4"></div>
                    <p className="text-slate-600 dark:text-slate-400 text-sm font-semibold">{t('basecamp.loading_bc')}</p>
                </div>
            </div>
        }>
            <BasecampWorkspace />
        </Suspense>
    )
}
