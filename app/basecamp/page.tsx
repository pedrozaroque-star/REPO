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

import React, { Suspense, useState, useEffect } from 'react'
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
import {
    Home, MessageSquare, Bell, User, Search, ArrowLeft, Users, Briefcase, KeyRound, RefreshCw
} from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'

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
    const [unreadHeyCount, setUnreadHeyCount] = useState(0)

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
        // Find which project color or pin changed and update Supabase
        for (const up of updated) {
            const orig = projects.find(p => p.id === up.id)
            if (orig && (orig.color !== up.color || orig.is_pinned !== up.is_pinned)) {
                await supabase
                    .from('bc_projects')
                    .update({
                        color: up.color,
                        is_pinned: up.is_pinned
                    })
                    .eq('bc_id', Number(up.id))
            }
        }
        setProjects(updated)
    }

    // Trigger full manual sync
    const handleSync = async () => {
        setSyncing(true)
        try {
            console.log('🔄 Triggering full sync...')
            const res = await fetch('/api/basecamp/sync', { method: 'POST' })
            if (!res.ok) throw new Error('Sync endpoint returned error')
            console.log('✅ Sync completed!')
            await checkAuthAndLoadProjects()
        } catch (err: any) {
            console.error('Sync failed:', err.message)
            alert('Failed to sync Basecamp data: ' + err.message)
        } finally {
            setSyncing(false)
        }
    }

    const navigateTo = (params: { project?: string; tool?: string; section?: string; ping?: string }) => {
        const query = new URLSearchParams()
        if (params.project) query.set('project', params.project)
        if (params.tool) query.set('tool', params.tool)
        if (params.section) query.set('section', params.section)
        if (params.ping) query.set('ping', params.ping)
        router.push(`/basecamp?${query.toString()}`)
    }

    const currentProject = projects.find(p => p.id === projectId)

    // Keyboard shortcut Shift + J
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'J' && e.shiftKey) {
                e.preventDefault()
                setShowSearchModal(true)
            } else if (e.key === 'h' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
                navigateTo({})
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [projects])

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

    if (syncing) {
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
            <header className="w-full bg-[#fcfaf6] dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 py-3 px-4 sm:px-6 flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-t-2xl shadow-sm">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigateTo({})}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-sm font-semibold text-slate-700 dark:text-slate-200"
                    >
                        <Home size={16} />
                        <span className="hidden sm:inline">{t('basecamp.home')}</span>
                    </button>
                    {projectId && (
                        <button
                            onClick={() => navigateTo({ project: projectId })}
                            className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                        >
                            <ArrowLeft size={14} />
                            <span className="truncate max-w-[120px] sm:max-w-xs font-semibold">{currentProject?.name}</span>
                        </button>
                    )}
                </div>

                <div className="flex items-center justify-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar py-1">
                    <button
                        onClick={() => navigateTo({ section: 'hey' })}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all relative ${
                            section === 'hey'
                                ? 'bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-300'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        <Bell size={14} />
                        <span>{t('basecamp.hey')}</span>
                        {unreadHeyCount > 0 && (
                            <span className="absolute -top-1 -right-1 bg-red-500 text-white font-black text-[9px] w-4 h-4 rounded-full flex items-center justify-center">
                                {unreadHeyCount}
                            </span>
                        )}
                    </button>

                    <button
                        onClick={() => navigateTo({ section: 'pings' })}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                            section === 'pings' || pingUser
                                ? 'bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-300'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        <MessageSquare size={14} />
                        <span>{t('basecamp.pings')}</span>
                    </button>

                    <button
                        onClick={() => navigateTo({ section: 'mystuff' })}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                            section === 'mystuff'
                                ? 'bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-300'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        <User size={14} />
                        <span>{t('basecamp.my_stuff')}</span>
                    </button>

                    <button
                        onClick={() => setShowSearchModal(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                    >
                        <Search size={14} />
                        <span>{t('basecamp.find')}</span>
                    </button>

                    <button
                        onClick={handleSync}
                        disabled={syncing}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all border border-dashed border-blue-300 dark:border-slate-700"
                        title={t('basecamp.sync_btn')}
                    >
                        <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                        <span>{t('basecamp.sync_btn')}</span>
                    </button>
                </div>

                <div className="hidden md:flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-[#1D7DB5] text-white font-bold flex items-center justify-center text-xs shadow-inner">
                        {currentUserName[0]}
                    </div>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate max-w-[120px]">{currentUserName.split(' ')[0]}</span>
                </div>
            </header>
        )
    }

    const renderWorkspaceContent = () => {
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
                switch (toolId) {
                    case 'campfire':
                        return <ToolCampfire project={currentProject} currentUserName={currentUserName} />
                    case 'todos':
                        return <ToolTodos project={currentProject} currentUserName={currentUserName} />
                    case 'messages':
                        return <ToolMessages project={currentProject} currentUserName={currentUserName} />
                    case 'docs':
                        return <ToolDocs project={currentProject} currentUserName={currentUserName} />
                    case 'schedule':
                        return <ToolSchedule project={currentProject} currentUserName={currentUserName} />
                    case 'checkins':
                        return <ToolCheckins project={currentProject} currentUserName={currentUserName} />
                    default:
                        return <BasecampProject project={currentProject} navigateTo={navigateTo} saveProjects={saveProjects} projects={projects} currentUserName={currentUserName} />
                }
            }
            return <BasecampProject project={currentProject} navigateTo={navigateTo} saveProjects={saveProjects} projects={projects} currentUserName={currentUserName} />
        }

        return <BasecampHome projects={projects} saveProjects={saveProjects} navigateTo={navigateTo} userName={currentUserName} />
    }

    return (
        <div className="w-full min-h-[85vh] bg-[#f4f1ea] dark:bg-slate-950 p-2 sm:p-4 md:p-6 rounded-2xl border border-slate-200/60 dark:border-slate-800/80 shadow-2xl flex flex-col font-sans">
            {renderBasecampHeader()}
            
            <main className="flex-1 bg-[#fffdf9] dark:bg-slate-900 border-x border-b border-slate-200 dark:border-slate-800 rounded-b-2xl p-4 sm:p-6 md:p-8 min-h-[60vh] flex flex-col">
                {renderWorkspaceContent()}
            </main>

            {/* Modal de Búsqueda global (Find) */}
            {showSearchModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
                            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                <Search size={20} className="text-[#1D7DB5]" />
                                {t('basecamp.find')}
                            </h3>
                            <button
                                onClick={() => { setSearchQuery(''); setShowSearchModal(false) }}
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-bold"
                            >
                                Esc / ✕
                            </button>
                        </div>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={t('basecamp.search_placeholder')}
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#1D7DB5]"
                            autoFocus
                        />
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 text-center">
                            {t('basecamp.jump_description')}
                        </p>

                        {/* Resultados de búsqueda rápidos */}
                        {searchQuery.trim().length > 1 && (
                            <div className="mt-4 max-h-[300px] overflow-y-auto space-y-1">
                                {projects.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())).map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => {
                                            navigateTo({ project: p.id })
                                            setShowSearchModal(false)
                                            setSearchQuery('')
                                        }}
                                        className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-850 text-left border border-transparent hover:border-slate-100 dark:hover:border-slate-800 transition-colors"
                                    >
                                        <Briefcase size={16} className="text-blue-500" />
                                        <div>
                                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{p.name}</p>
                                            <p className="text-[10px] text-slate-400">Proyecto</p>
                                        </div>
                                    </button>
                                ))}

                                {searchQuery.toLowerCase().includes('todo') || searchQuery.toLowerCase().includes('tarea') ? (
                                    <button
                                        onClick={() => {
                                            navigateTo({ section: 'mystuff' })
                                            setShowSearchModal(false)
                                            setSearchQuery('')
                                        }}
                                        className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-850 text-left border border-transparent hover:border-slate-100 dark:hover:border-slate-800 transition-colors"
                                    >
                                        <Users size={16} className="text-purple-500" />
                                        <div>
                                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Ver To-dos en All Locations</p>
                                            <p className="text-[10px] text-slate-400">Herramienta de To-dos</p>
                                        </div>
                                    </button>
                                ) : null}
                            </div>
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
