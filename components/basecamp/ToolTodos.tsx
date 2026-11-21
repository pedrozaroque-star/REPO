/**
 * @module ToolTodos
 * @description Módulo de listas de tareas (To-dos) para coordinar las operaciones de Tacos Gavilan.
 *              Conecta directamente con Supabase (tablas bc_todolists, bc_todos, bc_todo_assignees, bc_comments)
 *              y realiza escrituras bidireccionales en Basecamp API a través de /api/basecamp/action.
 * @businessRules
 *   - Completar/descompletar tareas actualiza el estado de la tarea tanto en Supabase como en la API de Basecamp.
 *   - La creación de listas y tareas se propaga a la API de Basecamp si la cuenta está integrada, o se ejecuta localmente.
 *   - Los comentarios agregados a una tarea se guardan polimórficamente en `bc_comments`.
 * @dataFlow
 *   - Entrada: Props `project` (contiene db_id y bc_id) y `currentUserName`.
 *   - Fetch: Carga todas las listas y tareas de Supabase al montar y al realizar mutaciones.
 *   - Escritura: Envía peticiones POST a `/api/basecamp/action`.
 * @notes
 *   - Soporte multilingüe (ES/EN) con useLanguage.
 *   - Modo standalone: las operaciones funcionan directamente con Supabase si no hay token de Basecamp configurado.
 *   - Corrección de rendimiento: queries en paralelo con Promise.all y select de columnas mínimas
 *     para evitar transferir HTML pesado de descriptions en la vista de lista.
 *   - Corrección de error crítico "Bad Request" (PostgREST 400): Se cambió la consulta de comentarios
 *     para filtrar por project_id y parent_type en lugar de una lista in-clause con todos los UUIDs de tareas,
 *     evitando exceder el límite de longitud de URL del Gateway Kong de Supabase cuando hay más de ~200 tareas.
 *   - Diseño visual clonado del Basecamp 3/4 clásico: containers blancos con bordes #E8E6E1, header #FAFAF8,
 *     items con dividers sutiles, checkboxes con accent verde, metadata en gris #6B7B8D.
 *   - Norwalk accident todo image duplication fix: Added regex checking for blob UUIDs (`/blobs/[a-f0-9-]+`) in `parseAttachments`
 *     to properly match inner `<img>` tags to their parent `<bc-attachment>` tags.
 *   - Audit fixes (2026): Fixed `rewriteHtmlUrls` closing-quote regex for attributes containing `/`,
 *     stripped TEG author banners via `stripTegAuthorBanner`, fixed `parseAttachments` attribute word boundary,
 *     restored Rich-Text Notes + Supabase Storage upload (`checklist-photos/basecamp-uploads/`) in Add To-do form,
 *     fixed live hydration top-level fields + AbortController race guard + local comment preservation,
 *     ordered completed tasks by `completed_at` DESC with per-list lazy fetch, and normalized accents/timezones.
 */

'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useLanguage } from '@/lib/i18n'
import { ClipboardList, Plus, Trash2, Calendar, Clock, User, MessageSquare, CheckSquare, Loader2, ChevronDown, ChevronRight, FileText, Paperclip, Bold, Italic, Strikethrough, Highlighter, Link, Quote, Code, List, ListOrdered, Table, AlignLeft, Mic, Image, Type, Undo2, Redo2, Check } from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { stripTegAuthorBanner, normalizePersonName } from '@/lib/basecamp-person-resolver'
import { rewriteBasecampHtmlUrls, safeDecodeFilename, sanitizeBasecampHtml } from '@/lib/basecamp-html'
import { compressImage } from '@/lib/image-compression'

export { sanitizeBasecampHtml }

const SYNTHETIC_BC_ID_THRESHOLD = 100_000_000_000

interface ToolTodosProps {
    project: any
    currentUserName: string
    selectedTodoId?: string
    onCloseDetail?: () => void
    navigateTo?: (params: any) => void
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

const plainTextToHtml = (raw: string): string => {
    const trimmed = raw.trim()
    if (!trimmed) return ''
    return trimmed
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/\r?\n/g, '<br>')
}

const escapeHtmlAttr = (raw: string): string =>
    raw
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')

const parseAttachments = (html: string) => {
    const attachments: any[] = []
    if (!html) return attachments

    const bcAttachmentRegex = /<bc-attachment\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/bc-attachment>)/gi
    let match
    while ((match = bcAttachmentRegex.exec(html)) !== null) {
        const attrsStr = match[1]
        
        const getAttr = (name: string) => {
            const m = attrsStr.match(new RegExp(`(?:^|\\s)${name}=["']([^"']+)["']`, 'i'))
            return m ? m[1] : null
        }
        
        const contentType = getAttr('content-type') || ''
        const filename = getAttr('filename') || ''
        const href = getAttr('href') || ''
        const url = getAttr('url') || href || ''
        
        attachments.push({
            contentType,
            filename,
            href,
            url
        })
    }
    
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
    let imgMatch
    while ((imgMatch = imgRegex.exec(html)) !== null) {
        const src = imgMatch[1]
        const isAlreadyCaptured = attachments.some(a => {
            const srcUuid = getBlobUuid(src)
            const aUrlUuid = getBlobUuid(a.url)
            const aHrefUuid = getBlobUuid(a.href)
            
            if (srcUuid && (srcUuid === aUrlUuid || srcUuid === aHrefUuid)) {
                return true
            }
            
            const srcKey = src.split('/').pop()?.split('?')[0]
            const aUrlKey = a.url.split('/').pop()?.split('?')[0]
            const aHrefKey = a.href.split('/').pop()?.split('?')[0]
            return srcKey && (srcKey === aUrlKey || srcKey === aHrefKey)
        })
        if (isAlreadyCaptured) continue
        
        let filename = 'Image'
        const altMatch = imgMatch[0].match(/alt=["']([^"']+)["']/i)
        if (altMatch) {
            filename = altMatch[1]
        } else {
            const lastPart = src.split('/').pop()?.split('?')[0] || 'image.png'
            filename = lastPart === 'full' ? 'Image' : lastPart
        }
        
        attachments.push({
            contentType: 'image/png',
            filename,
            href: src,
            url: src
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
    if (!rawHtml) return { sanitizedHtml: '', nonImageAttachments: [] as any[], whenDoneNames: '' }
    let whenDoneNames = ''
    const whenDoneMatch = rawHtml.match(/<span\b[^>]*\bdata-teg-when-done=["']([^"']*)["'][^>]*>[\s\S]*?<\/span>/i)
    if (whenDoneMatch?.[1]) {
        whenDoneNames = whenDoneMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim()
    }
    const cleaned = stripTegAuthorBanner(rawHtml).cleanHtml
        .replace(/<p\b[^>]*\bdata-teg-author=["'][^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')
        .replace(/<span\b[^>]*\bdata-teg-when-done=["'][^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '')
    const allAttachments = parseAttachments(cleaned)
    const nonImageAttachments = allAttachments.filter(a => {
        const ct = (a.contentType || '').toLowerCase()
        const fn = (a.filename || '').toLowerCase()
        return !ct.startsWith('image/') && !fn.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)
    })
    const strippedBcHtml = cleaned
        .replace(/<bc-attachment\b[^>]*>([\s\S]*?)<\/bc-attachment>/gi, (_match, inner) => {
            if (/<img\b[^>]+>/i.test(inner)) return inner
            return ''
        })
        .replace(/<bc-attachment\b[^>]*\/>/gi, '')
        .trim()
    const sanitizedHtml = rewriteHtmlUrls(strippedBcHtml)
    return { sanitizedHtml, nonImageAttachments, whenDoneNames }
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

export default function ToolTodos({ project, currentUserName, selectedTodoId, onCloseDetail, navigateTo }: ToolTodosProps) {
    const supabase = useMemo(() => getSupabaseWithAuth(), [])
    const { t, language } = useLanguage()
    const [lists, setLists] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState<string | null>(null)

    // Estados para modo de visualización (cards por defecto o lista) y orden por fecha de creación
    const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards')
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('oldest')
    const [showViewAsMenu, setShowViewAsMenu] = useState(false)
    const viewAsMenuRef = useRef<HTMLDivElement>(null)

    // Listener para cerrar menú View as al hacer clic fuera
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (viewAsMenuRef.current && !viewAsMenuRef.current.contains(e.target as Node)) {
                setShowViewAsMenu(false)
            }
        }
        if (showViewAsMenu) {
            document.addEventListener('mousedown', handleClickOutside)
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [showViewAsMenu])

    // Estados para crear lista
    const [showAddList, setShowAddList] = useState(false)
    const [newListName, setNewListName] = useState('')
    const [newListDesc, setNewListDesc] = useState('')

    // Estados para crear tarea
    const [addingTaskId, setAddingTaskId] = useState<string | null>(null)
    const [newTaskName, setNewTaskName] = useState('')
    const [newTaskAssignees, setNewTaskAssignees] = useState<any[]>([])
    const [assigneeSearchQuery, setAssigneeSearchQuery] = useState('')
    const [showAssigneeSuggestions, setShowAssigneeSuggestions] = useState(false)
    const [highlightedAssigneeIdx, setHighlightedAssigneeIdx] = useState(0)
    const [newTaskNotifyees, setNewTaskNotifyees] = useState<any[]>([])
    const [notifySearchQuery, setNotifySearchQuery] = useState('')
    const [showNotifySuggestions, setShowNotifySuggestions] = useState(false)
    const [highlightedNotifyIdx, setHighlightedNotifyIdx] = useState(0)
    const [newTaskDueDate, setNewTaskDueDate] = useState('')
    const [newTaskNotes, setNewTaskNotes] = useState('')
    const [notesIsEmpty, setNotesIsEmpty] = useState(true)
    const [isDraggingOverNotes, setIsDraggingOverNotes] = useState(false)
    const [showSubtasksInput, setShowSubtasksInput] = useState(false)
    const [newTaskSubtasks, setNewTaskSubtasks] = useState<string[]>([''])
    // Inline Link bar states
    const [showLinkBar, setShowLinkBar] = useState(false)
    const [linkUrl, setLinkUrl] = useState('')
    const [linkText, setLinkText] = useState('')
    const savedSelectionRef = React.useRef<Range | null>(null)
    // Inline Table controls states
    const [showTableControls, setShowTableControls] = useState(false)
    const [tableRows, setTableRows] = useState(3)
    const [tableCols, setTableCols] = useState(3)
    // Toolbar dropdown menus
    const [showTextSizeMenu, setShowTextSizeMenu] = useState(false)
    const [showColorMenu, setShowColorMenu] = useState(false)

    // Estados de detalle de tarea y lista seleccionada
    const [selectedListId, setSelectedListId] = useState<string | null>(null)
    const [selectedTask, setSelectedTask] = useState<any | null>(null)
    const [selectedTaskListId, setSelectedTaskListId] = useState<string | null>(null)
    const [taskComments, setTaskComments] = useState<any[]>([])
    const [commentsLoading, setCommentsLoading] = useState(false)
    const [newComment, setNewComment] = useState('')
    const [commentAttachments, setCommentAttachments] = useState<Array<{ url: string; filename: string; contentType: string; size: number }>>([])
    const [uploadingCommentAttachment, setUploadingCommentAttachment] = useState(false)
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
    const [todoFilterQuery, setTodoFilterQuery] = useState('')
    const [uploadingAttachment, setUploadingAttachment] = useState(false)
    const [uploadError, setUploadError] = useState<string | null>(null)
    const [mutationError, setMutationError] = useState<string | null>(null)
    const [loadingCompletedByList, setLoadingCompletedByList] = useState<Record<string, boolean>>({})

    // Refs for race-condition guards and click-outside menus
    const assigneeBoxRef = useRef<HTMLDivElement>(null)
    const notifyBoxRef = useRef<HTMLDivElement>(null)
    const textSizeMenuRef = useRef<HTMLDivElement>(null)
    const colorMenuRef = useRef<HTMLDivElement>(null)
    const commentImageInputRef = useRef<HTMLInputElement>(null)
    const commentFileInputRef = useRef<HTMLInputElement>(null)
    const activeSelectedTaskIdRef = useRef<string | null>(null)
    const selectedTaskRef = useRef<any | null>(null)
    const commentFetchAbortRef = useRef<AbortController | null>(null)
    const peopleLookupRef = useRef<Map<string, string>>(new Map())

    selectedTaskRef.current = selectedTask
    activeSelectedTaskIdRef.current = selectedTask?.id || null

    // ── Rich text editor helpers (contentEditable + Selection-safe execCommand) ──
    const notesEditorRef = React.useRef<HTMLDivElement>(null)
    const fileInputRef = React.useRef<HTMLInputElement>(null)
    const attachmentInputRef = React.useRef<HTMLInputElement>(null)
    // Custom undo/redo history scoped ONLY to the Notes editor
    const editorHistoryRef = React.useRef<string[]>([''])
    const editorHistoryIdxRef = React.useRef<number>(0)
    const editorIsUndoingRef = React.useRef<boolean>(false)

    const syncNotesEmptyState = useCallback(() => {
        const editor = notesEditorRef.current
        if (!editor) {
            setNotesIsEmpty(true)
            return
        }
        const hasStructuredContent = Boolean(editor.querySelector('img, bc-attachment, table, pre, blockquote, ul, ol, hr'))
        const plain = (editor.textContent || '').replace(/\u00a0/g, ' ').trim()
        const empty = !hasStructuredContent && plain.length === 0
        setNotesIsEmpty(prev => (prev === empty ? prev : empty))
    }, [])

    const saveEditorSelection = useCallback(() => {
        const editor = notesEditorRef.current
        if (!editor) return
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
            savedSelectionRef.current = sel.getRangeAt(0).cloneRange()
        }
    }, [])

    const restoreEditorSelection = useCallback(() => {
        const editor = notesEditorRef.current
        if (!editor) return
        editor.focus()
        if (savedSelectionRef.current && editor.contains(savedSelectionRef.current.startContainer)) {
            const sel = window.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(savedSelectionRef.current)
        }
    }, [])

    const editorSaveSnapshot = () => {
        if (editorIsUndoingRef.current) return
        const html = notesEditorRef.current?.innerHTML || ''
        const history = editorHistoryRef.current
        const idx = editorHistoryIdxRef.current
        if (history[idx] === html) return
        editorHistoryRef.current = history.slice(0, idx + 1)
        editorHistoryRef.current.push(html)
        if (editorHistoryRef.current.length > 100) editorHistoryRef.current.shift()
        editorHistoryIdxRef.current = editorHistoryRef.current.length - 1
    }

    const editorUndo = () => {
        const history = editorHistoryRef.current
        const idx = editorHistoryIdxRef.current
        if (idx <= 0) return
        editorIsUndoingRef.current = true
        editorHistoryIdxRef.current = idx - 1
        const editor = notesEditorRef.current
        if (editor) editor.innerHTML = history[idx - 1]
        editorIsUndoingRef.current = false
        syncNotesEmptyState()
        focusEditor()
    }

    const editorRedo = () => {
        const history = editorHistoryRef.current
        const idx = editorHistoryIdxRef.current
        if (idx >= history.length - 1) return
        editorIsUndoingRef.current = true
        editorHistoryIdxRef.current = idx + 1
        const editor = notesEditorRef.current
        if (editor) editor.innerHTML = history[idx + 1]
        editorIsUndoingRef.current = false
        syncNotesEmptyState()
        focusEditor()
    }

    const focusEditor = () => {
        const editor = notesEditorRef.current
        if (editor) editor.focus()
    }

    const execCmd = (command: string, value?: string) => {
        restoreEditorSelection()
        document.execCommand(command, false, value || '')
        saveEditorSelection()
        syncNotesEmptyState()
        editorSaveSnapshot()
    }

    const insertHtmlIntoNotesEditor = (htmlSnippet: string) => {
        const editor = notesEditorRef.current
        if (!editor) return
        restoreEditorSelection()
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
            const ok = document.execCommand('insertHTML', false, htmlSnippet)
            if (!ok) {
                editor.insertAdjacentHTML('beforeend', htmlSnippet)
            }
        } else {
            editor.insertAdjacentHTML('beforeend', htmlSnippet)
            const range = document.createRange()
            range.selectNodeContents(editor)
            range.collapse(false)
            sel?.removeAllRanges()
            sel?.addRange(range)
        }
        saveEditorSelection()
        syncNotesEmptyState()
        editorSaveSnapshot()
    }

    // ── Link: inline bar (works with highlighted text OR empty/collapsed cursor!) ──
    const normalizeLinkHref = (raw: string): string | null => {
        const trimmed = raw.trim()
        if (!trimmed) return null
        const lower = trimmed.toLowerCase()
        if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('data:')) {
            return null
        }
        if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
            return trimmed
        }
        return `https://${trimmed}`
    }

    const editorToggleLinkBar = () => {
        if (showLinkBar) {
            setShowLinkBar(false)
            setLinkUrl('')
            setLinkText('')
            return
        }
        saveEditorSelection()
        let selectedStr = ''
        if (savedSelectionRef.current && !savedSelectionRef.current.collapsed) {
            selectedStr = savedSelectionRef.current.toString().trim()
        }
        setLinkText(selectedStr)
        setLinkUrl('')
        setShowTextSizeMenu(false)
        setShowColorMenu(false)
        setShowLinkBar(true)
    }

    const editorApplyLink = () => {
        const normalizedHref = normalizeLinkHref(linkUrl)
        if (!normalizedHref) return
        const displayLabel = (linkText.trim() || normalizedHref).trim()
        const safeHref = escapeHtmlAttr(normalizedHref)
        const safeLabel = plainTextToHtml(displayLabel)
        const anchorHtml = `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" style="color: #1D7DB5; text-decoration: underline;">${safeLabel}</a>&nbsp;`

        insertHtmlIntoNotesEditor(anchorHtml)
        setShowLinkBar(false)
        setLinkUrl('')
        setLinkText('')
        savedSelectionRef.current = null
    }

    const editorUnlink = () => {
        restoreEditorSelection()
        document.execCommand('unlink')
        syncNotesEmptyState()
        editorSaveSnapshot()
        setShowLinkBar(false)
        setLinkUrl('')
        setLinkText('')
    }

    // ── Table: inline controls (no browser prompt) ──
    const buildTableHtml = (rows: number, cols: number) => {
        let html = '<table data-editor-table="true" style="border-collapse: collapse; width: 100%; margin: 8px 0;">'
        for (let r = 0; r < rows; r++) {
            html += '<tr>'
            for (let c = 0; c < cols; c++) {
                const bg = r % 2 === 0 ? '#fff' : '#F7F7F5'
                html += `<td style="border: 1px solid #ddd; padding: 6px 8px; min-width: 40px; background: ${bg};">&nbsp;</td>`
            }
            html += '</tr>'
        }
        html += '</table><p><br></p>'
        return html
    }

    const editorInsertTable = () => {
        if (showTableControls) {
            setShowTableControls(false)
            return
        }
        const rows = 3
        const cols = 3
        setTableRows(rows)
        setTableCols(cols)
        insertHtmlIntoNotesEditor(buildTableHtml(rows, cols))
        setShowTableControls(true)
    }

    const editorUpdateTable = (newRows: number, newCols: number) => {
        const editor = notesEditorRef.current
        if (!editor) return
        const table = editor.querySelector('table[data-editor-table]')
        if (table) {
            table.outerHTML = buildTableHtml(newRows, newCols).replace('<p><br></p>', '')
        }
        setTableRows(newRows)
        setTableCols(newCols)
        syncNotesEmptyState()
        editorSaveSnapshot()
    }

    const editorRemoveTable = () => {
        const editor = notesEditorRef.current
        if (!editor) return
        const table = editor.querySelector('table[data-editor-table]')
        if (table) table.remove()
        setShowTableControls(false)
        setTableRows(3)
        setTableCols(3)
        syncNotesEmptyState()
        editorSaveSnapshot()
    }

    const editorInsertCode = () => {
        restoreEditorSelection()
        const sel = window.getSelection()
        const selectedText = sel && notesEditorRef.current?.contains(sel.anchorNode) ? sel.toString() : ''
        const safeCode = plainTextToHtml(selectedText || 'code')
        insertHtmlIntoNotesEditor(`<pre style="background: #F4F4F5; padding: 8px 12px; border-radius: 6px; font-family: monospace; font-size: 13px; overflow-x: auto; border: 1px solid #E4E4E7;"><code>${safeCode}</code></pre><p><br></p>`)
    }

    const editorInsertQuote = () => {
        restoreEditorSelection()
        const sel = window.getSelection()
        const selectedText = sel && notesEditorRef.current?.contains(sel.anchorNode) ? sel.toString() : ''
        const safeQuote = plainTextToHtml(selectedText || '...')
        insertHtmlIntoNotesEditor(`<blockquote style="border-left: 3px solid #CBD5E1; padding-left: 12px; margin: 8px 0; color: #475569; font-style: italic;">${safeQuote}</blockquote><p><br></p>`)
    }

    const editorDictateSpeech = () => {
        if (typeof window === 'undefined') return
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        if (!SpeechRecognition) return
        const recognition = new SpeechRecognition()
        recognition.lang = language === 'es' ? 'es-MX' : 'en-US'
        recognition.start()
        recognition.onresult = (event: any) => {
            const transcript = event?.results?.[0]?.[0]?.transcript
            if (transcript) {
                insertHtmlIntoNotesEditor(`${plainTextToHtml(transcript)} `)
            }
        }
    }

    const resetAddTaskForm = useCallback(() => {
        setNewTaskName('')
        setNewTaskAssignees([])
        setAssigneeSearchQuery('')
        setShowAssigneeSuggestions(false)
        setHighlightedAssigneeIdx(0)
        setNewTaskNotifyees([])
        setNotifySearchQuery('')
        setShowNotifySuggestions(false)
        setHighlightedNotifyIdx(0)
        setNewTaskDueDate('')
        setNewTaskNotes('')
        setNotesIsEmpty(true)
        setIsDraggingOverNotes(false)
        setShowSubtasksInput(false)
        setNewTaskSubtasks([''])
        setShowLinkBar(false)
        setLinkUrl('')
        setLinkText('')
        setShowTableControls(false)
        setShowTextSizeMenu(false)
        setShowColorMenu(false)
        setUploadError(null)
        savedSelectionRef.current = null
        if (notesEditorRef.current) {
            notesEditorRef.current.innerHTML = ''
        }
        editorHistoryRef.current = ['']
        editorHistoryIdxRef.current = 0
    }, [])

    const uploadFileViaServer = async (
        file: File,
        targetFolder: string = 'todos'
    ): Promise<{ url: string; filename: string; contentType: string; size: number } | null> => {
        const MAX_BYTES = 25 * 1024 * 1024
        if (file.size > MAX_BYTES) {
            setUploadError(t('basecamp.file_too_large_25mb'))
            return null
        }

        let fileToUpload = file
        if (file.type.startsWith('image/')) {
            fileToUpload = await compressImage(file)
        }

        // Primary path: Server-side FormData upload via /api/basecamp/upload (uses supabaseAdmin + httpOnly teg_token cookie)
        try {
            const fd = new FormData()
            const uploadFilename = file.name || fileToUpload.name || (file.type.startsWith('image/') ? `screenshot-${Date.now()}.png` : `attachment-${Date.now()}`)
            fd.append('file', fileToUpload, uploadFilename)
            fd.append('folder', String(project.db_id || targetFolder))

            const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
            const headers: Record<string, string> = {}
            if (token) headers['Authorization'] = `Bearer ${token}`

            const res = await fetch('/api/basecamp/upload', {
                method: 'POST',
                headers,
                credentials: 'same-origin',
                body: fd,
            })

            if (res.ok) {
                const payload = await res.json()
                if (payload?.url) {
                    return {
                        url: payload.url,
                        filename: payload.filename || uploadFilename,
                        contentType: payload.contentType || fileToUpload.type || file.type || 'application/octet-stream',
                        size: Number(payload.size || fileToUpload.size || file.size),
                    }
                }
            }
        } catch (srvErr: any) {
            console.warn('⚠️ [ToolTodos Upload] Server upload fallback triggered:', srvErr?.message || srvErr)
        }

        // Secondary fallback: Direct browser client upload to checklist-photos
        const rawExt = (fileToUpload.name || file.name).split('.').pop() || 'bin'
        const safeExt = rawExt.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'bin'
        const folder = project.db_id || targetFolder
        const filePath = `basecamp-uploads/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`

        const { error: uploadErr } = await supabase.storage
            .from('checklist-photos')
            .upload(filePath, fileToUpload, {
                contentType: fileToUpload.type || file.type || 'application/octet-stream',
                cacheControl: '3600',
                upsert: false,
            })

        if (uploadErr) throw uploadErr
        const { data } = supabase.storage.from('checklist-photos').getPublicUrl(filePath)
        if (!data?.publicUrl) throw new Error('Missing publicUrl')

        return {
            url: data.publicUrl,
            filename: file.name || 'attachment',
            contentType: fileToUpload.type || file.type || 'application/octet-stream',
            size: fileToUpload.size,
        }
    }

    const buildAttachmentEditorHtml = (uploaded: { url: string; filename: string; contentType: string; size: number }) => {
        const safeUrl = escapeHtmlAttr(uploaded.url)
        const safeName = escapeHtmlAttr(uploaded.filename)
        const safeMime = escapeHtmlAttr(uploaded.contentType)
        const isImg =
            uploaded.contentType.toLowerCase().startsWith('image/') ||
            /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(uploaded.filename)
        if (isImg) {
            return `<div style="margin: 8px 0;"><img src="${safeUrl}" alt="${safeName}" style="max-width: 100%; max-height: 320px; height: auto; border-radius: 6px; border: 1px solid #E2E8F0;" /></div><p><br></p>`
        }
        const sizeLabel = uploaded.size >= 1024 * 1024
            ? `${(uploaded.size / (1024 * 1024)).toFixed(1)} MB`
            : `${Math.max(1, Math.round(uploaded.size / 1024))} KB`
        return `<bc-attachment content-type="${safeMime}" filename="${safeName}" url="${safeUrl}" href="${safeUrl}"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" contenteditable="false" style="display: inline-flex; align-items: center; gap: 6px; margin: 4px 0; padding: 6px 12px; border-radius: 6px; background: #F1F5F9; border: 1px solid #CBD5E1; color: #1D7DB5; text-decoration: none; font-size: 13px; font-weight: 600;">📎 ${safeName} <span style="color: #64748B; font-weight: 500; font-size: 11px;">(${sizeLabel})</span></a></bc-attachment><p><br></p>`
    }

    const uploadAndInsertFilesIntoNotes = async (files: File[]) => {
        if (!files || files.length === 0) return
        setUploadingAttachment(true)
        setUploadError(null)
        try {
            for (const file of files) {
                const uploaded = await uploadFileViaServer(file, 'todos')
                if (uploaded) {
                    insertHtmlIntoNotesEditor(buildAttachmentEditorHtml(uploaded))
                }
            }
        } catch (err: any) {
            console.error('❌ [ToolTodos Upload] Error uploading file:', err?.message || err)
            setUploadError(t('basecamp.file_upload_error'))
        } finally {
            setUploadingAttachment(false)
        }
    }

    const editorInsertImage = () => {
        saveEditorSelection()
        if (fileInputRef.current) fileInputRef.current.click()
    }

    const handleImageFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || [])
        e.target.value = ''
        await uploadAndInsertFilesIntoNotes(files)
    }

    const editorInsertAttachment = () => {
        saveEditorSelection()
        if (attachmentInputRef.current) attachmentInputRef.current.click()
    }

    const handleAttachmentFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || [])
        e.target.value = ''
        await uploadAndInsertFilesIntoNotes(files)
    }

    const handleNotesPaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
        const clipboardItems = Array.from(e.clipboardData?.items || [])
        const pastedFiles: File[] = []
        for (const item of clipboardItems) {
            if (item.kind === 'file') {
                const f = item.getAsFile()
                if (f) pastedFiles.push(f)
            }
        }
        if (pastedFiles.length > 0) {
            e.preventDefault()
            saveEditorSelection()
            await uploadAndInsertFilesIntoNotes(pastedFiles)
            return
        }

        // Auto-convert plain pasted URL into a clickable link
        const htmlData = e.clipboardData?.getData('text/html') || ''
        const textData = (e.clipboardData?.getData('text/plain') || '').trim()
        if (!htmlData && /^https?:\/\/[^\s]+$/i.test(textData)) {
            e.preventDefault()
            saveEditorSelection()
            const safeHref = escapeHtmlAttr(textData)
            const safeLabel = plainTextToHtml(textData)
            insertHtmlIntoNotesEditor(`<a href="${safeHref}" target="_blank" rel="noopener noreferrer" style="color: #1D7DB5; text-decoration: underline;">${safeLabel}</a>&nbsp;`)
        }
    }

    const handleNotesDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDraggingOverNotes(false)
        const droppedFiles = Array.from(e.dataTransfer?.files || [])
        if (droppedFiles.length > 0) {
            await uploadAndInsertFilesIntoNotes(droppedFiles)
        }
    }

    const uploadFilesForComment = async (files: File[]) => {
        if (!files || files.length === 0) return
        setUploadingCommentAttachment(true)
        setMutationError(null)
        try {
            const added: Array<{ url: string; filename: string; contentType: string; size: number }> = []
            for (const f of files) {
                const up = await uploadFileViaServer(f, 'comments')
                if (up) added.push(up)
            }
            if (added.length > 0) {
                setCommentAttachments(prev => [...prev, ...added])
            }
        } catch (err: any) {
            console.error('❌ [ToolTodos Comment Upload] Error:', err?.message || err)
            setMutationError(t('basecamp.file_upload_error'))
        } finally {
            setUploadingCommentAttachment(false)
        }
    }

    const toolbarBtnStyle: React.CSSProperties = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        borderRadius: 4,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        transition: 'background 0.1s'
    }

    const dividerStyle: React.CSSProperties = {
        width: 1,
        height: 16,
        background: '#E8E6E1',
        margin: '0 4px'
    }

    const closeTaskDetail = useCallback(() => {
        commentFetchAbortRef.current?.abort()
        setSelectedTask(null)
        setCommentAttachments([])
        if (onCloseDetail) onCloseDetail()
    }, [onCloseDetail])

    // Reset local view & form states when switching projects
    useEffect(() => {
        commentFetchAbortRef.current?.abort()
        setLists([])
        setSelectedListId(null)
        setSelectedTask(null)
        setSelectedTaskListId(null)
        setTaskComments([])
        setAddingTaskId(null)
        setTodoFilterQuery('')
        setExpandedCompleted({})
        setLoadingCompletedByList({})
        setShowAddList(false)
        setMutationError(null)
        resetAddTaskForm()
    }, [project.db_id, resetAddTaskForm])

    // Close dropdown popovers (Assignees, When Done, Text Size, Highlight Color) when clicking outside
    useEffect(() => {
        if (!showAssigneeSuggestions && !showNotifySuggestions && !showTextSizeMenu && !showColorMenu) return
        const handleOutsideMenus = (e: MouseEvent) => {
            const target = e.target as Node
            if (showAssigneeSuggestions && assigneeBoxRef.current && !assigneeBoxRef.current.contains(target)) {
                setShowAssigneeSuggestions(false)
            }
            if (showNotifySuggestions && notifyBoxRef.current && !notifyBoxRef.current.contains(target)) {
                setShowNotifySuggestions(false)
            }
            if (showTextSizeMenu && textSizeMenuRef.current && !textSizeMenuRef.current.contains(target)) {
                setShowTextSizeMenu(false)
            }
            if (showColorMenu && colorMenuRef.current && !colorMenuRef.current.contains(target)) {
                setShowColorMenu(false)
            }
        }
        document.addEventListener('mousedown', handleOutsideMenus)
        return () => document.removeEventListener('mousedown', handleOutsideMenus)
    }, [showAssigneeSuggestions, showNotifySuggestions, showTextSizeMenu, showColorMenu])

    // Layered Escape key handling: Lightbox -> Task Detail Modal -> New List Modal -> Popovers
    useEffect(() => {
        if (!lightboxUrl && !selectedTask && !showAddList && !showAssigneeSuggestions && !showNotifySuggestions && !showLinkBar) return
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            if (lightboxUrl) {
                e.preventDefault()
                setLightboxUrl(null)
                return
            }
            if (selectedTask) {
                e.preventDefault()
                closeTaskDetail()
                return
            }
            if (showAddList) {
                e.preventDefault()
                setShowAddList(false)
                return
            }
            if (showAssigneeSuggestions) setShowAssigneeSuggestions(false)
            if (showNotifySuggestions) setShowNotifySuggestions(false)
            if (showLinkBar) setShowLinkBar(false)
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [lightboxUrl, selectedTask, showAddList, showAssigneeSuggestions, showNotifySuggestions, showLinkBar, closeTaskDetail])

    // Format due dates cleanly without UTC timezone shift or ISO string NaN bugs
    const formatDueDate = useCallback((dateStr?: string | null) => {
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
                    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
                })
            }
        }
        const parsed = new Date(dateStr)
        if (isNaN(parsed.getTime())) return String(dateStr)
        return parsed.toLocaleDateString(locale, {
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
            timeZone: 'America/Los_Angeles'
        })
    }, [language])

    // Format creation timestamp in America/Los_Angeles with both date and time
    const formatCreatedDateTime = (dateStr?: string | null, includeYear: boolean = true) => {
        if (!dateStr) return ''
        const d = new Date(dateStr)
        if (isNaN(d.getTime())) return ''
        const locale = language === 'es' ? 'es-MX' : 'en-US'
        const datePart = d.toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
            ...(includeYear ? { year: 'numeric' } : {}),
            timeZone: 'America/Los_Angeles'
        })
        const timePart = d.toLocaleTimeString(locale, {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: 'America/Los_Angeles'
        })
        return `${datePart} · ${timePart}`
    }

    // Intercept clicks on HTML links and images to handle routing & lightbox
    const handleHtmlClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement

        // Intercept image clicks to open fullscreen lightbox
        if (target.tagName === 'IMG') {
            const imgSrc = (target as HTMLImageElement).src
            if (imgSrc) {
                e.preventDefault()
                e.stopPropagation()
                setLightboxUrl(imgSrc)
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
                    const t = list.tasks.find((task: any) => Number(task.bc_id) === todoBcId)
                    if (t) {
                        foundTodo = t
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

    // Helper to map a raw bc_todos row into UI task shape (safely unwrapping person arrays)
    const mapDbTodoToTask = useCallback((row: any, lookup: Map<string, string>) => {
        const assignees = (row.bc_todo_assignees || [])
            .map((a: any) => {
                const personObj = Array.isArray(a?.person) ? a.person[0] : a?.person
                if (!personObj) return null
                return {
                    id: personObj.id,
                    name: personObj.name || t('basecamp.unknown_user'),
                    email: personObj.email || ''
                }
            })
            .filter(Boolean)

        const creatorName = row.created_by_person_id
            ? (lookup.get(row.created_by_person_id) || null)
            : null

        return {
            id: row.id,
            bc_id: row.bc_id,
            task_name: row.title,
            description: row.description,
            is_completed: Boolean(row.is_completed),
            completed_at: row.completed_at || null,
            due_date: row.due_date,
            created_at: row.created_at || null,
            creator_name: creatorName,
            assignee: assignees.map((a: any) => a.name).join(', ') || null,
            assigneeList: assignees,
            comments_count: row.comments_count || 0,
            created_by: creatorName
        }
    }, [t])

    // Estado para secciones colapsadas de tareas completadas (por lista)
    const [expandedCompleted, setExpandedCompleted] = useState<Record<string, boolean>>({})

    const fetchCompletedForList = useCallback(async (listId: string) => {
        if (!listId) return
        setLoadingCompletedByList(prev => ({ ...prev, [listId]: true }))
        try {
            const { data: rows, error } = await supabase
                .from('bc_todos')
                .select(`
                    id, bc_id, todolist_id, title, is_completed, completed_at, due_date, position,
                    comments_count, created_by_person_id, created_at, description,
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
            setLists(prev =>
                prev.map(l => {
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
            setLoadingCompletedByList(prev => ({ ...prev, [listId]: false }))
        }
    }, [supabase, mapDbTodoToTask])

    const toggleCompletedSection = (list: any, loadedCompletedCount: number) => {
        const willExpand = !expandedCompleted[list.id]
        setExpandedCompleted(prev => ({ ...prev, [list.id]: willExpand }))
        if (
            willExpand &&
            !todoFilterQuery.trim() &&
            loadedCompletedCount < Number(list.completed_count || 0)
        ) {
            fetchCompletedForList(list.id)
        }
    }

    // 1. Fetch todo lists and tasks from Supabase (optimized with parallel queries)
    const fetchLists = useCallback(async (opts?: { silent?: boolean }) => {
        if (!project.db_id) return
        if (!opts?.silent) setLoading(true)
        try {
            // Run parallel queries including an explicit selected todo query and full bc_people map
            const [listsResult, activeTodosResult, completedTodosResult, selectedTodoResult, allPeopleResult] = await Promise.all([
                // Query 1: Todolists
                supabase
                    .from('bc_todolists')
                    .select('id, bc_id, name, description, position, completed_count, total_count')
                    .eq('project_id', project.db_id)
                    .order('position', { ascending: true }),

                // Query 2a: Active Todos with assignees (ordered by creation date ascending: oldest at top, newest at bottom)
                supabase
                    .from('bc_todos')
                    .select(`
                        id, bc_id, todolist_id, title, is_completed, completed_at, due_date, position,
                        comments_count, created_by_person_id, created_at, description,
                        bc_todo_assignees(
                            person:bc_people(id, name, email, avatar_url)
                        )
                    `)
                    .eq('project_id', project.db_id)
                    .eq('is_completed', false)
                    .order('created_at', { ascending: true }),

                // Query 2b: Recent Completed Todos ordered by completed_at DESC so newly completed older tasks never vanish
                supabase
                    .from('bc_todos')
                    .select(`
                        id, bc_id, todolist_id, title, is_completed, completed_at, due_date, position,
                        comments_count, created_by_person_id, created_at, description,
                        bc_todo_assignees(
                            person:bc_people(id, name, email, avatar_url)
                        )
                    `)
                    .eq('project_id', project.db_id)
                    .eq('is_completed', true)
                    .order('completed_at', { ascending: false, nullsFirst: false })
                    .order('created_at', { ascending: false })
                    .limit(200),

                // Query 3: Explicit selected todo to bypass pagination limit
                selectedTodoId
                    ? supabase
                        .from('bc_todos')
                        .select(`
                            id, bc_id, todolist_id, title, is_completed, completed_at, due_date, position,
                            comments_count, created_by_person_id, created_at, description,
                            bc_todo_assignees(
                                person:bc_people(id, name, email, avatar_url)
                            )
                        `)
                        .eq('id', selectedTodoId)
                        .maybeSingle()
                    : Promise.resolve({ data: null, error: null } as any),

                // Query 4: All people for accurate creator_name resolution
                supabase
                    .from('bc_people')
                    .select('id, name')
                    .limit(5000)
            ])

            if (listsResult.error) throw listsResult.error
            if (activeTodosResult.error) throw activeTodosResult.error
            if (completedTodosResult.error) throw completedTodosResult.error
            if (selectedTodoResult && selectedTodoResult.error) throw selectedTodoResult.error

            const dbLists = listsResult.data || []
            let dbTodos = [...(activeTodosResult.data || []), ...(completedTodosResult.data || [])]
            const selectedTodo = selectedTodoResult?.data

            // Append selected todo if it's not already in the paginated tasks list
            if (selectedTodo && !dbTodos.some(t => t.id === selectedTodo.id)) {
                dbTodos = [...dbTodos, selectedTodo]
            }

            // Build a quick lookup map for all bc_people + project people to resolve creator_name
            const peopleLookup = new Map<string, string>()
            if (Array.isArray(allPeopleResult?.data)) {
                allPeopleResult.data.forEach((p: any) => {
                    if (p?.id && p?.name) peopleLookup.set(p.id, p.name)
                })
            }
            if (Array.isArray(project.people)) {
                project.people.forEach((p: any) => {
                    if (p?.id && p?.name) peopleLookup.set(p.id, p.name)
                })
            }
            peopleLookupRef.current = peopleLookup

            // Map and combine lists with todos
            const mappedLists = dbLists.map(list => {
                const listTodos = dbTodos.filter(t => t.todolist_id === list.id)
                const tasks = listTodos.map(t => mapDbTodoToTask(t, peopleLookup))

                return {
                    id: list.id,
                    bc_id: list.bc_id,
                    list_name: list.name,
                    description: list.description,
                    completed_count: list.completed_count,
                    total_count: list.total_count,
                    tasks
                }
            })

            setLists(mappedLists)

            // Update active selected task details if modal is open using functional state update
            setSelectedTask((prev: any) => {
                if (!prev) return null
                const foundTask = mappedLists
                    .flatMap(l => l.tasks)
                    .find(t => t.id === prev.id)
                return foundTask || prev
            })
        } catch (err: any) {
            console.error('❌ [ToolTodos Fetch] Error loading todo lists:', err?.message || err?.details || err?.code || JSON.stringify(err) || err)
        } finally {
            setLoading(false)
        }
    }, [project.db_id, project.people, selectedTodoId, supabase, mapDbTodoToTask])

    // Fetch comments specifically for the active selected task + live on-demand hydration from Basecamp API
    const fetchTaskComments = useCallback(async (
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
            const { data: comments, error } = await supabase
                .from('bc_comments')
                .select('id, bc_id, parent_id, content, created_at, author:bc_people(name, email, avatar_url)')
                .eq('parent_type', 'todo')
                .eq('parent_id', taskId)
                .order('created_at', { ascending: true })

            if (error) throw error
            if (activeSelectedTaskIdRef.current !== taskId) return

            const formatted = (comments || []).map((c: any) => {
                const authorObj = Array.isArray(c.author) ? c.author[0] : c.author
                return {
                    id: c.id,
                    bc_id: c.bc_id,
                    author: authorObj?.name || t('basecamp.unknown_user'),
                    text: c.content || '',
                    timestamp: c.created_at
                }
            })

            setTaskComments(formatted)
        } catch (err: any) {
            console.error('❌ [ToolTodos Comments Fetch] Error:', err?.message || err)
        } finally {
            if (!opts?.silent && activeSelectedTaskIdRef.current === taskId) {
                setCommentsLoading(false)
            }
        }

        // Background live hydration ONLY for real Basecamp IDs (< SYNTHETIC_BC_ID_THRESHOLD), never synthetic local IDs
        const numericBcId = Number(taskBcId)
        if (!opts?.skipLiveHydration && project.id && numericBcId > 0 && numericBcId < SYNTHETIC_BC_ID_THRESHOLD) {
            fetch(`/api/basecamp/todo-detail?projectId=${project.id}&todoId=${numericBcId}`, {
                signal: controller.signal
            })
                .then(r => (r.ok ? r.json() : null))
                .then(liveData => {
                    if (!liveData || controller.signal.aborted || activeSelectedTaskIdRef.current !== taskId) return

                    if (Array.isArray(liveData.comments)) {
                        setTaskComments(prev => {
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
                                    author: (!lc.author || lc.author === 'Unknown') ? (existing?.author || t('basecamp.unknown_user')) : lc.author,
                                    text: lc.text ?? existing?.text ?? '',
                                    timestamp: lc.timestamp || existing?.timestamp
                                }
                            })
                            // Preserve local-only comments (bc_id >= SYNTHETIC_BC_ID_THRESHOLD) not yet mirrored to Basecamp
                            const localOnly = prev.filter(p => {
                                const bcNum = Number(p.bc_id || 0)
                                if (bcNum > 0 && bcNum < SYNTHETIC_BC_ID_THRESHOLD) return false
                                const normText = normalizeSearch(p.text)
                                const alreadyMirrored = hydratedBcComments.some((hc: any) => normalizeSearch(hc.text) === normText)
                                return !alreadyMirrored
                            })
                            const merged = [...hydratedBcComments, ...localOnly]
                            merged.sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime())
                            return merged
                        })
                    }

                    const curTask = selectedTaskRef.current
                    if (curTask && curTask.id === taskId) {
                        const nextCompleted = typeof liveData.is_completed === 'boolean' ? liveData.is_completed : curTask.is_completed
                        const nextCount = typeof liveData.comments_count === 'number' ? Math.max(liveData.comments_count, Number(curTask.comments_count || 0)) : curTask.comments_count
                        const nextDesc = typeof liveData.description === 'string' && liveData.description.length > 0 ? liveData.description : curTask.description

                        const hasTaskDiff =
                            curTask.is_completed !== nextCompleted ||
                            curTask.comments_count !== nextCount ||
                            curTask.description !== nextDesc

                        if (hasTaskDiff) {
                            setSelectedTask((prev: any) => {
                                if (!prev || prev.id !== taskId) return prev
                                return {
                                    ...prev,
                                    is_completed: nextCompleted,
                                    comments_count: nextCount,
                                    description: nextDesc,
                                }
                            })
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
    }, [project.id, supabase, fetchLists, t])

    // Load comments on demand whenever selectedTask ID changes
    const prevLoadedTaskIdRef = useRef<string | null>(null)
    useEffect(() => {
        if (selectedTask?.id) {
            const isSameTask = prevLoadedTaskIdRef.current === selectedTask.id
            prevLoadedTaskIdRef.current = selectedTask.id
            if (!isSameTask) {
                setTaskComments([])
            }
            fetchTaskComments(selectedTask.id, selectedTask.bc_id, { silent: isSameTask })
        } else {
            prevLoadedTaskIdRef.current = null
            commentFetchAbortRef.current?.abort()
            setTaskComments([])
        }
        return () => {
            commentFetchAbortRef.current?.abort()
        }
    }, [selectedTask?.id, selectedTask?.bc_id, fetchTaskComments])

    useEffect(() => {
        fetchLists()
    }, [fetchLists])

    // Supabase Realtime subscription for live updates to bc_todos and bc_comments in this project
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
                { event: '*', schema: 'public', table: 'bc_comments', filter: `project_id=eq.${project.db_id}` },
                (payload: any) => {
                    fetchLists({ silent: true })
                    const parentId = payload.new?.parent_id || payload.old?.parent_id
                    if (selectedTask?.id && parentId === selectedTask.id) {
                        fetchTaskComments(selectedTask.id, selectedTask.bc_id, { silent: true, skipLiveHydration: true })
                    }
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [project.db_id, selectedTask?.id, selectedTask?.bc_id, fetchLists, fetchTaskComments, supabase])

    useEffect(() => {
        if (selectedTodoId && lists.length > 0) {
            for (const list of lists) {
                const task = list.tasks.find((t: any) => t.id === selectedTodoId)
                if (task) {
                    setSelectedTask(task)
                    setSelectedTaskListId(list.id)
                    break
                }
            }
        }
    }, [selectedTodoId, lists])

    // Toggle completed status
    const handleToggleTask = async (listId: string, task: any) => {
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
                    todoDbId: task.id
                })
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

    // Create Todo List
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
                    description: newListDesc.trim()
                })
            })

            if (!res.ok) throw new Error(await res.text())
            
            setNewListName('')
            setNewListDesc('')
            setShowAddList(false)
            await fetchLists({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolTodos AddList] Error creating todolist:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setLoading(false)
        }
    }

    // Create Task (Todo)
    const handleAddTask = async (listId: string, listBcId: number, e: React.FormEvent) => {
        e.preventDefault()
        if (!newTaskName.trim() || uploadingAttachment) return
        setActionLoading(`add_task_${listId}`)
        setMutationError(null)
        const rawEditorHtml = (notesEditorRef.current?.innerHTML || newTaskNotes || '').trim()
        const hasMediaOrText =
            /<(img|bc-attachment|a|table|pre|blockquote)\b/i.test(rawEditorHtml) ||
            rawEditorHtml.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length > 0
        const cleanDescription = hasMediaOrText ? rawEditorHtml : ''
        const cleanSubtasks = showSubtasksInput
            ? newTaskSubtasks.map(s => s.trim()).filter(Boolean)
            : []

        try {
            const res = await fetch('/api/basecamp/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_todo',
                    projectId: project.id,
                    todolistId: listBcId,
                    todolistDbId: listId,
                    title: newTaskName.trim(),
                    description: cleanDescription,
                    due_date: newTaskDueDate || null,
                    assigneeUuids: newTaskAssignees.map((a: any) => a.id),
                    notifyeeUuids: newTaskNotifyees.map((n: any) => n.id),
                    subtasks: cleanSubtasks
                })
            })

            if (!res.ok) throw new Error(await res.text())

            resetAddTaskForm()
            setAddingTaskId(null)
            await fetchLists({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolTodos AddTask] Error creating todo:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(null)
        }
    }

    // Delete Task
    const handleDeleteTask = async (listId: string, task: any, e: React.MouseEvent) => {
        e.stopPropagation()
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
                    tableName: 'bc_todos'
                })
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

    // Add Comment to Todo (supports text + photos + file attachments)
    const handleAddComment = async (e: React.FormEvent) => {
        e.preventDefault()
        if ((!newComment.trim() && commentAttachments.length === 0) || !selectedTask || uploadingCommentAttachment) return
        setActionLoading('comment')
        setMutationError(null)
        const textHtml = plainTextToHtml(newComment)
        const attHtml = commentAttachments.map(att => buildAttachmentEditorHtml(att)).join('')
        const commentContent = [textHtml ? `<div>${textHtml}</div>` : '', attHtml].filter(Boolean).join('')
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
                    content: commentContent
                })
            })

            if (!res.ok) throw new Error(await res.text())
            setNewComment('')
            setCommentAttachments([])
            await fetchTaskComments(selectedTask.id, selectedTask.bc_id, { silent: true, skipLiveHydration: true })
            fetchLists({ silent: true })
        } catch (err: any) {
            console.error('❌ [ToolTodos Comment] Error saving comment:', err.message)
            setMutationError(`${t('basecamp.sync_error_prefix')}${err.message || t('basecamp.action_error')}`)
        } finally {
            setActionLoading(null)
        }
    }

    // =========================================================================
    // RENDER — Basecamp 3/4 Real Design (Flat Lists + Inline Avatars)
    // =========================================================================

    // Avatar utilities — consistent color per person name
    const AVATAR_COLORS = ['#3498DB', '#E74C3C', '#27AE60', '#F39C12', '#8E44AD', '#1ABC9C', '#D35400', '#2980B9', '#C0392B', '#16A085', '#F1C40F', '#9B59B6']
    const getAvatarColor = (name: string) => {
        let hash = 0
        for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
        return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
    }
    const getInitials = (name: string) => {
        const parts = name.trim().split(/\s+/)
        return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
    }
    const getShortName = (fullName: string) => {
        if (!fullName) return ''
        const parts = fullName.trim().split(/\s+/)
        if (parts.length >= 2) {
            return `${parts[0]} ${parts[parts.length - 1][0]}.`
        }
        return parts[0]
    }

    // List dot colors — each list gets a consistent colored dot
    const LIST_DOT_COLORS = ['#27AE60', '#E67E22', '#3498DB', '#E74C3C', '#8E44AD', '#1ABC9C', '#F39C12', '#2980B9', '#D35400', '#16A085']

    // Filter suggestions based on what the user types (accent & spelling resilient)
    const filteredSuggestions = (() => {
        const q = normalizeSearch(assigneeSearchQuery)
        const personQ = normalizePersonName(assigneeSearchQuery)
        const available = (project.people || []).filter((p: any) => {
            const isAlreadySelected = newTaskAssignees.some((a) => a.id === p.id)
            if (isAlreadySelected) return false
            if (!q) return true
            return normalizeSearch(p.name).includes(q) || (personQ ? normalizePersonName(p.name).includes(personQ) : false)
        })
        if (!q) return available
        const startsWithQ = available.filter((p: any) => normalizeSearch(p.name).startsWith(q))
        const containsQ = available.filter((p: any) => !normalizeSearch(p.name).startsWith(q))
        return [...startsWithQ, ...containsQ]
    })()

    // Filter suggestions for "When done" notify people — accent & spelling resilient
    const filteredNotifySuggestions = (() => {
        const q = normalizeSearch(notifySearchQuery)
        const personQ = normalizePersonName(notifySearchQuery)
        const available = (project.people || []).filter((p: any) => {
            const isAlreadySelected = newTaskNotifyees.some((a) => a.id === p.id)
            if (isAlreadySelected) return false
            if (!q) return true
            return normalizeSearch(p.name).includes(q) || (personQ ? normalizePersonName(p.name).includes(personQ) : false)
        })
        if (!q) return available
        const startsWithQ = available.filter((p: any) => normalizeSearch(p.name).startsWith(q))
        const containsQ = available.filter((p: any) => !normalizeSearch(p.name).startsWith(q))
        return [...startsWithQ, ...containsQ]
    })()

    // Sort helper by creation date (newest first or oldest first) for active tasks
    const sortTasksByCreatedDate = useCallback((tasks: any[]) => {
        return [...tasks].sort((a, b) => {
            const timeA = a.created_at ? new Date(a.created_at).getTime() : 0
            const timeB = b.created_at ? new Date(b.created_at).getTime() : 0
            return sortOrder === 'newest' ? timeB - timeA : timeA - timeB
        })
    }, [sortOrder])

    // Sort helper for completed tasks: most recently completed at top
    const sortCompletedTasks = useCallback((tasks: any[]) => {
        return [...tasks].sort((a, b) => {
            const timeA = new Date(a.completed_at || a.created_at || 0).getTime()
            const timeB = new Date(b.completed_at || b.created_at || 0).getTime()
            return timeB - timeA
        })
    }, [])

    // Full List Renderer (Used for both List View and Single List drill-down view)
    const renderFullList = (list: any, listIdx: number, showBackBtn: boolean = false) => {
        const openTasks = sortTasksByCreatedDate(list.tasks.filter((tk: any) => !tk.is_completed))
        const completedTasks = sortCompletedTasks(list.tasks.filter((tk: any) => tk.is_completed))
        const isFiltering = Boolean(todoFilterQuery.trim())
        const displayCompletedCount = isFiltering
            ? completedTasks.length
            : (list.completed_count !== undefined && list.completed_count !== null
                ? Math.max(Number(list.completed_count), completedTasks.length)
                : completedTasks.length)
        const isExpanded = expandedCompleted[list.id] || false
        const dotColor = LIST_DOT_COLORS[listIdx % LIST_DOT_COLORS.length]

        return (
            <div
                key={list.id}
                style={{
                    background: '#fff',
                    borderRadius: 10,
                    border: '1px solid #E8E6E1',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                    overflow: 'hidden'
                }}
            >
                {/* ── List Header ── */}
                <div style={{
                    padding: showBackBtn ? '24px 28px 18px' : '20px 24px 16px',
                    borderBottom: '1px solid #F0EFEB',
                    background: '#FAFAF8'
                }}>
                    {showBackBtn && (
                        <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                            <button
                                onClick={() => setSelectedListId(null)}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '6px 12px',
                                    borderRadius: 6,
                                    border: '1px solid #D5D3CE',
                                    background: '#fff',
                                    color: '#1D7DB5',
                                    fontSize: 13,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    transition: 'background 0.15s'
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = '#F0EFEB')}
                                onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                            >
                                ← {t('basecamp.todos')}
                            </button>

                            <button
                                type="button"
                                onClick={() => setSortOrder(prev => prev === 'newest' ? 'oldest' : 'newest')}
                                title={t('basecamp.sort_by_created_tooltip')}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '6px 12px',
                                    borderRadius: 6,
                                    border: '1px solid #D5D3CE',
                                    background: '#fff',
                                    color: '#334155',
                                    fontSize: 12.5,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    transition: 'background 0.15s'
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = '#F0EFEB')}
                                onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                            >
                                <Clock size={13} style={{ color: '#1D7DB5' }} />
                                <span>{sortOrder === 'newest' ? t('basecamp.sort_newest_first') : t('basecamp.sort_oldest_first')}</span>
                            </button>
                        </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span
                            style={{
                                width: 12,
                                height: 12,
                                borderRadius: '50%',
                                backgroundColor: dotColor,
                                display: 'inline-block',
                                flexShrink: 0
                            }}
                        />
                        <h2 style={{
                            fontSize: showBackBtn ? 26 : 20,
                            fontWeight: 700,
                            color: '#1D2D35',
                            margin: 0,
                            lineHeight: 1.2
                        }}>
                            {list.list_name}
                        </h2>
                    </div>

                    {list.description && (
                        <p style={{
                            fontSize: 14,
                            color: '#6B7B8D',
                            margin: '8px 0 0 22px',
                            lineHeight: 1.4
                        }}>
                            {list.description}
                        </p>
                    )}
                </div>

                {/* ── Active Tasks List ── */}
                <div style={{ padding: '8px 0' }}>
                    {openTasks.length === 0 && addingTaskId !== list.id && (
                        <div style={{ padding: '18px 24px', color: '#94A3B8', fontSize: 13.5, fontStyle: 'italic' }}>
                            {t('basecamp.no_todos_in_list')}
                        </div>
                    )}

                    {openTasks.map((task: any) => {
                        const hasComments = task.comments_count > 0 || (task.comments && task.comments.length > 0)
                        const commentCount = task.comments_count || (task.comments ? task.comments.length : 0)

                        return (
                            <div
                                key={task.id}
                                style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 12,
                                    padding: '10px 24px',
                                    borderBottom: '1px solid #F7F7F5',
                                    transition: 'background 0.12s',
                                    position: 'relative'
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = '#F9FAFB')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                                {/* Checkbox / Action loading */}
                                <button
                                    onClick={() => handleToggleTask(list.id, task)}
                                    disabled={actionLoading === task.id}
                                    style={{
                                        width: 18,
                                        height: 18,
                                        borderRadius: 4,
                                        border: '1.5px solid #CBD5E1',
                                        background: '#fff',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: 'pointer',
                                        marginTop: 2,
                                        flexShrink: 0,
                                        padding: 0,
                                        transition: 'border-color 0.15s, background 0.15s'
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.borderColor = '#4BAE4F')}
                                    onMouseLeave={e => (e.currentTarget.style.borderColor = '#CBD5E1')}
                                    title={t('basecamp.mark_as_done')}
                                >
                                    {actionLoading === task.id ? (
                                        <Loader2 size={12} className="animate-spin text-slate-400" />
                                    ) : null}
                                </button>

                                {/* Task Title + Metadata (Click opens detail) */}
                                <div
                                    onClick={() => {
                                        setSelectedTask(task)
                                        setSelectedTaskListId(list.id)
                                    }}
                                    style={{ flex: 1, cursor: 'pointer', minWidth: 0 }}
                                >
                                    {/* Primary row: Title + Creation Date/Time + Due Date + Comments count */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <span style={{
                                            fontSize: 14.5,
                                            fontWeight: 500,
                                            color: '#1E293B',
                                            lineHeight: 1.35
                                        }}>
                                            {task.task_name}
                                        </span>

                                        {/* Informational creation date, time & creator badge */}
                                        {task.created_at && (
                                            <span
                                                title={`${t('basecamp.created_at_label')}: ${formatCreatedDateTime(task.created_at)}${task.creator_name ? ` — ${t('basecamp.added_by')} ${task.creator_name}` : ''}`}
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: 3.5,
                                                    padding: '1.5px 7px',
                                                    borderRadius: 10,
                                                    background: '#F1F5F9',
                                                    border: '1px solid #E2E8F0',
                                                    color: '#64748B',
                                                    fontSize: 11,
                                                    fontWeight: 500,
                                                    whiteSpace: 'nowrap'
                                                }}
                                            >
                                                <Clock size={10} style={{ color: '#94A3B8', flexShrink: 0 }} />
                                                {formatCreatedDateTime(task.created_at)}
                                                {task.creator_name && (
                                                    <span style={{ color: '#475569', fontWeight: 600 }}>
                                                        · {getShortName(task.creator_name)}
                                                    </span>
                                                )}
                                            </span>
                                        )}

                                        {/* Due date badge */}
                                        {task.due_date && (
                                            <span style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 3.5,
                                                padding: '2px 7px',
                                                borderRadius: 12,
                                                background: '#FEF3C7',
                                                color: '#92400E',
                                                fontSize: 11,
                                                fontWeight: 600
                                            }}>
                                                <Calendar size={11} />
                                                {formatDueDate(task.due_date)}
                                            </span>
                                        )}

                                        {/* Comments badge */}
                                        {hasComments && (
                                            <span style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 4,
                                                color: '#1D7DB5',
                                                fontSize: 12,
                                                fontWeight: 600
                                            }}>
                                                <MessageSquare size={13} />
                                                {commentCount}
                                            </span>
                                        )}
                                    </div>

                                    {/* Secondary row: Assignees avatar pills on the next line */}
                                    {task.assigneeList && task.assigneeList.length > 0 && (
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            flexWrap: 'wrap',
                                            gap: 6,
                                            marginTop: 5
                                        }}>
                                            {task.assigneeList.map((a: any, aIdx: number) => (
                                                <span
                                                    key={a.id || aIdx}
                                                    style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: 4,
                                                        padding: '2px 8px',
                                                        borderRadius: 12,
                                                        background: '#F1F5F9',
                                                        border: '1px solid #E2E8F0',
                                                        color: '#475569',
                                                        fontSize: 11,
                                                        fontWeight: 600
                                                    }}
                                                    title={a.name}
                                                >
                                                    <span
                                                        style={{
                                                            width: 14,
                                                            height: 14,
                                                            borderRadius: '50%',
                                                            background: getAvatarColor(a.name || 'U'),
                                                            color: '#fff',
                                                            fontSize: 8,
                                                            fontWeight: 800,
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center'
                                                        }}
                                                    >
                                                        {getInitials(a.name || 'U')}
                                                    </span>
                                                    {getShortName(a.name || '')}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Delete button */}
                                <button
                                    onClick={(e) => handleDeleteTask(list.id, task, e)}
                                    style={{
                                        border: 'none',
                                        background: 'transparent',
                                        color: '#94A3B8',
                                        cursor: 'pointer',
                                        padding: '2px 6px',
                                        borderRadius: 4,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        opacity: 0.6,
                                        transition: 'opacity 0.15s, color 0.15s'
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.opacity = '1'
                                        e.currentTarget.style.color = '#EF4444'
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.opacity = '0.6'
                                        e.currentTarget.style.color = '#94A3B8'
                                    }}
                                    title={t('basecamp.delete_todo')}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        )
                    })}
                </div>

                {/* ── Inline Add To-do Form (Exact Basecamp 4 Trix Clone) or Trigger Button ── */}
                <div style={{ padding: '12px 24px 18px', borderTop: '1px solid #F0EFEB' }}>
                    {addingTaskId === list.id ? (
                        <form onSubmit={(e) => handleAddTask(list.id, list.bc_id, e)} style={{ paddingTop: 2 }}>
                            {/* 1. Title Row — Checkbox + Seamless Input (like real Basecamp) */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                padding: '8px 0 12px',
                                borderBottom: '1px solid #E2E8F0'
                            }}>
                                <span style={{
                                    width: 18,
                                    height: 18,
                                    border: '2px solid #CBD5E1',
                                    borderRadius: 4,
                                    flexShrink: 0,
                                    background: '#fff'
                                }} />
                                <input
                                    type="text"
                                    required
                                    autoFocus
                                    value={newTaskName}
                                    onChange={(e) => setNewTaskName(e.target.value)}
                                    placeholder={t('basecamp.describe_todo')}
                                    style={{
                                        flex: 1,
                                        padding: '2px 0',
                                        border: 'none',
                                        fontSize: 15,
                                        fontWeight: 500,
                                        color: '#1E293B',
                                        outline: 'none',
                                        background: 'transparent',
                                        lineHeight: '22px'
                                    }}
                                />
                            </div>

                            {/* 2. Horizontally-Aligned Basecamp Fields (Assigned to, When done, Due on, Notes, Subtasks) */}
                            <div className="flex flex-col gap-3 mt-3 pt-1 pb-2 pl-0 sm:pl-7">

                                {/* Assigned to */}
                                <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-0">
                                    <label className="w-auto sm:w-[108px] text-left sm:text-right mr-0 sm:mr-4 shrink-0 font-semibold text-[13px] text-[#475569] sm:pt-1.5">
                                        {t('basecamp.assigned_to')}
                                    </label>
                                    <div ref={assigneeBoxRef} style={{ position: 'relative', flex: 1, maxWidth: 540 }}>
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            flexWrap: 'wrap',
                                            gap: 6,
                                            padding: '5px 8px',
                                            borderRadius: 6,
                                            border: '1px solid #CBD5E1',
                                            background: '#fff',
                                            minHeight: 34
                                        }}>
                                            {newTaskAssignees.map((person) => (
                                                <span key={person.id} style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: 5,
                                                    padding: '2px 8px 2px 4px',
                                                    borderRadius: 14,
                                                    background: '#F8FAFC',
                                                    border: '1px solid #CBD5E1',
                                                    fontSize: 12,
                                                    fontWeight: 600,
                                                    color: '#1E293B'
                                                }}>
                                                    <span style={{
                                                        width: 18,
                                                        height: 18,
                                                        borderRadius: '50%',
                                                        background: getAvatarColor(person.name || 'U'),
                                                        color: '#fff',
                                                        fontSize: 9,
                                                        fontWeight: 700,
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        flexShrink: 0
                                                    }}>
                                                        {getInitials(person.name || 'U')}
                                                    </span>
                                                    <span>{person.name}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => setNewTaskAssignees(prev => prev.filter(p => p.id !== person.id))}
                                                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 11, color: '#EF4444', padding: '0 2px', fontWeight: 700 }}
                                                    >
                                                        ✕
                                                    </button>
                                                </span>
                                            ))}
                                            <input
                                                type="text"
                                                placeholder={newTaskAssignees.length === 0 ? t('basecamp.type_names_placeholder') : ''}
                                                value={assigneeSearchQuery}
                                                onChange={(e) => {
                                                    setAssigneeSearchQuery(e.target.value)
                                                    setShowAssigneeSuggestions(true)
                                                    setHighlightedAssigneeIdx(0)
                                                }}
                                                onFocus={() => setShowAssigneeSuggestions(true)}
                                                onKeyDown={(e) => {
                                                    if (!showAssigneeSuggestions || filteredSuggestions.length === 0) return
                                                    if (e.key === 'ArrowDown') {
                                                        e.preventDefault()
                                                        setHighlightedAssigneeIdx(prev => Math.min(prev + 1, filteredSuggestions.length - 1))
                                                    } else if (e.key === 'ArrowUp') {
                                                        e.preventDefault()
                                                        setHighlightedAssigneeIdx(prev => Math.max(prev - 1, 0))
                                                    } else if (e.key === 'Enter') {
                                                        e.preventDefault()
                                                        e.stopPropagation()
                                                        const person = filteredSuggestions[highlightedAssigneeIdx]
                                                        if (person) {
                                                            setNewTaskAssignees(prev => [...prev, person])
                                                            setAssigneeSearchQuery('')
                                                            setShowAssigneeSuggestions(false)
                                                            setHighlightedAssigneeIdx(0)
                                                        }
                                                    } else if (e.key === 'Escape') {
                                                        setShowAssigneeSuggestions(false)
                                                    }
                                                }}
                                                style={{ flex: 1, minWidth: 140, border: 'none', outline: 'none', fontSize: 13, color: '#1E293B', background: 'transparent' }}
                                            />
                                        </div>

                                        {showAssigneeSuggestions && (
                                            <div style={{
                                                position: 'absolute',
                                                top: '100%',
                                                left: 0,
                                                right: 0,
                                                marginTop: 4,
                                                background: '#fff',
                                                border: '1px solid #CBD5E1',
                                                borderRadius: 6,
                                                boxShadow: '0 10px 25px rgba(0,0,0,0.12)',
                                                zIndex: 60,
                                                maxHeight: 190,
                                                overflowY: 'auto'
                                            }}>
                                                {filteredSuggestions.length > 0 ? (
                                                    filteredSuggestions.map((person: any, idx: number) => (
                                                        <div
                                                            key={person.id}
                                                            onMouseDown={(e) => e.preventDefault()}
                                                            onClick={() => {
                                                                setNewTaskAssignees(prev => [...prev, person])
                                                                setAssigneeSearchQuery('')
                                                                setShowAssigneeSuggestions(false)
                                                                setHighlightedAssigneeIdx(0)
                                                            }}
                                                            onMouseEnter={() => setHighlightedAssigneeIdx(idx)}
                                                            style={{
                                                                padding: '8px 12px',
                                                                cursor: 'pointer',
                                                                fontSize: 13,
                                                                color: idx === highlightedAssigneeIdx ? '#fff' : '#1E293B',
                                                                background: idx === highlightedAssigneeIdx ? '#1D7DB5' : '#fff',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: 8
                                                            }}
                                                        >
                                                            <span style={{
                                                                width: 20,
                                                                height: 20,
                                                                borderRadius: '50%',
                                                                background: getAvatarColor(person.name || 'U'),
                                                                color: '#fff',
                                                                fontSize: 9,
                                                                fontWeight: 700,
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                flexShrink: 0
                                                            }}>
                                                                {getInitials(person.name || 'U')}
                                                            </span>
                                                            <span style={{ fontWeight: idx === highlightedAssigneeIdx ? 600 : 400 }}>{person.name}</span>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <div style={{ padding: '8px 12px', fontSize: 13, color: '#94A3B8', fontStyle: 'italic' }}>
                                                        {t('basecamp.no_people_found')}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* When done (Notify people) */}
                                <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-0">
                                    <label className="w-auto sm:w-[108px] text-left sm:text-right mr-0 sm:mr-4 shrink-0 font-semibold text-[13px] text-[#475569] sm:pt-1.5">
                                        {t('basecamp.when_done')}
                                    </label>
                                    <div ref={notifyBoxRef} style={{ position: 'relative', flex: 1, maxWidth: 540 }}>
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            flexWrap: 'wrap',
                                            gap: 6,
                                            padding: '5px 8px',
                                            borderRadius: 6,
                                            border: '1px solid #CBD5E1',
                                            background: '#fff',
                                            minHeight: 34
                                        }}>
                                            {newTaskNotifyees.map((person) => (
                                                <span key={person.id} style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: 5,
                                                    padding: '2px 8px 2px 4px',
                                                    borderRadius: 14,
                                                    background: '#F8FAFC',
                                                    border: '1px solid #CBD5E1',
                                                    fontSize: 12,
                                                    fontWeight: 600,
                                                    color: '#1E293B'
                                                }}>
                                                    <span style={{
                                                        width: 18,
                                                        height: 18,
                                                        borderRadius: '50%',
                                                        background: getAvatarColor(person.name || 'U'),
                                                        color: '#fff',
                                                        fontSize: 9,
                                                        fontWeight: 700,
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        flexShrink: 0
                                                    }}>
                                                        {getInitials(person.name || 'U')}
                                                    </span>
                                                    <span>{person.name}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => setNewTaskNotifyees(prev => prev.filter(p => p.id !== person.id))}
                                                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 11, color: '#EF4444', padding: '0 2px', fontWeight: 700 }}
                                                    >
                                                        ✕
                                                    </button>
                                                </span>
                                            ))}
                                            <input
                                                type="text"
                                                placeholder={newTaskNotifyees.length === 0 ? t('basecamp.notify_people_placeholder') : ''}
                                                value={notifySearchQuery}
                                                onChange={(e) => {
                                                    setNotifySearchQuery(e.target.value)
                                                    setShowNotifySuggestions(true)
                                                    setHighlightedNotifyIdx(0)
                                                }}
                                                onFocus={() => setShowNotifySuggestions(true)}
                                                onKeyDown={(e) => {
                                                    if (!showNotifySuggestions || filteredNotifySuggestions.length === 0) return
                                                    if (e.key === 'ArrowDown') {
                                                        e.preventDefault()
                                                        setHighlightedNotifyIdx(prev => Math.min(prev + 1, filteredNotifySuggestions.length - 1))
                                                    } else if (e.key === 'ArrowUp') {
                                                        e.preventDefault()
                                                        setHighlightedNotifyIdx(prev => Math.max(prev - 1, 0))
                                                    } else if (e.key === 'Enter') {
                                                        e.preventDefault()
                                                        e.stopPropagation()
                                                        const person = filteredNotifySuggestions[highlightedNotifyIdx]
                                                        if (person) {
                                                            setNewTaskNotifyees(prev => [...prev, person])
                                                            setNotifySearchQuery('')
                                                            setShowNotifySuggestions(false)
                                                            setHighlightedNotifyIdx(0)
                                                        }
                                                    } else if (e.key === 'Escape') {
                                                        setShowNotifySuggestions(false)
                                                    }
                                                }}
                                                style={{ flex: 1, minWidth: 140, border: 'none', outline: 'none', fontSize: 13, color: '#1E293B', background: 'transparent' }}
                                            />
                                        </div>

                                        {showNotifySuggestions && (
                                            <div style={{
                                                position: 'absolute',
                                                top: '100%',
                                                left: 0,
                                                right: 0,
                                                marginTop: 4,
                                                background: '#fff',
                                                border: '1px solid #CBD5E1',
                                                borderRadius: 6,
                                                boxShadow: '0 10px 25px rgba(0,0,0,0.12)',
                                                zIndex: 60,
                                                maxHeight: 190,
                                                overflowY: 'auto'
                                            }}>
                                                {filteredNotifySuggestions.length > 0 ? (
                                                    filteredNotifySuggestions.map((person: any, idx: number) => (
                                                        <div
                                                            key={person.id}
                                                            onMouseDown={(e) => e.preventDefault()}
                                                            onClick={() => {
                                                                setNewTaskNotifyees(prev => [...prev, person])
                                                                setNotifySearchQuery('')
                                                                setShowNotifySuggestions(false)
                                                                setHighlightedNotifyIdx(0)
                                                            }}
                                                            onMouseEnter={() => setHighlightedNotifyIdx(idx)}
                                                            style={{
                                                                padding: '8px 12px',
                                                                cursor: 'pointer',
                                                                fontSize: 13,
                                                                color: idx === highlightedNotifyIdx ? '#fff' : '#1E293B',
                                                                background: idx === highlightedNotifyIdx ? '#1D7DB5' : '#fff',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: 8
                                                            }}
                                                        >
                                                            <span style={{
                                                                width: 20,
                                                                height: 20,
                                                                borderRadius: '50%',
                                                                background: getAvatarColor(person.name || 'U'),
                                                                color: '#fff',
                                                                fontSize: 9,
                                                                fontWeight: 700,
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                flexShrink: 0
                                                            }}>
                                                                {getInitials(person.name || 'U')}
                                                            </span>
                                                            <span style={{ fontWeight: idx === highlightedNotifyIdx ? 600 : 400 }}>{person.name}</span>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <div style={{ padding: '8px 12px', fontSize: 13, color: '#94A3B8', fontStyle: 'italic' }}>
                                                        {t('basecamp.no_people_found')}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Due on */}
                                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-0">
                                    <label className="w-auto sm:w-[108px] text-left sm:text-right mr-0 sm:mr-4 shrink-0 font-semibold text-[13px] text-[#475569]">
                                        {t('basecamp.due_on')}
                                    </label>
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                        <input
                                            type="date"
                                            value={newTaskDueDate}
                                            onChange={e => setNewTaskDueDate(e.target.value)}
                                            style={{
                                                padding: '5px 10px',
                                                borderRadius: 6,
                                                border: '1px solid #CBD5E1',
                                                fontSize: 13,
                                                outline: 'none',
                                                background: '#fff',
                                                color: '#1E293B'
                                            }}
                                        />
                                        {newTaskDueDate && (
                                            <button
                                                type="button"
                                                onClick={() => setNewTaskDueDate('')}
                                                title={t('basecamp.clear_due_date')}
                                                style={{ border: 'none', background: 'transparent', color: '#94A3B8', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Notes — Full Basecamp 4 Trix Rich-Text Editor */}
                                <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-0">
                                    <label className="w-auto sm:w-[108px] text-left sm:text-right mr-0 sm:mr-4 shrink-0 font-semibold text-[13px] text-[#475569] sm:pt-2">
                                        {t('basecamp.notes_short_label')}
                                    </label>
                                    <div className="w-full" style={{ maxWidth: 680 }}>
                                        <div style={{
                                            borderRadius: 8,
                                            border: isDraggingOverNotes ? '2px dashed #1D7DB5' : '1px solid #CBD5E1',
                                            background: '#fff',
                                            transition: 'border-color 0.15s'
                                        }}>
                                            {/* Basecamp Trix Toolbar (exact icon order + selection-preserving onMouseDown) */}
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                flexWrap: 'wrap',
                                                gap: 2,
                                                padding: '5px 8px',
                                                background: '#FAFAF8',
                                                borderBottom: '1px solid #E2E8F0',
                                                borderTopLeftRadius: 8,
                                                borderTopRightRadius: 8
                                            }}>
                                                {/* Group 1: Media (Image + Attach File) */}
                                                <button
                                                    type="button"
                                                    onMouseDown={(e) => e.preventDefault()}
                                                    onClick={editorInsertImage}
                                                    disabled={uploadingAttachment}
                                                    title={t('basecamp.attach_image_btn')}
                                                    style={toolbarBtnStyle}
                                                >
                                                    <Image size={15} color="#475569" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onMouseDown={(e) => e.preventDefault()}
                                                    onClick={editorInsertAttachment}
                                                    disabled={uploadingAttachment}
                                                    title={t('basecamp.attach_file_btn')}
                                                    style={toolbarBtnStyle}
                                                >
                                                    <Paperclip size={15} color="#475569" />
                                                </button>

                                                <span style={dividerStyle} />

                                                {/* Group 2: Inline Text Style (Bold, Italic, Strikethrough, Text Size Tt▾, Highlight▾, Link) */}
                                                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd('bold')} title={t('basecamp.editor_bold')} style={toolbarBtnStyle}>
                                                    <Bold size={14} color="#475569" />
                                                </button>
                                                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd('italic')} title={t('basecamp.editor_italic')} style={toolbarBtnStyle}>
                                                    <Italic size={14} color="#475569" />
                                                </button>
                                                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd('strikeThrough')} title={t('basecamp.editor_strikethrough')} style={toolbarBtnStyle}>
                                                    <Strikethrough size={14} color="#475569" />
                                                </button>

                                                {/* Text Size Dropdown (Tt▾) */}
                                                <div ref={textSizeMenuRef} style={{ position: 'relative' }}>
                                                    <button
                                                        type="button"
                                                        onMouseDown={(e) => e.preventDefault()}
                                                        onClick={() => {
                                                            saveEditorSelection()
                                                            setShowTextSizeMenu(prev => !prev)
                                                            setShowColorMenu(false)
                                                        }}
                                                        title={t('basecamp.editor_text_size')}
                                                        style={{ ...toolbarBtnStyle, width: 36, gap: 1, background: showTextSizeMenu ? '#E2E8F0' : 'transparent' }}
                                                    >
                                                        <Type size={14} color="#475569" />
                                                        <ChevronDown size={10} color="#475569" />
                                                    </button>
                                                    {showTextSizeMenu && (
                                                        <div style={{
                                                            position: 'absolute',
                                                            top: '100%',
                                                            left: 0,
                                                            zIndex: 70,
                                                            background: '#fff',
                                                            border: '1px solid #CBD5E1',
                                                            borderRadius: 6,
                                                            boxShadow: '0 8px 20px rgba(0,0,0,0.14)',
                                                            minWidth: 165,
                                                            padding: '4px 0',
                                                            marginTop: 3
                                                        }}>
                                                            <button
                                                                type="button"
                                                                onMouseDown={(e) => e.preventDefault()}
                                                                onClick={() => { execCmd('formatBlock', 'h1'); setShowTextSizeMenu(false) }}
                                                                style={{ display: 'block', width: '100%', padding: '7px 14px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', fontSize: 17, fontWeight: 700, color: '#1E293B' }}
                                                            >
                                                                {t('basecamp.editor_heading_1')}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onMouseDown={(e) => e.preventDefault()}
                                                                onClick={() => { execCmd('formatBlock', 'h2'); setShowTextSizeMenu(false) }}
                                                                style={{ display: 'block', width: '100%', padding: '6px 14px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', fontSize: 15, fontWeight: 600, color: '#1E293B' }}
                                                            >
                                                                {t('basecamp.editor_heading_2')}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onMouseDown={(e) => e.preventDefault()}
                                                                onClick={() => { execCmd('formatBlock', 'p'); setShowTextSizeMenu(false) }}
                                                                style={{ display: 'block', width: '100%', padding: '6px 14px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', fontSize: 13, color: '#1E293B' }}
                                                            >
                                                                {t('basecamp.editor_normal_text')}
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Highlight / Color Dropdown */}
                                                <div ref={colorMenuRef} style={{ position: 'relative' }}>
                                                    <button
                                                        type="button"
                                                        onMouseDown={(e) => e.preventDefault()}
                                                        onClick={() => {
                                                            saveEditorSelection()
                                                            setShowColorMenu(prev => !prev)
                                                            setShowTextSizeMenu(false)
                                                        }}
                                                        title={t('basecamp.editor_highlight_color')}
                                                        style={{ ...toolbarBtnStyle, width: 36, gap: 1, background: showColorMenu ? '#E2E8F0' : 'transparent' }}
                                                    >
                                                        <Highlighter size={14} color="#475569" />
                                                        <ChevronDown size={10} color="#475569" />
                                                    </button>
                                                    {showColorMenu && (
                                                        <div style={{
                                                            position: 'absolute',
                                                            top: '100%',
                                                            left: 0,
                                                            zIndex: 70,
                                                            background: '#fff',
                                                            border: '1px solid #CBD5E1',
                                                            borderRadius: 6,
                                                            boxShadow: '0 8px 20px rgba(0,0,0,0.14)',
                                                            padding: 8,
                                                            marginTop: 3,
                                                            display: 'flex',
                                                            gap: 5,
                                                            flexWrap: 'wrap',
                                                            width: 176
                                                        }}>
                                                            {[
                                                                { color: '#FEF08A', label: t('basecamp.color_yellow') },
                                                                { color: '#BBF7D0', label: t('basecamp.color_green') },
                                                                { color: '#BAE6FD', label: t('basecamp.color_blue') },
                                                                { color: '#FECDD3', label: t('basecamp.color_pink') },
                                                                { color: '#FED7AA', label: t('basecamp.color_orange') },
                                                                { color: '#E9D5FF', label: t('basecamp.color_purple') },
                                                            ].map((c) => (
                                                                <button
                                                                    key={c.color}
                                                                    type="button"
                                                                    onMouseDown={(e) => e.preventDefault()}
                                                                    title={c.label}
                                                                    onClick={() => { execCmd('hiliteColor', c.color); setShowColorMenu(false) }}
                                                                    style={{ width: 24, height: 24, borderRadius: 4, border: '1px solid #CBD5E1', background: c.color, cursor: 'pointer' }}
                                                                />
                                                            ))}
                                                            <button
                                                                type="button"
                                                                onMouseDown={(e) => e.preventDefault()}
                                                                title={t('basecamp.editor_clear_highlight')}
                                                                onClick={() => { execCmd('removeFormat'); setShowColorMenu(false) }}
                                                                style={{ width: 24, height: 24, borderRadius: 4, border: '1px solid #CBD5E1', background: '#fff', cursor: 'pointer', fontSize: 11, color: '#64748B', fontWeight: 700 }}
                                                            >
                                                                ✕
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Link */}
                                                <button
                                                    type="button"
                                                    onMouseDown={(e) => e.preventDefault()}
                                                    onClick={editorToggleLinkBar}
                                                    title={t('basecamp.editor_link')}
                                                    style={{ ...toolbarBtnStyle, background: showLinkBar ? '#1D7DB5' : 'transparent' }}
                                                >
                                                    <Link size={14} color={showLinkBar ? '#fff' : '#475569'} />
                                                </button>

                                                <span style={dividerStyle} />

                                                {/* Group 3: Quote & Code */}
                                                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={editorInsertQuote} title={t('basecamp.editor_quote')} style={toolbarBtnStyle}>
                                                    <Quote size={14} color="#475569" />
                                                </button>
                                                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={editorInsertCode} title={t('basecamp.editor_code')} style={toolbarBtnStyle}>
                                                    <Code size={14} color="#475569" />
                                                </button>

                                                <span style={dividerStyle} />

                                                {/* Group 4: Lists */}
                                                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd('insertUnorderedList')} title={t('basecamp.editor_bullet_list')} style={toolbarBtnStyle}>
                                                    <List size={14} color="#475569" />
                                                </button>
                                                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd('insertOrderedList')} title={t('basecamp.editor_numbered_list')} style={toolbarBtnStyle}>
                                                    <ListOrdered size={14} color="#475569" />
                                                </button>

                                                <span style={dividerStyle} />

                                                {/* Group 5: Table, Align, Dictation */}
                                                <button
                                                    type="button"
                                                    onMouseDown={(e) => e.preventDefault()}
                                                    onClick={editorInsertTable}
                                                    title={t('basecamp.editor_table')}
                                                    style={{ ...toolbarBtnStyle, background: showTableControls ? '#2C3E50' : 'transparent' }}
                                                >
                                                    <Table size={14} color={showTableControls ? '#fff' : '#475569'} />
                                                </button>
                                                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execCmd('justifyCenter')} title={t('basecamp.editor_align')} style={toolbarBtnStyle}>
                                                    <AlignLeft size={14} color="#475569" />
                                                </button>
                                                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={editorDictateSpeech} title={t('basecamp.editor_dictate')} style={toolbarBtnStyle}>
                                                    <Mic size={14} color="#475569" />
                                                </button>

                                                {/* Right-aligned Undo / Redo */}
                                                <div style={{ flex: 1 }} />
                                                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={editorUndo} title={t('basecamp.editor_undo')} style={toolbarBtnStyle}>
                                                    <Undo2 size={14} color="#475569" />
                                                </button>
                                                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={editorRedo} title={t('basecamp.editor_redo')} style={toolbarBtnStyle}>
                                                    <Redo2 size={14} color="#475569" />
                                                </button>
                                            </div>

                                            {/* Upload in-progress indicator */}
                                            {uploadingAttachment && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#EFF6FF', borderBottom: '1px solid #BFDBFE', fontSize: 12, color: '#1D4ED8', fontWeight: 600 }}>
                                                    <Loader2 size={14} className="animate-spin" />
                                                    <span>{t('basecamp.uploading_real_file')}</span>
                                                </div>
                                            )}

                                            {/* Inline Link Bar (works with or without prior selection, never triggers form submit on Enter) */}
                                            {showLinkBar && (
                                                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, padding: '8px 10px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                                                    <input
                                                        type="text"
                                                        value={linkUrl}
                                                        onChange={e => setLinkUrl(e.target.value)}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') {
                                                                e.preventDefault()
                                                                e.stopPropagation()
                                                                editorApplyLink()
                                                            } else if (e.key === 'Escape') {
                                                                e.preventDefault()
                                                                setShowLinkBar(false)
                                                            }
                                                        }}
                                                        placeholder={t('basecamp.link_url_placeholder')}
                                                        autoFocus
                                                        style={{ flex: '1 1 200px', padding: '5px 9px', borderRadius: 5, border: '1px solid #CBD5E1', fontSize: 12.5, outline: 'none', color: '#1E293B', background: '#fff' }}
                                                    />
                                                    <input
                                                        type="text"
                                                        value={linkText}
                                                        onChange={e => setLinkText(e.target.value)}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') {
                                                                e.preventDefault()
                                                                e.stopPropagation()
                                                                editorApplyLink()
                                                            } else if (e.key === 'Escape') {
                                                                e.preventDefault()
                                                                setShowLinkBar(false)
                                                            }
                                                        }}
                                                        placeholder={t('basecamp.editor_link_text_placeholder')}
                                                        style={{ flex: '1 1 150px', padding: '5px 9px', borderRadius: 5, border: '1px solid #CBD5E1', fontSize: 12.5, outline: 'none', color: '#1E293B', background: '#fff' }}
                                                    />
                                                    <button type="button" onMouseDown={e => e.preventDefault()} onClick={editorApplyLink} style={{ padding: '5px 12px', borderRadius: 5, border: 'none', background: '#1D7DB5', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                                                        {t('basecamp.apply_link_btn')}
                                                    </button>
                                                    <button type="button" onMouseDown={e => e.preventDefault()} onClick={editorUnlink} style={{ padding: '5px 10px', borderRadius: 5, border: '1px solid #CBD5E1', background: '#fff', color: '#64748B', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                                                        {t('basecamp.remove_link_btn')}
                                                    </button>
                                                </div>
                                            )}

                                            {/* Inline Dark Table Controls Bar (like real Basecamp) */}
                                            {showTableControls && (
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '6px 12px', background: '#2C3E50', borderBottom: '1px solid #1E293B' }}>
                                                    <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { if (tableRows > 1) editorUpdateTable(tableRows - 1, tableCols) }} style={{ background: '#3D5166', border: 'none', color: '#fff', width: 24, height: 24, borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}>−</button>
                                                    <span style={{ color: '#fff', fontSize: 12, fontWeight: 600, minWidth: 54, textAlign: 'center' }}>{tableRows} {t('basecamp.editor_rows')}</span>
                                                    <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => editorUpdateTable(tableRows + 1, tableCols)} style={{ background: '#3D5166', border: 'none', color: '#fff', width: 24, height: 24, borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}>+</button>
                                                    <span style={{ width: 8 }} />
                                                    <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { if (tableCols > 1) editorUpdateTable(tableRows, tableCols - 1) }} style={{ background: '#3D5166', border: 'none', color: '#fff', width: 24, height: 24, borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}>−</button>
                                                    <span style={{ color: '#fff', fontSize: 12, fontWeight: 600, minWidth: 72, textAlign: 'center' }}>{tableCols} {t('basecamp.editor_columns')}</span>
                                                    <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => editorUpdateTable(tableRows, tableCols + 1)} style={{ background: '#3D5166', border: 'none', color: '#fff', width: 24, height: 24, borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}>+</button>
                                                    <span style={{ width: 8 }} />
                                                    <button type="button" onMouseDown={e => e.preventDefault()} onClick={editorRemoveTable} title={t('basecamp.editor_delete_table')} style={{ background: '#EF4444', border: 'none', color: '#fff', width: 24, height: 24, borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <Trash2 size={13} />
                                                    </button>
                                                </div>
                                            )}

                                            {/* Editable Rich-Text Surface with Non-Blocking Placeholder + Paste + Drag & Drop */}
                                            <div
                                                onClick={() => focusEditor()}
                                                onDragOver={(e) => { e.preventDefault(); setIsDraggingOverNotes(true) }}
                                                onDragLeave={() => setIsDraggingOverNotes(false)}
                                                onDrop={handleNotesDrop}
                                                style={{ position: 'relative', cursor: 'text' }}
                                            >
                                                {notesIsEmpty && !isDraggingOverNotes && (
                                                    <div style={{
                                                        position: 'absolute',
                                                        top: 12,
                                                        left: 14,
                                                        right: 14,
                                                        color: '#94A3B8',
                                                        fontSize: 14,
                                                        pointerEvents: 'none',
                                                        userSelect: 'none'
                                                    }}>
                                                        {t('basecamp.notes_placeholder')}
                                                    </div>
                                                )}
                                                {isDraggingOverNotes && (
                                                    <div style={{
                                                        position: 'absolute',
                                                        inset: 6,
                                                        borderRadius: 6,
                                                        background: 'rgba(239, 246, 255, 0.92)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        color: '#1D7DB5',
                                                        fontSize: 13.5,
                                                        fontWeight: 700,
                                                        pointerEvents: 'none',
                                                        zIndex: 5
                                                    }}>
                                                        {t('basecamp.drop_files_here')}
                                                    </div>
                                                )}
                                                <div
                                                    ref={notesEditorRef}
                                                    contentEditable="true"
                                                    suppressContentEditableWarning
                                                    className="bc-rich-text"
                                                    onInput={() => {
                                                        syncNotesEmptyState()
                                                        saveEditorSelection()
                                                        editorSaveSnapshot()
                                                    }}
                                                    onKeyUp={saveEditorSelection}
                                                    onMouseUp={saveEditorSelection}
                                                    onPaste={handleNotesPaste}
                                                    style={{
                                                        minHeight: 128,
                                                        maxHeight: 340,
                                                        overflowY: 'auto',
                                                        padding: '12px 14px',
                                                        fontSize: 14,
                                                        lineHeight: 1.6,
                                                        color: '#1E293B',
                                                        outline: 'none',
                                                        wordBreak: 'break-word',
                                                        borderBottomLeftRadius: 8,
                                                        borderBottomRightRadius: 8
                                                    }}
                                                />
                                            </div>
                                        </div>

                                        {/* Hidden multi-file inputs */}
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            onChange={handleImageFileSelected}
                                            style={{ display: 'none' }}
                                        />
                                        <input
                                            ref={attachmentInputRef}
                                            type="file"
                                            accept="*/*"
                                            multiple
                                            onChange={handleAttachmentFileSelected}
                                            style={{ display: 'none' }}
                                        />

                                        {uploadError && (
                                            <p style={{ margin: '6px 0 0', fontSize: 12, color: '#DC2626', fontWeight: 600 }}>
                                                {uploadError}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* Subtasks (Matches Basecamp 4 "Subtasks  Add subtasks") */}
                                <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-0">
                                    <label className="w-auto sm:w-[108px] text-left sm:text-right mr-0 sm:mr-4 shrink-0 font-semibold text-[13px] text-[#475569] sm:pt-1">
                                        {t('basecamp.subtasks_label')}
                                    </label>
                                    <div style={{ flex: 1, maxWidth: 540 }}>
                                        {!showSubtasksInput ? (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShowSubtasksInput(true)
                                                    if (newTaskSubtasks.length === 0) setNewTaskSubtasks([''])
                                                }}
                                                style={{
                                                    border: 'none',
                                                    background: 'transparent',
                                                    padding: '4px 0',
                                                    fontSize: 13.5,
                                                    color: '#64748B',
                                                    cursor: 'pointer',
                                                    textAlign: 'left'
                                                }}
                                                onMouseEnter={e => (e.currentTarget.style.color = '#1D7DB5')}
                                                onMouseLeave={e => (e.currentTarget.style.color = '#64748B')}
                                            >
                                                {t('basecamp.add_subtasks_placeholder')}
                                            </button>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                {newTaskSubtasks.map((st, stIdx) => (
                                                    <div key={stIdx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <span style={{ width: 14, height: 14, borderRadius: 3, border: '1.5px solid #CBD5E1', flexShrink: 0, background: '#fff' }} />
                                                        <input
                                                            type="text"
                                                            value={st}
                                                            onChange={e => {
                                                                const val = e.target.value
                                                                setNewTaskSubtasks(prev => prev.map((item, idx) => (idx === stIdx ? val : item)))
                                                            }}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') {
                                                                    e.preventDefault()
                                                                    e.stopPropagation()
                                                                    setNewTaskSubtasks(prev => [...prev.slice(0, stIdx + 1), '', ...prev.slice(stIdx + 1)])
                                                                }
                                                            }}
                                                            placeholder={t('basecamp.add_subtask_item_placeholder')}
                                                            style={{ flex: 1, padding: '5px 8px', borderRadius: 5, border: '1px solid #CBD5E1', fontSize: 13, color: '#1E293B', background: '#fff', outline: 'none' }}
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                if (newTaskSubtasks.length <= 1) {
                                                                    setNewTaskSubtasks([''])
                                                                    setShowSubtasksInput(false)
                                                                } else {
                                                                    setNewTaskSubtasks(prev => prev.filter((_, idx) => idx !== stIdx))
                                                                }
                                                            }}
                                                            style={{ border: 'none', background: 'transparent', color: '#94A3B8', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                ))}
                                                <div>
                                                    <button
                                                        type="button"
                                                        onClick={() => setNewTaskSubtasks(prev => [...prev, ''])}
                                                        style={{ border: 'none', background: 'transparent', color: '#1D7DB5', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: '2px 0' }}
                                                    >
                                                        {t('basecamp.add_another_subtask')}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* 3. Action Buttons — Aligned under fields like Basecamp */}
                            <div className="flex items-center gap-3 mt-3 pt-1 pb-1 pl-0 sm:pl-[152px]">
                                <button
                                    type="submit"
                                    disabled={loading || uploadingAttachment || actionLoading === `add_task_${list.id}`}
                                    style={{
                                        padding: '8px 18px',
                                        borderRadius: 18,
                                        border: 'none',
                                        background: '#1DAB45',
                                        color: '#fff',
                                        fontSize: 13.5,
                                        fontWeight: 600,
                                        cursor: (loading || uploadingAttachment) ? 'not-allowed' : 'pointer',
                                        opacity: (loading || uploadingAttachment || actionLoading === `add_task_${list.id}`) ? 0.65 : 1,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        transition: 'background 0.15s'
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#168A37')}
                                    onMouseLeave={e => (e.currentTarget.style.background = '#1DAB45')}
                                >
                                    {actionLoading === `add_task_${list.id}` && <Loader2 size={14} className="animate-spin" />}
                                    {t('basecamp.add_todo_btn_label')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setAddingTaskId(null)
                                        resetAddTaskForm()
                                    }}
                                    style={{
                                        padding: '7px 16px',
                                        borderRadius: 18,
                                        border: '1px solid #CBD5E1',
                                        background: '#fff',
                                        color: '#475569',
                                        fontSize: 13.5,
                                        fontWeight: 500,
                                        cursor: 'pointer'
                                    }}
                                >
                                    {t('basecamp.cancel')}
                                </button>
                            </div>
                        </form>
                    ) : (
                        <button
                            onClick={() => {
                                resetAddTaskForm()
                                setAddingTaskId(list.id)
                            }}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '6px 12px',
                                borderRadius: 6,
                                border: '1px dashed #CBD5E1',
                                background: '#fff',
                                color: '#1D7DB5',
                                fontSize: 13.5,
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.15s'
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.background = '#F0F9FF'
                                e.currentTarget.style.borderColor = '#38BDF8'
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = '#fff'
                                e.currentTarget.style.borderColor = '#CBD5E1'
                            }}
                        >
                            <Plus size={15} />
                            {t('basecamp.add_todo')}
                        </button>
                    )}
                </div>

                {/* ── Completed Tasks Accordion ── */}
                {displayCompletedCount > 0 && (
                    <div style={{ borderTop: '1px solid #F0EFEB', background: '#FAFAF8' }}>
                        <button
                            onClick={() => toggleCompletedSection(list, completedTasks.length)}
                            style={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '12px 24px',
                                border: 'none',
                                background: 'transparent',
                                cursor: 'pointer',
                                textAlign: 'left',
                                color: '#64748B',
                                fontSize: 13,
                                fontWeight: 600
                            }}
                        >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                {displayCompletedCount} {t('basecamp.completed_todos')}
                            </span>
                        </button>

                        {isExpanded && (
                            <div style={{ padding: '4px 0 12px' }}>
                                {loadingCompletedByList[list.id] && completedTasks.length === 0 && (
                                    <div style={{ padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 8, color: '#64748B', fontSize: 12.5 }}>
                                        <Loader2 size={14} className="animate-spin" style={{ color: '#1D7DB5' }} />
                                        <span>{t('basecamp.loading_bc')}</span>
                                    </div>
                                )}
                                {completedTasks.map((task: any) => (
                                    <div
                                        key={task.id}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 12,
                                            padding: '8px 24px',
                                            color: '#94A3B8'
                                        }}
                                    >
                                        <button
                                            onClick={() => handleToggleTask(list.id, task)}
                                            disabled={actionLoading === task.id}
                                            style={{
                                                width: 18,
                                                height: 18,
                                                borderRadius: 4,
                                                border: '1.5px solid #22C55E',
                                                background: '#22C55E',
                                                color: '#fff',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                cursor: 'pointer',
                                                padding: 0,
                                                flexShrink: 0
                                            }}
                                            title={t('basecamp.mark_incomplete')}
                                        >
                                            <Check size={12} strokeWidth={3} />
                                        </button>
                                        <span
                                            onClick={() => {
                                                setSelectedTask(task)
                                                setSelectedTaskListId(list.id)
                                            }}
                                            style={{
                                                fontSize: 14,
                                                textDecoration: 'line-through',
                                                cursor: 'pointer',
                                                flex: 1
                                            }}
                                        >
                                            {task.task_name}
                                        </span>
                                        {(task.completed_at || task.created_at) && (
                                            <span
                                                title={`${t('basecamp.completed_label')}: ${formatCreatedDateTime(task.completed_at || task.created_at)}`}
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: 3,
                                                    padding: '1px 6px',
                                                    borderRadius: 8,
                                                    background: '#F8FAFC',
                                                    border: '1px solid #E2E8F0',
                                                    color: '#94A3B8',
                                                    fontSize: 10.5,
                                                    fontWeight: 500,
                                                    whiteSpace: 'nowrap',
                                                    flexShrink: 0
                                                }}
                                            >
                                                <Clock size={9.5} style={{ color: '#94A3B8', flexShrink: 0 }} />
                                                {formatCreatedDateTime(task.completed_at || task.created_at)}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        )
    }

    const filteredLists = React.useMemo(() => {
        const sortedLists = lists.map(list => ({
            ...list,
            tasks: sortTasksByCreatedDate(list.tasks)
        }))
        const q = normalizeSearch(todoFilterQuery)
        if (!q) return sortedLists
        return sortedLists.map(list => {
            const listMatches =
                normalizeSearch(list.list_name).includes(q) ||
                normalizeSearch(list.description).includes(q)
            const matchingTasks = list.tasks.filter((tk: any) =>
                normalizeSearch(tk.task_name).includes(q) ||
                normalizeSearch(tk.creator_name).includes(q) ||
                normalizeSearch(tk.assignee).includes(q)
            )
            if (listMatches) return list
            if (matchingTasks.length > 0) {
                return { ...list, tasks: matchingTasks }
            }
            return null
        }).filter(Boolean) as any[]
    }, [lists, todoFilterQuery, sortTasksByCreatedDate])

    return (
        <div style={{ maxWidth: 1280, width: '100%', margin: '0 auto', padding: '0 12px' }}>
            <style dangerouslySetInnerHTML={{ __html: `
                .bc-notes-editor:empty:before {
                    content: attr(data-placeholder);
                    color: #94A3B8;
                    pointer-events: none;
                }
                .bc-rich-text a { color: #1D7DB5; text-decoration: none; font-weight: 500; }
                .bc-rich-text a:hover { text-decoration: underline; }
                .bc-rich-text img { max-width: 100%; height: auto; border-radius: 8px; margin: 10px 0; cursor: pointer; display: block; }
                .bc-rich-text h1 { font-size: 1.35rem; font-weight: 700; margin: 6px 0; line-height: 1.3; }
                .bc-rich-text h2 { font-size: 1.12rem; font-weight: 600; margin: 5px 0; line-height: 1.35; }
                .bc-rich-text ul { padding-left: 20px; list-style-type: disc; margin: 6px 0; }
                .bc-rich-text ol { padding-left: 20px; list-style-type: decimal; margin: 6px 0; }
                .bc-rich-text blockquote { border-left: 3px solid #CBD5E1; padding-left: 12px; margin: 8px 0; color: #64748B; font-style: italic; }
                .bc-rich-text table { border-collapse: collapse; width: 100%; margin: 8px 0; }
                .bc-rich-text td, .bc-rich-text th { border: 1px solid #CBD5E1; padding: 6px 8px; }
            ` }} />
            {mutationError && (
                <div style={{
                    marginTop: 12,
                    padding: '10px 14px',
                    borderRadius: 8,
                    background: '#FEF2F2',
                    border: '1px solid #FECACA',
                    color: '#B91C1C',
                    fontSize: 13,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12
                }}>
                    <span>{mutationError}</span>
                    <button
                        type="button"
                        onClick={() => setMutationError(null)}
                        style={{ border: 'none', background: 'transparent', color: '#B91C1C', cursor: 'pointer', fontWeight: 800 }}
                    >
                        ✕
                    </button>
                </div>
            )}
            {/* ── Drill-down Single List View ── */}
            {selectedListId ? (
                (() => {
                    const activeList = lists.find(l => l.id === selectedListId)
                    const activeListIdx = lists.findIndex(l => l.id === selectedListId)
                    if (!activeList) {
                        return (
                            <div style={{ padding: '36px 0', textAlign: 'center' }}>
                                <p style={{ color: '#64748B', fontSize: 15, marginBottom: 16 }}>
                                    {t('basecamp.list_not_found')}
                                </p>
                                <button
                                    onClick={() => setSelectedListId(null)}
                                    style={{
                                        padding: '8px 16px',
                                        borderRadius: 6,
                                        background: '#1D7DB5',
                                        color: '#fff',
                                        border: 'none',
                                        fontSize: 13.5,
                                        fontWeight: 600,
                                        cursor: 'pointer'
                                    }}
                                >
                                    ← {t('basecamp.back_to_todos')}
                                </button>
                            </div>
                        )
                    }
                    return (
                        <div style={{ padding: '24px 0 48px' }}>
                            {renderFullList(activeList, activeListIdx >= 0 ? activeListIdx : 0, true)}
                        </div>
                    )
                })()
            ) : (
                /* ── Main View (Cards or List View) ── */
                <>
                    {/* Header Controls */}
                    <div style={{ padding: '28px 0 20px' }}>
                        <h1 style={{
                            fontSize: 36,
                            fontWeight: 700,
                            color: '#1D2D35',
                            margin: 0,
                            lineHeight: 1.1,
                            fontFamily: 'system-ui, -apple-system, sans-serif'
                        }}>
                            {t('basecamp.todos')}
                        </h1>

                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            marginTop: 16,
                            marginBottom: 8,
                            flexWrap: 'wrap'
                        }}>
                            <button
                                onClick={() => setShowAddList(true)}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '8px 16px',
                                    borderRadius: 6,
                                    border: 'none',
                                    background: '#1D7DB5',
                                    color: '#fff',
                                    fontSize: 13.5,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    transition: 'background 0.15s'
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = '#155D8A')}
                                onMouseLeave={e => (e.currentTarget.style.background = '#1D7DB5')}
                            >
                                <Plus size={15} />
                                {t('basecamp.add_list')}
                            </button>

                            {/* View As Menu */}
                            <div style={{ position: 'relative' }} ref={viewAsMenuRef}>
                                <button
                                    onClick={() => setShowViewAsMenu(!showViewAsMenu)}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        padding: '8px 14px',
                                        borderRadius: 6,
                                        border: '1px solid #D5D3CE',
                                        background: '#fff',
                                        color: '#1D2D35',
                                        fontSize: 13.5,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        transition: 'background 0.15s, border-color 0.15s',
                                        boxShadow: showViewAsMenu ? '0 0 0 2px rgba(29, 125, 181, 0.2)' : 'none'
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#F7F7F5')}
                                    onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                                >
                                    <span>{t('basecamp.view_as')}</span>
                                    <ChevronDown
                                        size={14}
                                        style={{
                                            color: '#77858C',
                                            transform: showViewAsMenu ? 'rotate(180deg)' : 'none',
                                            transition: 'transform 0.15s'
                                        }}
                                    />
                                </button>

                                {showViewAsMenu && (
                                    <div
                                        style={{
                                            position: 'absolute',
                                            top: '100%',
                                            left: 0,
                                            marginTop: 6,
                                            minWidth: 190,
                                            background: '#1E293B',
                                            color: '#fff',
                                            borderRadius: 10,
                                            padding: '8px 6px',
                                            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3), 0 8px 10px -6px rgba(0,0,0,0.2)',
                                            zIndex: 50,
                                            border: '1px solid rgba(255,255,255,0.1)'
                                        }}
                                    >
                                        <div style={{
                                            padding: '4px 10px 8px',
                                            fontSize: 11,
                                            fontWeight: 700,
                                            color: '#94A3B8',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.05em',
                                            borderBottom: '1px solid rgba(255,255,255,0.1)',
                                            marginBottom: 4
                                        }}>
                                            {t('basecamp.view_todos_prompt')}
                                        </div>
                                        <button
                                            onClick={() => { setViewMode('list'); setShowViewAsMenu(false) }}
                                            style={{
                                                width: '100%',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                padding: '8px 10px',
                                                borderRadius: 6,
                                                border: 'none',
                                                background: viewMode === 'list' ? 'rgba(255,255,255,0.1)' : 'transparent',
                                                color: '#fff',
                                                fontSize: 13.5,
                                                fontWeight: viewMode === 'list' ? 700 : 500,
                                                cursor: 'pointer',
                                                textAlign: 'left'
                                            }}
                                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
                                            onMouseLeave={e => (e.currentTarget.style.background = viewMode === 'list' ? 'rgba(255,255,255,0.1)' : 'transparent')}
                                        >
                                            <span>{t('basecamp.view_in_list')}</span>
                                            {viewMode === 'list' && <Check size={16} style={{ color: '#38BDF8' }} />}
                                        </button>
                                        <button
                                            onClick={() => { setViewMode('cards'); setShowViewAsMenu(false) }}
                                            style={{
                                                width: '100%',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                padding: '8px 10px',
                                                borderRadius: 6,
                                                border: 'none',
                                                background: viewMode === 'cards' ? 'rgba(255,255,255,0.1)' : 'transparent',
                                                color: '#fff',
                                                fontSize: 13.5,
                                                fontWeight: viewMode === 'cards' ? 700 : 500,
                                                cursor: 'pointer',
                                                textAlign: 'left'
                                            }}
                                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
                                            onMouseLeave={e => (e.currentTarget.style.background = viewMode === 'cards' ? 'rgba(255,255,255,0.1)' : 'transparent')}
                                        >
                                            <span>{t('basecamp.view_as_cards')}</span>
                                            {viewMode === 'cards' && <Check size={16} style={{ color: '#38BDF8' }} />}
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Sort by Creation Date Toggle */}
                            <button
                                type="button"
                                onClick={() => setSortOrder(prev => prev === 'newest' ? 'oldest' : 'newest')}
                                title={t('basecamp.sort_by_created_tooltip')}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '8px 14px',
                                    borderRadius: 6,
                                    border: '1px solid #D5D3CE',
                                    background: '#fff',
                                    color: '#1D2D35',
                                    fontSize: 13.5,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    transition: 'background 0.15s, border-color 0.15s'
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = '#F7F7F5')}
                                onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                            >
                                <Clock size={14} style={{ color: '#1D7DB5' }} />
                                <span>{sortOrder === 'newest' ? t('basecamp.sort_newest_first') : t('basecamp.sort_oldest_first')}</span>
                            </button>

                            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                                <input
                                    type="text"
                                    value={todoFilterQuery}
                                    onChange={(e) => setTodoFilterQuery(e.target.value)}
                                    placeholder={t('basecamp.filter_placeholder')}
                                    style={{
                                        padding: todoFilterQuery ? '8px 28px 8px 12px' : '8px 12px',
                                        borderRadius: 6,
                                        border: '1px solid #D5D3CE',
                                        background: '#fff',
                                        color: '#1D2D35',
                                        fontSize: 13.5,
                                        width: 150,
                                        outline: 'none',
                                        transition: 'border-color 0.15s, box-shadow 0.15s'
                                    }}
                                    onFocus={e => {
                                        e.target.style.borderColor = '#1D7DB5'
                                        e.target.style.boxShadow = '0 0 0 2px rgba(29, 125, 181, 0.15)'
                                    }}
                                    onBlur={e => {
                                        e.target.style.borderColor = '#D5D3CE'
                                        e.target.style.boxShadow = 'none'
                                    }}
                                />
                                {todoFilterQuery && (
                                    <button
                                        type="button"
                                        onClick={() => setTodoFilterQuery('')}
                                        style={{
                                            position: 'absolute',
                                            right: 8,
                                            border: 'none',
                                            background: 'transparent',
                                            color: '#94A3B8',
                                            cursor: 'pointer',
                                            fontSize: 12,
                                            fontWeight: 700,
                                            padding: '2px 4px',
                                            lineHeight: 1
                                        }}
                                        title={t('basecamp.clear_filter')}
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Loading State */}
                    {loading && lists.length === 0 ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
                            <Loader2 className="animate-spin" style={{ width: 32, height: 32, color: '#1D7DB5' }} />
                        </div>
                    ) : lists.length > 0 ? (
                        filteredLists.length === 0 ? (
                            <div style={{ padding: '48px 0', textAlign: 'center', color: '#64748B' }}>
                                <p style={{ fontSize: 15, fontWeight: 600, color: '#1E293B', marginBottom: 8 }}>
                                    {t('basecamp.no_matching_todos')}
                                </p>
                                <button
                                    onClick={() => setTodoFilterQuery('')}
                                    style={{
                                        padding: '6px 14px',
                                        borderRadius: 6,
                                        background: '#F1F5F9',
                                        border: '1px solid #CBD5E1',
                                        color: '#1D7DB5',
                                        fontSize: 13,
                                        fontWeight: 600,
                                        cursor: 'pointer'
                                    }}
                                >
                                    {t('basecamp.clear_filter')}
                                </button>
                            </div>
                        ) : viewMode === 'cards' ? (
                            /* ── Cards View Mode: Clickable preview cards ── */
                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                                    gap: 24,
                                    alignItems: 'start',
                                    paddingBottom: 48
                                }}
                            >
                                {filteredLists.map((list, listIdx) => {
                                    const openTasks = list.tasks.filter((tk: any) => !tk.is_completed)
                                    const completedTasks = list.tasks.filter((tk: any) => tk.is_completed)
                                    const dotColor = LIST_DOT_COLORS[listIdx % LIST_DOT_COLORS.length]
                                    const previewTasks = openTasks.slice(0, 6)
                                    const remainingCount = openTasks.length - previewTasks.length

                                    return (
                                        <div
                                            key={list.id}
                                            onClick={() => setSelectedListId(list.id)}
                                            style={{
                                                background: '#fff',
                                                borderRadius: 12,
                                                border: '1.5px solid #E8E6E1',
                                                padding: '20px 22px',
                                                boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s ease',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                minHeight: 220
                                            }}
                                            onMouseEnter={e => {
                                                e.currentTarget.style.transform = 'translateY(-2px)'
                                                e.currentTarget.style.boxShadow = '0 10px 25px rgba(0,0,0,0.08)'
                                                e.currentTarget.style.borderColor = '#CBD5E1'
                                            }}
                                            onMouseLeave={e => {
                                                e.currentTarget.style.transform = 'none'
                                                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)'
                                                e.currentTarget.style.borderColor = '#E8E6E1'
                                            }}
                                        >
                                            {/* Card Header */}
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
                                                <span
                                                    style={{
                                                        width: 10,
                                                        height: 10,
                                                        borderRadius: '50%',
                                                        backgroundColor: dotColor,
                                                        marginTop: 6,
                                                        flexShrink: 0
                                                    }}
                                                />
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <h3 style={{
                                                        fontSize: 18,
                                                        fontWeight: 700,
                                                        color: '#1D2D35',
                                                        margin: 0,
                                                        lineHeight: 1.3
                                                    }}>
                                                        {list.list_name}
                                                    </h3>
                                                    {list.description && (
                                                        <p style={{
                                                            fontSize: 13,
                                                            color: '#64748B',
                                                            margin: '4px 0 0',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            whiteSpace: 'nowrap'
                                                        }}>
                                                            {list.description}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Preview Tasks */}
                                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, margin: '8px 0 16px' }}>
                                                {openTasks.length === 0 ? (
                                                    <div style={{ color: '#94A3B8', fontSize: 13, fontStyle: 'italic', padding: '12px 0' }}>
                                                        {t('basecamp.no_open_todos')}
                                                    </div>
                                                ) : (
                                                    previewTasks.map((task: any) => {
                                                        const hasComments = task.comments_count > 0 || (task.comments && task.comments.length > 0)
                                                        const commentCount = task.comments_count || (task.comments ? task.comments.length : 0)

                                                        return (
                                                            <div
                                                                key={task.id}
                                                                style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: 8,
                                                                    fontSize: 13.5,
                                                                    color: '#334155'
                                                                }}
                                                            >
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation()
                                                                        handleToggleTask(list.id, task)
                                                                    }}
                                                                    disabled={actionLoading === task.id}
                                                                    style={{
                                                                        width: 15,
                                                                        height: 15,
                                                                        borderRadius: 3,
                                                                        border: '1.5px solid #CBD5E1',
                                                                        background: '#fff',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        cursor: 'pointer',
                                                                        flexShrink: 0,
                                                                        padding: 0
                                                                    }}
                                                                >
                                                                    {actionLoading === task.id ? (
                                                                        <Loader2 size={10} className="animate-spin text-slate-400" />
                                                                    ) : null}
                                                                </button>
                                                                <span
                                                                    onClick={(e) => {
                                                                        e.stopPropagation()
                                                                        setSelectedTask(task)
                                                                        setSelectedTaskListId(list.id)
                                                                    }}
                                                                    style={{
                                                                        overflow: 'hidden',
                                                                        textOverflow: 'ellipsis',
                                                                        whiteSpace: 'nowrap',
                                                                        flex: 1,
                                                                        cursor: 'pointer'
                                                                    }}
                                                                    onMouseEnter={e => (e.currentTarget.style.color = '#1D7DB5')}
                                                                    onMouseLeave={e => (e.currentTarget.style.color = '#334155')}
                                                                >
                                                                    {task.task_name}
                                                                </span>

                                                                {task.created_at && (
                                                                    <span
                                                                        title={`${t('basecamp.created_at_label')}: ${formatCreatedDateTime(task.created_at)}`}
                                                                        style={{
                                                                            display: 'inline-flex',
                                                                            alignItems: 'center',
                                                                            gap: 2.5,
                                                                            padding: '1px 5px',
                                                                            borderRadius: 6,
                                                                            background: '#F8FAFC',
                                                                            border: '1px solid #E2E8F0',
                                                                            color: '#64748B',
                                                                            fontSize: 10,
                                                                            fontWeight: 500,
                                                                            whiteSpace: 'nowrap',
                                                                            flexShrink: 0
                                                                        }}
                                                                    >
                                                                        <Clock size={9} style={{ color: '#94A3B8', flexShrink: 0 }} />
                                                                        {formatCreatedDateTime(task.created_at, false)}
                                                                    </span>
                                                                )}

                                                                {hasComments && (
                                                                    <span style={{
                                                                        display: 'inline-flex',
                                                                        alignItems: 'center',
                                                                        gap: 3,
                                                                        color: '#1D7DB5',
                                                                        fontSize: 11,
                                                                        fontWeight: 600,
                                                                        flexShrink: 0
                                                                    }}>
                                                                        <MessageSquare size={11} />
                                                                        {commentCount}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )
                                                    })
                                                )}
                                            </div>

                                            {/* Card Footer */}
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                paddingTop: 12,
                                                borderTop: '1px solid #F1F5F9',
                                                fontSize: 12,
                                                color: '#64748B',
                                                fontWeight: 600
                                            }}>
                                                <div>
                                                    {remainingCount > 0 && (
                                                        <span style={{ color: '#1D7DB5' }}>
                                                            +{remainingCount} {t('basecamp.more_todos')}
                                                        </span>
                                                    )}
                                                </div>

                                                {((todoFilterQuery.trim() ? completedTasks.length : (list.completed_count !== undefined && list.completed_count !== null ? Math.max(Number(list.completed_count), completedTasks.length) : completedTasks.length)) > 0) && (
                                                    <span style={{ color: '#16A34A', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        <Check size={12} />
                                                        {todoFilterQuery.trim() ? completedTasks.length : (list.completed_count !== undefined && list.completed_count !== null ? Math.max(Number(list.completed_count), completedTasks.length) : completedTasks.length)} {t('basecamp.done_short')}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            /* ── Continuous Stacked Flat List Mode ── */
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 36, paddingBottom: 48 }}>
                                {filteredLists.map((list, listIdx) => renderFullList(list, listIdx, false))}
                            </div>
                        )
                    ) : (
                        <div style={{ padding: '60px 0', textAlign: 'center', color: '#64748B' }}>
                            <ClipboardList style={{ width: 48, height: 48, margin: '0 auto 16px', color: '#CBD5E1' }} />
                            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E293B', marginBottom: 6 }}>
                                {t('basecamp.no_todolists')}
                            </h3>
                            <p style={{ fontSize: 14, color: '#64748B', maxWidth: 400, margin: '0 auto 20px' }}>
                                {t('basecamp.no_todolists_desc')}
                            </p>
                            <button
                                onClick={() => setShowAddList(true)}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '10px 20px',
                                    borderRadius: 6,
                                    border: 'none',
                                    background: '#1D7DB5',
                                    color: '#fff',
                                    fontSize: 14,
                                    fontWeight: 700,
                                    cursor: 'pointer'
                                }}
                            >
                                <Plus size={16} />
                                {t('basecamp.add_first_list')}
                            </button>
                        </div>
                    )}
                </>
            )}

            {/* ══════════════════════════════════════════════════════════════════
                Modal — New List
               ══════════════════════════════════════════════════════════════════ */}
            {showAddList && (
                <div
                    onClick={(e) => { if (e.target === e.currentTarget) setShowAddList(false) }}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 50,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 16,
                        background: 'rgba(0,0,0,0.4)'
                    }}
                >
                    <div style={{
                        background: '#fff',
                        borderRadius: 10,
                        maxWidth: 520,
                        width: '100%',
                        padding: '28px 32px',
                        boxShadow: '0 20px 40px rgba(0,0,0,0.15)'
                    }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: 20
                        }}>
                            <h2 style={{
                                fontSize: 20,
                                fontWeight: 700,
                                color: '#1D2D35',
                                margin: 0
                            }}>
                                {t('basecamp.new_list_title')}
                            </h2>
                            <button
                                onClick={() => setShowAddList(false)}
                                style={{
                                    border: 'none',
                                    background: 'transparent',
                                    cursor: 'pointer',
                                    color: '#94A3B8',
                                    fontSize: 18,
                                    padding: 4
                                }}
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleAddList}>
                            <div style={{ marginBottom: 16 }}>
                                <label style={{
                                    display: 'block',
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: '#1D2D35',
                                    marginBottom: 6
                                }}>
                                    {t('basecamp.list_name_label')}
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={newListName}
                                    onChange={(e) => setNewListName(e.target.value)}
                                    placeholder={t('basecamp.new_list_placeholder')}
                                    autoFocus
                                    style={{
                                        width: '100%',
                                        padding: '10px 12px',
                                        borderRadius: 6,
                                        border: '1.5px solid #CBD5E1',
                                        fontSize: 14.5,
                                        outline: 'none',
                                        color: '#1E293B'
                                    }}
                                />
                            </div>

                            <div style={{ marginBottom: 20 }}>
                                <label style={{
                                    display: 'block',
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: '#1D2D35',
                                    marginBottom: 6
                                }}>
                                    {t('basecamp.list_desc_label')}
                                </label>
                                <textarea
                                    value={newListDesc}
                                    onChange={(e) => setNewListDesc(e.target.value)}
                                    placeholder={t('basecamp.list_desc_placeholder')}
                                    rows={3}
                                    style={{
                                        width: '100%',
                                        padding: '10px 12px',
                                        borderRadius: 6,
                                        border: '1.5px solid #CBD5E1',
                                        fontSize: 14,
                                        outline: 'none',
                                        color: '#1E293B',
                                        resize: 'vertical'
                                    }}
                                />
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                                <button
                                    type="button"
                                    onClick={() => setShowAddList(false)}
                                    style={{
                                        padding: '8px 16px',
                                        borderRadius: 6,
                                        border: '1px solid #CBD5E1',
                                        background: '#fff',
                                        color: '#64748B',
                                        fontSize: 13.5,
                                        fontWeight: 600,
                                        cursor: 'pointer'
                                    }}
                                >
                                    {t('basecamp.cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    style={{
                                        padding: '8px 20px',
                                        borderRadius: 6,
                                        border: 'none',
                                        background: '#22C55E',
                                        color: '#fff',
                                        fontSize: 13.5,
                                        fontWeight: 700,
                                        cursor: 'pointer'
                                    }}
                                >
                                    {t('basecamp.create_list')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

                                            {/* ══════════════════════════════════════════════════════════════════
                Modal — Task Detail (Modern Basecamp 4 Dialog Card with Backdrop Blur)
               ══════════════════════════════════════════════════════════════════ */}
            {selectedTask && (() => {
                const parentList = lists.find(l => l.id === selectedTaskListId)
                const listName = parentList?.list_name || t('basecamp.todos')

                return (
                    <div
                        onClick={(e) => { if (e.target === e.currentTarget) closeTaskDetail() }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-200"
                        style={{
                            background: 'rgba(15, 23, 42, 0.65)',
                            backdropFilter: 'blur(8px)',
                            WebkitBackdropFilter: 'blur(8px)'
                        }}
                    >
                        <div
                            className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200/80 dark:border-slate-800 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
                            style={{ boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.35)' }}
                        >
                            {/* ── 1. Top Bar / Breadcrumb & Actions ── */}
                            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-md flex-shrink-0">
                                <button
                                    onClick={() => closeTaskDetail()}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 text-xs font-bold text-[#1D7DB5] hover:bg-slate-100 dark:hover:bg-slate-700/80 transition-all shadow-sm cursor-pointer"
                                >
                                    ← {listName}
                                </button>

                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={(e) => {
                                            handleDeleteTask(selectedTaskListId || '', selectedTask, e)
                                        }}
                                        className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 text-slate-400 transition-all flex items-center justify-center cursor-pointer"
                                        title={t('basecamp.delete_todo')}
                                    >
                                        <Trash2 size={15} />
                                    </button>
                                    <button
                                        onClick={() => closeTaskDetail()}
                                        className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 font-bold transition-all flex items-center justify-center cursor-pointer text-sm"
                                        title={t('basecamp.close_esc')}
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>

                            {/* ── 2. Scrollable Body Content ── */}
                            <div className="overflow-y-auto flex-1 p-6 sm:p-8 space-y-6">

                                {/* ── Hero Title Section ── */}
                                <div className="space-y-3">
                                    <div className="flex items-start gap-4">
                                        <button
                                            onClick={() => handleToggleTask(selectedTaskListId || '', selectedTask)}
                                            disabled={actionLoading === selectedTask.id}
                                            className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-1 cursor-pointer transition-all duration-200 shadow-sm ${
                                                selectedTask.is_completed
                                                    ? 'bg-emerald-500 border-2 border-emerald-500 text-white hover:bg-emerald-600'
                                                    : 'border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                                            }`}
                                            title={selectedTask.is_completed ? t('basecamp.mark_incomplete') : t('basecamp.mark_complete')}
                                        >
                                            {selectedTask.is_completed ? (
                                                <Check size={18} strokeWidth={3} />
                                            ) : (
                                                actionLoading === selectedTask.id && (
                                                    <Loader2 className="animate-spin text-slate-400" size={14} />
                                                )
                                            )}
                                        </button>

                                        <div className="flex-1 min-w-0">
                                            <h2 className={`text-2xl sm:text-3xl font-extrabold tracking-tight leading-snug transition-all ${
                                                selectedTask.is_completed
                                                    ? 'line-through text-slate-400 dark:text-slate-500'
                                                    : 'text-slate-900 dark:text-white'
                                            }`}>
                                                {selectedTask.task_name}
                                            </h2>

                                            {/* Subtitle with Creator, Creation Date/Time & Status */}
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
                                                            {formatCreatedDateTime(selectedTask.created_at)}
                                                        </strong>
                                                    </span>
                                                )}
                                                {selectedTask.creator_name && (
                                                    <span className="inline-flex items-center gap-1.5">
                                                        {t('basecamp.added_by')}{' '}
                                                        <span
                                                            className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black text-white"
                                                            style={{ backgroundColor: getAvatarColor(selectedTask.creator_name) }}
                                                        >
                                                            {getInitials(selectedTask.creator_name)}
                                                        </span>
                                                        <strong className="text-slate-700 dark:text-slate-300 font-semibold">{selectedTask.creator_name}</strong>
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* ── 3. Structured Metadata Grid ── */}
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                                    {/* Assigned To */}
                                    <div className="space-y-1.5">
                                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                            {t('basecamp.assign_to')}
                                        </span>
                                        <div className="flex flex-wrap gap-1.5 items-center">
                                            {selectedTask.assigneeList && selectedTask.assigneeList.length > 0 ? (
                                                selectedTask.assigneeList.map((a: any) => (
                                                    <span
                                                        key={a.id}
                                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 shadow-2xs"
                                                        title={a.name}
                                                    >
                                                        <span
                                                            className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black text-white flex-shrink-0"
                                                            style={{ backgroundColor: getAvatarColor(a.name) }}
                                                        >
                                                            {getInitials(a.name)}
                                                        </span>
                                                        <span className="truncate max-w-[120px]">{a.name}</span>
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="text-xs text-slate-400 italic">
                                                    {t('basecamp.no_assigned')}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Due Date */}
                                    <div className="space-y-1.5">
                                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                            {t('basecamp.due_on')}
                                        </span>
                                        <div>
                                            {selectedTask.due_date ? (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/80 text-xs font-bold text-amber-800 dark:text-amber-300">
                                                    <Calendar size={12} />
                                                    {formatDueDate(selectedTask.due_date)}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-slate-400 italic">
                                                    {t('basecamp.no_due_date')}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* When Done */}
                                    <div className="space-y-1.5">
                                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                            {t('basecamp.when_done')}
                                        </span>
                                        {(() => {
                                            const parsedMeta = prepareRichContent(selectedTask.description as string)
                                            if (parsedMeta.whenDoneNames) {
                                                return (
                                                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                        {parsedMeta.whenDoneNames}
                                                    </p>
                                                )
                                            }
                                            return (
                                                <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                                                    {t('basecamp.notify_people')}
                                                </p>
                                            )
                                        })()}
                                    </div>
                                </div>

                                {/* ── 4. Description / Notes Section ── */}
                                {selectedTask.description && (() => {
                                    const { sanitizedHtml: richHtml, nonImageAttachments } = prepareRichContent(selectedTask.description as string)

                                    if (!richHtml && nonImageAttachments.length === 0) return null

                                    return (
                                        <div className="rounded-2xl bg-slate-50/60 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
                                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                                                {t('basecamp.notes_label')}
                                            </span>

                                            {richHtml && (
                                                <div
                                                    className="bc-rich-text text-sm text-slate-800 dark:text-slate-200 leading-relaxed"
                                                    onClick={handleHtmlClick}
                                                    dangerouslySetInnerHTML={{ __html: richHtml }}
                                                />
                                            )}

                                            {/* Non-image File Attachments */}
                                            {nonImageAttachments.length > 0 && (
                                                <div className="pt-3 border-t border-slate-200/80 dark:border-slate-700/80 flex flex-wrap gap-2">
                                                    {nonImageAttachments.map((att: any, attIdx: number) => (
                                                        <a
                                                            key={attIdx}
                                                            href={sanitizeAttachmentHref(att.url || att.href)}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-[#1D7DB5] text-xs font-semibold text-slate-700 dark:text-slate-200 transition-all shadow-2xs hover:shadow-xs"
                                                        >
                                                            <Paperclip size={13} className="text-[#1D7DB5]" />
                                                            <span className="truncate max-w-[200px]">{safeDecodeFilename(att.filename) || t('basecamp.attached_file_fallback')}</span>
                                                            <span className="text-[10px] font-bold text-[#1D7DB5]">{t('basecamp.download_btn')}</span>
                                                        </a>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })()}

                                {/* ── 5. Discussion / Comments Stream ── */}
                                <div className="space-y-4 pt-2">
                                    <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                                        <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                            <MessageSquare size={15} className="text-[#1D7DB5]" />
                                            {t('basecamp.comments_title')} ({commentsLoading && taskComments.length === 0 ? (selectedTask.comments_count || 0) : taskComments.length})
                                        </h4>
                                    </div>

                                    {commentsLoading ? (
                                        <div className="text-center py-8 text-[#1D7DB5]">
                                            <Loader2 className="animate-spin mx-auto w-6 h-6" />
                                        </div>
                                    ) : taskComments && taskComments.length > 0 ? (
                                        <div className="space-y-4">
                                            {taskComments.map((c: any, idx: number) => {
                                                const { sanitizedHtml: commentHtml, nonImageAttachments: commentFiles } = prepareRichContent(c.text)
                                                return (
                                                    <div
                                                        key={c.id || idx}
                                                        className="flex items-start gap-3.5 p-4 rounded-2xl bg-white dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 shadow-2xs"
                                                    >
                                                        {/* Avatar */}
                                                        <div
                                                            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black text-white flex-shrink-0 shadow-2xs mt-0.5"
                                                            style={{ backgroundColor: getAvatarColor(c.author) }}
                                                        >
                                                            {getInitials(c.author)}
                                                        </div>

                                                        {/* Content */}
                                                        <div className="flex-1 min-w-0 space-y-2">
                                                            <div className="flex items-center justify-between flex-wrap gap-2">
                                                                <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                                                                    {c.author}
                                                                </span>
                                                                <span className="text-[11px] text-slate-400">
                                                                    {formatCreatedDateTime(c.timestamp)}
                                                                </span>
                                                            </div>

                                                            {commentHtml && (
                                                                <div
                                                                    className="bc-rich-text text-sm text-slate-700 dark:text-slate-300 leading-relaxed"
                                                                    onClick={handleHtmlClick}
                                                                    dangerouslySetInnerHTML={{ __html: commentHtml }}
                                                                />
                                                            )}

                                                            {commentFiles.length > 0 && (
                                                                <div className="pt-1 flex flex-wrap gap-2">
                                                                    {commentFiles.map((att: any, attIdx: number) => (
                                                                        <a
                                                                            key={attIdx}
                                                                            href={sanitizeAttachmentHref(att.url || att.href)}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-[#1D7DB5] text-xs font-semibold text-slate-700 dark:text-slate-200 transition-all"
                                                                        >
                                                                            <Paperclip size={13} className="text-[#1D7DB5]" />
                                                                            <span className="truncate max-w-[200px]">{safeDecodeFilename(att.filename) || t('basecamp.attached_file_fallback')}</span>
                                                                            <span className="text-[10px] font-bold text-[#1D7DB5]">{t('basecamp.download_btn')}</span>
                                                                        </a>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    ) : (
                                        <div className="text-center py-8 px-4 rounded-2xl bg-slate-50/60 dark:bg-slate-800/30 border border-dashed border-slate-200 dark:border-slate-800">
                                            <MessageSquare size={24} className="text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                                            <p className="text-xs text-slate-400 font-medium">
                                                {t('basecamp.no_comments_desc')}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* ── 6. Bottom Sticky Comment Input Form (with Photo & File Attachments) ── */}
                            <div className="p-4 sm:p-5 bg-slate-50/90 dark:bg-slate-900/90 border-t border-slate-100 dark:border-slate-800 backdrop-blur-md flex-shrink-0">
                                <form onSubmit={handleAddComment} className="flex gap-3 items-start">
                                    <div
                                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black text-white flex-shrink-0 mt-1 shadow-2xs"
                                        style={{ backgroundColor: getAvatarColor(currentUserName || 'U') }}
                                    >
                                        {getInitials(currentUserName || 'User')}
                                    </div>
                                    <div className="flex-1 flex flex-col gap-2">
                                        <textarea
                                            value={newComment}
                                            onChange={(e) => setNewComment(e.target.value)}
                                            onPaste={async (e) => {
                                                const files: File[] = []
                                                for (const item of Array.from(e.clipboardData?.items || [])) {
                                                    if (item.kind === 'file') {
                                                        const f = item.getAsFile()
                                                        if (f) files.push(f)
                                                    }
                                                }
                                                if (files.length > 0) {
                                                    e.preventDefault()
                                                    await uploadFilesForComment(files)
                                                }
                                            }}
                                            placeholder={t('basecamp.add_comment_placeholder')}
                                            rows={2}
                                            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-[#1D7DB5] transition-all resize-y"
                                        />

                                        {commentAttachments.length > 0 && (
                                            <div className="flex flex-wrap gap-2">
                                                {commentAttachments.map((att, idx) => (
                                                    <span
                                                        key={idx}
                                                        className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200"
                                                    >
                                                        {att.contentType.startsWith('image/') ? <Image size={13} className="text-[#1D7DB5]" /> : <Paperclip size={13} className="text-[#1D7DB5]" />}
                                                        <span className="truncate max-w-[180px]">{att.filename}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setCommentAttachments(prev => prev.filter((_, i) => i !== idx))}
                                                            className="text-red-500 hover:text-red-600 font-bold cursor-pointer"
                                                        >
                                                            ✕
                                                        </button>
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => commentImageInputRef.current?.click()}
                                                    disabled={uploadingCommentAttachment}
                                                    title={t('basecamp.attach_image_btn')}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-[#1D7DB5] text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                                                >
                                                    <Image size={14} className="text-[#1D7DB5]" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => commentFileInputRef.current?.click()}
                                                    disabled={uploadingCommentAttachment}
                                                    title={t('basecamp.attach_file_btn')}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-[#1D7DB5] text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                                                >
                                                    <Paperclip size={14} className="text-[#1D7DB5]" />
                                                </button>
                                                {uploadingCommentAttachment && (
                                                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#1D7DB5]">
                                                        <Loader2 size={13} className="animate-spin" />
                                                        {t('basecamp.uploading_real_file')}
                                                    </span>
                                                )}
                                                <input
                                                    ref={commentImageInputRef}
                                                    type="file"
                                                    accept="image/*"
                                                    multiple
                                                    onChange={async (e) => {
                                                        const files = Array.from(e.target.files || [])
                                                        e.target.value = ''
                                                        await uploadFilesForComment(files)
                                                    }}
                                                    style={{ display: 'none' }}
                                                />
                                                <input
                                                    ref={commentFileInputRef}
                                                    type="file"
                                                    accept="*/*"
                                                    multiple
                                                    onChange={async (e) => {
                                                        const files = Array.from(e.target.files || [])
                                                        e.target.value = ''
                                                        await uploadFilesForComment(files)
                                                    }}
                                                    style={{ display: 'none' }}
                                                />
                                            </div>

                                            <button
                                                type="submit"
                                                disabled={actionLoading === 'comment' || uploadingCommentAttachment || (!newComment.trim() && commentAttachments.length === 0)}
                                                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-all cursor-pointer disabled:opacity-50"
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
                        position: 'fixed', inset: 0, zIndex: 100,
                        background: 'rgba(0,0,0,0.85)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'zoom-out', padding: 20
                    }}
                >
                    <button
                        onClick={(e) => { e.stopPropagation(); setLightboxUrl(null) }}
                        style={{
                            position: 'absolute', top: 20, right: 20,
                            width: 40, height: 40, borderRadius: '50%',
                            background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
                            color: '#fff', fontSize: 20, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'background 0.15s'
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.3)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
                    >
                        ✕
                    </button>
                    <img
                        src={lightboxUrl}
                        alt={t('basecamp.fullscreen_view')}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            maxWidth: '90vw', maxHeight: '90vh',
                            objectFit: 'contain',
                            borderRadius: 8,
                            boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
                            cursor: 'default'
                        }}
                    />
                    {/* Download button */}
                    <a
                        href={lightboxUrl}
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            position: 'absolute', bottom: 20,
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '8px 18px', borderRadius: 20,
                            background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
                            color: '#fff', fontSize: 13, fontWeight: 600,
                            textDecoration: 'none', cursor: 'pointer',
                            transition: 'background 0.15s'
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.3)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
                    >
                        {t('basecamp.download_btn')}
                    </a>
                </div>
            )}
        </div>
    )
}

