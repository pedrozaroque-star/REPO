/**
 * @module ToolDocs
 * @description Módulo de Documentos y Archivos (Docs & Files) para almacenar manuales de operaciones,
 *              procedimientos y reportes de Tacos Gavilan. Conecta con Supabase (`bc_vaults`, `bc_documents`,
 *              `bc_uploads`), almacena archivos binarios reales en Supabase Storage (`checklist-photos`) y
 *              sincroniza autoría real y acciones mediante `/api/basecamp/action`.
 * @businessRules
 *   - Respeta múltiples carpetas raíz (ej. "Docs & Files", "Weekly Operations Report", "Docs & Files 3" en "All Locations"):
 *     solo entra automáticamente a una carpeta raíz en la carga inicial cuando existe exactamente 1 vault raíz.
 *   - Si se crea un documento o se sube un archivo estando en la vista multi-raíz (`currentVaultId === null`),
 *     navega automáticamente al vault destino para que el elemento recién creado sea visible de inmediato.
 *   - Subidas de archivos validan límite máximo de 25 MB y registran metadatos vía `POST /api/basecamp/action`
 *     (`action: 'create_upload'`) para resolver siempre `author_person_id` al usuario real de TEG.
 *   - URLs heredadas de Basecamp pasan por `/api/basecamp/attachment?url=...`; enlaces de Google Drive abren en pestaña nueva.
 * @dataFlow
 *   - Entrada: Props `project` (`id` = bc_id, `db_id` = UUID), `currentUserName`, y opcionales `selectedDocId` / `onCloseDetail`.
 *   - Fetch: `bc_vaults`, `bc_documents`, `bc_uploads` filtrados por `project_id`.
 *   - Realtime: Suscripción `postgres_changes` (`event: '*'`) sobre `bc_documents`, `bc_uploads` y `bc_vaults`.
 *   - Escritura: `POST /api/basecamp/action` (`create_document`, `create_vault`, `create_upload`, `delete_recording`).
 * @notes
 *   - Soporte bilingüe completo (ES/EN) con `useLanguage` y soporte completo para modo oscuro (dark mode).
 *   - Renderiza HTML Trix de documentos de forma segura con `rewriteBasecampHtmlUrls` y `stripTegAuthorBanner`.
 */

'use client'

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLanguage } from '@/lib/i18n'
import {
    FolderOpen,
    FileText,
    Plus,
    FileSpreadsheet,
    FileDown,
    Trash2,
    Upload,
    Loader2,
    FileUp,
    FolderPlus,
    Paperclip,
    AlertCircle,
    X,
} from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { stripTegAuthorBanner } from '@/lib/basecamp-person-resolver'
import {
    rewriteBasecampHtmlUrls,
    proxyBasecampUrl,
    safeDecodeFilename,
} from '@/lib/basecamp-html'

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // 25 MB

interface ToolDocsProps {
    project: any
    currentUserName: string
    selectedDocId?: string
    onCloseDetail?: () => void
}

function extractAuthorName(rel: any, fallback: string): string {
    const obj = Array.isArray(rel) ? rel[0] : rel
    return (obj?.name && String(obj.name).trim()) || fallback
}

function formatPacificDate(isoStr: string | undefined | null, locale: string): string {
    if (!isoStr) return ''
    const d = new Date(isoStr)
    if (Number.isNaN(d.getTime())) return ''
    try {
        return new Intl.DateTimeFormat(locale, {
            timeZone: 'America/Los_Angeles',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        }).format(d)
    } catch {
        return d.toLocaleDateString(locale)
    }
}

function renderDocContentHtml(raw?: string | null): {
    html: string
    fileAttachments: { filename: string; url: string }[]
} {
    if (!raw) return { html: '', fileAttachments: [] }
    const { cleanHtml } = stripTegAuthorBanner(raw)
    if (!cleanHtml) return { html: '', fileAttachments: [] }

    const fileAttachments: { filename: string; url: string }[] = []
    const attachRegex = /<bc-attachment\b([^>]*)>([\s\S]*?)<\/bc-attachment>/gi
    let match: RegExpExecArray | null
    while ((match = attachRegex.exec(cleanHtml)) !== null) {
        const attrs = match[1] || ''
        const getAttr = (attr: string) => {
            const r = attrs.match(new RegExp(`(?:^|\\s)${attr}\\s*=\\s*(["'])([^"']+)\\1`, 'i'))
            return r ? r[2] : ''
        }
        const ct = getAttr('content-type').toLowerCase()
        const rawHref = getAttr('href') || getAttr('url')
        if (rawHref && !ct.startsWith('image/')) {
            fileAttachments.push({
                filename: safeDecodeFilename(getAttr('filename'), 'attachment'),
                url: proxyBasecampUrl(rawHref),
            })
        }
    }

    const hasHtmlTags = /<\s*(?:div|p|br|ul|ol|li|h[1-6]|blockquote|pre|table|figure|bc-attachment|img|a|strong|b|em|i|span|del|u)\b/i.test(
        cleanHtml
    )
    let safeHtml: string
    if (hasHtmlTags) {
        safeHtml = rewriteBasecampHtmlUrls(cleanHtml).replace(
            /<bc-attachment\b[^>]*>([\s\S]*?)<\/bc-attachment>/gi,
            '$1'
        )
    } else {
        safeHtml = cleanHtml
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\r?\n/g, '<br />')
    }

    return { html: safeHtml, fileAttachments }
}

async function parseActionError(res: Response, fallback: string): Promise<string> {
    try {
        const text = await res.text()
        if (!text) return fallback
        const parsed = JSON.parse(text)
        return parsed?.error || text
    } catch {
        return fallback
    }
}

export default function ToolDocs({
    project,
    currentUserName: _currentUserName,
    selectedDocId,
    onCloseDetail,
}: ToolDocsProps) {
    const supabase = useMemo(() => getSupabaseWithAuth(), [])
    const searchParams = useSearchParams()
    const urlDocIdParam = searchParams?.get('docId') || undefined
    const effectiveSelectedDocId = selectedDocId || urlDocIdParam
    const { t, language } = useLanguage()
    const locale = language === 'es' ? 'es-MX' : 'en-US'

    const clearUrlDocIdIfNeeded = useCallback(() => {
        if (onCloseDetail) {
            onCloseDetail()
            return
        }
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search)
            if (params.has('docId')) {
                params.delete('docId')
                const qs = params.toString()
                window.history.replaceState(null, '', qs ? `/basecamp?${qs}` : '/basecamp')
            }
        }
    }, [onCloseDetail])

    const [allVaults, setAllVaults] = useState<any[]>([])
    const [allDocs, setAllDocs] = useState<any[]>([])
    const [allUploads, setAllUploads] = useState<any[]>([])

    const [currentVaultId, setCurrentVaultId] = useState<string | null>(null)
    const [selectedDocIdState, setSelectedDocIdState] = useState<string | null>(null)

    const [loading, setLoading] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const [errorBanner, setErrorBanner] = useState<string | null>(null)

    const [showCreateForm, setShowCreateForm] = useState(false)
    const [showCreateFolderForm, setShowCreateFolderForm] = useState(false)

    const [newDocName, setNewDocName] = useState('')
    const [newDocContent, setNewDocContent] = useState('')
    const [newFolderName, setNewFolderName] = useState('')

    const [isUploading, setIsUploading] = useState(false)
    const [uploadProgress, setUploadProgress] = useState(0)

    const isMountedRef = useRef(true)
    const creatingVaultRef = useRef<Record<string, boolean>>({})
    const activeProjectDbIdRef = useRef<string | null>(project?.db_id || null)

    useEffect(() => {
        isMountedRef.current = true
        return () => {
            isMountedRef.current = false
        }
    }, [])

    const fetchAllProjectDocsData = useCallback(
        async (opts?: { initialLoad?: boolean; silent?: boolean }) => {
            const projectDbId = project?.db_id
            if (!projectDbId) return

            const initialLoad = opts?.initialLoad ?? false
            const silent = opts?.silent ?? false
            if (!silent) setLoading(true)

            try {
                // 1. Fetch vaults ordered oldest-first
                const { data: dbVaults, error: vaultsErr } = await supabase
                    .from('bc_vaults')
                    .select('id, bc_id, name, parent_vault_id, created_at')
                    .eq('project_id', projectDbId)
                    .order('created_at', { ascending: true })
                if (vaultsErr) throw vaultsErr

                let finalVaults = dbVaults || []

                // Safe container auto-creation if project has zero vaults
                if (finalVaults.length === 0 && !creatingVaultRef.current[projectDbId]) {
                    creatingVaultRef.current[projectDbId] = true
                    try {
                        const { data: recheck } = await supabase
                            .from('bc_vaults')
                            .select('id, bc_id, name, parent_vault_id, created_at')
                            .eq('project_id', projectDbId)
                            .order('created_at', { ascending: true })
                            .limit(1)
                            .maybeSingle()

                        if (recheck) {
                            finalVaults = [recheck]
                        } else {
                            const uniqueBcId = Date.now() * 1000 + Math.floor(Math.random() * 1000)
                            const { data: newVault, error: vaultErr } = await supabase
                                .from('bc_vaults')
                                .insert({
                                    project_id: projectDbId,
                                    bc_id: uniqueBcId,
                                    name: 'Docs & Files',
                                    parent_vault_id: null,
                                })
                                .select('id, bc_id, name, parent_vault_id, created_at')
                                .maybeSingle()
                            if (!vaultErr && newVault) {
                                finalVaults = [newVault]
                            }
                        }
                    } finally {
                        creatingVaultRef.current[projectDbId] = false
                    }
                }

                // 2. Fetch documents and uploads in parallel
                const [docsRes, upsRes] = await Promise.all([
                    supabase
                        .from('bc_documents')
                        .select(
                            `
                            id, bc_id, title, content, vault_id, created_at,
                            author:bc_people(name)
                        `
                        )
                        .eq('project_id', projectDbId)
                        .order('created_at', { ascending: false }),
                    supabase
                        .from('bc_uploads')
                        .select(
                            `
                            id, bc_id, filename, content_type, byte_size, download_url, vault_id, created_at,
                            author:bc_people(name)
                        `
                        )
                        .eq('project_id', projectDbId)
                        .order('created_at', { ascending: false }),
                ])

                if (docsRes.error) throw docsRes.error
                if (upsRes.error) throw upsRes.error
                if (!isMountedRef.current || activeProjectDbIdRef.current !== projectDbId) return

                const docsData = docsRes.data || []
                const upsData = upsRes.data || []

                setAllVaults(finalVaults)
                setAllDocs(docsData)
                setAllUploads(upsData)

                if (initialLoad) {
                    const urlDocId =
                        selectedDocId ||
                        (typeof window !== 'undefined'
                            ? new URLSearchParams(window.location.search).get('docId') || undefined
                            : undefined)

                    if (urlDocId) {
                        const matchedDoc = docsData.find(
                            (d: any) => String(d.id) === String(urlDocId) || String(d.bc_id) === String(urlDocId)
                        )
                        const matchedUp = !matchedDoc
                            ? upsData.find(
                                  (u: any) =>
                                      String(u.id) === String(urlDocId) || String(u.bc_id) === String(urlDocId)
                              )
                            : null

                        if (matchedDoc) {
                            setCurrentVaultId(matchedDoc.vault_id || null)
                            setSelectedDocIdState(matchedDoc.id)
                            return
                        }
                        if (matchedUp) {
                            setCurrentVaultId(matchedUp.vault_id || null)
                            setSelectedDocIdState(matchedUp.id)
                            return
                        }
                    }

                    // Multi-root fix: only auto-enter when there is a single root vault!
                    // When multiple root vaults exist (e.g. "Docs & Files", "Weekly Operations Report", "Docs & Files 3"),
                    // stay at null so ALL root vaults remain visible.
                    const rootVaults = finalVaults.filter((v: any) => !v.parent_vault_id)
                    if (rootVaults.length === 1) {
                        setCurrentVaultId(rootVaults[0].id)
                    } else {
                        setCurrentVaultId(null)
                    }
                }
            } catch (err: any) {
                console.error('❌ [ToolDocs FetchAll] Error:', err.message)
                if (isMountedRef.current && activeProjectDbIdRef.current === projectDbId && !silent) {
                    setErrorBanner(`${t('basecamp.action_error')}: ${err.message}`)
                }
            } finally {
                if (isMountedRef.current && activeProjectDbIdRef.current === projectDbId && !silent) {
                    setLoading(false)
                }
            }
        },
        [project?.db_id, selectedDocId, supabase, t]
    )

    // Reset & reload when project changes
    useEffect(() => {
        activeProjectDbIdRef.current = project?.db_id || null
        setAllVaults([])
        setAllDocs([])
        setAllUploads([])
        setCurrentVaultId(null)
        setSelectedDocIdState(null)
        setShowCreateForm(false)
        setShowCreateFolderForm(false)
        setErrorBanner(null)
        setLoading(true)

        if (project?.db_id) {
            fetchAllProjectDocsData({ initialLoad: true })
        } else {
            setLoading(false)
        }
    }, [project?.id, project?.db_id, fetchAllProjectDocsData])

    // Deep-link updates if selectedDocId prop or ?docId= URL param changes while mounted
    useEffect(() => {
        if (!effectiveSelectedDocId) return
        const matchedDoc = allDocs.find(
            (d) =>
                String(d.id) === String(effectiveSelectedDocId) ||
                String(d.bc_id) === String(effectiveSelectedDocId)
        )
        if (matchedDoc) {
            setCurrentVaultId(matchedDoc.vault_id || null)
            setSelectedDocIdState(matchedDoc.id)
            return
        }
        const matchedUp = allUploads.find(
            (u) =>
                String(u.id) === String(effectiveSelectedDocId) ||
                String(u.bc_id) === String(effectiveSelectedDocId)
        )
        if (matchedUp) {
            setCurrentVaultId(matchedUp.vault_id || null)
            setSelectedDocIdState(matchedUp.id)
        }
    }, [effectiveSelectedDocId, allDocs, allUploads])

    // Realtime subscription for bc_documents, bc_uploads, and bc_vaults
    useEffect(() => {
        const projectDbId = project?.db_id
        if (!projectDbId) return

        const channel = supabase
            .channel(`docs-realtime-${projectDbId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'bc_documents',
                    filter: `project_id=eq.${projectDbId}`,
                },
                () => {
                    fetchAllProjectDocsData({ initialLoad: false, silent: true })
                }
            )
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'bc_uploads',
                    filter: `project_id=eq.${projectDbId}`,
                },
                () => {
                    fetchAllProjectDocsData({ initialLoad: false, silent: true })
                }
            )
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'bc_vaults',
                    filter: `project_id=eq.${projectDbId}`,
                },
                () => {
                    fetchAllProjectDocsData({ initialLoad: false, silent: true })
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [project?.db_id, supabase, fetchAllProjectDocsData])

    // Escape key closes active detail/form
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (selectedDocIdState) {
                    setSelectedDocIdState(null)
                    clearUrlDocIdIfNeeded()
                } else if (showCreateForm) {
                    setShowCreateForm(false)
                } else if (showCreateFolderForm) {
                    setShowCreateFolderForm(false)
                }
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [selectedDocIdState, showCreateForm, showCreateFolderForm, clearUrlDocIdIfNeeded])

    // Resolve default target vault when user creates a doc or upload from multi-root view
    const resolveTargetVaultForItem = () => {
        if (currentVaultId) {
            const cv = allVaults.find((v) => v.id === currentVaultId)
            return { dbId: currentVaultId, bcId: cv?.bc_id ? Number(cv.bc_id) : null }
        }
        const rootVaults = allVaults.filter((v) => !v.parent_vault_id)
        const preferred =
            rootVaults.find((v) => v.name?.toLowerCase() === 'docs & files') ||
            rootVaults[0] ||
            allVaults[0]
        return {
            dbId: preferred?.id || null,
            bcId: preferred?.bc_id ? Number(preferred.bc_id) : null,
        }
    }

    const handleSaveDoc = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newDocName.trim() || !newDocContent.trim() || submitting) return
        setSubmitting(true)
        setErrorBanner(null)

        const { dbId: targetVaultDbId, bcId: targetVaultBcId } = resolveTargetVaultForItem()

        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_document',
                    projectId: project.id,
                    vaultId: targetVaultBcId,
                    vaultDbId: targetVaultDbId,
                    title: newDocName.trim(),
                    content: newDocContent.trim(),
                }),
            })

            if (!res.ok) {
                throw new Error(await parseActionError(res, t('basecamp.action_error')))
            }

            setNewDocName('')
            setNewDocContent('')
            setShowCreateForm(false)
            // Navigate into targetVaultDbId if created from root so the new doc isn't hidden
            if (!currentVaultId && targetVaultDbId) {
                setCurrentVaultId(targetVaultDbId)
            }
            await fetchAllProjectDocsData({ initialLoad: false, silent: true })
        } catch (err: any) {
            console.error('❌ [ToolDocs SaveDoc] Error:', err.message)
            setErrorBanner(`${t('basecamp.action_error')}: ${err.message}`)
        } finally {
            setSubmitting(false)
        }
    }

    const handleCreateFolder = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newFolderName.trim() || submitting) return
        setSubmitting(true)
        setErrorBanner(null)

        const currentVault = allVaults.find((v) => v.id === currentVaultId)
        const parentVaultDbId = currentVaultId || null
        const parentVaultBcId = currentVault?.bc_id ? Number(currentVault.bc_id) : null

        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_vault',
                    projectId: project.id,
                    parentVaultId: parentVaultBcId,
                    parentVaultDbId,
                    name: newFolderName.trim(),
                }),
            })

            if (!res.ok) {
                throw new Error(await parseActionError(res, t('basecamp.action_error')))
            }

            setNewFolderName('')
            setShowCreateFolderForm(false)
            await fetchAllProjectDocsData({ initialLoad: false, silent: true })
        } catch (err: any) {
            console.error('❌ [ToolDocs CreateFolder] Error:', err.message)
            setErrorBanner(`${t('basecamp.action_error')}: ${err.message}`)
        } finally {
            setSubmitting(false)
        }
    }

    const handleDeleteDoc = async (item: any, e: React.MouseEvent) => {
        e.stopPropagation()
        if (!confirm(t('basecamp.delete_doc_confirm'))) return
        setSubmitting(true)
        setErrorBanner(null)

        try {
            const tableName =
                item.type === 'doc'
                    ? 'bc_documents'
                    : item.type === 'folder'
                    ? 'bc_vaults'
                    : 'bc_uploads'

            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'delete_recording',
                    projectId: project.id,
                    recordingId: item.bc_id,
                    recordingDbId: item.id,
                    tableName,
                }),
            })

            if (!res.ok) {
                throw new Error(await parseActionError(res, t('basecamp.action_error')))
            }

            if (selectedDocIdState === item.id) {
                setSelectedDocIdState(null)
                clearUrlDocIdIfNeeded()
            }
            if (currentVaultId === item.id) {
                setCurrentVaultId(null)
            }
            await fetchAllProjectDocsData({ initialLoad: false, silent: true })
        } catch (err: any) {
            console.error('❌ [ToolDocs Delete] Error:', err.message)
            setErrorBanner(`${t('basecamp.action_error')}: ${err.message}`)
        } finally {
            setSubmitting(false)
        }
    }

    const handleFileUploadReal = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const inputEl = e.target
        const file = inputEl.files?.[0]
        if (!file) return

        setErrorBanner(null)

        if (file.size > MAX_UPLOAD_BYTES) {
            setErrorBanner(t('basecamp.file_too_large_25mb'))
            inputEl.value = ''
            return
        }

        setIsUploading(true)
        setUploadProgress(15)

        let uploadedStoragePath: string | null = null

        try {
            const rawParts = (file.name || '').split('.')
            const rawExt = rawParts.length > 1 ? rawParts.pop() || 'bin' : 'bin'
            const safeExt = rawExt.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'bin'
            const filePath = `basecamp-uploads/${project.db_id}/${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 9)}.${safeExt}`

            setUploadProgress(35)

            const { error: uploadError } = await supabase.storage
                .from('checklist-photos')
                .upload(filePath, file)

            if (uploadError) throw uploadError
            uploadedStoragePath = filePath
            setUploadProgress(70)

            const { data: pubData } = supabase.storage
                .from('checklist-photos')
                .getPublicUrl(filePath)
            if (!pubData?.publicUrl) {
                throw new Error('Failed to retrieve public URL from Supabase Storage')
            }

            setUploadProgress(85)

            const { dbId: targetVaultDbId } = resolveTargetVaultForItem()

            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_upload',
                    projectId: project.id,
                    vaultDbId: targetVaultDbId,
                    filename: file.name,
                    content_type: file.type || 'application/octet-stream',
                    byte_size: file.size,
                    download_url: pubData.publicUrl,
                }),
            })

            if (!res.ok) {
                const msg = await parseActionError(res, t('basecamp.file_upload_error'))
                throw new Error(msg)
            }

            const result = await res.json()
            uploadedStoragePath = null // Saved cleanly in DB; do not roll back

            if (isMountedRef.current) {
                setUploadProgress(100)
                const resolvedVaultId = result?.vault_id || targetVaultDbId
                if (!currentVaultId && resolvedVaultId) {
                    setCurrentVaultId(resolvedVaultId)
                }
                await fetchAllProjectDocsData({ initialLoad: false, silent: true })
            }
        } catch (err: any) {
            console.error('❌ [ToolDocs Upload] Error:', err.message)
            if (uploadedStoragePath) {
                await supabase.storage.from('checklist-photos').remove([uploadedStoragePath]).catch(() => {})
            }
            if (isMountedRef.current) {
                setErrorBanner(`${t('basecamp.file_upload_error')}: ${err.message}`)
            }
        } finally {
            inputEl.value = ''
            if (isMountedRef.current) {
                setIsUploading(false)
                setUploadProgress(0)
            }
        }
    }

    // Build recursive breadcrumb history safely (cycle-guarded)
    const pathHistory = useMemo(() => {
        const history: { id: string | null; name: string }[] = []
        const visited = new Set<string>()
        let currId = currentVaultId
        while (currId !== null && !visited.has(currId)) {
            visited.add(currId)
            const v = allVaults.find((item) => item.id === currId)
            if (!v) break
            history.unshift({ id: v.id, name: v.name })
            currId = v.parent_vault_id
        }
        history.unshift({ id: null, name: t('basecamp.docs_files') })
        return history
    }, [allVaults, currentVaultId, t])

    // Map all documents and uploads for fast lookup & current-vault filtering
    const mappedDocs = useMemo(
        () =>
            allDocs.map((d) => {
                const byteLen = (d.content || '').length
                return {
                    id: d.id,
                    bc_id: d.bc_id,
                    vault_id: d.vault_id || null,
                    name: d.title || t('basecamp.doc_file_label'),
                    type: 'doc' as const,
                    content: d.content || '',
                    content_type: 'text/html',
                    download_url: '',
                    author: extractAuthorName(d.author, t('basecamp.unknown_user')),
                    size: `${Math.max(0.1, Math.round((byteLen / 1024) * 10) / 10)} KB`,
                    date: formatPacificDate(d.created_at, locale),
                    createdAtMs: new Date(d.created_at || 0).getTime(),
                }
            }),
        [allDocs, locale, t]
    )

    const mappedUploads = useMemo(
        () =>
            allUploads.map((u) => {
                const safeName = safeDecodeFilename(
                    u.filename,
                    t('basecamp.attached_file_fallback')
                )
                const extParts = (safeName || '').split('.')
                const fileExt =
                    extParts.length > 1 ? extParts.pop()?.toLowerCase() || 'file' : 'file'

                const rawUrl = String(u.download_url || '')
                const isGoogle =
                    rawUrl.includes('docs.google.com') ||
                    rawUrl.includes('drive.google.com') ||
                    Boolean(u.content_type?.endsWith('.document')) ||
                    Boolean(u.content_type?.endsWith('.spreadsheet'))

                let displayType = 'file'
                if (isGoogle) {
                    displayType = 'google_doc'
                } else if (fileExt === 'xlsx' || fileExt === 'csv' || fileExt === 'xls') {
                    displayType = 'xlsx'
                } else if (fileExt === 'pdf') {
                    displayType = 'pdf'
                }

                const bytes = Math.max(0, Number(u.byte_size) || 0)
                const sizeStr =
                    bytes >= 1024 * 1024
                        ? `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`
                        : `${Math.max(0.1, Math.round((bytes / 1024) * 10) / 10)} KB`

                const proxiedUrl = isGoogle ? rawUrl : proxyBasecampUrl(rawUrl)

                return {
                    id: u.id,
                    bc_id: u.bc_id,
                    vault_id: u.vault_id || null,
                    name: safeName,
                    type: displayType,
                    content: '',
                    content_type: u.content_type || 'application/octet-stream',
                    download_url: proxiedUrl,
                    author: extractAuthorName(u.author, t('basecamp.unknown_user')),
                    size: sizeStr,
                    date: formatPacificDate(u.created_at, locale),
                    createdAtMs: new Date(u.created_at || 0).getTime(),
                }
            }),
        [allUploads, locale, t]
    )

    // Keep selectedDoc live-synced with Realtime updates (or null if deleted)
    const selectedDoc = useMemo(() => {
        if (!selectedDocIdState) return null
        return (
            mappedDocs.find((d) => d.id === selectedDocIdState) ||
            mappedUploads.find((u) => u.id === selectedDocIdState) ||
            null
        )
    }, [selectedDocIdState, mappedDocs, mappedUploads])

    const combinedItems = useMemo(() => {
        const subfolders = allVaults
            .filter((v) => (v.parent_vault_id || null) === currentVaultId)
            .map((v) => ({
                id: v.id,
                bc_id: v.bc_id,
                vault_id: v.parent_vault_id || null,
                name: v.name,
                type: 'folder',
                content: '',
                content_type: '',
                download_url: '',
                author: '',
                size: '',
                date: formatPacificDate(v.created_at, locale),
                createdAtMs: new Date(v.created_at || 0).getTime(),
            }))

        const docsInVault = mappedDocs.filter((d) => d.vault_id === currentVaultId)
        const upsInVault = mappedUploads.filter((u) => u.vault_id === currentVaultId)

        const all = [...subfolders, ...docsInVault, ...upsInVault]
        all.sort((a, b) => {
            if (a.type === 'folder' && b.type !== 'folder') return -1
            if (a.type !== 'folder' && b.type === 'folder') return 1
            return b.createdAtMs - a.createdAtMs
        })
        return all
    }, [allVaults, mappedDocs, mappedUploads, currentVaultId, locale])

    const handleItemClick = (item: any) => {
        if (item.type === 'folder') {
            setCurrentVaultId(item.id)
            setSelectedDocIdState(null)
            setShowCreateForm(false)
            setShowCreateFolderForm(false)
        } else if (
            item.type === 'google_doc' ||
            item.download_url?.includes('docs.google.com') ||
            item.download_url?.includes('drive.google.com')
        ) {
            window.open(item.download_url, '_blank', 'noopener,noreferrer')
        } else {
            setSelectedDocIdState(item.id)
        }
    }

    const getIconClasses = (type: string) => {
        switch (type) {
            case 'folder':
                return {
                    icon: <FolderOpen size={18} />,
                    cls: 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400',
                }
            case 'google_doc':
                return {
                    icon: <FileText size={18} />,
                    cls: 'bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400',
                }
            case 'xlsx':
                return {
                    icon: <FileSpreadsheet size={18} />,
                    cls: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400',
                }
            case 'pdf':
                return {
                    icon: <FileText size={18} />,
                    cls: 'bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400',
                }
            case 'doc':
                return {
                    icon: <FileText size={18} />,
                    cls: 'bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400',
                }
            default:
                return {
                    icon: <FileUp size={18} />,
                    cls: 'bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400',
                }
        }
    }

    return (
        <div className="flex flex-col flex-1 max-w-5xl mx-auto w-full gap-5">
            {/* 1. CABECERA CON BREADCRUMBS Y ACCIONES */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
                <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
                        {pathHistory.map((step, idx) => {
                            const isActive = step.id === currentVaultId
                            return (
                                <React.Fragment key={step.id || 'root'}>
                                    {idx > 0 && (
                                        <span className="text-slate-400 dark:text-slate-500">›</span>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setCurrentVaultId(step.id)
                                            setSelectedDocIdState(null)
                                            setShowCreateForm(false)
                                            setShowCreateFolderForm(false)
                                            clearUrlDocIdIfNeeded()
                                        }}
                                        className={`text-left transition-colors ${
                                            isActive
                                                ? 'font-bold text-slate-900 dark:text-slate-100'
                                                : 'font-medium text-[#1D7DB5] dark:text-sky-400 hover:text-[#155D8A] dark:hover:text-sky-300'
                                        }`}
                                    >
                                        {step.name}
                                    </button>
                                </React.Fragment>
                            )
                        })}
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider m-0">
                        {t('basecamp.docs_files_created')}
                    </p>
                </div>

                {!showCreateForm && !showCreateFolderForm && !selectedDoc && (
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Subir archivo */}
                        <label
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-bold transition-colors ${
                                isUploading ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                            }`}
                        >
                            <Upload size={13} />
                            <span>{t('basecamp.upload_file')}</span>
                            <input
                                type="file"
                                onChange={handleFileUploadReal}
                                className="hidden"
                                disabled={isUploading}
                            />
                        </label>

                        {/* Nueva Carpeta */}
                        <button
                            type="button"
                            onClick={() => {
                                setErrorBanner(null)
                                setShowCreateFolderForm(true)
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-bold transition-colors"
                        >
                            <FolderPlus size={13} />
                            <span>{t('basecamp.add_folder')}</span>
                        </button>

                        {/* Nuevo Documento */}
                        <button
                            type="button"
                            onClick={() => {
                                setErrorBanner(null)
                                setShowCreateForm(true)
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] text-white text-xs font-extrabold shadow-sm transition-colors"
                        >
                            <Plus size={13} />
                            <span>{t('basecamp.new_doc_btn')}</span>
                        </button>
                    </div>
                )}
            </div>

            {/* BANNER DE ERROR VISIBLE */}
            {errorBanner && (
                <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 text-red-700 dark:text-red-300 text-xs flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <AlertCircle size={15} className="shrink-0" />
                        <span className="break-words">{errorBanner}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setErrorBanner(null)}
                        className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/50 shrink-0"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* BARRA DE PROGRESO DE CARGA */}
            {isUploading && (
                <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 rounded-2xl p-4 flex flex-col gap-2">
                    <div className="flex justify-between items-center text-xs font-bold text-blue-800 dark:text-blue-300">
                        <span className="flex items-center gap-1.5">
                            <Loader2 className="animate-spin text-[#1D7DB5]" size={13} />
                            <span>{t('basecamp.uploading_real_file')}</span>
                        </span>
                        <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                        <div
                            className="bg-[#1D7DB5] h-full transition-all duration-300"
                            style={{ width: `${uploadProgress}%` }}
                        />
                    </div>
                </div>
            )}

            {/* 2. DETALLE DE UN DOCUMENTO NATIVO O ARCHIVO */}
            {selectedDoc && (
                <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2.5">
                        <button
                            type="button"
                            onClick={() => {
                                setSelectedDocIdState(null)
                                clearUrlDocIdIfNeeded()
                            }}
                            className="text-[#1D7DB5] dark:text-sky-400 hover:underline text-xs font-bold"
                        >
                            {t('basecamp.back')}
                        </button>
                        <button
                            type="button"
                            disabled={submitting}
                            onClick={(e) => handleDeleteDoc(selectedDoc, e)}
                            className="flex items-center gap-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
                        >
                            <Trash2 size={13} />
                            <span>{t('basecamp.delete')}</span>
                        </button>
                    </div>

                    <article className="bg-[#FCFAF6] dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm">
                        <span className="inline-block text-[9px] font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wider bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 rounded border border-amber-300 dark:border-amber-800">
                            {selectedDoc.type === 'doc'
                                ? t('basecamp.text_document')
                                : t('basecamp.external_file')}
                        </span>
                        <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 mt-3 mb-3 font-serif break-words">
                            {selectedDoc.name}
                        </h2>

                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 border-t border-b border-slate-200 dark:border-slate-800 py-2 mb-5">
                            <span>
                                {t('basecamp.author_label')}:{' '}
                                <strong className="text-slate-800 dark:text-slate-200">
                                    {selectedDoc.author}
                                </strong>
                            </span>
                            <span>•</span>
                            <span>
                                {t('basecamp.date_label')}: {selectedDoc.date}
                            </span>
                            {selectedDoc.size && (
                                <>
                                    <span>•</span>
                                    <span>
                                        {t('basecamp.size_label')}: {selectedDoc.size}
                                    </span>
                                </>
                            )}
                        </div>

                        {selectedDoc.type === 'doc' ? (
                            (() => {
                                const rendered = renderDocContentHtml(selectedDoc.content)
                                return (
                                    <div className="space-y-4">
                                        {rendered.html ? (
                                            <div
                                                className="text-[13px] text-slate-800 dark:text-slate-200 leading-relaxed break-words [&_a]:text-[#1D7DB5] dark:[&_a]:text-sky-400 [&_a]:underline [&_img]:max-w-full [&_img]:rounded-xl [&_img]:my-3 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5"
                                                dangerouslySetInnerHTML={{ __html: rendered.html }}
                                            />
                                        ) : (
                                            <p className="text-xs italic text-slate-400 dark:text-slate-500">
                                                {t('basecamp.no_description')}
                                            </p>
                                        )}
                                        {rendered.fileAttachments.length > 0 && (
                                            <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                                                {rendered.fileAttachments.map((att, idx) => (
                                                    <a
                                                        key={idx}
                                                        href={att.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-[#1D7DB5]"
                                                    >
                                                        <Paperclip size={12} />
                                                        <span>{att.filename}</span>
                                                    </a>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )
                            })()
                        ) : (
                            <div className="flex flex-col items-center justify-center py-6 text-center">
                                {selectedDoc.content_type?.startsWith('image/') &&
                                selectedDoc.download_url ? (
                                    <img
                                        src={selectedDoc.download_url}
                                        alt={selectedDoc.name}
                                        className="max-h-96 max-w-full rounded-xl border border-slate-200 dark:border-slate-700 mb-5 object-contain shadow-sm"
                                    />
                                ) : (
                                    <FileDown size={44} className="text-emerald-500 mb-2" />
                                )}
                                <p className="font-bold text-[13px] text-slate-800 dark:text-slate-100 m-0">
                                    {t('basecamp.binary_file_desc')}
                                </p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 mb-4">
                                    {t('basecamp.binary_file_sub')}
                                </p>
                                {selectedDoc.download_url && (
                                    <a
                                        href={selectedDoc.download_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1D7DB5] hover:bg-[#155D8A] text-white rounded-xl font-bold text-xs shadow-sm transition-colors"
                                    >
                                        <FileDown size={14} />
                                        <span>{t('basecamp.download_file_btn')}</span>
                                    </a>
                                )}
                            </div>
                        )}
                    </article>
                </div>
            )}

            {/* 3. FORMULARIO CREAR DOCUMENTO */}
            {showCreateForm && (
                <div className="bg-[#FCFAF6] dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm">
                    <button
                        type="button"
                        onClick={() => setShowCreateForm(false)}
                        className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 text-xs font-bold mb-4"
                    >
                        {t('basecamp.back')}
                    </button>

                    <h3 className="text-[15px] font-extrabold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-800 pb-2 mb-4">
                        {t('basecamp.new_doc_btn')}
                    </h3>

                    <form onSubmit={handleSaveDoc} className="flex flex-col gap-3.5">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                                {t('basecamp.document_title_label')}
                            </label>
                            <input
                                type="text"
                                required
                                value={newDocName}
                                onChange={(e) => setNewDocName(e.target.value)}
                                placeholder={t('basecamp.new_doc_title')}
                                className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1D7DB5]"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                                {t('basecamp.document_content_label')}
                            </label>
                            <textarea
                                required
                                value={newDocContent}
                                onChange={(e) => setNewDocContent(e.target.value)}
                                placeholder={t('basecamp.new_doc_content')}
                                className="w-full h-40 px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1D7DB5] resize-y"
                            />
                        </div>
                        <div className="flex justify-end gap-2 mt-1">
                            <button
                                type="button"
                                onClick={() => setShowCreateForm(false)}
                                className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                            >
                                {t('basecamp.cancel')}
                            </button>
                            <button
                                type="submit"
                                disabled={submitting}
                                className="px-4 py-2 bg-[#1D7DB5] hover:bg-[#155D8A] disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5"
                            >
                                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <span>{t('basecamp.save_doc')}</span>
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* 4. FORMULARIO CREAR CARPETA */}
            {showCreateFolderForm && (
                <div className="bg-[#FCFAF6] dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm">
                    <button
                        type="button"
                        onClick={() => setShowCreateFolderForm(false)}
                        className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 text-xs font-bold mb-4"
                    >
                        {t('basecamp.back')}
                    </button>

                    <h3 className="text-[15px] font-extrabold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-800 pb-2 mb-4">
                        {t('basecamp.add_folder')}
                    </h3>

                    <form onSubmit={handleCreateFolder} className="flex flex-col gap-3.5">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                                {t('basecamp.folder_name_label')}
                            </label>
                            <input
                                type="text"
                                required
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                placeholder={t('basecamp.folder_name_placeholder')}
                                className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1D7DB5]"
                            />
                        </div>
                        <div className="flex justify-end gap-2 mt-1">
                            <button
                                type="button"
                                onClick={() => setShowCreateFolderForm(false)}
                                className="px-4 py-2 text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                            >
                                {t('basecamp.cancel')}
                            </button>
                            <button
                                type="submit"
                                disabled={submitting}
                                className="px-4 py-2 bg-[#1D7DB5] hover:bg-[#155D8A] disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5"
                            >
                                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <span>{t('basecamp.save_folder')}</span>
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* 5. LISTADO DE ELEMENTOS EN FORMATO FILAS */}
            {!showCreateForm && !showCreateFolderForm && !selectedDoc && (
                <div className="flex flex-col">
                    {loading ? (
                        <div className="flex justify-center py-10">
                            <Loader2 className="w-8 h-8 text-[#1D7DB5] animate-spin" />
                        </div>
                    ) : combinedItems.length > 0 ? (
                        <div className="flex flex-col border border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
                            {combinedItems.map((item, index) => {
                                const iconStyle = getIconClasses(item.type)
                                const isGoogle = item.type === 'google_doc'
                                return (
                                    <div
                                        key={item.id}
                                        onClick={() => handleItemClick(item)}
                                        className={`group flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors ${
                                            index === combinedItems.length - 1
                                                ? ''
                                                : 'border-b border-slate-200/70 dark:border-slate-800'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                            <div
                                                className={`flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${iconStyle.cls}`}
                                            >
                                                {iconStyle.icon}
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-[13.5px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                                                        {item.name}
                                                    </span>
                                                    {isGoogle && (
                                                        <span className="text-[9px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 px-1.5 py-0.5 rounded uppercase tracking-wider">
                                                            {t('basecamp.google_drive_label')}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                                    {item.type === 'folder'
                                                        ? `${t('basecamp.folder_label')}${item.date ? ` • ${item.date}` : ''}`
                                                        : `${item.size} • ${t('basecamp.by')} ${(item.author || '').split(' ')[0]} • ${item.date}`}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center">
                                            <button
                                                type="button"
                                                disabled={submitting}
                                                onClick={(e) => handleDeleteDoc(item, e)}
                                                className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50 disabled:opacity-40"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        <div className="text-center py-12 px-6 bg-[#FCFAF6] dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                            <FolderOpen
                                size={36}
                                className="text-slate-400 dark:text-slate-500 mx-auto mb-3"
                            />
                            <p className="text-xs text-slate-500 dark:text-slate-400 italic m-0">
                                {t('basecamp.no_docs')}
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
