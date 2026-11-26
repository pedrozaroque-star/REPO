/**
 * @module api/remote-control/devices
 * @description Endpoint administrativo para registrar nuevos equipos (PC adicional, Tableta Android o TV)
 *              en el inventario del Centro de Control Remoto de Tacos Gavilan.
 *
 * @businessRules
 * - Acceso exclusivo para administradores activos (`requireActiveAdmin`).
 * - Valida `storeCode` contra las 15 sucursales canónicas + `BODEGA`.
 * - Genera `device_key` único determinístico (`storeCode:deviceType:deviceRole`).
 *
 * @dataFlow
 * - UI `/admin/control-remoto` -> POST `/api/remote-control/devices` -> Supabase (`remote_fleet_devices`).
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  buildDeviceKey,
  DEFAULT_PC_WATCHDOG_CONFIG,
  getRemoteStoreDisplayName,
  isSafeHttpOrHttpsUrl,
  normalizeRemoteStoreCode,
  sanitizePcWatchdogConfig,
  type RemoteDeviceType,
  type RemoteToolProvider,
} from '@/lib/remote-control'
import { requireActiveAdmin, stripDeviceSecrets } from '@/lib/remote-control-server'

export const dynamic = 'force-dynamic'

const ALLOWED_TYPES = new Set<RemoteDeviceType>(['windows_pc', 'android_tablet', 'tv_display'])
const ALLOWED_PROVIDERS = new Set<RemoteToolProvider>([
  'action1',
  'rustdesk',
  'fully_kiosk',
  'chrome_rdp',
  'meshcentral',
  'none',
])

export async function POST(request: Request) {
  const auth = await requireActiveAdmin(request)
  if (!auth.authorized) return auth.response!

  try {
    const body = await request.json()
    const storeCode = normalizeRemoteStoreCode(body?.storeCode)
    if (!storeCode) {
      return NextResponse.json({ error: 'Sucursal inválida' }, { status: 400 })
    }

    const deviceType = String(body?.deviceType || '').trim() as RemoteDeviceType
    if (!ALLOWED_TYPES.has(deviceType)) {
      return NextResponse.json({ error: 'Tipo de equipo inválido' }, { status: 400 })
    }

    const rawRole = String(body?.deviceRole || '').trim() || (
      deviceType === 'windows_pc'
        ? 'extra_pc'
        : deviceType === 'android_tablet'
          ? 'prep_tablet'
          : 'tv_screen_1'
    )
    const deviceKey = buildDeviceKey(storeCode, deviceType, rawRole)
    const storeName = getRemoteStoreDisplayName(storeCode)

    const displayName = String(body?.displayName || '').trim().slice(0, 120) ||
      `${storeName} — ${rawRole}`

    const provider = String(body?.remoteToolProvider || (deviceType === 'windows_pc' ? 'action1' : 'rustdesk')).trim() as RemoteToolProvider
    const safeProvider: RemoteToolProvider = ALLOWED_PROVIDERS.has(provider) ? provider : 'none'

    const rawUrl = typeof body?.remoteToolUrl === 'string' ? body.remoteToolUrl.trim() : ''
    if (rawUrl && !isSafeHttpOrHttpsUrl(rawUrl)) {
      return NextResponse.json({ error: 'URL de herramienta remota inválida (debe ser http/https)' }, { status: 400 })
    }

    const remoteToolDeviceId = typeof body?.remoteToolDeviceId === 'string'
      ? body.remoteToolDeviceId.trim().slice(0, 120) || null
      : null

    const notes = typeof body?.notes === 'string' ? body.notes.trim().slice(0, 500) || null : null

    const desiredConfig =
      deviceType === 'windows_pc'
        ? sanitizePcWatchdogConfig(body?.desiredConfig || DEFAULT_PC_WATCHDOG_CONFIG)
        : (body?.desiredConfig && typeof body.desiredConfig === 'object' ? body.desiredConfig : {})

    const { data, error } = await supabaseAdmin
      .from('remote_fleet_devices')
      .insert({
        store_code: storeCode,
        device_type: deviceType,
        device_role: rawRole.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 48),
        device_key: deviceKey,
        display_name: displayName,
        enrollment_status: deviceType === 'windows_pc' ? 'pending' : 'enrolled',
        remote_tool_provider: safeProvider,
        remote_tool_url: rawUrl || null,
        remote_tool_device_id: remoteToolDeviceId,
        desired_config: desiredConfig,
        notes,
      })
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Ya existe un equipo registrado con ese rol en esa sucursal.' },
          { status: 409 }
        )
      }
      throw error
    }

    return NextResponse.json(
      { success: true, device: stripDeviceSecrets(data) },
      { status: 201 }
    )
  } catch (err: any) {
    console.error('❌ [api/remote-control/devices POST] Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Error registrando dispositivo' },
      { status: 500 }
    )
  }
}
