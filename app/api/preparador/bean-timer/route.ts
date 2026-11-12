/**
 * @module app/api/preparador/bean-timer/route.ts
 * @description Endpoint autenticado del Temporizador Digital Multicanal (estilo Cooper TFS4)
 *   para cocción de Frijoles de la Olla (11 min) y Frijoles Enteros (12 min) en la Tableta 2 de Cocina Trasera.
 *
 * @businessRules
 * - Tiempos exactos bloqueados en servidor (`bean_timer_presets`): el endpoint `START` ignora cualquier
 *   duración enviada por el cliente y aplica estrictamente los segundos oficiales de la base de datos
 *   (`FRIJOLES_OLLA = 660s / 11 min`, `FRIJOLES_ENTEROS = 720s / 12 min`).
 * - Autorización Fail-Closed por sucursal:
 *   - `GET`: requiere sesión válida con alcance de lectura sobre `storeId` (`authorizeStoreScope`).
 *   - `POST` (`START`, `ALARM_TRIGGERED`, `COMPLETE`, `CANCEL`): requiere sesión válida de tienda (`complete_checklist`)
 *     restringida a la sucursal asignada del usuario (`admin` y `supervisor` tienen alcance multitienda).
 *   - `PUT`: exclusivo para rol `admin` (`verifyAdminAuth`) para calibrar los tiempos globales.
 * - Jornada laboral Tacos Gavilan (`America/Los_Angeles`): 6:00 AM a 5:59 AM (`AM`: 6:00 AM-4:59 PM, `PM`: 5:00 PM-5:59 AM).
 * - Al apagar un temporizador (`COMPLETE`), calcula en servidor `overtime_seconds` exactos (`>= 0`) respecto a `expected_end_at`.
 *
 * @dataFlow
 * - `Tableta 2 (/inventory/preparador/bodega)` <-> `/api/preparador/bean-timer` <-> `bean_timer_presets` & `bean_cooking_logs`.
 *
 * @notes
 * - Autolimpieza automática de sesiones abandonadas (`> 6 horas`) para evitar bloqueo permanente del índice parcial único `(store_id, channel_id)`.
 * - Ninguna columna autocalculada (`GENERATED ALWAYS AS`) se incluye en payloads de mutación.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getServerUser, authorizeStoreScope, verifyAdminAuth } from '@/lib/auth-server'
import {
  DEFAULT_BEAN_TIMER_PRESETS,
  MAX_ACTIVE_BEAN_TIMER_AGE_MS,
  MIN_BEAN_PRESET_SECONDS,
  MAX_BEAN_PRESET_SECONDS,
  createEmptyBeanChannelsMap,
  dbLogRowToActiveSession,
  isValidBeanChannelId,
  isValidBeanProductKey,
  resolveBeanBusinessContext,
  sanitizeBeanPresetMap,
} from '@/lib/bean-timer'

export const dynamic = 'force-dynamic'

async function loadAuthoritativePresets() {
  const { data, error } = await supabaseAdmin
    .from('bean_timer_presets')
    .select('product_key, duration_seconds, is_active')
    .eq('is_active', true)

  if (error || !data) {
    return { ...DEFAULT_BEAN_TIMER_PRESETS }
  }

  const rawMap: Record<string, unknown> = {}
  for (const row of data) {
    if (row?.product_key) {
      rawMap[String(row.product_key)] = row.duration_seconds
    }
  }
  return sanitizeBeanPresetMap(rawMap)
}

async function purgeStaleActiveChannels(storeId: number, nowMs: number) {
  const staleCutoffIso = new Date(nowMs - MAX_ACTIVE_BEAN_TIMER_AGE_MS).toISOString()
  await supabaseAdmin
    .from('bean_cooking_logs')
    .update({
      status: 'CANCELLED',
      completed_at: new Date(nowMs).toISOString(),
      completed_by: 'system_stale_cleanup',
      updated_at: new Date(nowMs).toISOString(),
    })
    .eq('store_id', storeId)
    .in('status', ['RUNNING', 'ALARMING'])
    .lt('started_at', staleCutoffIso)
}

export async function GET(request: NextRequest) {
  try {
    const rawStoreId = request.nextUrl.searchParams.get('storeId')
    if (!rawStoreId) {
      return NextResponse.json({ error: 'Parámetro storeId requerido' }, { status: 400 })
    }

    const user = await getServerUser(request)
    const auth = await authorizeStoreScope(user, rawStoreId, supabaseAdmin, {
      action: 'view',
      allowEmployeeRead: true,
    })

    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'No autorizado' }, { status: auth.status })
    }

    const numericStoreId = auth.canonicalNumericId ?? Number(rawStoreId)
    if (!Number.isFinite(numericStoreId) || numericStoreId <= 0) {
      return NextResponse.json({ error: 'Sucursal inválida' }, { status: 400 })
    }

    const nowMs = Date.now()
    await purgeStaleActiveChannels(numericStoreId, nowMs)

    const { businessDate, shiftPeriod } = resolveBeanBusinessContext(nowMs)

    const [presets, activeRes, historyRes] = await Promise.all([
      loadAuthoritativePresets(),
      supabaseAdmin
        .from('bean_cooking_logs')
        .select('*')
        .eq('store_id', numericStoreId)
        .in('status', ['RUNNING', 'ALARMING'])
        .order('started_at', { ascending: true }),
      supabaseAdmin
        .from('bean_cooking_logs')
        .select('*')
        .eq('store_id', numericStoreId)
        .eq('business_date', businessDate)
        .in('status', ['COMPLETED', 'CANCELLED'])
        .order('started_at', { ascending: false })
        .limit(50),
    ])

    if (activeRes.error) {
      console.error('[bean-timer] Error consultando canales activos:', activeRes.error)
      return NextResponse.json({ error: activeRes.error.message }, { status: 500 })
    }

    if (historyRes.error) {
      console.error('[bean-timer] Error consultando historial diario:', historyRes.error)
      return NextResponse.json({ error: historyRes.error.message }, { status: 500 })
    }

    const activeChannels = createEmptyBeanChannelsMap()
    for (const row of activeRes.data || []) {
      const parsed = dbLogRowToActiveSession(row, nowMs)
      if (parsed) {
        activeChannels[parsed.channelId] = parsed
      }
    }

    const isAdmin = (user?.role || '').trim().toLowerCase() === 'admin'

    return NextResponse.json({
      success: true,
      storeId: numericStoreId,
      businessDate,
      shiftPeriod,
      isAdmin,
      presets,
      activeChannels,
      todayHistory: historyRes.data || [],
    })
  } catch (err: any) {
    console.error('[bean-timer] GET exception:', err)
    return NextResponse.json(
      { error: err?.message || 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const rawStoreId = body?.storeId
    const action = String(body?.action || '').trim().toUpperCase()

    if (!rawStoreId || !action) {
      return NextResponse.json(
        { error: 'Campos obligatorios faltantes (storeId, action)' },
        { status: 400 }
      )
    }

    const user = await getServerUser(request)
    const auth = await authorizeStoreScope(user, rawStoreId, supabaseAdmin, {
      action: 'complete_checklist',
    })

    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'No autorizado' }, { status: auth.status })
    }

    const numericStoreId = auth.canonicalNumericId ?? Number(rawStoreId)
    if (!Number.isFinite(numericStoreId) || numericStoreId <= 0) {
      return NextResponse.json({ error: 'Sucursal inválida' }, { status: 400 })
    }

    const actorLabel = user?.name || user?.email || 'cocina'
    const nowMs = Date.now()

    if (action === 'START') {
      const channelId = body?.channelId
      const productKey = body?.productKey

      if (!isValidBeanChannelId(channelId)) {
        return NextResponse.json(
          { error: 'Canal inválido. Debe ser T1, T2, T3 o T4.' },
          { status: 400 }
        )
      }
      if (!isValidBeanProductKey(productKey)) {
        return NextResponse.json(
          { error: 'Producto inválido. Solo se permiten FRIJOLES_OLLA o FRIJOLES_ENTEROS.' },
          { status: 400 }
        )
      }

      await purgeStaleActiveChannels(numericStoreId, nowMs)

      // Consultar el tiempo oficial bloqueado en base de datos (jamás confiar en segundos enviados por el cliente)
      const presets = await loadAuthoritativePresets()
      const targetSeconds = presets[productKey]

      // Permitir sincronización de timestamp local solo dentro de una ventana razonable (±60s) ante micro-cortes de Wi-Fi
      let startedAtMs = nowMs
      if (body?.clientStartedAtMs !== undefined) {
        const candidateMs = Number(body.clientStartedAtMs)
        if (Number.isFinite(candidateMs) && Math.abs(nowMs - candidateMs) <= 60_000) {
          startedAtMs = candidateMs
        }
      }

      const expectedEndAtMs = startedAtMs + targetSeconds * 1000
      const { businessDate, shiftPeriod } = resolveBeanBusinessContext(startedAtMs)

      // Verificar si el canal ya tiene una cocción activa (idempotencia ante reintentos o conflicto real)
      const { data: existingActive } = await supabaseAdmin
        .from('bean_cooking_logs')
        .select('*')
        .eq('store_id', numericStoreId)
        .eq('channel_id', channelId)
        .in('status', ['RUNNING', 'ALARMING'])
        .maybeSingle()

      if (existingActive) {
        const existingStartMs = new Date(existingActive.started_at).getTime()
        if (
          existingActive.product_key === productKey &&
          Math.abs(existingStartMs - startedAtMs) <= 5000
        ) {
          return NextResponse.json({
            success: true,
            idempotent: true,
            log: existingActive,
            session: dbLogRowToActiveSession(existingActive, nowMs),
          })
        }

        return NextResponse.json(
          {
            error: `El canal ${channelId} ya tiene una cocción activa en esta sucursal.`,
            code: 'CHANNEL_BUSY',
            existingSession: dbLogRowToActiveSession(existingActive, nowMs),
          },
          { status: 409 }
        )
      }

      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('bean_cooking_logs')
        .insert({
          store_id: numericStoreId,
          business_date: businessDate,
          shift_period: shiftPeriod,
          channel_id: channelId,
          product_key: productKey,
          target_seconds: targetSeconds,
          started_at: new Date(startedAtMs).toISOString(),
          expected_end_at: new Date(expectedEndAtMs).toISOString(),
          status: 'RUNNING',
          overtime_seconds: 0,
          started_by: actorLabel,
          updated_at: new Date(nowMs).toISOString(),
        })
        .select('*')
        .single()

      if (insertErr) {
        console.error('[bean-timer] Error iniciando canal:', insertErr)
        return NextResponse.json({ error: insertErr.message }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        log: inserted,
        session: dbLogRowToActiveSession(inserted, nowMs),
      })
    }

    if (action === 'ALARM_TRIGGERED') {
      const channelId = body?.channelId
      const logId = body?.logId ? String(body.logId) : null

      if (!logId && !isValidBeanChannelId(channelId)) {
        return NextResponse.json({ error: 'Se requiere logId o channelId válido' }, { status: 400 })
      }

      let query = supabaseAdmin
        .from('bean_cooking_logs')
        .select('*')
        .eq('store_id', numericStoreId)
        .in('status', ['RUNNING', 'ALARMING'])

      query = logId ? query.eq('id', logId) : query.eq('channel_id', channelId)
      const { data: activeRow } = await query.maybeSingle()

      if (!activeRow) {
        return NextResponse.json({ success: true, skipped: true })
      }

      if (activeRow.status === 'ALARMING' && activeRow.alarm_triggered_at) {
        return NextResponse.json({
          success: true,
          log: activeRow,
          session: dbLogRowToActiveSession(activeRow, nowMs),
        })
      }

      const expectedEndMs = new Date(activeRow.expected_end_at).getTime()
      const triggerIso = new Date(
        Number.isFinite(expectedEndMs) ? Math.max(expectedEndMs, nowMs) : nowMs
      ).toISOString()

      const { data: updated, error: updErr } = await supabaseAdmin
        .from('bean_cooking_logs')
        .update({
          status: 'ALARMING',
          alarm_triggered_at: activeRow.alarm_triggered_at || triggerIso,
          updated_at: new Date(nowMs).toISOString(),
        })
        .eq('id', activeRow.id)
        .eq('store_id', numericStoreId)
        .select('*')
        .single()

      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        log: updated,
        session: dbLogRowToActiveSession(updated, nowMs),
      })
    }

    if (action === 'COMPLETE' || action === 'CANCEL') {
      const channelId = body?.channelId
      const logId = body?.logId ? String(body.logId) : null

      if (!logId && !isValidBeanChannelId(channelId)) {
        return NextResponse.json({ error: 'Se requiere logId o channelId válido' }, { status: 400 })
      }

      let query = supabaseAdmin
        .from('bean_cooking_logs')
        .select('*')
        .eq('store_id', numericStoreId)
        .in('status', ['RUNNING', 'ALARMING'])

      query = logId ? query.eq('id', logId) : query.eq('channel_id', channelId)
      const { data: activeRow } = await query.maybeSingle()

      if (!activeRow) {
        return NextResponse.json({ success: true, alreadyClosed: true })
      }

      const expectedEndMs = new Date(activeRow.expected_end_at).getTime()
      const isComplete = action === 'COMPLETE'
      const overtimeSeconds =
        isComplete && Number.isFinite(expectedEndMs) && nowMs > expectedEndMs
          ? Math.max(0, Math.floor((nowMs - expectedEndMs) / 1000))
          : 0

      const alarmTriggeredIso =
        activeRow.alarm_triggered_at ||
        (isComplete && Number.isFinite(expectedEndMs) && nowMs >= expectedEndMs
          ? activeRow.expected_end_at
          : null)

      const { data: closedRow, error: closeErr } = await supabaseAdmin
        .from('bean_cooking_logs')
        .update({
          status: isComplete ? 'COMPLETED' : 'CANCELLED',
          alarm_triggered_at: alarmTriggeredIso,
          completed_at: new Date(nowMs).toISOString(),
          overtime_seconds: overtimeSeconds,
          completed_by: actorLabel,
          updated_at: new Date(nowMs).toISOString(),
        })
        .eq('id', activeRow.id)
        .eq('store_id', numericStoreId)
        .select('*')
        .single()

      if (closeErr) {
        console.error('[bean-timer] Error cerrando cocción:', closeErr)
        return NextResponse.json({ error: closeErr.message }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        log: closedRow,
      })
    }

    return NextResponse.json({ error: `Acción no soportada: ${action}` }, { status: 400 })
  } catch (err: any) {
    console.error('[bean-timer] POST exception:', err)
    return NextResponse.json(
      { error: err?.message || 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const adminCheck = verifyAdminAuth(request, { allowCron: false })
    if (!adminCheck.authorized) {
      return (
        adminCheck.response ||
        NextResponse.json({ error: adminCheck.error || 'Solo Admin autorizado' }, { status: 403 })
      )
    }

    const body = await request.json()
    const rawOlla = Number(body?.FRIJOLES_OLLA ?? body?.frijolesOllaSeconds)
    const rawEnteros = Number(body?.FRIJOLES_ENTEROS ?? body?.frijolesEnterosSeconds)

    if (
      !Number.isFinite(rawOlla) ||
      !Number.isFinite(rawEnteros) ||
      Math.round(rawOlla) < MIN_BEAN_PRESET_SECONDS ||
      Math.round(rawOlla) > MAX_BEAN_PRESET_SECONDS ||
      Math.round(rawEnteros) < MIN_BEAN_PRESET_SECONDS ||
      Math.round(rawEnteros) > MAX_BEAN_PRESET_SECONDS
    ) {
      return NextResponse.json(
        {
          error: `Los tiempos de cocción deben estar entre ${MIN_BEAN_PRESET_SECONDS} segundos y ${MAX_BEAN_PRESET_SECONDS} segundos.`,
        },
        { status: 400 }
      )
    }

    const ollaSeconds = Math.round(rawOlla)
    const enterosSeconds = Math.round(rawEnteros)
    const updatedBy = adminCheck.user?.email || 'admin'
    const nowIso = new Date().toISOString()

    const { error } = await supabaseAdmin.from('bean_timer_presets').upsert(
      [
        {
          product_key: 'FRIJOLES_OLLA',
          duration_seconds: ollaSeconds,
          sort_order: 1,
          is_active: true,
          updated_by: updatedBy,
          updated_at: nowIso,
        },
        {
          product_key: 'FRIJOLES_ENTEROS',
          duration_seconds: enterosSeconds,
          sort_order: 2,
          is_active: true,
          updated_by: updatedBy,
          updated_at: nowIso,
        },
      ],
      { onConflict: 'product_key' }
    )

    if (error) {
      console.error('[bean-timer] Error actualizando presets:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      presets: {
        FRIJOLES_OLLA: ollaSeconds,
        FRIJOLES_ENTEROS: enterosSeconds,
      },
    })
  } catch (err: any) {
    console.error('[bean-timer] PUT exception:', err)
    return NextResponse.json(
      { error: err?.message || 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
