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
 */

'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useLanguage } from '@/lib/i18n'
import { ClipboardList, Plus, Trash2, Calendar, User, MessageSquare, CheckSquare, Loader2, ChevronDown, ChevronRight, FileText, Paperclip, Bold, Italic, Strikethrough, Highlighter, Link, Quote, Code, List, ListOrdered, Table, AlignLeft, Mic, Image, Type, Undo2, Redo2, Check } from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'

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

const parseAttachments = (html: string) => {
    const attachments: any[] = []
    if (!html) return attachments

    const bcAttachmentRegex = /<bc-attachment\s+([^>]+)>([\s\S]*?)<\/bc-attachment>/gi
    let match
    while ((match = bcAttachmentRegex.exec(html)) !== null) {
        const attrsStr = match[1]
        
        const getAttr = (name: string) => {
            const m = attrsStr.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'))
            return m ? m[1] : null
        }
        
        const contentType = getAttr('content-type') || ''
        const filename = getAttr('filename') || 'attachment'
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
    
    // Step 1: Remove srcset attributes entirely — browsers prefer srcset over src,
    // which bypasses our URL rewriting. By stripping srcset, the browser falls back to src.
    let rewritten = html.replace(/\s+srcset="[^"]*"/gi, '')
    rewritten = rewritten.replace(/\s+srcset='[^']*'/gi, '')
    
    // Step 2: Rewrite Basecamp image src URLs to our proxy
    rewritten = rewritten.replace(
        /(<img[^>]+src=["'])(https:\/\/(?:preview\.app\.basecamp\.com|storage\.app\.basecamp\.com|3\.basecampapi\.com)[^"']+)((?:["'])[^\/>]*\/?>)/gi,
        (match, p1, p2, p3) => {
            return `${p1}/api/basecamp/attachment?url=${encodeURIComponent(p2)}${p3}`
        }
    )
    
    // Step 3: Rewrite Basecamp link href URLs to our proxy
    rewritten = rewritten.replace(
        /(<a[^>]+href=["'])(https:\/\/(?:preview\.app\.basecamp\.com|storage\.app\.basecamp\.com|3\.basecampapi\.com)[^"']+)((?:["'])[^\/>]*\/?>)/gi,
        (match, p1, p2, p3) => {
            return `${p1}/api/basecamp/attachment?url=${encodeURIComponent(p2)}${p3}`
        }
    )
    
    return rewritten
}

export default function ToolTodos({ project, currentUserName, selectedTodoId, onCloseDetail, navigateTo }: ToolTodosProps) {
    const supabase = getSupabaseWithAuth()
    const { t } = useLanguage()
    const [lists, setLists] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState<string | null>(null)

    // Estados para modo de visualización (cards por defecto o lista)
    const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards')
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
    // Inline Link bar states
    const [showLinkBar, setShowLinkBar] = useState(false)
    const [linkUrl, setLinkUrl] = useState('')
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
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
    const [todoFilterQuery, setTodoFilterQuery] = useState('')

    // ── Rich text editor helpers (contentEditable + execCommand) ──
    const notesEditorRef = React.useRef<HTMLDivElement>(null)
    const fileInputRef = React.useRef<HTMLInputElement>(null)
    const attachmentInputRef = React.useRef<HTMLInputElement>(null)
    // Custom undo/redo history scoped ONLY to the Notes editor
    const editorHistoryRef = React.useRef<string[]>([''])
    const editorHistoryIdxRef = React.useRef<number>(0)
    const editorIsUndoingRef = React.useRef<boolean>(false)

    const editorSaveSnapshot = () => {
        if (editorIsUndoingRef.current) return // Don't record while restoring
        const html = notesEditorRef.current?.innerHTML || ''
        const history = editorHistoryRef.current
        const idx = editorHistoryIdxRef.current
        // Only push if content actually changed
        if (history[idx] === html) return
        // Truncate any redo history beyond current index
        editorHistoryRef.current = history.slice(0, idx + 1)
        editorHistoryRef.current.push(html)
        // Keep max 100 snapshots
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
        focusEditor()
    }

    // Focus the contentEditable editor before executing any command
    const focusEditor = () => {
        const editor = notesEditorRef.current
        if (editor) editor.focus()
    }

    // Execute a formatting command on the contentEditable div
    const execCmd = (command: string, value?: string) => {
        focusEditor()
        document.execCommand(command, false, value || '')
    }

    // ── Link: inline bar (no browser prompt) ──
    const editorToggleLinkBar = () => {
        if (showLinkBar) {
            setShowLinkBar(false)
            setLinkUrl('')
            return
        }
        // Save the current selection so we can restore it when applying the link
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0) {
            savedSelectionRef.current = sel.getRangeAt(0).cloneRange()
        }
        setShowLinkBar(true)
        setLinkUrl('')
    }

    const editorApplyLink = () => {
        if (!linkUrl.trim()) return
        // Restore the saved selection
        const editor = notesEditorRef.current
        if (editor && savedSelectionRef.current) {
            editor.focus()
            const sel = window.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(savedSelectionRef.current)
        }
        document.execCommand('createLink', false, linkUrl.trim())
        setShowLinkBar(false)
        setLinkUrl('')
        savedSelectionRef.current = null
    }

    const editorUnlink = () => {
        focusEditor()
        document.execCommand('unlink')
        setShowLinkBar(false)
        setLinkUrl('')
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
        html += '</table><br>'
        return html
    }

    const editorInsertTable = () => {
        if (showTableControls) {
            // Toggle off
            setShowTableControls(false)
            return
        }
        focusEditor()
        const rows = 3
        const cols = 3
        setTableRows(rows)
        setTableCols(cols)
        document.execCommand('insertHTML', false, buildTableHtml(rows, cols))
        setShowTableControls(true)
    }

    const editorUpdateTable = (newRows: number, newCols: number) => {
        const editor = notesEditorRef.current
        if (!editor) return
        const table = editor.querySelector('table[data-editor-table]')
        if (table) {
            table.outerHTML = buildTableHtml(newRows, newCols).replace('<br>', '')
        }
        setTableRows(newRows)
        setTableCols(newCols)
    }

    const editorRemoveTable = () => {
        const editor = notesEditorRef.current
        if (!editor) return
        const table = editor.querySelector('table[data-editor-table]')
        if (table) table.remove()
        setShowTableControls(false)
        setTableRows(3)
        setTableCols(3)
    }

    const editorInsertCode = () => {
        focusEditor()
        const sel = window.getSelection()
        const selectedText = sel?.toString() || 'code'
        document.execCommand('insertHTML', false, `<pre style="background: #f4f4f4; padding: 8px 12px; border-radius: 4px; font-family: monospace; font-size: 13px; overflow-x: auto;"><code>${selectedText}</code></pre><br>`)
    }

    const editorInsertQuote = () => {
        focusEditor()
        const sel = window.getSelection()
        const selectedText = sel?.toString() || ''
        document.execCommand('insertHTML', false, `<blockquote style="border-left: 3px solid #ccc; padding-left: 12px; margin: 8px 0; color: #666; font-style: italic;">${selectedText || 'Quote'}</blockquote><br>`)
    }

    // ── Image & Attachment: file picker (no browser prompt) ──
    const editorInsertImage = () => {
        if (fileInputRef.current) fileInputRef.current.click()
    }

    const handleImageFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = (event) => {
            const dataUrl = event.target?.result as string
            focusEditor()
            document.execCommand('insertImage', false, dataUrl)
        }
        reader.readAsDataURL(file)
        e.target.value = ''
    }

    const editorInsertAttachment = () => {
        if (attachmentInputRef.current) attachmentInputRef.current.click()
    }

    const handleAttachmentFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = (event) => {
            const dataUrl = event.target?.result as string
            focusEditor()
            if (file.type.startsWith('image/')) {
                document.execCommand('insertHTML', false,
                    `<div style="margin: 8px 0;"><img src="${dataUrl}" alt="${file.name}" style="max-width: 100%; height: auto; border-radius: 4px;" /></div>`
                )
            } else {
                document.execCommand('insertHTML', false,
                    `<div style="margin: 4px 0; padding: 6px 10px; background: #F7F7F5; border: 1px solid #E8E6E1; border-radius: 6px; display: inline-flex; align-items: center; gap: 6px;"><a href="${dataUrl}" download="${file.name}" style="color: #1D7DB5; text-decoration: none; font-size: 13px; font-weight: 500;">📎 ${file.name}</a> <span style="color: #999; font-size: 11px;">(${(file.size / 1024).toFixed(1)} KB)</span></div>&nbsp;`
                )
            }
        }
        reader.readAsDataURL(file)
        e.target.value = ''
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

    const closeTaskDetail = () => {
        setSelectedTask(null)
        if (onCloseDetail) onCloseDetail()
    }

    // NOTE: Previously fetched fresh todo details from Basecamp API here.
    // Removed: Our module is 100% LOCAL — all data comes from Supabase.
    // Sync is ONE-WAY: Basecamp original → Supabase (via cron). We never call Basecamp API from UI.


    // Close lightbox on Escape key
    useEffect(() => {
        if (!lightboxUrl) return
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                setLightboxUrl(null)
            }
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [lightboxUrl])

    // Intercept clicks on HTML links to handle Basecamp-to-Basecamp routing locally
    const handleHtmlClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement
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

    // Estado para secciones colapsadas de tareas completadas (por lista)
    const [expandedCompleted, setExpandedCompleted] = useState<Record<string, boolean>>({})

    const toggleCompletedSection = (listId: string) => {
        setExpandedCompleted(prev => ({ ...prev, [listId]: !prev[listId] }))
    }

    // 1. Fetch todo lists and tasks from Supabase (optimized with parallel queries)
    // 1. Fetch todo lists and tasks from Supabase (optimized with parallel queries)
    const fetchLists = useCallback(async () => {
        if (!project.db_id) return
        setLoading(true)
        try {
            // Run parallel queries including an explicit selected todo query to bypass database pagination limits
            const [listsResult, activeTodosResult, completedTodosResult, selectedTodoResult] = await Promise.all([
                // Query 1: Todolists
                supabase
                    .from('bc_todolists')
                    .select('id, bc_id, name, description, position, completed_count, total_count')
                    .eq('project_id', project.db_id)
                    .order('position', { ascending: true }),

                // Query 2a: Active Todos with assignees (all active todos)
                supabase
                    .from('bc_todos')
                    .select(`
                        id, bc_id, todolist_id, title, is_completed, completed_at, due_date, position,
                        comments_count, created_by_person_id, description,
                        bc_todo_assignees(
                            person:bc_people(id, name, email, avatar_url)
                        )
                    `)
                    .eq('project_id', project.db_id)
                    .eq('is_completed', false)
                    .order('position', { ascending: true }),

                // Query 2b: Recent Completed Todos (limit 100 to avoid PostgREST 1000 row limits)
                supabase
                    .from('bc_todos')
                    .select(`
                        id, bc_id, todolist_id, title, is_completed, completed_at, due_date, position,
                        comments_count, created_by_person_id, description,
                        bc_todo_assignees(
                            person:bc_people(id, name, email, avatar_url)
                        )
                    `)
                    .eq('project_id', project.db_id)
                    .eq('is_completed', true)
                    .order('completed_at', { ascending: false })
                    .limit(100),

                // Query 3: Explicit selected todo to bypass pagination limit
                selectedTodoId
                    ? supabase
                        .from('bc_todos')
                        .select(`
                            id, bc_id, todolist_id, title, is_completed, completed_at, due_date, position,
                            comments_count, created_by_person_id, description,
                            bc_todo_assignees(
                                person:bc_people(id, name, email, avatar_url)
                            )
                        `)
                        .eq('id', selectedTodoId)
                        .maybeSingle()
                    : Promise.resolve({ data: null, error: null } as any)
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
                console.log("➕ [ToolTodos] Appending selected todo to dbTodos list to bypass limit:", selectedTodo.title)
                dbTodos = [...dbTodos, selectedTodo]
            }

            // Map and combine lists with todos
            const mappedLists = dbLists.map(list => {
                const listTodos = dbTodos.filter(t => t.todolist_id === list.id)
                const tasks = listTodos.map(t => {
                    const assignees = t.bc_todo_assignees?.map((a: any) => ({
                        id: a.person?.id,
                        name: a.person?.name || 'Unknown',
                        email: a.person?.email || ''
                    })) || []

                    return {
                        id: t.id,
                        bc_id: t.bc_id,
                        task_name: t.title,
                        description: t.description,
                        is_completed: t.is_completed,
                        due_date: t.due_date,
                        assignee: assignees.map((a: any) => a.name).join(', ') || null,
                        assigneeList: assignees,
                        comments_count: t.comments_count || 0,
                        created_by: null
                    }
                })

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
            console.log("📦 [ToolTodos] Lists loaded:", mappedLists.length, "Total tasks:", mappedLists.flatMap(l => l.tasks).length)

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
    }, [project.db_id, project.id, selectedTodoId])

    // Fetch comments specifically for the active selected task
    const fetchTaskComments = useCallback(async (taskId: string) => {
        if (!taskId) return
        setCommentsLoading(true)
        try {
            const { data: comments, error } = await supabase
                .from('bc_comments')
                .select('id, bc_id, parent_id, content, created_at, author:bc_people(name, email, avatar_url)')
                .eq('parent_type', 'todo')
                .eq('parent_id', taskId)
                .order('created_at', { ascending: true })

            if (error) throw error

            const formatted = (comments || []).map((c: any) => ({
                id: c.id,
                bc_id: c.bc_id,
                author: (Array.isArray(c.author) ? c.author[0]?.name : c.author?.name) || 'Unknown',
                text: c.content,
                timestamp: c.created_at
            }))

            setTaskComments(formatted)
        } catch (err: any) {
            console.error('❌ [ToolTodos Comments Fetch] Error:', err?.message || err)
        } finally {
            setCommentsLoading(false)
        }
    }, [supabase])

    // Load comments on demand whenever selectedTask changes
    useEffect(() => {
        if (selectedTask?.id) {
            fetchTaskComments(selectedTask.id)
        } else {
            setTaskComments([])
        }
    }, [selectedTask?.id, fetchTaskComments])

    useEffect(() => {
        fetchLists()
    }, [fetchLists])

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
            await fetchLists()
        } catch (err: any) {
            console.error(`❌ [ToolTodos Toggle] Error performing ${actionType}:`, err.message)
        } finally {
            setActionLoading(null)
        }
    }

    // Create Todo List
    const handleAddList = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newListName.trim()) return
        setLoading(true)
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
            await fetchLists()
        } catch (err: any) {
            console.error('❌ [ToolTodos AddList] Error creating todolist:', err.message)
            setLoading(false)
        }
    }

    // Create Task (Todo)
    const handleAddTask = async (listId: string, listBcId: number, e: React.FormEvent) => {
        e.preventDefault()
        if (!newTaskName.trim()) return
        setLoading(true)
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
                    description: notesEditorRef.current?.innerHTML || '',
                    due_date: newTaskDueDate || null,
                    assigneeUuids: newTaskAssignees.map((a: any) => a.id)
                })
            })

            if (!res.ok) throw new Error(await res.text())

            setNewTaskName('')
            setNewTaskAssignees([])
            setAssigneeSearchQuery('')
            setNewTaskNotifyees([])
            setNotifySearchQuery('')
            setNewTaskDueDate('')
            setNewTaskNotes('')
            setAddingTaskId(null)
            await fetchLists()
        } catch (err: any) {
            console.error('❌ [ToolTodos AddTask] Error creating todo:', err.message)
            setLoading(false)
        }
    }

    // Delete Task
    const handleDeleteTask = async (listId: string, task: any, e: React.MouseEvent) => {
        e.stopPropagation()
        if (!confirm('¿Eliminar esta tarea de forma permanente?')) return
        setLoading(true)
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
            await fetchLists()
        } catch (err: any) {
            console.error('❌ [ToolTodos Delete] Error deleting todo:', err.message)
            setLoading(false)
        }
    }

    // Add Comment to Todo
    const handleAddComment = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newComment.trim() || !selectedTask) return
        setActionLoading('comment')
        const commentContent = newComment.trim()
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
            await fetchTaskComments(selectedTask.id)
            fetchLists()
        } catch (err: any) {
            console.error('❌ [ToolTodos Comment] Error saving comment:', err.message)
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

    // Filter suggestions based on what the user types
    const filteredSuggestions = (() => {
        const q = assigneeSearchQuery.toLowerCase().trim()
        const available = (project.people || []).filter((p: any) => {
            const isAlreadySelected = newTaskAssignees.some((a) => a.id === p.id)
            return !isAlreadySelected && p.name.toLowerCase().includes(q)
        })
        // Sort: names that START with the query come first, then alphabetical within each group
        if (!q) return available
        const startsWithQ = available.filter((p: any) => p.name.toLowerCase().startsWith(q))
        const containsQ = available.filter((p: any) => !p.name.toLowerCase().startsWith(q))
        return [...startsWithQ, ...containsQ]
    })()

    // Filter suggestions for "When done" notify people — same logic as assignees
    const filteredNotifySuggestions = (() => {
        const q = notifySearchQuery.toLowerCase().trim()
        const available = (project.people || []).filter((p: any) => {
            const isAlreadySelected = newTaskNotifyees.some((a) => a.id === p.id)
            return !isAlreadySelected && p.name.toLowerCase().includes(q)
        })
        if (!q) return available
        const startsWithQ = available.filter((p: any) => p.name.toLowerCase().startsWith(q))
        const containsQ = available.filter((p: any) => !p.name.toLowerCase().startsWith(q))
        return [...startsWithQ, ...containsQ]
    })()

    // Full List Renderer (Used for both List View and Single List drill-down view)
    const renderFullList = (list: any, listIdx: number, showBackBtn: boolean = false) => {
        const openTasks = list.tasks.filter((tk: any) => !tk.is_completed)
        const completedTasks = list.tasks.filter((tk: any) => tk.is_completed)
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
                        <div style={{ marginBottom: 14 }}>
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
                                ← {t('basecamp.todos') || 'To-dos'}
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
                            {t('basecamp.no_todos_in_list') || 'No to-dos in this list yet.'}
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
                                    title={t('basecamp.mark_as_done') || 'Mark as done'}
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
                                    {/* Primary row: Title + Due Date + Comments count */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <span style={{
                                            fontSize: 14.5,
                                            fontWeight: 500,
                                            color: '#1E293B',
                                            lineHeight: 1.35
                                        }}>
                                            {task.task_name}
                                        </span>

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
                                                {task.due_date}
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
                                    title={t('basecamp.delete_todo') || 'Delete to-do'}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        )
                    })}
                </div>

                {/* ── Inline Add To-do Form or Trigger Button ── */}
                <div style={{ padding: '12px 24px 18px', borderTop: '1px solid #F0EFEB' }}>
                    {addingTaskId === list.id ? (
                        <form onSubmit={(e) => handleAddTask(list.id, list.bc_id, e)} style={{ background: '#F8FAFC', padding: 16, borderRadius: 8, border: '1px solid #E2E8F0' }}>
                            <div style={{ marginBottom: 12 }}>
                                <input
                                    type="text"
                                    required
                                    autoFocus
                                    value={newTaskName}
                                    onChange={(e) => setNewTaskName(e.target.value)}
                                    placeholder={t('basecamp.describe_todo') || 'Describe this to-do...'}
                                    style={{
                                        width: '100%',
                                        padding: '10px 12px',
                                        borderRadius: 6,
                                        border: '1.5px solid #CBD5E1',
                                        fontSize: 14.5,
                                        outline: 'none',
                                        color: '#1E293B',
                                        background: '#fff'
                                    }}
                                />
                            </div>

                            {/* Assignees and Notify Bar */}
                            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                                {/* Assignees */}
                                <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
                                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748B', marginBottom: 4 }}>
                                        {t('basecamp.assigned_to') || 'Assigned to'}
                                    </label>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        padding: '6px 10px',
                                        borderRadius: 6,
                                        border: '1px solid #CBD5E1',
                                        background: '#fff',
                                        flexWrap: 'wrap'
                                    }}>
                                        {newTaskAssignees.map(a => (
                                            <span key={a.id} style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 4,
                                                padding: '2px 8px',
                                                borderRadius: 12,
                                                background: '#E0F2FE',
                                                color: '#0369A1',
                                                fontSize: 12,
                                                fontWeight: 600
                                            }}>
                                                {a.name}
                                                <button
                                                    type="button"
                                                    onClick={() => setNewTaskAssignees(prev => prev.filter(p => p.id !== a.id))}
                                                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, color: '#0369A1', fontWeight: 800 }}
                                                >
                                                    ✕
                                                </button>
                                            </span>
                                        ))}
                                        <input
                                            type="text"
                                            value={assigneeSearchQuery}
                                            onChange={e => {
                                                setAssigneeSearchQuery(e.target.value)
                                                setShowAssigneeSuggestions(true)
                                            }}
                                            onFocus={() => setShowAssigneeSuggestions(true)}
                                            placeholder={newTaskAssignees.length === 0 ? (t('basecamp.type_name') || 'Type a name...') : ''}
                                            style={{ border: 'none', outline: 'none', fontSize: 13, flex: 1, minWidth: 80, background: 'transparent' }}
                                        />
                                    </div>

                                    {showAssigneeSuggestions && filteredSuggestions.length > 0 && (
                                        <div style={{
                                            position: 'absolute',
                                            top: '100%',
                                            left: 0,
                                            right: 0,
                                            marginTop: 4,
                                            background: '#fff',
                                            borderRadius: 8,
                                            border: '1px solid #CBD5E1',
                                            boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
                                            zIndex: 40,
                                            maxHeight: 180,
                                            overflowY: 'auto'
                                        }}>
                                            {filteredSuggestions.map((p: any) => (
                                                <div
                                                    key={p.id}
                                                    onClick={() => {
                                                        setNewTaskAssignees(prev => [...prev, p])
                                                        setAssigneeSearchQuery('')
                                                        setShowAssigneeSuggestions(false)
                                                    }}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 8,
                                                        padding: '8px 12px',
                                                        cursor: 'pointer',
                                                        fontSize: 13,
                                                        color: '#1E293B',
                                                        borderBottom: '1px solid #F1F5F9'
                                                    }}
                                                    onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                                                    onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                                                >
                                                    <span style={{
                                                        width: 20,
                                                        height: 20,
                                                        borderRadius: '50%',
                                                        background: getAvatarColor(p.name || 'U'),
                                                        color: '#fff',
                                                        fontSize: 9,
                                                        fontWeight: 800,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center'
                                                    }}>
                                                        {getInitials(p.name || 'U')}
                                                    </span>
                                                    {p.name}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Due Date */}
                                <div style={{ width: 160 }}>
                                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748B', marginBottom: 4 }}>
                                        {t('basecamp.due_on') || 'Due on'}
                                    </label>
                                    <input
                                        type="date"
                                        value={newTaskDueDate}
                                        onChange={e => setNewTaskDueDate(e.target.value)}
                                        style={{
                                            width: '100%',
                                            padding: '6px 10px',
                                            borderRadius: 6,
                                            border: '1px solid #CBD5E1',
                                            fontSize: 13,
                                            outline: 'none',
                                            background: '#fff',
                                            color: '#1E293B'
                                        }}
                                    />
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    style={{
                                        padding: '8px 18px',
                                        borderRadius: 6,
                                        border: 'none',
                                        background: '#22C55E',
                                        color: '#fff',
                                        fontSize: 13.5,
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        transition: 'background 0.15s'
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#16A34A')}
                                    onMouseLeave={e => (e.currentTarget.style.background = '#22C55E')}
                                >
                                    {t('basecamp.add_todo') || 'Add this to-do'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setAddingTaskId(null)
                                        setNewTaskName('')
                                        setNewTaskAssignees([])
                                        setNewTaskDueDate('')
                                    }}
                                    style={{
                                        padding: '8px 14px',
                                        borderRadius: 6,
                                        border: '1px solid #CBD5E1',
                                        background: '#fff',
                                        color: '#64748B',
                                        fontSize: 13.5,
                                        fontWeight: 600,
                                        cursor: 'pointer'
                                    }}
                                >
                                    {t('basecamp.cancel') || 'Cancel'}
                                </button>
                            </div>
                        </form>
                    ) : (
                        <button
                            onClick={() => {
                                setAddingTaskId(list.id)
                                setNewTaskName('')
                                setNewTaskAssignees([])
                                setNewTaskDueDate('')
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
                            {t('basecamp.add_todo') || 'Add a to-do'}
                        </button>
                    )}
                </div>

                {/* ── Completed Tasks Accordion ── */}
                {completedTasks.length > 0 && (
                    <div style={{ borderTop: '1px solid #F0EFEB', background: '#FAFAF8' }}>
                        <button
                            onClick={() => toggleCompletedSection(list.id)}
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
                                {completedTasks.length} {t('basecamp.completed_todos') || 'completed to-dos'}
                            </span>
                        </button>

                        {isExpanded && (
                            <div style={{ padding: '4px 0 12px' }}>
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
                                            title={t('basecamp.mark_incomplete') || 'Mark incomplete'}
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
        if (!todoFilterQuery.trim()) return lists
        const q = todoFilterQuery.toLowerCase().trim()
        return lists.map(list => {
            const listMatches = list.list_name.toLowerCase().includes(q) || (list.description && list.description.toLowerCase().includes(q))
            const matchingTasks = list.tasks.filter((tk: any) => tk.task_name.toLowerCase().includes(q))
            if (listMatches) return list
            if (matchingTasks.length > 0) {
                return { ...list, tasks: matchingTasks }
            }
            return null
        }).filter(Boolean) as any[]
    }, [lists, todoFilterQuery])

    return (
        <div style={{ maxWidth: 1280, width: '100%', margin: '0 auto', padding: '0 12px' }}>
            {/* ── Drill-down Single List View ── */}
            {selectedListId ? (
                (() => {
                    const activeList = lists.find(l => l.id === selectedListId)
                    const activeListIdx = lists.findIndex(l => l.id === selectedListId)
                    if (!activeList) {
                        return (
                            <div style={{ padding: '36px 0', textAlign: 'center' }}>
                                <p style={{ color: '#64748B', fontSize: 15, marginBottom: 16 }}>
                                    {t('basecamp.list_not_found') || 'This list could not be found.'}
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
                                    ← {t('basecamp.back_to_todos') || 'Back to all to-dos'}
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
                            {t('basecamp.todos') || 'To-dos'}
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
                                {t('basecamp.add_list') || 'New list'}
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
                                    <span>{t('basecamp.view_as') || 'View as'}</span>
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
                                            {t('basecamp.view_todos_prompt') || 'View to-dos...'}
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
                                            <span>{t('basecamp.view_in_list') || 'In a list'}</span>
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
                                            <span>{t('basecamp.view_as_cards') || 'As cards'}</span>
                                            {viewMode === 'cards' && <Check size={16} style={{ color: '#38BDF8' }} />}
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                                <input
                                    type="text"
                                    value={todoFilterQuery}
                                    onChange={(e) => setTodoFilterQuery(e.target.value)}
                                    placeholder={t('basecamp.filter_placeholder') || 'Filter to-dos...'}
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
                                        title="Clear filter"
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
                                    {t('basecamp.no_matching_todos') || 'No to-dos match your filter'}
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
                                    {t('common.clear') || 'Clear filter'}
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
                                                        {t('basecamp.no_open_todos') || 'No open to-dos'}
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
                                                            +{remainingCount} {t('basecamp.more_todos') || 'more to-dos'}
                                                        </span>
                                                    )}
                                                </div>

                                                {completedTasks.length > 0 && (
                                                    <span style={{ color: '#16A34A', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        <Check size={12} />
                                                        {completedTasks.length} {t('basecamp.done_short') || 'done'}
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
                                {t('basecamp.no_todolists') || 'No to-do lists yet'}
                            </h3>
                            <p style={{ fontSize: 14, color: '#64748B', maxWidth: 400, margin: '0 auto 20px' }}>
                                {t('basecamp.no_todolists_desc') || 'Create your first to-do list to organize team tasks, prep items, and follow-ups.'}
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
                                {t('basecamp.add_first_list') || 'Create a list'}
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
                                {t('basecamp.new_list_title') || 'Add a new to-do list'}
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
                                    {t('basecamp.list_name_label') || 'Name this list'}
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={newListName}
                                    onChange={(e) => setNewListName(e.target.value)}
                                    placeholder={t('basecamp.new_list_placeholder') || 'e.g., Opening Checklist, Food Safety...'}
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
                                    {t('basecamp.list_desc_label') || 'Add extra details or notes (optional)'}
                                </label>
                                <textarea
                                    value={newListDesc}
                                    onChange={(e) => setNewListDesc(e.target.value)}
                                    placeholder={t('basecamp.list_desc_placeholder') || 'Describe what belongs in this list...'}
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
                                    {t('basecamp.cancel') || 'Cancel'}
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
                                    {t('basecamp.create_list') || 'Create this list'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ══════════════════════════════════════════════════════════════════
                Modal — Task Detail (Full-page overlay — Basecamp 3/4 style)
                Breadcrumb, large title, avatar pills, description, comments
               ══════════════════════════════════════════════════════════════════ */}
            {selectedTask && (() => {
                const parentList = lists.find(l => l.id === selectedTaskListId)
                const listName = parentList?.list_name || 'To-dos'

                return (
                    <div
                        onClick={(e) => { if (e.target === e.currentTarget) closeTaskDetail() }}
                        style={{
                            position: 'fixed', inset: 0, zIndex: 50,
                            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                            padding: '20px 12px', background: 'rgba(0,0,0,0.4)',
                            overflowY: 'auto'
                        }}
                    >
                        <div style={{
                            background: '#fff', borderRadius: 10, maxWidth: 720, width: '100%',
                            boxShadow: '0 16px 48px rgba(0,0,0,0.18)',
                            marginBottom: 40
                        }}>
                            {/* ── Breadcrumb bar ── */}
                            <div style={{
                                padding: '14px 28px', borderBottom: '1px solid #E8E6E1',
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                background: '#FAFAF8', borderRadius: '10px 10px 0 0'
                            }}>
                                <button
                                    onClick={() => closeTaskDetail()}
                                    style={{
                                        border: 'none', background: 'transparent',
                                        color: '#1D7DB5', cursor: 'pointer', fontSize: 13,
                                        fontWeight: 500, padding: 0
                                    }}
                                >
                                    ← {listName}
                                </button>
                                <button
                                    onClick={() => closeTaskDetail()}
                                    style={{
                                        width: 28, height: 28, borderRadius: '50%',
                                        border: '1px solid #D5D3CE', background: '#fff',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        cursor: 'pointer', color: '#6B7B8D', fontSize: 14,
                                        transition: 'background 0.15s'
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#F0EFEB')}
                                    onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                                >
                                    ✕
                                </button>
                            </div>

                            {/* ── Title section — matches Basecamp original layout ── */}
                            <div style={{ padding: '28px 28px 0' }}>
                                {/* Large title */}
                                <h2 style={{
                                    fontSize: 28, fontWeight: 800, color: '#1D2D35',
                                    margin: '0 0 14px', lineHeight: 1.3
                                }}>
                                    {selectedTask.task_name}
                                </h2>

                                {/* Mark as complete + Added by */}
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 12,
                                    marginBottom: 20, flexWrap: 'wrap'
                                }}>
                                    <button
                                        onClick={() => handleToggleTask(selectedTaskListId || '', selectedTask)}
                                        style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 6,
                                            padding: '6px 14px', borderRadius: 4,
                                            border: '1px solid #D5D3CE', background: '#fff',
                                            fontSize: 13, fontWeight: 600, color: '#1D2D35',
                                            cursor: 'pointer', transition: 'background 0.15s'
                                        }}
                                        onMouseEnter={e => (e.currentTarget.style.background = '#F0EFEB')}
                                        onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                                    >
                                        {selectedTask.is_completed ? (
                                            <><CheckSquare size={14} style={{ color: '#4BAE4F' }} /> {t('basecamp.completed_label')}</>
                                        ) : (
                                            <><span style={{
                                                width: 14, height: 14, border: '2px solid #A0A0A0',
                                                borderRadius: 2, display: 'inline-block'
                                            }} /> {t('basecamp.mark_complete')}</>
                                        )}
                                    </button>
                                    {selectedTask.creator_name && (
                                        <span style={{ fontSize: 13, color: '#6B7B8D' }}>
                                            {t('basecamp.added_by')}{' '}
                                            <span style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                                verticalAlign: 'middle'
                                            }}>
                                                <span style={{
                                                    width: 20, height: 20, borderRadius: '50%',
                                                    background: getAvatarColor(selectedTask.creator_name),
                                                    color: '#fff', fontSize: 9, fontWeight: 700,
                                                    display: 'inline-flex', alignItems: 'center',
                                                    justifyContent: 'center'
                                                }}>
                                                    {getInitials(selectedTask.creator_name)}
                                                </span>
                                                <strong style={{ color: '#1D2D35' }}>{selectedTask.creator_name}</strong>
                                            </span>
                                            {selectedTask.created_at && (
                                                <> {t('basecamp.on_date')} {new Date(selectedTask.created_at).toLocaleDateString(undefined, {
                                                    month: 'short', day: 'numeric'
                                                })}</>
                                            )}
                                        </span>
                                    )}
                                </div>

                                {/* ── Structured fields like real Basecamp ── */}
                                <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr] gap-x-4 gap-y-2 sm:gap-y-3 items-start sm:items-center" style={{
                                    paddingBottom: 20, borderBottom: '1px solid #E8E6E1'
                                }}>
                                    {/* Assigned to */}
                                    <span className="justify-self-start sm:justify-self-end text-left sm:text-right" style={{
                                        fontSize: 13, fontWeight: 700, color: '#1D2D35',
                                        whiteSpace: 'nowrap'
                                    }}>
                                        {t('basecamp.assign_to')}
                                    </span>
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                        {selectedTask.assigneeList && selectedTask.assigneeList.length > 0 ? (
                                            selectedTask.assigneeList.map((a: any) => (
                                                <span key={a.id} style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: 5,
                                                    fontSize: 14, color: '#1D2D35', fontWeight: 500
                                                }}>
                                                    <span style={{
                                                        width: 22, height: 22, borderRadius: '50%',
                                                        background: getAvatarColor(a.name),
                                                        color: '#fff', fontSize: 10, fontWeight: 700,
                                                        display: 'inline-flex', alignItems: 'center',
                                                        justifyContent: 'center', flexShrink: 0
                                                    }}>
                                                        {getInitials(a.name)}
                                                    </span>
                                                    {a.name}
                                                    {selectedTask.assigneeList.indexOf(a) < selectedTask.assigneeList.length - 1 && ','}
                                                </span>
                                            ))
                                        ) : (
                                            <span style={{ fontSize: 14, color: '#A0A0A0', fontStyle: 'italic' }}>
                                                {t('basecamp.no_assigned')}
                                            </span>
                                        )}
                                    </div>

                                    {/* When done */}
                                    <span className="justify-self-start sm:justify-self-end text-left sm:text-right" style={{
                                        fontSize: 13, fontWeight: 700, color: '#1D2D35',
                                        whiteSpace: 'nowrap'
                                    }}>
                                        {t('basecamp.when_done')}
                                    </span>
                                    <span style={{ fontSize: 14, color: '#A0A0A0', fontStyle: 'italic' }}>
                                        {t('basecamp.notify_people')}
                                    </span>

                                    {/* Due on */}
                                    <span className="justify-self-start sm:justify-self-end text-left sm:text-right" style={{
                                        fontSize: 13, fontWeight: 700, color: '#1D2D35',
                                        whiteSpace: 'nowrap'
                                    }}>
                                        {t('basecamp.due_on')}
                                    </span>
                                    <span style={{
                                        fontSize: 14,
                                        color: selectedTask.due_date ? '#1D2D35' : '#A0A0A0',
                                        fontStyle: selectedTask.due_date ? 'normal' : 'italic',
                                        fontWeight: selectedTask.due_date ? 500 : 400
                                    }}>
                                        {selectedTask.due_date
                                            ? new Date(selectedTask.due_date).toLocaleDateString(undefined, {
                                                weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
                                            })
                                            : t('basecamp.select_due_date')
                                        }
                                    </span>

                                    {/* Notes label */}
                                    <span className="justify-self-start sm:justify-self-end text-left sm:text-right" style={{
                                        fontSize: 13, fontWeight: 700, color: '#1D2D35',
                                        whiteSpace: 'nowrap',
                                        alignSelf: 'flex-start', paddingTop: 2
                                    }}>
                                        {t('basecamp.notes_label')}
                                    </span>
                                    <span style={{ fontSize: 14, color: '#A0A0A0', fontStyle: 'italic' }}>
                                        {selectedTask.description ? '' : t('basecamp.add_details')}
                                    </span>
                                </div>
                            </div>


                            {/* ── Description / Notes ── */}
                            {selectedTask.description && (() => {
                                const desc = selectedTask.description as string

                                // Extract attachments for non-image files (PDFs, videos, etc.)
                                const allAttachments = parseAttachments(desc)
                                const nonImageAttachments = allAttachments.filter(a => {
                                    const ct = (a.contentType || '').toLowerCase()
                                    const fn = (a.filename || '').toLowerCase()
                                    return !ct.startsWith('image/') && !fn.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)
                                })

                                // Keep images IN the HTML for inline display (like real Basecamp)
                                // Only strip <bc-attachment> wrapper tags but preserve the inner <img> tags
                                let richHtml = desc
                                    .replace(/<bc-attachment[^>]*>([\s\S]*?)<\/bc-attachment>/gi, (match, inner) => {
                                        // If the bc-attachment contains an image, keep the image visible
                                        if (/<img[^>]+>/i.test(inner)) {
                                            return inner
                                        }
                                        // For non-image attachments (files), remove from flow (they show as cards below)
                                        return ''
                                    })
                                    .trim()

                                // Rewrite Basecamp URLs to our proxy
                                richHtml = rewriteHtmlUrls(richHtml)

                                if (!richHtml && nonImageAttachments.length === 0) return null

                                return (
                                    <div style={{ padding: '20px 28px', borderBottom: '1px solid #E8E6E1' }}>
                                        <style dangerouslySetInnerHTML={{ __html: `
                                            .bc-rich-text a {
                                                color: #1D7DB5;
                                                text-decoration: none;
                                                font-weight: 500;
                                            }
                                            .bc-rich-text a:hover {
                                                text-decoration: underline;
                                            }
                                            .bc-rich-text p {
                                                margin: 0 0 12px 0;
                                                line-height: 1.6;
                                            }
                                            .bc-rich-text p:last-child {
                                                margin-bottom: 0;
                                            }
                                            .bc-rich-text ul {
                                                margin: 0 0 12px 0;
                                                padding-left: 20px;
                                                list-style-type: disc;
                                            }
                                            .bc-rich-text ol {
                                                margin: 0 0 12px 0;
                                                padding-left: 20px;
                                                list-style-type: decimal;
                                            }
                                            .bc-rich-text blockquote {
                                                border-left: 3px solid #E8E6E1;
                                                padding-left: 12px;
                                                margin: 0 0 12px 0;
                                                color: #6B7B8D;
                                            }
                                            .bc-rich-text img {
                                                max-width: 100%;
                                                height: auto;
                                                border-radius: 6px;
                                                margin: 8px 0;
                                                cursor: pointer;
                                                transition: opacity 0.15s;
                                                display: block;
                                            }
                                            .bc-rich-text img:hover {
                                                opacity: 0.9;
                                            }
                                            .bc-rich-text figure {
                                                margin: 12px 0;
                                            }
                                            .bc-rich-text figcaption {
                                                font-size: 12px;
                                                color: #6B7B8D;
                                                text-align: center;
                                                margin-top: 4px;
                                            }
                                        ` }} />

                                        {/* Rich text with images displayed INLINE and LARGE, like real Basecamp */}
                                        {richHtml && (
                                            <div
                                                className="bc-rich-text"
                                                onClick={(e) => {
                                                    // Handle image clicks: open lightbox instead of navigating
                                                    const target = e.target as HTMLElement
                                                    if (target.tagName === 'IMG') {
                                                        e.preventDefault()
                                                        e.stopPropagation()
                                                        const imgSrc = (target as HTMLImageElement).src
                                                        setLightboxUrl(imgSrc)
                                                        return
                                                    }
                                                    // Handle link clicks normally
                                                    handleHtmlClick(e as any)
                                                }}
                                                style={{
                                                    fontSize: 15,
                                                    color: '#1D2D35',
                                                    lineHeight: 1.6,
                                                    wordBreak: 'break-word'
                                                }}
                                                dangerouslySetInnerHTML={{ __html: richHtml }}
                                            />
                                        )}

                                        {/* Non-image attachments (PDFs, videos, etc.) as download cards */}
                                        {nonImageAttachments.length > 0 && (
                                            <div style={{ marginTop: 16 }}>
                                                <div style={{
                                                    fontSize: 12, fontWeight: 700, color: '#6B7B8D',
                                                    textTransform: 'uppercase', letterSpacing: '0.5px',
                                                    marginBottom: 8
                                                }}>
                                                    📎 {nonImageAttachments.length} {nonImageAttachments.length === 1 ? t('basecamp.file_count') : t('basecamp.files_count')}
                                                </div>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                                                    {nonImageAttachments.map((file, i) => (
                                                        <a
                                                            key={i}
                                                            href={file.url.startsWith('http') ? `/api/basecamp/attachment?url=${encodeURIComponent(file.url)}` : file.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{
                                                                display: 'inline-flex', alignItems: 'center', gap: 8,
                                                                padding: '8px 14px',
                                                                background: '#FAFAF8', border: '1px solid #E8E6E1',
                                                                borderRadius: 6, textDecoration: 'none',
                                                                fontSize: 13, fontWeight: 500, color: '#1D7DB5',
                                                                transition: 'background 0.15s'
                                                            }}
                                                        >
                                                            <FileText size={14} style={{ color: '#6B7B8D', flexShrink: 0 }} />
                                                            <span style={{
                                                                maxWidth: 200, overflow: 'hidden',
                                                                textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                                                            }}>
                                                                {decodeURIComponent(file.filename)}
                                                            </span>
                                                        </a>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )
                            })()}

                            {/* ── Comment Thread ── */}
                            <div style={{ padding: '20px 28px 24px' }}>
                                <h4 style={{
                                    fontSize: 12, fontWeight: 700, color: '#6B7B8D',
                                    textTransform: 'uppercase', letterSpacing: '0.5px',
                                    margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8
                                }}>
                                    <MessageSquare size={14} />
                                    {t('basecamp.comments_title')} ({taskComments.length})
                                </h4>

                                {commentsLoading ? (
                                    <div style={{ textAlign: 'center', padding: '24px 0', color: '#1D7DB5' }}>
                                        <Loader2 className="animate-spin" style={{ width: 24, height: 24, margin: '0 auto' }} />
                                    </div>
                                ) : taskComments && taskComments.length > 0 ? (
                                    <div style={{
                                        display: 'flex', flexDirection: 'column',
                                        maxHeight: 400, overflow: 'auto', marginBottom: 20
                                    }}>
                                        {taskComments.map((c: any, idx: number) => (
                                            <div key={c.id || idx} style={{
                                                display: 'flex', gap: 12, padding: '14px 0',
                                                borderBottom: idx < taskComments.length - 1
                                                    ? '1px solid #F0EFEB' : 'none'
                                            }}>
                                                {/* Comment avatar */}
                                                <div style={{
                                                    width: 34, height: 34, borderRadius: '50%',
                                                    background: getAvatarColor(c.author),
                                                    color: '#fff', fontSize: 12, fontWeight: 700,
                                                    display: 'flex', alignItems: 'center',
                                                    justifyContent: 'center', flexShrink: 0
                                                }}>
                                                    {getInitials(c.author)}
                                                </div>
                                                {/* Comment content */}
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{
                                                        display: 'flex', alignItems: 'baseline', gap: 8,
                                                        marginBottom: 4
                                                    }}>
                                                        <span style={{
                                                            fontSize: 14, fontWeight: 700, color: '#1D2D35'
                                                        }}>
                                                            {c.author}
                                                        </span>
                                                        <span style={{ fontSize: 12, color: '#A0A0A0' }}>
                                                            {new Date(c.timestamp).toLocaleDateString(undefined, {
                                                                month: 'short', day: 'numeric'
                                                            })}
                                                            {' '}
                                                            {new Date(c.timestamp).toLocaleTimeString([], {
                                                                hour: '2-digit', minute: '2-digit'
                                                            })}
                                                        </span>
                                                    </div>
                                                     <div
                                                         className="bc-rich-text"
                                                         onClick={handleHtmlClick}
                                                         style={{
                                                             fontSize: 14,
                                                             color: '#1D2D35',
                                                             lineHeight: 1.55,
                                                             whiteSpace: 'pre-wrap',
                                                             wordBreak: 'break-word'
                                                         }}
                                                         dangerouslySetInnerHTML={{ __html: rewriteHtmlUrls(c.text) }}
                                                     />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{
                                        textAlign: 'center', padding: '28px 0', marginBottom: 20,
                                        background: '#FAFAF8', borderRadius: 6
                                    }}>
                                        <MessageSquare size={24} style={{ color: '#D5D3CE', margin: '0 auto 8px' }} />
                                        <p style={{ fontSize: 14, color: '#A0A0A0', margin: 0 }}>
                                            {t('basecamp.no_comments_desc')}
                                        </p>
                                    </div>
                                )}

                                {/* ── Comment form with current user avatar ── */}
                                <form onSubmit={handleAddComment} style={{
                                    display: 'flex', gap: 12, alignItems: 'flex-start'
                                }}>
                                    <div style={{
                                        width: 34, height: 34, borderRadius: '50%',
                                        background: getAvatarColor(currentUserName || 'U'),
                                        color: '#fff', fontSize: 12, fontWeight: 700,
                                        display: 'flex', alignItems: 'center',
                                        justifyContent: 'center', flexShrink: 0
                                    }}>
                                        {getInitials(currentUserName || 'User')}
                                    </div>
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <textarea
                                            required
                                            value={newComment}
                                            onChange={(e) => setNewComment(e.target.value)}
                                            placeholder={t('basecamp.add_comment_placeholder')}
                                            rows={2}
                                            style={{
                                                width: '100%', padding: '10px 14px',
                                                border: '2px solid #E8E6E1', borderRadius: 6,
                                                fontSize: 14, color: '#1D2D35', outline: 'none',
                                                resize: 'vertical', fontFamily: 'inherit',
                                                transition: 'border-color 0.15s', lineHeight: 1.5
                                            }}
                                            onFocus={e => (e.target.style.borderColor = '#1D7DB5')}
                                            onBlur={e => (e.target.style.borderColor = '#E8E6E1')}
                                        />
                                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                            <button
                                                type="submit"
                                                disabled={actionLoading === 'comment'}
                                                style={{
                                                    padding: '8px 20px', borderRadius: 5, border: 'none',
                                                    background: '#4BAE4F', fontSize: 13, fontWeight: 700,
                                                    color: '#fff', cursor: 'pointer',
                                                    transition: 'background 0.15s',
                                                    opacity: actionLoading === 'comment' ? 0.7 : 1,
                                                    display: 'flex', alignItems: 'center', gap: 6
                                                }}
                                                onMouseEnter={e => (e.currentTarget.style.background = '#3D9440')}
                                                onMouseLeave={e => (e.currentTarget.style.background = '#4BAE4F')}
                                            >
                                                {actionLoading === 'comment' ? (
                                                    <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
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
                        alt="Fullscreen view"
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

