/**
 * @module lib/basecamp-api
 * @description Módulo central de integración con la API REST de Basecamp 3. Maneja autenticación OAuth2,
 *              renovación automática de tokens, rate limiting, paginación, reintentos con backoff exponencial,
 *              y todas las operaciones CRUD contra la API de Basecamp.
 *
 * @businessRules
 * - **Fuente de Verdad**: Supabase es la fuente de verdad del sistema. Basecamp actúa como proveedor
 *   externo de datos y como herramienta de comunicación. Los datos se sincronizan bidireccionalmente
 *   pero Supabase prevalece en caso de conflicto.
 * - **Token Management**: Se almacena un único par de tokens (access + refresh) en la tabla `bc_oauth_tokens`.
 *   El access_token se renueva automáticamente cuando expira, usando el refresh_token.
 * - **Rate Limiting**: Basecamp permite máximo 50 requests/10s por token (documentación dice 500/10s
 *   pero la práctica muestra que 50/10s es más seguro). Se implementa throttling interno.
 * - **User-Agent Obligatorio**: Basecamp EXIGE un User-Agent con nombre de app y email de contacto
 *   en TODAS las peticiones, o retorna 429/403.
 * - **Paginación**: La API usa paginación por header `Link` con `rel="next"`. Se sigue automáticamente.
 * - **Migración Futura**: El sistema debe soportar migración fuera de Basecamp. Todo dato relevante
 *   se persiste en Supabase con `bc_id` como clave de mapeo.
 *
 * @dataFlow
 * - OAuth2 Flow: User → /api/basecamp/auth → Basecamp Auth → /api/basecamp/callback → Supabase `bc_oauth_tokens`
 * - API Calls: `getValidToken()` → Supabase token lookup → auto-refresh if expired → `basecampFetch()` → Basecamp API
 * - Sync: `fetchProjects/Todos/Messages/etc.` → `basecampFetch()` → JSON → Caller (sync route) → Supabase upsert
 *
 * @notes
 * - Account ID fijo: 5052386 (configurado en BASECAMP_ACCOUNT_ID)
 * - Base URL: https://3.basecampapi.com/{account_id}/
 * - Auth URLs usan launchpad.37signals.com (no basecampapi.com)
 * - El token de Basecamp expira cada 2 semanas (~1,209,600 segundos). El refresh_token no expira.
 */

import { createClient } from '@supabase/supabase-js'

// ============================================================================
// CONFIGURATION
// ============================================================================

const BASECAMP_ACCOUNT_ID = process.env.BASECAMP_ACCOUNT_ID || '5052386'
const BASECAMP_API_BASE = `https://3.basecampapi.com/${BASECAMP_ACCOUNT_ID}`
const BASECAMP_AUTH_BASE = 'https://launchpad.37signals.com'
const BASECAMP_CLIENT_ID = process.env.BASECAMP_CLIENT_ID || ''
const BASECAMP_CLIENT_SECRET = process.env.BASECAMP_CLIENT_SECRET || ''
const BASECAMP_REDIRECT_URI = process.env.BASECAMP_REDIRECT_URI || 'http://localhost:3000/api/basecamp/callback'
const BASECAMP_USER_AGENT = process.env.BASECAMP_USER_AGENT || 'SM-TEG-Sync (carlos@tacosgavilan.com)'

// Rate limiting: Basecamp allows 50 req/10s (conservative) – we enforce internally
const RATE_LIMIT_WINDOW_MS = 10_000
const RATE_LIMIT_MAX_REQUESTS = 50
const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 1_000

// ============================================================================
// TYPES — Basecamp 3 API Response Interfaces
// ============================================================================

export interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

export interface BasecampProject {
  id: number
  status: string
  created_at: string
  updated_at: string
  name: string
  description: string
  purpose: string
  clients_enabled: boolean
  bookmark_url: string
  url: string
  app_url: string
  dock: BasecampDock[]
  bookmarked: boolean
}

export interface BasecampDock {
  id: number
  title: string
  name: string
  enabled: boolean
  position: number
  url: string
  app_url: string
}

export interface BasecampPerson {
  id: number
  attachable_sgid: string
  name: string
  email_address: string
  personable_type: string
  title: string
  bio: string | null
  location: string | null
  created_at: string
  updated_at: string
  admin: boolean
  owner: boolean
  client: boolean
  employee: boolean
  time_zone: string
  avatar_url: string
  avatar_kind: string
  status?: string
  company: {
    id: number
    name: string
  } | null
}

export interface BasecampTodoList {
  id: number
  status: string
  visible_to_clients: boolean
  created_at: string
  updated_at: string
  title: string
  inherits_status: boolean
  type: string
  url: string
  app_url: string
  bookmark_url: string
  subscription_url: string
  comments_count: number
  comments_url: string
  position: number
  parent: { id: number; title: string; type: string; url: string } | null
  bucket: { id: number; name: string; type: string }
  creator: BasecampPersonRef
  description: string
  completed: boolean
  completed_ratio: string
  name: string
  todos_url: string
  groups_url: string
  app_todos_url: string
}

export interface BasecampPersonRef {
  id: number
  attachable_sgid: string
  name: string
  email_address: string
  personable_type: string
  title: string
  bio: string | null
  location: string | null
  created_at: string
  updated_at: string
  admin: boolean
  owner: boolean
  client: boolean
  employee: boolean
  time_zone: string
  avatar_url: string
  avatar_kind: string
}

export interface BasecampTodo {
  id: number
  status: string
  visible_to_clients: boolean
  created_at: string
  updated_at: string
  title: string
  inherits_status: boolean
  type: string
  url: string
  app_url: string
  bookmark_url: string
  subscription_url: string
  comments_count: number
  comments_url: string
  position: number
  parent: { id: number; title: string; type: string; url: string } | null
  bucket: { id: number; name: string; type: string }
  creator: BasecampPersonRef
  completion_url: string
  completed: boolean
  content: string
  description: string
  starts_on: string | null
  due_on: string | null
  assignees: BasecampPersonRef[]
  completion_subscribers: BasecampPersonRef[]
  completor: BasecampPersonRef | null
}

export interface BasecampMessage {
  id: number
  status: string
  visible_to_clients: boolean
  created_at: string
  updated_at: string
  title: string
  inherits_status: boolean
  type: string
  url: string
  app_url: string
  bookmark_url: string
  subscription_url: string
  comments_count: number
  comments_url: string
  parent: { id: number; title: string; type: string; url: string } | null
  bucket: { id: number; name: string; type: string }
  creator: BasecampPersonRef
  content: string
  subject: string
  category: { id: number; title: string; name: string; color: string } | null
}

export interface BasecampCampfireLine {
  id: number
  status: string
  visible_to_clients: boolean
  created_at: string
  updated_at: string
  title: string
  inherits_status: boolean
  type: string
  url: string
  app_url: string
  bookmark_url: string
  parent: { id: number; title: string; type: string; url: string } | null
  bucket: { id: number; name: string; type: string }
  creator: BasecampPersonRef
  content: string
}

export interface BasecampDocument {
  id: number
  status: string
  visible_to_clients: boolean
  created_at: string
  updated_at: string
  title: string
  inherits_status: boolean
  type: string
  url: string
  app_url: string
  bookmark_url: string
  subscription_url: string
  comments_count: number
  comments_url: string
  parent: { id: number; title: string; type: string; url: string } | null
  bucket: { id: number; name: string; type: string }
  creator: BasecampPersonRef
  content: string
}

export interface BasecampUpload {
  id: number
  status: string
  visible_to_clients: boolean
  created_at: string
  updated_at: string
  title: string
  inherits_status: boolean
  type: string
  url: string
  app_url: string
  bookmark_url: string
  subscription_url: string
  comments_count: number
  comments_url: string
  parent: { id: number; title: string; type: string; url: string } | null
  bucket: { id: number; name: string; type: string }
  creator: BasecampPersonRef
  description: string
  content_type: string
  byte_size: number
  filename: string
  download_url: string
  app_download_url: string
  width: number | null
  height: number | null
}

export interface BasecampScheduleEntry {
  id: number
  status: string
  visible_to_clients: boolean
  created_at: string
  updated_at: string
  title: string
  inherits_status: boolean
  type: string
  url: string
  app_url: string
  bookmark_url: string
  subscription_url: string
  comments_count: number
  comments_url: string
  parent: { id: number; title: string; type: string; url: string } | null
  bucket: { id: number; name: string; type: string }
  creator: BasecampPersonRef
  description: string
  summary: string
  all_day: boolean
  starts_at: string
  ends_at: string
  participants: BasecampPersonRef[]
}

export interface BasecampQuestion {
  id: number
  status: string
  visible_to_clients: boolean
  created_at: string
  updated_at: string
  title: string
  inherits_status: boolean
  type: string
  url: string
  app_url: string
  parent: { id: number; title: string; type: string; url: string } | null
  bucket: { id: number; name: string; type: string }
  creator: BasecampPersonRef
  paused: boolean
  answers_count: number
  answers_url: string
  schedule_day: string
  schedule_time: string
}

export interface BasecampAnswer {
  id: number
  status: string
  visible_to_clients: boolean
  created_at: string
  updated_at: string
  title: string
  inherits_status: boolean
  type: string
  url: string
  app_url: string
  parent: { id: number; title: string; type: string; url: string } | null
  bucket: { id: number; name: string; type: string }
  creator: BasecampPersonRef
  content: string
  group_on: string
}

// Write operation payloads
export interface CreateTodoData {
  content: string
  description?: string
  assignee_ids?: number[]
  completion_subscriber_ids?: number[]
  notify?: boolean
  due_on?: string
  starts_on?: string
}

export interface CreateMessageData {
  subject: string
  content?: string
  status?: string
  category_id?: number
}

// ============================================================================
// SUPABASE CLIENT (Server-Side — Service Role)
// ============================================================================

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase credentials for Basecamp token management')
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

// ============================================================================
// RATE LIMITER — Token Bucket Implementation
// ============================================================================

const requestTimestamps: number[] = []

async function waitForRateLimit(): Promise<void> {
  while (true) {
    const now = Date.now()

    // Purge timestamps older than the window
    while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
      requestTimestamps.shift()
    }

    // If below limit, we can proceed
    if (requestTimestamps.length < RATE_LIMIT_MAX_REQUESTS) {
      requestTimestamps.push(Date.now())
      return
    }

    // Otherwise, wait until the oldest request exits the window + 50ms buffer and check again
    const waitTime = requestTimestamps[0] + RATE_LIMIT_WINDOW_MS - now + 50
    if (waitTime > 0) {
      console.log(`⏳ [Basecamp] Rate limit reached, waiting ${waitTime}ms...`)
      await new Promise((resolve) => setTimeout(resolve, waitTime))
    }
  }
}

// ============================================================================
// OAUTH2 — Authorization Flow
// ============================================================================

/**
 * Genera la URL de autorización de Basecamp OAuth2.
 * Redirige al usuario a 37signals Launchpad para autorizar la app.
 */
export async function getAuthorizationUrl(): Promise<string> {
  if (!BASECAMP_CLIENT_ID) {
    throw new Error('BASECAMP_CLIENT_ID is not configured')
  }
  const params = new URLSearchParams({
    type: 'web_server',
    client_id: BASECAMP_CLIENT_ID,
    redirect_uri: BASECAMP_REDIRECT_URI,
  })
  return `${BASECAMP_AUTH_BASE}/authorization/new?${params.toString()}`
}

export async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
  const params = new URLSearchParams({
    type: 'web_server',
    client_id: BASECAMP_CLIENT_ID,
    redirect_uri: BASECAMP_REDIRECT_URI,
    client_secret: BASECAMP_CLIENT_SECRET,
    code,
  })

  const res = await fetch(`${BASECAMP_AUTH_BASE}/authorization/token?${params.toString()}`, {
    method: 'POST',
    headers: {
      'User-Agent': BASECAMP_USER_AGENT,
    },
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Basecamp token exchange failed (${res.status}): ${errorText}`)
  }

  return res.json()
}

/**
 * Renueva el access_token usando el refresh_token.
 * Basecamp access_tokens expiran cada ~2 semanas.
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const params = new URLSearchParams({
    type: 'refresh',
    client_id: BASECAMP_CLIENT_ID,
    redirect_uri: BASECAMP_REDIRECT_URI,
    client_secret: BASECAMP_CLIENT_SECRET,
    refresh_token: refreshToken,
  })

  const res = await fetch(`${BASECAMP_AUTH_BASE}/authorization/token?${params.toString()}`, {
    method: 'POST',
    headers: {
      'User-Agent': BASECAMP_USER_AGENT,
    },
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Basecamp token refresh failed (${res.status}): ${errorText}`)
  }

  return res.json()
}

// ============================================================================
// TOKEN MANAGEMENT — Auto-Refresh from Supabase
// ============================================================================

/**
 * Obtiene un token válido de Supabase. Si el token ha expirado,
 * lo renueva automáticamente usando el refresh_token y actualiza la DB.
 *
 * @returns access_token válido listo para usar en peticiones API
 * @throws Error si no hay tokens almacenados o si la renovación falla
 */
// In-flight refresh promise singleton to prevent duplicate concurrent refresh calls
let inFlightRefreshPromise: Promise<string> | null = null

export async function getValidToken(): Promise<string> {
  const supabase = getServiceClient()

  // Fetch the most recent token from bc_oauth_tokens
  const { data: tokenRow, error: fetchError } = await supabase
    .from('bc_oauth_tokens')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single()

  if (fetchError || !tokenRow) {
    throw new Error(
      'No Basecamp OAuth tokens found. Please authenticate at /api/basecamp/auth first.'
    )
  }

  // Check if token is still valid (with 5 min buffer)
  const expiresAt = new Date(tokenRow.expires_at).getTime()
  const now = Date.now()
  const bufferMs = 5 * 60 * 1000 // 5 minutes

  if (now < expiresAt - bufferMs) {
    // Token is still valid
    return tokenRow.access_token
  }

  // If another concurrent request is already refreshing, wait for it
  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise
  }

  // Token expired or about to expire — refresh it with singleton lock
  console.log('🔄 [Basecamp] Token expired, refreshing...')

  inFlightRefreshPromise = (async () => {
    try {
      const newTokens = await refreshAccessToken(tokenRow.refresh_token)

      // Calculate new expiry (Basecamp typically returns expires_in in seconds, fallback to 14 days = 1209600s)
      const expiresInSeconds = Number(newTokens.expires_in) > 0 ? Number(newTokens.expires_in) : 1209600
      const newExpiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString()

      // Update the token in DB
      const { error: updateError } = await supabase
        .from('bc_oauth_tokens')
        .update({
          access_token: newTokens.access_token,
          // Basecamp may or may not return a new refresh_token
          ...(newTokens.refresh_token ? { refresh_token: newTokens.refresh_token } : {}),
          expires_at: newExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tokenRow.id)

      if (updateError) {
        console.error('❌ [Basecamp] Failed to update refreshed token in DB:', updateError)
        throw new Error(`Failed to save refreshed token: ${updateError.message}`)
      }

      console.log('✅ [Basecamp] Token refreshed successfully, new expiry:', newExpiresAt)
      return newTokens.access_token
    } catch (refreshErr: any) {
      console.error('❌ [Basecamp] Token refresh failed:', refreshErr.message)
      throw new Error(
        `Basecamp token refresh failed. Re-authenticate at /api/basecamp/auth. Error: ${refreshErr.message}`
      )
    } finally {
      inFlightRefreshPromise = null
    }
  })()

  return inFlightRefreshPromise
}

// ============================================================================
// API FETCHER — Core Fetch with Auth, Rate Limit, Retry, Pagination
// ============================================================================

/**
 * Link header parser for pagination.
 * Basecamp uses: Link: <URL>; rel="next"
 */
function parseLinkHeader(linkHeader: string | null): string | null {
  if (!linkHeader) return null

  const matches = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  return matches ? matches[1] : null
}

/**
 * Core API fetcher with authentication, rate limiting, retry with exponential backoff,
 * and automatic pagination following.
 *
 * @param path - API path relative to BASECAMP_API_BASE (e.g., '/projects.json')
 * @param options - Standard RequestInit options
 * @returns Parsed JSON response
 */
export async function basecampFetch<T>(path: string, options?: RequestInit & { noPaginate?: boolean }): Promise<T> {
  const token = await getValidToken()
  const noPaginate = options?.noPaginate ?? false

  // Build full URL (if path is already absolute, use as-is)
  let url = path.startsWith('http') ? path : `${BASECAMP_API_BASE}${path}`

  // Ensure .json extension for Basecamp API
  if (!url.includes('.json') && !url.includes('?')) {
    url += '.json'
  } else if (!url.includes('.json') && url.includes('?')) {
    url = url.replace('?', '.json?')
  }

  let allResults: any[] = []
  let currentUrl: string | null = url

  while (currentUrl) {
    // Wait for rate limit slot
    await waitForRateLimit()

    let lastError: Error | null = null
    let response: Response | null = null

    // Retry loop with exponential backoff
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 30_000) // 30s timeout

        response = await fetch(currentUrl, {
          ...options,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': BASECAMP_USER_AGENT,
            ...options?.headers,
          },
        })
        clearTimeout(timeoutId)

        // Success
        if (response.ok) {
          lastError = null
          break
        }

        // Rate limited (429) or Server error (5xx) — retry
        if (response.status === 429 || response.status >= 500) {
          const retryAfter = response.headers.get('Retry-After')
          const backoffMs = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : INITIAL_BACKOFF_MS * Math.pow(2, attempt)

          console.warn(
            `⚠️ [Basecamp] ${response.status} on attempt ${attempt + 1}/${MAX_RETRIES + 1}, retrying in ${backoffMs}ms...`
          )
          await new Promise((r) => setTimeout(r, backoffMs))
          lastError = new Error(`Basecamp API error: ${response.status}`)
          continue
        }

        // Client error (4xx, not 429) — don't retry
        const errorBody = await response.text()
        throw new Error(`Basecamp API error (${response.status}): ${errorBody}`)
      } catch (err: any) {
        if (err.name === 'AbortError') {
          lastError = new Error('Basecamp API request timed out (30s)')
          if (attempt < MAX_RETRIES) {
            const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt)
            await new Promise((r) => setTimeout(r, backoffMs))
          }
          continue
        }
        // If it's our own thrown error (4xx), just re-throw
        if (err.message?.includes('Basecamp API error')) {
          throw err
        }
        lastError = err
        if (attempt < MAX_RETRIES) {
          const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt)
          await new Promise((r) => setTimeout(r, backoffMs))
        }
      }
    }

    if (lastError || !response || !response.ok) {
      throw lastError || new Error('Basecamp API request failed after all retries')
    }

    // Parse response
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      // Some write operations return 204 No Content
      return undefined as unknown as T
    }

    const data = await response.json()

    // Handle pagination
    if (noPaginate || !Array.isArray(data)) {
      // Single object response or pagination disabled
      return data as T
    }

    allResults = allResults.concat(data)

    // Check for next page via Link header
    const nextUrl = parseLinkHeader(response.headers.get('Link'))
    currentUrl = nextUrl
  }

  return allResults as unknown as T
}

// ============================================================================
// DATA FETCHING — Read Operations
// ============================================================================

/** Obtiene todos los proyectos del account */
export async function fetchProjects(): Promise<BasecampProject[]> {
  return basecampFetch<BasecampProject[]>('/projects.json')
}

/** Obtiene un proyecto específico por ID */
export async function fetchProject(projectId: number): Promise<BasecampProject> {
  return basecampFetch<BasecampProject>(`/projects/${projectId}.json`, { noPaginate: true })
}

/** Obtiene todas las personas del account */
export async function fetchPeople(): Promise<BasecampPerson[]> {
  return basecampFetch<BasecampPerson[]>('/people.json')
}

/** Obtiene las personas asignadas a un proyecto específico */
export async function fetchProjectPeople(projectId: number): Promise<BasecampPerson[]> {
  // NOTE: Basecamp 3 API uses /projects/ NOT /buckets/ for people endpoint
  return basecampFetch<BasecampPerson[]>(`/projects/${projectId}/people.json`)
}

/** Obtiene el todoset de un proyecto (contenedor raíz de to-do lists) */
export async function fetchTodoSet(projectId: number, todosetId: number): Promise<any> {
  return basecampFetch(`/buckets/${projectId}/todosets/${todosetId}.json`, { noPaginate: true })
}

/** Obtiene las to-do lists de un todoset */
export async function fetchTodoLists(projectId: number, todosetId: number): Promise<BasecampTodoList[]> {
  return basecampFetch<BasecampTodoList[]>(`/buckets/${projectId}/todosets/${todosetId}/todolists.json`)
}

/** Obtiene los to-dos de una to-do list. Por defecto solo retorna los activos (pendientes).
 *  Usar `completed: true` para obtener los completados. */
export async function fetchTodos(
  projectId: number,
  todolistId: number,
  options?: { completed?: boolean; noPaginate?: boolean }
): Promise<BasecampTodo[]> {
  const params = options?.completed ? '?completed=true' : ''
  return basecampFetch<BasecampTodo[]>(
    `/buckets/${projectId}/todolists/${todolistId}/todos.json${params}`,
    { noPaginate: options?.noPaginate }
  )
}

export async function fetchAllTodos(
  projectId: number,
  todolistId: number,
  noPaginateCompleted: boolean = true
): Promise<BasecampTodo[]> {
  const [active, completed] = await Promise.all([
    fetchTodos(projectId, todolistId),
    fetchTodos(projectId, todolistId, { completed: true, noPaginate: noPaginateCompleted }),
  ])
  return [...active, ...completed]
}

/** Obtiene el message board de un proyecto */
export async function fetchMessageBoard(projectId: number, boardId: number): Promise<any> {
  return basecampFetch(`/buckets/${projectId}/message_boards/${boardId}.json`, { noPaginate: true })
}

/** Obtiene los mensajes de un message board */
export async function fetchMessages(projectId: number, boardId: number): Promise<BasecampMessage[]> {
  return basecampFetch<BasecampMessage[]>(`/buckets/${projectId}/message_boards/${boardId}/messages.json`)
}

/** Obtiene las líneas de un campfire (chat) */
export async function fetchCampfireLines(projectId: number, campfireId: number): Promise<BasecampCampfireLine[]> {
  return basecampFetch<BasecampCampfireLine[]>(`/buckets/${projectId}/chats/${campfireId}/lines.json`)
}

/** Obtiene un vault (carpeta de documentos) */
export async function fetchVault(projectId: number, vaultId: number): Promise<any> {
  return basecampFetch(`/buckets/${projectId}/vaults/${vaultId}.json`, { noPaginate: true })
}

/** Obtiene los documentos de un vault */
export async function fetchDocuments(projectId: number, vaultId: number): Promise<BasecampDocument[]> {
  return basecampFetch<BasecampDocument[]>(`/buckets/${projectId}/vaults/${vaultId}/documents.json`)
}

/** Obtiene los uploads (archivos) de un vault */
export async function fetchUploads(projectId: number, vaultId: number): Promise<BasecampUpload[]> {
  return basecampFetch<BasecampUpload[]>(`/buckets/${projectId}/vaults/${vaultId}/uploads.json`)
}

/** Obtiene los sub-vaults (carpetas) de un vault */
export async function fetchSubVaults(projectId: number, vaultId: number): Promise<any[]> {
  return basecampFetch<any[]>(`/buckets/${projectId}/vaults/${vaultId}/vaults.json`)
}

/** Obtiene las entradas del schedule (calendario) */
export async function fetchScheduleEntries(projectId: number, scheduleId: number): Promise<BasecampScheduleEntry[]> {
  return basecampFetch<BasecampScheduleEntry[]>(
    `/buckets/${projectId}/schedules/${scheduleId}/entries.json`
  )
}

/** Obtiene las preguntas de un questionnaire (check-ins) */
export async function fetchQuestions(projectId: number, questionnaireId: number): Promise<BasecampQuestion[]> {
  return basecampFetch<BasecampQuestion[]>(
    `/buckets/${projectId}/questionnaires/${questionnaireId}/questions.json`
  )
}

/** Obtiene las respuestas de una pregunta de check-in */
export async function fetchAnswers(projectId: number, questionId: number): Promise<BasecampAnswer[]> {
  return basecampFetch<BasecampAnswer[]>(`/buckets/${projectId}/questions/${questionId}/answers.json`)
}

// ============================================================================
// WRITE OPERATIONS — Bidirectional Sync
// ============================================================================

/** Crea un nuevo to-do en una to-do list */
export async function createTodo(
  projectId: number,
  todolistId: number,
  data: CreateTodoData
): Promise<BasecampTodo> {
  return basecampFetch<BasecampTodo>(`/buckets/${projectId}/todolists/${todolistId}/todos.json`, {
    method: 'POST',
    body: JSON.stringify(data),
    noPaginate: true,
  })
}

/** Marca un to-do como completado */
export async function completeTodo(projectId: number, todoId: number): Promise<void> {
  await basecampFetch(`/buckets/${projectId}/todos/${todoId}/completion.json`, {
    method: 'POST',
    noPaginate: true,
  })
}

/** Desmarca un to-do (lo reactiva) */
export async function uncompleteTodo(projectId: number, todoId: number): Promise<void> {
  await basecampFetch(`/buckets/${projectId}/todos/${todoId}/completion.json`, {
    method: 'DELETE',
    noPaginate: true,
  })
}

/** Crea un nuevo mensaje en un message board */
export async function createMessage(
  projectId: number,
  boardId: number,
  data: CreateMessageData
): Promise<BasecampMessage> {
  return basecampFetch<BasecampMessage>(
    `/buckets/${projectId}/message_boards/${boardId}/messages.json`,
    {
      method: 'POST',
      body: JSON.stringify(data),
      noPaginate: true,
    }
  )
}

/** Envía una línea al campfire (chat) */
export async function createCampfireLine(
  projectId: number,
  campfireId: number,
  content: string
): Promise<BasecampCampfireLine> {
  return basecampFetch<BasecampCampfireLine>(
    `/buckets/${projectId}/chats/${campfireId}/lines.json`,
    {
      method: 'POST',
      body: JSON.stringify({ content }),
      noPaginate: true,
    }
  )
}

/** Crea un comentario en cualquier recording (message, todo, etc.) */
export async function createComment(
  projectId: number,
  recordingId: number,
  content: string
): Promise<any> {
  return basecampFetch(`/buckets/${projectId}/recordings/${recordingId}/comments.json`, {
    method: 'POST',
    body: JSON.stringify({ content }),
    noPaginate: true,
  })
}

/** Obtiene los comentarios de cualquier recording (message, todo, etc.) */
export async function fetchComments(projectId: number, recordingId: number): Promise<any[]> {
  return basecampFetch<any[]>(`/buckets/${projectId}/recordings/${recordingId}/comments.json`)
}

/** Crea una respuesta a una pregunta de check-in */
export async function createAnswer(
  projectId: number,
  questionId: number,
  content: string
): Promise<BasecampAnswer> {
  return basecampFetch<BasecampAnswer>(
    `/buckets/${projectId}/questions/${questionId}/answers.json`,
    {
      method: 'POST',
      body: JSON.stringify({ content }),
      noPaginate: true,
    }
  )
}

/** Crea un evento en el schedule */
export async function createScheduleEntry(
  projectId: number,
  scheduleId: number,
  data: {
    summary: string
    description?: string
    starts_at: string
    ends_at: string
    all_day?: boolean
  }
): Promise<BasecampScheduleEntry> {
  return basecampFetch<BasecampScheduleEntry>(
    `/buckets/${projectId}/schedules/${scheduleId}/entries.json`,
    {
      method: 'POST',
      body: JSON.stringify(data),
      noPaginate: true,
    }
  )
}

/** Crea un documento en un vault */
export async function createDocument(
  projectId: number,
  vaultId: number,
  data: {
    title: string
    content: string
  }
): Promise<BasecampDocument> {
  return basecampFetch<BasecampDocument>(
    `/buckets/${projectId}/vaults/${vaultId}/documents.json`,
    {
      method: 'POST',
      body: JSON.stringify(data),
      noPaginate: true,
    }
  )
}

// ============================================================================
// HELPERS — Dock Finder
// ============================================================================

/**
 * Busca un dock (herramienta) dentro de un proyecto por su nombre.
 * Cada proyecto tiene un "dock" con las herramientas habilitadas (todoset, message_board, etc.)
 *
 * @param project - Proyecto de Basecamp
 * @param dockName - Nombre del dock (e.g., 'todoset', 'message_board', 'chat', 'vault', 'schedule', 'questionnaire')
 * @returns El dock encontrado o undefined
 */
export function findDock(project: BasecampProject, dockName: string): BasecampDock | undefined {
  return project.dock?.find((d) => d.name === dockName && d.enabled)
}

/**
 * Extrae el ID del dock a partir de su URL.
 * Basecamp dock URLs have format: .../buckets/{projectId}/{dockType}/{dockId}.json
 *
 * @param dockUrl - URL completa del dock
 * @returns El ID numérico extraído de la URL
 */
export function extractDockId(dockUrl: string): number {
  // URL format: https://3.basecampapi.com/ACCOUNT/buckets/PROJECT_ID/DOCK_TYPE/DOCK_ID.json
  const parts = dockUrl.replace('.json', '').split('/')
  return parseInt(parts[parts.length - 1], 10)
}
