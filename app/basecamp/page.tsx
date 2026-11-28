/**
 * @module Basecamp Page Controller
 * @description Módulo de enrutamiento y estado principal para la integración real de Basecamp.
 *              Controla las vistas de Home, Proyecto, Herramientas, Hey!, Pings y Mi Espacio a través de URL SearchParams.
 * @businessRules
 *   - Soporte 100% bilingüe (ES/EN) a través de `useLanguage()`.
 *   - Persistencia de datos real en Supabase con sincronización bidireccional API y suscripciones Realtime.
 *   - Integración resiliente con la sesión de usuario de Tacos Gavilan (`resolveOrCreateTegPerson`).
 * @dataFlow
 *   - Lee `project`, `tool`, `ping`, `section`, `todoId`, `replicateTodoId`, `messageId`, `replicateMessageId` y `docId` desde `useSearchParams`.
 *   - Consulta proyectos activos (`is_archived = false`, incluyendo `enabled_tools`), membresías (`attachable_sgid`, `email`, `title`) y notificaciones no leídas desde Supabase.
 *   - Proporciona las herramientas principales (Campfire, To-dos, Message Board, Docs, Schedule, Check-ins) y cajón `NewForYouDrawer`.
 * @notes
 *   - Protege los atajos `Shift + J` y `h` contra elementos editables (`INPUT`, `TEXTAREA`, `SELECT`, `contentEditable`).
 *   - Búsqueda global insensible a acentos (`NFD`) con protección de secuencias asíncronas (`searchReqSeqRef`) y proxy de URLs Basecamp.
 *   - `onCloseDetail` actualiza la URL únicamente cuando un parámetro deep-link estaba activo, evitando contaminación de historial.
 *   - Fix 2026-11-21: reubicados `handleConsumeReplicateTodo` y `handleConsumeReplicateMessage` (`useCallback`) antes de los retornos tempranos (`if (loading)` / `if (isAuthorized === false)`) para cumplir estrictamente las Reglas de Hooks de React en todos los renders.
 *   - Fix 2026-11-21 (Cold-Load Deep-Link): hidratación resiliente de `project`, `tool`, `todoId`, `messageId` y `docId` desde `useSearchParams` + `window.location.search` en carga fría, soporte de `project` por `bc_id` o `UUID` (incluyendo proyectos archivados) e inferencia automática de herramienta cuando viene `todoId`/`messageId`/`docId`.
 *   - Autonomía Basecamp Standalone (2026-11-21): cero bloqueo OAuth al apagar Basecamp 3, switch Admin (`Modo Híbrido` <-> `Modo 100% Independiente TEG` + auto-corte), privacidad estricta por `bc_memberships` en Home/URLs/Buscador/Hey!/Mi Espacio, e interceptor delegado de enlaces históricos `https://(app|3).basecamp.com/5052386/buckets/...`.
 *   - Rediseño SaaS Web + Móvil (2026-11-28): superficie única sin doble encajonado de paddings (`-mx-2 sm:mx-auto max-w-[1360px]`), barra superior sticky compacta `h-12` de 1 fila y modal Spotlight `Shift+J` adaptado a móvil (`max-h-[86dvh]`, títulos `line-clamp-2`).
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
    CheckSquare, Mail, Loader2, Play, FolderOpen, X, Check
} from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import {
    resolveOrCreateTegPerson,
    canonicalizeBasecampEmail,
    canonicalizeBasecampDisplayName,
    findPersonInListByFuzzyName,
    normalizePersonName,
    isMaskedOrEmptyEmail,
    stripTegAuthorBanner,
} from '@/lib/basecamp-person-resolver'
import {
    proxyBasecampUrl,
    isVideoMimeOrFilename,
    canUserAccessBasecampProject,
    parseInterceptableBasecampHref,
    buildBasecampJsonHeaders,
} from '@/lib/basecamp-html'

const stripLeadingCatEmoji = (label: string): string =>
    String(label || '')
        .replace(/^(?:📢|ℹ️|✨|❤️|❤|💡|👋|❓|💬|📋|⚠️|⚠)\uFE0F?\s*/u, '')
        .trim()

const getSearchMessageCategoryBadge = (rawCat: string | null | undefined, t: (key: string) => string): string => {
    const norm = String(rawCat || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
    if (norm.includes('anuncio') || norm.includes('announcement')) {
        return `📢 ${stripLeadingCatEmoji(t('basecamp.cat_announcement'))}`
    }
    if (norm === 'fyi' || norm.includes('fyi') || norm.includes('informacion') || norm.includes('aviso')) {
        return `✨ ${stripLeadingCatEmoji(t('basecamp.cat_fyi'))}`
    }
    if (norm.includes('heartbeat') || norm.includes('pulso')) {
        return `❤️ ${stripLeadingCatEmoji(t('basecamp.cat_heartbeat'))}`
    }
    if (norm.includes('pitch') || norm.includes('propuesta') || norm.includes('idea')) {
        return `💡 ${stripLeadingCatEmoji(t('basecamp.cat_pitch'))}`
    }
    if (norm.includes('question') || norm.includes('pregunta')) {
        return `👋 ${stripLeadingCatEmoji(t('basecamp.cat_question'))}`
    }
    if (norm.includes('procedimiento') || norm.includes('procedure') || norm.includes('guide')) {
        return t('basecamp.cat_guide')
    }
    if (norm.includes('alerta') || norm.includes('alert') || norm.includes('urgent')) {
        return t('basecamp.cat_alert')
    }
    if (!norm || norm === 'general') {
        return `💬 ${stripLeadingCatEmoji(t('basecamp.cat_general'))}`
    }
    return `💬 ${rawCat}`
}

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

const SEARCH_TODOLIST_COLOR_HEX: Record<string, string> = {
    blue: '#1D7DB5',
    orange: '#EA580C',
    green: '#16A34A',
    red: '#DC2626',
    purple: '#8E44AD',
    pink: '#DB2777',
    yellow: '#D97706',
    turquoise: '#0D9488',
    teal: '#0D9488',
    brown: '#92400E',
    gray: '#64748B',
    grey: '#64748B',
    white: '#94A3B8',
}

const resolveSearchTodolistHex = (color?: string | null): string => {
    if (!color) return '#1D7DB5'
    return SEARCH_TODOLIST_COLOR_HEX[String(color).toLowerCase().trim()] || '#1D7DB5'
}

export interface NavigateParams {
    project?: string
    tool?: string
    section?: string
    ping?: string
    tab?: string
    todoId?: string
    replicateTodoId?: string
    messageId?: string
    replicateMessageId?: string
    docId?: string
}

function BasecampWorkspace() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { t, language } = useLanguage()
    const { user, loading: authLoading } = useAuth()
    const supabase = useMemo(() => getSupabaseWithAuth(), [])
    const isAdmin = useMemo(
        () => ['admin', 'administrador'].includes(String((user as any)?.role || '').trim().toLowerCase()),
        [user]
    )

    const readUrlParam = useCallback(
        (key: string): string | null => {
            const fromHook = searchParams.get(key)
            if (fromHook !== null) return fromHook
            if (searchParams.toString() === '' && typeof window !== 'undefined' && window.location.search) {
                return new URLSearchParams(window.location.search).get(key)
            }
            return null
        },
        [searchParams]
    )

    const projectId = readUrlParam('project')
    const toolId = readUrlParam('tool')
    const section = readUrlParam('section') // 'pings' | 'hey' | 'mystuff'
    const pingUser = readUrlParam('ping')

    const [allProjects, setAllProjects] = useState<any[]>([])
    const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null)
    const [runtimeMode, setRuntimeMode] = useState<'hybrid' | 'standalone'>('hybrid')
    const [standaloneFlag, setStandaloneFlag] = useState<boolean>(false)
    const [autoCutoverEnabled, setAutoCutoverEnabled] = useState<boolean>(true)
    const [oauthConnected, setOauthConnected] = useState<boolean>(true)
    const [hasLocalData, setHasLocalData] = useState<boolean>(false)
    const [identityResolved, setIdentityResolved] = useState<boolean>(false)
    const [showModeModal, setShowModeModal] = useState<boolean>(false)
    const [savingMode, setSavingMode] = useState<boolean>(false)
    const [modeError, setModeError] = useState<string | null>(null)
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
    const [resolvedPersonName, setResolvedPersonName] = useState<string | null>(null)
    const [heyDrawerOpen, setHeyDrawerOpen] = useState(false)

    const isStandaloneMode = Boolean(
        standaloneFlag || runtimeMode === 'standalone' || (!oauthConnected && hasLocalData)
    )

    const [currentTodoId, setCurrentTodoId] = useState<string | null>(() => readUrlParam('todoId'))
    const [currentReplicateTodoId, setCurrentReplicateTodoId] = useState<string | null>(() => readUrlParam('replicateTodoId'))
    const [currentMessageId, setCurrentMessageId] = useState<string | null>(() => readUrlParam('messageId'))
    const [currentReplicateMessageId, setCurrentReplicateMessageId] = useState<string | null>(() => readUrlParam('replicateMessageId'))
    const [currentDocId, setCurrentDocId] = useState<string | null>(() => readUrlParam('docId'))

    useEffect(() => {
        setCurrentTodoId(readUrlParam('todoId'))
        setCurrentReplicateTodoId(readUrlParam('replicateTodoId'))
        setCurrentMessageId(readUrlParam('messageId'))
        setCurrentReplicateMessageId(readUrlParam('replicateMessageId'))
        setCurrentDocId(readUrlParam('docId'))
    }, [readUrlParam])

    const currentUserEmail = useMemo(() => canonicalizeBasecampEmail(user?.email), [user?.email])

    const projects = useMemo(() => {
        if (isAdmin) return allProjects
        return allProjects.filter((p) =>
            canUserAccessBasecampProject(p, {
                isAdmin: false,
                resolvedPersonId,
                canonicalEmail: currentUserEmail,
            })
        )
    }, [allProjects, isAdmin, resolvedPersonId, currentUserEmail])

    const allowedProjectIds = useMemo(
        () => projects.map((p) => p.db_id).filter(Boolean) as string[],
        [projects]
    )
    const allowedProjectIdSet = useMemo(() => new Set(allowedProjectIds), [allowedProjectIds])

    const currentUserName = useMemo(() => {
        if (resolvedPersonName) return resolvedPersonName
        const canonicalInputName = canonicalizeBasecampDisplayName(user?.name, currentUserEmail)
        for (const p of allProjects) {
            if (Array.isArray(p?.people) && p.people.length > 0) {
                const match = findPersonInListByFuzzyName(p.people, canonicalInputName, currentUserEmail)
                if (match?.name) return String(match.name).trim()
            }
        }
        return canonicalInputName || 'Sistema de Monitoreo'
    }, [resolvedPersonName, user?.name, currentUserEmail, allProjects])

    // 1. Fetch autonomy/auth status, resolve current person FIRST, and load projects
    const checkAuthAndLoadProjects = useCallback(async (opts?: { silent?: boolean }) => {
        if (!opts?.silent) setLoading(true)
        try {
            let statusData: any = {}
            try {
                const statusRes = await fetch('/api/basecamp/status', {
                    headers: buildBasecampJsonHeaders(),
                })
                if (statusRes.ok) {
                    statusData = await statusRes.json()
                }
            } catch {
                // Resilient fallback to local Supabase data if status endpoint transiently fails
            }

            const nextMode: 'hybrid' | 'standalone' =
                statusData.runtime_mode === 'standalone' || statusData.standalone === true ? 'standalone' : 'hybrid'
            const nextStandalone = Boolean(
                statusData.standalone === true ||
                nextMode === 'standalone' ||
                (statusData.oauth_connected === false && statusData.has_local_data)
            )
            const nextOauthConnected =
                typeof statusData.oauth_connected === 'boolean'
                    ? statusData.oauth_connected
                    : Boolean(statusData.authorized && !nextStandalone)
            const nextHasLocalData = Boolean(statusData.has_local_data)
            const nextAutoCutover =
                typeof statusData.auto_cutover_enabled === 'boolean' ? statusData.auto_cutover_enabled : true

            setRuntimeMode(nextMode)
            setStandaloneFlag(Boolean(statusData.standalone || nextMode === 'standalone'))
            setOauthConnected(nextOauthConnected)
            setHasLocalData(nextHasLocalData)
            setAutoCutoverEnabled(nextAutoCutover)

            if (statusData.last_synced_at) {
                setLastSyncedAt(statusData.last_synced_at)
            }

            // Resolve current TEG person FIRST so membership privacy is accurate on first paint
            let resolvedPid: string | null = null
            if (user?.email || user?.name) {
                const person = await resolveOrCreateTegPerson(supabase, {
                    email: canonicalizeBasecampEmail(user?.email),
                    name: canonicalizeBasecampDisplayName(user?.name, user?.email),
                    role: (user as any)?.role,
                })
                if (person?.id) {
                    resolvedPid = person.id
                    setResolvedPersonId(person.id)
                    if (person.name) {
                        setResolvedPersonName(person.name)
                    }
                }
            }

            const { data: dbProjects, error } = await supabase
                .from('bc_projects')
                .select(`
                    id,
                    bc_id,
                    name,
                    description,
                    color,
                    is_pinned,
                    is_archived,
                    member_count,
                    enabled_tools,
                    bc_memberships(
                        role,
                        person:bc_people(id, bc_id, name, email, title, attachable_sgid, avatar_url, role, is_active)
                    )
                `)
                .eq('is_archived', false)
                .order('name', { ascending: true })

            const localHasProjects = Array.isArray(dbProjects) && dbProjects.length > 0
            if (localHasProjects && !nextHasLocalData) {
                setHasLocalData(true)
            }

            const effectivelyAuthorized = Boolean(
                statusData.authorized || nextStandalone || nextHasLocalData || localHasProjects
            )
            setIsAuthorized(effectivelyAuthorized)

            let formattedProjects: any[] = []
            if (!error && dbProjects) {
                let projectRows: any[] = [...dbProjects]
                const urlProjectParam =
                    typeof window !== 'undefined'
                        ? new URLSearchParams(window.location.search).get('project')?.trim() || ''
                        : ''
                if (
                    urlProjectParam &&
                    !projectRows.some((p: any) => String(p.bc_id) === urlProjectParam || p.id === urlProjectParam)
                ) {
                    const isUuidProj = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(urlProjectParam)
                    const isNumProj = /^\d+$/.test(urlProjectParam)
                    if (isUuidProj || isNumProj) {
                        const extraQuery = supabase
                            .from('bc_projects')
                            .select(`
                                id,
                                bc_id,
                                name,
                                description,
                                color,
                                is_pinned,
                                is_archived,
                                member_count,
                                enabled_tools,
                                bc_memberships(
                                    role,
                                    person:bc_people(id, bc_id, name, email, title, attachable_sgid, avatar_url, role, is_active)
                                )
                            `)
                        const { data: extraProj } = await (isUuidProj
                            ? extraQuery.eq('id', urlProjectParam).maybeSingle()
                            : extraQuery.eq('bc_id', Number(urlProjectParam)).maybeSingle())
                        if (extraProj) {
                            projectRows = [...projectRows, extraProj]
                        }
                    }
                }

                formattedProjects = projectRows.map((p: any) => {
                    const memberByKey = new Map<string, any>()
                    const members: any[] = []
                    const rawMemberIds = new Set<string>()
                    ;(p.bc_memberships || []).forEach((m: any) => {
                        const personObj = Array.isArray(m.person) ? m.person[0] : m.person
                        if (!personObj) return
                        if (personObj.id) rawMemberIds.add(personObj.id)
                        const mKey = normalizePersonName(personObj.name) || personObj.id
                        const cleanEmail = isMaskedOrEmptyEmail(personObj.email)
                            ? ''
                            : canonicalizeBasecampEmail(personObj.email)
                        if (mKey && memberByKey.has(mKey)) {
                            const existing = memberByKey.get(mKey)
                            if (!existing.attachable_sgid && personObj.attachable_sgid) {
                                existing.attachable_sgid = personObj.attachable_sgid
                            }
                            if (!existing.email && cleanEmail) {
                                existing.email = cleanEmail
                            }
                            if (!existing.title && personObj.title) {
                                existing.title = personObj.title
                            }
                            if (!existing.avatar && personObj.avatar_url) {
                                existing.avatar = personObj.avatar_url
                                existing.avatar_url = personObj.avatar_url
                            }
                            return
                        }
                        const memberEntry = {
                            id: personObj.id,
                            bc_id: personObj.bc_id ? Number(personObj.bc_id) : null,
                            name: personObj.name || '',
                            email: cleanEmail,
                            title: personObj.title || '',
                            attachable_sgid: personObj.attachable_sgid || null,
                            role: m.role || personObj.role || 'user',
                            avatar: personObj.avatar_url || '',
                            avatar_url: personObj.avatar_url || '',
                        }
                        if (mKey) memberByKey.set(mKey, memberEntry)
                        members.push(memberEntry)
                    })

                    return {
                        id: String(p.bc_id),
                        db_id: p.id,
                        name: p.name,
                        description: p.description,
                        color: p.color || 'white',
                        is_pinned: Boolean(p.is_pinned),
                        enabled_tools: Array.isArray(p.enabled_tools) ? p.enabled_tools : null,
                        peopleCount: members.length || Number(p.member_count) || 0,
                        people: members,
                        memberPersonIds: Array.from(rawMemberIds),
                    }
                })
                setAllProjects(formattedProjects)
            } else if (error) {
                console.error('Error loading projects:', error.message)
            }

            if (resolvedPid) {
                const { data: unreadRows } = await supabase
                    .from('bc_notifications')
                    .select('id, project_id')
                    .eq('person_id', resolvedPid)
                    .eq('is_read', false)
                    .limit(200)

                const allowedDbIds = new Set(
                    (isAdmin
                        ? formattedProjects
                        : formattedProjects.filter((proj) =>
                              canUserAccessBasecampProject(proj, {
                                  isAdmin: false,
                                  resolvedPersonId: resolvedPid,
                                  canonicalEmail: canonicalizeBasecampEmail(user?.email),
                              })
                          )
                    )
                        .map((proj) => proj.db_id)
                        .filter(Boolean)
                )
                const filteredUnread = (unreadRows || []).filter(
                    (n: any) => isAdmin || !n.project_id || allowedDbIds.has(n.project_id)
                )
                setUnreadHeyCount(filteredUnread.length)
            }

            setIdentityResolved(true)

            // Stale-While-Revalidate ONLY in hybrid mode when OAuth is connected
            if (
                effectivelyAuthorized &&
                !nextStandalone &&
                nextOauthConnected &&
                statusData.is_stale &&
                !statusData.is_running &&
                !syncingRef.current
            ) {
                setTimeout(() => {
                    void handleSyncRef.current?.({ silent: true })
                }, 300)
            }
        } catch (err: any) {
            console.error('Error loading Basecamp workspace:', err.message)
        } finally {
            if (!opts?.silent) setLoading(false)
        }
    }, [user, isAdmin, supabase])

    // Trigger manual or silent background sync (skipped in standalone mode)
    const handleSync = useCallback(async (opts?: { silent?: boolean; projectId?: string }): Promise<boolean> => {
        if (isStandaloneMode) {
            await checkAuthAndLoadProjects({ silent: true })
            return true
        }
        if (syncingRef.current) return true
        syncingRef.current = true
        setSyncing(true)
        try {
            const payload = opts?.projectId ? { projectId: Number(opts.projectId) } : { full: false }
            const res = await fetch('/api/basecamp/sync', {
                method: 'POST',
                headers: buildBasecampJsonHeaders(),
                body: JSON.stringify(payload),
            })
            const data = await res.json().catch(() => ({}))

            if (res.status === 409) {
                await new Promise((r) => setTimeout(r, 2000))
                await checkAuthAndLoadProjects({ silent: true })
                return true
            }

            if (data?.standalone || data?.skipped) {
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
    }, [isStandaloneMode, checkAuthAndLoadProjects, t])

    const handleSyncRef = useRef(handleSync)
    handleSyncRef.current = handleSync

    useEffect(() => {
        if (authLoading) return
        void checkAuthAndLoadProjects()
    }, [authLoading, checkAuthAndLoadProjects])

    const saveProjects = async (updated: any[]) => {
        try {
            for (const up of updated) {
                const orig = allProjects.find((p) => p.id === up.id)
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
        const byId = new Map(updated.map((u) => [u.id, u]))
        setAllProjects((prev) => prev.map((p) => (byId.has(p.id) ? { ...p, ...byId.get(p.id) } : p)))
    }

    // Background Auto-Sync Heartbeat (ONLY when hybrid & oauthConnected) + Supabase Realtime Listener
    useEffect(() => {
        if (!isAuthorized) return

        const tickInterval = !isStandaloneMode
            ? setInterval(() => {
                  setNowTick(Date.now())
              }, 30_000)
            : null

        const syncInterval =
            !isStandaloneMode && oauthConnected
                ? setInterval(() => {
                      if (document.visibilityState === 'visible' && !syncingRef.current) {
                          void handleSync({ silent: true, projectId: projectId || undefined })
                      }
                  }, 3 * 60 * 1000)
                : null

        const handleVisibilityOrFocus = () => {
            if (isStandaloneMode || !oauthConnected) return
            if (document.visibilityState === 'visible' && !syncingRef.current) {
                const ageMs = lastSyncedAt ? Date.now() - new Date(lastSyncedAt).getTime() : Infinity
                if (ageMs > 2 * 60 * 1000) {
                    void handleSync({ silent: true, projectId: projectId || undefined })
                }
            }
        }
        if (!isStandaloneMode && oauthConnected) {
            window.addEventListener('focus', handleVisibilityOrFocus)
            document.addEventListener('visibilitychange', handleVisibilityOrFocus)
        }

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
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'bc_memberships' },
                () => {
                    void checkAuthAndLoadProjects({ silent: true })
                }
            )

        if (resolvedPersonId) {
            channelBuilder = channelBuilder.on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'bc_notifications', filter: `person_id=eq.${resolvedPersonId}` },
                async () => {
                    const { data: unreadRows } = await supabase
                        .from('bc_notifications')
                        .select('id, project_id')
                        .eq('person_id', resolvedPersonId)
                        .eq('is_read', false)
                        .limit(200)
                    const filteredUnread = (unreadRows || []).filter(
                        (n: any) => isAdmin || !n.project_id || allowedProjectIdSet.has(n.project_id)
                    )
                    setUnreadHeyCount(filteredUnread.length)
                }
            )
        }

        const channel = channelBuilder.subscribe()

        return () => {
            if (tickInterval) clearInterval(tickInterval)
            if (syncInterval) clearInterval(syncInterval)
            window.removeEventListener('focus', handleVisibilityOrFocus)
            document.removeEventListener('visibilitychange', handleVisibilityOrFocus)
            supabase.removeChannel(channel)
        }
    }, [
        isAuthorized,
        isStandaloneMode,
        oauthConnected,
        projectId,
        lastSyncedAt,
        resolvedPersonId,
        isAdmin,
        allowedProjectIdSet,
        handleSync,
        checkAuthAndLoadProjects,
        supabase,
    ])

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

        if (params.replicateTodoId) {
            query.set('replicateTodoId', params.replicateTodoId)
            setCurrentReplicateTodoId(params.replicateTodoId)
        } else {
            setCurrentReplicateTodoId(null)
        }

        if (params.messageId) {
            query.set('messageId', params.messageId)
            setCurrentMessageId(params.messageId)
        } else {
            setCurrentMessageId(null)
        }

        if (params.replicateMessageId) {
            if (!params.tool && params.project) {
                query.set('tool', 'messages')
            }
            query.set('replicateMessageId', params.replicateMessageId)
            setCurrentReplicateMessageId(params.replicateMessageId)
        } else {
            setCurrentReplicateMessageId(null)
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

    const currentProject = projects.find((p) => p.id === projectId || p.db_id === projectId)

    // Strict Project Privacy URL Guard: if user tries ?project=46408455 without membership/admin, return cleanly to Home
    useEffect(() => {
        if (loading || authLoading || !identityResolved) return
        if (projectId && !currentProject) {
            setCurrentTodoId(null)
            setCurrentReplicateTodoId(null)
            setCurrentMessageId(null)
            setCurrentReplicateMessageId(null)
            setCurrentDocId(null)
            router.replace('/basecamp')
        }
    }, [loading, authLoading, identityResolved, projectId, currentProject, router])

    // Strip TEG author banner, preserve @mentions, strip <bc-attachment>, HTML tags, and decode entities for search snippets
    const stripHtml = (html?: string | null) => {
        if (!html) return ''
        const { cleanHtml } = stripTegAuthorBanner(html)
        const withMentions = cleanHtml
            .replace(/<bc-attachment\b([^>]*)>([\s\S]*?)<\/bc-attachment>/gi, (_m, attrs: string, inner: string) => {
                if (!/content-type=["']application\/vnd\.basecamp\.mention["']/i.test(attrs) && !/data-teg-mention-person-id=/i.test(attrs)) {
                    return ' '
                }
                const figMatch = inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i)
                const altMatch = inner.match(/\balt=["']([^"']+)["']/i)
                const contentAttr = attrs.match(/\bcontent=["']([^"']+)["']/i)
                let name = ''
                if (figMatch?.[1]) name = figMatch[1].replace(/<[^>]*>/g, '').trim()
                else if (altMatch?.[1]) name = altMatch[1].trim()
                else if (contentAttr?.[1]) {
                    name = contentAttr[1]
                        .replace(/&lt;/gi, '<')
                        .replace(/&gt;/gi, '>')
                        .replace(/&quot;/gi, '"')
                        .replace(/&amp;/gi, '&')
                        .replace(/<[^>]*>/g, '')
                        .trim()
                } else {
                    name = inner.replace(/<[^>]*>/g, '').trim()
                }
                const cleanName = name.replace(/^@+/, '').trim()
                return cleanName ? ` @${cleanName} ` : ' '
            })
            .replace(/<span\b[^>]*\bdata-teg-mention-person-id=["'][^"']+["'][^>]*>([\s\S]*?)<\/span>/gi, (_m, inner: string) => {
                const cleanName = inner.replace(/<[^>]*>/g, '').replace(/^@+/, '').trim()
                return cleanName ? ` @${cleanName} ` : ' '
            })
        return withMentions
            .replace(/<bc-attachment[\s\S]*?<\/bc-attachment>/gi, ' ')
            .replace(/<bc-attachment\b[^>]*\/>/gi, ' ')
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

    // Extract image and video URLs from HTML content and proxy raw Basecamp URLs (excluding mention mini-avatars)
    const extractMediaUrls = (html?: string | null) => {
        const media: { type: 'image' | 'video'; url: string }[] = []
        if (!html) return media

        const seen = new Set<string>()
        const bcAttRegex = /<bc-attachment\b([^>]*?)(?:\/>|>([\s\S]*?)<\/bc-attachment>)/gi
        let match: RegExpExecArray | null
        while ((match = bcAttRegex.exec(html)) !== null) {
            const attrs = match[1] || ''
            if (
                /content-type=["']application\/vnd\.basecamp\.mention["']/i.test(attrs) ||
                /\bdata-teg-mention-person-id=/i.test(attrs)
            ) {
                continue
            }
            const ct = (attrs.match(/\bcontent-type=["']([^"']+)["']/i)?.[1] || '').trim()
            const fn = (attrs.match(/\bfilename=["']([^"']+)["']/i)?.[1] || '').trim()
            const rawUrl = (
                attrs.match(/\burl=["']([^"']+)["']/i)?.[1] ||
                attrs.match(/\bhref=["']([^"']+)["']/i)?.[1] ||
                ''
            ).trim()
            if (!rawUrl) continue
            const proxied = proxyBasecampUrl(rawUrl)
            if (!proxied || seen.has(proxied)) continue
            if (isVideoMimeOrFilename(ct, fn, rawUrl)) {
                seen.add(proxied)
                media.push({ type: 'video', url: proxied })
            } else if (
                ct.toLowerCase().startsWith('image/') ||
                /\.(?:jpe?g|png|gif|webp|bmp|svg|heic|heif|avif)(?:$|[?#])/i.test(fn || rawUrl)
            ) {
                seen.add(proxied)
                media.push({ type: 'image', url: proxied })
            }
        }

        const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
        while ((match = imgRegex.exec(html)) !== null) {
            const fullTag = match[0]
            if (
                /\bclass=["'][^"']*\bavatar\b/i.test(fullTag) ||
                /\bdata-avatar-for-person-id=/i.test(fullTag) ||
                /\bdata-bc-avatar=/i.test(fullTag)
            ) {
                continue
            }
            const rawUrl = match[1]
            if (!rawUrl || rawUrl.includes('attachment-icon')) continue
            const altVal = fullTag.match(/\balt=["']([^"']+)["']/i)?.[1] || ''
            const proxied = proxyBasecampUrl(rawUrl)
            if (proxied && !seen.has(proxied)) {
                seen.add(proxied)
                media.push({
                    type: isVideoMimeOrFilename('', altVal, rawUrl) ? 'video' : 'image',
                    url: proxied,
                })
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

            const hasAllowedSearchProjects = isAdmin || allowedProjectIds.length > 0
            const todosQuery = supabase
                .from('bc_todos')
                .select('id, bc_id, title, description, is_completed, created_at, completed_at, project_id, todolist_id, project:bc_projects(bc_id, name), todolist:bc_todolists(id, name, color)')
                .or(buildDualOrFilter('title', 'description'))
                .order('created_at', { ascending: false })
                .limit(25)
            const messagesQuery = supabase
                .from('bc_messages')
                .select('id, bc_id, title, content, category, is_pinned, created_at, project_id, project:bc_projects(bc_id, name)')
                .or(buildDualOrFilter('title', 'content'))
                .order('created_at', { ascending: false })
                .limit(20)
            const docsQuery = supabase
                .from('bc_documents')
                .select('id, title, content, created_at, project_id')
                .or(buildDualOrFilter('title', 'content'))
                .order('created_at', { ascending: false })
                .limit(25)

            const [todosRes, messagesRes, docsRes, peopleRes] = await Promise.all([
                !hasAllowedSearchProjects
                    ? Promise.resolve({ data: [] as any[] })
                    : isAdmin
                        ? todosQuery
                        : todosQuery.in('project_id', allowedProjectIds),
                !hasAllowedSearchProjects
                    ? Promise.resolve({ data: [] as any[] })
                    : isAdmin
                        ? messagesQuery
                        : messagesQuery.in('project_id', allowedProjectIds),
                !hasAllowedSearchProjects
                    ? Promise.resolve({ data: [] as any[] })
                    : isAdmin
                        ? docsQuery
                        : docsQuery.in('project_id', allowedProjectIds),
                supabase
                    .from('bc_people')
                    .select('id, bc_id, name, email, title, role, attachable_sgid')
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

            // 2. Todos — open & historical completed across all lists (verify accent-insensitive match in JS)
            if (todosRes.data) {
                todosRes.data
                    .filter((row: any) => {
                        const plainText = stripAccentsLower(`${row.title || ''} ${stripHtml(row.description)}`)
                        if (plainText.includes(normQuery)) return true
                        return stripAccentsLower(row.description || '').includes(normQuery)
                    })
                    .slice(0, 25)
                    .forEach((row: any) => {
                        const relProj = Array.isArray(row.project) ? row.project[0] : row.project
                        const relList = Array.isArray(row.todolist) ? row.todolist[0] : row.todolist
                        const proj = projects.find((p) => p.db_id === row.project_id)
                        const canSeeRow = isAdmin || (row.project_id && allowedProjectIdSet.has(row.project_id))
                        const resolvedProjBcId = proj?.id || (isAdmin && relProj?.bc_id ? String(relProj.bc_id) : '')
                        const resolvedProjName = proj?.name || relProj?.name || ''
                        if (canSeeRow && resolvedProjBcId && (proj || relProj)) {
                            const media = extractMediaUrls(row.description)
                            const imageCount = media.filter((m) => m.type === 'image').length
                            const hasPhotos =
                                imageCount > 0 ||
                                /<bc-attachment\b[^>]*content-type=["']image\//i.test(row.description || '')
                            results.push({
                                type: 'todo',
                                id: row.id,
                                bcId: row.bc_id,
                                label: row.title,
                                isCompleted: Boolean(row.is_completed),
                                completedAt: row.completed_at || null,
                                projectId: resolvedProjBcId,
                                projectName: resolvedProjName,
                                todolistId: row.todolist_id || relList?.id || null,
                                todolistName: relList?.name || '',
                                todolistColor: relList?.color || null,
                                createdAt: row.created_at,
                                description: row.description,
                                media,
                                hasPhotos,
                                imageCount,
                            })
                        }
                    })
            }

            // 3. Messages
            if (messagesRes.data) {
                messagesRes.data
                    .filter((row: any) => {
                        const plainText = stripAccentsLower(`${row.title || ''} ${stripHtml(row.content)}`)
                        if (plainText.includes(normQuery)) return true
                        return stripAccentsLower(row.content || '').includes(normQuery)
                    })
                    .slice(0, 20)
                    .forEach((row: any) => {
                        const relProj = Array.isArray(row.project) ? row.project[0] : row.project
                        const proj = projects.find((p) => p.db_id === row.project_id)
                        const canSeeRow = isAdmin || (row.project_id && allowedProjectIdSet.has(row.project_id))
                        const resolvedProjBcId = proj?.id || (isAdmin && relProj?.bc_id ? String(relProj.bc_id) : '')
                        const resolvedProjName = proj?.name || relProj?.name || ''
                        if (canSeeRow && resolvedProjBcId && (proj || relProj)) {
                            const media = extractMediaUrls(row.content)
                            const imageCount = media.filter((m) => m.type === 'image').length
                            const videoCount = media.filter((m) => m.type === 'video').length
                            const hasPhotos =
                                imageCount > 0 ||
                                /<bc-attachment\b[^>]*content-type=["']image\//i.test(row.content || '')
                            const hasVideos =
                                videoCount > 0 ||
                                /<bc-attachment\b[^>]*content-type=["']video\//i.test(row.content || '')
                            results.push({
                                type: 'message',
                                id: row.id,
                                bcId: row.bc_id,
                                label: row.title,
                                category: row.category || null,
                                isPinned: Boolean(row.is_pinned),
                                projectId: resolvedProjBcId,
                                projectName: resolvedProjName,
                                createdAt: row.created_at,
                                description: row.content,
                                media,
                                hasPhotos,
                                imageCount,
                                hasVideos,
                                videoCount,
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
                        const cleanEmail = isMaskedOrEmptyEmail(row.email) ? '' : canonicalizeBasecampEmail(row.email)
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
                            email: isMaskedOrEmptyEmail(row.email) ? '' : canonicalizeBasecampEmail(row.email),
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
    }, [projects, isAdmin, allowedProjectIds, allowedProjectIdSet, supabase])

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
                if (showModeModal) {
                    e.preventDefault()
                    setShowModeModal(false)
                    return
                }
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
    }, [showModeModal, showSearchModal, heyDrawerOpen, navigateTo])

    const handleConsumeReplicateTodo = useCallback(() => {
        setCurrentReplicateTodoId(null)
        if (typeof window !== 'undefined') {
            const query = new URLSearchParams(window.location.search)
            if (query.has('replicateTodoId')) {
                query.delete('replicateTodoId')
                const qs = query.toString()
                window.history.replaceState(null, '', qs ? `/basecamp?${qs}` : '/basecamp')
            }
        }
    }, [])

    const handleConsumeReplicateMessage = useCallback(() => {
        setCurrentReplicateMessageId(null)
        if (typeof window !== 'undefined') {
            const query = new URLSearchParams(window.location.search)
            const needsMessagesTool = !query.get('tool') && Boolean(query.get('project'))
            if (query.has('replicateMessageId') || needsMessagesTool) {
                query.delete('replicateMessageId')
                if (needsMessagesTool) {
                    query.set('tool', 'messages')
                    const qs = query.toString()
                    router.replace(qs ? `/basecamp?${qs}` : '/basecamp', { scroll: false })
                    return
                }
                const qs = query.toString()
                window.history.replaceState(null, '', qs ? `/basecamp?${qs}` : '/basecamp')
            }
        }
    }, [router])

    const handleUpdateAutonomyMode = useCallback(
        async (nextMode: 'hybrid' | 'standalone', nextAutoCutover: boolean) => {
            if (!isAdmin || savingMode) return
            setSavingMode(true)
            setModeError(null)
            try {
                const res = await fetch('/api/basecamp/status', {
                    method: 'POST',
                    headers: buildBasecampJsonHeaders(),
                    body: JSON.stringify({
                        runtime_mode: nextMode,
                        auto_cutover_enabled: nextAutoCutover,
                    }),
                })
                const data = await res.json().catch(() => ({}))
                if (!res.ok || data?.error) {
                    setModeError(data?.error || t('basecamp.action_error'))
                    return
                }
                const resolvedMode: 'hybrid' | 'standalone' =
                    data.runtime_mode === 'standalone' || data.standalone === true ? 'standalone' : nextMode
                setRuntimeMode(resolvedMode)
                setStandaloneFlag(resolvedMode === 'standalone')
                if (typeof data.auto_cutover_enabled === 'boolean') {
                    setAutoCutoverEnabled(data.auto_cutover_enabled)
                } else {
                    setAutoCutoverEnabled(nextAutoCutover)
                }
                if (typeof data.oauth_connected === 'boolean') {
                    setOauthConnected(data.oauth_connected)
                }
                if (typeof data.has_local_data === 'boolean') {
                    setHasLocalData(data.has_local_data)
                }
            } catch (err: any) {
                setModeError(err?.message || t('basecamp.action_error'))
            } finally {
                setSavingMode(false)
            }
        },
        [isAdmin, savingMode, t]
    )

    // Delegated Smart Link Interceptor for historical app.basecamp.com / 3.basecamp.com bucket URLs
    const handleContainerLinkClick = useCallback(
        async (e: React.MouseEvent<HTMLDivElement>) => {
            if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
            const target = e.target as HTMLElement | null
            if (!target) return
            if (target.closest?.('[contenteditable="true"]')) return
            if (target.closest?.('a[data-bc-download="true"]')) return

            const anchor = target.closest?.('a') as HTMLAnchorElement | null
            if (!anchor) return

            const rawHref = anchor.getAttribute('href') || anchor.href || ''
            const parsed = parseInterceptableBasecampHref(rawHref)
            if (!parsed) return

            e.preventDefault()
            e.stopPropagation()

            if (parsed.kind === 'teg_deeplink') {
                const allowedProj = projects.find(
                    (p) => p.id === parsed.project || p.db_id === parsed.project
                )
                if (!isAdmin && !allowedProj) return
                navigateTo({
                    project: allowedProj?.id || parsed.project,
                    tool: parsed.tool,
                    todoId: parsed.todoId,
                    messageId: parsed.messageId,
                    docId: parsed.docId,
                })
                return
            }

            const { projectBcId, resourceType, itemBcId } = parsed
            const numItemId = itemBcId ? Number(itemBcId) : 0

            try {
                if (resourceType === 'todos' && numItemId > 0) {
                    const { data: todoRow } = await supabase
                        .from('bc_todos')
                        .select('id, project_id, project:bc_projects(bc_id)')
                        .eq('bc_id', numItemId)
                        .maybeSingle()
                    if (todoRow && (isAdmin || (todoRow.project_id && allowedProjectIdSet.has(todoRow.project_id)))) {
                        const relP = Array.isArray((todoRow as any).project)
                            ? (todoRow as any).project[0]
                            : (todoRow as any).project
                        const targetProj = String(relP?.bc_id || projectBcId)
                        navigateTo({ project: targetProj, tool: 'todos', todoId: todoRow.id })
                        return
                    }
                } else if (resourceType === 'messages' && numItemId > 0) {
                    const { data: msgRow } = await supabase
                        .from('bc_messages')
                        .select('id, project_id, project:bc_projects(bc_id)')
                        .eq('bc_id', numItemId)
                        .maybeSingle()
                    if (msgRow && (isAdmin || (msgRow.project_id && allowedProjectIdSet.has(msgRow.project_id)))) {
                        const relP = Array.isArray((msgRow as any).project)
                            ? (msgRow as any).project[0]
                            : (msgRow as any).project
                        const targetProj = String(relP?.bc_id || projectBcId)
                        navigateTo({ project: targetProj, tool: 'messages', messageId: msgRow.id })
                        return
                    }
                } else if (resourceType === 'documents' && numItemId > 0) {
                    const { data: docRow } = await supabase
                        .from('bc_documents')
                        .select('id, project_id, project:bc_projects(bc_id)')
                        .eq('bc_id', numItemId)
                        .maybeSingle()
                    if (docRow && (isAdmin || (docRow.project_id && allowedProjectIdSet.has(docRow.project_id)))) {
                        const relP = Array.isArray((docRow as any).project)
                            ? (docRow as any).project[0]
                            : (docRow as any).project
                        const targetProj = String(relP?.bc_id || projectBcId)
                        navigateTo({ project: targetProj, tool: 'docs', docId: docRow.id })
                        return
                    }
                }
            } catch (err) {
                console.error('Error resolving intercepted Basecamp link:', err)
            }

            if (isAdmin || projects.some((p) => p.id === projectBcId)) {
                const fallbackTool =
                    resourceType === 'messages'
                        ? 'messages'
                        : resourceType === 'documents'
                            ? 'docs'
                            : resourceType
                                ? 'todos'
                                : undefined
                navigateTo({ project: projectBcId, tool: fallbackTool })
            }
        },
        [projects, isAdmin, allowedProjectIdSet, navigateTo, supabase]
    )

    const closeSearchModal = () => {
        searchReqSeqRef.current++
        setSearchQuery('')
        setSearchResults([])
        setSearchLoading(false)
        setShowSearchModal(false)
    }

    if (loading || authLoading) {
        return (
            <div className="-mx-2 sm:mx-auto sm:w-full max-w-[1360px] min-h-[60vh] flex items-center justify-center bg-white dark:bg-slate-900 sm:bg-[#FAF9F6] sm:dark:bg-slate-950/90 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-sm">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-9 w-9 border-2 border-slate-200 dark:border-slate-700 border-t-[#1D7DB5] mx-auto mb-3"></div>
                    <p className="text-slate-600 dark:text-slate-400 text-sm font-semibold">{t('basecamp.loading_bc')}</p>
                </div>
            </div>
        )
    }

    if (isAuthorized === false && !isStandaloneMode && !hasLocalData) {
        return (
            <div className="-mx-2 sm:mx-auto sm:w-full max-w-[1360px] min-h-[70vh] bg-white dark:bg-slate-900 sm:bg-[#FAF9F6] sm:dark:bg-slate-950/90 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-6 rounded-2xl flex items-center justify-center font-sans shadow-sm">
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

    if (allProjects.length === 0 && !syncing && !isStandaloneMode && oauthConnected && isAdmin) {
        return (
            <div className="-mx-2 sm:mx-auto sm:w-full max-w-[1360px] min-h-[70vh] bg-white dark:bg-slate-900 sm:bg-[#FAF9F6] sm:dark:bg-slate-950/90 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-6 rounded-2xl flex items-center justify-center font-sans shadow-sm">
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

    if (syncing && allProjects.length === 0 && !isStandaloneMode) {
        return (
            <div className="-mx-2 sm:mx-auto sm:w-full max-w-[1360px] min-h-[70vh] bg-white dark:bg-slate-900 sm:bg-[#FAF9F6] sm:dark:bg-slate-950/90 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-6 rounded-2xl flex items-center justify-center font-sans shadow-sm">
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
        const activeSectionLabel =
            section === 'mystuff'
                ? t('basecamp.my_stuff')
                : section === 'pings' || pingUser
                    ? t('basecamp.pings_short')
                    : section === 'hey'
                        ? t('basecamp.hey_short')
                        : null

        return (
            <header className="sticky top-14 lg:static z-30 w-full h-12 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.03)] px-2 sm:px-5 flex items-center justify-between gap-1.5 sm:gap-2 rounded-t-2xl">
                <div className="min-w-0 flex items-center gap-1 sm:gap-1.5 flex-1">
                    <button
                        type="button"
                        onClick={() => navigateTo({})}
                        title={t('basecamp.home')}
                        className="inline-flex items-center gap-1.5 h-8 px-1.5 sm:px-2.5 rounded-lg bg-slate-100/90 hover:bg-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-colors shrink-0 cursor-pointer"
                    >
                        <Home size={14} className="text-[#1D7DB5] dark:text-sky-400 shrink-0" />
                        <span className="hidden sm:inline">{t('basecamp.home')}</span>
                    </button>

                    {projectId && currentProject && (
                        <>
                            <span className="text-slate-300 dark:text-slate-700 text-sm font-medium select-none shrink-0">/</span>
                            <button
                                type="button"
                                onClick={() => navigateTo({ project: projectId })}
                                title={currentProject.name}
                                className="truncate max-w-[140px] sm:max-w-[240px] md:max-w-[300px] text-xs sm:text-[13px] font-bold text-slate-800 dark:text-slate-100 hover:text-[#1D7DB5] dark:hover:text-sky-400 transition-colors cursor-pointer text-left"
                            >
                                {currentProject.name}
                            </button>
                        </>
                    )}

                    {!projectId && activeSectionLabel && (
                        <>
                            <span className="text-slate-300 dark:text-slate-700 text-sm font-medium select-none shrink-0">/</span>
                            <span className="truncate max-w-[130px] sm:max-w-[220px] text-xs sm:text-[13px] font-bold text-slate-800 dark:text-slate-100">
                                {activeSectionLabel}
                            </span>
                        </>
                    )}
                </div>

                <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                    {isAdmin ? (
                        <button
                            type="button"
                            onClick={() => setShowModeModal(true)}
                            className={`inline-flex items-center justify-center gap-1.5 h-8 px-1.5 sm:px-2 md:px-2.5 rounded-lg border text-[11px] font-extrabold transition-all shrink-0 cursor-pointer ${
                                isStandaloneMode
                                    ? 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60 border-emerald-200/90 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                                    : 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-950/60 border-blue-200/90 dark:border-blue-800 text-[#1D7DB5] dark:text-sky-300'
                            }`}
                            title={t('basecamp.mode_settings_title')}
                        >
                            <span className="text-xs leading-none">{isStandaloneMode ? '🛡️' : '🔗'}</span>
                            <span className="hidden md:inline truncate md:max-w-[165px] lg:max-w-none">
                                {isStandaloneMode ? t('basecamp.mode_standalone_badge') : t('basecamp.mode_hybrid_badge')}
                            </span>
                        </button>
                    ) : (
                        <div
                            className="hidden xl:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/60 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 shrink-0"
                            title={isStandaloneMode ? t('basecamp.mode_standalone_badge') : t('basecamp.auto_sync_tooltip')}
                        >
                            <span className={`w-1.5 h-1.5 rounded-full ${syncing && !isStandaloneMode ? 'bg-blue-500 animate-ping' : 'bg-emerald-500 animate-pulse'}`} />
                            <span>
                                {isStandaloneMode
                                    ? `🛡️ ${t('basecamp.mode_standalone_badge')}`
                                    : syncing
                                        ? t('basecamp.syncing_in_progress')
                                        : getSyncRelativeLabel()}
                            </span>
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={() => setShowSearchModal(true)}
                        title={`${t('basecamp.find')} (Shift + J)`}
                        className="inline-flex items-center justify-center gap-1.5 h-8 px-1.5 sm:px-2.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
                    >
                        <Search size={15} className="shrink-0" />
                        <span className="hidden md:inline">{t('basecamp.find')}</span>
                        <kbd className="hidden lg:inline-flex items-center px-1 py-0.5 text-[10px] font-bold rounded bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200/80 dark:border-slate-700 leading-none">
                            ⇧J
                        </kbd>
                    </button>

                    <button
                        type="button"
                        onClick={() => setHeyDrawerOpen(true)}
                        title={t('basecamp.hey_short')}
                        className={`relative inline-flex items-center justify-center gap-1.5 h-8 px-1.5 sm:px-2.5 rounded-lg text-xs font-bold transition-colors shrink-0 cursor-pointer ${
                            section === 'hey' || heyDrawerOpen
                                ? 'bg-blue-50 text-[#1D7DB5] dark:bg-blue-950/50 dark:text-sky-300'
                                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        <Bell size={15} className="shrink-0" />
                        <span className="hidden md:inline">{t('basecamp.hey_short')}</span>
                        {unreadHeyCount > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 md:static bg-red-500 text-white font-black text-[9px] min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center leading-none shadow-xs">
                                {unreadHeyCount}
                            </span>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={() => navigateTo({ section: 'pings' })}
                        title={t('basecamp.pings_short')}
                        className={`inline-flex items-center justify-center gap-1.5 h-8 px-1.5 sm:px-2.5 rounded-lg text-xs font-bold transition-colors shrink-0 cursor-pointer ${
                            section === 'pings' || pingUser
                                ? 'bg-blue-50 text-[#1D7DB5] dark:bg-blue-950/50 dark:text-sky-300'
                                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        <MessageSquare size={15} className="shrink-0" />
                        <span className="hidden md:inline">{t('basecamp.pings_short')}</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => navigateTo({ section: 'mystuff' })}
                        title={t('basecamp.my_stuff')}
                        className={`inline-flex items-center justify-center gap-1.5 h-8 px-1.5 sm:px-2.5 rounded-lg text-xs font-bold transition-colors shrink-0 cursor-pointer ${
                            section === 'mystuff'
                                ? 'bg-blue-50 text-[#1D7DB5] dark:bg-blue-950/50 dark:text-sky-300'
                                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        <User size={15} className="shrink-0" />
                        <span className="hidden md:inline">{t('basecamp.my_stuff')}</span>
                    </button>

                    {isAdmin && !isStandaloneMode && (
                        <button
                            type="button"
                            onClick={() => void handleSync({ projectId: projectId || undefined })}
                            disabled={syncing}
                            title={syncing ? t('basecamp.syncing_in_progress') : t('basecamp.sync_btn')}
                            className={`inline-flex items-center justify-center gap-1.5 h-8 px-1.5 sm:px-2 xl:px-2.5 rounded-lg text-xs font-bold border transition-all shrink-0 ${
                                syncing
                                    ? 'bg-blue-50 dark:bg-blue-950/40 text-[#1D7DB5] dark:text-sky-300 border-blue-200 dark:border-blue-800 cursor-not-allowed opacity-80'
                                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200/90 dark:border-slate-700 cursor-pointer'
                            }`}
                        >
                            <RefreshCw size={14} className={syncing ? 'animate-spin text-[#1D7DB5]' : ''} />
                            <span className="hidden xl:inline">{syncing ? t('basecamp.syncing_in_progress') : t('basecamp.sync_btn')}</span>
                        </button>
                    )}

                    <div
                        className="hidden lg:flex items-center gap-1.5 pl-1.5 ml-0.5 border-l border-slate-200/80 dark:border-slate-800 shrink-0"
                        title={currentUserName}
                    >
                        <div className="w-7 h-7 rounded-full bg-[#1D7DB5] text-white font-bold flex items-center justify-center text-[11px] uppercase">
                            {userInitial}
                        </div>
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate max-w-[90px]">
                            {String(currentUserName || '').trim().split(/\s+/)[0]}
                        </span>
                    </div>
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
            const nextHref = qs ? `/basecamp?${qs}` : '/basecamp'
            window.history.replaceState(null, '', nextHref)
            router.replace(nextHref, { scroll: false })
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
            return (
                <MyStuffPage
                    navigateTo={navigateTo}
                    currentUserName={currentUserName}
                    allowedProjectIds={allowedProjectIds}
                    isAdmin={isAdmin}
                />
            )
        }

        if (projectId && currentProject) {
            const effectiveToolId =
                toolId ||
                (currentTodoId || currentReplicateTodoId
                    ? 'todos'
                    : currentMessageId || currentReplicateMessageId
                    ? 'messages'
                    : currentDocId
                    ? 'docs'
                    : null)

            if (effectiveToolId) {
                const normTool = effectiveToolId.toLowerCase()
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
                                replicateTodoId={currentReplicateTodoId || undefined}
                                onCloseDetail={() => clearDeepLinkParamIfActive('todoId', currentTodoId, () => setCurrentTodoId(null))}
                                onConsumeReplicateTodo={handleConsumeReplicateTodo}
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
                                replicateMessageId={currentReplicateMessageId || undefined}
                                onCloseDetail={() => clearDeepLinkParamIfActive('messageId', currentMessageId, () => setCurrentMessageId(null))}
                                onConsumeReplicateMessage={handleConsumeReplicateMessage}
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
                                selectedTodoId={currentTodoId || undefined}
                                selectedMessageId={currentMessageId || undefined}
                                replicateMessageId={currentReplicateMessageId || undefined}
                                onCloseDetail={() => clearDeepLinkParamIfActive('messageId', currentMessageId, () => setCurrentMessageId(null))}
                                onConsumeReplicateMessage={handleConsumeReplicateMessage}
                                onOpenSearch={() => setShowSearchModal(true)}
                                isAdmin={isAdmin}
                                onRefreshProjects={() => checkAuthAndLoadProjects({ silent: true })}
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
                    selectedTodoId={currentTodoId || undefined}
                    selectedMessageId={currentMessageId || undefined}
                    replicateMessageId={currentReplicateMessageId || undefined}
                    onCloseDetail={() => clearDeepLinkParamIfActive('messageId', currentMessageId, () => setCurrentMessageId(null))}
                    onConsumeReplicateMessage={handleConsumeReplicateMessage}
                    onOpenSearch={() => setShowSearchModal(true)}
                    isAdmin={isAdmin}
                    onRefreshProjects={() => checkAuthAndLoadProjects({ silent: true })}
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
                isAdmin={isAdmin}
                isStandalone={isStandaloneMode}
                onOpenModeModal={() => setShowModeModal(true)}
                onRefreshProjects={() => checkAuthAndLoadProjects({ silent: true })}
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
        <div
            onClickCapture={(e) => void handleContainerLinkClick(e)}
            className="-mx-2 sm:mx-auto sm:w-full max-w-[1360px] relative min-h-[82vh] bg-white dark:bg-slate-900 sm:bg-[#FAF9F6] sm:dark:bg-slate-950/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-x-clip flex flex-col font-sans"
        >
            {!isHome && renderBasecampHeader()}

            <main className="flex-1 px-2.5 py-3 sm:px-5 sm:py-5 md:px-7 md:py-6 pb-8 min-w-0 flex flex-col">
                {renderWorkspaceContent()}
            </main>

            {/* Cajón lateral derecho: New For You (Hey! & Pings) */}
            <NewForYouDrawer
                isOpen={heyDrawerOpen}
                onClose={() => setHeyDrawerOpen(false)}
                onMarkAllRead={() => setUnreadHeyCount(0)}
                onReadOne={() => setUnreadHeyCount((prev) => Math.max(0, prev - 1))}
                allowedProjectIds={allowedProjectIds}
                isAdmin={isAdmin}
                navigateTo={navigateTo}
            />

            {/* Modal de Búsqueda global (Find / Shift + J) */}
            {showSearchModal && (
                <div
                    className="fixed inset-0 z-[110] flex items-start pt-3 sm:pt-0 sm:items-center justify-center p-2.5 sm:p-4 bg-slate-950/50 backdrop-blur-xs"
                    onClick={(e) => { if (e.target === e.currentTarget) closeSearchModal() }}
                >
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl max-w-2xl w-full max-h-[86dvh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
                        <div className="px-3.5 sm:px-5 py-3 border-b border-slate-200/80 dark:border-slate-800 flex items-center gap-2.5 shrink-0">
                            <Search size={18} className="text-[#1D7DB5] dark:text-sky-400 shrink-0" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => handleSearchInput(e.target.value)}
                                placeholder={t('basecamp.search_placeholder')}
                                className="flex-1 min-w-0 bg-transparent text-sm sm:text-[15px] font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
                                autoFocus
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => handleSearchInput('')}
                                    className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 cursor-pointer"
                                    title={t('basecamp.clear_filter')}
                                >
                                    <X size={14} />
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={closeSearchModal}
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 font-bold text-[11px] px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 shrink-0 cursor-pointer"
                            >
                                {t('basecamp.esc_key')}
                            </button>
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-5 py-3">
                        {searchQuery.trim().length > 0 && searchQuery.trim().length < 3 && (
                            <p className="text-xs text-slate-400 dark:text-slate-500 py-4 text-center">
                                {t('basecamp.search_min_chars')}
                            </p>
                        )}

                        {searchLoading && (
                            <div className="flex items-center justify-center gap-2 py-8">
                                <Loader2 size={18} className="animate-spin text-[#1D7DB5]" />
                                <span className="text-sm text-slate-500 dark:text-slate-400 font-semibold">{t('basecamp.search_searching')}</span>
                            </div>
                        )}

                        {!searchLoading && searchQuery.trim().length >= 3 && (
                            <div className="flex flex-col gap-4">
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
                                                            <div
                                                                key={`todo-${r.id}`}
                                                                role="button"
                                                                tabIndex={0}
                                                                onClick={() => { navigateTo({ project: r.projectId, tool: 'todos', todoId: r.id }); closeSearchModal() }}
                                                                onKeyDown={(ev) => {
                                                                    if (ev.key === 'Enter' || ev.key === ' ') {
                                                                        ev.preventDefault()
                                                                        navigateTo({ project: r.projectId, tool: 'todos', todoId: r.id })
                                                                        closeSearchModal()
                                                                    }
                                                                }}
                                                                className="w-full flex flex-col gap-2 p-3 sm:p-3.5 rounded-xl bg-slate-50/70 hover:bg-slate-100/80 dark:bg-slate-800/40 dark:hover:bg-slate-800/80 border border-slate-200/90 dark:border-slate-800 text-left transition-all duration-150 cursor-pointer min-w-0"
                                                            >
                                                                <div className="flex items-start justify-between gap-2 w-full min-w-0">
                                                                    <div className="flex items-start gap-2 min-w-0 flex-1">
                                                                        <CheckSquare
                                                                            size={16}
                                                                            className={`mt-0.5 shrink-0 ${r.isCompleted ? 'text-emerald-600' : 'text-[#1D7DB5]'}`}
                                                                        />
                                                                        <span
                                                                            className={`text-sm font-bold leading-snug line-clamp-2 break-words min-w-0 flex-1 ${
                                                                                r.isCompleted
                                                                                    ? 'text-slate-600 dark:text-slate-300 line-through decoration-slate-400/70'
                                                                                    : 'text-slate-900 dark:text-slate-100'
                                                                            }`}
                                                                        >
                                                                            {r.label}
                                                                        </span>
                                                                    </div>
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation()
                                                                            closeSearchModal()
                                                                            navigateTo({
                                                                                project: r.projectId,
                                                                                tool: 'todos',
                                                                                replicateTodoId: r.id,
                                                                            })
                                                                        }}
                                                                        title={t('basecamp.replicate_task_tooltip')}
                                                                        className="inline-flex items-center gap-1 h-7 px-2 sm:px-2.5 rounded-lg bg-[#1D7DB5] hover:bg-[#155D8A] active:bg-[#0E4A6E] text-white text-[11px] font-bold shadow-xs transition-all shrink-0 cursor-pointer"
                                                                    >
                                                                        <span>📋</span>
                                                                        <span className="hidden sm:inline">{t('basecamp.replicate_task')}</span>
                                                                    </button>
                                                                </div>
                                                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                                                    <div className="flex items-center gap-1.5 text-[11px] font-bold min-w-0 flex-wrap">
                                                                        <span
                                                                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold border shrink-0 ${
                                                                                r.isCompleted
                                                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                                                                    : 'bg-blue-50 text-[#1D7DB5] border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
                                                                            }`}
                                                                        >
                                                                            {r.isCompleted ? t('basecamp.status_completed_badge') : t('basecamp.status_open_badge')}
                                                                        </span>
                                                                        {r.hasPhotos && (
                                                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 text-[10px] font-bold text-amber-700 dark:text-amber-300 shrink-0">
                                                                                <span>📷</span>
                                                                                {r.imageCount > 1 && <span>{r.imageCount}</span>}
                                                                            </span>
                                                                        )}
                                                                        <span className="bg-blue-50 dark:bg-blue-950/30 text-[#1D7DB5] dark:text-blue-300 px-1.5 py-0.5 rounded truncate max-w-[180px]">
                                                                            {r.projectName}
                                                                        </span>
                                                                        {r.todolistName && (
                                                                            <>
                                                                                <span className="text-slate-400 font-black">›</span>
                                                                                <span className="inline-flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-md text-slate-700 dark:text-slate-200 truncate max-w-[260px]">
                                                                                    <span
                                                                                        className="w-2 h-2 rounded-full shrink-0"
                                                                                        style={{ backgroundColor: resolveSearchTodolistHex(r.todolistColor) }}
                                                                                    />
                                                                                    <span className="truncate">{r.todolistName}</span>
                                                                                </span>
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                    {r.createdAt && (
                                                                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 flex-shrink-0">
                                                                            {formatSearchDateTime(r.createdAt, language)}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {cleanSnippet && (
                                                                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                                                                        {cleanSnippet}
                                                                    </p>
                                                                )}
                                                                {renderMediaStrip(r.media)}
                                                            </div>
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
                                                            <div
                                                                key={`msg-${r.id}`}
                                                                role="button"
                                                                tabIndex={0}
                                                                onClick={() => { navigateTo({ project: r.projectId, tool: 'messages', messageId: r.id }); closeSearchModal() }}
                                                                onKeyDown={(ev) => {
                                                                    if (ev.key === 'Enter' || ev.key === ' ') {
                                                                        ev.preventDefault()
                                                                        navigateTo({ project: r.projectId, tool: 'messages', messageId: r.id })
                                                                        closeSearchModal()
                                                                    }
                                                                }}
                                                                className="w-full flex flex-col gap-2 p-3 sm:p-3.5 rounded-xl bg-slate-50/70 hover:bg-slate-100/80 dark:bg-slate-800/40 dark:hover:bg-slate-800/80 border border-slate-200/90 dark:border-slate-800 text-left transition-all duration-150 cursor-pointer min-w-0"
                                                            >
                                                                <div className="flex items-start justify-between gap-2 w-full min-w-0">
                                                                    <div className="flex items-start gap-2 min-w-0 flex-1">
                                                                        <Mail size={16} className="mt-0.5 text-amber-500 shrink-0" />
                                                                        <span className="text-sm font-bold leading-snug line-clamp-2 break-words min-w-0 flex-1 text-slate-900 dark:text-slate-100">
                                                                            {r.label}
                                                                        </span>
                                                                    </div>
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation()
                                                                            closeSearchModal()
                                                                            navigateTo({
                                                                                project: r.projectId,
                                                                                tool: 'messages',
                                                                                replicateMessageId: r.id,
                                                                            })
                                                                        }}
                                                                        title={t('basecamp.replicate_message_tooltip')}
                                                                        className="inline-flex items-center gap-1 h-7 px-2 sm:px-2.5 rounded-lg bg-[#1D7DB5] hover:bg-[#155D8A] active:bg-[#0E4A6E] text-white text-[11px] font-bold shadow-xs transition-all shrink-0 cursor-pointer"
                                                                    >
                                                                        <span>📋</span>
                                                                        <span className="hidden sm:inline">{t('basecamp.replicate_message')}</span>
                                                                    </button>
                                                                </div>
                                                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                                                    <div className="flex items-center gap-1.5 text-[11px] font-bold min-w-0 flex-wrap">
                                                                        {r.isPinned && (
                                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[10px] font-extrabold text-amber-700 dark:text-amber-300 shrink-0">
                                                                                <span>📌</span>
                                                                                <span>{t('basecamp.pinned_badge')}</span>
                                                                            </span>
                                                                        )}
                                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-extrabold text-slate-700 dark:text-slate-200 shrink-0">
                                                                            {getSearchMessageCategoryBadge(r.category, t)}
                                                                        </span>
                                                                        {r.hasPhotos && (
                                                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 text-[10px] font-bold text-amber-700 dark:text-amber-300 shrink-0">
                                                                                <span>📷</span>
                                                                                {r.imageCount > 1 && <span>{r.imageCount}</span>}
                                                                            </span>
                                                                        )}
                                                                        {r.hasVideos && (
                                                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/40 border border-purple-200/80 dark:border-purple-800/60 text-[10px] font-bold text-purple-700 dark:text-purple-300 shrink-0">
                                                                                <span>🎬</span>
                                                                                {r.videoCount > 1 && <span>{r.videoCount}</span>}
                                                                            </span>
                                                                        )}
                                                                        <span className="bg-blue-50 dark:bg-blue-950/30 text-[#1D7DB5] dark:text-blue-300 px-1.5 py-0.5 rounded truncate max-w-[200px]">
                                                                            {r.projectName}
                                                                        </span>
                                                                        <span className="text-slate-400 font-black">›</span>
                                                                        <span className="inline-flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-md text-slate-700 dark:text-slate-200 truncate max-w-[240px]">
                                                                            <Mail size={11} className="text-amber-500 shrink-0" />
                                                                            <span className="truncate">{t('basecamp.message_board')}</span>
                                                                        </span>
                                                                    </div>
                                                                    {r.createdAt && (
                                                                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 flex-shrink-0">
                                                                            {formatSearchDateTime(r.createdAt, language)}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {cleanSnippet && (
                                                                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                                                                        {cleanSnippet}
                                                                    </p>
                                                                )}
                                                                {renderMediaStrip(r.media)}
                                                            </div>
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
                                                                className="w-full flex flex-col gap-2 p-3 sm:p-3.5 rounded-xl bg-slate-50/70 hover:bg-slate-100/80 dark:bg-slate-800/40 dark:hover:bg-slate-800/80 border border-slate-200/90 dark:border-slate-800 text-left transition-all duration-150 cursor-pointer min-w-0"
                                                            >
                                                                <div className="flex items-start gap-2 w-full min-w-0">
                                                                    <FolderOpen size={16} className="mt-0.5 text-amber-500 shrink-0" />
                                                                    <span className="text-sm font-bold leading-snug text-slate-900 dark:text-slate-100 flex-1 min-w-0 line-clamp-2 break-words">
                                                                        {r.label}
                                                                    </span>
                                                                </div>
                                                                <div className="flex items-center justify-between gap-2 flex-wrap w-full">
                                                                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#1D7DB5] dark:text-blue-300 min-w-0">
                                                                        <span className="text-[10px] uppercase tracking-wider text-slate-400 shrink-0">{t('basecamp.search_in_project')}:</span>
                                                                        <span className="bg-blue-50 dark:bg-blue-950/30 px-1.5 py-0.5 rounded truncate max-w-[200px]">
                                                                            {r.projectName}
                                                                        </span>
                                                                    </div>
                                                                    {r.createdAt && (
                                                                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 shrink-0">
                                                                            {formatSearchDateTime(r.createdAt, language)}
                                                                        </span>
                                                                    )}
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
                            <p className="text-xs text-slate-400 dark:text-slate-500 py-4 text-center">
                                {t('basecamp.jump_description')}
                            </p>
                        )}
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Admin: Modo de Operación y Autonomía (z-[120]) */}
            {isAdmin && showModeModal && (
                <div
                    className="fixed inset-0 z-[120] flex items-center justify-center p-2.5 sm:p-4 bg-black/50 backdrop-blur-sm"
                    onClick={(e) => { if (e.target === e.currentTarget) setShowModeModal(false) }}
                >
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full max-h-[90dvh] overflow-y-auto p-4 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-200 text-left">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
                            <h3 className="text-lg font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                <span>{isStandaloneMode ? '🛡️' : '🔗'}</span>
                                <span>{t('basecamp.mode_settings_title')}</span>
                            </h3>
                            <button
                                type="button"
                                onClick={() => setShowModeModal(false)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                                title={t('basecamp.close_esc')}
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {modeError && (
                            <div className="mb-3 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs font-bold text-red-700 dark:text-red-300">
                                {modeError}
                            </div>
                        )}

                        <div className="space-y-3">
                            {/* Option 1: Hybrid Mode */}
                            <button
                                type="button"
                                disabled={savingMode}
                                onClick={() => void handleUpdateAutonomyMode('hybrid', autoCutoverEnabled)}
                                className={`w-full text-left p-4 rounded-2xl border-2 transition-all cursor-pointer ${
                                    !isStandaloneMode
                                        ? 'border-[#1D7DB5] bg-blue-50/70 dark:bg-blue-950/30 shadow-sm'
                                        : 'border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-800 bg-slate-50/50 dark:bg-slate-800/40'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span>🔗</span>
                                            <span className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
                                                {t('basecamp.mode_hybrid_title')}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                                            {t('basecamp.mode_hybrid_desc')}
                                        </p>
                                    </div>
                                    <span className={`w-5 h-5 rounded-full flex items-center justify-center border shrink-0 mt-0.5 ${!isStandaloneMode ? 'bg-[#1D7DB5] border-[#1D7DB5] text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                                        {!isStandaloneMode && <Check size={12} />}
                                    </span>
                                </div>
                            </button>

                            {/* Option 2: 100% Standalone TEG Mode */}
                            <button
                                type="button"
                                disabled={savingMode}
                                onClick={() => void handleUpdateAutonomyMode('standalone', autoCutoverEnabled)}
                                className={`w-full text-left p-4 rounded-2xl border-2 transition-all cursor-pointer ${
                                    isStandaloneMode
                                        ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30 shadow-sm'
                                        : 'border-slate-200 dark:border-slate-800 hover:border-emerald-300 dark:hover:border-emerald-800 bg-slate-50/50 dark:bg-slate-800/40'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span>🛡️</span>
                                            <span className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
                                                {t('basecamp.mode_standalone_title')}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                                            {t('basecamp.mode_standalone_desc')}
                                        </p>
                                    </div>
                                    <span className={`w-5 h-5 rounded-full flex items-center justify-center border shrink-0 mt-0.5 ${isStandaloneMode ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                                        {isStandaloneMode && <Check size={12} />}
                                    </span>
                                </div>
                            </button>

                            {/* Auto-Cutover Toggle */}
                            <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                                <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                                    {t('basecamp.auto_cutover_label')}
                                </span>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={autoCutoverEnabled}
                                    disabled={savingMode}
                                    onClick={() =>
                                        void handleUpdateAutonomyMode(
                                            isStandaloneMode ? 'standalone' : 'hybrid',
                                            !autoCutoverEnabled
                                        )
                                    }
                                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                        autoCutoverEnabled ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-600'
                                    }`}
                                >
                                    <span
                                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                            autoCutoverEnabled ? 'translate-x-5' : 'translate-x-0'
                                        }`}
                                    />
                                </button>
                            </div>
                        </div>

                        {savingMode && (
                            <div className="flex items-center justify-center gap-2 pt-3 text-xs font-bold text-[#1D7DB5]">
                                <Loader2 size={14} className="animate-spin" />
                                <span>{t('basecamp.saving_changes')}</span>
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
            <div className="-mx-2 sm:mx-auto sm:w-full max-w-[1360px] min-h-[60vh] flex items-center justify-center bg-white dark:bg-slate-900 sm:bg-[#FAF9F6] sm:dark:bg-slate-950/90 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-sm">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-9 w-9 border-2 border-slate-200 dark:border-slate-700 border-t-[#1D7DB5] mx-auto mb-3"></div>
                    <p className="text-slate-600 dark:text-slate-400 text-sm font-semibold">{t('basecamp.loading_bc')}</p>
                </div>
            </div>
        }>
            <BasecampWorkspace />
        </Suspense>
    )
}
