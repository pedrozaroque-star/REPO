/**
 * @module ToolTodos
 * @description Módulo completo de listas de tareas (To-dos: Pedidos y Casos) clonado al 100% de Basecamp 3/4
 *              para coordinar las operaciones de Tacos Gavilan (TEG).
 *              Conecta directamente con Supabase (`bc_todolists`, `bc_todolist_groups`, `bc_todos`,
 *              `bc_todo_assignees`, `bc_comments`, `bc_boosts`, `bc_people`) con suscripciones Realtime
 *              y escrituras bidireccionales en Basecamp 3 API a través de `/api/basecamp/action`.
 * @businessRules
 *   - **Exclusión estricta de `Al terminar` (`When done`)**: Por instrucción expresa de negocio, el campo
 *     `When done` NO se muestra en la UI ni al crear ni al editar tareas (el backend preserva internamente
 *     cualquier suscriptor previo en Basecamp 3 para no perder datos remotos).
 *   - **Reparación integral de `@Menciones`**: Excluye `application/vnd.basecamp.mention` de los chips de
 *     archivos adjuntos (cero enlaces rotos `href="#"`), excluye mini-avatares de overlays de descarga y
 *     transforma todas las menciones históricas y nuevas en píldoras `.bc-mention-pill` vía `transformBasecampMentionsToPills`.
 *   - **Editor rico Trix (`BasecampRichEditor`) con `@` autocompletado**: Activo al crear tareas, editar tareas,
 *     publicar comentarios y editar comentarios, soportando fotos/archivos inline y menciones reales/sintéticas.
 *   - **Edición completa e inline + Mover entre listas/proyectos**: Permite editar título, asignados (con botón
 *     rápido `Asignarme a mí`), fechas (`Sin fecha` / `Un día específico` / `Varios días`: `starts_on -> due_date`),
 *     grupo y notas enriquecidas (`update_todo`), subir al inicio (`Bubble up` / `position: 1`), y mover tareas
 *     mal ubicadas entre listas o proyectos (`move_todo`, ej. de `Pedidos (No Poner Casos)` hacia `Cases` o `Edison cases`).
 *   - **Comentarios enriquecidos, `Responder` con cita y Boosts (`🚀`)**: Soporta editar/eliminar comentarios
 *     (`update_comment` / `delete_recording`), citas `<blockquote>` al responder y reacciones cortas (`bc_boosts`:
 *     `create_boost` / `delete_boost`) tanto en tareas como en comentarios.
 *   - **Fidelidad de listas y grupos**: Respeta el `color` real (`blue`, `orange`, etc.) y `bc_completed_ratio`
 *     de Basecamp, renderiza grupos divisores (`bc_todolist_groups`), menú `•••` por lista, grupo y fila, y pie
 *     informativo de personas notificadas por correo.
 *   - **Replicar tarea desde búsqueda e historial**: Permite buscar en vivo pedidos y casos completados históricos
 *     en Supabase (`bc_todos`, `todoFilterQuery >= 2`) y ejecutar `Replicar tarea` creando un nuevo To-Do en esa
 *     MISMA lista (`todolist_id`) con el mismo título, nota enriquecida y todas sus fotos/archivos
 *     (`prepareHtmlForTaskReplication`), dejando `Asignado a` limpio y enfocado automáticamente.
 * @dataFlow
 *   - Entrada: Props `project` (`id` = `bc_id`, `db_id` = UUID, `people`), `currentUserName`, `selectedTodoId`, `replicateTodoId`, `onCloseDetail`, `onConsumeReplicateTodo`, `navigateTo`.
 *   - Lectura: Consultas paralelas en Supabase + hidratación en vivo desde `GET /api/basecamp/todo-detail` + Realtime.
 *   - Escritura: `POST /api/basecamp/action` (`create_todo`, `update_todo`, `move_todo`, `complete_todo`, `uncomplete_todo`,
 *     `create_todolist`, `update_todolist`, `create_todolist_group`, `update_todolist_group`, `create_comment`,
 *     `update_comment`, `create_boost`, `delete_boost`, `delete_recording`).
 * @notes
 *   - Soporte 100% bilingüe (`es` / `en`) con `useLanguage()` sin strings visibles hardcodeados.
 *   - Fechas formateadas en `America/Los_Angeles` sin desfase UTC en cadenas ISO `YYYY-MM-DD`.
 *   - Jerarquía estricta de stacking contexts (`z-index`): en el Modal de Detalle de To-Do la cabecera usa `relative z-50`
 *     (menú `•••` `z-[90]`) sobre el cuerpo scrollable `relative z-10` y pie `relative z-20`; en formularios de creación/edición
 *     `ASIGNADO A` (`relative z-30`) supera `FECHA LÍMITE`/`GRUPO` (`relative z-20`) y `BasecampRichEditor` (`relative z-10`);
 *     listas (`z-30`), filas (`z-40`) y comentarios (`z-40`) se elevan dinámicamente cuando sus menús `•••` o `🚀 Boost` están abiertos.
 *   - Deep-link en carga fría (`selectedTodoId`): soporta tanto `UUID` (`id`) como `bc_id` numérico en `fetchLists` y en
 *     apertura automática del Modal de Detalle, incluyendo fallback directo a `bc_todos` para tareas completadas históricas
 *     o fuera del lote inicial en memoria.
 *   - Rediseño UI/UX Web + Móvil estilo Linear / Basecamp 4 / Apple Reminders (2026-11-28): cero desborde horizontal en
 *     `360px`/`390px`, grid responsivo `grid-cols-1 lg:grid-cols-2`, filas de tareas sin aplastamiento de títulos con botón
 *     `📋 Replicar tarea` adaptativo (hover en Desktop, búsqueda en 1 clic con icono compacto en Móvil, menú `•••` en móvil),
 *     cabecera y barra de herramientas en 1 fila responsiva, modal tipo sheet en móvil con cabecera sticky compacta y tipografía
 *     editorial `BASECAMP_RICH_CONTENT_CSS` + `formatBasecampRichHtmlForDisplay`.
 */

'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useLanguage } from '@/lib/i18n'
import {
    ClipboardList,
    Plus,
    Trash2,
    Calendar,
    Clock,
    MessageSquare,
    Loader2,
    ChevronDown,
    ChevronRight,
    Paperclip,
    Check,
    Pencil,
    MoreHorizontal,
    ArrowUp,
    FolderOpen,
    Copy,
    Download,
    Rocket,
    Reply,
    Mail,
    X,
    Search,
    ArrowLeft,
    ArrowUpDown,
    LayoutGrid,
    List,
} from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { useAuth } from '@/components/ProtectedRoute'
import {
    stripTegAuthorBanner,
    canonicalizeBasecampEmail,
    canonicalizeBasecampDisplayName,
    isBasecampOAuthOwner,
    normalizePersonName,
    findPersonInListByFuzzyName,
    isMaskedOrEmptyEmail,
    SYNTHETIC_BC_ID_THRESHOLD,
} from '@/lib/basecamp-person-resolver'
import {
    proxyBasecampUrl,
    rewriteBasecampHtmlUrls,
    safeDecodeFilename,
    sanitizeBasecampHtml,
    injectImageDownloadOverlays,
    triggerBasecampDownload,
    buildBasecampDirectDownloadHref,
    isBasecampMentionAttachment,
    transformBasecampMentionsToPills,
    extractMentionedPeopleRefs,
    hasRichContentOrMedia,
    prepareHtmlForTaskReplication,
    BASECAMP_IMAGE_HOVER_CSS,
    BASECAMP_RICH_CONTENT_CSS,
    formatBasecampRichHtmlForDisplay,
} from '@/lib/basecamp-html'
import BasecampRichEditor, { BasecampPersonOption } from '@/components/basecamp/BasecampRichEditor'

export { sanitizeBasecampHtml }

interface ToolTodosProps {
    project: any
    currentUserName: string
    selectedTodoId?: string
    replicateTodoId?: string
    onCloseDetail?: () => void
    onConsumeReplicateTodo?: () => void
    navigateTo?: (params: any) => void
}

type DateMode = 'none' | 'single' | 'range'
type SortOrderMode = 'position' | 'newest' | 'oldest'
type EditFocusTarget = 'title' | 'assignees' | 'dates' | 'group' | 'notes'

const BASECAMP_COLOR_HEX_MAP: Record<string, string> = {
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

const BASECAMP_COLOR_SWATCHES: Array<{ value: string; hex: string; i18nKey: string }> = [
    { value: 'blue', hex: '#1D7DB5', i18nKey: 'basecamp.color_blue' },
    { value: 'orange', hex: '#EA580C', i18nKey: 'basecamp.color_orange' },
    { value: 'green', hex: '#16A34A', i18nKey: 'basecamp.color_green' },
    { value: 'red', hex: '#DC2626', i18nKey: 'basecamp.color_red' },
    { value: 'purple', hex: '#8E44AD', i18nKey: 'basecamp.color_purple' },
    { value: 'pink', hex: '#DB2777', i18nKey: 'basecamp.color_pink' },
    { value: 'yellow', hex: '#D97706', i18nKey: 'basecamp.color_yellow' },
    { value: 'brown', hex: '#92400E', i18nKey: 'basecamp.color_brown' },
    { value: 'gray', hex: '#64748B', i18nKey: 'basecamp.color_gray' },
]

const LIST_DOT_COLORS = [
    '#27AE60',
    '#EA580C',
    '#1D7DB5',
    '#DC2626',
    '#8E44AD',
    '#0D9488',
    '#D97706',
    '#2980B9',
    '#92400E',
    '#16A085',
]

const QUICK_BOOST_PRESETS = ['👍', '🚀', '✅', '❤️', '👏', 'Ok', 'Gracias']

const resolveBasecampColorHex = (colorName?: string | null, fallbackIdx: number = 0): string => {
    if (colorName && typeof colorName === 'string') {
        const clean = colorName.trim().toLowerCase()
        if (clean.startsWith('#') && (clean.length === 4 || clean.length === 7)) {
            return clean
        }
        if (BASECAMP_COLOR_HEX_MAP[clean]) {
            return BASECAMP_COLOR_HEX_MAP[clean]
        }
    }
    return LIST_DOT_COLORS[Math.abs(fallbackIdx) % LIST_DOT_COLORS.length]
}

const parseCompletedRatio = (
    ratioStr?: string | null,
    fallbackCompleted?: number | null,
    fallbackTotal?: number | null
): { completed: number; total: number; label: string | null } => {
    if (ratioStr && typeof ratioStr === 'string') {
        const m = ratioStr.trim().match(/^(\d+)\s*\/\s*(\d+)$/)
        if (m) {
            const comp = Number(m[1])
            const tot = Number(m[2])
            if (Number.isFinite(comp) && Number.isFinite(tot)) {
                return {
                    completed: comp,
                    total: tot,
                    label: `${comp.toLocaleString()}/${tot.toLocaleString()}`,
                }
            }
        }
    }
    const comp = Math.max(0, Number(fallbackCompleted || 0))
    const tot = Math.max(comp, Number(fallbackTotal || 0))
    return {
        completed: comp,
        total: tot,
        label: tot > 0 ? `${comp.toLocaleString()}/${tot.toLocaleString()}` : null,
    }
}

const getBlobUuid = (url: string) => {
    const match = url.match(/\/blobs\/([a-f0-9-]+)/i)
    return match ? match[1] : null
}

const normalizeSearch = (raw?: string | null): string =>
    (raw || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()

const escapeHtmlText = (raw: string): string =>
    String(raw || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')

const isAvatarImgTag = (imgTagHtml: string): boolean => {
    if (!imgTagHtml) return false
    return (
        /\b(?:data-avatar-for-person-id|data-bc-avatar)\b/i.test(imgTagHtml) ||
        /\bclass\s*=\s*["'][^"']*\bavatar\b[^"']*["']/i.test(imgTagHtml)
    )
}

const sanitizeAttachmentHref = (rawUrl?: string): string => {
    if (!rawUrl || typeof rawUrl !== 'string') return '#'
    const trimmed = rawUrl.trim().replace(/&amp;/g, '&')
    if (trimmed.startsWith('/api/basecamp/attachment?')) return trimmed
    try {
        const parsed = new URL(trimmed)
        if (parsed.protocol !== 'https:') return '#'
        const host = parsed.hostname.toLowerCase()
        if (host.endsWith('.supabase.co') || host.endsWith('.amazonaws.com')) return parsed.toString()
        if (
            host === '3.basecampapi.com' ||
            host === 'preview.app.basecamp.com' ||
            host === 'storage.app.basecamp.com'
        ) {
            return `/api/basecamp/attachment?url=${encodeURIComponent(parsed.toString())}`
        }
        return '#'
    } catch {
        return '#'
    }
}

const parseAttachments = (html: string) => {
    const attachments: Array<{ contentType: string; filename: string; href: string; url: string }> = []
    if (!html) return attachments

    const bcAttachmentRegex = /<bc-attachment\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/bc-attachment>)/gi
    let match
    while ((match = bcAttachmentRegex.exec(html)) !== null) {
        const attrsStr = match[1] || ''
        if (isBasecampMentionAttachment(attrsStr)) continue

        const getAttr = (name: string) => {
            const m = attrsStr.match(new RegExp(`(?:^|\\s)${name}=["']([^"']+)["']`, 'i'))
            return m ? m[1] : null
        }

        const contentType = getAttr('content-type') || ''
        if (contentType.toLowerCase() === 'application/vnd.basecamp.mention') continue

        const filename = getAttr('filename') || ''
        const href = getAttr('href') || ''
        const url = getAttr('url') || href || ''

        if (!url && !href) continue

        attachments.push({
            contentType,
            filename,
            href,
            url,
        })
    }

    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
    let imgMatch
    while ((imgMatch = imgRegex.exec(html)) !== null) {
        if (isAvatarImgTag(imgMatch[0])) continue

        const src = imgMatch[1]
        if (!src) continue

        const isAlreadyCaptured = attachments.some((a) => {
            const srcUuid = getBlobUuid(src)
            const aUrlUuid = getBlobUuid(a.url)
            const aHrefUuid = getBlobUuid(a.href)

            if (srcUuid && (srcUuid === aUrlUuid || srcUuid === aHrefUuid)) {
                return true
            }

            const srcKey = src.split('/').pop()?.split('?')[0]
            const aUrlKey = a.url.split('/').pop()?.split('?')[0]
            const aHrefKey = a.href.split('/').pop()?.split('?')[0]
            return Boolean(srcKey && (srcKey === aUrlKey || srcKey === aHrefKey))
        })
        if (isAlreadyCaptured) continue

        let filename = 'Image'
        const altMatch = imgMatch[0].match(/alt=["']([^"']+)["']/i)
        if (altMatch?.[1]) {
            filename = altMatch[1]
        } else {
            const lastPart = src.split('/').pop()?.split('?')[0] || 'image.png'
            filename = lastPart === 'full' ? 'Image' : lastPart
        }

        attachments.push({
            contentType: 'image/png',
            filename,
            href: src,
            url: src,
        })
    }

    return attachments
}

const rewriteHtmlUrls = (html: string) => {
    if (!html) return ''
    const withoutDataAuthor = html.replace(/<p\b[^>]*\bdata-teg-author=["'][^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')
    return rewriteBasecampHtmlUrls(withoutDataAuthor)
}

const prepareRichContent = (rawHtml?: string | null) => {
    if (!rawHtml) return { sanitizedHtml: '', nonImageAttachments: [] as any[], allDownloadableAttachments: [] as any[] }

    const cleaned = stripTegAuthorBanner(rawHtml).cleanHtml
        .replace(/<p\b[^>]*\bdata-teg-author=["'][^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')
        .replace(/<span\b[^>]*\bdata-teg-when-done=["'][^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '')

    const mentionsTransformed = transformBasecampMentionsToPills(cleaned)
    const allAttachments = parseAttachments(mentionsTransformed).filter((a) => {
        const resolvedHref = sanitizeAttachmentHref(a.url || a.href)
        return resolvedHref !== '#'
    })

    const nonImageAttachments = allAttachments.filter((a) => {
        const ct = (a.contentType || '').toLowerCase()
        const fn = (a.filename || '').toLowerCase()
        return !ct.startsWith('image/') && !fn.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)
    })

    const strippedBcHtml = mentionsTransformed
        .replace(/<bc-attachment\b([^>]*)>([\s\S]*?)<\/bc-attachment>/gi, (full, attrs, inner) => {
            if (isBasecampMentionAttachment(attrs)) return transformBasecampMentionsToPills(full)
            if (/<img\b[^>]+>/i.test(inner)) return inner
            return ''
        })
        .replace(/<bc-attachment\b[^>]*\/>/gi, '')
        .trim()

    const sanitizedHtml = rewriteHtmlUrls(strippedBcHtml)
    return { sanitizedHtml, nonImageAttachments, allDownloadableAttachments: allAttachments }
}

const extractTaskRowSnippet = (rawHtml?: string | null): { textSnippet: string; attachmentNames: string[] } => {
    if (!rawHtml) return { textSnippet: '', attachmentNames: [] }
    const cleaned = stripTegAuthorBanner(rawHtml).cleanHtml
        .replace(/<p\b[^>]*\bdata-teg-author=["'][^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')
        .replace(/<span\b[^>]*\bdata-teg-when-done=["'][^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '')

    const withMentions = transformBasecampMentionsToPills(cleaned)
    const atts = parseAttachments(withMentions).filter((a) => sanitizeAttachmentHref(a.url || a.href) !== '#')
    const attachmentNames = atts
        .map((a) => safeDecodeFilename(a.filename) || 'Attachment')
        .filter(Boolean)
        .slice(0, 3)

    const plain = withMentions
        .replace(/<bc-attachment\b[^>]*>[\s\S]*?<\/bc-attachment>/gi, ' ')
        .replace(/<bc-attachment\b[^>]*\/>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim()

    const textSnippet = plain.length > 120 ? `${plain.slice(0, 117)}...` : plain
    return { textSnippet, attachmentNames }
}

const extractInlinePreviewImages = (rawHtml?: string | null): string[] => {
    if (!rawHtml) return []
    const urls: string[] = []
    const seen = new Set<string>()
    const pushUrl = (u?: string | null) => {
        if (!u) return
        const proxied = proxyBasecampUrl(u)
        if (proxied && proxied !== '#' && !seen.has(proxied)) {
            seen.add(proxied)
            urls.push(proxied)
        }
    }

    const bcAttRegex = /<bc-attachment\b([^>]*?)(?:\/>|>([\s\S]*?)<\/bc-attachment>)/gi
    let m
    while ((m = bcAttRegex.exec(rawHtml)) !== null) {
        const attrs = m[1] || ''
        if (isBasecampMentionAttachment(attrs)) continue
        const ct = (attrs.match(/\bcontent-type=["']([^"']+)["']/i)?.[1] || '').toLowerCase()
        const fn = (attrs.match(/\bfilename=["']([^"']+)["']/i)?.[1] || '').toLowerCase()
        const isImg = ct.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(fn)
        if (isImg) {
            const rawUrl =
                attrs.match(/\burl=["']([^"']+)["']/i)?.[1] ||
                attrs.match(/\bhref=["']([^"']+)["']/i)?.[1] ||
                ''
            pushUrl(rawUrl)
        }
    }

    const imgRegex = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi
    while ((m = imgRegex.exec(rawHtml)) !== null) {
        if (isAvatarImgTag(m[0])) continue
        if (m[1]?.includes('attachment-icon')) continue
        pushUrl(m[1])
    }

    return urls
}

const extractPlainQuoteText = (rawHtml?: string | null): string => {
    if (!rawHtml) return ''
    const cleaned = stripTegAuthorBanner(rawHtml).cleanHtml
    const withMentions = transformBasecampMentionsToPills(cleaned)
    const plain = withMentions
        .replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/gi, ' ')
        .replace(/<bc-attachment\b[^>]*>[\s\S]*?<\/bc-attachment>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim()
    return plain.length > 220 ? `${plain.slice(0, 217)}...` : plain
}

export default function ToolTodos({
    project,
    currentUserName,
    selectedTodoId,
    replicateTodoId,
    onCloseDetail,
    onConsumeReplicateTodo,
    navigateTo,
}: ToolTodosProps) {
    const supabase = useMemo(() => getSupabaseWithAuth(), [])
    const { t, language } = useLanguage()
    const { user: authUser } = useAuth()
    const effectiveUserEmail = useMemo(
        () => canonicalizeBasecampEmail(authUser?.email),
        [authUser?.email]
    )
    const effectiveUserName = useMemo(
        () =>
            canonicalizeBasecampDisplayName(currentUserName || authUser?.name, authUser?.email) ||
            currentUserName,
        [currentUserName, authUser?.name, authUser?.email]
    )
    const [lists, setLists] = useState<any[]>([])
    const [allPeopleState, setAllPeopleState] = useState<BasecampPersonOption[]>([])
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState<string | null>(null)

    // View mode & sorting ('position' | 'newest' | 'oldest')
    const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards')
    const [sortOrder, setSortOrder] = useState<SortOrderMode>('position')
    const [showViewAsMenu, setShowViewAsMenu] = useState(false)
    const [showSortMenu, setShowSortMenu] = useState(false)
    const viewAsMenuRef = useRef<HTMLDivElement>(null)
    const sortMenuRef = useRef<HTMLDivElement>(null)

    // List & Group modals / menus
    const [showAddList, setShowAddList] = useState(false)
    const [newListName, setNewListName] = useState('')
    const [newListDesc, setNewListDesc] = useState('')
    const [newListColor, setNewListColor] = useState('blue')
    const [openListMenuId, setOpenListMenuId] = useState<string | null>(null)
    const [editingListModal, setEditingListModal] = useState<{
        id: string
        bc_id: number
        name: string
        description: string
        color: string
    } | null>(null)
    const [creatingGroupModal, setCreatingGroupModal] = useState<{
        listId: string
        listBcId: number
        name: string
        color: string
    } | null>(null)
    const [openGroupMenuId, setOpenGroupMenuId] = useState<string | null>(null)
    const [editingGroupModal, setEditingGroupModal] = useState<{
        id: string
        bc_id: number
        name: string
        color: string
    } | null>(null)

    // Add Task states
    const [addingTaskId, setAddingTaskId] = useState<string | null>(null)
    const [addingTaskGroupId, setAddingTaskGroupId] = useState<string | null>(null)
    const [newTaskName, setNewTaskName] = useState('')
    const [newTaskAssignees, setNewTaskAssignees] = useState<any[]>([])
    const [assigneeSearchQuery, setAssigneeSearchQuery] = useState('')
    const [showAssigneeSuggestions, setShowAssigneeSuggestions] = useState(false)
    const [highlightedAssigneeIdx, setHighlightedAssigneeIdx] = useState(0)
    const [newTaskDateMode, setNewTaskDateMode] = useState<DateMode>('none')
    const [newTaskStartsOn, setNewTaskStartsOn] = useState('')
    const [newTaskDueDate, setNewTaskDueDate] = useState('')
    const [newTaskNotes, setNewTaskNotes] = useState('')
    const [newTaskInitialHtml, setNewTaskInitialHtml] = useState('')
    const [, setNotesIsEmpty] = useState(true)
    const [newTaskEditorSeed, setNewTaskEditorSeed] = useState(0)
    const [showSubtasksInput, setShowSubtasksInput] = useState(false)
    const [newTaskSubtasks, setNewTaskSubtasks] = useState<string[]>([''])
    const [replicatingBanner, setReplicatingBanner] = useState<{ listId: string; listName: string } | null>(null)
    const [replicatingTaskId, setReplicatingTaskId] = useState<string | null>(null)

    // Row actions menu (#37)
    const [openRowMenuTaskId, setOpenRowMenuTaskId] = useState<string | null>(null)
    const [rowMenuUp, setRowMenuUp] = useState(false)
    const [copiedRowTaskId, setCopiedRowTaskId] = useState<string | null>(null)

    // Selected List & Task Detail states
    const [selectedListId, setSelectedListId] = useState<string | null>(null)
    const [selectedTask, setSelectedTask] = useState<any | null>(null)
    const [selectedTaskListId, setSelectedTaskListId] = useState<string | null>(null)
    const [showTaskMoreMenu, setShowTaskMoreMenu] = useState(false)
    const [linkCopiedToast, setLinkCopiedToast] = useState(false)
    const [movedBannerText, setMovedBannerText] = useState<string | null>(null)

    // Task Edit Mode states
    const [isEditingTask, setIsEditingTask] = useState(false)
    const [editFocusTarget, setEditFocusTarget] = useState<EditFocusTarget>('title')
    const [editSessionKey, setEditSessionKey] = useState(0)
    const [editTaskTitle, setEditTaskTitle] = useState('')
    const [editTaskAssignees, setEditTaskAssignees] = useState<any[]>([])
    const [editAssigneeSearchQuery, setEditAssigneeSearchQuery] = useState('')
    const [showEditAssigneeSuggestions, setShowEditAssigneeSuggestions] = useState(false)
    const [highlightedEditAssigneeIdx, setHighlightedEditAssigneeIdx] = useState(0)
    const [editTaskDateMode, setEditTaskDateMode] = useState<DateMode>('none')
    const [editTaskStartsOn, setEditTaskStartsOn] = useState('')
    const [editTaskDueDate, setEditTaskDueDate] = useState('')
    const [editTaskGroupId, setEditTaskGroupId] = useState<string>('')
    const [editTaskNotesHtml, setEditTaskNotesHtml] = useState('')

    // Move Task Modal / Panel states
    const [showMoveTaskModal, setShowMoveTaskModal] = useState(false)
    const [moveProjects, setMoveProjects] = useState<Array<{ id: string; bc_id: number; name: string }>>([])
    const [moveTargetProjectDbId, setMoveTargetProjectDbId] = useState<string>('')
    const [moveListsForProject, setMoveListsForProject] = useState<
        Array<{ id: string; bc_id: number; name: string; color?: string | null }>
    >([])
    const [moveTargetListDbId, setMoveTargetListDbId] = useState<string>('')
    const [moveGroupsForList, setMoveGroupsForList] = useState<
        Array<{ id: string; bc_id: number; name: string; color?: string | null }>
    >([])
    const [moveTargetGroupDbId, setMoveTargetGroupDbId] = useState<string>('')
    const [moveLoadingCatalog, setMoveLoadingCatalog] = useState(false)

    // Comments & Boosts states
    const [taskComments, setTaskComments] = useState<any[]>([])
    const [commentsLoading, setCommentsLoading] = useState(false)
    const [newCommentHtml, setNewCommentHtml] = useState('')
    const [newCommentIsEmpty, setNewCommentIsEmpty] = useState(true)
    const [commentDraftInitialHtml, setCommentDraftInitialHtml] = useState('')
    const [commentEditorSeed, setCommentEditorSeed] = useState(0)
    const [commentFocusSeq, setCommentFocusSeq] = useState(0)
    const [openCommentMenuId, setOpenCommentMenuId] = useState<string | null>(null)
    const [commentMenuUp, setCommentMenuUp] = useState(false)
    const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
    const [editingCommentHtml, setEditingCommentHtml] = useState('')
    const [editingCommentIsEmpty, setEditingCommentIsEmpty] = useState(false)

    const [taskBoosts, setTaskBoosts] = useState<any[]>([])
    const [commentBoostsMap, setCommentBoostsMap] = useState<Record<string, any[]>>({})
    const [openBoostPopoverKey, setOpenBoostPopoverKey] = useState<string | null>(null)
    const [boostPopoverDown, setBoostPopoverDown] = useState(false)
    const [boostPopoverOffsetX, setBoostPopoverOffsetX] = useState(0)
    const [customBoostInput, setCustomBoostInput] = useState('')

    // Misc UI states
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
    const [todoFilterQuery, setTodoFilterQuery] = useState('')
    const [historySearchResults, setHistorySearchResults] = useState<any[]>([])
    const [historySearchLoading, setHistorySearchLoading] = useState(false)
    const [mutationError, setMutationError] = useState<string | null>(null)
    const [expandedCompleted, setExpandedCompleted] = useState<Record<string, boolean>>({})
    const [loadingCompletedByList, setLoadingCompletedByList] = useState<Record<string, boolean>>({})

    // Refs
    const assigneeBoxRef = useRef<HTMLDivElement>(null)
    const newAssigneeInputRef = useRef<HTMLInputElement>(null)
    const addTaskFormRef = useRef<HTMLFormElement>(null)
    const historySearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const historySearchSeqRef = useRef(0)
    const consumedReplicateIdRef = useRef<string | null>(null)
    const editAssigneeBoxRef = useRef<HTMLDivElement>(null)
    const editTitleInputRef = useRef<HTMLInputElement>(null)
    const editAssigneeInputRef = useRef<HTMLInputElement>(null)
    const editDateSectionRef = useRef<HTMLDivElement>(null)
    const editGroupSelectRef = useRef<HTMLSelectElement>(null)
    const commentFormRef = useRef<HTMLDivElement>(null)
    const taskMoreMenuRef = useRef<HTMLDivElement>(null)
    const activeSelectedTaskIdRef = useRef<string | null>(null)
    const selectedTaskRef = useRef<any | null>(null)
    const commentFetchAbortRef = useRef<AbortController | null>(null)
    const peopleLookupRef = useRef<Map<string, string>>(new Map())
    const peopleObjByIdRef = useRef<Map<string, BasecampPersonOption>>(new Map())
    const pendingInitialDetailActionRef = useRef<{ mode: 'edit' | 'move'; focus?: EditFocusTarget } | null>(null)
    const selectedTodoIdRef = useRef<string | undefined>(selectedTodoId)
    const openedDeepLinkTodoRef = useRef<string | null>(null)
    const loadedListsProjectIdRef = useRef<string | null>(null)

    selectedTaskRef.current = selectedTask
    activeSelectedTaskIdRef.current = selectedTask?.id || null
    selectedTodoIdRef.current = selectedTodoId

    // Enriched directory of project people with attachable_sgid, avatar_url, title & email
    const editorPeople = useMemo<BasecampPersonOption[]>(() => {
        const byId = new Map<string, BasecampPersonOption>()
        for (const p of allPeopleState) {
            if (p?.id) byId.set(p.id, p)
        }
        const projPeople = Array.isArray(project?.people) ? project.people : []
        if (projPeople.length > 0) {
            const seen = new Set<string>()
            const merged: BasecampPersonOption[] = []
            for (const rawP of projPeople) {
                if (!rawP?.id || seen.has(rawP.id)) continue
                seen.add(rawP.id)
                const dbMatch = byId.get(rawP.id)
                merged.push({
                    id: rawP.id,
                    bc_id: rawP.bc_id ?? dbMatch?.bc_id ?? null,
                    name: rawP.name || dbMatch?.name || '',
                    email: !isMaskedOrEmptyEmail(rawP.email)
                        ? canonicalizeBasecampEmail(rawP.email)
                        : !isMaskedOrEmptyEmail(dbMatch?.email)
                        ? canonicalizeBasecampEmail(dbMatch?.email)
                        : '',
                    title: rawP.title || dbMatch?.title || '',
                    role: rawP.role || dbMatch?.role || '',
                    avatar: rawP.avatar || rawP.avatar_url || dbMatch?.avatar_url || '',
                    avatar_url: rawP.avatar_url || rawP.avatar || dbMatch?.avatar_url || '',
                    attachable_sgid: rawP.attachable_sgid || dbMatch?.attachable_sgid || null,
                })
            }
            return merged
        }
        return allPeopleState
    }, [project?.people, allPeopleState])

    const currentPersonOption = useMemo<BasecampPersonOption | null>(() => {
        const fromProject =
            editorPeople.length > 0
                ? findPersonInListByFuzzyName(editorPeople, effectiveUserName, effectiveUserEmail)
                : null
        if (fromProject) return fromProject
        return findPersonInListByFuzzyName(allPeopleState, effectiveUserName, effectiveUserEmail) || null
    }, [editorPeople, allPeopleState, effectiveUserName, effectiveUserEmail])

    const isCurrentUserAssigned = useCallback(
        (person?: { id?: string | null; name?: string | null; email?: string | null } | null): boolean => {
            if (!person) return false
            if (currentPersonOption?.id && person.id === currentPersonOption.id) return true
            const pEmail = !isMaskedOrEmptyEmail(person.email) ? canonicalizeBasecampEmail(person.email) : ''
            if (effectiveUserEmail && pEmail && pEmail === effectiveUserEmail) return true
            if (
                isBasecampOAuthOwner(effectiveUserEmail, effectiveUserName) &&
                isBasecampOAuthOwner(person.email, person.name)
            ) {
                return true
            }
            const normCur = normalizePersonName(effectiveUserName)
            const normP = normalizePersonName(person.name)
            return Boolean(normCur && normP && normCur === normP)
        },
        [currentPersonOption?.id, effectiveUserEmail, effectiveUserName]
    )

    // Avatar & short-name helpers
    const AVATAR_COLORS = [
        '#3498DB',
        '#E74C3C',
        '#27AE60',
        '#F39C12',
        '#8E44AD',
        '#1ABC9C',
        '#D35400',
        '#2980B9',
        '#C0392B',
        '#16A085',
        '#F1C40F',
        '#9B59B6',
    ]
    const getAvatarColor = (name: string) => {
        const safe = String(name || 'U')
        let hash = 0
        for (let i = 0; i < safe.length; i++) hash = safe.charCodeAt(i) + ((hash << 5) - hash)
        return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
    }
    const getInitials = (name: string) => {
        const clean = String(name || 'U').trim()
        const parts = clean.split(/\s+/).filter(Boolean)
        return parts.length >= 2
            ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
            : clean.slice(0, 2).toUpperCase()
    }
    const getShortName = (fullName: string) => {
        if (!fullName) return ''
        const parts = fullName.trim().split(/\s+/).filter(Boolean)
        if (parts.length >= 2) {
            return `${parts[0]} ${parts[parts.length - 1][0]}.`
        }
        return parts[0] || ''
    }

    const resetAddTaskForm = useCallback(() => {
        setNewTaskName('')
        setNewTaskAssignees([])
        setAssigneeSearchQuery('')
        setShowAssigneeSuggestions(false)
        setHighlightedAssigneeIdx(0)
        setNewTaskDateMode('none')
        setNewTaskStartsOn('')
        setNewTaskDueDate('')
        setNewTaskNotes('')
        setNewTaskInitialHtml('')
        setNotesIsEmpty(true)
        setNewTaskEditorSeed((s) => s + 1)
        setShowSubtasksInput(false)
        setNewTaskSubtasks([''])
        setReplicatingBanner(null)
    }, [])

    const closeTaskDetail = useCallback(() => {
        commentFetchAbortRef.current?.abort()
        setSelectedTask(null)
        setIsEditingTask(false)
        setShowTaskMoreMenu(false)
        setShowMoveTaskModal(false)
        setEditingCommentId(null)
        setOpenCommentMenuId(null)
        setOpenBoostPopoverKey(null)
        setMovedBannerText(null)
        if (onCloseDetail) onCloseDetail()
    }, [onCloseDetail])

    // Reset local states on project switch
    useEffect(() => {
        commentFetchAbortRef.current?.abort()
        setLoading(true)
        openedDeepLinkTodoRef.current = null
        loadedListsProjectIdRef.current = null
        setLists([])
        setSelectedListId(null)
        setSelectedTask(null)
        setSelectedTaskListId(null)
        setTaskComments([])
        setTaskBoosts([])
        setCommentBoostsMap({})
        setAddingTaskId(null)
        setAddingTaskGroupId(null)
        setTodoFilterQuery('')
        setHistorySearchResults([])
        setHistorySearchLoading(false)
        setReplicatingTaskId(null)
        consumedReplicateIdRef.current = null
        setExpandedCompleted({})
        setLoadingCompletedByList({})
        setShowAddList(false)
        setEditingListModal(null)
        setCreatingGroupModal(null)
        setEditingGroupModal(null)
        setMutationError(null)
        resetAddTaskForm()
    }, [project.db_id, resetAddTaskForm])

    // Click-outside listeners for floating menus & popovers
    useEffect(() => {
        const hasAnyMenuOpen =
            showViewAsMenu ||
            showSortMenu ||
            showAssigneeSuggestions ||
            showEditAssigneeSuggestions ||
            showTaskMoreMenu ||
            Boolean(openListMenuId) ||
            Boolean(openGroupMenuId) ||
            Boolean(openRowMenuTaskId) ||
            Boolean(openCommentMenuId) ||
            Boolean(openBoostPopoverKey)
        if (!hasAnyMenuOpen) return

        const handleOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null
            if (!target) return
            if (showViewAsMenu && viewAsMenuRef.current && !viewAsMenuRef.current.contains(target)) {
                setShowViewAsMenu(false)
            }
            if (showSortMenu && sortMenuRef.current && !sortMenuRef.current.contains(target)) {
                setShowSortMenu(false)
            }
            if (showAssigneeSuggestions && assigneeBoxRef.current && !assigneeBoxRef.current.contains(target)) {
                setShowAssigneeSuggestions(false)
            }
            if (
                showEditAssigneeSuggestions &&
                editAssigneeBoxRef.current &&
                !editAssigneeBoxRef.current.contains(target)
            ) {
                setShowEditAssigneeSuggestions(false)
            }
            if (showTaskMoreMenu && taskMoreMenuRef.current && !taskMoreMenuRef.current.contains(target)) {
                setShowTaskMoreMenu(false)
            }
            if (openListMenuId && !target.closest('[data-bc-list-menu]')) {
                setOpenListMenuId(null)
            }
            if (openGroupMenuId && !target.closest('[data-bc-group-menu]')) {
                setOpenGroupMenuId(null)
            }
            if (openRowMenuTaskId && !target.closest('[data-bc-row-menu]')) {
                setOpenRowMenuTaskId(null)
            }
            if (openCommentMenuId && !target.closest('[data-bc-comment-menu]')) {
                setOpenCommentMenuId(null)
            }
            if (openBoostPopoverKey && !target.closest('[data-bc-boost-popover]')) {
                setOpenBoostPopoverKey(null)
            }
        }
        document.addEventListener('mousedown', handleOutside)
        return () => document.removeEventListener('mousedown', handleOutside)
    }, [
        showViewAsMenu,
        showSortMenu,
        showAssigneeSuggestions,
        showEditAssigneeSuggestions,
        showTaskMoreMenu,
        openListMenuId,
        openGroupMenuId,
        openRowMenuTaskId,
        openCommentMenuId,
        openBoostPopoverKey,
    ])

    // Layered Escape key handling
    useEffect(() => {
        const hasOpenLayer =
            Boolean(lightboxUrl) ||
            Boolean(openBoostPopoverKey) ||
            Boolean(openCommentMenuId) ||
            showTaskMoreMenu ||
            showMoveTaskModal ||
            Boolean(editingCommentId) ||
            isEditingTask ||
            Boolean(selectedTask) ||
            showAddList ||
            Boolean(editingListModal) ||
            Boolean(creatingGroupModal) ||
            Boolean(editingGroupModal) ||
            Boolean(openListMenuId) ||
            Boolean(openGroupMenuId) ||
            Boolean(openRowMenuTaskId) ||
            showAssigneeSuggestions
        if (!hasOpenLayer) return

        const handleEsc = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || e.defaultPrevented) return
            if (lightboxUrl) {
                e.preventDefault()
                setLightboxUrl(null)
                return
            }
            if (openBoostPopoverKey) {
                e.preventDefault()
                setOpenBoostPopoverKey(null)
                return
            }
            if (openCommentMenuId) {
                e.preventDefault()
                setOpenCommentMenuId(null)
                return
            }
            if (showTaskMoreMenu) {
                e.preventDefault()
                setShowTaskMoreMenu(false)
                return
            }
            if (showMoveTaskModal) {
                e.preventDefault()
                setShowMoveTaskModal(false)
                return
            }
            if (editingCommentId) {
                e.preventDefault()
                setEditingCommentId(null)
                return
            }
            if (isEditingTask) {
                if (showEditAssigneeSuggestions) {
                    e.preventDefault()
                    setShowEditAssigneeSuggestions(false)
                }
                return
            }
            if (selectedTask) {
                e.preventDefault()
                closeTaskDetail()
                return
            }
            if (editingListModal) {
                e.preventDefault()
                setEditingListModal(null)
                return
            }
            if (creatingGroupModal) {
                e.preventDefault()
                setCreatingGroupModal(null)
                return
            }
            if (editingGroupModal) {
                e.preventDefault()
                setEditingGroupModal(null)
                return
            }
            if (showAddList) {
                e.preventDefault()
                setShowAddList(false)
                return
            }
            setOpenListMenuId(null)
            setOpenGroupMenuId(null)
            setOpenRowMenuTaskId(null)
            setShowAssigneeSuggestions(false)
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [
        lightboxUrl,
        openBoostPopoverKey,
        openCommentMenuId,
        showTaskMoreMenu,
        showMoveTaskModal,
        editingCommentId,
        isEditingTask,
        showEditAssigneeSuggestions,
        selectedTask,
        editingListModal,
        creatingGroupModal,
        editingGroupModal,
        showAddList,
        openListMenuId,
        openGroupMenuId,
        openRowMenuTaskId,
        showAssigneeSuggestions,
        closeTaskDetail,
    ])

    // Date & Timestamp formatters (America/Los_Angeles, zero UTC shift on YYYY-MM-DD)
    const formatDueDate = useCallback(
        (dateStr?: string | null) => {
            if (!dateStr) return ''
            const locale = language === 'es' ? 'es-MX' : 'en-US'
            const isoMatch = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
            if (isoMatch) {
                const year = Number(isoMatch[1])
                const month = Number(isoMatch[2])
                const day = Number(isoMatch[3])
                const localNoon = new Date(year, month - 1, day, 12, 0, 0)
                if (!isNaN(localNoon.getTime())) {
                    return localNoon.toLocaleDateString(locale, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                    })
                }
            }
            const parsed = new Date(dateStr)
            if (isNaN(parsed.getTime())) return String(dateStr)
            return parsed.toLocaleDateString(locale, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                timeZone: 'America/Los_Angeles',
            })
        },
        [language]
    )

    const formatTaskDateRangeBadge = useCallback(
        (startsOn?: string | null, dueDate?: string | null): string => {
            if (startsOn && dueDate && startsOn !== dueDate) {
                return `${formatDueDate(startsOn)} → ${formatDueDate(dueDate)}`
            }
            if (dueDate) return formatDueDate(dueDate)
            if (startsOn) return `${t('basecamp.starts_on')} ${formatDueDate(startsOn)}`
            return ''
        },
        [formatDueDate, t]
    )

    const formatCreatedDateTime = (dateStr?: string | null, includeYear: boolean = true) => {
        if (!dateStr) return ''
        const d = new Date(dateStr)
        if (isNaN(d.getTime())) return ''
        const locale = language === 'es' ? 'es-MX' : 'en-US'
        const datePart = d.toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
            ...(includeYear ? { year: 'numeric' } : {}),
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

    // Intercept clicks on rich HTML (1-click download, lightbox excluding mention avatars, internal todo links)
    const handleHtmlClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement

        const dlAnchor = target.closest('a[data-bc-download="true"]') as HTMLAnchorElement | null
        if (dlAnchor) {
            e.preventDefault()
            e.stopPropagation()
            const rawSrc = dlAnchor.getAttribute('data-bc-src') || dlAnchor.href
            const rawFn = dlAnchor.getAttribute('data-bc-filename') || ''
            triggerBasecampDownload(rawSrc, rawFn)
            return
        }

        if (target.tagName === 'IMG') {
            const imgEl = target as HTMLImageElement
            const isMentionAvatar =
                imgEl.classList.contains('avatar') ||
                imgEl.hasAttribute('data-avatar-for-person-id') ||
                imgEl.hasAttribute('data-bc-avatar') ||
                Boolean(imgEl.closest('[data-bc-mention="true"]'))
            if (!isMentionAvatar && imgEl.src) {
                e.preventDefault()
                e.stopPropagation()
                setLightboxUrl(imgEl.src)
                return
            }
        }

        const anchor = target.closest('a')
        if (anchor && anchor.href) {
            const href = anchor.href
            const todoMatch = href.match(/\/buckets\/(\d+)\/todos\/(\d+)/)
            if (todoMatch) {
                e.preventDefault()
                const todoBcId = Number(todoMatch[2])

                let foundTodo = null
                let foundListId = null
                for (const list of lists) {
                    const tk = list.tasks.find((task: any) => Number(task.bc_id) === todoBcId)
                    if (tk) {
                        foundTodo = tk
                        foundListId = list.id
                        break
                    }
                }
                if (foundTodo) {
                    if (navigateTo) {
                        navigateTo({ project: project.id, tool: 'todos', todoId: foundTodo.id })
                    } else {
                        setSelectedTask(foundTodo)
                        setSelectedTaskListId(foundListId)
                    }
                } else {
                    window.open(href, '_blank')
                }
            }
        }
    }

    // Map raw bc_todos row into UI task shape
    const mapDbTodoToTask = useCallback(
        (row: any, lookup: Map<string, string>) => {
            const assignees = (row.bc_todo_assignees || [])
                .map((a: any) => {
                    const personObj = Array.isArray(a?.person) ? a.person[0] : a?.person
                    if (!personObj) return null
                    return {
                        id: personObj.id,
                        name: personObj.name || t('basecamp.unknown_user'),
                        email: personObj.email || '',
                        avatar_url: personObj.avatar_url || '',
                    }
                })
                .filter(Boolean)

            const creatorName = row.created_by_person_id ? lookup.get(row.created_by_person_id) || null : null

            return {
                id: row.id,
                bc_id: row.bc_id,
                todolist_id: row.todolist_id,
                group_id: row.group_id || null,
                position: row.position ?? null,
                task_name: row.title,
                description: row.description || '',
                rawDescription: row.description || '',
                is_completed: Boolean(row.is_completed),
                completed_at: row.completed_at || null,
                starts_on: row.starts_on || null,
                due_date: row.due_date || null,
                boosts_count: Number(row.boosts_count || 0),
                created_by_person_id: row.created_by_person_id || null,
                created_at: row.created_at || null,
                creator_name: creatorName,
                assignee: assignees.map((a: any) => a.name).join(', ') || null,
                assigneeList: assignees,
                comments_count: Number(row.comments_count || 0),
                created_by: creatorName,
            }
        },
        [t]
    )

    const normalizeBoostRow = useCallback(
        (raw: any): any => {
            const boosterRel = Array.isArray(raw?.booster) ? raw.booster[0] : raw?.booster
            const fallbackPerson = raw?.booster_person_id
                ? peopleObjByIdRef.current.get(String(raw.booster_person_id))
                : null
            return {
                id: String(raw?.id || ''),
                bc_id: raw?.bc_id,
                recording_type: raw?.recording_type || 'todo',
                recording_id: String(raw?.recording_id || ''),
                booster_person_id: raw?.booster_person_id || boosterRel?.id || null,
                booster_name:
                    raw?.booster_name ||
                    boosterRel?.name ||
                    fallbackPerson?.name ||
                    t('basecamp.unknown_user'),
                booster_avatar_url:
                    raw?.booster_avatar_url || boosterRel?.avatar_url || fallbackPerson?.avatar_url || '',
                content: String(raw?.content || '👍').slice(0, 16),
                created_at: raw?.created_at || null,
            }
        },
        [t]
    )

    const fetchCompletedForList = useCallback(
        async (listId: string) => {
            if (!listId) return
            setLoadingCompletedByList((prev) => ({ ...prev, [listId]: true }))
            try {
                const { data: rows, error } = await supabase
                    .from('bc_todos')
                    .select(`
                        id, bc_id, todolist_id, group_id, title, is_completed, completed_at, starts_on, due_date, position,
                        comments_count, boosts_count, created_by_person_id, created_at, description,
                        bc_todo_assignees(
                            person:bc_people(id, name, email, avatar_url)
                        )
                    `)
                    .eq('todolist_id', listId)
                    .eq('is_completed', true)
                    .order('completed_at', { ascending: false, nullsFirst: false })
                    .order('created_at', { ascending: false })
                    .limit(200)

                if (error) throw error
                const mappedExtra = (rows || []).map((r: any) => mapDbTodoToTask(r, peopleLookupRef.current))
                setLists((prev) =>
                    prev.map((l) => {
                        if (l.id !== listId) return l
                        const existingIds = new Set(l.tasks.map((tk: any) => tk.id))
                        const merged = [...l.tasks]
                        for (const extra of mappedExtra) {
                            if (!existingIds.has(extra.id)) {
                                merged.push(extra)
                                existingIds.add(extra.id)
                            }
                        }
                        return { ...l, tasks: merged }
                    })
                )
            } catch (err: any) {
                console.error('❌ [ToolTodos CompletedList Fetch] Error:', err?.message || err)
            } finally {
                setLoadingCompletedByList((prev) => ({ ...prev, [listId]: false }))
            }
        },
        [supabase, mapDbTodoToTask]
    )

    const toggleCompletedSection = (list: any, loadedCompletedCount: number, targetTotalCompleted: number) => {
        const willExpand = !expandedCompleted[list.id]
        setExpandedCompleted((prev) => ({ ...prev, [list.id]: willExpand }))
        if (willExpand && !todoFilterQuery.trim() && loadedCompletedCount < targetTotalCompleted) {
            fetchCompletedForList(list.id)
        }
    }

    // Fetch todo lists, groups, todos & people in parallel
    const fetchLists = useCallback(
        async (opts?: { silent?: boolean }) => {
            if (!project.db_id) return
            if (!opts?.silent) setLoading(true)
            try {
                const [
                    listsResult,
                    groupsResult,
                    activeTodosResult,
                    completedTodosResult,
                    selectedTodoResult,
                    allPeopleResult,
                ] = await Promise.all([
                    supabase
                        .from('bc_todolists')
                        .select(
                            'id, bc_id, name, description, color, bc_completed_ratio, position, completed_count, total_count'
                        )
                        .eq('project_id', project.db_id)
                        .order('position', { ascending: true }),

                    supabase
                        .from('bc_todolist_groups')
                        .select('id, bc_id, todolist_id, name, color, position, completed_count, total_count')
                        .eq('project_id', project.db_id)
                        .order('position', { ascending: true }),

                    supabase
                        .from('bc_todos')
                        .select(`
                            id, bc_id, todolist_id, group_id, title, is_completed, completed_at, starts_on, due_date, position,
                            comments_count, boosts_count, created_by_person_id, created_at, description,
                            bc_todo_assignees(
                                person:bc_people(id, name, email, avatar_url)
                            )
                        `)
                        .eq('project_id', project.db_id)
                        .eq('is_completed', false)
                        .order('position', { ascending: true, nullsFirst: false })
                        .order('created_at', { ascending: true }),

                    supabase
                        .from('bc_todos')
                        .select(`
                            id, bc_id, todolist_id, group_id, title, is_completed, completed_at, starts_on, due_date, position,
                            comments_count, boosts_count, created_by_person_id, created_at, description,
                            bc_todo_assignees(
                                person:bc_people(id, name, email, avatar_url)
                            )
                        `)
                        .eq('project_id', project.db_id)
                        .eq('is_completed', true)
                        .order('completed_at', { ascending: false, nullsFirst: false })
                        .order('created_at', { ascending: false })
                        .limit(200),

                    (() => {
                        const cleanSelId = String(selectedTodoIdRef.current || '').trim()
                        const isUuidSel = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanSelId)
                        const isNumSel = /^\d+$/.test(cleanSelId)
                        if (!isUuidSel && !isNumSel) {
                            return Promise.resolve({ data: null, error: null } as any)
                        }
                        const selQuery = supabase
                            .from('bc_todos')
                            .select(`
                                id, bc_id, todolist_id, group_id, title, is_completed, completed_at, starts_on, due_date, position,
                                comments_count, boosts_count, created_by_person_id, created_at, description,
                                bc_todo_assignees(
                                    person:bc_people(id, name, email, avatar_url)
                                )
                            `)
                        return isUuidSel
                            ? selQuery.eq('id', cleanSelId).maybeSingle()
                            : selQuery.eq('bc_id', Number(cleanSelId)).maybeSingle()
                    })(),

                    supabase
                        .from('bc_people')
                        .select('id, bc_id, name, email, avatar_url, title, role, is_active, attachable_sgid')
                        .limit(5000),
                ])

                if (listsResult.error) throw listsResult.error
                if (activeTodosResult.error) throw activeTodosResult.error
                if (completedTodosResult.error) throw completedTodosResult.error
                if (selectedTodoResult?.error) {
                    console.warn('⚠️ [ToolTodos SelectedTodo Fetch] Warning:', selectedTodoResult.error.message)
                }

                const dbLists = listsResult.data || []
                const dbGroups = groupsResult.error ? [] : groupsResult.data || []
                let dbTodos = [...(activeTodosResult.data || []), ...(completedTodosResult.data || [])]
                const selectedTodo = selectedTodoResult?.data

                if (selectedTodo && !dbTodos.some((tk) => tk.id === selectedTodo.id)) {
                    dbTodos = [...dbTodos, selectedTodo]
                }

                const peopleLookup = new Map<string, string>()
                const peopleObjMap = new Map<string, BasecampPersonOption>()
                const activePeopleList: BasecampPersonOption[] = []

                if (Array.isArray(allPeopleResult?.data)) {
                    allPeopleResult.data.forEach((p: any) => {
                        if (p?.id && p?.name) {
                            peopleLookup.set(p.id, p.name)
                            const opt: BasecampPersonOption = {
                                id: p.id,
                                bc_id: p.bc_id,
                                name: p.name,
                                email: isMaskedOrEmptyEmail(p.email) ? '' : canonicalizeBasecampEmail(p.email),
                                avatar: p.avatar_url || '',
                                avatar_url: p.avatar_url || '',
                                title: p.title || '',
                                role: p.role || '',
                                attachable_sgid: p.attachable_sgid || null,
                            }
                            peopleObjMap.set(p.id, opt)
                            if (p.is_active !== false) {
                                activePeopleList.push(opt)
                            }
                        }
                    })
                }
                if (Array.isArray(project.people)) {
                    project.people.forEach((p: any) => {
                        if (p?.id && p?.name && !peopleLookup.has(p.id)) {
                            peopleLookup.set(p.id, p.name)
                        }
                    })
                }
                peopleLookupRef.current = peopleLookup
                peopleObjByIdRef.current = peopleObjMap
                setAllPeopleState(activePeopleList)

                const mappedLists = dbLists.map((list) => {
                    const listTodos = dbTodos.filter((tk) => tk.todolist_id === list.id)
                    const tasks = listTodos.map((tk) => mapDbTodoToTask(tk, peopleLookup))
                    const listGroups = dbGroups
                        .filter((g: any) => g.todolist_id === list.id)
                        .map((g: any) => ({
                            id: g.id,
                            bc_id: g.bc_id,
                            todolist_id: g.todolist_id,
                            name: g.name,
                            color: g.color || null,
                            position: g.position ?? 1,
                            completed_count: Number(g.completed_count || 0),
                            total_count: Number(g.total_count || 0),
                        }))

                    return {
                        id: list.id,
                        bc_id: list.bc_id,
                        list_name: list.name,
                        description: list.description || '',
                        color: list.color || null,
                        bc_completed_ratio: list.bc_completed_ratio || null,
                        position: list.position ?? 1,
                        completed_count: list.completed_count,
                        total_count: list.total_count,
                        groups: listGroups,
                        tasks,
                    }
                })

                setLists(mappedLists)

                setSelectedTask((prev: any) => {
                    if (!prev) return null
                    for (const l of mappedLists) {
                        const foundTask = l.tasks.find((tk: any) => tk.id === prev.id)
                        if (foundTask) {
                            setSelectedTaskListId(l.id)
                            return foundTask
                        }
                    }
                    return prev
                })
            } catch (err: any) {
                console.error(
                    '❌ [ToolTodos Fetch] Error loading todo lists:',
                    err?.message || err?.details || err?.code || JSON.stringify(err) || err
                )
            } finally {
                if (project.db_id) {
                    loadedListsProjectIdRef.current = project.db_id
                }
                setLoading(false)
            }
        },
        [project.db_id, project.people, supabase, mapDbTodoToTask]
    )

    // Fetch comments + boosts + live Basecamp hydration for active task
    const fetchTaskComments = useCallback(
        async (
            taskId: string,
            taskBcId?: number | string,
            opts?: { silent?: boolean; skipLiveHydration?: boolean }
        ) => {
            if (!taskId) return
            if (!opts?.skipLiveHydration) {
                commentFetchAbortRef.current?.abort()
            }
            const controller = new AbortController()
            if (!opts?.skipLiveHydration) {
                commentFetchAbortRef.current = controller
            }

            if (!opts?.silent) setCommentsLoading(true)
            try {
                const [commentsRes, todoBoostsRes] = await Promise.all([
                    supabase
                        .from('bc_comments')
                        .select(
                            'id, bc_id, parent_id, content, author_person_id, created_at, updated_at, boosts_count, author:bc_people(id, name, email, avatar_url)'
                        )
                        .eq('parent_type', 'todo')
                        .eq('parent_id', taskId)
                        .order('created_at', { ascending: true }),

                    supabase
                        .from('bc_boosts')
                        .select(
                            'id, bc_id, recording_type, recording_id, booster_person_id, content, created_at, booster:bc_people(id, name, avatar_url)'
                        )
                        .eq('recording_type', 'todo')
                        .eq('recording_id', taskId)
                        .order('created_at', { ascending: true }),
                ])

                if (commentsRes.error) throw commentsRes.error
                if (activeSelectedTaskIdRef.current !== taskId) return

                const rawComments = commentsRes.data || []
                const formatted = rawComments.map((c: any) => {
                    const authorObj = Array.isArray(c.author) ? c.author[0] : c.author
                    return {
                        id: c.id,
                        bc_id: c.bc_id,
                        author_person_id: c.author_person_id || authorObj?.id || null,
                        author: authorObj?.name || t('basecamp.unknown_user'),
                        author_avatar_url: authorObj?.avatar_url || '',
                        text: c.content || '',
                        rawText: c.content || '',
                        timestamp: c.created_at,
                        updated_at: c.updated_at || c.created_at,
                        boosts_count: Number(c.boosts_count || 0),
                    }
                })

                setTaskComments(formatted)
                setTaskBoosts((todoBoostsRes.data || []).map(normalizeBoostRow))

                const commentIds = formatted.map((fc: any) => fc.id).filter(Boolean)
                if (commentIds.length > 0) {
                    const { data: cBoostRows } = await supabase
                        .from('bc_boosts')
                        .select(
                            'id, bc_id, recording_type, recording_id, booster_person_id, content, created_at, booster:bc_people(id, name, avatar_url)'
                        )
                        .eq('recording_type', 'comment')
                        .in('recording_id', commentIds)
                        .order('created_at', { ascending: true })

                    if (activeSelectedTaskIdRef.current === taskId) {
                        const grouped: Record<string, any[]> = {}
                        for (const b of cBoostRows || []) {
                            const norm = normalizeBoostRow(b)
                            if (!grouped[norm.recording_id]) grouped[norm.recording_id] = []
                            grouped[norm.recording_id].push(norm)
                        }
                        setCommentBoostsMap(grouped)
                    }
                } else {
                    setCommentBoostsMap({})
                }
            } catch (err: any) {
                console.error('❌ [ToolTodos Comments Fetch] Error:', err?.message || err)
            } finally {
                if (!opts?.silent && activeSelectedTaskIdRef.current === taskId) {
                    setCommentsLoading(false)
                }
            }

            // Live hydration from /api/basecamp/todo-detail for real Basecamp IDs
            const numericBcId = Number(taskBcId)
            if (!opts?.skipLiveHydration && project.id && numericBcId > 0 && numericBcId < SYNTHETIC_BC_ID_THRESHOLD) {
                fetch(`/api/basecamp/todo-detail?projectId=${project.id}&todoId=${numericBcId}`, {
                    signal: controller.signal,
                })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((liveData) => {
                        if (!liveData || controller.signal.aborted || activeSelectedTaskIdRef.current !== taskId) return

                        if (Array.isArray(liveData.boosts)) {
                            setTaskBoosts(liveData.boosts.map(normalizeBoostRow))
                        }

                        if (liveData.commentBoosts && typeof liveData.commentBoosts === 'object') {
                            const nextMap: Record<string, any[]> = {}
                            for (const [cid, arr] of Object.entries(liveData.commentBoosts)) {
                                if (Array.isArray(arr)) {
                                    nextMap[cid] = arr.map(normalizeBoostRow)
                                }
                            }
                            setCommentBoostsMap((prev) => ({ ...prev, ...nextMap }))
                        }

                        if (Array.isArray(liveData.comments)) {
                            setTaskComments((prev) => {
                                if (activeSelectedTaskIdRef.current !== taskId) return prev
                                const prevByBcId = new Map<number, any>()
                                for (const p of prev) {
                                    if (p.bc_id) prevByBcId.set(Number(p.bc_id), p)
                                }
                                const hydratedBcComments = liveData.comments.map((lc: any) => {
                                    const existing = lc.bc_id ? prevByBcId.get(Number(lc.bc_id)) : null
                                    return {
                                        id: existing?.id || lc.id,
                                        bc_id: lc.bc_id,
                                        author_person_id: lc.author_person_id || existing?.author_person_id || null,
                                        author:
                                            !lc.author || lc.author === 'Unknown'
                                                ? existing?.author || t('basecamp.unknown_user')
                                                : lc.author,
                                        author_avatar_url: existing?.author_avatar_url || '',
                                        text: lc.text ?? existing?.text ?? '',
                                        rawText: lc.text ?? existing?.rawText ?? '',
                                        timestamp: lc.timestamp || existing?.timestamp,
                                        updated_at: lc.updated_at || existing?.updated_at || lc.timestamp,
                                        boosts_count: Number(lc.boosts_count ?? existing?.boosts_count ?? 0),
                                    }
                                })
                                const localOnly = prev.filter((p) => {
                                    const bcNum = Number(p.bc_id || 0)
                                    if (bcNum > 0 && bcNum < SYNTHETIC_BC_ID_THRESHOLD) return false
                                    const normText = normalizeSearch(p.text)
                                    const alreadyMirrored = hydratedBcComments.some(
                                        (hc: any) => normalizeSearch(hc.text) === normText
                                    )
                                    return !alreadyMirrored
                                })
                                const merged = [...hydratedBcComments, ...localOnly]
                                merged.sort(
                                    (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
                                )
                                return merged
                            })
                        }

                        const curTask = selectedTaskRef.current
                        if (curTask && curTask.id === taskId) {
                            const nextTitle =
                                typeof liveData.title === 'string' && liveData.title.trim().length > 0
                                    ? liveData.title.trim()
                                    : curTask.task_name
                            const nextCompleted =
                                typeof liveData.is_completed === 'boolean'
                                    ? liveData.is_completed
                                    : curTask.is_completed
                            const nextStartsOn =
                                liveData.starts_on !== undefined ? liveData.starts_on : curTask.starts_on
                            const nextDueDate =
                                liveData.due_date !== undefined ? liveData.due_date : curTask.due_date
                            const nextGroupId =
                                liveData.group_id !== undefined ? liveData.group_id : curTask.group_id
                            const nextCount =
                                typeof liveData.comments_count === 'number'
                                    ? Math.max(liveData.comments_count, Number(curTask.comments_count || 0))
                                    : curTask.comments_count
                            const nextDesc =
                                typeof liveData.description === 'string'
                                    ? liveData.description
                                    : curTask.description
                            const nextAssigneeList = Array.isArray(liveData.assigneeUuids)
                                ? liveData.assigneeUuids
                                      .map((uid: string) => {
                                          const p = peopleObjByIdRef.current.get(String(uid))
                                          if (!p) return null
                                          return {
                                              id: p.id,
                                              name: p.name,
                                              email: p.email || '',
                                              avatar_url: p.avatar_url || '',
                                          }
                                      })
                                      .filter(Boolean)
                                : curTask.assigneeList

                            const prevAssIds = (curTask.assigneeList || [])
                                .map((a: any) => a.id)
                                .sort()
                                .join(',')
                            const nextAssIds = (nextAssigneeList || [])
                                .map((a: any) => a.id)
                                .sort()
                                .join(',')

                            const hasTaskDiff =
                                curTask.task_name !== nextTitle ||
                                curTask.is_completed !== nextCompleted ||
                                (curTask.starts_on || null) !== (nextStartsOn || null) ||
                                (curTask.due_date || null) !== (nextDueDate || null) ||
                                (curTask.group_id || null) !== (nextGroupId || null) ||
                                curTask.comments_count !== nextCount ||
                                (curTask.description || '') !== (nextDesc || '') ||
                                prevAssIds !== nextAssIds

                            if (hasTaskDiff) {
                                setSelectedTask((prev: any) => {
                                    if (!prev || prev.id !== taskId) return prev
                                    return {
                                        ...prev,
                                        task_name: nextTitle,
                                        is_completed: nextCompleted,
                                        starts_on: nextStartsOn || null,
                                        due_date: nextDueDate || null,
                                        group_id: nextGroupId || null,
                                        comments_count: nextCount,
                                        description: nextDesc,
                                        rawDescription: nextDesc,
                                        assigneeList: nextAssigneeList,
                                        assignee: (nextAssigneeList || []).map((a: any) => a.name).join(', ') || null,
                                    }
                                })
                                if (liveData.todolist_id) {
                                    setSelectedTaskListId(liveData.todolist_id)
                                }
                                fetchLists({ silent: true })
                            }
                        }
                    })
                    .catch((err: any) => {
                        if (err?.name !== 'AbortError') {
                            console.warn('⚠️ [ToolTodos LiveHydration] Skipped:', err?.message || err)
                        }
                    })
            }
        },
        [project.id, supabase, fetchLists, normalizeBoostRow, t]
    )

    // Open Task Edit Mode helper (focusing a specific field when clicked inline!)
    const openTaskEditMode = useCallback((taskObj: any, focusField: EditFocusTarget = 'title') => {
        if (!taskObj) return
        setEditTaskTitle(taskObj.task_name || '')
        setEditTaskAssignees(Array.isArray(taskObj.assigneeList) ? [...taskObj.assigneeList] : [])
        setEditAssigneeSearchQuery('')
        setShowEditAssigneeSuggestions(false)
        setHighlightedEditAssigneeIdx(0)

        const sOn = taskObj.starts_on || ''
        const dOn = taskObj.due_date || ''
        if (sOn && dOn && sOn !== dOn) {
            setEditTaskDateMode('range')
            setEditTaskStartsOn(sOn)
            setEditTaskDueDate(dOn)
        } else if (dOn) {
            setEditTaskDateMode('single')
            setEditTaskStartsOn('')
            setEditTaskDueDate(dOn)
        } else if (sOn) {
            setEditTaskDateMode('range')
            setEditTaskStartsOn(sOn)
            setEditTaskDueDate(sOn)
        } else {
            setEditTaskDateMode('none')
            setEditTaskStartsOn('')
            setEditTaskDueDate('')
        }

        setEditTaskGroupId(taskObj.group_id || '')
        const cleanRawDesc = stripTegAuthorBanner(taskObj.rawDescription ?? taskObj.description ?? '').cleanHtml
        setEditTaskNotesHtml(cleanRawDesc)
        setEditFocusTarget(focusField)
        setEditSessionKey((k) => k + 1)
        setShowTaskMoreMenu(false)
        setShowMoveTaskModal(false)
        setIsEditingTask(true)
    }, [])

    // Focus requested field when entering edit mode
    useEffect(() => {
        if (!isEditingTask) return
        const timer = setTimeout(() => {
            if (editFocusTarget === 'title') {
                editTitleInputRef.current?.focus()
                editTitleInputRef.current?.select()
            } else if (editFocusTarget === 'assignees') {
                editAssigneeInputRef.current?.focus()
                setShowEditAssigneeSuggestions(true)
            } else if (editFocusTarget === 'dates') {
                editDateSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
            } else if (editFocusTarget === 'group') {
                editGroupSelectRef.current?.focus()
            }
        }, 40)
        return () => clearTimeout(timer)
    }, [isEditingTask, editSessionKey, editFocusTarget])

    // Load destination projects/lists/groups for Move To-Do modal
    const openMoveModalForTask = useCallback(
        async (taskObj: any, currentListId?: string | null) => {
            if (!taskObj) return
            setShowTaskMoreMenu(false)
            setIsEditingTask(false)
            setShowMoveTaskModal(true)
            setMoveLoadingCatalog(true)
            try {
                const { data: projs } = await supabase
                    .from('bc_projects')
                    .select('id, bc_id, name, enabled_tools')
                    .eq('is_archived', false)
                    .order('name', { ascending: true })

                const todoCapableProjects = (projs || [])
                    .filter((p: any) => {
                        if (p.id === project.db_id) return true
                        if (!Array.isArray(p.enabled_tools) || p.enabled_tools.length === 0) return true
                        return p.enabled_tools.includes('todoset')
                    })
                    .map((p: any) => ({ id: p.id, bc_id: Number(p.bc_id), name: p.name }))

                setMoveProjects(todoCapableProjects)
                const defaultProjId = project.db_id || todoCapableProjects[0]?.id || ''
                setMoveTargetProjectDbId(defaultProjId)

                const localLists = lists.map((l) => ({
                    id: l.id,
                    bc_id: Number(l.bc_id),
                    name: l.list_name,
                    color: l.color || null,
                }))
                setMoveListsForProject(localLists)

                const altList = localLists.find((l) => l.id !== (currentListId || taskObj.todolist_id))
                const initialListId = altList?.id || currentListId || taskObj.todolist_id || localLists[0]?.id || ''
                setMoveTargetListDbId(initialListId)

                const targetListObj = lists.find((l) => l.id === initialListId)
                const initialGroups = (targetListObj?.groups || []).map((g: any) => ({
                    id: g.id,
                    bc_id: Number(g.bc_id),
                    name: g.name,
                    color: g.color || null,
                }))
                setMoveGroupsForList(initialGroups)
                setMoveTargetGroupDbId(
                    initialListId === (currentListId || taskObj.todolist_id) ? taskObj.group_id || '' : ''
                )
            } catch (err: any) {
                console.error('❌ [ToolTodos MoveCatalog] Error:', err?.message || err)
            } finally {
                setMoveLoadingCatalog(false)
            }
        },
        [supabase, project.db_id, lists]
    )

    const handleChangeMoveProject = async (nextProjDbId: string) => {
        setMoveTargetProjectDbId(nextProjDbId)
        setMoveTargetGroupDbId('')
        if (nextProjDbId === project.db_id) {
            const localLists = lists.map((l) => ({
                id: l.id,
                bc_id: Number(l.bc_id),
                name: l.list_name,
                color: l.color || null,
            }))
            setMoveListsForProject(localLists)
            const firstId = localLists[0]?.id || ''
            setMoveTargetListDbId(firstId)
            const firstListObj = lists.find((l) => l.id === firstId)
            setMoveGroupsForList(firstListObj?.groups || [])
            return
        }

        setMoveLoadingCatalog(true)
        try {
            const [{ data: remoteLists }, { data: remoteGroups }] = await Promise.all([
                supabase
                    .from('bc_todolists')
                    .select('id, bc_id, name, color')
                    .eq('project_id', nextProjDbId)
                    .order('position', { ascending: true }),
                supabase
                    .from('bc_todolist_groups')
                    .select('id, bc_id, todolist_id, name, color')
                    .eq('project_id', nextProjDbId)
                    .order('position', { ascending: true }),
            ])
            const mappedL = (remoteLists || []).map((l: any) => ({
                id: l.id,
                bc_id: Number(l.bc_id),
                name: l.name,
                color: l.color || null,
            }))
            setMoveListsForProject(mappedL)
            const firstListId = mappedL[0]?.id || ''
            setMoveTargetListDbId(firstListId)
            setMoveGroupsForList(
                (remoteGroups || [])
                    .filter((g: any) => g.todolist_id === firstListId)
                    .map((g: any) => ({
                        id: g.id,
                        bc_id: Number(g.bc_id),
                        name: g.name,
                        color: g.color || null,
                    }))
            )
        } catch (err: any) {
            console.error('❌ [ToolTodos MoveProjectLists] Error:', err?.message || err)
        } finally {
            setMoveLoadingCatalog(false)
        }
    }

    const handleChangeMoveList = async (nextListDbId: string) => {
        setMoveTargetListDbId(nextListDbId)
        setMoveTargetGroupDbId('')
        if (moveTargetProjectDbId === project.db_id) {
            const foundL = lists.find((l) => l.id === nextListDbId)
            setMoveGroupsForList(foundL?.groups || [])
            return
        }
        const { data: remoteGroups } = await supabase
            .from('bc_todolist_groups')
            .select('id, bc_id, name, color')
            .eq('todolist_id', nextListDbId)
            .order('position', { ascending: true })
        setMoveGroupsForList(
            (remoteGroups || []).map((g: any) => ({
                id: g.id,
                bc_id: Number(g.bc_id),
                name: g.name,
                color: g.color || null,
            }))
        )
    }

    // Load comments & reset modal-scoped UI states whenever selectedTask ID changes
    const prevLoadedTaskIdRef = useRef<string | null>(null)
    useEffect(() => {
        if (selectedTask?.id) {
            const isSameTask = prevLoadedTaskIdRef.current === selectedTask.id
            prevLoadedTaskIdRef.current = selectedTask.id
            if (!isSameTask) {
                setTaskComments([])
                setTaskBoosts([])
                setCommentBoostsMap({})
                setShowTaskMoreMenu(false)
                setEditingCommentId(null)
                setOpenCommentMenuId(null)
                setOpenBoostPopoverKey(null)
                setLinkCopiedToast(false)
                setMovedBannerText(null)
                setNewCommentHtml('')
                setNewCommentIsEmpty(true)
                setCommentDraftInitialHtml('')
                setCommentEditorSeed((s) => s + 1)

                const pending = pendingInitialDetailActionRef.current
                pendingInitialDetailActionRef.current = null
                if (pending?.mode === 'edit') {
                    openTaskEditMode(selectedTask, pending.focus || 'title')
                } else if (pending?.mode === 'move') {
                    openMoveModalForTask(selectedTask, selectedTaskListId || selectedTask.todolist_id)
                } else {
                    setIsEditingTask(false)
                    setShowMoveTaskModal(false)
                }
            }
            fetchTaskComments(selectedTask.id, selectedTask.bc_id, { silent: isSameTask })
        } else {
            prevLoadedTaskIdRef.current = null
            commentFetchAbortRef.current?.abort()
            setTaskComments([])
            setTaskBoosts([])
            setCommentBoostsMap({})
            setIsEditingTask(false)
            setShowMoveTaskModal(false)
        }
        return () => {
            commentFetchAbortRef.current?.abort()
        }
    }, [
        selectedTask?.id,
        selectedTask?.bc_id,
        fetchTaskComments,
        openTaskEditMode,
        openMoveModalForTask,
        selectedTaskListId,
    ])

    useEffect(() => {
        fetchLists()
    }, [fetchLists])

    // Supabase Realtime subscriptions (bc_todos, bc_comments, bc_todolists, bc_todolist_groups, bc_boosts)
    useEffect(() => {
        if (!project.db_id) return
        const channel = supabase
            .channel(`bc_todos_live_${project.db_id}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'bc_todos', filter: `project_id=eq.${project.db_id}` },
                () => {
                    fetchLists({ silent: true })
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'bc_todolists', filter: `project_id=eq.${project.db_id}` },
                () => {
                    fetchLists({ silent: true })
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'bc_todolist_groups', filter: `project_id=eq.${project.db_id}` },
                () => {
                    fetchLists({ silent: true })
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'bc_comments', filter: `project_id=eq.${project.db_id}` },
                (payload: any) => {
                    fetchLists({ silent: true })
                    const parentId = payload.new?.parent_id || payload.old?.parent_id
                    if (selectedTask?.id && parentId === selectedTask.id) {
                        fetchTaskComments(selectedTask.id, selectedTask.bc_id, {
                            silent: true,
                            skipLiveHydration: true,
                        })
                    }
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'bc_boosts', filter: `project_id=eq.${project.db_id}` },
                () => {
                    if (selectedTask?.id) {
                        fetchTaskComments(selectedTask.id, selectedTask.bc_id, {
                            silent: true,
                            skipLiveHydration: true,
                        })
                    }
                    fetchLists({ silent: true })
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [project.db_id, selectedTask?.id, selectedTask?.bc_id, fetchLists, fetchTaskComments, supabase])

    useEffect(() => {
        if (!selectedTodoId) {
            openedDeepLinkTodoRef.current = null
            return
        }
        if (replicateTodoId) return

        const cleanId = String(selectedTodoId).trim()
        if (!cleanId) return
        if (openedDeepLinkTodoRef.current === cleanId) return

        for (const list of lists) {
            const task = list.tasks.find(
                (tk: any) => tk.id === cleanId || (tk.bc_id != null && String(tk.bc_id) === cleanId)
            )
            if (task) {
                openedDeepLinkTodoRef.current = cleanId
                setSelectedTask(task)
                setSelectedTaskListId(list.id)
                return
            }
        }

        if (loading || (project.db_id && loadedListsProjectIdRef.current !== project.db_id)) {
            return
        }

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId)
        const isNumericBcId = /^\d+$/.test(cleanId)
        if (!isUuid && !isNumericBcId) return

        let cancelled = false
        ;(async () => {
            try {
                const baseQuery = supabase
                    .from('bc_todos')
                    .select(`
                        id, bc_id, project_id, todolist_id, group_id, title, is_completed, completed_at, starts_on, due_date, position,
                        comments_count, boosts_count, created_by_person_id, created_at, description,
                        creator:bc_people!bc_todos_created_by_person_id_fkey(id, name),
                        project:bc_projects(id, bc_id, name),
                        bc_todo_assignees(
                            person:bc_people(id, name, email, avatar_url)
                        )
                    `)
                const { data: directRow, error } = await (isUuid
                    ? baseQuery.eq('id', cleanId).maybeSingle()
                    : baseQuery.eq('bc_id', Number(cleanId)).maybeSingle())

                if (cancelled || error || !directRow) return

                const relCreator = Array.isArray((directRow as any).creator)
                    ? (directRow as any).creator[0]
                    : (directRow as any).creator
                if (relCreator?.id && relCreator?.name && !peopleLookupRef.current.has(relCreator.id)) {
                    peopleLookupRef.current.set(relCreator.id, relCreator.name)
                }

                const relProj = Array.isArray((directRow as any).project)
                    ? (directRow as any).project[0]
                    : (directRow as any).project
                if (
                    directRow.project_id &&
                    project.db_id &&
                    directRow.project_id !== project.db_id &&
                    relProj?.bc_id &&
                    navigateTo
                ) {
                    openedDeepLinkTodoRef.current = cleanId
                    navigateTo({
                        project: String(relProj.bc_id),
                        tool: 'todos',
                        todoId: directRow.id,
                    })
                    return
                }

                const mappedTask = mapDbTodoToTask(directRow, peopleLookupRef.current)
                openedDeepLinkTodoRef.current = cleanId
                if (directRow.todolist_id) {
                    setLists((prevLists) =>
                        prevLists.map((l) =>
                            l.id === directRow.todolist_id && !l.tasks.some((tk: any) => tk.id === mappedTask.id)
                                ? { ...l, tasks: [...l.tasks, mappedTask] }
                                : l
                        )
                    )
                }
                setSelectedTask(mappedTask)
                setSelectedTaskListId(directRow.todolist_id || null)
            } catch (err: any) {
                console.warn('⚠️ [ToolTodos DeepLink Fallback] Error:', err?.message || err)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [selectedTodoId, replicateTodoId, lists, loading, project.db_id, supabase, mapDbTodoToTask, navigateTo])

    // Debounced live search across historical & completed bc_todos in the current project
    useEffect(() => {
        if (historySearchTimerRef.current) {
            clearTimeout(historySearchTimerRef.current)
            historySearchTimerRef.current = null
        }
        const trimmed = todoFilterQuery.trim()
        if (trimmed.length < 2 || !project.db_id) {
            historySearchSeqRef.current++
            setHistorySearchResults([])
            setHistorySearchLoading(false)
            return
        }

        const safeLiteral = trimmed.replace(/[%_\\"]/g, ' ').replace(/\s+/g, ' ').trim()
        if (!safeLiteral) {
            historySearchSeqRef.current++
            setHistorySearchResults([])
            setHistorySearchLoading(false)
            return
        }

        const reqSeq = ++historySearchSeqRef.current
        setHistorySearchLoading(true)

        historySearchTimerRef.current = setTimeout(async () => {
            try {
                const exactQuoted = `"%${safeLiteral}%"`
                const asciiVariant = safeLiteral.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                const wildcardVariant = safeLiteral.replace(/[aáeéiíoóuúüñAÁEÉIÍOÓUÚÜÑ]/g, '_')
                const hasConsonants = safeLiteral.replace(/[aáeéiíoóuúüñAÁEÉIÍOÓUÚÜÑ\s]/g, '').length >= 2

                const clauses = [`title.ilike.${exactQuoted}`, `description.ilike.${exactQuoted}`]
                if (asciiVariant && asciiVariant !== safeLiteral) {
                    const asciiQuoted = `"%${asciiVariant}%"`
                    clauses.push(`title.ilike.${asciiQuoted}`, `description.ilike.${asciiQuoted}`)
                }
                if (hasConsonants && wildcardVariant !== safeLiteral) {
                    const wildQuoted = `"%${wildcardVariant}%"`
                    clauses.push(`title.ilike.${wildQuoted}`, `description.ilike.${wildQuoted}`)
                }

                const { data, error } = await supabase
                    .from('bc_todos')
                    .select(`
                        id, bc_id, todolist_id, group_id, title, is_completed, completed_at, starts_on, due_date, position,
                        comments_count, boosts_count, created_by_person_id, created_at, description,
                        bc_todo_assignees(
                            person:bc_people(id, name, email, avatar_url)
                        )
                    `)
                    .eq('project_id', project.db_id)
                    .or(clauses.join(','))
                    .order('created_at', { ascending: false })
                    .limit(40)

                if (reqSeq !== historySearchSeqRef.current) return
                if (error) throw error

                const normQ = normalizeSearch(trimmed)
                const mapped = (data || [])
                    .filter((row: any) => {
                        const snip = extractTaskRowSnippet(row.description)
                        const haystack = normalizeSearch(
                            `${row.title || ''} ${snip.textSnippet} ${snip.attachmentNames.join(' ')}`
                        )
                        return haystack.includes(normQ) || normalizeSearch(row.description || '').includes(normQ)
                    })
                    .map((row: any) => mapDbTodoToTask(row, peopleLookupRef.current))

                setHistorySearchResults(mapped)
            } catch (err: any) {
                console.error('❌ [ToolTodos HistorySearch] Error:', err?.message || err)
                if (reqSeq === historySearchSeqRef.current) {
                    setHistorySearchResults([])
                }
            } finally {
                if (reqSeq === historySearchSeqRef.current) {
                    setHistorySearchLoading(false)
                }
            }
        }, 250)

        return () => {
            if (historySearchTimerRef.current) {
                clearTimeout(historySearchTimerRef.current)
                historySearchTimerRef.current = null
            }
        }
    }, [todoFilterQuery, project.db_id, supabase, mapDbTodoToTask])

    // Replicate any open or historical completed task into its exact same todolist_id
    const handleReplicateTask = useCallback(
        async (sourceInput: any) => {
            const taskId = typeof sourceInput === 'string' ? sourceInput : sourceInput?.id
            if (!taskId) return

            setReplicatingTaskId(taskId)
            setOpenRowMenuTaskId(null)
            setShowTaskMoreMenu(false)
            setMutationError(null)

            try {
                let sourceObj = typeof sourceInput === 'object' && sourceInput ? sourceInput : null
                if (!sourceObj) {
                    for (const l of lists) {
                        const found = l.tasks.find((tk: any) => tk.id === taskId)
                        if (found) {
                            sourceObj = found
                            break
                        }
                    }
                }

                const numericBcId = Number(sourceObj?.bc_id || 0)
                const needsDbFetch =
                    !sourceObj ||
                    !sourceObj.todolist_id ||
                    typeof sourceObj.description !== 'string' ||
                    !sourceObj.description ||
                    (numericBcId > 0 && numericBcId < SYNTHETIC_BC_ID_THRESHOLD)

                let resolvedTitle = String(sourceObj?.task_name || sourceObj?.title || '').trim()
                let resolvedDesc = String(sourceObj?.rawDescription ?? sourceObj?.description ?? '')
                let resolvedListId = String(sourceObj?.todolist_id || selectedTaskListId || '')
                let resolvedGroupId: string | null = sourceObj?.group_id || null

                if (needsDbFetch) {
                    const { data: dbRow, error: dbErr } = await supabase
                        .from('bc_todos')
                        .select('id, bc_id, title, description, todolist_id, group_id')
                        .eq('id', taskId)
                        .maybeSingle()

                    if (!dbErr && dbRow) {
                        resolvedTitle = String(dbRow.title || resolvedTitle).trim()
                        if (dbRow.description || !resolvedDesc) {
                            resolvedDesc = String(dbRow.description || '')
                        }
                        resolvedListId = String(dbRow.todolist_id || resolvedListId)
                        resolvedGroupId = dbRow.group_id || null
                    }
                }

                if (!resolvedListId && lists.length > 0) {
                    resolvedListId = lists[0].id
                }
                if (!resolvedListId) return

                const targetList = lists.find((l) => l.id === resolvedListId)
                const validGroupId =
                    resolvedGroupId &&
                    Array.isArray(targetList?.groups) &&
                    targetList.groups.some((g: any) => g.id === resolvedGroupId)
                        ? resolvedGroupId
                        : null

                const peoplePool = editorPeople.length > 0 ? editorPeople : allPeopleState
                const replicatedHtml = prepareHtmlForTaskReplication(resolvedDesc, peoplePool)
                const isNotesEmpty = !hasRichContentOrMedia(replicatedHtml)

                if (selectedTaskRef.current) {
                    closeTaskDetail()
                }

                setTodoFilterQuery('')
                setSelectedListId(resolvedListId)

                setNewTaskName(resolvedTitle)
                setNewTaskInitialHtml(replicatedHtml)
                setNewTaskNotes(replicatedHtml)
                setNotesIsEmpty(isNotesEmpty)
                setNewTaskAssignees([])
                setAssigneeSearchQuery('')
                setHighlightedAssigneeIdx(0)
                setNewTaskDateMode('none')
                setNewTaskStartsOn('')
                setNewTaskDueDate('')
                setShowSubtasksInput(false)
                setNewTaskSubtasks([''])
                setReplicatingBanner({
                    listId: resolvedListId,
                    listName: targetList?.list_name || t('basecamp.todos'),
                })
                setAddingTaskId(resolvedListId)
                setAddingTaskGroupId(validGroupId)
                setNewTaskEditorSeed((s) => s + 1)

                if (onConsumeReplicateTodo) {
                    onConsumeReplicateTodo()
                } else if (typeof window !== 'undefined') {
                    const url = new URL(window.location.href)
                    if (url.searchParams.has('replicateTodoId')) {
                        url.searchParams.delete('replicateTodoId')
                        window.history.replaceState(null, '', url.pathname + (url.search ? url.search : ''))
                    }
                }

                setTimeout(() => {
                    addTaskFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    newAssigneeInputRef.current?.focus({ preventScroll: true })
                    setShowAssigneeSuggestions(true)
                }, 120)
            } catch (err: any) {
                console.error('❌ [ToolTodos ReplicateTask] Error:', err?.message || err)
                setMutationError(`${t('basecamp.sync_error_prefix')}${err?.message || t('basecamp.action_error')}`)
            } finally {
                setReplicatingTaskId(null)
            }
        },
        [lists, selectedTaskListId, editorPeople, allPeopleState, supabase, closeTaskDetail, onConsumeReplicateTodo, t]
    )

    // Deep-link trigger from Global Search (?replicateTodoId=...)
    useEffect(() => {
        if (!replicateTodoId) {
            consumedReplicateIdRef.current = null
            return
        }
        if (lists.length === 0 || loading) return
        if (consumedReplicateIdRef.current === replicateTodoId) return
        consumedReplicateIdRef.current = replicateTodoId
        void handleReplicateTask(replicateTodoId)
    }, [replicateTodoId, lists, loading, handleReplicateTask])

    // Open detail from row and jump straight into edit or move
    const openRowTaskDetailWithAction = (
        listId: string,
        task: any,
        mode: 'edit' | 'move',
        focus?: EditFocusTarget
    ) => {
        setOpenRowMenuTaskId(null)
        if (selectedTask?.id === task.id) {
            if (mode === 'edit') openTaskEditMode(task, focus || 'title')
            else openMoveModalForTask(task, listId)
            return
        }
        pendingInitialDetailActionRef.current = { mode, focus }
        setSelectedTaskListId(listId)
        setSelectedTask(task)
    }

    // ── CRUD Action Handlers ──
    const handleToggleTask = async (_listId: string, task: any) => {
        const actionType = task.is_completed ? 'uncomplete_todo' : 'complete_todo'
        setActionLoading(task.id)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: actionType,
                    projectId: project.id,
                    todoId: task.bc_id,
                    todoDbId: task.id,
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            await fetchLists({ silent: true })
        } catch (err: any) {
            console.error(`❌ [ToolTodos Toggle] Error performing ${actionType}:`, err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(null)
        }
    }

    const handleAddList = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newListName.trim()) return
        setLoading(true)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_todolist',
                    projectId: project.id,
                    name: newListName.trim(),
                    description: newListDesc.trim(),
                    color: newListColor || 'blue',
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            setNewListName('')
            setNewListDesc('')
            setNewListColor('blue')
            setShowAddList(false)
            await fetchLists({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolTodos AddList] Error creating todolist:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setLoading(false)
        }
    }

    const handleUpdateList = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingListModal || !editingListModal.name.trim()) return
        setActionLoading(`update_list_${editingListModal.id}`)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_todolist',
                    projectId: project.id,
                    todolistId: editingListModal.bc_id,
                    todolistDbId: editingListModal.id,
                    name: editingListModal.name.trim(),
                    description: editingListModal.description.trim(),
                    color: editingListModal.color || null,
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            setEditingListModal(null)
            await fetchLists({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolTodos UpdateList] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(null)
        }
    }

    const handleCreateGroup = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!creatingGroupModal || !creatingGroupModal.name.trim()) return
        setActionLoading(`create_group_${creatingGroupModal.listId}`)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_todolist_group',
                    projectId: project.id,
                    todolistId: creatingGroupModal.listBcId,
                    todolistDbId: creatingGroupModal.listId,
                    name: creatingGroupModal.name.trim(),
                    color: creatingGroupModal.color || 'blue',
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            setCreatingGroupModal(null)
            await fetchLists({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolTodos CreateGroup] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(null)
        }
    }

    const handleUpdateGroup = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingGroupModal || !editingGroupModal.name.trim()) return
        setActionLoading(`update_group_${editingGroupModal.id}`)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_todolist_group',
                    projectId: project.id,
                    groupId: editingGroupModal.bc_id,
                    groupDbId: editingGroupModal.id,
                    name: editingGroupModal.name.trim(),
                    color: editingGroupModal.color || null,
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            setEditingGroupModal(null)
            await fetchLists({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolTodos UpdateGroup] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(null)
        }
    }

    const normalizeStartAndEndDates = (
        mode: DateMode,
        rawStarts: string,
        rawDue: string
    ): { starts_on: string | null; due_date: string | null } => {
        if (mode === 'none') return { starts_on: null, due_date: null }
        if (mode === 'single') return { starts_on: null, due_date: rawDue || null }
        const s = rawStarts || null
        const d = rawDue || rawStarts || null
        if (s && d && s > d) {
            return { starts_on: d, due_date: s }
        }
        return { starts_on: s, due_date: d }
    }

    const handleAddTask = async (listId: string, listBcId: number, groupId: string | null, e: React.FormEvent) => {
        e.preventDefault()
        if (!newTaskName.trim()) return
        const loadKey = `add_task_${listId}_${groupId || 'root'}`
        setActionLoading(loadKey)
        setMutationError(null)

        const cleanDescription = hasRichContentOrMedia(newTaskNotes) ? newTaskNotes.trim() : ''
        const cleanSubtasks = showSubtasksInput ? newTaskSubtasks.map((s) => s.trim()).filter(Boolean) : []
        const { starts_on, due_date } = normalizeStartAndEndDates(newTaskDateMode, newTaskStartsOn, newTaskDueDate)

        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_todo',
                    projectId: project.id,
                    todolistId: listBcId,
                    todolistDbId: listId,
                    groupDbId: groupId || null,
                    title: newTaskName.trim(),
                    description: cleanDescription,
                    starts_on,
                    due_date,
                    assigneeUuids: newTaskAssignees.map((a: any) => a.id),
                    subtasks: cleanSubtasks,
                }),
            })
            if (!res.ok) throw new Error(await res.text())

            resetAddTaskForm()
            setAddingTaskId(null)
            setAddingTaskGroupId(null)
            await fetchLists({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolTodos AddTask] Error creating todo:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(null)
        }
    }

    const handleSaveTaskEdit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!selectedTask || !editTaskTitle.trim()) return
        setActionLoading(`edit_todo_${selectedTask.id}`)
        setMutationError(null)

        const cleanDescription = hasRichContentOrMedia(editTaskNotesHtml) ? editTaskNotesHtml.trim() : ''
        const { starts_on, due_date } = normalizeStartAndEndDates(
            editTaskDateMode,
            editTaskStartsOn,
            editTaskDueDate
        )

        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_todo',
                    projectId: project.id,
                    todoId: selectedTask.bc_id,
                    todoDbId: selectedTask.id,
                    title: editTaskTitle.trim(),
                    description: cleanDescription,
                    starts_on,
                    due_date,
                    group_id: editTaskGroupId || null,
                    assigneeUuids: editTaskAssignees.map((a: any) => a.id),
                }),
            })
            if (!res.ok) throw new Error(await res.text())

            setSelectedTask((prev: any) => {
                if (!prev || prev.id !== selectedTask.id) return prev
                return {
                    ...prev,
                    task_name: editTaskTitle.trim(),
                    description: cleanDescription,
                    rawDescription: cleanDescription,
                    starts_on,
                    due_date,
                    group_id: editTaskGroupId || null,
                    assigneeList: [...editTaskAssignees],
                    assignee: editTaskAssignees.map((a: any) => a.name).join(', ') || null,
                }
            })
            setIsEditingTask(false)
            await fetchLists({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolTodos SaveEdit] Error updating todo:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(null)
        }
    }

    const handleQuickAssignToMe = async (task: any) => {
        if (!task || !currentPersonOption) return
        const existingAssignees = task.assigneeList || []
        if (existingAssignees.some((a: any) => isCurrentUserAssigned(a))) return
        const existingIds = existingAssignees.map((a: any) => a.id)
        const nextAssigneeUuids = [...existingIds, currentPersonOption.id]
        setActionLoading(`assign_me_${task.id}`)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_todo',
                    projectId: project.id,
                    todoId: task.bc_id,
                    todoDbId: task.id,
                    assigneeUuids: nextAssigneeUuids,
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            await fetchLists({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolTodos QuickAssignMe] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(null)
        }
    }

    const handleBubbleUpTask = async (listId: string, task: any) => {
        setOpenRowMenuTaskId(null)
        setShowTaskMoreMenu(false)
        setActionLoading(`bubble_${task.id}`)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'move_todo',
                    projectId: project.id,
                    todoId: task.bc_id,
                    todoDbId: task.id,
                    targetTodolistDbId: listId,
                    targetGroupDbId: task.group_id || null,
                    position: 1,
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            setSortOrder('position')
            await fetchLists({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolTodos BubbleUp] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(null)
        }
    }

    const handleMoveTaskSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!selectedTask || !moveTargetListDbId) return
        setActionLoading(`move_todo_${selectedTask.id}`)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'move_todo',
                    projectId: project.id,
                    todoId: selectedTask.bc_id,
                    todoDbId: selectedTask.id,
                    targetTodolistDbId: moveTargetListDbId,
                    targetGroupDbId: moveTargetGroupDbId || null,
                    position: 1,
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            const payload = await res.json()

            setShowMoveTaskModal(false)
            const isCrossProject = moveTargetProjectDbId && moveTargetProjectDbId !== project.db_id
            if (isCrossProject) {
                await fetchLists({ silent: true })
                if (navigateTo && payload?.project_bc_id) {
                    navigateTo({
                        project: String(payload.project_bc_id),
                        tool: 'todos',
                        todoId: payload.id || selectedTask.id,
                    })
                } else {
                    closeTaskDetail()
                }
                return
            }

            setSelectedTaskListId(moveTargetListDbId)
            setSelectedTask((prev: any) =>
                prev
                    ? {
                          ...prev,
                          todolist_id: moveTargetListDbId,
                          group_id: moveTargetGroupDbId || null,
                      }
                    : prev
            )
            setMovedBannerText(t('basecamp.moved_success'))
            setTimeout(() => setMovedBannerText(null), 3500)
            await fetchLists({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolTodos MoveTodo] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(null)
        }
    }

    const handleDeleteTask = async (_listId: string, task: any, e?: React.MouseEvent) => {
        if (e) e.stopPropagation()
        setOpenRowMenuTaskId(null)
        setShowTaskMoreMenu(false)
        if (!confirm(t('basecamp.delete_todo_confirm'))) return
        setActionLoading(task.id)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'delete_recording',
                    projectId: project.id,
                    recordingId: task.bc_id,
                    recordingDbId: task.id,
                    tableName: 'bc_todos',
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            if (selectedTask?.id === task.id) {
                closeTaskDetail()
            }
            await fetchLists({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolTodos Delete] Error deleting todo:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(null)
        }
    }

    const handleDeleteListOrGroup = async (
        tableName: 'bc_todolists' | 'bc_todolist_groups',
        item: { id: string; bc_id: number }
    ) => {
        setOpenListMenuId(null)
        setOpenGroupMenuId(null)
        if (!confirm(t('basecamp.delete_todo_confirm'))) return
        setActionLoading(`del_${item.id}`)
        setMutationError(null)
        try {
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
            if (!res.ok) throw new Error(await res.text())
            if (tableName === 'bc_todolists' && selectedListId === item.id) {
                setSelectedListId(null)
            }
            await fetchLists({ silent: true })
        } catch (err: any) {
            console.error(`❌ [ToolTodos Delete ${tableName}] Error:`, err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(null)
        }
    }

    const handleCopyTaskLink = async (taskId: string, fromModal: boolean = false) => {
        if (typeof window === 'undefined') return
        const url = `${window.location.origin}/basecamp?project=${encodeURIComponent(String(project.id))}&tool=todos&todoId=${encodeURIComponent(taskId)}`
        try {
            await navigator.clipboard.writeText(url)
            if (fromModal) {
                setShowTaskMoreMenu(false)
                setLinkCopiedToast(true)
                setTimeout(() => setLinkCopiedToast(false), 2600)
            } else {
                setCopiedRowTaskId(taskId)
                setTimeout(() => {
                    setCopiedRowTaskId((prev) => (prev === taskId ? null : prev))
                    setOpenRowMenuTaskId((prev) => (prev === taskId ? null : prev))
                }, 900)
            }
        } catch {
            // Ignore clipboard errors in restricted environments
        }
    }

    const handleDownloadAllAttachments = (attachments: Array<{ url: string; href: string; filename: string }>) => {
        setShowTaskMoreMenu(false)
        attachments.forEach((att, idx) => {
            const href = sanitizeAttachmentHref(att.url || att.href)
            if (href === '#') return
            setTimeout(() => {
                triggerBasecampDownload(href, att.filename)
            }, idx * 220)
        })
    }

    // Comments: Create, Edit, Delete, Reply with Quote
    const handleAddComment = async (e?: React.FormEvent) => {
        if (e) e.preventDefault()
        if (!selectedTask || !hasRichContentOrMedia(newCommentHtml)) return
        setActionLoading('comment')
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_comment',
                    projectId: project.id,
                    recordingId: selectedTask.bc_id,
                    parentType: 'todo',
                    parentDbId: selectedTask.id,
                    content: newCommentHtml.trim(),
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            setNewCommentHtml('')
            setNewCommentIsEmpty(true)
            setCommentDraftInitialHtml('')
            setCommentEditorSeed((s) => s + 1)
            await fetchTaskComments(selectedTask.id, selectedTask.bc_id, {
                silent: true,
                skipLiveHydration: true,
            })
            fetchLists({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolTodos Comment] Error saving comment:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(null)
        }
    }

    const handleSaveEditedComment = async (comment: any) => {
        if (!selectedTask || !comment || !hasRichContentOrMedia(editingCommentHtml)) return
        setActionLoading(`edit_comment_${comment.id}`)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_comment',
                    projectId: project.id,
                    commentId: comment.bc_id,
                    commentDbId: comment.id,
                    content: editingCommentHtml.trim(),
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            setEditingCommentId(null)
            await fetchTaskComments(selectedTask.id, selectedTask.bc_id, {
                silent: true,
                skipLiveHydration: true,
            })
        } catch (err: any) {
            console.error('❌ [ToolTodos UpdateComment] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(null)
        }
    }

    const handleDeleteComment = async (comment: any) => {
        setOpenCommentMenuId(null)
        if (!selectedTask || !comment) return
        if (!confirm(t('basecamp.confirm_delete_comment'))) return
        setActionLoading(`del_comment_${comment.id}`)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'delete_recording',
                    projectId: project.id,
                    recordingId: comment.bc_id,
                    recordingDbId: comment.id,
                    tableName: 'bc_comments',
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            await fetchTaskComments(selectedTask.id, selectedTask.bc_id, {
                silent: true,
                skipLiveHydration: true,
            })
            fetchLists({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolTodos DeleteComment] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(null)
        }
    }

    const handleReplyToComment = (comment: any) => {
        const plainExcerpt = extractPlainQuoteText(comment.rawText || comment.text)
        const quoteBlock = `<blockquote style="border-left: 3px solid #94A3B8; padding-left: 12px; margin: 6px 0; color: #475569; font-style: italic;"><strong>${escapeHtmlText(comment.author)}:</strong> ${escapeHtmlText(plainExcerpt || '...')}</blockquote><p><br></p>`
        const existingDraft = newCommentIsEmpty ? '' : newCommentHtml
        const combined = existingDraft ? `${existingDraft}${quoteBlock}` : quoteBlock
        setCommentDraftInitialHtml(combined)
        setNewCommentHtml(combined)
        setNewCommentIsEmpty(false)
        setCommentEditorSeed((s) => s + 1)
        setTimeout(() => {
            setCommentFocusSeq((f) => f + 1)
            commentFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }, 50)
    }

    // Boosts: Create & Delete (To-Do or Comment)
    const handleCreateBoost = async (
        recordingType: 'todo' | 'comment',
        recordingDbId: string,
        recordingBcId: number | string | undefined,
        content: string
    ) => {
        const cleanContent = content.trim().slice(0, 16)
        if (!cleanContent || !recordingDbId) return
        setOpenBoostPopoverKey(null)
        setCustomBoostInput('')
        const loadKey = `boost_${recordingType}_${recordingDbId}`
        setActionLoading(loadKey)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_boost',
                    projectId: project.id,
                    recordingType,
                    recordingDbId,
                    recordingId: recordingBcId,
                    content: cleanContent,
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            const data = await res.json()
            if (data?.boost) {
                const norm = normalizeBoostRow(data.boost)
                if (recordingType === 'todo') {
                    setTaskBoosts((prev) => [...prev, norm])
                } else {
                    setCommentBoostsMap((prev) => ({
                        ...prev,
                        [recordingDbId]: [...(prev[recordingDbId] || []), norm],
                    }))
                }
            }
            fetchLists({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolTodos CreateBoost] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(null)
        }
    }

    const handleDeleteBoost = async (boost: any) => {
        if (!boost?.id) return
        setActionLoading(`del_boost_${boost.id}`)
        setMutationError(null)
        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'delete_boost',
                    projectId: project.id,
                    boostDbId: boost.id,
                    boostId: boost.bc_id,
                }),
            })
            if (!res.ok) throw new Error(await res.text())
            if (boost.recording_type === 'todo') {
                setTaskBoosts((prev) => prev.filter((b) => b.id !== boost.id))
            } else {
                setCommentBoostsMap((prev) => ({
                    ...prev,
                    [boost.recording_id]: (prev[boost.recording_id] || []).filter((b) => b.id !== boost.id),
                }))
            }
            fetchLists({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolTodos DeleteBoost] Error:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(null)
        }
    }

    const isOwnBoost = useCallback(
        (boost: any): boolean => {
            if (!boost) return false
            if (currentPersonOption?.id && boost.booster_person_id === currentPersonOption.id) return true
            if (
                isBasecampOAuthOwner(effectiveUserEmail, effectiveUserName) &&
                isBasecampOAuthOwner(null, boost.booster_name)
            ) {
                return true
            }
            const normCur = normalizePersonName(effectiveUserName)
            const normBooster = normalizePersonName(boost.booster_name)
            return Boolean(normCur && normBooster && normCur === normBooster)
        },
        [currentPersonOption?.id, effectiveUserEmail, effectiveUserName]
    )

    // Compute Email-Notified People (Subscribers) for the open To-Do modal
    const notifiedSubscribers = useMemo(() => {
        if (!selectedTask) return []
        const seenKeys = new Set<string>()
        const result: Array<{ id: string; name: string; avatar_url?: string }> = []

        const addSubscriber = (id?: string | null, name?: string | null, avatarUrl?: string | null) => {
            const resolvedPerson = id ? peopleObjByIdRef.current.get(String(id)) : null
            const finalName = (name || resolvedPerson?.name || '').trim()
            if (!finalName || finalName === t('basecamp.unknown_user')) return
            const dedupeKey = normalizePersonName(finalName) || String(id || finalName)
            if (seenKeys.has(dedupeKey)) return
            seenKeys.add(dedupeKey)
            result.push({
                id: String(id || dedupeKey),
                name: finalName,
                avatar_url: avatarUrl || resolvedPerson?.avatar_url || '',
            })
        }

        if (selectedTask.created_by_person_id || selectedTask.creator_name) {
            addSubscriber(selectedTask.created_by_person_id, selectedTask.creator_name)
        }
        for (const a of selectedTask.assigneeList || []) {
            addSubscriber(a.id, a.name, a.avatar_url)
        }
        for (const c of taskComments || []) {
            addSubscriber(c.author_person_id, c.author, c.author_avatar_url)
        }

        const combinedHtml = [
            selectedTask.description || '',
            ...(taskComments || []).map((c: any) => c.rawText || c.text || ''),
        ].join(' ')
        if (combinedHtml.trim()) {
            const refs = extractMentionedPeopleRefs(combinedHtml)
            for (const uid of refs.personUuids) {
                const p = peopleObjByIdRef.current.get(uid)
                if (p) addSubscriber(p.id, p.name, p.avatar_url)
            }
            if (refs.bcPersonIds.length > 0 || refs.sgids.length > 0) {
                const bcSet = new Set(refs.bcPersonIds)
                const sgidSet = new Set(refs.sgids)
                for (const p of allPeopleState) {
                    if ((p.bc_id && bcSet.has(Number(p.bc_id))) || (p.attachable_sgid && sgidSet.has(p.attachable_sgid))) {
                        addSubscriber(p.id, p.name, p.avatar_url)
                    }
                }
            }
        }

        return result
    }, [selectedTask, taskComments, allPeopleState, t])

    // =========================================================================
    // SHARED RENDER HELPERS (Avatars, Assignee Picker, Date Radios, Boosts, Rows)
    // =========================================================================

    const filterPeopleSuggestions = useCallback(
        (rawQuery: string, selectedList: any[]) => {
            const q = normalizeSearch(rawQuery)
            const personQ = normalizePersonName(rawQuery)
            const available = editorPeople.filter((p) => {
                if (selectedList.some((a) => a.id === p.id)) return false
                if (!q) return true
                return (
                    normalizeSearch(p.name).includes(q) ||
                    (personQ ? normalizePersonName(p.name).includes(personQ) : false) ||
                    normalizeSearch(p.title).includes(q) ||
                    normalizeSearch(p.email).includes(q)
                )
            })
            if (!q) return available
            const startsWithQ = available.filter((p) => normalizeSearch(p.name).startsWith(q))
            const containsQ = available.filter((p) => !normalizeSearch(p.name).startsWith(q))
            return [...startsWithQ, ...containsQ]
        },
        [editorPeople]
    )

    const sortOpenTasks = useCallback(
        (tasks: any[]) => {
            return [...tasks].sort((a, b) => {
                if (sortOrder === 'position') {
                    const posA = a.position != null ? Number(a.position) : 999999
                    const posB = b.position != null ? Number(b.position) : 999999
                    if (posA !== posB) return posA - posB
                    const tA = a.created_at ? new Date(a.created_at).getTime() : 0
                    const tB = b.created_at ? new Date(b.created_at).getTime() : 0
                    return tA - tB
                }
                const timeA = a.created_at ? new Date(a.created_at).getTime() : 0
                const timeB = b.created_at ? new Date(b.created_at).getTime() : 0
                return sortOrder === 'newest' ? timeB - timeA : timeA - timeB
            })
        },
        [sortOrder]
    )

    const sortCompletedTasks = useCallback((tasks: any[]) => {
        return [...tasks].sort((a, b) => {
            const timeA = new Date(a.completed_at || a.created_at || 0).getTime()
            const timeB = new Date(b.completed_at || b.created_at || 0).getTime()
            return timeB - timeA
        })
    }, [])

    const renderPersonAvatar = (name: string, avatarUrl?: string | null, size: number = 20) => {
        const proxied = avatarUrl ? proxyBasecampUrl(avatarUrl) : ''
        if (proxied) {
            return (
                <img
                    src={proxied}
                    alt={name}
                    data-bc-avatar="true"
                    style={{
                        width: size,
                        height: size,
                        borderRadius: '50%',
                        objectFit: 'cover',
                        flexShrink: 0,
                    }}
                    onError={(e) => {
                        ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                    }}
                />
            )
        }
        return (
            <span
                style={{
                    width: size,
                    height: size,
                    borderRadius: '50%',
                    background: getAvatarColor(name || 'U'),
                    color: '#fff',
                    fontSize: Math.max(8, Math.round(size * 0.44)),
                    fontWeight: 800,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                }}
            >
                {getInitials(name || 'U')}
            </span>
        )
    }

    const renderColorSwatchSelector = (selectedColor: string, onSelect: (val: string) => void) => (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            {BASECAMP_COLOR_SWATCHES.map((sw) => {
                const active = (selectedColor || 'blue').toLowerCase() === sw.value
                return (
                    <button
                        key={sw.value}
                        type="button"
                        onClick={() => onSelect(sw.value)}
                        title={t(sw.i18nKey)}
                        style={{
                            width: 26,
                            height: 26,
                            borderRadius: '50%',
                            background: sw.hex,
                            border: active ? '3px solid #0F172A' : '2px solid #E2E8F0',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: active ? '0 0 0 2px #fff inset' : 'none',
                            transition: 'transform 0.12s',
                        }}
                    >
                        {active && <Check size={12} color="#fff" strokeWidth={3} />}
                    </button>
                )
            })}
        </div>
    )

    const renderAssigneePicker = (opts: {
        boxRef: React.RefObject<HTMLDivElement | null>
        inputRef?: React.RefObject<HTMLInputElement | null>
        selected: any[]
        setSelected: React.Dispatch<React.SetStateAction<any[]>>
        query: string
        setQuery: (v: string) => void
        showMenu: boolean
        setShowMenu: (v: boolean) => void
        highlightedIdx: number
        setHighlightedIdx: React.Dispatch<React.SetStateAction<number>>
    }) => {
        const suggestions = filterPeopleSuggestions(opts.query, opts.selected)
        const canAssignToMe =
            Boolean(currentPersonOption) &&
            !opts.selected.some((p) => isCurrentUserAssigned(p))

        return (
            <div
                ref={opts.boxRef}
                className={`${opts.showMenu ? 'relative z-40' : 'relative z-10'} flex-1 min-w-0 max-w-[580px]`}
            >
                <div className="flex items-center flex-wrap gap-2 min-w-0">
                    <div className="flex-1 min-w-[180px] flex items-center flex-wrap gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 min-h-[38px] focus-within:border-[#1D7DB5] focus-within:ring-2 focus-within:ring-[#1D7DB5]/15 transition-all">
                        {opts.selected.map((person) => (
                            <span
                                key={person.id}
                                className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap"
                            >
                                {renderPersonAvatar(person.name || 'U', person.avatar_url || person.avatar, 18)}
                                <span>{person.name}</span>
                                <button
                                    type="button"
                                    onClick={() =>
                                        opts.setSelected((prev) => prev.filter((p) => p.id !== person.id))
                                    }
                                    className="text-[11px] text-rose-500 hover:text-rose-700 dark:text-rose-400 px-0.5 font-bold cursor-pointer"
                                >
                                    ✕
                                </button>
                            </span>
                        ))}
                        <input
                            ref={opts.inputRef}
                            type="text"
                            placeholder={opts.selected.length === 0 ? t('basecamp.type_names_placeholder') : ''}
                            value={opts.query}
                            onChange={(e) => {
                                opts.setQuery(e.target.value)
                                opts.setShowMenu(true)
                                opts.setHighlightedIdx(0)
                            }}
                            onFocus={() => {
                                setShowTaskMoreMenu(false)
                                opts.setShowMenu(true)
                            }}
                            onKeyDown={(e) => {
                                if (!opts.showMenu || suggestions.length === 0) return
                                if (e.key === 'ArrowDown') {
                                    e.preventDefault()
                                    opts.setHighlightedIdx((prev) => Math.min(prev + 1, suggestions.length - 1))
                                } else if (e.key === 'ArrowUp') {
                                    e.preventDefault()
                                    opts.setHighlightedIdx((prev) => Math.max(prev - 1, 0))
                                } else if (e.key === 'Enter') {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    const picked = suggestions[opts.highlightedIdx]
                                    if (picked) {
                                        opts.setSelected((prev) => [...prev, picked])
                                        opts.setQuery('')
                                        opts.setShowMenu(false)
                                        opts.setHighlightedIdx(0)
                                    }
                                } else if (e.key === 'Escape') {
                                    e.preventDefault()
                                    opts.setShowMenu(false)
                                }
                            }}
                            className="flex-1 min-w-[110px] border-none outline-none text-[13px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 bg-transparent"
                        />
                    </div>

                    {canAssignToMe && (
                        <button
                            type="button"
                            onClick={() => {
                                if (!currentPersonOption) return
                                opts.setSelected((prev) =>
                                    prev.some((p) => isCurrentUserAssigned(p))
                                        ? prev
                                        : [...prev, currentPersonOption]
                                )
                            }}
                            className="px-3 py-1.5 rounded-full border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 hover:bg-sky-100 dark:hover:bg-sky-900/60 text-[#0369A1] dark:text-sky-300 text-xs font-bold whitespace-nowrap cursor-pointer transition-colors"
                        >
                            + {t('basecamp.assign_to_me')}
                        </button>
                    )}
                </div>

                {opts.showMenu && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-[70] max-h-[210px] overflow-y-auto py-1">
                        {suggestions.length > 0 ? (
                            suggestions.map((person, idx) => (
                                <div
                                    key={person.id}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                        opts.setSelected((prev) => [...prev, person])
                                        opts.setQuery('')
                                        opts.setShowMenu(false)
                                        opts.setHighlightedIdx(0)
                                    }}
                                    onMouseEnter={() => opts.setHighlightedIdx(idx)}
                                    className={`px-3 py-2 cursor-pointer text-[13px] flex items-center justify-between gap-2 transition-colors ${
                                        idx === opts.highlightedIdx
                                            ? 'bg-[#1D7DB5] text-white'
                                            : 'text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                                    }`}
                                >
                                    <span className="inline-flex items-center gap-2 min-w-0">
                                        {renderPersonAvatar(person.name || 'U', person.avatar_url || person.avatar, 20)}
                                        <span className={`truncate ${idx === opts.highlightedIdx ? 'font-semibold' : 'font-medium'}`}>
                                            {person.name}
                                        </span>
                                    </span>
                                    {person.title && (
                                        <span
                                            className={`text-[11px] truncate max-w-[140px] shrink-0 ${
                                                idx === opts.highlightedIdx ? 'text-sky-100' : 'text-slate-400'
                                            }`}
                                        >
                                            {person.title}
                                        </span>
                                    )}
                                </div>
                            ))
                        ) : (
                            <div className="px-3 py-2 text-[13px] text-slate-400 italic">
                                {t('basecamp.no_people_found')}
                            </div>
                        )}
                    </div>
                )}
            </div>
        )
    }

    const renderBasecampDateRadioSelector = (opts: {
        radioName: string
        mode: DateMode
        setMode: (m: DateMode) => void
        startsOn: string
        setStartsOn: (v: string) => void
        dueDate: string
        setDueDate: (v: string) => void
        sectionRef?: React.RefObject<HTMLDivElement | null>
    }) => (
        <div ref={opts.sectionRef} className="flex flex-col gap-2 flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-3.5">
                {(['none', 'single', 'range'] as DateMode[]).map((m) => {
                    const labelKey =
                        m === 'none'
                            ? 'basecamp.date_none'
                            : m === 'single'
                            ? 'basecamp.date_single'
                            : 'basecamp.date_range'
                    return (
                        <label
                            key={m}
                            className={`inline-flex items-center gap-1.5 text-[13px] cursor-pointer ${
                                opts.mode === m
                                    ? 'font-bold text-slate-900 dark:text-white'
                                    : 'font-medium text-slate-600 dark:text-slate-400'
                            }`}
                        >
                            <input
                                type="radio"
                                name={opts.radioName}
                                checked={opts.mode === m}
                                onChange={() => opts.setMode(m)}
                                className="accent-[#1D7DB5] cursor-pointer"
                            />
                            <span>{t(labelKey)}</span>
                        </label>
                    )
                })}
            </div>

            {opts.mode === 'single' && (
                <div className="inline-flex items-center gap-2 flex-wrap">
                    <input
                        type="date"
                        value={opts.dueDate}
                        onChange={(e) => opts.setDueDate(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-[13px] outline-none bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:border-[#1D7DB5]"
                    />
                    {opts.dueDate && (
                        <button
                            type="button"
                            onClick={() => {
                                opts.setDueDate('')
                                opts.setMode('none')
                            }}
                            title={t('basecamp.clear_due_date')}
                            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-bold cursor-pointer px-1"
                        >
                            ✕
                        </button>
                    )}
                </div>
            )}

            {opts.mode === 'range' && (
                <div className="inline-flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
                        {t('basecamp.runs_from')}
                    </span>
                    <input
                        type="date"
                        value={opts.startsOn}
                        onChange={(e) => {
                            const val = e.target.value
                            opts.setStartsOn(val)
                            if (val && opts.dueDate && val > opts.dueDate) {
                                opts.setDueDate(val)
                            }
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-[13px] outline-none bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:border-[#1D7DB5]"
                    />
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
                        {t('basecamp.runs_to')}
                    </span>
                    <input
                        type="date"
                        value={opts.dueDate}
                        onChange={(e) => opts.setDueDate(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-[13px] outline-none bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:border-[#1D7DB5]"
                    />
                </div>
            )}
        </div>
    )

    const renderBoostBar = (
        recordingType: 'todo' | 'comment',
        recordingDbId: string,
        recordingBcId: number | string | undefined,
        boosts: any[],
        popoverKey: string
    ) => {
        const isPopoverOpen = openBoostPopoverKey === popoverKey
        const isBusy = actionLoading === `boost_${recordingType}_${recordingDbId}`

        return (
            <div
                data-bc-boost-popover="true"
                className={isPopoverOpen ? 'relative z-40' : 'relative z-10'}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 6,
                    position: 'relative',
                    zIndex: isPopoverOpen ? 40 : 10,
                    marginTop: 6,
                }}
            >
                {boosts.map((b) => {
                    const mine = isOwnBoost(b)
                    const deletingThis = actionLoading === `del_boost_${b.id}`
                    return (
                        <button
                            key={b.id}
                            type="button"
                            disabled={!mine || deletingThis}
                            onClick={() => {
                                if (mine) handleDeleteBoost(b)
                            }}
                            title={
                                mine
                                    ? `${b.booster_name}: ${b.content} — ${t('basecamp.remove_boost')}`
                                    : `${b.booster_name}: ${b.content}`
                            }
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 5,
                                padding: '3px 9px 3px 5px',
                                borderRadius: 999,
                                background: mine ? '#EFF6FF' : '#F8FAFC',
                                border: mine ? '1px solid #93C5FD' : '1px solid #E2E8F0',
                                fontSize: 12,
                                fontWeight: 600,
                                color: '#1E293B',
                                cursor: mine ? 'pointer' : 'default',
                                opacity: deletingThis ? 0.5 : 1,
                                transition: 'all 0.12s',
                            }}
                        >
                            {renderPersonAvatar(b.booster_name || 'U', b.booster_avatar_url, 16)}
                            <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>
                                {getShortName(b.booster_name || '')}
                            </span>
                            <span>{b.content}</span>
                            {mine && <span style={{ fontSize: 10, color: '#94A3B8', marginLeft: 1 }}>✕</span>}
                        </button>
                    )
                })}

                <div style={{ position: 'relative', display: 'inline-flex' }}>
                    <button
                        type="button"
                        disabled={isBusy}
                        onClick={(ev) => {
                            const btnEl = ev.currentTarget as HTMLElement
                            const btnRect = btnEl.getBoundingClientRect()
                            const scrollContainer = btnEl.closest('.overflow-y-auto, .overflow-hidden') as HTMLElement | null
                            const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
                            const topLimit = scrollContainer ? Math.max(0, scrollContainer.getBoundingClientRect().top) : 0
                            const leftLimit = scrollContainer ? Math.max(0, scrollContainer.getBoundingClientRect().left) : 0
                            const rightLimit = scrollContainer ? Math.min(vw, scrollContainer.getBoundingClientRect().right) : vw
                            setBoostPopoverDown(btnRect.top - topLimit < 175)
                            const menuW = Math.min(255, Math.max(190, rightLimit - leftLimit - 24))
                            let offsetX = 0
                            if (btnRect.left + menuW > rightLimit - 12) {
                                offsetX = rightLimit - 12 - (btnRect.left + menuW)
                            }
                            if (btnRect.left + offsetX < leftLimit + 12) {
                                offsetX = leftLimit + 12 - btnRect.left
                            }
                            setBoostPopoverOffsetX(Math.round(offsetX))
                            setCustomBoostInput('')
                            setShowTaskMoreMenu(false)
                            setOpenCommentMenuId(null)
                            setOpenBoostPopoverKey((prev) => (prev === popoverKey ? null : popoverKey))
                        }}
                        title={t('basecamp.boost_btn')}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '3px 9px',
                            borderRadius: 999,
                            border: '1px dashed #CBD5E1',
                            background: isPopoverOpen ? '#F0F9FF' : '#fff',
                            color: '#475569',
                            fontSize: 11.5,
                            fontWeight: 700,
                            cursor: 'pointer',
                        }}
                    >
                        {isBusy ? (
                            <Loader2 size={12} className="animate-spin text-[#1D7DB5]" />
                        ) : (
                            <Rocket size={12} style={{ color: '#1D7DB5' }} />
                        )}
                        <span>{t('basecamp.boost_btn')}</span>
                    </button>

                    {isPopoverOpen && (
                        <div
                            className="bg-white border border-slate-300"
                            style={{
                                position: 'absolute',
                                ...(boostPopoverDown
                                    ? { top: '100%', marginTop: 6 }
                                    : { bottom: '100%', marginBottom: 6 }),
                                left: boostPopoverOffsetX,
                                zIndex: 85,
                                background: '#ffffff',
                                borderRadius: 12,
                                padding: 10,
                                boxShadow: '0 16px 34px rgba(15,23,42,0.2)',
                                width: 255,
                                maxWidth: 'calc(100vw - 24px)',
                            }}
                        >
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                                {QUICK_BOOST_PRESETS.map((preset) => (
                                    <button
                                        key={preset}
                                        type="button"
                                        onClick={() =>
                                            handleCreateBoost(recordingType, recordingDbId, recordingBcId, preset)
                                        }
                                        style={{
                                            padding: '4px 9px',
                                            borderRadius: 999,
                                            border: '1px solid #E2E8F0',
                                            background: '#F8FAFC',
                                            fontSize: 12.5,
                                            fontWeight: 700,
                                            color: '#1E293B',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        {preset}
                                    </button>
                                ))}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <input
                                    type="text"
                                    maxLength={16}
                                    value={customBoostInput}
                                    onChange={(e) => setCustomBoostInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            if (customBoostInput.trim()) {
                                                handleCreateBoost(
                                                    recordingType,
                                                    recordingDbId,
                                                    recordingBcId,
                                                    customBoostInput
                                                )
                                            }
                                        }
                                    }}
                                    placeholder={t('basecamp.add_boost_placeholder')}
                                    style={{
                                        flex: 1,
                                        padding: '5px 8px',
                                        borderRadius: 7,
                                        border: '1px solid #CBD5E1',
                                        fontSize: 12,
                                        outline: 'none',
                                        color: '#1E293B',
                                    }}
                                />
                                <button
                                    type="button"
                                    disabled={!customBoostInput.trim()}
                                    onClick={() =>
                                        handleCreateBoost(
                                            recordingType,
                                            recordingDbId,
                                            recordingBcId,
                                            customBoostInput
                                        )
                                    }
                                    style={{
                                        padding: '5px 10px',
                                        borderRadius: 7,
                                        border: 'none',
                                        background: '#1D7DB5',
                                        color: '#fff',
                                        fontSize: 12,
                                        fontWeight: 700,
                                        cursor: customBoostInput.trim() ? 'pointer' : 'not-allowed',
                                        opacity: customBoostInput.trim() ? 1 : 0.5,
                                    }}
                                >
                                    🚀
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )
    }

    const renderInlineAddTaskForm = (list: any, groupId: string | null) => {
        const loadKey = `add_task_${list.id}_${groupId || 'root'}`
        const isReplicatingHere = Boolean(replicatingBanner && replicatingBanner.listId === list.id)
        return (
            <form
                ref={addTaskFormRef}
                onSubmit={(e) => handleAddTask(list.id, list.bc_id, groupId, e)}
                className="p-3.5 sm:p-4 rounded-2xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/90 dark:border-slate-700/80 min-w-0"
            >
                {isReplicatingHere && replicatingBanner && (
                    <div className="flex items-start justify-between gap-2.5 px-3.5 py-2.5 mb-3 rounded-xl bg-gradient-to-r from-sky-50 to-emerald-50 dark:from-sky-950/50 dark:to-emerald-950/40 border border-sky-200 dark:border-sky-800/80 text-xs leading-relaxed">
                        <div className="min-w-0">
                            <strong className="text-[#0369A1] dark:text-sky-300 font-bold">
                                📋 {t('basecamp.replicating_in_list')} {replicatingBanner.listName}
                            </strong>{' '}
                            <span className="text-slate-600 dark:text-slate-300 font-medium">
                                — {t('basecamp.replicating_hint')}
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setReplicatingBanner(null)}
                            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xs font-bold shrink-0 cursor-pointer px-1"
                            title={t('basecamp.cancel')}
                        >
                            ✕
                        </button>
                    </div>
                )}
                <div className="flex items-center gap-3 pb-3 border-b border-slate-200 dark:border-slate-700">
                    <span className="w-5 h-5 border-2 border-slate-300 dark:border-slate-600 rounded-md shrink-0 bg-white dark:bg-slate-900" />
                    <input
                        type="text"
                        required
                        autoFocus={!isReplicatingHere}
                        value={newTaskName}
                        onChange={(e) => setNewTaskName(e.target.value)}
                        placeholder={t('basecamp.describe_todo')}
                        className="flex-1 min-w-0 py-0.5 text-[15px] font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 bg-transparent outline-none"
                    />
                </div>

                {/* Basecamp Fields: Assigned to, Due on (3 radios), Notes (BasecampRichEditor + @mentions), Subtasks — NO When done */}
                <div className="flex flex-col gap-3.5 mt-3.5 pt-0.5 pb-1 pl-0 sm:pl-7 min-w-0">
                    <div className="relative z-30 flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-0 min-w-0">
                        <label className="w-auto sm:w-[112px] text-left sm:text-right mr-0 sm:mr-4 shrink-0 font-semibold text-[12.5px] text-slate-600 dark:text-slate-400 sm:pt-2">
                            {t('basecamp.assigned_to')}
                        </label>
                        {renderAssigneePicker({
                            boxRef: assigneeBoxRef,
                            inputRef: newAssigneeInputRef,
                            selected: newTaskAssignees,
                            setSelected: setNewTaskAssignees,
                            query: assigneeSearchQuery,
                            setQuery: setAssigneeSearchQuery,
                            showMenu: showAssigneeSuggestions,
                            setShowMenu: setShowAssigneeSuggestions,
                            highlightedIdx: highlightedAssigneeIdx,
                            setHighlightedIdx: setHighlightedAssigneeIdx,
                        })}
                    </div>

                    <div className="relative z-20 flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-0 min-w-0">
                        <label className="w-auto sm:w-[112px] text-left sm:text-right mr-0 sm:mr-4 shrink-0 font-semibold text-[12.5px] text-slate-600 dark:text-slate-400 sm:pt-0.5">
                            {t('basecamp.due_on')}
                        </label>
                        {renderBasecampDateRadioSelector({
                            radioName: `new_todo_date_${list.id}_${groupId || 'root'}`,
                            mode: newTaskDateMode,
                            setMode: setNewTaskDateMode,
                            startsOn: newTaskStartsOn,
                            setStartsOn: setNewTaskStartsOn,
                            dueDate: newTaskDueDate,
                            setDueDate: setNewTaskDueDate,
                        })}
                    </div>

                    <div className="relative z-10 flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-0 min-w-0">
                        <label className="w-auto sm:w-[112px] text-left sm:text-right mr-0 sm:mr-4 shrink-0 font-semibold text-[12.5px] text-slate-600 dark:text-slate-400 sm:pt-2">
                            {t('basecamp.notes_short_label')}
                        </label>
                        <div className="w-full min-w-0 max-w-[680px]">
                            <BasecampRichEditor
                                editorKey={`new-todo-${list.id}-${groupId || 'root'}-${newTaskEditorSeed}`}
                                initialHtml={newTaskInitialHtml}
                                people={editorPeople}
                                placeholder={`${t('basecamp.notes_placeholder')} · ${t('basecamp.mention_hint')}`}
                                uploadFolder={String(project.db_id || 'todos')}
                                minHeight={128}
                                maxHeight={340}
                                onChangeHtml={(html, empty) => {
                                    setNewTaskNotes(html)
                                    setNotesIsEmpty(empty)
                                }}
                            />
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-0 min-w-0">
                        <label className="w-auto sm:w-[112px] text-left sm:text-right mr-0 sm:mr-4 shrink-0 font-semibold text-[12.5px] text-slate-600 dark:text-slate-400 sm:pt-1">
                            {t('basecamp.subtasks_label')}
                        </label>
                        <div className="flex-1 min-w-0 max-w-[540px]">
                            {!showSubtasksInput ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowSubtasksInput(true)
                                        if (newTaskSubtasks.length === 0) setNewTaskSubtasks([''])
                                    }}
                                    className="py-1 text-[13px] text-slate-500 dark:text-slate-400 hover:text-[#1D7DB5] dark:hover:text-sky-400 cursor-pointer text-left transition-colors"
                                >
                                    {t('basecamp.add_subtasks_placeholder')}
                                </button>
                            ) : (
                                <div className="flex flex-col gap-1.5">
                                    {newTaskSubtasks.map((st, stIdx) => (
                                        <div key={stIdx} className="flex items-center gap-2">
                                            <span className="w-3.5 h-3.5 rounded-[4px] border-[1.5px] border-slate-300 dark:border-slate-600 shrink-0 bg-white dark:bg-slate-900" />
                                            <input
                                                type="text"
                                                value={st}
                                                onChange={(e) => {
                                                    const val = e.target.value
                                                    setNewTaskSubtasks((prev) =>
                                                        prev.map((item, idx) => (idx === stIdx ? val : item))
                                                    )
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault()
                                                        e.stopPropagation()
                                                        setNewTaskSubtasks((prev) => [
                                                            ...prev.slice(0, stIdx + 1),
                                                            '',
                                                            ...prev.slice(stIdx + 1),
                                                        ])
                                                    }
                                                }}
                                                placeholder={t('basecamp.add_subtask_item_placeholder')}
                                                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-[13px] text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 outline-none focus:border-[#1D7DB5]"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (newTaskSubtasks.length <= 1) {
                                                        setNewTaskSubtasks([''])
                                                        setShowSubtasksInput(false)
                                                    } else {
                                                        setNewTaskSubtasks((prev) =>
                                                            prev.filter((_, idx) => idx !== stIdx)
                                                        )
                                                    }
                                                }}
                                                className="text-slate-400 hover:text-rose-500 cursor-pointer text-xs font-bold px-1"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                    <div>
                                        <button
                                            type="button"
                                            onClick={() => setNewTaskSubtasks((prev) => [...prev, ''])}
                                            className="text-[#1D7DB5] dark:text-sky-400 hover:underline text-xs font-semibold cursor-pointer py-0.5"
                                        >
                                            {t('basecamp.add_another_subtask')}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2.5 mt-4 pt-1 pl-0 sm:pl-[156px]">
                    <button
                        type="submit"
                        disabled={loading || actionLoading === loadKey}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-[13px] font-bold shadow-2xs transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {actionLoading === loadKey && <Loader2 size={14} className="animate-spin" />}
                        {t('basecamp.add_todo_btn_label')}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setAddingTaskId(null)
                            setAddingTaskGroupId(null)
                            resetAddTaskForm()
                        }}
                        className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs sm:text-[13px] font-semibold transition-colors cursor-pointer"
                    >
                        {t('basecamp.cancel')}
                    </button>
                </div>
            </form>
        )
    }

    const renderActiveTaskRow = (list: any, task: any) => {
        const hasComments = task.comments_count > 0 || (task.comments && task.comments.length > 0)
        const commentCount = task.comments_count || (task.comments ? task.comments.length : 0)
        const dateBadgeText = formatTaskDateRangeBadge(task.starts_on, task.due_date)
        const { textSnippet, attachmentNames } = extractTaskRowSnippet(task.description)
        const isRowMenuOpen = openRowMenuTaskId === task.id
        const isSearching = Boolean(todoFilterQuery.trim())
        const hasMetadataRow = Boolean(
            (task.assigneeList && task.assigneeList.length > 0) ||
                dateBadgeText ||
                task.created_at ||
                hasComments ||
                task.boosts_count > 0 ||
                attachmentNames.length > 0
        )

        return (
            <div
                key={task.id}
                className={`group relative ${isRowMenuOpen ? 'z-40' : 'z-0'} flex items-start gap-2.5 sm:gap-3 px-2.5 sm:px-4 py-3 rounded-xl hover:bg-slate-50/90 dark:hover:bg-slate-800/50 transition-colors min-w-0`}
            >
                {/* Left: Crisp 20x20 Checkbox */}
                <button
                    type="button"
                    onClick={() => handleToggleTask(list.id, task)}
                    disabled={actionLoading === task.id}
                    className="w-5 h-5 mt-0.5 shrink-0 rounded-md border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:border-emerald-500 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/30 flex items-center justify-center cursor-pointer transition-colors"
                    title={t('basecamp.mark_as_done')}
                >
                    {actionLoading === task.id ? <Loader2 size={12} className="animate-spin text-slate-400" /> : null}
                </button>

                {/* Center: 100% Free-Width Title + Optional Note Snippet + Compact Metadata Chips */}
                <div
                    onClick={() => {
                        setSelectedTask(task)
                        setSelectedTaskListId(list.id)
                    }}
                    className="min-w-0 flex-1 cursor-pointer"
                >
                    {/* Line 1: Clean, Uncrushed Title */}
                    <div className="text-[14.5px] sm:text-[15px] font-semibold leading-snug text-slate-900 dark:text-slate-100 break-words">
                        {task.task_name}
                    </div>

                    {/* Line 2: 1-line Note Snippet (click opens quick-edit on notes) */}
                    {textSnippet && (
                        <p
                            onClick={(e) => {
                                e.stopPropagation()
                                openRowTaskDetailWithAction(list.id, task, 'edit', 'notes')
                            }}
                            title={t('basecamp.edit_todo')}
                            className="line-clamp-1 text-[12.5px] sm:text-[13px] text-slate-500 dark:text-slate-400 mt-0.5 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                        >
                            {textSnippet}
                        </p>
                    )}

                    {/* Line 3: Compact Assignees (whitespace-nowrap), Date, Creator, Comments, Boosts & Attachments */}
                    {hasMetadataRow && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            {task.assigneeList &&
                                task.assigneeList.length > 0 &&
                                task.assigneeList.map((a: any, aIdx: number) => (
                                    <span
                                        key={a.id || aIdx}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            openRowTaskDetailWithAction(list.id, task, 'edit', 'assignees')
                                        }}
                                        title={`${a.name} — ${t('basecamp.edit_todo')}`}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/70 dark:border-slate-700/80 whitespace-nowrap hover:border-[#1D7DB5]/60 transition-colors"
                                    >
                                        {renderPersonAvatar(a.name || 'U', a.avatar_url, 16)}
                                        <span>{getShortName(a.name || '')}</span>
                                    </span>
                                ))}

                            {dateBadgeText && (
                                <span
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        openRowTaskDetailWithAction(list.id, task, 'edit', 'dates')
                                    }}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/50 border border-amber-200/80 dark:border-amber-800/70 text-amber-800 dark:text-amber-300 text-[11px] font-semibold whitespace-nowrap"
                                >
                                    <Calendar size={11} className="shrink-0" />
                                    <span>{dateBadgeText}</span>
                                </span>
                            )}

                            {task.created_at && (
                                <span
                                    title={`${t('basecamp.created_at_label')}: ${formatCreatedDateTime(task.created_at)}${
                                        task.creator_name ? ` — ${t('basecamp.added_by')} ${task.creator_name}` : ''
                                    }`}
                                    className="inline-flex items-center gap-1 text-[11.5px] text-slate-400 dark:text-slate-500 font-medium whitespace-nowrap"
                                >
                                    <Clock size={10.5} className="shrink-0 opacity-80" />
                                    <span>{formatCreatedDateTime(task.created_at)}</span>
                                    {task.creator_name && (
                                        <span className="text-slate-500 dark:text-slate-400 font-semibold">
                                            · {getShortName(task.creator_name)}
                                        </span>
                                    )}
                                </span>
                            )}

                            {hasComments && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-sky-50 dark:bg-sky-950/40 text-[#1D7DB5] dark:text-sky-400 text-[11px] font-bold whitespace-nowrap">
                                    <MessageSquare size={11} className="shrink-0" />
                                    <span>{commentCount}</span>
                                </span>
                            )}

                            {task.boosts_count > 0 && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold whitespace-nowrap">
                                    🚀 {task.boosts_count}
                                </span>
                            )}

                            {attachmentNames.map((fn, fIdx) => (
                                <span
                                    key={fIdx}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        openRowTaskDetailWithAction(list.id, task, 'edit', 'notes')
                                    }}
                                    title={fn}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 text-[11px] font-medium text-slate-600 dark:text-slate-300 max-w-[130px]"
                                >
                                    <Paperclip size={10} className="text-[#1D7DB5] shrink-0" />
                                    <span className="truncate">{fn}</span>
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Right: Adaptive Replicate (Search = 1-click icon/text; Normal = Desktop hover-only) + ••• Menu */}
                <div data-bc-row-menu="true" className="relative shrink-0 flex items-center gap-1">
                    {isSearching ? (
                        <button
                            type="button"
                            disabled={replicatingTaskId === task.id}
                            onClick={(e) => {
                                e.stopPropagation()
                                void handleReplicateTask(task)
                            }}
                            title={t('basecamp.replicate_task')}
                            className="inline-flex items-center justify-center gap-1.5 w-8 h-8 sm:w-auto sm:h-auto sm:px-2.5 sm:py-1 rounded-lg bg-[#1D7DB5] hover:bg-[#155D8A] text-white text-xs font-bold shadow-2xs transition-colors cursor-pointer shrink-0 disabled:opacity-60"
                        >
                            {replicatingTaskId === task.id ? (
                                <Loader2 size={13} className="animate-spin" />
                            ) : (
                                <span className="text-[13px] leading-none">📋</span>
                            )}
                            <span className="hidden sm:inline">{t('basecamp.replicate_task')}</span>
                        </button>
                    ) : (
                        <button
                            type="button"
                            disabled={replicatingTaskId === task.id}
                            onClick={(e) => {
                                e.stopPropagation()
                                void handleReplicateTask(task)
                            }}
                            title={t('basecamp.replicate_task_tooltip')}
                            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-sky-200/90 dark:border-sky-800/80 bg-sky-50/90 dark:bg-sky-950/40 hover:bg-[#1D7DB5] hover:border-[#1D7DB5] hover:text-white text-[#0369A1] dark:text-sky-300 text-xs font-semibold opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 transition-all cursor-pointer shrink-0 disabled:opacity-60"
                        >
                            {replicatingTaskId === task.id ? (
                                <Loader2 size={12} className="animate-spin" />
                            ) : (
                                <span className="text-[12px] leading-none">📋</span>
                            )}
                            <span>{t('basecamp.replicate_task')}</span>
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation()
                            const btnRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                            const vh = typeof window !== 'undefined' ? window.innerHeight : 800
                            setRowMenuUp(vh - btnRect.bottom < 230)
                            setOpenListMenuId(null)
                            setOpenGroupMenuId(null)
                            setShowViewAsMenu(false)
                            setShowSortMenu(false)
                            setOpenRowMenuTaskId((prev) => (prev === task.id ? null : task.id))
                        }}
                        title={t('basecamp.more_actions')}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                            isRowMenuOpen
                                ? 'bg-slate-200/80 dark:bg-slate-700 text-slate-900 dark:text-white'
                                : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        {actionLoading === `bubble_${task.id}` ? (
                            <Loader2 size={14} className="animate-spin text-[#1D7DB5]" />
                        ) : (
                            <MoreHorizontal size={16} />
                        )}
                    </button>

                    {isRowMenuOpen && (
                        <div
                            onClick={(e) => e.stopPropagation()}
                            className={`absolute right-0 ${
                                rowMenuUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
                            } min-w-[220px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-1.5 z-[80]`}
                        >
                            <button
                                type="button"
                                onClick={() => void handleReplicateTask(task)}
                                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] font-bold text-[#0369A1] dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/40 cursor-pointer text-left transition-colors"
                            >
                                <span>📋</span>
                                <span>{t('basecamp.replicate_task')}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => openRowTaskDetailWithAction(list.id, task, 'edit', 'title')}
                                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-left transition-colors"
                            >
                                <Pencil size={13} className="text-slate-500 dark:text-slate-400" />
                                <span>{t('basecamp.edit_todo')}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => handleBubbleUpTask(list.id, task)}
                                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-left transition-colors"
                            >
                                <ArrowUp size={13} className="text-[#1D7DB5]" />
                                <span>{t('basecamp.bubble_up')}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => openRowTaskDetailWithAction(list.id, task, 'move')}
                                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-left transition-colors"
                            >
                                <FolderOpen size={13} className="text-amber-600" />
                                <span>{t('basecamp.move_todo')}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => handleCopyTaskLink(task.id, false)}
                                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-left transition-colors ${
                                    copiedRowTaskId === task.id
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : 'text-slate-800 dark:text-slate-200'
                                }`}
                            >
                                <Copy size={13} />
                                <span>
                                    {copiedRowTaskId === task.id
                                        ? t('basecamp.link_copied')
                                        : t('basecamp.copy_link')}
                                </span>
                            </button>
                            <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />
                            <button
                                type="button"
                                onClick={(e) => handleDeleteTask(list.id, task, e)}
                                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer text-left transition-colors"
                            >
                                <Trash2 size={13} />
                                <span>{t('basecamp.put_in_trash')}</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        )
    }

    const renderSortOrderLabel = () => {
        if (sortOrder === 'position') return t('basecamp.sort_by_position')
        if (sortOrder === 'newest') return t('basecamp.sort_newest_first')
        return t('basecamp.sort_oldest_first')
    }

    // Full List Renderer (List View & Single List Drill-Down)
    const renderFullList = (list: any, listIdx: number, showBackBtn: boolean = false) => {
        const openTasks = sortOpenTasks(list.tasks.filter((tk: any) => !tk.is_completed))
        const completedTasks = sortCompletedTasks(list.tasks.filter((tk: any) => tk.is_completed))
        const listGroups: any[] = Array.isArray(list.groups) ? list.groups : []
        const groupIdSet = new Set(listGroups.map((g) => g.id))
        const ungroupedOpenTasks = openTasks.filter((tk: any) => !tk.group_id || !groupIdSet.has(tk.group_id))

        const ratioInfo = parseCompletedRatio(list.bc_completed_ratio, list.completed_count, list.total_count)
        const isFiltering = Boolean(todoFilterQuery.trim())
        const displayCompletedCount = isFiltering
            ? completedTasks.length
            : Math.max(ratioInfo.completed, Number(list.completed_count || 0), completedTasks.length)
        const isExpanded = expandedCompleted[list.id] || false
        const dotColor = resolveBasecampColorHex(list.color, listIdx)
        const isListMenuOpen = openListMenuId === list.id
        const isListElevated =
            isListMenuOpen ||
            (addingTaskId === list.id && showAssigneeSuggestions) ||
            Boolean(openGroupMenuId && listGroups.some((g: any) => g.id === openGroupMenuId)) ||
            Boolean(openRowMenuTaskId && openTasks.some((tk: any) => tk.id === openRowMenuTaskId))

        const renderListMoreMenu = () => (
            <div data-bc-list-menu="true" className="relative shrink-0">
                <button
                    type="button"
                    onClick={() => {
                        setOpenGroupMenuId(null)
                        setOpenRowMenuTaskId(null)
                        setShowViewAsMenu(false)
                        setShowSortMenu(false)
                        setOpenListMenuId((prev) => (prev === list.id ? null : list.id))
                    }}
                    title={t('basecamp.more_actions')}
                    className={`w-8 h-8 rounded-xl border border-slate-200 dark:border-slate-700 inline-flex items-center justify-center cursor-pointer transition-colors ${
                        isListMenuOpen
                            ? 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white'
                            : 'bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                >
                    <MoreHorizontal size={16} />
                </button>

                {isListMenuOpen && (
                    <div className="absolute top-full right-0 mt-1.5 min-w-[230px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-1.5 z-[70]">
                        <button
                            type="button"
                            onClick={() => {
                                setOpenListMenuId(null)
                                setEditingListModal({
                                    id: list.id,
                                    bc_id: Number(list.bc_id),
                                    name: list.list_name || '',
                                    description: list.description || '',
                                    color: list.color || 'blue',
                                })
                            }}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-left transition-colors"
                        >
                            <Pencil size={13} className="text-slate-500 dark:text-slate-400" />
                            <span>{t('basecamp.edit_list')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setOpenListMenuId(null)
                                setCreatingGroupModal({
                                    listId: list.id,
                                    listBcId: Number(list.bc_id),
                                    name: '',
                                    color: list.color || 'blue',
                                })
                            }}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-bold text-[#1D7DB5] dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 cursor-pointer text-left transition-colors"
                        >
                            <Plus size={13} />
                            <span>{t('basecamp.new_group')}</span>
                        </button>

                        <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

                        {(['position', 'newest', 'oldest'] as SortOrderMode[]).map((mode) => {
                            const label =
                                mode === 'position'
                                    ? t('basecamp.sort_by_position')
                                    : mode === 'newest'
                                    ? t('basecamp.sort_newest_first')
                                    : t('basecamp.sort_oldest_first')
                            return (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => {
                                        setSortOrder(mode)
                                        setOpenListMenuId(null)
                                    }}
                                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[12.5px] cursor-pointer text-left transition-colors ${
                                        sortOrder === mode
                                            ? 'bg-sky-50 dark:bg-sky-950/50 text-[#0369A1] dark:text-sky-300 font-bold'
                                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium'
                                    }`}
                                >
                                    <span>{label}</span>
                                    {sortOrder === mode && <Check size={13} />}
                                </button>
                            )
                        })}

                        <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />
                        <button
                            type="button"
                            onClick={() =>
                                handleDeleteListOrGroup('bc_todolists', {
                                    id: list.id,
                                    bc_id: Number(list.bc_id),
                                })
                            }
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer text-left transition-colors"
                        >
                            <Trash2 size={13} />
                            <span>{t('basecamp.put_in_trash')}</span>
                        </button>
                    </div>
                )}
            </div>
        )

        return (
            <div
                key={list.id}
                className={`relative ${isListElevated ? 'z-30' : 'z-0'} w-full min-w-0 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-xs overflow-visible`}
            >
                {/* ── Compact List Header ── */}
                <div
                    className={`relative ${isListMenuOpen ? 'z-30' : 'z-10'} px-3.5 sm:px-6 pt-3.5 sm:pt-5 pb-3.5 sm:pb-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 rounded-t-2xl space-y-3 min-w-0`}
                >
                    {showBackBtn ? (
                        <>
                            {/* Row 1: [← Lists] + Counter Badge + [•••] in 1 clean line */}
                            <div className="flex items-center justify-between gap-2 min-w-0">
                                <button
                                    type="button"
                                    onClick={() => setSelectedListId(null)}
                                    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-[#1D7DB5] dark:text-sky-400 text-xs sm:text-[13px] font-bold shadow-2xs transition-colors cursor-pointer shrink-0"
                                >
                                    <ArrowLeft size={14} className="shrink-0" />
                                    <span>{t('basecamp.todos')}</span>
                                </button>

                                <div className="flex items-center gap-2 shrink-0">
                                    {ratioInfo.label && (
                                        <span className="px-2.5 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 tabular-nums whitespace-nowrap">
                                            {ratioInfo.label}
                                        </span>
                                    )}
                                    {renderListMoreMenu()}
                                </div>
                            </div>

                            {/* Row 2: Color dot + List Title + Optional Description */}
                            <div className="flex items-start gap-2.5 min-w-0">
                                <span
                                    className="w-3 h-3 rounded-full mt-1.5 sm:mt-2 shrink-0"
                                    style={{ backgroundColor: dotColor }}
                                />
                                <div className="min-w-0 flex-1">
                                    <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight break-words">
                                        {list.list_name}
                                    </h2>
                                    {list.description && (
                                        <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed break-words">
                                            {list.description}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Row 3: Responsive 1-Row Toolbar (Search + Sort + Add Task) */}
                            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 pt-0.5 min-w-0">
                                <div className="relative flex-1 min-w-[150px] flex items-center">
                                    <Search
                                        size={14}
                                        className="absolute left-3 text-slate-400 pointer-events-none"
                                    />
                                    <input
                                        type="text"
                                        value={todoFilterQuery}
                                        onChange={(e) => setTodoFilterQuery(e.target.value)}
                                        placeholder={t('basecamp.filter_placeholder')}
                                        className="w-full h-9 pl-8 pr-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-[13px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none focus:border-[#1D7DB5] focus:ring-2 focus:ring-[#1D7DB5]/15 transition-all"
                                    />
                                    {todoFilterQuery && (
                                        <button
                                            type="button"
                                            onClick={() => setTodoFilterQuery('')}
                                            className="absolute right-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer text-xs font-bold"
                                            title={t('basecamp.clear_filter')}
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>

                                <button
                                    type="button"
                                    onClick={() =>
                                        setSortOrder((prev) =>
                                            prev === 'position' ? 'newest' : prev === 'newest' ? 'oldest' : 'position'
                                        )
                                    }
                                    title={t('basecamp.sort_by_created_tooltip')}
                                    className="h-9 px-2.5 sm:px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 shadow-2xs shrink-0 max-w-[160px] sm:max-w-none cursor-pointer transition-colors"
                                >
                                    <ArrowUpDown size={13} className="text-[#1D7DB5] shrink-0" />
                                    <span className="truncate">{renderSortOrderLabel()}</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        resetAddTaskForm()
                                        setAddingTaskGroupId(null)
                                        setAddingTaskId(list.id)
                                        setTimeout(() => {
                                            addTaskFormRef.current?.scrollIntoView({
                                                behavior: 'smooth',
                                                block: 'center',
                                            })
                                        }, 60)
                                    }}
                                    className="h-9 px-3 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs shrink-0 cursor-pointer transition-colors whitespace-nowrap"
                                >
                                    <Plus size={14} className="shrink-0" />
                                    <span>{t('basecamp.add_todo')}</span>
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="flex items-start justify-between gap-2.5 min-w-0">
                            <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                <span
                                    className="w-2.5 h-2.5 rounded-full mt-2 shrink-0"
                                    style={{ backgroundColor: dotColor }}
                                />
                                <div className="min-w-0 flex-1">
                                    <h2
                                        onClick={() => setSelectedListId(list.id)}
                                        className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900 dark:text-white hover:text-[#1D7DB5] dark:hover:text-sky-400 leading-snug cursor-pointer break-words transition-colors"
                                    >
                                        {list.list_name}
                                    </h2>
                                    {list.description && (
                                        <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed break-words">
                                            {list.description}
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                                {ratioInfo.label && (
                                    <span className="px-2.5 py-0.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 tabular-nums whitespace-nowrap">
                                        {ratioInfo.label}
                                    </span>
                                )}
                                {renderListMoreMenu()}
                            </div>
                        </div>
                    )}
                </div>

                {/* ── 1. Ungrouped Active Tasks + Root Add To-Do ── */}
                <div className="px-1.5 sm:px-2 py-1.5 min-w-0">
                    {ungroupedOpenTasks.length === 0 && listGroups.length === 0 && addingTaskId !== list.id && (
                        <div className="px-3.5 sm:px-4 py-5 text-slate-400 dark:text-slate-500 text-[13.5px] italic">
                            {t('basecamp.no_todos_in_list')}
                        </div>
                    )}

                    <div className="divide-y divide-slate-100/90 dark:divide-slate-800/70">
                        {ungroupedOpenTasks.map((task: any) => renderActiveTaskRow(list, task))}
                    </div>

                    <div className="px-2 sm:px-4 pt-2.5 pb-2">
                        {addingTaskId === list.id && !addingTaskGroupId ? (
                            renderInlineAddTaskForm(list, null)
                        ) : (
                            <button
                                type="button"
                                onClick={() => {
                                    resetAddTaskForm()
                                    setAddingTaskGroupId(null)
                                    setAddingTaskId(list.id)
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-[#1D7DB5] hover:bg-sky-50/50 dark:hover:bg-sky-950/30 text-[#1D7DB5] dark:text-sky-400 text-[13px] font-semibold cursor-pointer transition-colors"
                            >
                                <Plus size={14} />
                                <span>{t('basecamp.add_todo')}</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* ── 2. Todolist Groups (bc_todolist_groups) ── */}
                {listGroups.map((group: any, gIdx: number) => {
                    const groupColorHex = resolveBasecampColorHex(group.color, gIdx + 2)
                    const groupOpenTasks = openTasks.filter((tk: any) => tk.group_id === group.id)
                    const isGroupMenuOpen = openGroupMenuId === group.id
                    const isGroupElevated =
                        isGroupMenuOpen ||
                        (addingTaskId === list.id && addingTaskGroupId === group.id && showAssigneeSuggestions) ||
                        Boolean(openRowMenuTaskId && groupOpenTasks.some((tk: any) => tk.id === openRowMenuTaskId))

                    return (
                        <div
                            key={group.id}
                            className={`relative ${isGroupElevated ? 'z-30' : 'z-0'} bg-white dark:bg-slate-900 min-w-0`}
                            style={{ borderTop: `2px solid ${groupColorHex}` }}
                        >
                            <div
                                className={`relative ${isGroupMenuOpen ? 'z-30' : 'z-10'} flex items-center justify-between gap-2 px-3.5 sm:px-6 py-2.5 bg-slate-50/80 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800`}
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <span
                                        className="w-2.5 h-2.5 rounded-full shrink-0"
                                        style={{ backgroundColor: groupColorHex }}
                                    />
                                    <strong className="text-[14px] font-bold text-slate-900 dark:text-white truncate">
                                        {group.name}
                                    </strong>
                                    <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-slate-200/80 dark:bg-slate-700 px-2 py-0.5 rounded-full tabular-nums shrink-0">
                                        {groupOpenTasks.length}
                                    </span>
                                </div>

                                <div data-bc-group-menu="true" className="relative flex items-center gap-1 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setOpenListMenuId(null)
                                            setOpenRowMenuTaskId(null)
                                            setShowViewAsMenu(false)
                                            setShowSortMenu(false)
                                            setOpenGroupMenuId((prev) => (prev === group.id ? null : group.id))
                                        }}
                                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-700 cursor-pointer transition-colors"
                                    >
                                        <MoreHorizontal size={15} />
                                    </button>
                                    {isGroupMenuOpen && (
                                        <div className="absolute top-full right-0 mt-1 min-w-[185px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-1.5 z-[70]">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setOpenGroupMenuId(null)
                                                    setEditingGroupModal({
                                                        id: group.id,
                                                        bc_id: Number(group.bc_id),
                                                        name: group.name || '',
                                                        color: group.color || 'blue',
                                                    })
                                                }}
                                                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-left transition-colors"
                                            >
                                                <Pencil size={12} />
                                                <span>{t('basecamp.edit_group')}</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handleDeleteListOrGroup('bc_todolist_groups', {
                                                        id: group.id,
                                                        bc_id: Number(group.bc_id),
                                                    })
                                                }
                                                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer text-left transition-colors"
                                            >
                                                <Trash2 size={12} />
                                                <span>{t('basecamp.put_in_trash')}</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="px-1.5 sm:px-2 py-1 divide-y divide-slate-100/90 dark:divide-slate-800/70">
                                {groupOpenTasks.map((task: any) => renderActiveTaskRow(list, task))}
                            </div>

                            <div className="px-3.5 sm:px-6 pt-1.5 pb-3">
                                {addingTaskId === list.id && addingTaskGroupId === group.id ? (
                                    renderInlineAddTaskForm(list, group.id)
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            resetAddTaskForm()
                                            setAddingTaskId(list.id)
                                            setAddingTaskGroupId(group.id)
                                        }}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-[#1D7DB5] text-[#1D7DB5] dark:text-sky-400 text-xs font-semibold cursor-pointer transition-colors"
                                    >
                                        <Plus size={13} />
                                        <span>{t('basecamp.add_todo')}</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    )
                })}

                {/* ── 3. Completed Tasks Accordion ── */}
                {displayCompletedCount > 0 && (
                    <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 rounded-b-2xl min-w-0">
                        <button
                            type="button"
                            onClick={() =>
                                toggleCompletedSection(list, completedTasks.length, displayCompletedCount)
                            }
                            className="w-full flex items-center justify-between px-3.5 sm:px-6 py-3 text-left text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 text-[13px] font-semibold cursor-pointer transition-colors"
                        >
                            <span className="inline-flex items-center gap-1.5">
                                {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                <span className="tabular-nums">
                                    {displayCompletedCount.toLocaleString()} {t('basecamp.completed_todos')}
                                </span>
                            </span>
                        </button>

                        {isExpanded && (
                            <div className="px-1.5 sm:px-2 pb-3 min-w-0">
                                {loadingCompletedByList[list.id] && completedTasks.length === 0 && (
                                    <div className="px-3.5 sm:px-4 py-2.5 flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
                                        <Loader2 size={14} className="animate-spin text-[#1D7DB5]" />
                                        <span>{t('basecamp.loading_bc')}</span>
                                    </div>
                                )}
                                <div className="divide-y divide-slate-200/50 dark:divide-slate-800/60">
                                    {completedTasks.map((task: any) => (
                                        <div
                                            key={task.id}
                                            className="group flex items-start gap-2.5 sm:gap-3 px-2.5 sm:px-4 py-2.5 rounded-xl hover:bg-white/80 dark:hover:bg-slate-800/40 transition-colors min-w-0"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => handleToggleTask(list.id, task)}
                                                disabled={actionLoading === task.id}
                                                className="w-5 h-5 mt-0.5 shrink-0 rounded-md border-2 border-emerald-500 bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center cursor-pointer transition-colors"
                                                title={t('basecamp.mark_incomplete')}
                                            >
                                                <Check size={12} strokeWidth={3} />
                                            </button>

                                            <div
                                                onClick={() => {
                                                    setSelectedTask(task)
                                                    setSelectedTaskListId(list.id)
                                                }}
                                                className="min-w-0 flex-1 cursor-pointer"
                                            >
                                                <div className="text-[14px] sm:text-[14.5px] font-medium line-through text-slate-500 dark:text-slate-400 leading-snug break-words">
                                                    {task.task_name}
                                                </div>
                                                {(task.completed_at || task.created_at) && (
                                                    <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500 font-medium whitespace-nowrap">
                                                        <Clock size={10} className="shrink-0 opacity-80" />
                                                        <span>
                                                            {formatCreatedDateTime(task.completed_at || task.created_at)}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="shrink-0 flex items-center">
                                                {isFiltering ? (
                                                    <button
                                                        type="button"
                                                        disabled={replicatingTaskId === task.id}
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            void handleReplicateTask(task)
                                                        }}
                                                        title={t('basecamp.replicate_task')}
                                                        className="inline-flex items-center justify-center gap-1.5 w-8 h-8 sm:w-auto sm:h-auto sm:px-2.5 sm:py-1 rounded-lg bg-[#1D7DB5] hover:bg-[#155D8A] text-white text-xs font-bold shadow-2xs transition-colors cursor-pointer shrink-0 disabled:opacity-60"
                                                    >
                                                        {replicatingTaskId === task.id ? (
                                                            <Loader2 size={12} className="animate-spin" />
                                                        ) : (
                                                            <span className="text-[12px] leading-none">📋</span>
                                                        )}
                                                        <span className="hidden sm:inline">
                                                            {t('basecamp.replicate_task')}
                                                        </span>
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        disabled={replicatingTaskId === task.id}
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            void handleReplicateTask(task)
                                                        }}
                                                        title={t('basecamp.replicate_task_tooltip')}
                                                        className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-sky-200/90 dark:border-sky-800/80 bg-sky-50/90 dark:bg-sky-950/40 hover:bg-[#1D7DB5] hover:border-[#1D7DB5] hover:text-white text-[#0369A1] dark:text-sky-300 text-xs font-semibold opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 transition-all cursor-pointer shrink-0 disabled:opacity-60"
                                                    >
                                                        {replicatingTaskId === task.id ? (
                                                            <Loader2 size={11} className="animate-spin" />
                                                        ) : (
                                                            <span className="text-[12px] leading-none">📋</span>
                                                        )}
                                                        <span>{t('basecamp.replicate_task')}</span>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        )
    }

    const filteredLists = useMemo(() => {
        const sortedLists = lists.map((list) => ({
            ...list,
            tasks: [
                ...sortOpenTasks(list.tasks.filter((tk: any) => !tk.is_completed)),
                ...sortCompletedTasks(list.tasks.filter((tk: any) => tk.is_completed)),
            ],
        }))
        const q = normalizeSearch(todoFilterQuery)
        if (!q) return sortedLists
        return sortedLists
            .map((list) => {
                const listMatches =
                    normalizeSearch(list.list_name).includes(q) || normalizeSearch(list.description).includes(q)
                const matchingTasks = list.tasks.filter((tk: any) => {
                    if (
                        normalizeSearch(tk.task_name).includes(q) ||
                        normalizeSearch(tk.creator_name).includes(q) ||
                        normalizeSearch(tk.assignee).includes(q)
                    ) {
                        return true
                    }
                    const snip = extractTaskRowSnippet(tk.description)
                    return (
                        normalizeSearch(snip.textSnippet).includes(q) ||
                        normalizeSearch(snip.attachmentNames.join(' ')).includes(q)
                    )
                })
                if (listMatches) return list
                if (matchingTasks.length > 0) {
                    return { ...list, tasks: matchingTasks }
                }
                return null
            })
            .filter(Boolean) as any[]
    }, [lists, todoFilterQuery, sortOpenTasks, sortCompletedTasks])

    // Deduplicate historical Supabase matches against open tasks already rendered above
    const visibleHistoryMatches = useMemo(() => {
        if (todoFilterQuery.trim().length < 2 || historySearchResults.length === 0) return []
        const openRenderedIds = new Set<string>()
        if (selectedListId) {
            const activeFiltered = filteredLists.find((l) => l.id === selectedListId)
            ;(activeFiltered?.tasks || [])
                .filter((tk: any) => !tk.is_completed)
                .forEach((tk: any) => openRenderedIds.add(tk.id))
        } else if (viewMode === 'cards') {
            filteredLists.forEach((l) => {
                l.tasks
                    .filter((tk: any) => !tk.is_completed)
                    .slice(0, 6)
                    .forEach((tk: any) => openRenderedIds.add(tk.id))
            })
        } else {
            filteredLists.forEach((l) => {
                l.tasks
                    .filter((tk: any) => !tk.is_completed)
                    .forEach((tk: any) => openRenderedIds.add(tk.id))
            })
        }

        const filtered = historySearchResults.filter((tk) => !openRenderedIds.has(tk.id))
        if (selectedListId) {
            filtered.sort((a, b) => {
                const aSame = a.todolist_id === selectedListId ? 0 : 1
                const bSame = b.todolist_id === selectedListId ? 0 : 1
                if (aSame !== bSame) return aSame - bSame
                return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
            })
        }
        return filtered
    }, [todoFilterQuery, historySearchResults, selectedListId, filteredLists, viewMode])

    const renderHistoricalMatchesSection = () => {
        if (todoFilterQuery.trim().length < 2) return null
        if (!historySearchLoading && visibleHistoryMatches.length === 0) return null

        return (
            <div className="mt-4 mb-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-xs overflow-hidden min-w-0">
                <div className="px-4 sm:px-5 py-3 bg-gradient-to-r from-slate-50 to-sky-50/70 dark:from-slate-900 dark:to-sky-950/30 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base leading-none">📋</span>
                        <span className="text-[13.5px] font-extrabold text-slate-900 dark:text-white truncate">
                            {t('basecamp.completed_matches_title')}
                        </span>
                        {!historySearchLoading && (
                            <span className="px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-950/70 text-[#1D7DB5] dark:text-sky-300 text-[11px] font-extrabold tabular-nums">
                                {visibleHistoryMatches.length}
                            </span>
                        )}
                    </div>
                    {historySearchLoading && (
                        <div className="inline-flex items-center gap-1.5 text-xs text-[#0369A1] dark:text-sky-300 font-semibold">
                            <Loader2 size={13} className="animate-spin" />
                            <span>{t('basecamp.searching_completed_history')}</span>
                        </div>
                    )}
                </div>

                <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {visibleHistoryMatches.map((task: any) => {
                        const origListIdx = lists.findIndex((l) => l.id === task.todolist_id)
                        const origList = origListIdx >= 0 ? lists[origListIdx] : null
                        const origListName = origList?.list_name || t('basecamp.todos')
                        const origDotHex = resolveBasecampColorHex(origList?.color, origListIdx >= 0 ? origListIdx : 0)
                        const { textSnippet, attachmentNames } = extractTaskRowSnippet(task.description)
                        const previewImages = extractInlinePreviewImages(task.description)

                        return (
                            <div
                                key={`hist-${task.id}`}
                                onClick={() => {
                                    setSelectedTask(task)
                                    setSelectedTaskListId(task.todolist_id)
                                }}
                                className="px-3.5 sm:px-5 py-3 flex items-start justify-between gap-2.5 sm:gap-4 hover:bg-slate-50/90 dark:hover:bg-slate-800/50 cursor-pointer transition-colors min-w-0"
                            >
                                <div className="min-w-0 flex-1 space-y-1">
                                    <div
                                        className={`text-[14.5px] font-semibold leading-snug break-words ${
                                            task.is_completed
                                                ? 'line-through text-slate-600 dark:text-slate-400 decoration-slate-400'
                                                : 'text-slate-900 dark:text-slate-100'
                                        }`}
                                    >
                                        {task.task_name}
                                    </div>

                                    {textSnippet && (
                                        <p className="line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
                                            {textSnippet}
                                        </p>
                                    )}

                                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 max-w-[160px]">
                                            <span
                                                className="w-2 h-2 rounded-full shrink-0"
                                                style={{ backgroundColor: origDotHex }}
                                            />
                                            <span className="truncate">{origListName}</span>
                                        </span>

                                        <span
                                            className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold border whitespace-nowrap ${
                                                task.is_completed
                                                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                                                    : 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800'
                                            }`}
                                        >
                                            {task.is_completed
                                                ? `✓ ${t('basecamp.status_completed_badge')}`
                                                : t('basecamp.status_open_badge')}
                                        </span>

                                        {previewImages.length > 0 && (
                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-[11px] font-bold whitespace-nowrap">
                                                📷 {previewImages.length}
                                            </span>
                                        )}

                                        {(task.completed_at || task.created_at) && (
                                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500 font-medium whitespace-nowrap">
                                                <Clock size={10} className="shrink-0" />
                                                {formatCreatedDateTime(task.completed_at || task.created_at)}
                                            </span>
                                        )}

                                        {attachmentNames.map((fn, fIdx) => (
                                            <span
                                                key={fIdx}
                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-[10.5px] font-medium text-slate-600 dark:text-slate-300 max-w-[130px]"
                                            >
                                                <Paperclip size={10} className="text-[#1D7DB5] shrink-0" />
                                                <span className="truncate">{fn}</span>
                                            </span>
                                        ))}
                                    </div>

                                    {previewImages.length > 0 && (
                                        <div className="flex items-center gap-1.5 pt-1.5 flex-wrap">
                                            {previewImages.slice(0, 4).map((imgUrl, idx) => (
                                                <img
                                                    key={idx}
                                                    src={imgUrl}
                                                    alt={t('basecamp.preview_thumbnail')}
                                                    className="w-11 h-11 rounded-lg object-cover border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                                                />
                                            ))}
                                            {previewImages.length > 4 && (
                                                <span className="w-11 h-11 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 inline-flex items-center justify-center text-[11px] font-bold text-slate-600 dark:text-slate-300">
                                                    +{previewImages.length - 4}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <button
                                    type="button"
                                    disabled={replicatingTaskId === task.id}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        void handleReplicateTask(task)
                                    }}
                                    title={t('basecamp.replicate_task')}
                                    className="inline-flex items-center justify-center gap-1.5 w-8 h-8 sm:w-auto sm:h-auto sm:px-3 sm:py-1.5 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] text-white text-xs font-bold shadow-2xs transition-colors cursor-pointer shrink-0 disabled:opacity-60"
                                >
                                    {replicatingTaskId === task.id ? (
                                        <Loader2 size={13} className="animate-spin" />
                                    ) : (
                                        <span className="text-[13px] leading-none">📋</span>
                                    )}
                                    <span className="hidden sm:inline">{t('basecamp.replicate_task')}</span>
                                </button>
                            </div>
                        )
                    })}
                </div>
            </div>
        )
    }

    return (
        <div className="w-full max-w-5xl mx-auto px-0 sm:px-2 flex flex-col gap-4 sm:gap-6 min-w-0">
            <style
                dangerouslySetInnerHTML={{
                    __html: `
                ${BASECAMP_RICH_CONTENT_CSS}
                .bc-rich-text img.avatar,
                .bc-rich-text img[data-bc-avatar="true"] {
                    display: inline-block;
                    margin: 0;
                    border-radius: 9999px;
                    border: none;
                    box-shadow: none;
                }
                ${BASECAMP_IMAGE_HOVER_CSS}
            `,
                }}
            />

            {mutationError && (
                <div className="mt-1 px-3.5 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/80 text-red-700 dark:text-red-300 text-xs sm:text-[13px] font-semibold flex items-center justify-between gap-3">
                    <span className="min-w-0 break-words">{mutationError}</span>
                    <button
                        type="button"
                        onClick={() => setMutationError(null)}
                        className="text-red-700 dark:text-red-300 hover:opacity-75 cursor-pointer font-extrabold shrink-0"
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* ── Drill-down Single List View ── */}
            {selectedListId ? (
                (() => {
                    const rawActiveList = lists.find((l) => l.id === selectedListId)
                    const activeListIdx = lists.findIndex((l) => l.id === selectedListId)
                    const filteredMatch = filteredLists.find((l) => l.id === selectedListId)
                    const activeList =
                        rawActiveList && todoFilterQuery.trim()
                            ? filteredMatch || { ...rawActiveList, tasks: [] }
                            : rawActiveList
                    if (!activeList) {
                        return (
                            <div className="py-10 text-center space-y-3">
                                <p className="text-slate-500 dark:text-slate-400 text-[15px]">
                                    {t('basecamp.list_not_found')}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setSelectedListId(null)}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] text-white text-xs sm:text-[13.5px] font-bold cursor-pointer transition-colors"
                                >
                                    <ArrowLeft size={14} />
                                    <span>{t('basecamp.back_to_todos')}</span>
                                </button>
                            </div>
                        )
                    }
                    return (
                        <div className="pb-10 min-w-0">
                            {renderFullList(activeList, activeListIdx >= 0 ? activeListIdx : 0, true)}
                            {renderHistoricalMatchesSection()}
                        </div>
                    )
                })()
            ) : (
                <>
                    {/* ── Compact All-Lists Header & 1-Row Responsive Toolbar ── */}
                    <div className="pt-1 sm:pt-2 flex flex-col gap-3 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 min-w-0">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <h1 className="text-xl sm:text-[26px] font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight break-words">
                                    {t('basecamp.todos')}
                                </h1>
                                {lists.length > 0 && (
                                    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 tabular-nums shrink-0">
                                        {lists.length}
                                    </span>
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={() => setShowAddList(true)}
                                className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] text-white text-xs sm:text-[13px] font-bold shadow-xs transition-colors cursor-pointer shrink-0 whitespace-nowrap w-full sm:w-auto"
                            >
                                <Plus size={15} className="shrink-0" />
                                <span>{t('basecamp.add_list')}</span>
                            </button>
                        </div>

                        {/* Single-row responsive toolbar: Search + View Mode + Sort */}
                        <div
                            className={`relative ${
                                showViewAsMenu || showSortMenu ? 'z-40' : 'z-20'
                            } flex flex-wrap sm:flex-nowrap items-center gap-2 min-w-0`}
                        >
                            {/* Search Input */}
                            <div className="relative flex-1 min-w-[150px] flex items-center">
                                <Search
                                    size={14}
                                    className="absolute left-3 text-slate-400 pointer-events-none"
                                />
                                <input
                                    type="text"
                                    value={todoFilterQuery}
                                    onChange={(e) => setTodoFilterQuery(e.target.value)}
                                    placeholder={t('basecamp.filter_placeholder')}
                                    className="w-full h-9 pl-8 pr-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[13px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none focus:border-[#1D7DB5] focus:ring-2 focus:ring-[#1D7DB5]/15 transition-all"
                                />
                                {todoFilterQuery && (
                                    <button
                                        type="button"
                                        onClick={() => setTodoFilterQuery('')}
                                        className="absolute right-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer text-xs font-bold"
                                        title={t('basecamp.clear_filter')}
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>

                            {/* View As Menu */}
                            <div className="relative shrink-0" ref={viewAsMenuRef}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowSortMenu(false)
                                        setOpenListMenuId(null)
                                        setOpenGroupMenuId(null)
                                        setOpenRowMenuTaskId(null)
                                        setShowViewAsMenu(!showViewAsMenu)
                                    }}
                                    title={t('basecamp.view_as')}
                                    className="inline-flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                                >
                                    {viewMode === 'cards' ? (
                                        <LayoutGrid size={14} className="text-[#1D7DB5] shrink-0" />
                                    ) : (
                                        <List size={14} className="text-[#1D7DB5] shrink-0" />
                                    )}
                                    <span className="hidden sm:inline">{t('basecamp.view_as')}</span>
                                    <ChevronDown size={13} className="text-slate-400 shrink-0" />
                                </button>

                                {showViewAsMenu && (
                                    <div className="absolute top-full right-0 sm:left-0 sm:right-auto mt-1.5 min-w-[195px] bg-slate-900 text-white rounded-xl p-1.5 shadow-2xl border border-slate-700/80 z-50">
                                        <div className="px-2.5 pt-1 pb-2 text-[10.5px] font-bold text-slate-400 uppercase tracking-wider border-b border-white/10 mb-1">
                                            {t('basecamp.view_todos_prompt')}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setViewMode('list')
                                                setShowViewAsMenu(false)
                                            }}
                                            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[13px] cursor-pointer text-left transition-colors ${
                                                viewMode === 'list'
                                                    ? 'bg-white/10 font-bold text-white'
                                                    : 'font-medium text-slate-200 hover:bg-white/5'
                                            }`}
                                        >
                                            <span>{t('basecamp.view_in_list')}</span>
                                            {viewMode === 'list' && <Check size={15} className="text-sky-400" />}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setViewMode('cards')
                                                setShowViewAsMenu(false)
                                            }}
                                            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[13px] cursor-pointer text-left transition-colors ${
                                                viewMode === 'cards'
                                                    ? 'bg-white/10 font-bold text-white'
                                                    : 'font-medium text-slate-200 hover:bg-white/5'
                                            }`}
                                        >
                                            <span>{t('basecamp.view_as_cards')}</span>
                                            {viewMode === 'cards' && <Check size={15} className="text-sky-400" />}
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Sort Dropdown (Basecamp Position / Newest / Oldest) */}
                            <div className="relative shrink-0" ref={sortMenuRef}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowViewAsMenu(false)
                                        setOpenListMenuId(null)
                                        setOpenGroupMenuId(null)
                                        setOpenRowMenuTaskId(null)
                                        setShowSortMenu((prev) => !prev)
                                    }}
                                    className="inline-flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold shadow-2xs transition-colors cursor-pointer max-w-[165px] sm:max-w-none"
                                >
                                    <ArrowUpDown size={13} className="text-[#1D7DB5] shrink-0" />
                                    <span className="truncate">{renderSortOrderLabel()}</span>
                                    <ChevronDown size={13} className="text-slate-400 shrink-0" />
                                </button>

                                {showSortMenu && (
                                    <div className="absolute top-full right-0 mt-1.5 min-w-[205px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-1.5 z-[55]">
                                        {(['position', 'newest', 'oldest'] as SortOrderMode[]).map((mode) => {
                                            const label =
                                                mode === 'position'
                                                    ? t('basecamp.sort_by_position')
                                                    : mode === 'newest'
                                                    ? t('basecamp.sort_newest_first')
                                                    : t('basecamp.sort_oldest_first')
                                            return (
                                                <button
                                                    key={mode}
                                                    type="button"
                                                    onClick={() => {
                                                        setSortOrder(mode)
                                                        setShowSortMenu(false)
                                                    }}
                                                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[12.5px] cursor-pointer text-left transition-colors ${
                                                        sortOrder === mode
                                                            ? 'bg-sky-50 dark:bg-sky-950/50 text-[#0369A1] dark:text-sky-300 font-bold'
                                                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium'
                                                    }`}
                                                >
                                                    <span>{label}</span>
                                                    {sortOrder === mode && <Check size={14} />}
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Lists Grid / Stack */}
                    {loading && lists.length === 0 ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="animate-spin w-8 h-8 text-[#1D7DB5]" />
                        </div>
                    ) : lists.length > 0 ? (
                        filteredLists.length === 0 && !historySearchLoading && visibleHistoryMatches.length === 0 ? (
                            <div className="py-12 px-4 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                                <p className="text-[15px] font-bold text-slate-800 dark:text-slate-100 mb-3">
                                    {t('basecamp.no_matching_todos')}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setTodoFilterQuery('')}
                                    className="px-4 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[#1D7DB5] dark:text-sky-400 text-xs font-bold cursor-pointer hover:bg-slate-200/70 dark:hover:bg-slate-700 transition-colors"
                                >
                                    {t('basecamp.clear_filter')}
                                </button>
                            </div>
                        ) : filteredLists.length === 0 ? (
                            renderHistoricalMatchesSection()
                        ) : viewMode === 'cards' ? (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0 pb-10">
                                {filteredLists.map((list, listIdx) => {
                                    const openTasks = list.tasks.filter((tk: any) => !tk.is_completed)
                                    const completedTasks = list.tasks.filter((tk: any) => tk.is_completed)
                                    const dotColor = resolveBasecampColorHex(list.color, listIdx)
                                    const ratioInfo = parseCompletedRatio(
                                        list.bc_completed_ratio,
                                        list.completed_count,
                                        list.total_count
                                    )
                                    const previewTasks = openTasks.slice(0, 6)
                                    const remainingCount = openTasks.length - previewTasks.length
                                    const doneDisplayCount = todoFilterQuery.trim()
                                        ? completedTasks.length
                                        : Math.max(
                                              ratioInfo.completed,
                                              Number(list.completed_count || 0),
                                              completedTasks.length
                                          )

                                    return (
                                        <div
                                            key={list.id}
                                            onClick={() => setSelectedListId(list.id)}
                                            className="group min-w-0 w-full overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-xs hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-200 cursor-pointer flex flex-col"
                                        >
                                            <div className="h-1 w-full shrink-0" style={{ backgroundColor: dotColor }} />

                                            <div className="p-4 sm:p-5 flex-1 flex flex-col min-w-0">
                                                {/* Card Header */}
                                                <div className="flex items-start justify-between gap-2.5 mb-3 min-w-0">
                                                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                                        <span
                                                            className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0"
                                                            style={{ backgroundColor: dotColor }}
                                                        />
                                                        <div className="min-w-0 flex-1">
                                                            <h3 className="text-[16px] sm:text-[17px] font-bold text-slate-900 dark:text-slate-100 group-hover:text-[#1D7DB5] dark:group-hover:text-sky-400 leading-snug break-words transition-colors">
                                                                {list.list_name}
                                                            </h3>
                                                            {list.description && (
                                                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                                                                    {list.description}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {ratioInfo.label && (
                                                        <span className="shrink-0 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 tabular-nums whitespace-nowrap">
                                                            {ratioInfo.label}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Preview Tasks (0px overflow guaranteed at 360px/390px) */}
                                                <div className="flex-1 flex flex-col gap-1 mb-3.5 min-w-0">
                                                    {openTasks.length === 0 ? (
                                                        <div className="text-slate-400 dark:text-slate-500 text-[13px] italic py-3">
                                                            {t('basecamp.no_open_todos')}
                                                        </div>
                                                    ) : (
                                                        previewTasks.map((task: any) => {
                                                            const hasComments =
                                                                task.comments_count > 0 ||
                                                                (task.comments && task.comments.length > 0)
                                                            const commentCount =
                                                                task.comments_count ||
                                                                (task.comments ? task.comments.length : 0)

                                                            return (
                                                                <div
                                                                    key={task.id}
                                                                    className="flex items-center gap-2.5 py-1.5 px-1.5 -mx-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors min-w-0"
                                                                >
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation()
                                                                            handleToggleTask(list.id, task)
                                                                        }}
                                                                        disabled={actionLoading === task.id}
                                                                        className="w-[17px] h-[17px] rounded-[5px] border-[1.5px] border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:border-emerald-500 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
                                                                        title={t('basecamp.mark_as_done')}
                                                                    >
                                                                        {actionLoading === task.id ? (
                                                                            <Loader2
                                                                                size={10}
                                                                                className="animate-spin text-slate-400"
                                                                            />
                                                                        ) : null}
                                                                    </button>

                                                                    <span
                                                                        onClick={(e) => {
                                                                            e.stopPropagation()
                                                                            setSelectedTask(task)
                                                                            setSelectedTaskListId(list.id)
                                                                        }}
                                                                        className="min-w-0 flex-1 truncate text-[14px] font-medium text-slate-800 dark:text-slate-100 cursor-pointer"
                                                                    >
                                                                        {task.task_name}
                                                                    </span>

                                                                    <div className="shrink-0 flex items-center gap-1.5">
                                                                        {task.created_at && (
                                                                            <span className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-50 dark:bg-slate-800/80 text-slate-400 dark:text-slate-500 text-[10.5px] font-medium whitespace-nowrap">
                                                                                <Clock size={9.5} className="shrink-0" />
                                                                                {formatCreatedDateTime(
                                                                                    task.created_at,
                                                                                    false
                                                                                )}
                                                                            </span>
                                                                        )}

                                                                        {hasComments && (
                                                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-sky-50 dark:bg-sky-950/40 text-[#1D7DB5] dark:text-sky-400 text-[11px] font-bold whitespace-nowrap">
                                                                                <MessageSquare size={10.5} />
                                                                                {commentCount}
                                                                            </span>
                                                                        )}

                                                                        {todoFilterQuery.trim() && (
                                                                            <button
                                                                                type="button"
                                                                                disabled={replicatingTaskId === task.id}
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation()
                                                                                    void handleReplicateTask(task)
                                                                                }}
                                                                                title={t('basecamp.replicate_task')}
                                                                                className="inline-flex items-center justify-center gap-1 w-7 h-7 sm:w-auto sm:h-auto sm:px-2 sm:py-0.5 rounded-lg bg-[#1D7DB5] hover:bg-[#155D8A] text-white text-[11px] font-bold cursor-pointer shrink-0 transition-colors"
                                                                            >
                                                                                <span>📋</span>
                                                                                <span className="hidden sm:inline">
                                                                                    {t('basecamp.replicate_task')}
                                                                                </span>
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )
                                                        })
                                                    )}
                                                </div>

                                                {/* Card Footer */}
                                                <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800/80 text-xs font-semibold min-w-0">
                                                    <div className="min-w-0 truncate">
                                                        {remainingCount > 0 && (
                                                            <span className="text-[#1D7DB5] dark:text-sky-400">
                                                                +{remainingCount} {t('basecamp.more_todos')}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {doneDisplayCount > 0 && (
                                                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 shrink-0 whitespace-nowrap tabular-nums">
                                                            <Check size={12} />
                                                            {doneDisplayCount.toLocaleString()}{' '}
                                                            {t('basecamp.done_short')}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-5 sm:gap-6 pb-8 min-w-0">
                                {filteredLists.map((list, listIdx) => renderFullList(list, listIdx, false))}
                            </div>
                        )
                    ) : (
                        <div className="py-14 px-6 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                            <ClipboardList className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1.5">
                                {t('basecamp.no_todolists')}
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-5">
                                {t('basecamp.no_todolists_desc')}
                            </p>
                            <button
                                type="button"
                                onClick={() => setShowAddList(true)}
                                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] text-white text-sm font-bold shadow-xs cursor-pointer transition-colors"
                            >
                                <Plus size={16} />
                                <span>{t('basecamp.add_first_list')}</span>
                            </button>
                        </div>
                    )}
                    {lists.length > 0 && filteredLists.length > 0 && renderHistoricalMatchesSection()}
                </>
            )}

            {/* ── Modal: New List ── */}
            {showAddList && (
                <div
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setShowAddList(false)
                    }}
                    className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/55 backdrop-blur-xs"
                >
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white">
                                {t('basecamp.new_list_title')}
                            </h2>
                            <button
                                type="button"
                                onClick={() => setShowAddList(false)}
                                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <form onSubmit={handleAddList} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                    {t('basecamp.list_name_label')}
                                </label>
                                <input
                                    type="text"
                                    required
                                    autoFocus
                                    value={newListName}
                                    onChange={(e) => setNewListName(e.target.value)}
                                    placeholder={t('basecamp.new_list_placeholder')}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white outline-none focus:border-[#1D7DB5] focus:ring-2 focus:ring-[#1D7DB5]/15"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                    {t('basecamp.list_desc_label')}
                                </label>
                                <textarea
                                    value={newListDesc}
                                    onChange={(e) => setNewListDesc(e.target.value)}
                                    placeholder={t('basecamp.list_desc_placeholder')}
                                    rows={3}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white outline-none focus:border-[#1D7DB5] resize-y"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                                    {t('basecamp.list_color')}
                                </label>
                                {renderColorSwatchSelector(newListColor, setNewListColor)}
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowAddList(false)}
                                    className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs sm:text-[13px] font-semibold cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700"
                                >
                                    {t('basecamp.cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-[13px] font-bold cursor-pointer transition-colors disabled:opacity-60"
                                >
                                    {t('basecamp.create_list')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Modal: Edit List ── */}
            {editingListModal && (
                <div
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setEditingListModal(null)
                    }}
                    className="fixed inset-0 z-[55] flex items-center justify-center p-3 sm:p-4 bg-slate-900/55 backdrop-blur-xs"
                >
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white">
                                {t('basecamp.edit_list')}
                            </h2>
                            <button
                                type="button"
                                onClick={() => setEditingListModal(null)}
                                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <form onSubmit={handleUpdateList} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                    {t('basecamp.list_name_label')}
                                </label>
                                <input
                                    type="text"
                                    required
                                    autoFocus
                                    value={editingListModal.name}
                                    onChange={(e) =>
                                        setEditingListModal((prev) =>
                                            prev ? { ...prev, name: e.target.value } : null
                                        )
                                    }
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white outline-none focus:border-[#1D7DB5]"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                    {t('basecamp.list_desc_label')}
                                </label>
                                <textarea
                                    value={editingListModal.description}
                                    onChange={(e) =>
                                        setEditingListModal((prev) =>
                                            prev ? { ...prev, description: e.target.value } : null
                                        )
                                    }
                                    rows={3}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white outline-none focus:border-[#1D7DB5] resize-y"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                                    {t('basecamp.list_color')}
                                </label>
                                {renderColorSwatchSelector(editingListModal.color, (val) =>
                                    setEditingListModal((prev) => (prev ? { ...prev, color: val } : null))
                                )}
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setEditingListModal(null)}
                                    className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs sm:text-[13px] font-semibold cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700"
                                >
                                    {t('basecamp.cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={actionLoading === `update_list_${editingListModal.id}`}
                                    className="px-5 py-2 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] text-white text-xs sm:text-[13px] font-bold cursor-pointer transition-colors disabled:opacity-60"
                                >
                                    {t('basecamp.save_changes')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Modal: Create / Edit Group ── */}
            {(creatingGroupModal || editingGroupModal) && (
                <div
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            setCreatingGroupModal(null)
                            setEditingGroupModal(null)
                        }
                    }}
                    className="fixed inset-0 z-[55] flex items-center justify-center p-3 sm:p-4 bg-slate-900/55 backdrop-blur-xs"
                >
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
                                {creatingGroupModal ? t('basecamp.new_group') : t('basecamp.edit_group')}
                            </h2>
                            <button
                                type="button"
                                onClick={() => {
                                    setCreatingGroupModal(null)
                                    setEditingGroupModal(null)
                                }}
                                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <form onSubmit={creatingGroupModal ? handleCreateGroup : handleUpdateGroup} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                    {t('basecamp.group_label')}
                                </label>
                                <input
                                    type="text"
                                    required
                                    autoFocus
                                    value={creatingGroupModal ? creatingGroupModal.name : editingGroupModal?.name || ''}
                                    onChange={(e) => {
                                        const val = e.target.value
                                        if (creatingGroupModal) {
                                            setCreatingGroupModal((prev) => (prev ? { ...prev, name: val } : null))
                                        } else {
                                            setEditingGroupModal((prev) => (prev ? { ...prev, name: val } : null))
                                        }
                                    }}
                                    placeholder={t('basecamp.group_name_placeholder')}
                                    className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white outline-none focus:border-[#1D7DB5]"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                                    {t('basecamp.group_color')}
                                </label>
                                {renderColorSwatchSelector(
                                    creatingGroupModal ? creatingGroupModal.color : editingGroupModal?.color || 'blue',
                                    (val) => {
                                        if (creatingGroupModal) {
                                            setCreatingGroupModal((prev) => (prev ? { ...prev, color: val } : null))
                                        } else {
                                            setEditingGroupModal((prev) => (prev ? { ...prev, color: val } : null))
                                        }
                                    }
                                )}
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setCreatingGroupModal(null)
                                        setEditingGroupModal(null)
                                    }}
                                    className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs sm:text-[13px] font-semibold cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700"
                                >
                                    {t('basecamp.cancel')}
                                </button>
                                <button
                                    type="submit"
                                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-[13px] font-bold cursor-pointer transition-colors"
                                >
                                    {creatingGroupModal ? t('basecamp.create_group_btn') : t('basecamp.save_changes')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ══════════════════════════════════════════════════════════════════
                Modal — Task Detail (Basecamp 4 Full Replica: Edit, Move, @Mentions, Boosts, Subscribers)
               ══════════════════════════════════════════════════════════════════ */}
            {selectedTask &&
                (() => {
                    const parentList = lists.find((l) => l.id === selectedTaskListId)
                    const parentListIdx = lists.findIndex((l) => l.id === selectedTaskListId)
                    const listName = parentList?.list_name || t('basecamp.todos')
                    const listColorHex = resolveBasecampColorHex(
                        parentList?.color,
                        parentListIdx >= 0 ? parentListIdx : 0
                    )
                    const parentListGroups: any[] = Array.isArray(parentList?.groups) ? parentList.groups : []
                    const activeGroupObj = parentListGroups.find((g) => g.id === selectedTask.group_id) || null

                    const {
                        sanitizedHtml: richHtml,
                        nonImageAttachments,
                        allDownloadableAttachments,
                    } = prepareRichContent(selectedTask.description as string)
                    const hasNotesContent = Boolean(richHtml || nonImageAttachments.length > 0)
                    const dateRangeDisplay = formatTaskDateRangeBadge(
                        selectedTask.starts_on,
                        selectedTask.due_date
                    )
                    const canQuickAssignMe =
                        Boolean(currentPersonOption) &&
                        !(selectedTask.assigneeList || []).some((a: any) => isCurrentUserAssigned(a))

                    return (
                        <div
                            onClick={(e) => {
                                if (e.target === e.currentTarget) closeTaskDetail()
                            }}
                            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-2 sm:p-6 overflow-y-auto animate-in fade-in duration-200"
                            style={{
                                background: 'rgba(15, 23, 42, 0.65)',
                                backdropFilter: 'blur(8px)',
                                WebkitBackdropFilter: 'blur(8px)',
                            }}
                        >
                            <div
                                className="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200/80 dark:border-slate-800 w-full sm:max-w-3xl max-h-[92dvh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
                                style={{ boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.35)' }}
                            >
                                {/* ── 1. Sticky 1-Row Compact Top Bar: ← List + Adaptive Actions + ••• Menu + Close ── */}
                                <div className="relative z-50 px-3 sm:px-5 py-3 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-md flex-shrink-0 min-w-0">
                                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                        <button
                                            type="button"
                                            onClick={() => closeTaskDetail()}
                                            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 text-xs font-bold text-[#1D7DB5] dark:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-700/80 transition-all shadow-2xs cursor-pointer min-w-0"
                                        >
                                            <span
                                                className="w-2 h-2 rounded-full shrink-0"
                                                style={{ backgroundColor: listColorHex }}
                                            />
                                            <span className="truncate max-w-[120px] sm:max-w-[220px]">
                                                ← {listName}
                                            </span>
                                        </button>

                                        {activeGroupObj && (
                                            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 shrink-0 max-w-[150px]">
                                                <span
                                                    className="w-[7px] h-[7px] rounded-full shrink-0"
                                                    style={{
                                                        backgroundColor: resolveBasecampColorHex(
                                                            activeGroupObj.color,
                                                            2
                                                        ),
                                                    }}
                                                />
                                                <span className="truncate">{activeGroupObj.name}</span>
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                        {linkCopiedToast && (
                                            <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-bold">
                                                <Check size={12} />
                                                {t('basecamp.link_copied')}
                                            </span>
                                        )}

                                        <button
                                            type="button"
                                            disabled={replicatingTaskId === selectedTask.id}
                                            onClick={() => void handleReplicateTask(selectedTask)}
                                            title={t('basecamp.replicate_task_tooltip')}
                                            className="inline-flex items-center justify-center gap-1.5 w-8 h-8 sm:w-auto sm:h-8 sm:px-3 rounded-xl border border-[#1D7DB5] bg-[#1D7DB5] hover:bg-[#155D8A] text-white text-xs font-bold shadow-2xs transition-all cursor-pointer shrink-0 disabled:opacity-60"
                                        >
                                            {replicatingTaskId === selectedTask.id ? (
                                                <Loader2 size={13} className="animate-spin" />
                                            ) : (
                                                <span className="text-[13px] leading-none">📋</span>
                                            )}
                                            <span className="hidden sm:inline">{t('basecamp.replicate_task')}</span>
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (isEditingTask) {
                                                    setIsEditingTask(false)
                                                } else {
                                                    openTaskEditMode(selectedTask, 'title')
                                                }
                                            }}
                                            title={t('basecamp.edit_todo')}
                                            className={`inline-flex items-center justify-center gap-1.5 w-8 h-8 sm:w-auto sm:h-8 sm:px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer shrink-0 ${
                                                isEditingTask
                                                    ? 'bg-[#1D7DB5] border-[#1D7DB5] text-white'
                                                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                                            }`}
                                        >
                                            <Pencil size={13} />
                                            <span className="hidden sm:inline">{t('basecamp.edit_todo')}</span>
                                        </button>

                                        {/* ••• Basecamp Actions Dropdown */}
                                        <div ref={taskMoreMenuRef} className="relative z-50">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowEditAssigneeSuggestions(false)
                                                    setOpenCommentMenuId(null)
                                                    setOpenBoostPopoverKey(null)
                                                    setShowTaskMoreMenu((prev) => !prev)
                                                }}
                                                title={t('basecamp.more_actions')}
                                                className="w-8 h-8 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-all flex items-center justify-center cursor-pointer"
                                            >
                                                <MoreHorizontal size={16} />
                                            </button>

                                            {showTaskMoreMenu && (
                                                <div className="absolute right-0 top-full mt-1.5 min-w-[240px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-1.5 z-[90]">
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleReplicateTask(selectedTask)}
                                                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold text-[#0369A1] dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/40 cursor-pointer text-left"
                                                    >
                                                        <span>📋</span>
                                                        <span>{t('basecamp.replicate_task')}</span>
                                                    </button>

                                                    <button
                                                        type="button"
                                                        onClick={() => openTaskEditMode(selectedTask, 'title')}
                                                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-left"
                                                    >
                                                        <Pencil size={14} className="text-slate-500 dark:text-slate-400" />
                                                        <span>{t('basecamp.edit_todo')}</span>
                                                    </button>

                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            handleBubbleUpTask(
                                                                selectedTaskListId || selectedTask.todolist_id,
                                                                selectedTask
                                                            )
                                                        }
                                                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-left"
                                                    >
                                                        <ArrowUp size={14} className="text-[#1D7DB5]" />
                                                        <span>{t('basecamp.bubble_up')}</span>
                                                    </button>

                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            openMoveModalForTask(
                                                                selectedTask,
                                                                selectedTaskListId || selectedTask.todolist_id
                                                            )
                                                        }
                                                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-left"
                                                    >
                                                        <FolderOpen size={14} className="text-amber-600" />
                                                        <span>{t('basecamp.move_todo')}</span>
                                                    </button>

                                                    {allDownloadableAttachments.length > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                handleDownloadAllAttachments(
                                                                    allDownloadableAttachments
                                                                )
                                                            }
                                                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-left"
                                                        >
                                                            <Download size={14} className="text-[#1D7DB5]" />
                                                            <span>
                                                                {t('basecamp.download_all_attachments')} (
                                                                {allDownloadableAttachments.length})
                                                            </span>
                                                        </button>
                                                    )}

                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyTaskLink(selectedTask.id, true)}
                                                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-left"
                                                    >
                                                        <Copy size={14} className="text-slate-500 dark:text-slate-400" />
                                                        <span>{t('basecamp.copy_link')}</span>
                                                    </button>

                                                    <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />

                                                    <button
                                                        type="button"
                                                        onClick={(e) =>
                                                            handleDeleteTask(
                                                                selectedTaskListId || '',
                                                                selectedTask,
                                                                e
                                                            )
                                                        }
                                                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer text-left"
                                                    >
                                                        <Trash2 size={14} />
                                                        <span>{t('basecamp.put_in_trash')}</span>
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <button
                                            type="button"
                                            onClick={() => closeTaskDetail()}
                                            className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 font-bold transition-all flex items-center justify-center cursor-pointer shrink-0"
                                            title={t('basecamp.close_esc')}
                                        >
                                            <X size={16} />
                                        </button>
                                    </div>
                                </div>

                                {/* ── 2. Scrollable Body Content ── */}
                                <div className="relative z-10 overflow-y-auto flex-1 p-4 sm:p-7 space-y-5 min-w-0">
                                    {linkCopiedToast && (
                                        <div className="sm:hidden inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-bold">
                                            <Check size={12} />
                                            <span>{t('basecamp.link_copied')}</span>
                                        </div>
                                    )}
                                    {movedBannerText && (
                                        <div className="px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center justify-between">
                                            <span>✓ {movedBannerText}</span>
                                            <button
                                                type="button"
                                                onClick={() => setMovedBannerText(null)}
                                                className="text-emerald-700 font-extrabold cursor-pointer"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    )}

                                    {/* ── Move To-Do Panel (Project -> List -> Optional Group) ── */}
                                    {showMoveTaskModal && (
                                        <form
                                            onSubmit={handleMoveTaskSubmit}
                                            className="p-5 rounded-2xl bg-sky-50/70 dark:bg-slate-800/80 border border-sky-200 dark:border-slate-700 space-y-4"
                                        >
                                            <div className="flex items-center justify-between">
                                                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                                                    <FolderOpen size={16} className="text-[#1D7DB5]" />
                                                    {t('basecamp.move_todo_title')}
                                                </h3>
                                                <button
                                                    type="button"
                                                    onClick={() => setShowMoveTaskModal(false)}
                                                    className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
                                                >
                                                    ✕
                                                </button>
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                                <div>
                                                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                                                        {t('basecamp.destination_project')}
                                                    </label>
                                                    <select
                                                        value={moveTargetProjectDbId}
                                                        onChange={(e) => handleChangeMoveProject(e.target.value)}
                                                        disabled={moveLoadingCatalog}
                                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800 outline-none"
                                                    >
                                                        {moveProjects.map((p) => (
                                                            <option key={p.id} value={p.id}>
                                                                {p.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>

                                                <div>
                                                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                                                        {t('basecamp.destination_list')}
                                                    </label>
                                                    <select
                                                        value={moveTargetListDbId}
                                                        onChange={(e) => handleChangeMoveList(e.target.value)}
                                                        disabled={
                                                            moveLoadingCatalog || moveListsForProject.length === 0
                                                        }
                                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800 outline-none"
                                                    >
                                                        {moveListsForProject.map((l) => (
                                                            <option key={l.id} value={l.id}>
                                                                {l.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>

                                                <div>
                                                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                                                        {t('basecamp.destination_group')}
                                                    </label>
                                                    <select
                                                        value={moveTargetGroupDbId}
                                                        onChange={(e) => setMoveTargetGroupDbId(e.target.value)}
                                                        disabled={
                                                            moveLoadingCatalog || moveGroupsForList.length === 0
                                                        }
                                                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800 outline-none"
                                                    >
                                                        <option value="">{t('basecamp.ungrouped_todos')}</option>
                                                        {moveGroupsForList.map((g) => (
                                                            <option key={g.id} value={g.id}>
                                                                {g.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-end gap-2 pt-1">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowMoveTaskModal(false)}
                                                    className="px-4 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-600 cursor-pointer"
                                                >
                                                    {t('basecamp.cancel')}
                                                </button>
                                                <button
                                                    type="submit"
                                                    disabled={
                                                        !moveTargetListDbId ||
                                                        moveLoadingCatalog ||
                                                        actionLoading === `move_todo_${selectedTask.id}`
                                                    }
                                                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[#1D7DB5] hover:bg-[#155D8A] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                                                >
                                                    {actionLoading === `move_todo_${selectedTask.id}` && (
                                                        <Loader2 size={13} className="animate-spin" />
                                                    )}
                                                    {actionLoading === `move_todo_${selectedTask.id}`
                                                        ? t('basecamp.moving_todo')
                                                        : t('basecamp.move_btn')}
                                                </button>
                                            </div>
                                        </form>
                                    )}

                                    {/* ── Full Edit Mode OR Read View ── */}
                                    {isEditingTask ? (
                                        <form
                                            onSubmit={handleSaveTaskEdit}
                                            className="p-3.5 sm:p-5 rounded-2xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-4 min-w-0"
                                        >
                                            <div className="flex items-center gap-3 pb-3 border-b border-slate-200 dark:border-slate-700">
                                                <span className="w-6 h-6 rounded-lg border-2 border-slate-300 bg-white flex-shrink-0" />
                                                <input
                                                    ref={editTitleInputRef}
                                                    type="text"
                                                    required
                                                    value={editTaskTitle}
                                                    onChange={(e) => setEditTaskTitle(e.target.value)}
                                                    placeholder={t('basecamp.describe_todo')}
                                                    className="flex-1 text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white bg-white dark:bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 outline-none focus:border-[#1D7DB5]"
                                                />
                                            </div>

                                            {/* Assigned to + Assign to me (NO When done) */}
                                            <div className="relative z-30 flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-3">
                                                <label className="w-auto sm:w-[116px] text-left sm:text-right shrink-0 font-bold text-xs uppercase tracking-wider text-slate-500 sm:pt-2">
                                                    {t('basecamp.assigned_to')}
                                                </label>
                                                {renderAssigneePicker({
                                                    boxRef: editAssigneeBoxRef,
                                                    inputRef: editAssigneeInputRef,
                                                    selected: editTaskAssignees,
                                                    setSelected: setEditTaskAssignees,
                                                    query: editAssigneeSearchQuery,
                                                    setQuery: setEditAssigneeSearchQuery,
                                                    showMenu: showEditAssigneeSuggestions,
                                                    setShowMenu: setShowEditAssigneeSuggestions,
                                                    highlightedIdx: highlightedEditAssigneeIdx,
                                                    setHighlightedIdx: setHighlightedEditAssigneeIdx,
                                                })}
                                            </div>

                                            {/* Due on (3 Basecamp radio options) */}
                                            <div className="relative z-20 flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-3">
                                                <label className="w-auto sm:w-[116px] text-left sm:text-right shrink-0 font-bold text-xs uppercase tracking-wider text-slate-500 sm:pt-1">
                                                    {t('basecamp.due_on')}
                                                </label>
                                                {renderBasecampDateRadioSelector({
                                                    radioName: `edit_todo_date_${selectedTask.id}`,
                                                    mode: editTaskDateMode,
                                                    setMode: setEditTaskDateMode,
                                                    startsOn: editTaskStartsOn,
                                                    setStartsOn: setEditTaskStartsOn,
                                                    dueDate: editTaskDueDate,
                                                    setDueDate: setEditTaskDueDate,
                                                    sectionRef: editDateSectionRef,
                                                })}
                                            </div>

                                            {/* Group selector (if parent list has groups) */}
                                            {parentListGroups.length > 0 && (
                                                <div className="relative z-20 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                                                    <label className="w-auto sm:w-[116px] text-left sm:text-right shrink-0 font-bold text-xs uppercase tracking-wider text-slate-500">
                                                        {t('basecamp.group_label')}
                                                    </label>
                                                    <select
                                                        ref={editGroupSelectRef}
                                                        value={editTaskGroupId}
                                                        onChange={(e) => setEditTaskGroupId(e.target.value)}
                                                        className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 outline-none max-w-xs"
                                                    >
                                                        <option value="">{t('basecamp.ungrouped_todos')}</option>
                                                        {parentListGroups.map((g) => (
                                                            <option key={g.id} value={g.id}>
                                                                {g.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            )}

                                            {/* Rich Notes with @Mentions */}
                                            <div className="relative z-10 flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-3">
                                                <label className="w-auto sm:w-[116px] text-left sm:text-right shrink-0 font-bold text-xs uppercase tracking-wider text-slate-500 sm:pt-2">
                                                    {t('basecamp.notes_short_label')}
                                                </label>
                                                <div className="flex-1 min-w-0">
                                                    <BasecampRichEditor
                                                        editorKey={`edit-todo-${selectedTask.id}-${editSessionKey}`}
                                                        initialHtml={
                                                            selectedTask.rawDescription ??
                                                            selectedTask.description ??
                                                            ''
                                                        }
                                                        people={editorPeople}
                                                        autoFocus={editFocusTarget === 'notes'}
                                                        placeholder={`${t('basecamp.notes_placeholder')} · ${t(
                                                            'basecamp.mention_hint'
                                                        )}`}
                                                        uploadFolder={String(project.db_id || 'todos')}
                                                        minHeight={140}
                                                        maxHeight={360}
                                                        onChangeHtml={(html) => setEditTaskNotesHtml(html)}
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-end gap-2.5 pt-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setIsEditingTask(false)}
                                                    className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                                                >
                                                    {t('basecamp.cancel')}
                                                </button>
                                                <button
                                                    type="submit"
                                                    disabled={
                                                        !editTaskTitle.trim() ||
                                                        actionLoading === `edit_todo_${selectedTask.id}`
                                                    }
                                                    className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm cursor-pointer disabled:opacity-50"
                                                >
                                                    {actionLoading === `edit_todo_${selectedTask.id}` && (
                                                        <Loader2 size={14} className="animate-spin" />
                                                    )}
                                                    {actionLoading === `edit_todo_${selectedTask.id}`
                                                        ? t('basecamp.saving_changes')
                                                        : t('basecamp.save_changes')}
                                                </button>
                                            </div>
                                        </form>
                                    ) : (
                                        <>
                                            {/* ── Hero Title Section (Click title -> Edit Mode #37) ── */}
                                            <div className="space-y-3">
                                                <div className="flex items-start gap-3 sm:gap-4 min-w-0">
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            handleToggleTask(
                                                                selectedTaskListId || '',
                                                                selectedTask
                                                            )
                                                        }
                                                        disabled={actionLoading === selectedTask.id}
                                                        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 cursor-pointer transition-all duration-200 shadow-2xs ${
                                                            selectedTask.is_completed
                                                                ? 'bg-emerald-500 border-2 border-emerald-500 text-white hover:bg-emerald-600'
                                                                : 'border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                                                        }`}
                                                        title={
                                                            selectedTask.is_completed
                                                                ? t('basecamp.mark_incomplete')
                                                                : t('basecamp.mark_complete')
                                                        }
                                                    >
                                                        {selectedTask.is_completed ? (
                                                            <Check size={18} strokeWidth={3} />
                                                        ) : (
                                                            actionLoading === selectedTask.id && (
                                                                <Loader2
                                                                    className="animate-spin text-slate-400"
                                                                    size={14}
                                                                />
                                                            )
                                                        )}
                                                    </button>

                                                    <div className="flex-1 min-w-0">
                                                        <h2
                                                            onClick={() =>
                                                                openTaskEditMode(selectedTask, 'title')
                                                            }
                                                            title={t('basecamp.edit_todo')}
                                                            className={`text-xl sm:text-2xl font-extrabold tracking-tight leading-snug break-words transition-all cursor-pointer hover:text-[#1D7DB5] dark:hover:text-sky-400 ${
                                                                selectedTask.is_completed
                                                                    ? 'line-through text-slate-400 dark:text-slate-500'
                                                                    : 'text-slate-900 dark:text-white'
                                                            }`}
                                                        >
                                                            {selectedTask.task_name}
                                                        </h2>

                                                        <div className="flex items-center gap-3 mt-2 flex-wrap text-xs text-slate-500 dark:text-slate-400">
                                                            {selectedTask.is_completed && (
                                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-bold">
                                                                    ✓ {t('basecamp.completed_label')}
                                                                </span>
                                                            )}
                                                            {selectedTask.created_at && (
                                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium border border-slate-200/80 dark:border-slate-700">
                                                                    <Clock size={12} className="text-slate-400" />
                                                                    <span>{t('basecamp.created_at_label')}:</span>
                                                                    <strong className="font-semibold text-slate-700 dark:text-slate-200">
                                                                        {formatCreatedDateTime(
                                                                            selectedTask.created_at
                                                                        )}
                                                                    </strong>
                                                                </span>
                                                            )}
                                                            {selectedTask.creator_name && (
                                                                <span className="inline-flex items-center gap-1.5">
                                                                    {t('basecamp.added_by')}{' '}
                                                                    {renderPersonAvatar(
                                                                        selectedTask.creator_name,
                                                                        null,
                                                                        16
                                                                    )}
                                                                    <strong className="text-slate-700 dark:text-slate-300 font-semibold">
                                                                        {selectedTask.creator_name}
                                                                    </strong>
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* ── 3. Structured Metadata Grid (Click to quick-edit inline!) ── */}
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                                                {/* Assigned To (clickable + 1-click Assign to me) */}
                                                <div
                                                    onClick={() => openTaskEditMode(selectedTask, 'assignees')}
                                                    title={t('basecamp.edit_todo')}
                                                    className="space-y-1.5 p-2 -m-2 rounded-xl hover:bg-white/80 dark:hover:bg-slate-800 transition-all cursor-pointer"
                                                >
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                                            {t('basecamp.assign_to')}
                                                        </span>
                                                        {canQuickAssignMe && (
                                                            <button
                                                                type="button"
                                                                disabled={
                                                                    actionLoading ===
                                                                    `assign_me_${selectedTask.id}`
                                                                }
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    handleQuickAssignToMe(selectedTask)
                                                                }}
                                                                className="text-[11px] font-bold text-[#1D7DB5] hover:underline cursor-pointer"
                                                            >
                                                                + {t('basecamp.assign_to_me')}
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="flex flex-wrap gap-1.5 items-center">
                                                        {selectedTask.assigneeList &&
                                                        selectedTask.assigneeList.length > 0 ? (
                                                            selectedTask.assigneeList.map((a: any) => (
                                                                <span
                                                                    key={a.id}
                                                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 shadow-2xs"
                                                                    title={a.name}
                                                                >
                                                                    {renderPersonAvatar(
                                                                        a.name,
                                                                        a.avatar_url,
                                                                        16
                                                                    )}
                                                                    <span className="truncate max-w-[140px]">
                                                                        {a.name}
                                                                    </span>
                                                                </span>
                                                            ))
                                                        ) : (
                                                            <span className="text-xs text-slate-400 italic hover:text-[#1D7DB5]">
                                                                + {t('basecamp.no_assigned')}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Due Date / Date Range (clickable) */}
                                                <div
                                                    onClick={() => openTaskEditMode(selectedTask, 'dates')}
                                                    title={t('basecamp.edit_todo')}
                                                    className="space-y-1.5 p-2 -m-2 rounded-xl hover:bg-white/80 dark:hover:bg-slate-800 transition-all cursor-pointer"
                                                >
                                                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                                                        {t('basecamp.due_on')}
                                                    </span>
                                                    <div>
                                                        {dateRangeDisplay ? (
                                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/80 text-xs font-bold text-amber-800 dark:text-amber-300">
                                                                <Calendar size={12} />
                                                                {dateRangeDisplay}
                                                            </span>
                                                        ) : (
                                                            <span className="text-xs text-slate-400 italic hover:text-[#1D7DB5]">
                                                                + {t('basecamp.no_due_date')}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* ── 4. Description / Notes Section (Always visible with inline quick-add) + To-Do Boosts ── */}
                                            <div className={`${openBoostPopoverKey === 'todo' ? 'relative z-30' : 'relative z-10'} rounded-2xl bg-slate-50/60 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 space-y-3 min-w-0`}>
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                                        {t('basecamp.notes_label')}
                                                    </span>
                                                    {hasNotesContent && (
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                openTaskEditMode(selectedTask, 'notes')
                                                            }
                                                            className="inline-flex items-center gap-1 text-[11px] font-bold text-[#1D7DB5] hover:underline cursor-pointer"
                                                        >
                                                            <Pencil size={11} />
                                                            {t('basecamp.edit_todo')}
                                                        </button>
                                                    )}
                                                </div>

                                                {hasNotesContent ? (
                                                    <>
                                                        {richHtml && (
                                                            <div
                                                                className="bc-rich-text text-slate-800 dark:text-slate-200 min-w-0"
                                                                onClick={handleHtmlClick}
                                                                dangerouslySetInnerHTML={{
                                                                    __html: injectImageDownloadOverlays(
                                                                        formatBasecampRichHtmlForDisplay(richHtml),
                                                                        t('basecamp.download_btn')
                                                                    ),
                                                                }}
                                                            />
                                                        )}

                                                        {nonImageAttachments.length > 0 && (
                                                            <div className="pt-3 border-t border-slate-200/80 dark:border-slate-700/80 flex flex-wrap gap-2">
                                                                {nonImageAttachments.map(
                                                                    (att: any, attIdx: number) => (
                                                                        <a
                                                                            key={attIdx}
                                                                            href={buildBasecampDirectDownloadHref(
                                                                                sanitizeAttachmentHref(
                                                                                    att.url || att.href
                                                                                ),
                                                                                att.filename
                                                                            )}
                                                                            onClick={(e) => {
                                                                                e.preventDefault()
                                                                                triggerBasecampDownload(
                                                                                    sanitizeAttachmentHref(
                                                                                        att.url || att.href
                                                                                    ),
                                                                                    att.filename
                                                                                )
                                                                            }}
                                                                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-[#1D7DB5] text-xs font-semibold text-slate-700 dark:text-slate-200 transition-all shadow-2xs"
                                                                        >
                                                                            <Paperclip
                                                                                size={13}
                                                                                className="text-[#1D7DB5]"
                                                                            />
                                                                            <span className="truncate max-w-[200px]">
                                                                                {safeDecodeFilename(
                                                                                    att.filename
                                                                                ) ||
                                                                                    t(
                                                                                        'basecamp.attached_file_fallback'
                                                                                    )}
                                                                            </span>
                                                                            <span className="text-[10px] font-bold text-[#1D7DB5]">
                                                                                {t('basecamp.download_btn')}
                                                                            </span>
                                                                        </a>
                                                                    )
                                                                )}
                                                            </div>
                                                        )}
                                                    </>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => openTaskEditMode(selectedTask, 'notes')}
                                                        className="w-full py-2.5 px-3.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-[#1D7DB5] text-xs font-semibold text-slate-500 hover:text-[#1D7DB5] text-left transition-all cursor-pointer"
                                                    >
                                                        {t('basecamp.add_notes_inline')}
                                                    </button>
                                                )}

                                                {/* To-Do Boosts (🚀) */}
                                                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800">
                                                    {renderBoostBar(
                                                        'todo',
                                                        selectedTask.id,
                                                        selectedTask.bc_id,
                                                        taskBoosts,
                                                        'todo'
                                                    )}
                                                </div>
                                            </div>
                                        </>
                                    )}

                                    {/* ── 5. Discussion / Comments Stream (Rich Editor + Reply + ••• Edit/Delete + Boosts) ── */}
                                    <div className="space-y-4 pt-2">
                                        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                                            <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                                <MessageSquare size={15} className="text-[#1D7DB5]" />
                                                {t('basecamp.comments_title')} (
                                                {commentsLoading && taskComments.length === 0
                                                    ? selectedTask.comments_count || 0
                                                    : taskComments.length}
                                                )
                                            </h4>
                                        </div>

                                        {commentsLoading ? (
                                            <div className="text-center py-8 text-[#1D7DB5]">
                                                <Loader2 className="animate-spin mx-auto w-6 h-6" />
                                            </div>
                                        ) : taskComments && taskComments.length > 0 ? (
                                            <div className="space-y-4">
                                                {taskComments.map((c: any, idx: number) => {
                                                    const {
                                                        sanitizedHtml: commentHtml,
                                                        nonImageAttachments: commentFiles,
                                                    } = prepareRichContent(c.text)
                                                    const isEditingThisComment = editingCommentId === c.id
                                                    const isCommentMenuOpen = openCommentMenuId === c.id
                                                    const isCommentBoostOpen = openBoostPopoverKey === `comment:${c.id}`
                                                    const cBoosts = commentBoostsMap[c.id] || []
                                                    const wasEdited =
                                                        Boolean(c.updated_at && c.timestamp) &&
                                                        new Date(c.updated_at).getTime() -
                                                            new Date(c.timestamp).getTime() >
                                                            5000

                                                    return (
                                                        <div
                                                            key={c.id || idx}
                                                            className={`${isCommentMenuOpen || isCommentBoostOpen ? 'relative z-40' : 'relative z-0'} flex items-start gap-2.5 sm:gap-3.5 p-3 sm:p-4 rounded-2xl bg-white dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 shadow-2xs min-w-0`}
                                                        >
                                                            <div className="flex-shrink-0 mt-0.5">
                                                                {renderPersonAvatar(
                                                                    c.author,
                                                                    c.author_avatar_url,
                                                                    32
                                                                )}
                                                            </div>

                                                            <div className="flex-1 min-w-0 space-y-2">
                                                                <div className="flex items-center justify-between flex-wrap gap-2">
                                                                    <div className="flex items-center gap-2 flex-wrap">
                                                                        <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                                                                            {c.author}
                                                                        </span>
                                                                        <span className="text-[11px] text-slate-400">
                                                                            {formatCreatedDateTime(c.timestamp)}
                                                                        </span>
                                                                        {wasEdited && (
                                                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 font-semibold">
                                                                                {t('basecamp.edited_badge')}
                                                                            </span>
                                                                        )}
                                                                    </div>

                                                                    {!isEditingThisComment && (
                                                                        <div className="flex items-center gap-1.5">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    handleReplyToComment(c)
                                                                                }
                                                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-slate-500 hover:text-[#1D7DB5] hover:bg-slate-100 cursor-pointer"
                                                                            >
                                                                                <Reply size={12} />
                                                                                {t('basecamp.reply_comment')}
                                                                            </button>

                                                                            <div
                                                                                data-bc-comment-menu="true"
                                                                                className="relative"
                                                                            >
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={(ev) => {
                                                                                        const btnEl = ev.currentTarget as HTMLElement
                                                                                        const btnRect = btnEl.getBoundingClientRect()
                                                                                        const scrollContainer = btnEl.closest('.overflow-y-auto')
                                                                                        const bottomLimit = scrollContainer
                                                                                            ? scrollContainer.getBoundingClientRect().bottom
                                                                                            : typeof window !== 'undefined'
                                                                                            ? window.innerHeight
                                                                                            : 800
                                                                                        setCommentMenuUp(bottomLimit - btnRect.bottom < 130)
                                                                                        setShowTaskMoreMenu(false)
                                                                                        setOpenBoostPopoverKey(null)
                                                                                        setOpenCommentMenuId(
                                                                                            (prev) =>
                                                                                                prev === c.id
                                                                                                    ? null
                                                                                                    : c.id
                                                                                        )
                                                                                    }}
                                                                                    className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                                                                                    title={t(
                                                                                        'basecamp.more_actions'
                                                                                    )}
                                                                                >
                                                                                    <MoreHorizontal size={15} />
                                                                                </button>

                                                                                {isCommentMenuOpen && (
                                                                                    <div
                                                                                        className={`absolute right-0 ${commentMenuUp ? 'bottom-full mb-1.5' : 'top-full mt-1'} min-w-[185px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-1.5 z-50`}
                                                                                    >
                                                                                        <button
                                                                                            type="button"
                                                                                            onClick={() => {
                                                                                                setOpenCommentMenuId(
                                                                                                    null
                                                                                                )
                                                                                                const rawCom =
                                                                                                    stripTegAuthorBanner(
                                                                                                        c.rawText ||
                                                                                                            c.text ||
                                                                                                            ''
                                                                                                    ).cleanHtml
                                                                                                setEditingCommentHtml(
                                                                                                    rawCom
                                                                                                )
                                                                                                setEditingCommentIsEmpty(
                                                                                                    !hasRichContentOrMedia(
                                                                                                        rawCom
                                                                                                    )
                                                                                                )
                                                                                                setEditingCommentId(
                                                                                                    c.id
                                                                                                )
                                                                                            }}
                                                                                            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-left"
                                                                                        >
                                                                                            <Pencil size={12} />
                                                                                            <span>
                                                                                                {t(
                                                                                                    'basecamp.edit_comment'
                                                                                                )}
                                                                                            </span>
                                                                                        </button>
                                                                                        <button
                                                                                            type="button"
                                                                                            onClick={() =>
                                                                                                handleDeleteComment(
                                                                                                    c
                                                                                                )
                                                                                            }
                                                                                            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer text-left"
                                                                                        >
                                                                                            <Trash2 size={12} />
                                                                                            <span>
                                                                                                {t(
                                                                                                    'basecamp.delete_comment'
                                                                                                )}
                                                                                            </span>
                                                                                        </button>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>

                                                                {isEditingThisComment ? (
                                                                    <div className="space-y-2 pt-1">
                                                                        <BasecampRichEditor
                                                                            compact
                                                                            autoFocus
                                                                            editorKey={`edit-comment-${c.id}`}
                                                                            initialHtml={c.rawText || c.text || ''}
                                                                            people={editorPeople}
                                                                            uploadFolder={String(
                                                                                project.db_id || 'comments'
                                                                            )}
                                                                            minHeight={90}
                                                                            maxHeight={260}
                                                                            onChangeHtml={(html, empty) => {
                                                                                setEditingCommentHtml(html)
                                                                                setEditingCommentIsEmpty(empty)
                                                                            }}
                                                                            onSubmitShortcut={() =>
                                                                                handleSaveEditedComment(c)
                                                                            }
                                                                        />
                                                                        <div className="flex items-center justify-end gap-2">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    setEditingCommentId(null)
                                                                                }
                                                                                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-600 cursor-pointer"
                                                                            >
                                                                                {t('basecamp.cancel')}
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                disabled={
                                                                                    editingCommentIsEmpty ||
                                                                                    actionLoading ===
                                                                                        `edit_comment_${c.id}`
                                                                                }
                                                                                onClick={() =>
                                                                                    handleSaveEditedComment(c)
                                                                                }
                                                                                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                                                                            >
                                                                                {actionLoading ===
                                                                                    `edit_comment_${c.id}` && (
                                                                                    <Loader2
                                                                                        size={12}
                                                                                        className="animate-spin"
                                                                                    />
                                                                                )}
                                                                                {t('basecamp.save_changes')}
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <>
                                                                        {commentHtml && (
                                                                            <div
                                                                                className="bc-rich-text text-slate-700 dark:text-slate-300 min-w-0"
                                                                                onClick={handleHtmlClick}
                                                                                dangerouslySetInnerHTML={{
                                                                                    __html: injectImageDownloadOverlays(
                                                                                        formatBasecampRichHtmlForDisplay(
                                                                                            commentHtml
                                                                                        ),
                                                                                        t('basecamp.download_btn')
                                                                                    ),
                                                                                }}
                                                                            />
                                                                        )}

                                                                        {commentFiles.length > 0 && (
                                                                            <div className="pt-1 flex flex-wrap gap-2">
                                                                                {commentFiles.map(
                                                                                    (
                                                                                        att: any,
                                                                                        attIdx: number
                                                                                    ) => (
                                                                                        <a
                                                                                            key={attIdx}
                                                                                            href={buildBasecampDirectDownloadHref(
                                                                                                sanitizeAttachmentHref(
                                                                                                    att.url ||
                                                                                                        att.href
                                                                                                ),
                                                                                                att.filename
                                                                                            )}
                                                                                            onClick={(e) => {
                                                                                                e.preventDefault()
                                                                                                triggerBasecampDownload(
                                                                                                    sanitizeAttachmentHref(
                                                                                                        att.url ||
                                                                                                            att.href
                                                                                                    ),
                                                                                                    att.filename
                                                                                                )
                                                                                            }}
                                                                                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-[#1D7DB5] text-xs font-semibold text-slate-700 dark:text-slate-200 transition-all"
                                                                                        >
                                                                                            <Paperclip
                                                                                                size={13}
                                                                                                className="text-[#1D7DB5]"
                                                                                            />
                                                                                            <span className="truncate max-w-[200px]">
                                                                                                {safeDecodeFilename(
                                                                                                    att.filename
                                                                                                ) ||
                                                                                                    t(
                                                                                                        'basecamp.attached_file_fallback'
                                                                                                    )}
                                                                                            </span>
                                                                                            <span className="text-[10px] font-bold text-[#1D7DB5]">
                                                                                                {t(
                                                                                                    'basecamp.download_btn'
                                                                                                )}
                                                                                            </span>
                                                                                        </a>
                                                                                    )
                                                                                )}
                                                                            </div>
                                                                        )}

                                                                        {/* Comment Boosts (🚀) */}
                                                                        {renderBoostBar(
                                                                            'comment',
                                                                            c.id,
                                                                            c.bc_id,
                                                                            cBoosts,
                                                                            `comment:${c.id}`
                                                                        )}
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        ) : (
                                            <div className="text-center py-8 px-4 rounded-2xl bg-slate-50/60 dark:bg-slate-800/30 border border-dashed border-slate-200 dark:border-slate-800">
                                                <MessageSquare
                                                    size={24}
                                                    className="text-slate-300 dark:text-slate-600 mx-auto mb-2"
                                                />
                                                <p className="text-xs text-slate-400 font-medium">
                                                    {t('basecamp.no_comments_desc')}
                                                </p>
                                            </div>
                                        )}
                                    </div>

                                    {/* ── 6. Email-Notified People (Subscribers) Informational Footer ── */}
                                    <div className="relative z-0 p-4 rounded-2xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 space-y-2">
                                        <div className="flex items-center gap-2 text-xs font-extrabold text-slate-700 dark:text-slate-200">
                                            <Mail size={14} className="text-[#1D7DB5]" />
                                            <span>{t('basecamp.subscribers_title')}</span>
                                            <span className="px-2 py-0.5 rounded-full bg-slate-200/80 dark:bg-slate-700 text-[11px] text-slate-600 dark:text-slate-300">
                                                {notifiedSubscribers.length}
                                            </span>
                                        </div>

                                        {notifiedSubscribers.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5 pt-0.5">
                                                {notifiedSubscribers.map((sub) => (
                                                    <span
                                                        key={sub.id}
                                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300"
                                                    >
                                                        {renderPersonAvatar(sub.name, sub.avatar_url, 16)}
                                                        <span>{sub.name}</span>
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        <p className="text-[11.5px] text-slate-500 dark:text-slate-400 leading-relaxed">
                                            {t('basecamp.subscribers_desc')}
                                        </p>
                                    </div>
                                </div>

                                {/* ── 7. Bottom Sticky Rich Comment Input Form (Trix + Photos/Files + @Mentions) ── */}
                                <div
                                    ref={commentFormRef}
                                    className="relative z-20 p-3 sm:p-4 bg-slate-50/95 dark:bg-slate-900/95 border-t border-slate-100 dark:border-slate-800 backdrop-blur-md flex-shrink-0"
                                >
                                    <form onSubmit={handleAddComment} className="flex gap-2.5 sm:gap-3 items-start min-w-0">
                                        <div className="hidden sm:block flex-shrink-0 mt-1">
                                            {renderPersonAvatar(
                                                currentPersonOption?.name || effectiveUserName || 'User',
                                                currentPersonOption?.avatar_url,
                                                32
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0 space-y-2">
                                            <BasecampRichEditor
                                                compact
                                                editorKey={`new-comment-${selectedTask.id}-${commentEditorSeed}`}
                                                focusSeq={commentFocusSeq}
                                                initialHtml={commentDraftInitialHtml}
                                                people={editorPeople}
                                                placeholder={t('basecamp.add_comment_placeholder')}
                                                uploadFolder={String(project.db_id || 'comments')}
                                                minHeight={74}
                                                maxHeight={220}
                                                onChangeHtml={(html, empty) => {
                                                    setNewCommentHtml(html)
                                                    setNewCommentIsEmpty(empty)
                                                }}
                                                onSubmitShortcut={() => handleAddComment()}
                                            />

                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-[11px] text-slate-400 font-medium">
                                                    {t('basecamp.mention_hint')}
                                                </span>
                                                <button
                                                    type="submit"
                                                    disabled={
                                                        actionLoading === 'comment' || newCommentIsEmpty
                                                    }
                                                    className="ml-auto inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-all cursor-pointer disabled:opacity-50"
                                                >
                                                    {actionLoading === 'comment' ? (
                                                        <Loader2 className="animate-spin" size={14} />
                                                    ) : (
                                                        t('basecamp.post_comment')
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        </div>
                    )
                })()}

            {/* ── Fullscreen Image Lightbox ── */}
            {lightboxUrl && (
                <div
                    onClick={() => setLightboxUrl(null)}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 100,
                        background: 'rgba(0,0,0,0.85)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'zoom-out',
                        padding: 20,
                    }}
                >
                    <button
                        onClick={(e) => {
                            e.stopPropagation()
                            setLightboxUrl(null)
                        }}
                        style={{
                            position: 'absolute',
                            top: 20,
                            right: 20,
                            width: 40,
                            height: 40,
                            borderRadius: '50%',
                            background: 'rgba(255,255,255,0.15)',
                            border: '1px solid rgba(255,255,255,0.3)',
                            color: '#fff',
                            fontSize: 20,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        ✕
                    </button>
                    <img
                        src={lightboxUrl}
                        alt={t('basecamp.fullscreen_view')}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            maxWidth: '90vw',
                            maxHeight: '90vh',
                            objectFit: 'contain',
                            borderRadius: 8,
                            boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
                            cursor: 'default',
                        }}
                    />
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation()
                            triggerBasecampDownload(lightboxUrl)
                        }}
                        style={{
                            position: 'absolute',
                            bottom: 22,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '10px 22px',
                            borderRadius: 24,
                            background: '#1D7DB5',
                            border: '1px solid rgba(255,255,255,0.35)',
                            color: '#fff',
                            fontSize: 13.5,
                            fontWeight: 700,
                            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                            cursor: 'pointer',
                        }}
                    >
                        {t('basecamp.download_btn')}
                    </button>
                </div>
            )}
        </div>
    )
}
