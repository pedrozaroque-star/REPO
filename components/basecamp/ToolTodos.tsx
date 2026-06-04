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
 */

'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useLanguage } from '@/lib/i18n'
import { ClipboardList, Plus, Trash2, Calendar, User, MessageSquare, CheckSquare, Loader2, ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { getSupabaseWithAuth } from '@/lib/supabase'

interface ToolTodosProps {
    project: any
    currentUserName: string
}

export default function ToolTodos({ project, currentUserName }: ToolTodosProps) {
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
                setSelectedTask(null)
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
                                                setSelectedTask(task)
                                                setSelectedTaskListId(list.id)
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
                                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                flex: 1, minWidth: 0, lineHeight: '20px'
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

                                            {/* Inline avatar circles (20px each) */}
                                            {task.assigneeList && task.assigneeList.length > 0 && (
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0
                                                }}>
                                                    {task.assigneeList.map((a: any) => (
                                                        <span
                                                            key={a.id}
                                                            title={a.name}
                                                            style={{
                                                                width: 20, height: 20, borderRadius: '50%',
                                                                background: getAvatarColor(a.name),
                                                                color: '#fff', fontSize: 9, fontWeight: 700,
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
                                                            setSelectedTask(task)
                                                            setSelectedTaskListId(list.id)
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
                                                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                            flex: 1, minWidth: 0, lineHeight: '20px'
                                                        }}>
                                                            {task.task_name}
                                                        </span>

                                                        {/* Inline avatar circles for completed tasks too */}
                                                        {task.assigneeList && task.assigneeList.length > 0 && (
                                                            <div style={{
                                                                display: 'flex', alignItems: 'center', gap: 3,
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
                                                    placeholder={t('basecamp.task_placeholder')}
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
                                            <div style={{ padding: '12px 0 8px 28px' }}>
                                                {/* Assigned to */}
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', gap: 0,
                                                    marginBottom: 8
                                                }}>
                                                    <span style={{
                                                        width: 100, fontSize: 13, fontWeight: 700,
                                                        color: '#1D2D35', flexShrink: 0
                                                    }}>
                                                        Assigned to
                                                    </span>
                                                    <select
                                                        value={newTaskAssignee}
                                                        onChange={(e) => setNewTaskAssignee(e.target.value)}
                                                        style={{
                                                            flex: 1, border: 'none', background: 'transparent',
                                                            fontSize: 14, color: newTaskAssignee ? '#1D2D35' : '#999',
                                                            cursor: 'pointer', outline: 'none', padding: '4px 0'
                                                        }}
                                                    >
                                                        <option value="">Type names to assign...</option>
                                                        {(project.people || []).map((p: any) => (
                                                            <option key={p.id} value={p.id}>{p.name}</option>
                                                        ))}
                                                    </select>
                                                </div>

                                                {/* When done */}
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', gap: 0,
                                                    marginBottom: 8
                                                }}>
                                                    <span style={{
                                                        width: 100, fontSize: 13, fontWeight: 700,
                                                        color: '#1D2D35', flexShrink: 0
                                                    }}>
                                                        When done
                                                    </span>
                                                    <span style={{ fontSize: 14, color: '#999' }}>
                                                        Notify these people...
                                                    </span>
                                                </div>

                                                {/* Due on */}
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', gap: 0,
                                                    marginBottom: 8
                                                }}>
                                                    <span style={{
                                                        width: 100, fontSize: 13, fontWeight: 700,
                                                        color: '#1D2D35', flexShrink: 0
                                                    }}>
                                                        Due on
                                                    </span>
                                                    <input
                                                        type="date"
                                                        value={newTaskDueDate}
                                                        onChange={(e) => setNewTaskDueDate(e.target.value)}
                                                        style={{
                                                            flex: 1, border: 'none', background: 'transparent',
                                                            fontSize: 14, color: newTaskDueDate ? '#1D2D35' : '#999',
                                                            cursor: 'pointer', outline: 'none', padding: '4px 0'
                                                        }}
                                                    />
                                                </div>

                                                {/* Notes */}
                                                <div style={{
                                                    display: 'flex', alignItems: 'flex-start', gap: 0,
                                                    marginBottom: 8
                                                }}>
                                                    <span style={{
                                                        width: 100, fontSize: 13, fontWeight: 700,
                                                        color: '#1D2D35', flexShrink: 0, paddingTop: 4
                                                    }}>
                                                        Notes
                                                    </span>
                                                    <input
                                                        type="text"
                                                        value={newTaskNotes}
                                                        onChange={(e) => setNewTaskNotes(e.target.value)}
                                                        placeholder="Add extra details or attach a file..."
                                                        style={{
                                                            flex: 1, border: 'none', background: 'transparent',
                                                            fontSize: 14, color: newTaskNotes ? '#1D2D35' : '#999',
                                                            outline: 'none', padding: '4px 0'
                                                        }}
                                                    />
                                                </div>

                                                {/* Subtasks */}
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', gap: 0,
                                                    marginBottom: 12
                                                }}>
                                                    <span style={{
                                                        width: 100, fontSize: 13, fontWeight: 700,
                                                        color: '#1D2D35', flexShrink: 0
                                                    }}>
                                                        Subtasks
                                                    </span>
                                                    <span style={{ fontSize: 14, color: '#999' }}>
                                                        Add subtasks
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Action buttons — green "Add this to-do" + Cancel link */}
                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: 12,
                                                padding: '0 0 12px 28px'
                                            }}>
                                                <button
                                                    type="submit"
                                                    style={{
                                                        padding: '8px 20px', borderRadius: 5, border: 'none',
                                                        background: '#4BAE4F', fontSize: 14, fontWeight: 700,
                                                        color: '#fff', cursor: 'pointer', transition: 'background 0.15s'
                                                    }}
                                                    onMouseEnter={e => (e.currentTarget.style.background = '#3D9440')}
                                                    onMouseLeave={e => (e.currentTarget.style.background = '#4BAE4F')}
                                                >
                                                    Add this to-do
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
                                                        padding: '4px 8px', border: 'none', background: 'transparent',
                                                        fontSize: 14, fontWeight: 500, color: '#6B7B8D',
                                                        cursor: 'pointer', textDecoration: 'none'
                                                    }}
                                                >
                                                    Cancel
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
                                    Name
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
                        onClick={(e) => { if (e.target === e.currentTarget) setSelectedTask(null) }}
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
                                    onClick={() => setSelectedTask(null)}
                                    style={{
                                        border: 'none', background: 'transparent',
                                        color: '#1D7DB5', cursor: 'pointer', fontSize: 13,
                                        fontWeight: 500, padding: 0
                                    }}
                                >
                                    ← {listName}
                                </button>
                                <button
                                    onClick={() => setSelectedTask(null)}
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

                            {/* ── Title section ── */}
                            <div style={{ padding: '28px 28px 0' }}>
                                {/* Status pill */}
                                <div style={{ marginBottom: 12 }}>
                                    {selectedTask.is_completed ? (
                                        <span style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 6,
                                            padding: '4px 12px', borderRadius: 20,
                                            background: '#E8F5E9', color: '#2E7D32',
                                            fontSize: 12, fontWeight: 600
                                        }}>
                                            <CheckSquare size={13} /> {t('basecamp.completed_label')}
                                        </span>
                                    ) : (
                                        <span style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 6,
                                            padding: '4px 12px', borderRadius: 20,
                                            background: '#FFF8E1', color: '#F57F17',
                                            fontSize: 12, fontWeight: 600
                                        }}>
                                            ○ {t('basecamp.open_label') || 'Open'}
                                        </span>
                                    )}
                                </div>

                                {/* Large title */}
                                <h2 style={{
                                    fontSize: 26, fontWeight: 700, color: '#1D2D35',
                                    margin: '0 0 16px', lineHeight: 1.35
                                }}>
                                    {selectedTask.task_name}
                                </h2>

                                {/* ── Assignees & Due Date ── */}
                                <div style={{
                                    display: 'flex', alignItems: 'center', flexWrap: 'wrap',
                                    gap: 16, paddingBottom: 20, borderBottom: '1px solid #E8E6E1'
                                }}>
                                    {selectedTask.assigneeList && selectedTask.assigneeList.length > 0 ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontSize: 12, color: '#6B7B8D', fontWeight: 600 }}>
                                                {t('basecamp.assign_to')}:
                                            </span>
                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                {selectedTask.assigneeList.map((a: any) => (
                                                    <span key={a.id} style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 6,
                                                        padding: '3px 10px 3px 3px', borderRadius: 20,
                                                        background: '#F0EFEB', fontSize: 13, fontWeight: 500,
                                                        color: '#1D2D35'
                                                    }}>
                                                        <span style={{
                                                            width: 22, height: 22, borderRadius: '50%',
                                                            background: getAvatarColor(a.name),
                                                            color: '#fff', fontSize: 10, fontWeight: 700,
                                                            display: 'flex', alignItems: 'center',
                                                            justifyContent: 'center', flexShrink: 0
                                                        }}>
                                                            {getInitials(a.name)}
                                                        </span>
                                                        {a.name}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: 6,
                                            fontSize: 13, color: '#A0A0A0'
                                        }}>
                                            <User size={14} />
                                            <span>{t('basecamp.no_assigned')}</span>
                                        </div>
                                    )}

                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: 6,
                                        fontSize: 13, color: selectedTask.due_date ? '#1D2D35' : '#A0A0A0',
                                        fontWeight: selectedTask.due_date ? 500 : 400
                                    }}>
                                        <Calendar size={14} style={{ color: '#6B7B8D' }} />
                                        <span>{selectedTask.due_date || t('basecamp.no_due_date')}</span>
                                    </div>
                                </div>
                            </div>

                            {/* ── Description / Notes ── */}
                            {selectedTask.description && (() => {
                                const desc = selectedTask.description as string
                                const imgRegex = /<img[^>]+(?:src|alt)=["']([^"']*?)["'][^>]*>/gi
                                const attachments: string[] = []
                                let match
                                while ((match = imgRegex.exec(desc)) !== null) {
                                    const val = match[1]
                                    const filename = val.includes('/') ? val.split('/').pop() || val : val
                                    if (filename && !attachments.includes(filename)) {
                                        attachments.push(filename)
                                    }
                                }
                                const cleanHtml = desc
                                    .replace(/<img[^>]*>/gi, '')
                                    .replace(/<br\s*\/?>/gi, '\n')
                                    .replace(/<[^>]+>/g, '')
                                    .trim()

                                if (!cleanHtml && attachments.length === 0) return null

                                return (
                                    <div style={{ padding: '20px 28px', borderBottom: '1px solid #E8E6E1' }}>
                                        <h4 style={{
                                            fontSize: 12, fontWeight: 700, color: '#6B7B8D',
                                            textTransform: 'uppercase', letterSpacing: '0.5px',
                                            margin: '0 0 10px'
                                        }}>
                                            Notes
                                        </h4>

                                        {cleanHtml && (
                                            <p style={{
                                                fontSize: 15, color: '#4A5568', lineHeight: 1.6,
                                                margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word'
                                            }}>
                                                {cleanHtml}
                                            </p>
                                        )}

                                        {attachments.length > 0 && (
                                            <div style={{ marginTop: cleanHtml ? 12 : 0 }}>
                                                <div style={{
                                                    fontSize: 11, fontWeight: 600, color: '#6B7B8D',
                                                    textTransform: 'uppercase', marginBottom: 6
                                                }}>
                                                    📎 {attachments.length} {attachments.length === 1 ? 'Attachment' : 'Attachments'}
                                                </div>
                                                <div style={{
                                                    display: 'flex', flexDirection: 'column', gap: 4
                                                }}>
                                                    {attachments.map((file, i) => (
                                                        <div key={i} style={{
                                                            display: 'flex', alignItems: 'center', gap: 8,
                                                            padding: '6px 10px', background: '#F7F5F2',
                                                            borderRadius: 5, fontSize: 13, color: '#1D2D35'
                                                        }}>
                                                            <span style={{ fontSize: 16 }}>
                                                                {/\.(jpg|jpeg|png|gif|webp|heic|svg)$/i.test(file) ? '🖼️' : '📄'}
                                                            </span>
                                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                {decodeURIComponent(file)}
                                                            </span>
                                                        </div>
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
                                                    <p style={{
                                                        fontSize: 14, color: '#4A5568', margin: 0,
                                                        lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word'
                                                    }}>
                                                        {c.text}
                                                    </p>
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
        </div>
    )
}

