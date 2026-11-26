/**
 * @module api/remote-control/fleet
 * @description Endpoint administrativo maestro que entrega la foto completa de la flota remota de Tacos Gavilan:
 *              PCs Windows, Tabletas Android, TVs de Menú, cruce en vivo con telemetría de bocina (`order_ready_device_status`),
 *              configuración global (`remote_fleet_settings`) e historial reciente de comandos.
 *
 * @businessRules
 * - Acceso exclusivo para administradores activos (`requireActiveAdmin`).
 * - Expira automáticamente comandos vencidos antes de construir el resumen.
 * - Nunca expone `agent_token_hash` hacia el cliente.
 * - Ordena dispositivos por sucursal A–Z y tipo de equipo.
 *
 * @dataFlow
 * - UI `/admin/control-remoto` -> GET `/api/remote-control/fleet` -> Supabase (`remote_fleet_devices`, `remote_fleet_commands`, `remote_fleet_settings`, `order_ready_device_status`).
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getCaliforniaBusinessDate } from '@/lib/business-date'
import {
  DEFAULT_PC_WATCHDOG_CONFIG,
  getRemoteStoreDisplayName,
  isDeviceOnline,
  type RemoteDeviceType,
  type RemoteFleetDevice,
} from '@/lib/remote-control'
import {
  expireStaleCommands,
  requireActiveAdmin,
  stripDeviceSecrets,
} from '@/lib/remote-control-server'

export const dynamic = 'force-dynamic'

const SPEAKER_ONLINE_WINDOW_MS = 660_000

export async function GET(request: Request) {
  const auth = await requireActiveAdmin(request)
  if (!auth.authorized) return auth.response!

  try {
    await expireStaleCommands()

    const [devicesRes, settingsRes, commandsRes, orderReadyRes] = await Promise.all([
      supabaseAdmin
        .from('remote_fleet_devices')
        .select('*')
        .order('store_code', { ascending: true })
        .order('device_type', { ascending: true })
        .order('display_name', { ascending: true }),
      supabaseAdmin
        .from('remote_fleet_settings')
        .select('*')
        .eq('id', 'global')
        .maybeSingle(),
      supabaseAdmin
        .from('remote_fleet_commands')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100),
      supabaseAdmin
        .from('order_ready_device_status')
        .select('store_code, device_role, last_heartbeat_at, is_muted, audio_unlocked, voice_id, voice_volume, is_fullscreen, last_played_at, last_played_order_number'),
    ])

    if (devicesRes.error) throw devicesRes.error
    if (commandsRes.error) throw commandsRes.error

    const nowMs = Date.now()
    const orderReadyMap = new Map<string, any>()
    for (const row of orderReadyRes.data || []) {
      orderReadyMap.set(`${row.store_code}:${row.device_role}`, row)
    }

    const deviceNameMap = new Map<string, string>()

    const devices = (devicesRes.data || []).map((raw: any) => {
      const clean = stripDeviceSecrets(raw) as RemoteFleetDevice
      deviceNameMap.set(clean.id, clean.display_name)
      const online = isDeviceOnline(clean, nowMs)

      // Cruzar estado real de bocina/tableta Order Ready si aplica
      let linkedOrderReady: any = null
      if (clean.device_type === 'windows_pc' && clean.device_role === 'office_speaker_pc') {
        const sp = orderReadyMap.get(`${clean.store_code}:speaker_board`)
        if (sp) {
          const spOnline = sp.last_heartbeat_at
            ? nowMs - new Date(sp.last_heartbeat_at).getTime() <= SPEAKER_ONLINE_WINDOW_MS
            : false
          linkedOrderReady = {
            speakerOnline: spOnline,
            isMuted: Boolean(sp.is_muted),
            audioUnlocked: Boolean(sp.audio_unlocked),
            voiceId: sp.voice_id,
            voiceVolume: Number(sp.voice_volume ?? 1),
            isFullscreen: Boolean(sp.is_fullscreen),
            lastPlayedAt: sp.last_played_at,
            lastPlayedOrder: sp.last_played_order_number,
            lastHeartbeatAt: sp.last_heartbeat_at,
          }
        }
      } else if (clean.device_type === 'android_tablet' && clean.device_role === 'prep_tablet') {
        const pt = orderReadyMap.get(`${clean.store_code}:prep_tablet`)
        if (pt) {
          const ptOnline = pt.last_heartbeat_at
            ? nowMs - new Date(pt.last_heartbeat_at).getTime() <= SPEAKER_ONLINE_WINDOW_MS
            : false
          linkedOrderReady = {
            prepTabletOnline: ptOnline,
            lastHeartbeatAt: pt.last_heartbeat_at,
          }
        }
      }

      return {
        ...clean,
        storeName: getRemoteStoreDisplayName(clean.store_code),
        online,
        linkedOrderReady,
      }
    })

    const todayBusinessDate = getCaliforniaBusinessDate()
    const commands = (commandsRes.data || []).map((c: any) => ({
      ...c,
      storeName: getRemoteStoreDisplayName(c.store_code),
      deviceName: deviceNameMap.get(c.device_id) || c.device_id,
    }))

    const byType: Record<RemoteDeviceType, { total: number; online: number; pending: number }> = {
      windows_pc: { total: 0, online: 0, pending: 0 },
      android_tablet: { total: 0, online: 0, pending: 0 },
      tv_display: { total: 0, online: 0, pending: 0 },
    }

    let onlineDevices = 0
    let pendingEnrollment = 0
    for (const d of devices) {
      byType[d.device_type].total += 1
      if (d.online) {
        onlineDevices += 1
        byType[d.device_type].online += 1
      }
      if (d.enrollment_status === 'pending') {
        pendingEnrollment += 1
        byType[d.device_type].pending += 1
      }
    }

    const recent24hCutoff = nowMs - 24 * 60 * 60 * 1000
    const commandsLast24h = commands.filter(
      (c: any) => new Date(c.created_at).getTime() >= recent24hCutoff
    ).length

    const settings = settingsRes.data || {
      id: 'global',
      action1_org_url: null,
      action1_installer_url: null,
      rustdesk_relay_host: null,
      rustdesk_public_key: null,
      default_pc_watchdog: DEFAULT_PC_WATCHDOG_CONFIG,
      updated_by: null,
      updated_at: new Date().toISOString(),
    }

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      businessDate: todayBusinessDate,
      summary: {
        totalDevices: devices.length,
        onlineDevices,
        offlineDevices: Math.max(0, devices.length - onlineDevices),
        pendingEnrollment,
        commandsLast24h,
        byType,
      },
      settings,
      devices,
      recentCommands: commands,
    })
  } catch (err: any) {
    console.error('❌ [api/remote-control/fleet] Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Error consultando la flota remota' },
      { status: 500 }
    )
  }
}
