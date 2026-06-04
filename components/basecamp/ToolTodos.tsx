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

import React, { useState, useEffect, useCallback } from 'react'
import { useLanguage } from '@/lib/i18n'
import { ClipboardList, Plus, Trash2, Calendar, User, MessageSquare, CheckSquare, Loader2, ChevronDown, ChevronRight, FileText } from 'lucide-react'
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

    // Estados para crear lista
    const [showAddList, setShowAddList] = useState(false)
    const [newListName, setNewListName] = useState('')
    const [newListDesc, setNewListDesc] = useState('')

    // Estados para crear tarea
    const [addingTaskId, setAddingTaskId] = useState<string | null>(null)
    const [newTaskName, setNewTaskName] = useState('')
    const [newTaskAssignee, setNewTaskAssignee] = useState('')
    const [newTaskDueDate, setNewTaskDueDate] = useState('')
    const [newTaskNotes, setNewTaskNotes] = useState('')

    // Estados de detalle de tarea
    const [selectedTask, setSelectedTask] = useState<any | null>(null)
    const [selectedTaskListId, setSelectedTaskListId] = useState<string | null>(null)
    const [newComment, setNewComment] = useState('')
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

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
    const fetchLists = useCallback(async () => {
        if (!project.db_id) return
        setLoading(true)
        try {
            // Run all three queries in PARALLEL for speed
            const [listsResult, todosResult, commentsResult] = await Promise.all([
                // Query 1: Todolists
                supabase
                    .from('bc_todolists')
                    .select('id, bc_id, name, description, position')
                    .eq('project_id', project.db_id)
                    .order('position', { ascending: true }),

                // Query 2: Todos with assignees (select only needed columns, skip heavy description)
                supabase
                    .from('bc_todos')
                    .select(`
                        id, bc_id, todolist_id, title, is_completed, completed_at, due_date, position,
                        created_by_person_id, description,
                        bc_todo_assignees(
                            person:bc_people(id, name, email, avatar_url)
                        )
                    `)
                    .eq('project_id', project.db_id)
                    .order('position', { ascending: true }),

                // Query 3: Comments (by project_id to avoid URL length limit)
                supabase
                    .from('bc_comments')
                    .select('id, bc_id, parent_id, content, created_at, author:bc_people(name)')
                    .eq('project_id', project.db_id)
                    .eq('parent_type', 'todo')
                    .order('created_at', { ascending: true })
            ])

            if (listsResult.error) throw listsResult.error
            if (todosResult.error) throw todosResult.error
            if (commentsResult.error) throw commentsResult.error

            const dbLists = listsResult.data || []
            const dbTodos = todosResult.data || []
            const dbComments = commentsResult.data || []

            // Map and combine lists with todos and comments
            const mappedLists = dbLists.map(list => {
                const listTodos = dbTodos.filter(t => t.todolist_id === list.id)
                const tasks = listTodos.map(t => {
                    const taskComments = dbComments
                        .filter(c => c.parent_id === t.id)
                        .map(c => ({
                            id: c.id,
                            bc_id: c.bc_id,
                            author: (Array.isArray(c.author) ? (c.author as any)[0]?.name : (c.author as any)?.name) || 'Unknown',
                            text: c.content,
                            timestamp: c.created_at
                        }))

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
                        comments: taskComments,
                        created_by: null
                    }
                })

                return {
                    id: list.id,
                    bc_id: list.bc_id,
                    list_name: list.name,
                    description: list.description,
                    tasks
                }
            })

            setLists(mappedLists)
            console.log("📦 [ToolTodos] Lists loaded:", mappedLists.length, "Total tasks:", mappedLists.flatMap(l => l.tasks).length)

            // Update active selected task details if modal is open
            if (selectedTask) {
                const foundTask = mappedLists
                    .flatMap(l => l.tasks)
                    .find(t => t.id === selectedTask.id)
                if (foundTask) {
                    setSelectedTask(foundTask)
                }
            }
        } catch (err: any) {
            console.error('❌ [ToolTodos Fetch] Error loading todo lists:', err)
        } finally {
            setLoading(false)
        }
    }, [project.db_id, project.id])

    useEffect(() => {
        fetchLists()
    }, [fetchLists])

    useEffect(() => {
        console.log("🔍 [ToolTodos] selectedTodoId useEffect fired:", {
            selectedTodoId,
            listsCount: lists.length,
            currentSelectedTaskId: selectedTask?.id
        })
        if (selectedTodoId && lists.length > 0) {
            if (selectedTask?.id !== selectedTodoId) {
                let found = false
                for (const list of lists) {
                    const task = list.tasks.find((t: any) => t.id === selectedTodoId)
                    if (task) {
                        console.log("🎯 [ToolTodos] Found task matching selectedTodoId:", task.task_name)
                        setSelectedTask(task)
                        setSelectedTaskListId(list.id)
                        found = true
                        break
                    }
                }
                if (!found) {
                    console.warn("⚠️ [ToolTodos] Task not found in lists for selectedTodoId:", selectedTodoId)
                }
                if (!found && selectedTask) {
                    setSelectedTask(null)
                }
            }
        } else if (!selectedTodoId && selectedTask) {
            console.log("🧹 [ToolTodos] Clearing selected task because selectedTodoId is empty")
            setSelectedTask(null)
        }
    }, [selectedTodoId, lists, selectedTask])

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
                    description: '',
                    due_date: newTaskDueDate || null,
                    assigneeUuids: newTaskAssignee ? [newTaskAssignee] : []
                })
            })

            if (!res.ok) throw new Error(await res.text())

            setNewTaskName('')
            setNewTaskAssignee('')
            setNewTaskDueDate('')
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
                    content: newComment.trim()
                })
            })

            if (!res.ok) throw new Error(await res.text())
            setNewComment('')
            await fetchLists()
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

    return (
        <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 16px' }}>
            {/* ── Header — Basecamp style: centered title + "New list" button ── */}
            <div style={{ textAlign: 'center', padding: '32px 0 28px' }}>
                <h2 style={{
                    fontSize: 28, fontWeight: 700, color: '#1D2D35',
                    margin: 0, lineHeight: 1.2
                }}>
                    ✅ {t('basecamp.todos')}
                </h2>
                <div style={{ marginTop: 16 }}>
                    <button
                        onClick={() => setShowAddList(true)}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '8px 18px', borderRadius: 6, border: 'none',
                            background: '#1D7DB5', color: '#fff', fontSize: 14, fontWeight: 600,
                            cursor: 'pointer', transition: 'background 0.15s'
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#155D8A')}
                        onMouseLeave={e => (e.currentTarget.style.background = '#1D7DB5')}
                    >
                        <Plus size={16} />
                        {t('basecamp.add_list')}
                    </button>
                </div>
            </div>

            {/* ── Loading State ── */}
            {loading && lists.length === 0 ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
                    <Loader2 className="animate-spin" style={{ width: 32, height: 32, color: '#1D7DB5' }} />
                </div>
            ) : lists.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
                    {lists.map((list, listIdx) => {
                        const openTasks = list.tasks.filter((tk: any) => !tk.is_completed)
                        const completedTasks = list.tasks.filter((tk: any) => tk.is_completed)
                        const isExpanded = expandedCompleted[list.id] || false
                        const dotColor = LIST_DOT_COLORS[listIdx % LIST_DOT_COLORS.length]

                        return (
                            <div key={list.id}>
                                {/* ── List Header: colored dot + bold name (FLAT, no card box) ── */}
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    marginBottom: 4
                                }}>
                                    <span style={{
                                        width: 12, height: 12, borderRadius: '50%',
                                        background: dotColor, flexShrink: 0
                                    }} />
                                    <h3 style={{
                                        fontSize: 18, fontWeight: 700, color: '#1D2D35',
                                        margin: 0, lineHeight: 1.3
                                    }}>
                                        {list.list_name}
                                    </h3>
                                </div>
                                {list.description && (
                                    <p style={{
                                        fontSize: 13, color: '#6B7B8D', margin: '0 0 6px 22px'
                                    }}>
                                        {list.description}
                                    </p>
                                )}

                                {/* ── Open Tasks — single-line items with inline avatars ── */}
                                <div style={{
                                    borderTop: '1px solid #E8E6E1'
                                }}>
                                    {openTasks.length > 0 ? openTasks.map((task: any) => (
                                        <div
                                            key={task.id}
                                            onClick={() => {
                                                if (navigateTo) {
                                                    navigateTo({ project: project.id, tool: 'todos', todoId: task.id })
                                                } else {
                                                    setSelectedTask(task)
                                                    setSelectedTaskListId(list.id)
                                                }
                                            }}
                                            className="group"
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 10,
                                                padding: '10px 4px 10px 0',
                                                borderBottom: '1px solid #F0EFEB',
                                                cursor: 'pointer', transition: 'background 0.1s',
                                                position: 'relative'
                                            }}
                                            onMouseEnter={e => (e.currentTarget.style.background = '#FAFAF8')}
                                            onMouseLeave={e => (e.currentTarget.style.background = '')}
                                        >
                                            {/* Checkbox */}
                                            <div style={{ flexShrink: 0 }}>
                                                {actionLoading === task.id ? (
                                                    <Loader2 className="animate-spin" style={{ width: 18, height: 18, color: '#1D7DB5' }} />
                                                ) : (
                                                    <div
                                                        onClick={(e) => { e.stopPropagation(); handleToggleTask(list.id, task) }}
                                                        style={{
                                                            width: 18, height: 18, border: '2px solid #C4C4C4',
                                                            borderRadius: 3, cursor: 'pointer',
                                                            transition: 'border-color 0.15s'
                                                        }}
                                                        onMouseEnter={e => (e.currentTarget.style.borderColor = '#1D7DB5')}
                                                        onMouseLeave={e => (e.currentTarget.style.borderColor = '#C4C4C4')}
                                                    />
                                                )}
                                            </div>

                                            {/* Task name */}
                                            <span style={{
                                                fontSize: 15, fontWeight: 500, color: '#1D2D35',
                                                flex: 1, minWidth: 0, lineHeight: '20px',
                                                wordBreak: 'break-word', whiteSpace: 'normal'
                                            }}>
                                                {task.task_name}
                                            </span>

                                            {/* Comment count badge — colored circle with number (Basecamp style) */}
                                            {task.comments && task.comments.length > 0 && (
                                                <span
                                                    title={`${task.comments.length} comments`}
                                                    style={{
                                                        width: 20, height: 20, borderRadius: '50%',
                                                        background: task.comments.length > 5 ? '#E74C3C' : task.comments.length > 2 ? '#F39C12' : '#3498DB',
                                                        color: '#fff', fontSize: 10, fontWeight: 700,
                                                        display: 'inline-flex', alignItems: 'center',
                                                        justifyContent: 'center', flexShrink: 0, lineHeight: 1
                                                    }}
                                                >
                                                    {task.comments.length}
                                                </span>
                                            )}

                                            {/* Inline avatar circles (Basecamp style) */}
                                            {task.assigneeList && task.assigneeList.length > 0 && (
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0
                                                }}>
                                                    {task.assigneeList.map((a: any) => (
                                                        <span
                                                            key={a.id}
                                                            title={a.name}
                                                            style={{
                                                                width: 18, height: 18, borderRadius: '50%',
                                                                background: getAvatarColor(a.name),
                                                                color: '#fff', fontSize: 8, fontWeight: 700,
                                                                display: 'inline-flex', alignItems: 'center',
                                                                justifyContent: 'center', flexShrink: 0,
                                                                lineHeight: 1
                                                            }}
                                                        >
                                                            {getInitials(a.name)}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Notes/attachment indicator icon */}
                                            {task.description && task.description.trim() && (
                                                <span
                                                    title="Has notes/attachments"
                                                    style={{
                                                        display: 'inline-flex', alignItems: 'center',
                                                        color: '#A0A0A0', flexShrink: 0
                                                    }}
                                                >
                                                    <FileText size={14} />
                                                </span>
                                            )}

                                            {/* Delete (hover only) */}
                                            <button
                                                onClick={(e) => handleDeleteTask(list.id, task, e)}
                                                className="opacity-0 group-hover:opacity-100"
                                                style={{
                                                    padding: 4, borderRadius: 4, border: 'none',
                                                    background: 'transparent', cursor: 'pointer',
                                                    color: '#A0A0A0', transition: 'color 0.15s, opacity 0.15s',
                                                    flexShrink: 0
                                                }}
                                                onMouseEnter={e => (e.currentTarget.style.color = '#D73A2E')}
                                                onMouseLeave={e => (e.currentTarget.style.color = '#A0A0A0')}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    )) : (
                                        <p style={{
                                            fontSize: 14, color: '#6B7B8D', padding: '12px 0',
                                            margin: 0, fontStyle: 'italic'
                                        }}>
                                            {t('basecamp.no_open_tasks') || '✅ All tasks completed'}
                                        </p>
                                    )}
                                </div>

                                {/* ── Completed Tasks Toggle (✅ N completed) ── */}
                                {completedTasks.length > 0 && (
                                    <div>
                                        <button
                                            onClick={() => toggleCompletedSection(list.id)}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 6,
                                                padding: '10px 0', border: 'none', background: 'transparent',
                                                cursor: 'pointer', fontSize: 13, fontWeight: 600,
                                                color: '#6B7B8D', transition: 'color 0.15s'
                                            }}
                                            onMouseEnter={e => (e.currentTarget.style.color = '#1D2D35')}
                                            onMouseLeave={e => (e.currentTarget.style.color = '#6B7B8D')}
                                        >
                                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                            <CheckSquare size={14} style={{ color: '#4BAE4F' }} />
                                            <span>{completedTasks.length} {t('basecamp.completed_label')}</span>
                                        </button>

                                        {isExpanded && (
                                            <div>
                                                {completedTasks.map((task: any) => (
                                                    <div
                                                        key={task.id}
                                                        onClick={() => {
                                                            if (navigateTo) {
                                                                navigateTo({ project: project.id, tool: 'todos', todoId: task.id })
                                                            } else {
                                                                setSelectedTask(task)
                                                                setSelectedTaskListId(list.id)
                                                            }
                                                        }}
                                                        style={{
                                                            display: 'flex', alignItems: 'center', gap: 10,
                                                            padding: '8px 4px 8px 0',
                                                            borderBottom: '1px solid #F0EFEB',
                                                            cursor: 'pointer', transition: 'background 0.1s'
                                                        }}
                                                        onMouseEnter={e => (e.currentTarget.style.background = '#FAFAF8')}
                                                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                                                    >
                                                        {/* Checked box */}
                                                        <div style={{ flexShrink: 0 }}>
                                                            {actionLoading === task.id ? (
                                                                <Loader2 className="animate-spin" style={{ width: 16, height: 16, color: '#4BAE4F' }} />
                                                            ) : (
                                                                <div
                                                                    onClick={(e) => { e.stopPropagation(); handleToggleTask(list.id, task) }}
                                                                    style={{
                                                                        width: 18, height: 18, background: '#4BAE4F',
                                                                        border: '2px solid #4BAE4F', borderRadius: 3,
                                                                        cursor: 'pointer', display: 'flex',
                                                                        alignItems: 'center', justifyContent: 'center'
                                                                    }}
                                                                >
                                                                    <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
                                                                        <path d="M1 5L4.5 8.5L11 1.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                                    </svg>
                                                                </div>
                                                            )}
                                                        </div>
                                                        {/* Completed task name (strikethrough + grey) */}
                                                        <span style={{
                                                            fontSize: 15, fontWeight: 400, color: '#A0A0A0',
                                                            textDecoration: 'line-through',
                                                            flex: 1, minWidth: 0, lineHeight: '20px',
                                                            wordBreak: 'break-word', whiteSpace: 'normal'
                                                        }}>
                                                            {task.task_name}
                                                        </span>

                                                        {/* Inline avatar circles for completed tasks too (Basecamp style) */}
                                                        {task.assigneeList && task.assigneeList.length > 0 && (
                                                            <div style={{
                                                                display: 'flex', alignItems: 'center', gap: 2,
                                                                flexShrink: 0, opacity: 0.5
                                                            }}>
                                                                {task.assigneeList.map((a: any) => (
                                                                    <span
                                                                        key={a.id}
                                                                        title={a.name}
                                                                        style={{
                                                                            width: 18, height: 18, borderRadius: '50%',
                                                                            background: getAvatarColor(a.name),
                                                                            color: '#fff', fontSize: 8, fontWeight: 700,
                                                                            display: 'inline-flex', alignItems: 'center',
                                                                            justifyContent: 'center', flexShrink: 0,
                                                                            lineHeight: 1
                                                                        }}
                                                                    >
                                                                        {getInitials(a.name)}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {/* Comment count */}
                                                        {task.comments && task.comments.length > 0 && (
                                                            <span style={{
                                                                display: 'inline-flex', alignItems: 'center', gap: 2,
                                                                fontSize: 11, color: '#B0B0B0', flexShrink: 0
                                                            }}>
                                                                <MessageSquare size={11} />
                                                                {task.comments.length}
                                                            </span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* ── "Add a to-do" — blue text link (Basecamp style) ── */}
                                {addingTaskId === list.id ? (
                                    <div style={{ marginTop: 4, borderTop: '1px solid #E8E6E1' }}>
                                        <form onSubmit={(e) => handleAddTask(list.id, list.bc_id, e)}>
                                            {/* Task name input row — checkbox + text like a real todo being typed */}
                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: 10,
                                                padding: '10px 0',
                                                borderBottom: '1px solid #F0EFEB'
                                            }}>
                                                <div style={{
                                                    width: 18, height: 18, border: '2px solid #D5D3CE',
                                                    borderRadius: 3, flexShrink: 0, opacity: 0.5
                                                }} />
                                                <input
                                                    type="text"
                                                    required
                                                    value={newTaskName}
                                                    onChange={(e) => setNewTaskName(e.target.value)}
                                                    placeholder={t('basecamp.task_placeholder') || 'Describe this to-do...'}
                                                    autoFocus
                                                    style={{
                                                        flex: 1, padding: 0, border: 'none',
                                                        fontSize: 15, fontWeight: 500, color: '#1D2D35',
                                                        outline: 'none', background: 'transparent',
                                                        lineHeight: '20px'
                                                    }}
                                                />
                                            </div>

                                            {/* Labeled form fields — exact Basecamp layout */}
                                            <div style={{
                                                padding: '12px 0 12px 28px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: 10,
                                                borderTop: '1px solid #E8E6E1',
                                                marginTop: 10
                                            }}>
                                                {/* Assigned to */}
                                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                                    <span style={{
                                                        width: 100, fontSize: 13, fontWeight: 600,
                                                        color: '#6B7B8D', textAlign: 'right', marginRight: 16,
                                                        flexShrink: 0
                                                    }}>
                                                        {t('basecamp.assign_to')}
                                                    </span>
                                                    <select
                                                        value={newTaskAssignee}
                                                        onChange={(e) => setNewTaskAssignee(e.target.value)}
                                                        style={{
                                                            border: '1px solid #E8E6E1', borderRadius: 4,
                                                            padding: '4px 8px', fontSize: 13, color: '#1D2D35',
                                                            background: '#fff', outline: 'none', minWidth: 200
                                                        }}
                                                    >
                                                        <option value="">{t('basecamp.type_names_placeholder')}</option>
                                                        {(project.people || []).map((p: any) => (
                                                            <option key={p.id} value={p.id}>{p.name}</option>
                                                        ))}
                                                    </select>
                                                </div>

                                                {/* When done */}
                                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                                    <span style={{
                                                        width: 100, fontSize: 13, fontWeight: 600,
                                                        color: '#6B7B8D', textAlign: 'right', marginRight: 16,
                                                        flexShrink: 0
                                                    }}>
                                                        {t('basecamp.when_done')}
                                                    </span>
                                                    <span style={{ fontSize: 13, color: '#A0A0A0' }}>
                                                        {t('basecamp.notify_people_placeholder')}
                                                    </span>
                                                </div>

                                                {/* Due on */}
                                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                                    <span style={{
                                                        width: 100, fontSize: 13, fontWeight: 600,
                                                        color: '#6B7B8D', textAlign: 'right', marginRight: 16,
                                                        flexShrink: 0
                                                    }}>
                                                        {t('basecamp.due_on') || t('basecamp.due_date')}
                                                    </span>
                                                    <input
                                                        type="date"
                                                        value={newTaskDueDate}
                                                        onChange={(e) => setNewTaskDueDate(e.target.value)}
                                                        style={{
                                                            border: '1px solid #E8E6E1', borderRadius: 4,
                                                            padding: '3px 8px', fontSize: 13, color: '#1D2D35',
                                                            background: '#fff', outline: 'none'
                                                        }}
                                                    />
                                                </div>

                                                {/* Notes */}
                                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                                    <span style={{
                                                        width: 100, fontSize: 13, fontWeight: 600,
                                                        color: '#6B7B8D', textAlign: 'right', marginRight: 16,
                                                        flexShrink: 0
                                                    }}>
                                                        {t('basecamp.notes_label')}
                                                    </span>
                                                    <input
                                                        type="text"
                                                        value={newTaskNotes}
                                                        onChange={(e) => setNewTaskNotes(e.target.value)}
                                                        placeholder={t('basecamp.notes_placeholder')}
                                                        style={{
                                                            border: '1px solid #E8E6E1', borderRadius: 4,
                                                            padding: '4px 8px', fontSize: 13, color: '#1D2D35',
                                                            background: '#fff', outline: 'none', width: '100%',
                                                            maxWidth: 400
                                                        }}
                                                    />
                                                </div>

                                                {/* Subtasks */}
                                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                                    <span style={{
                                                        width: 100, fontSize: 13, fontWeight: 600,
                                                        color: '#6B7B8D', textAlign: 'right', marginRight: 16,
                                                        flexShrink: 0
                                                    }}>
                                                        {t('basecamp.subtasks_label')}
                                                    </span>
                                                    <span style={{ fontSize: 13, color: '#A0A0A0' }}>
                                                        {t('basecamp.add_subtasks_placeholder')}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Action buttons — blue "Add this to-do" + Cancel link button */}
                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: 10,
                                                padding: '4px 0 12px 144px'
                                            }}>
                                                <button
                                                    type="submit"
                                                    style={{
                                                        padding: '7px 16px', borderRadius: 4, border: 'none',
                                                        background: '#1D7DB5', fontSize: 13, fontWeight: 600,
                                                        color: '#fff', cursor: 'pointer', transition: 'background 0.15s'
                                                    }}
                                                    onMouseEnter={e => (e.currentTarget.style.background = '#155D8A')}
                                                    onMouseLeave={e => (e.currentTarget.style.background = '#1D7DB5')}
                                                >
                                                    {t('basecamp.add_todo_btn_label')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setAddingTaskId(null)
                                                        setNewTaskName('')
                                                        setNewTaskAssignee('')
                                                        setNewTaskDueDate('')
                                                        setNewTaskNotes('')
                                                    }}
                                                    style={{
                                                        padding: '6px 14px', borderRadius: 4,
                                                        border: '1px solid #D5D3CE', background: '#fff',
                                                        fontSize: 13, fontWeight: 600, color: '#1D7DB5',
                                                        cursor: 'pointer', transition: 'background 0.15s'
                                                    }}
                                                    onMouseEnter={e => (e.currentTarget.style.background = '#F7F5F2')}
                                                    onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                                                >
                                                    {t('basecamp.cancel_btn_label')}
                                                </button>
                                            </div>
                                        </form>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setAddingTaskId(list.id)}
                                        style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 4,
                                            padding: '8px 0', border: 'none', background: 'transparent',
                                            fontSize: 14, fontWeight: 500, color: '#1D7DB5',
                                            cursor: 'pointer', transition: 'color 0.1s'
                                        }}
                                        onMouseEnter={e => (e.currentTarget.style.color = '#155D8A')}
                                        onMouseLeave={e => (e.currentTarget.style.color = '#1D7DB5')}
                                    >
                                        {t('basecamp.add_task')}
                                    </button>
                                )}
                            </div>
                        )
                    })}
                </div>
            ) : (
                /* ── Empty state ── */
                <div style={{ textAlign: 'center', padding: '48px 0' }}>
                    <ClipboardList size={48} style={{ color: '#C4C4C4', margin: '0 auto 12px' }} />
                    <p style={{ fontSize: 15, color: '#6B7B8D', fontStyle: 'italic' }}>
                        {t('basecamp.no_todos_list')}
                    </p>
                </div>
            )}

            {/* ══════════════════════════════════════════════════════════════════
                Modal — Add New List (Basecamp style centered dialog)
               ══════════════════════════════════════════════════════════════════ */}
            {showAddList && (
                <div
                    onClick={(e) => { if (e.target === e.currentTarget) setShowAddList(false) }}
                    style={{
                        position: 'fixed', inset: 0, zIndex: 50,
                        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                        paddingTop: 80, background: 'rgba(0,0,0,0.35)'
                    }}
                >
                    <div style={{
                        background: '#fff', borderRadius: 10, maxWidth: 520, width: '100%',
                        boxShadow: '0 12px 40px rgba(0,0,0,0.15)',
                        overflow: 'hidden'
                    }}>
                        {/* Header */}
                        <div style={{
                            padding: '20px 28px', borderBottom: '1px solid #E8E6E1',
                            background: '#FAFAF8', textAlign: 'center'
                        }}>
                            <div style={{
                                width: 44, height: 44, borderRadius: '50%',
                                background: '#27AE60', color: '#fff', fontSize: 20,
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                marginBottom: 12
                            }}>
                                <CheckSquare size={22} />
                            </div>
                            <h3 style={{
                                fontSize: 21, fontWeight: 700, color: '#1D2D35', margin: 0
                            }}>
                                {t('basecamp.add_list')}
                            </h3>
                            <p style={{ fontSize: 13, color: '#6B7B8D', margin: '6px 0 0' }}>
                                {t('basecamp.list_desc_label')}
                            </p>
                        </div>

                        {/* Form body */}
                        <form onSubmit={handleAddList} style={{ padding: '24px 28px' }}>
                            <div style={{ marginBottom: 20 }}>
                                <label style={{
                                    display: 'block', fontSize: 13, fontWeight: 600,
                                    color: '#1D2D35', marginBottom: 8
                                }}>
                                    {t('basecamp.name_label')}
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={newListName}
                                    onChange={(e) => setNewListName(e.target.value)}
                                    placeholder={t('basecamp.new_list_placeholder')}
                                    autoFocus
                                    style={{
                                        width: '100%', padding: '12px 14px',
                                        border: '2px solid #E8E6E1', borderRadius: 6,
                                        fontSize: 16, color: '#1D2D35', outline: 'none',
                                        transition: 'border-color 0.15s'
                                    }}
                                    onFocus={e => (e.target.style.borderColor = '#1D7DB5')}
                                    onBlur={e => (e.target.style.borderColor = '#E8E6E1')}
                                />
                            </div>
                            <div style={{ marginBottom: 24 }}>
                                <label style={{
                                    display: 'block', fontSize: 13, fontWeight: 600,
                                    color: '#1D2D35', marginBottom: 8
                                }}>
                                    {t('basecamp.list_desc_label')}
                                </label>
                                <textarea
                                    value={newListDesc}
                                    onChange={(e) => setNewListDesc(e.target.value)}
                                    placeholder={t('basecamp.list_desc_placeholder')}
                                    rows={3}
                                    style={{
                                        width: '100%', padding: '12px 14px',
                                        border: '2px solid #E8E6E1', borderRadius: 6,
                                        fontSize: 15, color: '#1D2D35', outline: 'none',
                                        resize: 'vertical', fontFamily: 'inherit',
                                        transition: 'border-color 0.15s'
                                    }}
                                    onFocus={e => (e.target.style.borderColor = '#1D7DB5')}
                                    onBlur={e => (e.target.style.borderColor = '#E8E6E1')}
                                />
                            </div>
                            <div style={{
                                display: 'flex', justifyContent: 'flex-end', gap: 10
                            }}>
                                <button
                                    type="button"
                                    onClick={() => { setShowAddList(false); setNewListName(''); setNewListDesc('') }}
                                    style={{
                                        padding: '10px 22px', borderRadius: 6,
                                        border: '1px solid #D5D3CE', background: '#fff',
                                        fontSize: 14, fontWeight: 600, color: '#6B7B8D',
                                        cursor: 'pointer', transition: 'background 0.15s'
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#F0EFEB')}
                                    onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                                >
                                    {t('basecamp.cancel')}
                                </button>
                                <button
                                    type="submit"
                                    style={{
                                        padding: '10px 22px', borderRadius: 6, border: 'none',
                                        background: '#4BAE4F', fontSize: 14, fontWeight: 700,
                                        color: '#fff', cursor: 'pointer', transition: 'background 0.15s'
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#3D9440')}
                                    onMouseLeave={e => (e.currentTarget.style.background = '#4BAE4F')}
                                >
                                    {t('basecamp.create_list')}
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
                            paddingTop: 40, background: 'rgba(0,0,0,0.4)',
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
                                <div style={{
                                    display: 'grid', gridTemplateColumns: 'auto 1fr',
                                    gap: '10px 16px', alignItems: 'center',
                                    paddingBottom: 20, borderBottom: '1px solid #E8E6E1'
                                }}>
                                    {/* Assigned to */}
                                    <span style={{
                                        fontSize: 13, fontWeight: 700, color: '#1D2D35',
                                        justifySelf: 'end', whiteSpace: 'nowrap'
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
                                    <span style={{
                                        fontSize: 13, fontWeight: 700, color: '#1D2D35',
                                        justifySelf: 'end', whiteSpace: 'nowrap'
                                    }}>
                                        {t('basecamp.when_done')}
                                    </span>
                                    <span style={{ fontSize: 14, color: '#A0A0A0', fontStyle: 'italic' }}>
                                        {t('basecamp.notify_people')}
                                    </span>

                                    {/* Due on */}
                                    <span style={{
                                        fontSize: 13, fontWeight: 700, color: '#1D2D35',
                                        justifySelf: 'end', whiteSpace: 'nowrap'
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
                                    <span style={{
                                        fontSize: 13, fontWeight: 700, color: '#1D2D35',
                                        justifySelf: 'end', whiteSpace: 'nowrap',
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
                                    {t('basecamp.comments_title')} ({selectedTask.comments?.length || 0})
                                </h4>

                                {selectedTask.comments && selectedTask.comments.length > 0 ? (
                                    <div style={{
                                        display: 'flex', flexDirection: 'column',
                                        maxHeight: 400, overflow: 'auto', marginBottom: 20
                                    }}>
                                        {selectedTask.comments.map((c: any, idx: number) => (
                                            <div key={idx} style={{
                                                display: 'flex', gap: 12, padding: '14px 0',
                                                borderBottom: idx < selectedTask.comments.length - 1
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

