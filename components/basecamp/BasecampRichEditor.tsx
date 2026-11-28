/**
 * @module components/basecamp/BasecampRichEditor
 * @description Editor de texto enriquecido reutilizable estilo Basecamp 4 Trix para crear y editar
 *              notas de To-Dos, comentarios y anuncios (Message Board) en Tacos Gavilan (TEG).
 *              Incluye barra Trix completa, subida real de fotos/archivos (`POST /api/basecamp/upload`
 *              + fallback Supabase Storage `checklist-photos`), pegado `Ctrl+V`, `Drag & Drop`,
 *              tablas dinámicas, dictado por voz e inserción en vivo de `@menciones` con autocompletado.
 *
 * @businessRules
 * - Al escribir `@` seguido de `0..35` caracteres antes del cursor, despliega un menú flotante junto al
 *   cursor filtrando el directorio activo del proyecto (`people`) con tolerancia a acentos y variaciones
 *   fonéticas (`Alex/Alejandro`, `Erick/Erik`, `Velasquez/Velazquez`) vía `normalizePersonName`.
 * - Al seleccionar una persona `p`:
 *   1. Si cuenta con `p.attachable_sgid` (usuario real en Basecamp 3): inserta
 *      `<bc-attachment sgid="..." content-type="application/vnd.basecamp.mention" data-teg-mention-person-id="..." class="bc-mention-pill" contenteditable="false">@Nombre</bc-attachment>&nbsp;`
 *   2. Si no tiene `attachable_sgid` (gerente/asistente sintético TEG): inserta
 *      `<span data-teg-mention-person-id="..." class="bc-mention-pill" contenteditable="false">@Nombre</span>&nbsp;`
 * - Al hidratar `initialHtml` para editar registros existentes, transforma menciones previas en píldoras
 *   atómicas visibles preservando `sgid` y `data-teg-mention-person-id` para no perder identidad al guardar.
 * - Soporta Español e Inglés mediante `useLanguage()` sin cadenas visibles hardcodeadas.
 *
 * @dataFlow
 * - Entrada: `initialHtml`, `editorKey`, `people`, `onChangeHtml(html, isEmpty)`, `onSubmitShortcut`
 * - Subida de adjuntos: `File` -> `compressImage` -> `POST /api/basecamp/upload` (con `teg_token`) -> fallback `supabase.storage.from('checklist-photos')` -> HTML `<img>` o `<bc-attachment>`
 * - Salida: `onChangeHtml(rawEditorHtml, !hasRichContentOrMedia(rawEditorHtml))`
 *
 * @notes
 * - Soporta tanto patrón controlado (`initialHtml={draft}` + `setDraft('')` al enviar) como no controlado
 *   con `editorKey` incremental sin perder posición del cursor en cada pulsación.
 * - Usa manipulación determinista de `Range` DOM al insertar `@menciones` para evitar inconsistencias de
 *   `document.execCommand('insertHTML')` con custom elements `<bc-attachment contenteditable="false">`.
 * - El popover de `@menciones` se renderiza vía `createPortal(..., document.body)` con `position: fixed` y
 *   `zIndex: 9999` calculando coordenadas de viewport (`getBoundingClientRect`) e invirtiendo hacia arriba
 *   cerca del borde inferior para nunca ser recortado por modales `overflow-y-auto` / `overflow-hidden`.
 * - La barra Trix usa `relative z-20` sobre el área editable `relative z-10` para que `T▾` y `Color▾` floten siempre encima.
 */

'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Image,
  Paperclip,
  Bold,
  Italic,
  Strikethrough,
  Type,
  ChevronDown,
  Highlighter,
  Link,
  Quote,
  Code,
  List,
  ListOrdered,
  Table,
  AlignLeft,
  Mic,
  Undo2,
  Redo2,
  Trash2,
  Loader2,
  AtSign,
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { getSupabaseWithAuth } from '@/lib/supabase'
import { compressImage } from '@/lib/image-compression'
import { normalizePersonName, isMaskedOrEmptyEmail } from '@/lib/basecamp-person-resolver'
import {
  hydrateBasecampHtmlForEditor,
  hasRichContentOrMedia,
  proxyBasecampUrl,
  BASECAMP_IMAGE_HOVER_CSS,
} from '@/lib/basecamp-html'

export interface BasecampPersonOption {
  id: string
  bc_id?: number | string | null
  name: string
  email?: string | null
  title?: string | null
  role?: string | null
  avatar?: string | null
  avatar_url?: string | null
  attachable_sgid?: string | null
}

export interface BasecampRichEditorProps {
  initialHtml?: string | null
  editorKey?: string | number
  focusSeq?: number
  onChangeHtml?: (html: string, isEmpty: boolean) => void
  people?: BasecampPersonOption[]
  placeholder?: string
  minHeight?: number
  maxHeight?: number
  compact?: boolean
  autoFocus?: boolean
  disabled?: boolean
  onSubmitShortcut?: () => void
  uploadFolder?: string
  className?: string
}

const AVATAR_PALETTE = [
  '#1D7DB5',
  '#0D9488',
  '#7C3AED',
  '#DB2777',
  '#EA580C',
  '#2563EB',
  '#059669',
  '#9333EA',
]

function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]
}

function getInitials(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function stripAccentsLower(raw?: string | null): string {
  if (!raw) return ''
  return String(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeHtmlText(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeHtmlAttr(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function plainTextToHtml(raw: string): string {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return ''
  return escapeHtmlText(trimmed).replace(/\r?\n/g, '<br>')
}

function isInsideNonEditableMention(node: Node | null, root: HTMLElement): HTMLElement | null {
  let cur: Node | null = node
  while (cur && cur !== root) {
    if (cur instanceof HTMLElement) {
      if (
        cur.getAttribute('contenteditable') === 'false' ||
        cur.classList.contains('bc-mention-pill') ||
        cur.tagName.toLowerCase() === 'bc-attachment'
      ) {
        return cur
      }
    }
    cur = cur.parentNode
  }
  return null
}

interface ActiveMentionContext {
  query: string
  textNode: Text
  atOffset: number
  caretOffset: number
  anchorKey: string
  rect: DOMRect | null
}

function detectActiveMentionBeforeCaret(editor: HTMLElement): ActiveMentionContext | null {
  if (typeof window === 'undefined') return null
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null

  const range = sel.getRangeAt(0)
  let node: Node | null = range.startContainer
  let offset: number = range.startOffset

  if (!editor.contains(node)) return null
  if (isInsideNonEditableMention(node, editor)) return null

  // If selection is on an element node right after a text node, inspect that preceding text node
  if (node.nodeType === Node.ELEMENT_NODE && offset > 0) {
    const prevChild = node.childNodes[offset - 1]
    if (prevChild && prevChild.nodeType === Node.TEXT_NODE) {
      node = prevChild
      offset = (prevChild.nodeValue || '').length
    }
  }

  if (!node || node.nodeType !== Node.TEXT_NODE) return null
  const textNode = node as Text
  const beforeCaret = (textNode.nodeValue || '').slice(0, offset).replace(/\u00a0/g, ' ')

  // Match `@` preceded by start-of-node or delimiter, followed by 0..35 chars (no leading space after `@`)
  const match = beforeCaret.match(/(?:^|[\s([{,;:¡¿"'])@((?:|[^\s\n\r@<>][^\n\r@<>]{0,34}))$/)
  if (!match) return null

  const query = match[1] || ''
  const atOffset = offset - query.length - 1
  if (atOffset < 0) return null

  let rect: DOMRect | null = null
  try {
    const atRange = document.createRange()
    atRange.setStart(textNode, atOffset)
    atRange.setEnd(textNode, offset)
    rect = atRange.getBoundingClientRect()
  } catch {
    rect = null
  }

  return {
    query,
    textNode,
    atOffset,
    caretOffset: offset,
    anchorKey: `${atOffset}:${(textNode.nodeValue || '').slice(0, Math.max(1, atOffset))}`,
    rect,
  }
}

export function BasecampRichEditor({
  initialHtml = '',
  editorKey,
  focusSeq,
  onChangeHtml,
  people = [],
  placeholder,
  minHeight,
  maxHeight = 360,
  compact = false,
  autoFocus = false,
  disabled = false,
  onSubmitShortcut,
  uploadFolder = 'todos',
  className = '',
}: BasecampRichEditorProps) {
  const { t, language } = useLanguage()
  const supabase = useMemo(() => getSupabaseWithAuth(), [])

  const wrapperRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const textSizeMenuRef = useRef<HTMLDivElement>(null)
  const colorMenuRef = useRef<HTMLDivElement>(null)
  const mentionListRef = useRef<HTMLDivElement>(null)

  const savedSelectionRef = useRef<Range | null>(null)
  const activeMentionRef = useRef<ActiveMentionContext | null>(null)
  const dismissedMentionAnchorRef = useRef<string | null>(null)

  const editorHistoryRef = useRef<string[]>([''])
  const editorHistoryIdxRef = useRef<number>(0)
  const editorIsUndoingRef = useRef<boolean>(false)

  const prevEditorKeyRef = useRef<string | number | undefined>(editorKey)
  const prevInitialHtmlPropRef = useRef<string | null | undefined>(initialHtml)
  const lastEmittedHtmlRef = useRef<string>('')
  const hasUserEditedRef = useRef<boolean>(false)
  const mountedOnceRef = useRef<boolean>(false)
  const alignStepRef = useRef<'left' | 'center' | 'right'>('left')
  const recognitionRef = useRef<any>(null)

  const [isEmpty, setIsEmpty] = useState<boolean>(() => !hasRichContentOrMedia(initialHtml || ''))
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDictating, setIsDictating] = useState(false)

  // Toolbar sub-menus & inline bars
  const [showTextSizeMenu, setShowTextSizeMenu] = useState(false)
  const [textSizeMenuOffsetX, setTextSizeMenuOffsetX] = useState(0)
  const [showColorMenu, setShowColorMenu] = useState(false)
  const [colorMenuOffsetX, setColorMenuOffsetX] = useState(0)
  const [showMobileMoreTools, setShowMobileMoreTools] = useState(false)

  const computeToolbarMenuOffsetX = useCallback((btnEl: HTMLElement, menuWidth: number): number => {
    if (typeof window === 'undefined') return 0
    const btnRect = btnEl.getBoundingClientRect()
    const clipEl = btnEl.closest('.overflow-hidden, .overflow-y-auto') as HTMLElement | null
    const vw = window.innerWidth || 1024
    const leftLimit = clipEl ? Math.max(0, clipEl.getBoundingClientRect().left) : 0
    const rightLimit = clipEl ? Math.min(vw, clipEl.getBoundingClientRect().right) : vw
    const effW = Math.min(menuWidth, Math.max(140, rightLimit - leftLimit - 16))
    let offsetX = 0
    if (btnRect.left + effW > rightLimit - 10) {
      offsetX = rightLimit - 10 - (btnRect.left + effW)
    }
    if (btnRect.left + offsetX < leftLimit + 10) {
      offsetX = leftLimit + 10 - btnRect.left
    }
    return Math.round(offsetX)
  }, [])
  const [showLinkBar, setShowLinkBar] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkText, setLinkText] = useState('')
  const [showTableControls, setShowTableControls] = useState(false)
  const [tableRows, setTableRows] = useState(3)
  const [tableCols, setTableCols] = useState(3)

  // @Mentions floating menu state (viewport-fixed via Portal)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionHighlightIdx, setMentionHighlightIdx] = useState(0)
  const [mentionCoords, setMentionCoords] = useState<{
    top?: number
    bottom?: number
    left: number
    maxHeight: number
  }>({ top: 42, left: 12, maxHeight: 224 })

  // Deduplicated & normalized people directory
  const uniquePeople = useMemo(() => {
    if (!Array.isArray(people) || people.length === 0) return []
    const seenIds = new Set<string>()
    const seenNames = new Set<string>()
    const list: BasecampPersonOption[] = []

    for (const raw of people) {
      if (!raw || !raw.id || !raw.name) continue
      const idStr = String(raw.id)
      if (seenIds.has(idStr)) continue
      const nameKey = normalizePersonName(raw.name)
      if (nameKey && seenNames.has(nameKey)) {
        // Prefer record that has attachable_sgid if duplicate exists
        const existingIdx = list.findIndex((x) => normalizePersonName(x.name) === nameKey)
        if (existingIdx >= 0 && !list[existingIdx].attachable_sgid && raw.attachable_sgid) {
          list[existingIdx] = raw
          seenIds.add(idStr)
        }
        continue
      }
      seenIds.add(idStr)
      if (nameKey) seenNames.add(nameKey)
      list.push(raw)
    }

    return list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
  }, [people])

  const filteredMentionPeople = useMemo(() => {
    if (uniquePeople.length === 0) return []
    const trimmed = mentionQuery.trim()
    if (!trimmed) return uniquePeople.slice(0, 40)

    const rawQuery = stripAccentsLower(trimmed)
    const fuzzyQuery = normalizePersonName(trimmed)

    const scored: Array<{ person: BasecampPersonOption; score: number }> = []
    for (const p of uniquePeople) {
      const rawName = stripAccentsLower(p.name)
      const fuzzyName = normalizePersonName(p.name)
      const rawTitle = stripAccentsLower(p.title || p.role || '')
      const cleanEmail = isMaskedOrEmptyEmail(p.email) ? '' : stripAccentsLower(p.email)

      let score = 99
      if (
        (rawQuery && rawName.startsWith(rawQuery)) ||
        (fuzzyQuery && fuzzyName.startsWith(fuzzyQuery))
      ) {
        score = 0
      } else if (
        (rawQuery && rawName.split(' ').some((tok) => tok.startsWith(rawQuery))) ||
        (fuzzyQuery && fuzzyName.split(' ').some((tok) => tok.startsWith(fuzzyQuery)))
      ) {
        score = 1
      } else if (
        (rawQuery && rawName.includes(rawQuery)) ||
        (fuzzyQuery && fuzzyName.includes(fuzzyQuery))
      ) {
        score = 2
      } else if (
        (rawQuery && (rawTitle.includes(rawQuery) || cleanEmail.includes(rawQuery))) ||
        (fuzzyQuery && (rawTitle.includes(fuzzyQuery) || cleanEmail.includes(fuzzyQuery)))
      ) {
        score = 3
      }

      if (score < 99) {
        scored.push({ person: p, score })
      }
    }

    scored.sort((a, b) => a.score - b.score || String(a.person.name).localeCompare(String(b.person.name), 'es'))
    return scored.slice(0, 30).map((s) => s.person)
  }, [uniquePeople, mentionQuery])

  // Close toolbar dropdowns & mention menu when clicking outside
  useEffect(() => {
    const handleOutsideMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (textSizeMenuRef.current && !textSizeMenuRef.current.contains(target)) {
        setShowTextSizeMenu(false)
      }
      if (colorMenuRef.current && !colorMenuRef.current.contains(target)) {
        setShowColorMenu(false)
      }
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(target) &&
        (!mentionListRef.current || !mentionListRef.current.contains(target))
      ) {
        setMentionOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleOutsideMouseDown)
    }
  }, [])

  // Stop speech recognition on unmount
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop?.()
      } catch {
        // ignore
      }
    }
  }, [])

  // Scroll highlighted mention option into view
  useEffect(() => {
    if (!mentionOpen || !mentionListRef.current) return
    const activeItem = mentionListRef.current.querySelector(
      `[data-mention-idx="${mentionHighlightIdx}"]`
    ) as HTMLElement | null
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest' })
    }
  }, [mentionOpen, mentionHighlightIdx])

  const emitCurrentHtml = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const rawHtml = editor.innerHTML || ''
    const empty = !hasRichContentOrMedia(rawHtml)
    const normalizedOut = empty ? '' : rawHtml
    setIsEmpty((prev) => (prev === empty ? prev : empty))
    lastEmittedHtmlRef.current = normalizedOut
    onChangeHtml?.(normalizedOut, empty)
  }, [onChangeHtml])

  // Hydrate initialHtml on mount, when editorKey changes, or when controlled initialHtml resets externally
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const keyChanged = editorKey !== prevEditorKeyRef.current
    const propChanged = initialHtml !== prevInitialHtmlPropRef.current
    const incomingRaw = initialHtml || ''

    prevEditorKeyRef.current = editorKey
    prevInitialHtmlPropRef.current = initialHtml

    const shouldHydrate =
      !mountedOnceRef.current ||
      keyChanged ||
      (propChanged && incomingRaw !== lastEmittedHtmlRef.current)

    if (!shouldHydrate) return

    const wasInitialMount = !mountedOnceRef.current
    mountedOnceRef.current = true
    hasUserEditedRef.current = false

    const hydrated = hydrateBasecampHtmlForEditor(incomingRaw, uniquePeople)
    editor.innerHTML = hydrated
    const empty = !hasRichContentOrMedia(hydrated)
    const normalizedOut = empty ? '' : hydrated

    setIsEmpty(empty)
    lastEmittedHtmlRef.current = normalizedOut
    editorHistoryRef.current = [hydrated]
    editorHistoryIdxRef.current = 0
    savedSelectionRef.current = null
    activeMentionRef.current = null
    dismissedMentionAnchorRef.current = null

    if (keyChanged) {
      setShowLinkBar(false)
      setLinkUrl('')
      setLinkText('')
      setShowTableControls(false)
      setShowTextSizeMenu(false)
      setShowColorMenu(false)
      setMentionOpen(false)
      setUploadError(null)
    }

    onChangeHtml?.(normalizedOut, empty)

    if ((wasInitialMount || keyChanged) && autoFocus && !disabled) {
      requestAnimationFrame(() => {
        const el = editorRef.current
        if (!el) return
        el.focus()
        try {
          const range = document.createRange()
          range.selectNodeContents(el)
          range.collapse(false)
          const sel = window.getSelection()
          sel?.removeAllRanges()
          sel?.addRange(range)
        } catch {
          // ignore
        }
      })
    }
  }, [initialHtml, editorKey, uniquePeople, autoFocus, disabled, onChangeHtml])

  // Programmatic focus + caret-at-end trigger (e.g. clicking "Reply" on a comment)
  useEffect(() => {
    if (!focusSeq || disabled) return
    requestAnimationFrame(() => {
      const el = editorRef.current
      if (!el) return
      el.focus()
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      try {
        const range = document.createRange()
        range.selectNodeContents(el)
        range.collapse(false)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
        savedSelectionRef.current = range.cloneRange()
      } catch {
        // ignore
      }
    })
  }, [focusSeq, disabled])

  // Enrich mention SGIDs/UUIDs if `people` finished loading right after mount before user typed
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || hasUserEditedRef.current || uniquePeople.length === 0) return
    const current = editor.innerHTML
    if (!current || (!current.includes('bc-attachment') && !current.includes('bc-mention-pill'))) return
    const rehydrated = hydrateBasecampHtmlForEditor(current, uniquePeople)
    if (rehydrated !== current) {
      editor.innerHTML = rehydrated
      lastEmittedHtmlRef.current = rehydrated
      editorHistoryRef.current = [rehydrated]
      editorHistoryIdxRef.current = 0
      onChangeHtml?.(rehydrated, !hasRichContentOrMedia(rehydrated))
    }
  }, [uniquePeople, onChangeHtml])

  const saveEditorSelection = useCallback(() => {
    const editor = editorRef.current
    if (!editor || typeof window === 'undefined') return
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      savedSelectionRef.current = sel.getRangeAt(0).cloneRange()
    }
  }, [])

  const restoreEditorSelection = useCallback(() => {
    const editor = editorRef.current
    if (!editor || typeof window === 'undefined') return
    editor.focus()
    if (savedSelectionRef.current && editor.contains(savedSelectionRef.current.startContainer)) {
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(savedSelectionRef.current)
    }
  }, [])

  const editorSaveSnapshot = useCallback(() => {
    if (editorIsUndoingRef.current) return
    const html = editorRef.current?.innerHTML || ''
    const history = editorHistoryRef.current
    const idx = editorHistoryIdxRef.current
    if (history[idx] === html) return
    editorHistoryRef.current = history.slice(0, idx + 1)
    editorHistoryRef.current.push(html)
    if (editorHistoryRef.current.length > 100) editorHistoryRef.current.shift()
    editorHistoryIdxRef.current = editorHistoryRef.current.length - 1
  }, [])

  const updateMentionTriggerFromCaret = useCallback(() => {
    const editor = editorRef.current
    const wrapper = wrapperRef.current
    if (!editor || !wrapper || disabled || uniquePeople.length === 0) {
      setMentionOpen(false)
      activeMentionRef.current = null
      return
    }

    const ctx = detectActiveMentionBeforeCaret(editor)
    if (!ctx) {
      setMentionOpen(false)
      activeMentionRef.current = null
      dismissedMentionAnchorRef.current = null
      return
    }

    if (dismissedMentionAnchorRef.current === ctx.anchorKey) {
      setMentionOpen(false)
      activeMentionRef.current = null
      return
    }

    activeMentionRef.current = ctx
    const editorRect = editor.getBoundingClientRect()
    const hasCaretRect = Boolean(ctx.rect && (ctx.rect.width > 0 || ctx.rect.height > 0))
    const anchorTop = hasCaretRect && ctx.rect ? ctx.rect.top : editorRect.top + (compact ? 8 : 10)
    const anchorBottom = hasCaretRect && ctx.rect ? ctx.rect.bottom : editorRect.top + (compact ? 30 : 34)
    const anchorLeft = hasCaretRect && ctx.rect ? ctx.rect.left : editorRect.left + 12

    const vw = typeof window !== 'undefined' ? window.innerWidth || 1024 : 1024
    const vh = typeof window !== 'undefined' ? window.innerHeight || 768 : 768
    const MENU_W = 280
    const MENU_MAX_H = 224
    const PAD = 10
    const GAP = 6

    const effectiveW = Math.min(MENU_W, Math.max(180, vw - PAD * 2))
    const left = Math.min(Math.max(PAD, anchorLeft), Math.max(PAD, vw - effectiveW - PAD))

    const spaceBelow = vh - anchorBottom - PAD
    const spaceAbove = anchorTop - PAD
    const shouldFlipUp = spaceBelow < MENU_MAX_H + GAP && spaceAbove > spaceBelow

    if (shouldFlipUp) {
      setMentionCoords({
        top: undefined,
        bottom: Math.max(PAD, vh - anchorTop + GAP),
        left,
        maxHeight: Math.min(MENU_MAX_H, Math.max(120, spaceAbove - GAP)),
      })
    } else {
      setMentionCoords({
        top: Math.max(PAD, anchorBottom + GAP),
        bottom: undefined,
        left,
        maxHeight: Math.min(MENU_MAX_H, Math.max(120, spaceBelow - GAP)),
      })
    }

    setMentionQuery((prev) => {
      if (prev !== ctx.query) {
        setMentionHighlightIdx(0)
      }
      return ctx.query
    })
    setMentionOpen(true)
  }, [compact, disabled, uniquePeople.length])

  // Keep fixed @mention portal aligned when scrolling a modal/page or resizing viewport
  useEffect(() => {
    if (!mentionOpen) return
    const handleViewportChange = (ev: Event) => {
      if (mentionListRef.current && ev.target instanceof Node && mentionListRef.current.contains(ev.target)) {
        return
      }
      updateMentionTriggerFromCaret()
    }
    window.addEventListener('scroll', handleViewportChange, true)
    window.addEventListener('resize', handleViewportChange)
    return () => {
      window.removeEventListener('scroll', handleViewportChange, true)
      window.removeEventListener('resize', handleViewportChange)
    }
  }, [mentionOpen, updateMentionTriggerFromCaret])

  const insertMentionPerson = useCallback(
    (person: BasecampPersonOption) => {
      const editor = editorRef.current
      if (!editor || disabled) return

      hasUserEditedRef.current = true
      const ctx = activeMentionRef.current || detectActiveMentionBeforeCaret(editor)

      const safeName = escapeHtmlText(person.name)
      const safeId = escapeHtmlAttr(person.id)
      const mentionTagHtml = person.attachable_sgid
        ? `<bc-attachment sgid="${escapeHtmlAttr(person.attachable_sgid)}" content-type="application/vnd.basecamp.mention" data-teg-mention-person-id="${safeId}" class="bc-mention-pill" contenteditable="false">@${safeName}</bc-attachment>`
        : `<span data-teg-mention-person-id="${safeId}" class="bc-mention-pill" contenteditable="false">@${safeName}</span>`

      const temp = document.createElement('span')
      temp.innerHTML = mentionTagHtml
      const mentionNode = temp.firstElementChild

      if (ctx && editor.contains(ctx.textNode) && mentionNode) {
        try {
          const replaceRange = document.createRange()
          const maxLen = (ctx.textNode.nodeValue || '').length
          const start = Math.min(ctx.atOffset, maxLen)
          const end = Math.min(ctx.caretOffset, maxLen)
          replaceRange.setStart(ctx.textNode, start)
          replaceRange.setEnd(ctx.textNode, end)
          replaceRange.deleteContents()

          const nbspNode = document.createTextNode('\u00A0')
          replaceRange.insertNode(nbspNode)
          nbspNode.parentNode?.insertBefore(mentionNode, nbspNode)

          const caretRange = document.createRange()
          caretRange.setStart(nbspNode, 1)
          caretRange.collapse(true)

          editor.focus()
          const sel = window.getSelection()
          sel?.removeAllRanges()
          sel?.addRange(caretRange)
          savedSelectionRef.current = caretRange.cloneRange()
        } catch {
          editor.insertAdjacentHTML('beforeend', `${mentionTagHtml}&nbsp;`)
        }
      } else {
        restoreEditorSelection()
        const ok = document.execCommand('insertHTML', false, `${mentionTagHtml}&nbsp;`)
        if (!ok) {
          editor.insertAdjacentHTML('beforeend', `${mentionTagHtml}&nbsp;`)
        }
        saveEditorSelection()
      }

      activeMentionRef.current = null
      dismissedMentionAnchorRef.current = null
      setMentionOpen(false)
      setMentionQuery('')
      setMentionHighlightIdx(0)
      editorSaveSnapshot()
      emitCurrentHtml()
    },
    [disabled, editorSaveSnapshot, emitCurrentHtml, restoreEditorSelection, saveEditorSelection]
  )

  const triggerToolbarMention = () => {
    if (disabled) return
    const editor = editorRef.current
    if (!editor) return
    hasUserEditedRef.current = true
    restoreEditorSelection()

    // Check if cursor already sits right after `@`
    const existing = detectActiveMentionBeforeCaret(editor)
    if (existing) {
      dismissedMentionAnchorRef.current = null
      updateMentionTriggerFromCaret()
      return
    }

    const sel = window.getSelection()
    let needsLeadingSpace = false
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      const n = sel.anchorNode
      const off = sel.anchorOffset
      if (n && n.nodeType === Node.TEXT_NODE && off > 0) {
        const ch = (n.nodeValue || '')[off - 1]
        if (ch && !/[\s\u00a0([{]/.test(ch)) {
          needsLeadingSpace = true
        }
      }
    }

    const prefix = needsLeadingSpace ? ' @' : '@'
    const ok = document.execCommand('insertText', false, prefix)
    if (!ok) {
      const textNode = document.createTextNode(prefix)
      editor.appendChild(textNode)
      const range = document.createRange()
      range.setStart(textNode, prefix.length)
      range.collapse(true)
      sel?.removeAllRanges()
      sel?.addRange(range)
    }

    dismissedMentionAnchorRef.current = null
    saveEditorSelection()
    editorSaveSnapshot()
    emitCurrentHtml()
    updateMentionTriggerFromCaret()
  }

  const editorUndo = () => {
    if (disabled) return
    const history = editorHistoryRef.current
    const idx = editorHistoryIdxRef.current
    if (idx <= 0) return
    editorIsUndoingRef.current = true
    editorHistoryIdxRef.current = idx - 1
    const editor = editorRef.current
    if (editor) editor.innerHTML = history[idx - 1]
    editorIsUndoingRef.current = false
    setMentionOpen(false)
    emitCurrentHtml()
    editor?.focus()
  }

  const editorRedo = () => {
    if (disabled) return
    const history = editorHistoryRef.current
    const idx = editorHistoryIdxRef.current
    if (idx >= history.length - 1) return
    editorIsUndoingRef.current = true
    editorHistoryIdxRef.current = idx + 1
    const editor = editorRef.current
    if (editor) editor.innerHTML = history[idx + 1]
    editorIsUndoingRef.current = false
    setMentionOpen(false)
    emitCurrentHtml()
    editor?.focus()
  }

  const execCmd = (command: string, value?: string) => {
    if (disabled) return
    hasUserEditedRef.current = true
    restoreEditorSelection()
    document.execCommand(command, false, value || '')
    saveEditorSelection()
    editorSaveSnapshot()
    emitCurrentHtml()
  }

  const insertHtmlSnippet = useCallback(
    (htmlSnippet: string) => {
      const editor = editorRef.current
      if (!editor || disabled) return
      hasUserEditedRef.current = true
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
      editorSaveSnapshot()
      emitCurrentHtml()
    },
    [disabled, editorSaveSnapshot, emitCurrentHtml, restoreEditorSelection, saveEditorSelection]
  )

  // ── Link controls ──
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
    if (disabled) return
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
    insertHtmlSnippet(
      `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" style="color: #1D7DB5; text-decoration: underline;">${safeLabel}</a>&nbsp;`
    )
    setShowLinkBar(false)
    setLinkUrl('')
    setLinkText('')
    savedSelectionRef.current = null
  }

  const editorUnlink = () => {
    if (disabled) return
    hasUserEditedRef.current = true
    restoreEditorSelection()
    document.execCommand('unlink')
    editorSaveSnapshot()
    emitCurrentHtml()
    setShowLinkBar(false)
    setLinkUrl('')
    setLinkText('')
  }

  // ── Dynamic Table controls ──
  const buildTableHtml = (rows: number, cols: number) => {
    let html = '<table data-editor-table="true" style="border-collapse: collapse; width: 100%; margin: 8px 0;">'
    for (let r = 0; r < rows; r++) {
      html += '<tr>'
      for (let c = 0; c < cols; c++) {
        const bg = r % 2 === 0 ? '#ffffff' : '#F7F7F5'
        html += `<td style="border: 1px solid #CBD5E1; padding: 6px 8px; min-width: 40px; background: ${bg};">&nbsp;</td>`
      }
      html += '</tr>'
    }
    html += '</table><p><br></p>'
    return html
  }

  const editorInsertTable = () => {
    if (disabled) return
    if (showTableControls) {
      setShowTableControls(false)
      return
    }
    const rows = 3
    const cols = 3
    setTableRows(rows)
    setTableCols(cols)
    insertHtmlSnippet(buildTableHtml(rows, cols))
    setShowTableControls(true)
  }

  const editorUpdateTable = (newRows: number, newCols: number) => {
    const editor = editorRef.current
    if (!editor || disabled) return
    hasUserEditedRef.current = true
    const table = editor.querySelector('table[data-editor-table]') || editor.querySelector('table')
    if (table) {
      table.outerHTML = buildTableHtml(newRows, newCols).replace('<p><br></p>', '')
    } else {
      insertHtmlSnippet(buildTableHtml(newRows, newCols))
    }
    setTableRows(newRows)
    setTableCols(newCols)
    editorSaveSnapshot()
    emitCurrentHtml()
  }

  const editorRemoveTable = () => {
    const editor = editorRef.current
    if (!editor || disabled) return
    hasUserEditedRef.current = true
    const table = editor.querySelector('table[data-editor-table]') || editor.querySelector('table')
    if (table) table.remove()
    setShowTableControls(false)
    setTableRows(3)
    setTableCols(3)
    editorSaveSnapshot()
    emitCurrentHtml()
  }

  const editorInsertCode = () => {
    if (disabled) return
    restoreEditorSelection()
    const sel = window.getSelection()
    const selectedText = sel && editorRef.current?.contains(sel.anchorNode) ? sel.toString() : ''
    const safeCode = plainTextToHtml(selectedText || 'code')
    insertHtmlSnippet(
      `<pre style="background: #F4F4F5; padding: 8px 12px; border-radius: 6px; font-family: monospace; font-size: 13px; overflow-x: auto; border: 1px solid #E4E4E7;"><code>${safeCode}</code></pre><p><br></p>`
    )
  }

  const editorInsertQuote = () => {
    if (disabled) return
    restoreEditorSelection()
    const sel = window.getSelection()
    const selectedText = sel && editorRef.current?.contains(sel.anchorNode) ? sel.toString() : ''
    const safeQuote = plainTextToHtml(selectedText || '...')
    insertHtmlSnippet(
      `<blockquote style="border-left: 3px solid #CBD5E1; padding-left: 12px; margin: 8px 0; color: #475569; font-style: italic;">${safeQuote}</blockquote><p><br></p>`
    )
  }

  const editorCycleAlign = () => {
    if (disabled) return
    const next =
      alignStepRef.current === 'left'
        ? 'center'
        : alignStepRef.current === 'center'
        ? 'right'
        : 'left'
    alignStepRef.current = next
    const cmd = next === 'center' ? 'justifyCenter' : next === 'right' ? 'justifyRight' : 'justifyLeft'
    execCmd(cmd)
  }

  const editorDictateSpeech = () => {
    if (typeof window === 'undefined' || disabled) return
    if (isDictating && recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {
        // ignore
      }
      setIsDictating(false)
      return
    }
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return
    try {
      const recognition = new SpeechRecognition()
      recognitionRef.current = recognition
      recognition.lang = language === 'es' ? 'es-MX' : 'en-US'
      recognition.onstart = () => setIsDictating(true)
      recognition.onend = () => setIsDictating(false)
      recognition.onerror = () => setIsDictating(false)
      recognition.onresult = (event: any) => {
        const transcript = event?.results?.[0]?.[0]?.transcript
        if (transcript) {
          insertHtmlSnippet(`${plainTextToHtml(transcript)} `)
        }
      }
      recognition.start()
    } catch {
      setIsDictating(false)
    }
  }

  // ── Upload Photo / Attachment via /api/basecamp/upload + Supabase Storage fallback ──
  const uploadSingleFile = async (
    file: File
  ): Promise<{ url: string; filename: string; contentType: string; size: number } | null> => {
    const MAX_BYTES = 25 * 1024 * 1024
    if (file.size > MAX_BYTES) {
      setUploadError(t('basecamp.file_too_large_25mb'))
      return null
    }

    let fileToUpload = file
    if (file.type.startsWith('image/') && !/gif|svg/i.test(file.type)) {
      fileToUpload = await compressImage(file)
    }

    const cleanFolder = String(uploadFolder || 'todos').replace(/[^a-zA-Z0-9_-]/g, '') || 'todos'
    const uploadFilename =
      file.name ||
      fileToUpload.name ||
      (file.type.startsWith('image/') ? `screenshot-${Date.now()}.png` : `attachment-${Date.now()}`)

    // Primary: /api/basecamp/upload (`teg_token` Bearer + httpOnly cookie)
    try {
      const fd = new FormData()
      fd.append('file', fileToUpload, uploadFilename)
      fd.append('folder', cleanFolder)

      const token = typeof window !== 'undefined' ? window.localStorage?.getItem('teg_token') : null
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
      console.warn('⚠️ [BasecampRichEditor] Server upload fallback triggered:', srvErr?.message || srvErr)
    }

    // Fallback: direct Supabase Storage `checklist-photos`
    const rawExt = (fileToUpload.name || file.name).split('.').pop() || 'bin'
    const safeExt = rawExt.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'bin'
    const filePath = `basecamp-uploads/${cleanFolder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`

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
      filename: uploadFilename,
      contentType: fileToUpload.type || file.type || 'application/octet-stream',
      size: fileToUpload.size,
    }
  }

  const buildAttachmentEditorHtml = (uploaded: {
    url: string
    filename: string
    contentType: string
    size: number
  }) => {
    const safeUrl = escapeHtmlAttr(uploaded.url)
    const safeName = escapeHtmlAttr(uploaded.filename)
    const safeMime = escapeHtmlAttr(uploaded.contentType)
    const isImg =
      uploaded.contentType.toLowerCase().startsWith('image/') ||
      /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(uploaded.filename)

    if (isImg) {
      return `<div style="margin: 8px 0;"><img src="${safeUrl}" alt="${safeName}" style="max-width: 100%; max-height: 320px; height: auto; border-radius: 6px; border: 1px solid #E2E8F0;" /></div><p><br></p>`
    }

    const sizeLabel =
      uploaded.size >= 1024 * 1024
        ? `${(uploaded.size / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.max(1, Math.round(uploaded.size / 1024))} KB`

    return `<bc-attachment content-type="${safeMime}" filename="${safeName}" url="${safeUrl}" href="${safeUrl}" data-teg-attachment="true"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" contenteditable="false" style="display: inline-flex; align-items: center; gap: 6px; margin: 4px 0; padding: 6px 12px; border-radius: 6px; background: #F1F5F9; border: 1px solid #CBD5E1; color: #1D7DB5; text-decoration: none; font-size: 13px; font-weight: 600;">📎 ${safeName} <span style="color: #64748B; font-weight: 500; font-size: 11px;">(${sizeLabel})</span></a></bc-attachment><p><br></p>`
  }

  const uploadAndInsertFiles = async (files: File[]) => {
    if (!files || files.length === 0 || disabled) return
    setUploadingAttachment(true)
    setUploadError(null)
    try {
      for (const file of files) {
        const uploaded = await uploadSingleFile(file)
        if (uploaded) {
          insertHtmlSnippet(buildAttachmentEditorHtml(uploaded))
        }
      }
    } catch (err: any) {
      console.error('❌ [BasecampRichEditor] Upload error:', err?.message || err)
      setUploadError(t('basecamp.file_upload_error'))
    } finally {
      setUploadingAttachment(false)
    }
  }

  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const items = Array.from(e.clipboardData?.items || [])
    const pastedFiles: File[] = []
    for (const item of items) {
      if (item.kind === 'file') {
        const f = item.getAsFile()
        if (f) pastedFiles.push(f)
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault()
      saveEditorSelection()
      await uploadAndInsertFiles(pastedFiles)
      return
    }

    const htmlData = e.clipboardData?.getData('text/html') || ''
    const textData = (e.clipboardData?.getData('text/plain') || '').trim()
    if (!htmlData && /^https?:\/\/[^\s]+$/i.test(textData)) {
      e.preventDefault()
      saveEditorSelection()
      const safeHref = escapeHtmlAttr(textData)
      const safeLabel = plainTextToHtml(textData)
      insertHtmlSnippet(
        `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" style="color: #1D7DB5; text-decoration: underline;">${safeLabel}</a>&nbsp;`
      )
    }
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)
    if (disabled) return
    const droppedFiles = Array.from(e.dataTransfer?.files || [])
    if (droppedFiles.length > 0) {
      await uploadAndInsertFiles(droppedFiles)
    }
  }

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return

    // 1. @Mentions keyboard navigation
    if (mentionOpen) {
      if (e.key === 'ArrowDown') {
        if (filteredMentionPeople.length > 0) {
          e.preventDefault()
          e.stopPropagation()
          setMentionHighlightIdx((prev) => (prev + 1) % filteredMentionPeople.length)
          return
        }
      } else if (e.key === 'ArrowUp') {
        if (filteredMentionPeople.length > 0) {
          e.preventDefault()
          e.stopPropagation()
          setMentionHighlightIdx(
            (prev) => (prev - 1 + filteredMentionPeople.length) % filteredMentionPeople.length
          )
          return
        }
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredMentionPeople.length > 0) {
          e.preventDefault()
          e.stopPropagation()
          const target = filteredMentionPeople[mentionHighlightIdx] || filteredMentionPeople[0]
          if (target) insertMentionPerson(target)
          return
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (activeMentionRef.current) {
          dismissedMentionAnchorRef.current = activeMentionRef.current.anchorKey
        }
        setMentionOpen(false)
        return
      }
    }

    // 2. Clean Backspace deletion of adjacent atomic contenteditable="false" mention pills
    if (e.key === 'Backspace') {
      const editor = editorRef.current
      const sel = typeof window !== 'undefined' ? window.getSelection() : null
      if (editor && sel && sel.rangeCount > 0 && sel.isCollapsed) {
        const { anchorNode, anchorOffset } = sel
        let adjacentPill: Element | null = null
        if (anchorNode && anchorNode.nodeType === Node.TEXT_NODE && anchorOffset === 0) {
          const prev = anchorNode.previousSibling
          if (
            prev instanceof HTMLElement &&
            (prev.classList.contains('bc-mention-pill') || prev.getAttribute('contenteditable') === 'false')
          ) {
            adjacentPill = prev
          }
        } else if (anchorNode && anchorNode.nodeType === Node.ELEMENT_NODE && anchorOffset > 0) {
          const prev = anchorNode.childNodes[anchorOffset - 1]
          if (
            prev instanceof HTMLElement &&
            (prev.classList.contains('bc-mention-pill') || prev.getAttribute('contenteditable') === 'false')
          ) {
            adjacentPill = prev
          }
        }

        if (adjacentPill) {
          e.preventDefault()
          hasUserEditedRef.current = true
          adjacentPill.remove()
          saveEditorSelection()
          editorSaveSnapshot()
          emitCurrentHtml()
          return
        }
      }
    }

    // 3. Submit shortcut (Ctrl+Enter / Cmd+Enter)
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && onSubmitShortcut) {
      e.preventDefault()
      e.stopPropagation()
      onSubmitShortcut()
      return
    }

    // 4. Scoped Undo / Redo shortcuts
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) {
        editorRedo()
      } else {
        editorUndo()
      }
      return
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      editorRedo()
    }
  }

  const effectiveMinHeight = minHeight ?? (compact ? 88 : 132)
  const effectivePlaceholder = placeholder ?? t('basecamp.notes_placeholder')
  const iconSize = compact ? 13.5 : 14.5

  const toolbarBtnStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: compact ? 26 : 28,
    height: compact ? 26 : 28,
    borderRadius: 4,
    border: 'none',
    background: 'transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'background 0.12s',
  }

  const dividerStyle: React.CSSProperties = {
    width: 1,
    height: compact ? 14 : 16,
    background: '#E2E8F0',
    margin: compact ? '0 2px' : '0 4px',
    flexShrink: 0,
  }

  return (
    <div ref={wrapperRef} className={`relative w-full ${className}`}>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            ${BASECAMP_IMAGE_HOVER_CSS}
            .bc-trix-surface a { color: #1D7DB5; text-decoration: underline; font-weight: 600; }
            .bc-trix-surface img { max-width: 100%; height: auto; border-radius: 10px; margin: 8px 0; display: block; }
            .bc-trix-surface h1 { font-size: 1.28rem; font-weight: 800; margin: 6px 0; line-height: 1.3; }
            .bc-trix-surface h2 { font-size: 1.1rem; font-weight: 700; margin: 5px 0; line-height: 1.35; }
            .bc-trix-surface ul { padding-left: 22px; list-style-type: disc !important; margin: 6px 0; }
            .bc-trix-surface ol { padding-left: 22px; list-style-type: decimal !important; margin: 6px 0; }
            .bc-trix-surface li { display: list-item; margin: 3px 0; line-height: 1.6; }
            .bc-trix-surface li > p, .bc-trix-surface li > div { display: inline; margin: 0; }
            .bc-trix-surface blockquote { border-left: 3px solid #CBD5E1; padding-left: 12px; margin: 8px 0; color: #64748B; font-style: italic; }
            .bc-trix-surface table { border-collapse: collapse; width: 100%; margin: 8px 0; }
            .bc-trix-surface td, .bc-trix-surface th { border: 1px solid #CBD5E1; padding: 6px 8px; }
            @media (max-width: 639px) {
              .bc-toolbar-adv-hidden { display: none !important; }
            }
          `,
        }}
      />

      <div
        className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-700 shadow-xs transition-all focus-within:border-[#1D7DB5] focus-within:ring-2 focus-within:ring-[#1D7DB5]/15"
        style={{
          border: isDraggingOver ? '2px dashed #1D7DB5' : undefined,
          opacity: disabled ? 0.72 : 1,
        }}
      >
        {/* Basecamp 4 Responsive Toolbar */}
        <div
          className="relative z-20 bg-slate-50/90 dark:bg-slate-800/80 border-b border-slate-200/80 dark:border-slate-700 rounded-t-xl"
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 2,
            padding: compact ? '5px 8px' : '6px 10px',
          }}
        >
          {/* Group 1: Photo, Attachment, @Mention */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (disabled) return
              saveEditorSelection()
              fileInputRef.current?.click()
            }}
            disabled={disabled || uploadingAttachment}
            title={t('basecamp.attach_image_btn')}
            style={toolbarBtnStyle}
          >
            <Image size={iconSize} color="#475569" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (disabled) return
              saveEditorSelection()
              attachmentInputRef.current?.click()
            }}
            disabled={disabled || uploadingAttachment}
            title={t('basecamp.attach_file_btn')}
            style={toolbarBtnStyle}
          >
            <Paperclip size={iconSize} color="#475569" />
          </button>
          {uniquePeople.length > 0 && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={triggerToolbarMention}
              disabled={disabled}
              title={t('basecamp.type_at_to_mention')}
              style={{
                ...toolbarBtnStyle,
                background: mentionOpen ? '#DBEAFE' : 'transparent',
              }}
            >
              <AtSign size={iconSize} color={mentionOpen ? '#1D4ED8' : '#475569'} />
            </button>
          )}

          <span style={dividerStyle} />

          {/* Group 2: Bold, Italic, Strikethrough, Heading Size, Highlight, Link */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => execCmd('bold')}
            disabled={disabled}
            title={t('basecamp.editor_bold')}
            style={toolbarBtnStyle}
          >
            <Bold size={iconSize} color="#475569" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => execCmd('italic')}
            disabled={disabled}
            title={t('basecamp.editor_italic')}
            style={toolbarBtnStyle}
          >
            <Italic size={iconSize} color="#475569" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => execCmd('strikeThrough')}
            disabled={disabled}
            title={t('basecamp.editor_strikethrough')}
            className={showMobileMoreTools ? '' : 'bc-toolbar-adv-hidden'}
            style={toolbarBtnStyle}
          >
            <Strikethrough size={iconSize} color="#475569" />
          </button>

          {/* Text Size Dropdown */}
          <div ref={textSizeMenuRef} className={showMobileMoreTools ? '' : 'bc-toolbar-adv-hidden'} style={{ position: 'relative' }}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                if (disabled) return
                saveEditorSelection()
                setTextSizeMenuOffsetX(computeToolbarMenuOffsetX(e.currentTarget, 165))
                setShowTextSizeMenu((prev) => !prev)
                setShowColorMenu(false)
              }}
              disabled={disabled}
              title={t('basecamp.editor_text_size')}
              style={{
                ...toolbarBtnStyle,
                width: compact ? 33 : 36,
                gap: 1,
                background: showTextSizeMenu ? '#E2E8F0' : 'transparent',
              }}
            >
              <Type size={iconSize} color="#475569" />
              <ChevronDown size={10} color="#475569" />
            </button>
            {showTextSizeMenu && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: textSizeMenuOffsetX,
                  zIndex: 80,
                  background: '#ffffff',
                  border: '1px solid #CBD5E1',
                  borderRadius: 6,
                  boxShadow: '0 8px 20px rgba(0,0,0,0.14)',
                  minWidth: 165,
                  maxWidth: 'calc(100vw - 20px)',
                  padding: '4px 0',
                  marginTop: 3,
                }}
              >
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    execCmd('formatBlock', 'h1')
                    setShowTextSizeMenu(false)
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '7px 14px',
                    border: 'none',
                    background: 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: 16,
                    fontWeight: 700,
                    color: '#1E293B',
                  }}
                >
                  {t('basecamp.editor_heading_1')}
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    execCmd('formatBlock', 'h2')
                    setShowTextSizeMenu(false)
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '6px 14px',
                    border: 'none',
                    background: 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: 14.5,
                    fontWeight: 600,
                    color: '#1E293B',
                  }}
                >
                  {t('basecamp.editor_heading_2')}
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    execCmd('formatBlock', 'p')
                    setShowTextSizeMenu(false)
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '6px 14px',
                    border: 'none',
                    background: 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: '#1E293B',
                  }}
                >
                  {t('basecamp.editor_normal_text')}
                </button>
              </div>
            )}
          </div>

          {/* 6-Color Highlighter Dropdown */}
          <div ref={colorMenuRef} className={showMobileMoreTools ? '' : 'bc-toolbar-adv-hidden'} style={{ position: 'relative' }}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                if (disabled) return
                saveEditorSelection()
                setColorMenuOffsetX(computeToolbarMenuOffsetX(e.currentTarget, 176))
                setShowColorMenu((prev) => !prev)
                setShowTextSizeMenu(false)
              }}
              disabled={disabled}
              title={t('basecamp.editor_highlight_color')}
              style={{
                ...toolbarBtnStyle,
                width: compact ? 33 : 36,
                gap: 1,
                background: showColorMenu ? '#E2E8F0' : 'transparent',
              }}
            >
              <Highlighter size={iconSize} color="#475569" />
              <ChevronDown size={10} color="#475569" />
            </button>
            {showColorMenu && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: colorMenuOffsetX,
                  zIndex: 80,
                  background: '#ffffff',
                  border: '1px solid #CBD5E1',
                  borderRadius: 6,
                  boxShadow: '0 8px 20px rgba(0,0,0,0.14)',
                  padding: 8,
                  marginTop: 3,
                  display: 'flex',
                  gap: 5,
                  flexWrap: 'wrap',
                  width: 176,
                  maxWidth: 'calc(100vw - 20px)',
                }}
              >
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
                    onClick={() => {
                      execCmd('hiliteColor', c.color)
                      setShowColorMenu(false)
                    }}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 4,
                      border: '1px solid #CBD5E1',
                      background: c.color,
                      cursor: 'pointer',
                    }}
                  />
                ))}
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  title={t('basecamp.editor_clear_highlight')}
                  onClick={() => {
                    execCmd('removeFormat')
                    setShowColorMenu(false)
                  }}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    border: '1px solid #CBD5E1',
                    background: '#ffffff',
                    cursor: 'pointer',
                    fontSize: 11,
                    color: '#64748B',
                    fontWeight: 700,
                  }}
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
            disabled={disabled}
            title={t('basecamp.editor_link')}
            className={showMobileMoreTools ? '' : 'bc-toolbar-adv-hidden'}
            style={{
              ...toolbarBtnStyle,
              background: showLinkBar ? '#1D7DB5' : 'transparent',
            }}
          >
            <Link size={iconSize} color={showLinkBar ? '#ffffff' : '#475569'} />
          </button>

          <span className={showMobileMoreTools ? '' : 'bc-toolbar-adv-hidden'} style={dividerStyle} />

          {/* Group 3: Quote & Code */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={editorInsertQuote}
            disabled={disabled}
            title={t('basecamp.editor_quote')}
            className={showMobileMoreTools ? '' : 'bc-toolbar-adv-hidden'}
            style={toolbarBtnStyle}
          >
            <Quote size={iconSize} color="#475569" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={editorInsertCode}
            disabled={disabled}
            title={t('basecamp.editor_code')}
            className={showMobileMoreTools ? '' : 'bc-toolbar-adv-hidden'}
            style={toolbarBtnStyle}
          >
            <Code size={iconSize} color="#475569" />
          </button>

          <span className={showMobileMoreTools ? '' : 'bc-toolbar-adv-hidden'} style={dividerStyle} />

          {/* Group 4: Unordered & Ordered Lists */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => execCmd('insertUnorderedList')}
            disabled={disabled}
            title={t('basecamp.editor_bullet_list')}
            style={toolbarBtnStyle}
          >
            <List size={iconSize} color="#475569" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => execCmd('insertOrderedList')}
            disabled={disabled}
            title={t('basecamp.editor_numbered_list')}
            style={toolbarBtnStyle}
          >
            <ListOrdered size={iconSize} color="#475569" />
          </button>

          <span style={dividerStyle} />

          {/* Group 5: Table, Alignment, Voice Dictation */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={editorInsertTable}
            disabled={disabled}
            title={t('basecamp.editor_table')}
            className={showMobileMoreTools ? '' : 'bc-toolbar-adv-hidden'}
            style={{
              ...toolbarBtnStyle,
              background: showTableControls ? '#2C3E50' : 'transparent',
            }}
          >
            <Table size={iconSize} color={showTableControls ? '#ffffff' : '#475569'} />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={editorCycleAlign}
            disabled={disabled}
            title={t('basecamp.editor_align')}
            className={showMobileMoreTools ? '' : 'bc-toolbar-adv-hidden'}
            style={toolbarBtnStyle}
          >
            <AlignLeft size={iconSize} color="#475569" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={editorDictateSpeech}
            disabled={disabled}
            title={isDictating ? t('basecamp.dictating_active') : t('basecamp.editor_dictate')}
            style={{
              ...toolbarBtnStyle,
              background: isDictating ? '#FEE2E2' : 'transparent',
            }}
          >
            <Mic size={iconSize} color={isDictating ? '#DC2626' : '#475569'} />
          </button>

          {/* Right-aligned Mobile "Aa" toggle + Undo / Redo */}
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShowMobileMoreTools((v) => !v)}
            disabled={disabled}
            title={t('basecamp.editor_text_size')}
            className="sm:hidden inline-flex items-center justify-center px-2 h-7 rounded-md text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-slate-200/70 dark:bg-slate-700/80"
          >
            Aa{showMobileMoreTools ? ' −' : ' +'}
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={editorUndo}
            disabled={disabled}
            title={t('basecamp.editor_undo')}
            className={showMobileMoreTools ? '' : 'bc-toolbar-adv-hidden'}
            style={toolbarBtnStyle}
          >
            <Undo2 size={iconSize} color="#475569" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={editorRedo}
            disabled={disabled}
            title={t('basecamp.editor_redo')}
            className={showMobileMoreTools ? '' : 'bc-toolbar-adv-hidden'}
            style={toolbarBtnStyle}
          >
            <Redo2 size={iconSize} color="#475569" />
          </button>
        </div>

        {/* Upload in-progress banner */}
        {uploadingAttachment && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              background: '#EFF6FF',
              borderBottom: '1px solid #BFDBFE',
              fontSize: 12,
              color: '#1D4ED8',
              fontWeight: 600,
            }}
          >
            <Loader2 size={14} className="animate-spin" />
            <span>{t('basecamp.uploading_real_file')}</span>
          </div>
        )}

        {/* Inline Link Bar */}
        {showLinkBar && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 6,
              padding: '8px 10px',
              background: '#F8FAFC',
              borderBottom: '1px solid #E2E8F0',
            }}
          >
            <input
              type="text"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
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
              style={{
                flex: '1 1 190px',
                padding: '5px 9px',
                borderRadius: 5,
                border: '1px solid #CBD5E1',
                fontSize: 12.5,
                outline: 'none',
                color: '#1E293B',
                background: '#ffffff',
              }}
            />
            <input
              type="text"
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              onKeyDown={(e) => {
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
              style={{
                flex: '1 1 145px',
                padding: '5px 9px',
                borderRadius: 5,
                border: '1px solid #CBD5E1',
                fontSize: 12.5,
                outline: 'none',
                color: '#1E293B',
                background: '#ffffff',
              }}
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={editorApplyLink}
              style={{
                padding: '5px 12px',
                borderRadius: 5,
                border: 'none',
                background: '#1D7DB5',
                color: '#ffffff',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t('basecamp.apply_link_btn')}
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={editorUnlink}
              style={{
                padding: '5px 10px',
                borderRadius: 5,
                border: '1px solid #CBD5E1',
                background: '#ffffff',
                color: '#64748B',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t('basecamp.remove_link_btn')}
            </button>
          </div>
        )}

        {/* Inline Dark Table Controls */}
        {showTableControls && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '6px 12px',
              background: '#2C3E50',
              borderBottom: '1px solid #1E293B',
            }}
          >
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (tableRows > 1) editorUpdateTable(tableRows - 1, tableCols)
              }}
              style={{
                background: '#3D5166',
                border: 'none',
                color: '#ffffff',
                width: 24,
                height: 24,
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              −
            </button>
            <span style={{ color: '#ffffff', fontSize: 12, fontWeight: 600, minWidth: 54, textAlign: 'center' }}>
              {tableRows} {t('basecamp.editor_rows')}
            </span>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editorUpdateTable(tableRows + 1, tableCols)}
              style={{
                background: '#3D5166',
                border: 'none',
                color: '#ffffff',
                width: 24,
                height: 24,
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              +
            </button>
            <span style={{ width: 8 }} />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (tableCols > 1) editorUpdateTable(tableRows, tableCols - 1)
              }}
              style={{
                background: '#3D5166',
                border: 'none',
                color: '#ffffff',
                width: 24,
                height: 24,
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              −
            </button>
            <span style={{ color: '#ffffff', fontSize: 12, fontWeight: 600, minWidth: 72, textAlign: 'center' }}>
              {tableCols} {t('basecamp.editor_columns')}
            </span>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editorUpdateTable(tableRows, tableCols + 1)}
              style={{
                background: '#3D5166',
                border: 'none',
                color: '#ffffff',
                width: 24,
                height: 24,
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              +
            </button>
            <span style={{ width: 8 }} />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={editorRemoveTable}
              title={t('basecamp.editor_delete_table')}
              style={{
                background: '#EF4444',
                border: 'none',
                color: '#ffffff',
                width: 24,
                height: 24,
                borderRadius: 4,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}

        {/* Editable Surface + Drag & Drop Overlay */}
        <div
          className="relative z-10"
          onClick={() => {
            if (!disabled) editorRef.current?.focus()
          }}
          onDragOver={(e) => {
            if (disabled) return
            e.preventDefault()
            setIsDraggingOver(true)
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={handleDrop}
          style={{ position: 'relative', zIndex: 10, cursor: disabled ? 'not-allowed' : 'text' }}
        >
          {isEmpty && !isDraggingOver && (
            <div
              style={{
                position: 'absolute',
                top: compact ? 10 : 12,
                left: compact ? 12 : 14,
                right: compact ? 12 : 14,
                color: '#94A3B8',
                fontSize: compact ? 13.5 : 14,
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            >
              {effectivePlaceholder}
            </div>
          )}

          {isDraggingOver && (
            <div
              style={{
                position: 'absolute',
                inset: 6,
                borderRadius: 6,
                background: 'rgba(239, 246, 255, 0.94)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#1D7DB5',
                fontSize: 13.5,
                fontWeight: 700,
                pointerEvents: 'none',
                zIndex: 5,
              }}
            >
              {t('basecamp.drop_files_here')}
            </div>
          )}

          <div
            ref={editorRef}
            contentEditable={!disabled}
            suppressContentEditableWarning
            className="bc-rich-text bc-trix-surface text-[#1E293B] dark:text-slate-100"
            onInput={() => {
              hasUserEditedRef.current = true
              saveEditorSelection()
              editorSaveSnapshot()
              emitCurrentHtml()
              updateMentionTriggerFromCaret()
            }}
            onKeyDown={handleEditorKeyDown}
            onKeyUp={(e) => {
              saveEditorSelection()
              if (
                e.key !== 'ArrowDown' &&
                e.key !== 'ArrowUp' &&
                e.key !== 'Enter' &&
                e.key !== 'Escape' &&
                e.key !== 'Tab'
              ) {
                updateMentionTriggerFromCaret()
              }
            }}
            onMouseUp={() => {
              saveEditorSelection()
              updateMentionTriggerFromCaret()
            }}
            onPaste={handlePaste}
            style={{
              minHeight: effectiveMinHeight,
              maxHeight,
              overflowY: 'auto',
              padding: compact ? '10px 12px' : '12px 14px',
              fontSize: compact ? 13.5 : 14,
              lineHeight: 1.6,
              outline: 'none',
              wordBreak: 'break-word',
              borderBottomLeftRadius: 8,
              borderBottomRightRadius: 8,
            }}
          />
        </div>
      </div>

      {/* Floating @Mentions Autocomplete Popover (Portal to document.body to escape modal overflow) */}
      {mentionOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={mentionListRef}
            data-bc-mention-portal="true"
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 border border-[#CBD5E1] dark:border-slate-700"
            style={{
              position: 'fixed',
              top: mentionCoords.top !== undefined ? mentionCoords.top : 'auto',
              bottom: mentionCoords.bottom !== undefined ? mentionCoords.bottom : 'auto',
              left: mentionCoords.left,
              width: 280,
              maxWidth: 'calc(100vw - 20px)',
              maxHeight: mentionCoords.maxHeight,
              overflowY: 'auto',
              borderRadius: 8,
              boxShadow: '0 16px 36px rgba(15, 23, 42, 0.24)',
              zIndex: 9999,
              padding: '4px 0',
            }}
          >
          {filteredMentionPeople.length > 0 ? (
            filteredMentionPeople.map((person, idx) => {
              const active = idx === mentionHighlightIdx
              const rawAvatar = person.avatar || person.avatar_url || ''
              const safeAvatar = rawAvatar ? proxyBasecampUrl(rawAvatar) : ''
              const subtitle =
                person.title ||
                (!isMaskedOrEmptyEmail(person.email) ? person.email : '') ||
                ''

              return (
                <div
                  key={person.id}
                  data-mention-idx={idx}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setMentionHighlightIdx(idx)}
                  onClick={() => insertMentionPerson(person)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '7px 12px',
                    cursor: 'pointer',
                    background: active ? '#1D7DB5' : 'transparent',
                    color: active ? '#ffffff' : '#1E293B',
                  }}
                >
                  {safeAvatar ? (
                    <img
                      src={safeAvatar}
                      alt={person.name}
                      data-bc-avatar="true"
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        objectFit: 'cover',
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: getAvatarColor(person.name || 'U'),
                        color: '#ffffff',
                        fontSize: 10,
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {getInitials(person.name || 'U')}
                    </span>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      className={active ? 'text-white' : 'text-slate-800 dark:text-slate-100'}
                      style={{
                        fontSize: 13,
                        fontWeight: active ? 600 : 500,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {person.name}
                    </div>
                    {subtitle && (
                      <div
                        style={{
                          fontSize: 11,
                          color: active ? 'rgba(255,255,255,0.85)' : '#64748B',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {subtitle}
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          ) : (
            <div style={{ padding: '10px 12px', fontSize: 12.5, color: '#94A3B8', fontStyle: 'italic' }}>
              {t('basecamp.mention_no_matches')}
            </div>
          )}
          </div>,
          document.body
        )}

      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={async (e) => {
          const files = Array.from(e.target.files || [])
          e.target.value = ''
          await uploadAndInsertFiles(files)
        }}
        style={{ display: 'none' }}
      />
      <input
        ref={attachmentInputRef}
        type="file"
        accept="*/*"
        multiple
        onChange={async (e) => {
          const files = Array.from(e.target.files || [])
          e.target.value = ''
          await uploadAndInsertFiles(files)
        }}
        style={{ display: 'none' }}
      />

      {uploadError && (
        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#DC2626', fontWeight: 600 }}>
          {uploadError}
        </p>
      )}
    </div>
  )
}

export default BasecampRichEditor
