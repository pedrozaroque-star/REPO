/**
 * @module Basecamp Page Controller
 * @description Módulo de enrutamiento y estado principal para la integración real de Basecamp.
 *              Controla las vistas de Home, Proyecto, Herramientas, Hey!, Pings y Mi Espacio a través de URL SearchParams.
 * @businessRules
 *   - Soporte 100% bilingüe (ES/EN) a través de `useLanguage()`.
 *   - Persistencia de datos real en Supabase con sincronización bidireccional API y suscripciones Realtime.
 *   - Integración resiliente con la sesión de usuario de Tacos Gavilan (`resolveOrCreateTegPerson`).
 * @dataFlow
 *   - Lee `project`, `tool`, `ping`, `section`, `todoId`, `messageId` y `docId` desde `useSearchParams`.
 *   - Consulta proyectos activos (`is_archived = false`), membresías y notificaciones no leídas desde Supabase.
 *   - Proporciona las herramientas principales (Campfire, To-dos, Message Board, Docs, Schedule, Check-ins) y cajón `NewForYouDrawer`.
 * @notes
 *   - Protege los atajos `Shift + J` y `h` contra elementos editables (`INPUT`, `TEXTAREA`, `SELECT`, `contentEditable`).
 *   - Búsqueda global insensible a acentos (`NFD`) con protección de secuencias asíncronas (`searchReqSeqRef`) y proxy de URLs Basecamp.
 *   - `onCloseDetail` actualiza la URL únicamente cuando un parámetro deep-link estaba activo, evitando contaminación de historial.
 */

'use client'

import React, { Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react'
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
    Home, MessageSquare, Bell, User, Search, ArrowLeft, Briefcase, KeyRound, RefreshCw,
    CheckSquare, Mail, Loader2, Play, FolderOpen
} from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import {
    resolveOrCreateTegPerson,
    normalizePersonName,
    isMaskedOrEmptyEmail,
    stripTegAuthorBanner,
} from '@/lib/basecamp-person-resolver'
import { proxyBasecampUrl } from '@/lib/basecamp-html'

const formatSearchDateTime = (dateStr: string, language: string) => {
    if (!dateStr) return ''
    try {
        const d = new Date(dateStr)
        if (Number.isNaN(d.getTime())) return ''
        const locale = language === 'es' ? 'es-MX' : 'en-US'
        const datePart = d.toLocaleDateString(locale, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'America/Los_Angeles',
        })
        const timePart = d
            .toLocaleTimeString(locale, {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: 'America/Los_Angeles',
            })
            .toLowerCase()
        return `${datePart} ${timePart}`
    } catch {
        return ''
    }
}

const stripAccentsLower = (s?: string | null): string => {
    if (!s) return ''
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export interface NavigateParams {
    project?: string
    tool?: string
    section?: string
    ping?: string
    tab?: string
    todoId?: string
    messageId?: string
    docId?: string
}

function BasecampWorkspace() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { t, language } = useLanguage()
    const { user } = useAuth()
    const supabase = useMemo(() => getSupabaseWithAuth(), [])

    const projectId = searchParams.get('project')
    const toolId = searchParams.get('tool')
    const section = searchParams.get('section') // 'pings' | 'hey' | 'mystuff'
    const pingUser = searchParams.get('ping')

    const [projects, setProjects] = useState<any[]>([])
    const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null)
    const [loading, setLoading] = useState(true)
    const [syncing, setSyncing] = useState(false)
    const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
    const [, setNowTick] = useState<number>(() => Date.now())
    const syncingRef = useRef(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [showSearchModal, setShowSearchModal] = useState(false)
    const [searchResults, setSearchResults] = useState<any[]>([])
    const [searchLoading, setSearchLoading] = useState(false)
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const searchReqSeqRef = useRef(0)
    const [unreadHeyCount, setUnreadHeyCount] = useState(0)
    const [resolvedPersonId, setResolvedPersonId] = useState<string | null>(null)
    const [heyDrawerOpen, setHeyDrawerOpen] = useState(false)

    const [currentTodoId, setCurrentTodoId] = useState<string | null>(searchParams.get('todoId'))
    const [currentMessageId, setCurrentMessageId] = useState<string | null>(searchParams.get('messageId'))
    const [currentDocId, setCurrentDocId] = useState<string | null>(searchParams.get('docId'))

    useEffect(() => {
        setCurrentTodoId(searchParams.get('todoId'))
        setCurrentMessageId(searchParams.get('messageId'))
        setCurrentDocId(searchParams.get('docId'))
    }, [searchParams])

    const currentUserName = user?.name || 'Sistema de Monitoreo'

    // 1. Fetch authorization status and projects
    const checkAuthAndLoadProjects = useCallback(async (opts?: { silent?: boolean }) => {
        if (!opts?.silent) setLoading(true)
        try {
            const statusRes = await fetch('/api/basecamp/status')
            if (!statusRes.ok) throw new Error('Failed to get status')
            const statusData = await statusRes.json()
            const { authorized, last_synced_at, is_stale, is_running } = statusData
            setIsAuthorized(authorized)
            if (last_synced_at) {
                setLastSyncedAt(last_synced_at)
            }

            if (authorized) {
                const { data: dbProjects, error } = await supabase
                    .from('bc_projects')
                    .select(`
                        *,
                        bc_memberships(
                            role,
                            person:bc_people(id, name, email, avatar_url, role)
                        )
                    `)
                    .eq('is_archived', false)
                    .order('name', { ascending: true })

                if (error) {
                    console.error('Error loading projects:', error.message)
                } else if (dbProjects) {
                    const formatted = dbProjects.map((p: any) => {
                        const seenMemberKeys = new Set<string>()
                        const members: any[] = []
                        ;(p.bc_memberships || []).forEach((m: any) => {
                            const personObj = Array.isArray(m.person) ? m.person[0] : m.person
                            if (!personObj) return
                            const mKey = personObj.id || normalizePersonName(personObj.name)
                            if (mKey && seenMemberKeys.has(mKey)) return
                            if (mKey) seenMemberKeys.add(mKey)
                            members.push({
                                id: personObj.id,
                                name: personObj.name || '',
                                email: isMaskedOrEmptyEmail(personObj.email) ? '' : personObj.email,
                                role: m.role || personObj.role || 'user',
                                avatar: personObj.avatar_url || '',
                            })
                        })

                        return {
                            id: String(p.bc_id),
                            db_id: p.id,
                            name: p.name,
                            description: p.description,
                            color: p.color || 'white',
                            is_pinned: Boolean(p.is_pinned),
                            peopleCount: members.length || Number(p.member_count) || 0,
                            people: members,
                        }
                    })
                    setProjects(formatted)
                }

                // Resolve current user resiliently (Pass 1+2+3+4, zero 406 errors) for unread notifications count
                if (user?.email || user?.name) {
                    const person = await resolveOrCreateTegPerson(supabase, {
                        email: user?.email,
                        name: user?.name,
                        role: (user as any)?.role,
                    })
                    if (person?.id) {
                        setResolvedPersonId(person.id)
                        const { count } = await supabase
                            .from('bc_notifications')
                            .select('*', { count: 'exact', head: true })
                            .eq('person_id', person.id)
                            .eq('is_read', false)

                        setUnreadHeyCount(count || 0)
                    }
                }

                // Stale-While-Revalidate: trigger silent background sync if stale (> 3m)
                if (is_stale && !is_running && !syncingRef.current) {
                    setTimeout(() => {
                        void handleSyncRef.current?.({ silent: true })
                    }, 300)
                }
            }
        } catch (err: any) {
            console.error('Error loading Basecamp workspace:', err.message)
        } finally {
            if (!opts?.silent) setLoading(false)
        }
    }, [user?.email, user?.name, supabase])

    // Trigger manual or silent background sync (returns boolean success)
    const handleSync = useCallback(async (opts?: { silent?: boolean; projectId?: string }): Promise<boolean> => {
        if (syncingRef.current) return true
        syncingRef.current = true
        setSyncing(true)
        try {
            const payload = opts?.projectId ? { projectId: Number(opts.projectId) } : { full: false }
            const res = await fetch('/api/basecamp/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
            const data = await res.json().catch(() => ({}))

            if (res.status === 409) {
                await new Promise((r) => setTimeout(r, 2000))
                await checkAuthAndLoadProjects({ silent: true })
                return true
            }

            if (!res.ok || data.status === 'failed') {
                throw new Error(data.error || t('basecamp.sync_error_fallback'))
            }
            if (data.synced_at) {
                setLastSyncedAt(data.synced_at)
            } else {
                setLastSyncedAt(new Date().toISOString())
            }
            setNowTick(Date.now())
            await checkAuthAndLoadProjects({ silent: true })
            return true
        } catch (err: any) {
            console.error('Sync failed:', err.message)
            if (!opts?.silent) {
                alert(`${t('basecamp.sync_error_prefix')}${err.message}`)
            }
            return false
        } finally {
            syncingRef.current = false
            setSyncing(false)
        }
    }, [checkAuthAndLoadProjects, t])

    const handleSyncRef = useRef(handleSync)
    handleSyncRef.current = handleSync

    useEffect(() => {
        checkAuthAndLoadProjects()
    }, [checkAuthAndLoadProjects])

    const saveProjects = async (updated: any[]) => {
        try {
            for (const up of updated) {
                const orig = projects.find((p) => p.id === up.id)
                if (orig && (orig.color !== up.color || orig.is_pinned !== up.is_pinned)) {
                    const { error } = await supabase
                        .from('bc_projects')
                        .update({
                            color: up.color,
                            is_pinned: up.is_pinned,
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

    // Background Auto-Sync Heartbeat (every 3 minutes) + Tab Focus / Visibility Revalidation + Realtime Listener
    useEffect(() => {
        if (!isAuthorized) return

        const tickInterval = setInterval(() => {
            setNowTick(Date.now())
        }, 30_000)

        const syncInterval = setInterval(() => {
            if (document.visibilityState === 'visible' && !syncingRef.current) {
                void handleSync({ silent: true, projectId: projectId || undefined })
            }
        }, 3 * 60 * 1000)

        const handleVisibilityOrFocus = () => {
            if (document.visibilityState === 'visible' && !syncingRef.current) {
                const ageMs = lastSyncedAt ? Date.now() - new Date(lastSyncedAt).getTime() : Infinity
                if (ageMs > 2 * 60 * 1000) {
                    void handleSync({ silent: true, projectId: projectId || undefined })
                }
            }
        }
        window.addEventListener('focus', handleVisibilityOrFocus)
        document.addEventListener('visibilitychange', handleVisibilityOrFocus)

        let channelBuilder = supabase
            .channel('basecamp-workspace-live')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'bc_sync_log' },
                (payload: any) => {
                    const row = payload.new as any
                    if (row?.status === 'completed' || row?.status === 'completed_with_errors') {
                        setLastSyncedAt(row.completed_at || new Date().toISOString())
                        setNowTick(Date.now())
                        void checkAuthAndLoadProjects({ silent: true })
                    }
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'bc_projects' },
                () => {
                    void checkAuthAndLoadProjects({ silent: true })
                }
            )

        if (resolvedPersonId) {
            channelBuilder = channelBuilder.on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'bc_notifications', filter: `person_id=eq.${resolvedPersonId}` },
                async () => {
                    const { count } = await supabase
                        .from('bc_notifications')
                        .select('*', { count: 'exact', head: true })
                        .eq('person_id', resolvedPersonId)
                        .eq('is_read', false)
                    setUnreadHeyCount(count || 0)
                }
            )
        }

        const channel = channelBuilder.subscribe()

        return () => {
            clearInterval(tickInterval)
            clearInterval(syncInterval)
            window.removeEventListener('focus', handleVisibilityOrFocus)
            document.removeEventListener('visibilitychange', handleVisibilityOrFocus)
            supabase.removeChannel(channel)
        }
    }, [isAuthorized, projectId, lastSyncedAt, resolvedPersonId, handleSync, checkAuthAndLoadProjects, supabase])

    const navigateTo = useCallback((params: NavigateParams) => {
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

        if (params.messageId) {
            query.set('messageId', params.messageId)
            setCurrentMessageId(params.messageId)
        } else {
            setCurrentMessageId(null)
        }

        if (params.docId) {
            query.set('docId', params.docId)
            setCurrentDocId(params.docId)
        } else {
            setCurrentDocId(null)
        }

        const qs = query.toString()
        router.push(qs ? `/basecamp?${qs}` : '/basecamp')
    }, [router])

    const currentProject = projects.find((p) => p.id === projectId)

    // Strip TEG author banner, <bc-attachment>, HTML tags, and decode entities for search snippets
    const stripHtml = (html?: string | null) => {
        if (!html) return ''
        const { cleanHtml } = stripTegAuthorBanner(html)
        return cleanHtml
            .replace(/<bc-attachment[\s\S]*?<\/bc-attachment>/gi, ' ')
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

    // Extract image and video URLs from HTML content and proxy raw Basecamp URLs
    const extractMediaUrls = (html?: string | null) => {
        const media: { type: 'image' | 'video'; url: string }[] = []
        if (!html) return media

        const seen = new Set<string>()
        const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi
        let match
        while ((match = imgRegex.exec(html)) !== null) {
            const rawUrl = match[1]
            if (!rawUrl || rawUrl.includes('attachment-icon')) continue
            const proxied = proxyBasecampUrl(rawUrl)
            if (proxied && !seen.has(proxied)) {
                seen.add(proxied)
                media.push({ type: 'image', url: proxied })
            }
        }

        const videoRegex = /<(?:video|source)[^>]+src=["']([^"']+)["']/gi
        while ((match = videoRegex.exec(html)) !== null) {
            const proxied = proxyBasecampUrl(match[1])
            if (proxied && !seen.has(proxied)) {
                seen.add(proxied)
                media.push({ type: 'video', url: proxied })
            }
        }

        return media
    }

    // ── Global search across Supabase tables with debounce, race-guard & accent normalization ──
    const executeSearch = useCallback(async (query: string) => {
        const trimmed = query.trim()
        if (trimmed.length < 3) {
            searchReqSeqRef.current++
            setSearchResults([])
            setSearchLoading(false)
            return
        }

        const reqSeq = ++searchReqSeqRef.current
        setSearchLoading(true)

        try {
            const normQuery = stripAccentsLower(trimmed)
            const normPersonQuery = normalizePersonName(trimmed)

            // Escape special PostgREST / SQL wildcard chars and quote inside .or(...)
            const sanitizedLiteral = trimmed.replace(/[%_\\"]/g, ' ').replace(/\s+/g, ' ').trim()
            if (!sanitizedLiteral) {
                if (reqSeq === searchReqSeqRef.current) {
                    setSearchResults([])
                    setSearchLoading(false)
                }
                return
            }

            const exactQuoted = `"%${sanitizedLiteral}%"`
            const asciiVariant = sanitizedLiteral.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            const wildcardVariant = sanitizedLiteral.replace(/[aáeéiíoóuúüñAÁEÉIÍOÓUÚÜÑ]/g, '_')
            const hasConsonants = sanitizedLiteral.replace(/[aáeéiíoóuúüñAÁEÉIÍOÓUÚÜÑ\s]/g, '').length >= 2

            const buildDualOrFilter = (colA: string, colB: string) => {
                const clauses = [`${colA}.ilike.${exactQuoted}`, `${colB}.ilike.${exactQuoted}`]
                if (asciiVariant && asciiVariant !== sanitizedLiteral) {
                    const asciiQuoted = `"%${asciiVariant}%"`
                    clauses.push(`${colA}.ilike.${asciiQuoted}`, `${colB}.ilike.${asciiQuoted}`)
                }
                if (hasConsonants && wildcardVariant !== sanitizedLiteral) {
                    const wildQuoted = `"%${wildcardVariant}%"`
                    clauses.push(`${colA}.ilike.${wildQuoted}`, `${colB}.ilike.${wildQuoted}`)
                }
                return clauses.join(',')
            }

            const [todosRes, messagesRes, docsRes, peopleRes] = await Promise.all([
                supabase
                    .from('bc_todos')
                    .select('id, title, description, created_at, project_id')
                    .or(buildDualOrFilter('title', 'description'))
                    .order('created_at', { ascending: false })
                    .limit(25),
                supabase
                    .from('bc_messages')
                    .select('id, title, content, created_at, project_id')
                    .or(buildDualOrFilter('title', 'content'))
                    .order('created_at', { ascending: false })
                    .limit(25),
                supabase
                    .from('bc_documents')
                    .select('id, title, content, created_at, project_id')
                    .or(buildDualOrFilter('title', 'content'))
                    .order('created_at', { ascending: false })
                    .limit(25),
                supabase
                    .from('bc_people')
                    .select('id, name, email, title, role')
                    .eq('is_active', true)
                    .limit(500),
            ])

            // Discard stale out-of-order response
            if (reqSeq !== searchReqSeqRef.current) return

            const results: any[] = []

            // 1. Projects (accent-insensitive local match)
            projects
                .filter((p) => stripAccentsLower(p.name).includes(normQuery) || stripAccentsLower(p.description).includes(normQuery))
                .forEach((p) => {
                    results.push({ type: 'project', id: p.id, label: p.name, projectId: p.id })
                })

            // 2. Todos (verify accent-insensitive match in JS to eliminate SQL '_' false positives)
            if (todosRes.data) {
                todosRes.data
                    .filter((row: any) => stripAccentsLower(`${row.title || ''} ${stripHtml(row.description)}`).includes(normQuery))
                    .slice(0, 10)
                    .forEach((row: any) => {
                        const proj = projects.find((p) => p.db_id === row.project_id)
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

            // 3. Messages
            if (messagesRes.data) {
                messagesRes.data
                    .filter((row: any) => stripAccentsLower(`${row.title || ''} ${stripHtml(row.content)}`).includes(normQuery))
                    .slice(0, 10)
                    .forEach((row: any) => {
                        const proj = projects.find((p) => p.db_id === row.project_id)
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

            // 4. Documents
            if (docsRes.data) {
                docsRes.data
                    .filter((row: any) => stripAccentsLower(`${row.title || ''} ${stripHtml(row.content)}`).includes(normQuery))
                    .slice(0, 10)
                    .forEach((row: any) => {
                        const proj = projects.find((p) => p.db_id === row.project_id)
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

            // 5. People (accent-insensitive + normalizePersonName spelling variants, clean email)
            if (peopleRes.data) {
                peopleRes.data
                    .filter((row: any) => {
                        const cleanEmail = isMaskedOrEmptyEmail(row.email) ? '' : String(row.email)
                        return (
                            stripAccentsLower(row.name).includes(normQuery) ||
                            stripAccentsLower(cleanEmail).includes(normQuery) ||
                            (normPersonQuery.length > 0 && normalizePersonName(row.name).includes(normPersonQuery))
                        )
                    })
                    .slice(0, 10)
                    .forEach((row: any) => {
                        results.push({
                            type: 'person',
                            id: row.id,
                            label: row.name,
                            email: isMaskedOrEmptyEmail(row.email) ? '' : row.email,
                        })
                    })
            }

            setSearchResults(results)
        } catch (err) {
            console.error('Global search error:', err)
            if (reqSeq === searchReqSeqRef.current) setSearchResults([])
        } finally {
            if (reqSeq === searchReqSeqRef.current) setSearchLoading(false)
        }
    }, [projects, supabase])

    const handleSearchInput = useCallback((value: string) => {
        setSearchQuery(value)
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
        if (value.trim().length < 3) {
            searchReqSeqRef.current++
            setSearchResults([])
            setSearchLoading(false)
            return
        }
        setSearchLoading(true)
        searchTimerRef.current = setTimeout(() => {
            void executeSearch(value)
        }, 250)
    }, [executeSearch])

    useEffect(() => {
        return () => {
            if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
        }
    }, [])

    // Keyboard shortcuts: Escape, Shift + J (Find), h (Home) — guarded against editable inputs/rich-text
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (showSearchModal) {
                    e.preventDefault()
                    searchReqSeqRef.current++
                    setSearchQuery('')
                    setSearchResults([])
                    setSearchLoading(false)
                    setShowSearchModal(false)
                }
                return
            }

            const target = e.target as HTMLElement | null
            const isEditable = Boolean(
                target &&
                (
                    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
                    target.isContentEditable ||
                    target.closest?.('[contenteditable="true"]')
                )
            )
            if (isEditable || e.ctrlKey || e.metaKey || e.altKey) return

            if (e.key.toUpperCase() === 'J' && e.shiftKey) {
                e.preventDefault()
                setShowSearchModal(true)
            } else if (e.key === 'h' && !e.shiftKey && !showSearchModal && !heyDrawerOpen) {
                navigateTo({})
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [showSearchModal, heyDrawerOpen, navigateTo])

    const closeSearchModal = () => {
        searchReqSeqRef.current++
        setSearchQuery('')
        setSearchResults([])
        setSearchLoading(false)
        setShowSearchModal(false)
    }

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

    if (projects.length === 0 && !syncing) {
        return (
            <div className="w-full min-h-[70vh] bg-[#f4f1ea] dark:bg-slate-950 p-6 rounded-2xl flex items-center justify-center font-sans">
                <div className="max-w-md w-full bg-[#fffdf9] dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 text-center shadow-xl">
                    <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-6 shadow-inner">
                        <RefreshCw size={32} />
                    </div>
                    <h2 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100 mb-2">{t('basecamp.initial_sync_title')}</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                        {t('basecamp.initial_sync_desc')}
                    </p>
                    <button
                        onClick={() => void handleSync()}
                        className="inline-flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] text-white font-extrabold text-sm shadow-md transition-all animate-pulse"
                    >
                        <RefreshCw size={16} />
                        <span>{t('basecamp.sync_now')}</span>
                    </button>
                </div>
            </div>
        )
    }

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

    const getSyncRelativeLabel = () => {
        if (!lastSyncedAt) return t('basecamp.auto_sync_live')
        const diffMins = Math.max(0, Math.floor((Date.now() - new Date(lastSyncedAt).getTime()) / 60000))
        if (diffMins < 1) return t('basecamp.synced_just_now')
        return `${t('basecamp.synced_mins_ago')} ${diffMins} ${t('basecamp.mins_ago_suffix')}`
    }

    const renderBasecampHeader = () => {
        const userInitial = String(currentUserName || '?').trim()[0] || '?'
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
                    {projectId && currentProject && (
                        <button
                            onClick={() => navigateTo({ project: projectId })}
                            className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                        >
                            <ArrowLeft size={12} />
                            <span className="truncate max-w-[90px] sm:max-w-xs font-semibold">{currentProject.name}</span>
                        </button>
                    )}
                </div>

                <div className="flex items-center justify-end gap-1 sm:gap-1.5 overflow-x-auto no-scrollbar py-0.5 flex-1">
                    <div
                        className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/60 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 shrink-0"
                        title={t('basecamp.auto_sync_tooltip')}
                    >
                        <span className={`w-1.5 h-1.5 rounded-full ${syncing ? 'bg-blue-500 animate-ping' : 'bg-emerald-500 animate-pulse'}`} />
                        <span>{syncing ? t('basecamp.syncing_in_progress') : getSyncRelativeLabel()}</span>
                    </div>

                    <button
                        onClick={() => setHeyDrawerOpen(true)}
                        className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 ${
                            section === 'hey' || heyDrawerOpen
                                ? 'bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-300'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        <Bell size={13} />
                        <span className="hidden sm:inline">{t('basecamp.hey_short')}</span>
                        {unreadHeyCount > 0 && (
                            <span className="bg-red-500 text-white font-black text-[9px] min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center">
                                {unreadHeyCount}
                            </span>
                        )}
                    </button>

                    <button
                        onClick={() => navigateTo({ section: 'pings' })}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 ${
                            section === 'pings' || pingUser
                                ? 'bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-300'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        <MessageSquare size={13} />
                        <span className="hidden sm:inline">{t('basecamp.pings_short')}</span>
                    </button>

                    <button
                        onClick={() => navigateTo({ section: 'mystuff' })}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 ${
                            section === 'mystuff'
                                ? 'bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-300'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        <User size={13} />
                        <span className="hidden sm:inline">{t('basecamp.my_stuff')}</span>
                    </button>

                    <button
                        onClick={() => setShowSearchModal(true)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all shrink-0"
                    >
                        <Search size={13} />
                        <span className="hidden sm:inline">{t('basecamp.find')}</span>
                    </button>

                    <button
                        onClick={() => void handleSync({ projectId: projectId || undefined })}
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
                    <div className="w-8 h-8 rounded-full bg-[#1D7DB5] text-white font-bold flex items-center justify-center text-xs shadow-inner uppercase">
                        {userInitial}
                    </div>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate max-w-[120px]">
                        {String(currentUserName || '').trim().split(/\s+/)[0]}
                    </span>
                </div>
            </header>
        )
    }

    const clearDeepLinkParamIfActive = (paramName: 'todoId' | 'messageId' | 'docId', activeStateVal: string | null, clearState: () => void) => {
        const query = new URLSearchParams(window.location.search)
        const wasActive = Boolean(activeStateVal) || query.has(paramName)
        if (activeStateVal) clearState()
        if (wasActive && query.has(paramName)) {
            query.delete(paramName)
            const qs = query.toString()
            router.replace(qs ? `/basecamp?${qs}` : '/basecamp', { scroll: false })
        }
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
                                onCloseDetail={() => clearDeepLinkParamIfActive('todoId', currentTodoId, () => setCurrentTodoId(null))}
                                navigateTo={navigateTo}
                            />
                        )
                    case 'messages':
                    case 'message':
                    case 'message_board':
                    case 'message-board':
                        return (
                            <ToolMessages
                                project={currentProject}
                                currentUserName={currentUserName}
                                selectedMessageId={currentMessageId || undefined}
                                onCloseDetail={() => clearDeepLinkParamIfActive('messageId', currentMessageId, () => setCurrentMessageId(null))}
                            />
                        )
                    case 'docs':
                    case 'doc':
                    case 'document':
                    case 'documents':
                    case 'vault':
                    case 'uploads':
                    case 'files':
                    case 'file':
                        return (
                            <ToolDocs
                                project={currentProject}
                                currentUserName={currentUserName}
                                selectedDocId={currentDocId || undefined}
                                onCloseDetail={() => clearDeepLinkParamIfActive('docId', currentDocId, () => setCurrentDocId(null))}
                            />
                        )
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
                        return (
                            <BasecampProject
                                project={currentProject}
                                navigateTo={navigateTo}
                                saveProjects={saveProjects}
                                projects={projects}
                                currentUserName={currentUserName}
                                onOpenSearch={() => setShowSearchModal(true)}
                            />
                        )
                }
            }
            return (
                <BasecampProject
                    project={currentProject}
                    navigateTo={navigateTo}
                    saveProjects={saveProjects}
                    projects={projects}
                    currentUserName={currentUserName}
                    onOpenSearch={() => setShowSearchModal(true)}
                />
            )
        }

        return (
            <BasecampHome
                projects={projects}
                saveProjects={saveProjects}
                navigateTo={navigateTo}
                userName={currentUserName}
                onOpenSearch={() => setShowSearchModal(true)}
                onOpenHeyDrawer={() => setHeyDrawerOpen(true)}
                unreadHeyCount={unreadHeyCount}
                onSync={() => handleSync()}
                isBackgroundSyncing={syncing}
                lastSyncedAt={lastSyncedAt}
            />
        )
    }

    const isHome = !projectId && !toolId && !section && !pingUser

    const renderMediaStrip = (mediaList?: { type: 'image' | 'video'; url: string }[]) => {
        if (!mediaList || mediaList.length === 0) return null
        return (
            <div className="flex flex-wrap gap-2 mt-1">
                {mediaList.slice(0, 5).map((m, idx) => {
                    if (m.type === 'image') {
                        return (
                            <img
                                key={idx}
                                src={m.url}
                                alt={t('basecamp.preview_thumbnail')}
                                className="w-12 h-12 rounded-lg object-cover border border-slate-200 dark:border-slate-700 bg-white"
                            />
                        )
                    }
                    if (m.type === 'video') {
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
                {mediaList.length > 5 && (
                    <div className="w-12 h-12 rounded-lg bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-500">
                        +{mediaList.length - 5}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="relative w-full min-h-[85vh] bg-[#f4f1ea] dark:bg-slate-950 p-2 sm:p-4 md:p-6 rounded-2xl border border-slate-200/60 dark:border-slate-800/80 shadow-2xl flex flex-col font-sans pb-16">
            {!isHome && renderBasecampHeader()}

            <main className={`flex-1 bg-[#fffdf9] dark:bg-slate-900 rounded-2xl p-4 sm:p-6 md:p-8 min-h-[60vh] flex flex-col ${!isHome ? 'border-x border-b border-slate-200 dark:border-slate-800 rounded-t-none' : 'border border-slate-200/60 dark:border-slate-800'}`}>
                {renderWorkspaceContent()}
            </main>

            {/* Cajón lateral derecho: New For You (Hey! & Pings) */}
            <NewForYouDrawer
                isOpen={heyDrawerOpen}
                onClose={() => setHeyDrawerOpen(false)}
                onMarkAllRead={() => setUnreadHeyCount(0)}
                navigateTo={navigateTo}
            />

            {/* Modal de Búsqueda global (Find / Shift + J) */}
            {showSearchModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
                    onClick={(e) => { if (e.target === e.currentTarget) closeSearchModal() }}
                >
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
                            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                <Search size={20} className="text-[#1D7DB5]" />
                                {t('basecamp.find')}
                            </h3>
                            <button
                                onClick={closeSearchModal}
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-bold text-xs px-2 py-1 rounded border border-slate-200 dark:border-slate-700"
                            >
                                {t('basecamp.esc_key')}
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

                        {searchQuery.trim().length > 0 && searchQuery.trim().length < 3 && (
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-3 text-center">
                                {t('basecamp.search_min_chars')}
                            </p>
                        )}

                        {searchLoading && (
                            <div className="flex items-center justify-center gap-2 py-6">
                                <Loader2 size={18} className="animate-spin text-[#1D7DB5]" />
                                <span className="text-sm text-slate-500 dark:text-slate-400 font-semibold">{t('basecamp.search_searching')}</span>
                            </div>
                        )}

                        {!searchLoading && searchQuery.trim().length >= 3 && (
                            <div className="mt-4 max-h-[480px] overflow-y-auto flex flex-col gap-4">
                                {searchResults.length === 0 ? (
                                    <div className="text-center py-6">
                                        <Search size={32} className="mx-auto mb-2 text-slate-400" />
                                        <p className="text-sm text-slate-500 dark:text-slate-400 font-semibold">
                                            {t('basecamp.search_no_results')} &ldquo;{searchQuery}&rdquo;
                                        </p>
                                    </div>
                                ) : (
                                    <>
                                        {/* Group: Projects */}
                                        {searchResults.filter((r) => r.type === 'project').length > 0 && (
                                            <div className="flex flex-col gap-1">
                                                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-1 pt-1.5 pb-0.5">
                                                    {t('basecamp.search_type_projects')}
                                                </p>
                                                {searchResults.filter((r) => r.type === 'project').map((r) => (
                                                    <button
                                                        key={`proj-${r.id}`}
                                                        onClick={() => { navigateTo({ project: r.projectId }); closeSearchModal() }}
                                                        className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-left transition-colors border border-transparent"
                                                    >
                                                        <Briefcase size={16} className="text-blue-500 shrink-0" />
                                                        <div className="min-w-0">
                                                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{r.label}</p>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        {/* Group: Todos */}
                                        {searchResults.filter((r) => r.type === 'todo').length > 0 && (
                                            <div className="flex flex-col gap-2.5">
                                                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-1 pt-1.5 pb-0.5">
                                                    {t('basecamp.search_type_tasks')}
                                                </p>
                                                {searchResults
                                                    .filter((r) => r.type === 'todo')
                                                    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
                                                    .map((r) => {
                                                        const cleanSnippet = stripHtml(r.description)
                                                        return (
                                                            <button
                                                                key={`todo-${r.id}`}
                                                                onClick={() => { navigateTo({ project: r.projectId, tool: 'todos', todoId: r.id }); closeSearchModal() }}
                                                                className="w-full flex flex-col gap-2 p-3.5 rounded-xl bg-slate-50/50 hover:bg-slate-100 dark:bg-slate-800/30 dark:hover:bg-slate-800/70 border border-slate-200 dark:border-slate-800 text-left transition-all duration-200 shadow-sm"
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
                                                                {cleanSnippet && (
                                                                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                                                                        {cleanSnippet}
                                                                    </p>
                                                                )}
                                                                {renderMediaStrip(r.media)}
                                                            </button>
                                                        )
                                                    })}
                                            </div>
                                        )}

                                        {/* Group: Messages */}
                                        {searchResults.filter((r) => r.type === 'message').length > 0 && (
                                            <div className="flex flex-col gap-2.5">
                                                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-1 pt-1.5 pb-0.5">
                                                    {t('basecamp.search_type_messages')}
                                                </p>
                                                {searchResults
                                                    .filter((r) => r.type === 'message')
                                                    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
                                                    .map((r) => {
                                                        const cleanSnippet = stripHtml(r.description)
                                                        return (
                                                            <button
                                                                key={`msg-${r.id}`}
                                                                onClick={() => { navigateTo({ project: r.projectId, tool: 'messages', messageId: r.id }); closeSearchModal() }}
                                                                className="w-full flex flex-col gap-2 p-3.5 rounded-xl bg-slate-50/50 hover:bg-slate-100 dark:bg-slate-800/30 dark:hover:bg-slate-800/70 border border-slate-200 dark:border-slate-800 text-left transition-all duration-200 shadow-sm"
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
                                                                {cleanSnippet && (
                                                                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                                                                        {cleanSnippet}
                                                                    </p>
                                                                )}
                                                                {renderMediaStrip(r.media)}
                                                            </button>
                                                        )
                                                    })}
                                            </div>
                                        )}

                                        {/* Group: Documents */}
                                        {searchResults.filter((r) => r.type === 'document').length > 0 && (
                                            <div className="flex flex-col gap-2.5">
                                                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-1 pt-1.5 pb-0.5">
                                                    {t('basecamp.search_type_documents')}
                                                </p>
                                                {searchResults
                                                    .filter((r) => r.type === 'document')
                                                    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
                                                    .map((r) => {
                                                        const cleanSnippet = stripHtml(r.description)
                                                        return (
                                                            <button
                                                                key={`doc-${r.id}`}
                                                                onClick={() => { navigateTo({ project: r.projectId, tool: 'docs', docId: r.id }); closeSearchModal() }}
                                                                className="w-full flex flex-col gap-2 p-3.5 rounded-xl bg-slate-50/50 hover:bg-slate-100 dark:bg-slate-800/30 dark:hover:bg-slate-800/70 border border-slate-200 dark:border-slate-800 text-left transition-all duration-200 shadow-sm"
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
                                                                {cleanSnippet && (
                                                                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                                                                        {cleanSnippet}
                                                                    </p>
                                                                )}
                                                                {renderMediaStrip(r.media)}
                                                            </button>
                                                        )
                                                    })}
                                            </div>
                                        )}

                                        {/* Group: People (clickable -> opens Pings chat) */}
                                        {searchResults.filter((r) => r.type === 'person').length > 0 && (
                                            <div className="flex flex-col gap-1">
                                                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-1 pt-1.5 pb-0.5">
                                                    {t('basecamp.search_type_people')}
                                                </p>
                                                {searchResults.filter((r) => r.type === 'person').map((r) => (
                                                    <button
                                                        key={`person-${r.id}`}
                                                        onClick={() => { navigateTo({ section: 'pings', ping: r.label }); closeSearchModal() }}
                                                        className="w-full flex items-center gap-3 p-2.5 rounded-lg text-left bg-slate-50/30 hover:bg-slate-100 dark:bg-slate-800/20 dark:hover:bg-slate-800/60 border border-slate-100 dark:border-slate-800 transition-colors"
                                                    >
                                                        <User size={16} className="text-pink-500 shrink-0" />
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{r.label}</p>
                                                            {r.email && <p className="text-[10px] text-slate-400 truncate">{r.email}</p>}
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}

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
