/**
 * @module api/order-ready/telemetry
 * @description Endpoint de telemetría en tiempo real y auditoría multi-sucursal para detectar:
 * (1) si las tabletas de cocina (`/inventory/preparador`) están conectadas y siendo tocadas para llamar órdenes, y
 * (2) si la PC / bocina (`/order-ready-board`) está abierta, sin Mute, desbloqueada y reproduciendo realmente la voz AI (Playback ACK).
 *
 * @businessRules
 * - **Cero Tormentas Realtime**: La telemetría se persiste en tablas dedicadas (`order_ready_device_status` y
 *   `order_ready_voice_playbacks`) fuera de `supabase_realtime`, sin agregar columnas ni `UPDATE`s extra sobre
 *   `order_ready_announcements`.
 * - **Agregación en PostgreSQL**: El historial de 1 o 7 días (~41k+ filas) se agrega dentro de Postgres vía RPC
 *   `get_order_ready_telemetry_summary` para evitar truncamientos de 1,000 filas de PostgREST.
 * - **Día Laboral Oficial 6:00 AM PT**: Los cortes `today` y `7d` se calculan siempre con `getCaliforniaBusinessDate()`.
 * - **Preservación de Última Locución**: Los `heartbeat` periódicos del tablero omiten `last_played_*` en el upsert
 *   para no sobrescribir nunca la hora o número de la última orden reproducida por voz.
 * - **Control de Acceso**: Lectura y escritura autenticadas con `getOrderReadyAccess(request)` y aisladas por tienda (`canAccessStore`).
 *
 * @dataFlow
 * - Preparador / Board -> POST /api/order-ready/telemetry (heartbeat | playback_ack) -> Supabase (`order_ready_device_status`, `order_ready_voice_playbacks`).
 * - Modal Auditoría Voz AI -> GET /api/order-ready/telemetry?range=today|7d -> RPC `get_order_ready_telemetry_summary` -> Métricas en vivo por tienda.
 *
 * @notes
 * - Umbral de dispositivo en línea (`ONLINE_WINDOW_MS`): 660,000 ms (11 minutos), tolerando intervalos de latido de 5 min (300s), omisión de latido cuando hubo `playback_ack` reciente (<4 min) y reintentos cortos de red.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getOrderReadyAccess, canAccessStore } from '@/lib/order-ready-access'
import { STORE_GUID_BY_CODE, TOAST_STORE_MAP } from '@/lib/toast-stores'
import { getCaliforniaBusinessDate } from '@/lib/business-date'
import {
  DEFAULT_AUTO_CALL_TIMER_CONFIG,
  getStoreAutoCallMode,
  sanitizeAutoCallTimerConfig,
  type AutoCallMode
} from '@/lib/order-ready-auto-timer'

export const dynamic = 'force-dynamic'

const ONLINE_WINDOW_MS = 660_000

const ALLOWED_TRIGGER_SOURCES = new Set([
  'tablet_tap',
  'smart_auto_timer',
  'manual_board_replay',
  'reminder',
  'auto_bump',
  'special_button'
])

const ALLOWED_ENGINES = new Set(['neural_wav', 'browser_tts'])

export type SpeakerLiveState = 'active' | 'muted' | 'audio_locked' | 'offline'

export interface StoreTelemetryItem {
  storeCode: string
  storeName: string
  autoCallMode: AutoCallMode
  tabletOnline: boolean
  prepLastHeartbeatAt: string | null
  speakerState: SpeakerLiveState
  speakerOnline: boolean
  speakerLastHeartbeatAt: string | null
  speakerIsMuted: boolean
  speakerAudioUnlocked: boolean
  speakerVoiceId: string
  speakerVoiceVolume: number
  speakerIsFullscreen: boolean
  speakerLastPlayedAt: string | null
  speakerLastPlayedOrder: string | null
  speakerLastEngine: string | null
  totalOrders: number
  tabletCalledOrders: number
  pctTabletCalled: number
  specialButtonsCalled: number
  speakerConfirmedOrders: number
  totalPlaybackEvents: number
  callsSinceSpeakerActive: number
  unheardCallsSinceActive: number
  avgPrepToCallSec: number | null
  avgCallToBumpSec: number | null
  avgSpeakerLatencyMs: number | null
  lastTabletCallAt: string | null
  lastOrderCreatedAt: string | null
}

function isIsolatedTestStoreCode(storeCode: string): boolean {
  return (
    process.env.ALLOW_ORDER_READY_TEST_DB === 'true' &&
    storeCode.startsWith('CODEX_ORDER_READY_TEST')
  )
}

function clampVolume(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return 1.0
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100))
}

function resolveStoreDisplayName(storeCode: string): string {
  const guid = STORE_GUID_BY_CODE[storeCode]
  if (guid && TOAST_STORE_MAP[guid]?.name) {
    return TOAST_STORE_MAP[guid].name
  }
  return storeCode
}

function subtractDaysIso(dateYmd: string, days: number): string {
  const d = new Date(`${dateYmd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const action = String(body?.action || '').trim()
    const storeCode = String(body?.storeCode || '').trim().toUpperCase()
    const isTestStore = isIsolatedTestStoreCode(storeCode)

    if (!storeCode || (!STORE_GUID_BY_CODE[storeCode] && !isTestStore)) {
      return NextResponse.json(
        { error: 'storeCode inválido o no registrado' },
        { status: 400 }
      )
    }

    const access = await getOrderReadyAccess(request)
    if (!access && !isTestStore) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }
    if (access && !canAccessStore(access, storeCode) && !isTestStore) {
      return NextResponse.json({ error: 'Sin acceso a esta tienda' }, { status: 403 })
    }

    const nowMs = Date.now()
    const nowIso = new Date(nowMs).toISOString()

    if (action === 'heartbeat') {
      const deviceRole = String(body?.deviceRole || '').trim()
      if (deviceRole !== 'prep_tablet' && deviceRole !== 'speaker_board') {
        return NextResponse.json(
          { error: 'deviceRole inválido (esperado: prep_tablet | speaker_board)' },
          { status: 400 }
        )
      }

      if (deviceRole === 'prep_tablet') {
        const { error: upsertErr } = await supabaseAdmin
          .from('order_ready_device_status')
          .upsert(
            {
              store_code: storeCode,
              device_role: 'prep_tablet',
              last_heartbeat_at: nowIso,
              updated_at: nowIso
            },
            { onConflict: 'store_code,device_role' }
          )

        if (upsertErr) {
          return NextResponse.json({ error: upsertErr.message }, { status: 500 })
        }

        return NextResponse.json({
          success: true,
          action: 'heartbeat',
          storeCode,
          deviceRole,
          recordedAt: nowIso
        })
      }

      // Importante: omitir last_played_* para preservar el historial de última locución al actualizar latido/mute
      const voiceId = String(body?.voiceId || 'Kore').trim().slice(0, 32) || 'Kore'
      const { error: upsertErr } = await supabaseAdmin
        .from('order_ready_device_status')
        .upsert(
          {
            store_code: storeCode,
            device_role: 'speaker_board',
            last_heartbeat_at: nowIso,
            is_muted: Boolean(body?.isMuted),
            audio_unlocked: Boolean(body?.audioUnlocked),
            voice_id: voiceId,
            voice_volume: clampVolume(body?.voiceVolume),
            is_fullscreen: Boolean(body?.isFullscreen),
            updated_at: nowIso
          },
          { onConflict: 'store_code,device_role' }
        )

      if (upsertErr) {
        return NextResponse.json({ error: upsertErr.message }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        action: 'heartbeat',
        storeCode,
        deviceRole,
        recordedAt: nowIso
      })
    }

    if (action === 'playback_ack') {
      const orderNumber = String(body?.orderNumber || '').trim().slice(0, 32)
      const triggerSource = String(body?.triggerSource || '').trim()
      const engineUsed = String(body?.engineUsed || '').trim()

      if (!orderNumber) {
        return NextResponse.json({ error: 'orderNumber es obligatorio' }, { status: 400 })
      }
      if (!ALLOWED_TRIGGER_SOURCES.has(triggerSource)) {
        return NextResponse.json({ error: 'triggerSource inválido' }, { status: 400 })
      }
      if (!ALLOWED_ENGINES.has(engineUsed)) {
        return NextResponse.json({ error: 'engineUsed inválido' }, { status: 400 })
      }

      const businessDate = getCaliforniaBusinessDate(new Date(nowMs))
      const rawOrderId = typeof body?.orderId === 'string' ? body.orderId.trim() : ''
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawOrderId)

      let resolvedOrderId: string | null = isUuid ? rawOrderId : null
      if (!resolvedOrderId && /^\d{1,6}$/.test(orderNumber)) {
        const { data: matchedRow } = await supabaseAdmin
          .from('order_ready_announcements')
          .select('id')
          .eq('store_code', storeCode)
          .eq('business_date', businessDate)
          .eq('order_number', orderNumber)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        resolvedOrderId = matchedRow?.id || null
      }

      const calledAtMs = body?.calledAt ? Date.parse(String(body.calledAt)) : NaN
      const calledAtIso = Number.isFinite(calledAtMs) ? new Date(calledAtMs).toISOString() : null
      const latencyMs =
        Number.isFinite(calledAtMs) && nowMs >= calledAtMs && nowMs - calledAtMs <= 600_000
          ? Math.round(nowMs - calledAtMs)
          : null

      const voiceId = String(body?.voiceId || 'Kore').trim().slice(0, 32) || 'Kore'
      const voiceVolume = clampVolume(body?.voiceVolume)
      const diningOption = body?.diningOption ? String(body.diningOption).trim().slice(0, 32) : null

      const [insertRes, statusRes] = await Promise.all([
        supabaseAdmin.from('order_ready_voice_playbacks').insert({
          store_code: storeCode,
          business_date: businessDate,
          order_id: resolvedOrderId,
          order_number: orderNumber,
          dining_option: diningOption,
          trigger_source: triggerSource,
          engine_used: engineUsed,
          voice_id: voiceId,
          voice_volume: voiceVolume,
          called_at: calledAtIso,
          played_at: nowIso,
          latency_ms: latencyMs
        }),
        supabaseAdmin.from('order_ready_device_status').upsert(
          {
            store_code: storeCode,
            device_role: 'speaker_board',
            last_heartbeat_at: nowIso,
            is_muted: Boolean(body?.isMuted),
            audio_unlocked: true,
            voice_id: voiceId,
            voice_volume: voiceVolume,
            is_fullscreen: Boolean(body?.isFullscreen),
            last_played_at: nowIso,
            last_played_order_number: orderNumber,
            last_engine: engineUsed,
            updated_at: nowIso
          },
          { onConflict: 'store_code,device_role' }
        )
      ])

      if (insertRes.error) {
        return NextResponse.json({ error: insertRes.error.message }, { status: 500 })
      }
      if (statusRes.error) {
        return NextResponse.json({ error: statusRes.error.message }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        action: 'playback_ack',
        storeCode,
        orderNumber,
        businessDate,
        latencyMs,
        playedAt: nowIso
      })
    }

    return NextResponse.json(
      { error: 'action inválida (esperado: heartbeat | playback_ack)' },
      { status: 400 }
    )
  } catch (err: any) {
    console.error('[order-ready/telemetry] POST exception:', err)
    return NextResponse.json(
      { error: err?.message || 'Error interno en telemetría de voz' },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const range = searchParams.get('range') === '7d' ? '7d' : 'today'
    const requestedStore = String(searchParams.get('storeCode') || 'ALL').trim().toUpperCase()
    const isTestStore = isIsolatedTestStoreCode(requestedStore)

    const access = await getOrderReadyAccess(request)
    if (!access && !isTestStore) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    let storeCodes: string[]
    if (requestedStore !== 'ALL') {
      if (access && !canAccessStore(access, requestedStore) && !isTestStore) {
        return NextResponse.json({ error: 'Sin acceso a esta tienda' }, { status: 403 })
      }
      storeCodes = [requestedStore]
    } else if (access?.all) {
      storeCodes = Object.keys(STORE_GUID_BY_CODE).sort()
    } else {
      storeCodes = [...(access?.codes || [])].sort()
    }

    const endDate = getCaliforniaBusinessDate()
    const startDate = range === '7d' ? subtractDaysIso(endDate, 6) : endDate
    const nowMs = Date.now()

    const [rpcRes, settingsRes] = await Promise.all([
      supabaseAdmin.rpc('get_order_ready_telemetry_summary', {
        p_start_date: startDate,
        p_end_date: endDate,
        p_store_codes: storeCodes
      }),
      supabaseAdmin
        .from('order_ready_settings')
        .select('updated_by')
        .eq('id', 'auto_call_timer_config')
        .maybeSingle()
    ])

    if (rpcRes.error) {
      return NextResponse.json({ error: rpcRes.error.message }, { status: 500 })
    }

    let autoConfig = DEFAULT_AUTO_CALL_TIMER_CONFIG
    if (settingsRes.data?.updated_by) {
      try {
        autoConfig = sanitizeAutoCallTimerConfig(JSON.parse(settingsRes.data.updated_by))
      } catch {
        autoConfig = DEFAULT_AUTO_CALL_TIMER_CONFIG
      }
    }

    const rowMap = new Map<string, any>()
    for (const r of (rpcRes.data || []) as any[]) {
      if (r?.store_code) {
        rowMap.set(String(r.store_code).toUpperCase(), r)
      }
    }

    const stores: StoreTelemetryItem[] = storeCodes.map((code) => {
      const r = rowMap.get(code)
      const prepLastHeartbeatAt: string | null = r?.prep_last_heartbeat_at || null
      const speakerLastHeartbeatAt: string | null = r?.speaker_last_heartbeat_at || null

      const prepHbMs = prepLastHeartbeatAt ? Date.parse(prepLastHeartbeatAt) : NaN
      const spkHbMs = speakerLastHeartbeatAt ? Date.parse(speakerLastHeartbeatAt) : NaN

      const tabletOnline = Number.isFinite(prepHbMs) && nowMs - prepHbMs <= ONLINE_WINDOW_MS
      const speakerOnline = Number.isFinite(spkHbMs) && nowMs - spkHbMs <= ONLINE_WINDOW_MS

      const speakerIsMuted = Boolean(r?.speaker_is_muted)
      const speakerAudioUnlocked = Boolean(r?.speaker_audio_unlocked)
      const speakerVoiceVolume =
        r?.speaker_voice_volume !== null && r?.speaker_voice_volume !== undefined
          ? clampVolume(Number(r.speaker_voice_volume))
          : 1.0
      const speakerEffectiveMuted = speakerIsMuted || speakerVoiceVolume <= 0

      let speakerState: SpeakerLiveState = 'offline'
      if (speakerOnline) {
        if (speakerEffectiveMuted) {
          speakerState = 'muted'
        } else if (!speakerAudioUnlocked) {
          speakerState = 'audio_locked'
        } else {
          speakerState = 'active'
        }
      }

      const totalOrders = Number(r?.total_orders || 0)
      const tabletCalledOrders = Number(r?.tablet_called_orders || 0)
      const pctTabletCalled =
        totalOrders > 0
          ? Math.round((1000 * tabletCalledOrders) / totalOrders) / 10
          : 0

      return {
        storeCode: code,
        storeName: resolveStoreDisplayName(code),
        autoCallMode: getStoreAutoCallMode(autoConfig, code),
        tabletOnline,
        prepLastHeartbeatAt,
        speakerState,
        speakerOnline,
        speakerLastHeartbeatAt,
        speakerIsMuted: speakerEffectiveMuted,
        speakerAudioUnlocked,
        speakerVoiceId: String(r?.speaker_voice_id || 'Kore'),
        speakerVoiceVolume,
        speakerIsFullscreen: Boolean(r?.speaker_is_fullscreen),
        speakerLastPlayedAt: r?.speaker_last_played_at || null,
        speakerLastPlayedOrder: r?.speaker_last_played_order || null,
        speakerLastEngine: r?.speaker_last_engine || null,
        totalOrders,
        tabletCalledOrders,
        pctTabletCalled,
        specialButtonsCalled: Number(r?.special_buttons_called || 0),
        speakerConfirmedOrders: Number(r?.speaker_confirmed_orders || 0),
        totalPlaybackEvents: Number(r?.total_playback_events || 0),
        callsSinceSpeakerActive: Number(r?.calls_since_speaker_active || 0),
        unheardCallsSinceActive: Number(r?.unheard_calls_since_active || 0),
        avgPrepToCallSec:
          r?.avg_prep_to_call_sec !== null && r?.avg_prep_to_call_sec !== undefined
            ? Number(r.avg_prep_to_call_sec)
            : null,
        avgCallToBumpSec:
          r?.avg_call_to_bump_sec !== null && r?.avg_call_to_bump_sec !== undefined
            ? Number(r.avg_call_to_bump_sec)
            : null,
        avgSpeakerLatencyMs:
          r?.avg_speaker_latency_ms !== null && r?.avg_speaker_latency_ms !== undefined
            ? Number(r.avg_speaker_latency_ms)
            : null,
        lastTabletCallAt: r?.last_tablet_call_at || null,
        lastOrderCreatedAt: r?.last_order_created_at || null
      }
    })

    stores.sort((a, b) => {
      if (b.pctTabletCalled !== a.pctTabletCalled) return b.pctTabletCalled - a.pctTabletCalled
      if (b.tabletCalledOrders !== a.tabletCalledOrders) return b.tabletCalledOrders - a.tabletCalledOrders
      return a.storeName.localeCompare(b.storeName)
    })

    const totalOrdersAll = stores.reduce((acc, s) => acc + s.totalOrders, 0)
    const totalCalledAll = stores.reduce((acc, s) => acc + s.tabletCalledOrders, 0)
    const totalSpecialButtonsAll = stores.reduce((acc, s) => acc + s.specialButtonsCalled, 0)
    const totalConfirmedOrdersAll = stores.reduce((acc, s) => acc + s.speakerConfirmedOrders, 0)
    const totalPlaybackEventsAll = stores.reduce((acc, s) => acc + s.totalPlaybackEvents, 0)
    const totalUnheardSinceActiveAll = stores.reduce((acc, s) => acc + s.unheardCallsSinceActive, 0)

    const latencyVals = stores
      .filter((s) => s.avgSpeakerLatencyMs !== null)
      .map((s) => s.avgSpeakerLatencyMs as number)
    const avgLatencyMs =
      latencyVals.length > 0
        ? Math.round(latencyVals.reduce((a, b) => a + b, 0) / latencyVals.length)
        : null

    const summary = {
      storeCount: stores.length,
      totalOrders: totalOrdersAll,
      tabletCalledOrders: totalCalledAll,
      chainPctTabletCalled:
        totalOrdersAll > 0 ? Math.round((1000 * totalCalledAll) / totalOrdersAll) / 10 : 0,
      specialButtonsCalled: totalSpecialButtonsAll,
      speakerConfirmedOrders: totalConfirmedOrdersAll,
      totalPlaybackEvents: totalPlaybackEventsAll,
      unheardCallsSinceActive: totalUnheardSinceActiveAll,
      avgSpeakerLatencyMs: avgLatencyMs,
      tabletsOnline: stores.filter((s) => s.tabletOnline).length,
      speakersActive: stores.filter((s) => s.speakerState === 'active').length,
      speakersMuted: stores.filter((s) => s.speakerState === 'muted').length,
      speakersAudioLocked: stores.filter((s) => s.speakerState === 'audio_locked').length,
      speakersOffline: stores.filter((s) => s.speakerState === 'offline').length
    }

    return NextResponse.json({
      success: true,
      range,
      startDate,
      endDate,
      generatedAt: new Date(nowMs).toISOString(),
      summary,
      stores
    })
  } catch (err: any) {
    console.error('[order-ready/telemetry] GET exception:', err)
    return NextResponse.json(
      { error: err?.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}
