/**
 * @module api/remote-control/web-bridge
 * @description Bridge remoto ligero para tabletas Android de sucursal (`/inventory/preparador` y
 *              `/tablet/blindaje-delivery`) que auto-registra el equipo en `remote_fleet_devices`,
 *              reporta telemetría (batería, ruta, fullscreen, resolución) y ejecuta comandos seguros
 *              enviados desde `/admin/control-remoto` sin requerir visitar la tienda.
 *
 * @businessRules
 * - Soporta roles `'prep_tablet'` y `'delivery_tablet'`.
 * - Para `'prep_tablet'` exige sesión staff autenticada (`verifyStaffAuth`) con acceso a la sucursal.
 * - Para `'delivery_tablet'` (kiosco público con PIN RONOS) aplica rate limiting estricto y valida `storeCode`
 *   contra el catálogo oficial de sucursales.
 * - Nunca sobrescribe configuraciones guardadas por Admin (`remote_tool_url`, `remote_tool_provider`, `notes`, `display_name`).
 * - Solo entrega comandos de la lista blanca segura de navegador (`TABLET_COMMANDS`); jamás ejecuta código arbitrario.
 *
 * @dataFlow
 * - `components/RemoteDeviceBridge.tsx` (cada 45s) -> POST `/api/remote-control/web-bridge` -> Supabase (`remote_fleet_devices`, `remote_fleet_commands`).
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { authorizeStoreScope, checkRateLimit, getServerUser, verifyStaffAuth } from '@/lib/auth-server'
import { STORE_GUID_BY_CODE } from '@/lib/toast-stores'
import {
  buildDeviceKey,
  getRemoteStoreDisplayName,
  normalizeRemoteStoreCode,
  TABLET_COMMANDS,
} from '@/lib/remote-control'
import {
  expireStaleCommands,
  extractClientIp,
  truncateCommandOutput,
} from '@/lib/remote-control-server'

export const dynamic = 'force-dynamic'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALLOWED_ROLES = new Set(['prep_tablet', 'delivery_tablet'])
const ALLOWED_TABLET_CMD_SET = new Set<string>(TABLET_COMMANDS)

export async function POST(request: Request) {
  const ip = extractClientIp(request)
  const rl = checkRateLimit(`remote_web_bridge:${ip}`, 120, 60_000)
  if (rl.limited) {
    return NextResponse.json(
      { error: 'Demasiadas peticiones de bridge', retryAfterSec: rl.retryAfterSec },
      { status: 429 }
    )
  }

  try {
    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || 'sync').trim().toLowerCase()
    const deviceRole = String(body?.deviceRole || '').trim().toLowerCase()
    const storeCode = normalizeRemoteStoreCode(body?.storeCode)

    if (!ALLOWED_ROLES.has(deviceRole)) {
      return NextResponse.json({ error: 'deviceRole inválido' }, { status: 400 })
    }
    if (!storeCode) {
      return NextResponse.json({ error: 'storeCode inválido' }, { status: 400 })
    }

    // Seguridad por rol: prep_tablet exige JWT staff válido con alcance a esa sucursal
    if (deviceRole === 'prep_tablet') {
      const staff = verifyStaffAuth(request)
      if (!staff.authorized) {
        return staff.response || NextResponse.json({ error: 'No autorizado' }, { status: 401 })
      }
      const user = await getServerUser(request)
      const targetStoreRef = STORE_GUID_BY_CODE[storeCode] || storeCode
      const scope = await authorizeStoreScope(user, targetStoreRef, supabaseAdmin, {
        action: 'view',
      })
      if (!scope.authorized) {
        return NextResponse.json(
          { error: scope.error || 'Sucursal fuera de alcance' },
          { status: scope.status || 403 }
        )
      }
    }

    const deviceKey = buildDeviceKey(storeCode, 'android_tablet', deviceRole)
    const nowIso = new Date().toISOString()

    // Buscar o crear el registro preservando configuraciones administrativas existentes
    let { data: device, error: findErr } = await supabaseAdmin
      .from('remote_fleet_devices')
      .select('*')
      .eq('device_key', deviceKey)
      .maybeSingle()

    if (findErr) throw findErr

    const incomingTelemetry =
      body?.telemetry && typeof body.telemetry === 'object' ? body.telemetry : {}

    const safeTelemetry = {
      route: typeof incomingTelemetry.route === 'string' ? incomingTelemetry.route.slice(0, 120) : null,
      batteryPct: Number.isFinite(Number(incomingTelemetry.batteryPct))
        ? Math.max(0, Math.min(100, Math.round(Number(incomingTelemetry.batteryPct))))
        : null,
      isCharging: typeof incomingTelemetry.isCharging === 'boolean' ? incomingTelemetry.isCharging : null,
      isFullscreen: typeof incomingTelemetry.isFullscreen === 'boolean' ? incomingTelemetry.isFullscreen : null,
      screenResolution:
        typeof incomingTelemetry.screenResolution === 'string'
          ? incomingTelemetry.screenResolution.slice(0, 32)
          : null,
      userAgent:
        typeof incomingTelemetry.userAgent === 'string'
          ? incomingTelemetry.userAgent.slice(0, 220)
          : null,
      wakeLockActive:
        typeof incomingTelemetry.wakeLockActive === 'boolean' ? incomingTelemetry.wakeLockActive : null,
    }

    if (!device) {
      const storeName = getRemoteStoreDisplayName(storeCode)
      const roleLabel =
        deviceRole === 'prep_tablet' ? 'Tableta Preparador Cocina' : 'Tableta Blindaje Delivery'

      const { data: created, error: insErr } = await supabaseAdmin
        .from('remote_fleet_devices')
        .insert({
          store_code: storeCode,
          device_type: 'android_tablet',
          device_role: deviceRole,
          device_key: deviceKey,
          display_name: `${storeName} — ${roleLabel}`,
          enrollment_status: 'enrolled',
          remote_tool_provider: 'rustdesk',
          telemetry: safeTelemetry,
          last_heartbeat_at: nowIso,
          last_ip: ip,
          updated_at: nowIso,
        })
        .select('*')
        .single()

      if (insErr) throw insErr
      device = created
    } else if (device.enrollment_status === 'revoked') {
      return NextResponse.json({ success: true, commands: [], revoked: true })
    } else if (action === 'sync') {
      await supabaseAdmin
        .from('remote_fleet_devices')
        .update({
          telemetry: { ...(device.telemetry || {}), ...safeTelemetry },
          last_heartbeat_at: nowIso,
          last_ip: ip,
          updated_at: nowIso,
        })
        .eq('id', device.id)
    }

    if (action === 'ack') {
      const commandId = String(body?.commandId || '').trim()
      if (!UUID_REGEX.test(commandId)) {
        return NextResponse.json({ error: 'commandId inválido' }, { status: 400 })
      }
      const status = String(body?.status || 'succeeded').trim().toLowerCase()
      const finalStatus = status === 'failed' ? 'failed' : 'succeeded'

      await supabaseAdmin
        .from('remote_fleet_commands')
        .update({
          status: finalStatus,
          completed_at: nowIso,
          result_exit_code: finalStatus === 'succeeded' ? 0 : 1,
          result_output: truncateCommandOutput(body?.output, 2000),
          error_message: body?.errorMessage ? truncateCommandOutput(body.errorMessage, 1000) : null,
        })
        .eq('id', commandId)
        .eq('device_id', device.id)

      await supabaseAdmin
        .from('remote_fleet_devices')
        .update({
          last_heartbeat_at: nowIso,
          last_command_ack_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', device.id)

      return NextResponse.json({ success: true })
    }

    // action === 'sync': expirar vencidos y entregar comandos pendientes
    await expireStaleCommands(device.id)

    const { data: pending, error: cmdErr } = await supabaseAdmin
      .from('remote_fleet_commands')
      .select('id, command_type, payload, created_at, expires_at')
      .eq('device_id', device.id)
      .eq('status', 'pending')
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: true })
      .limit(5)

    if (cmdErr) throw cmdErr

    const safeCommands = (pending || []).filter((c) => ALLOWED_TABLET_CMD_SET.has(c.command_type))
    if (safeCommands.length > 0) {
      await supabaseAdmin
        .from('remote_fleet_commands')
        .update({ status: 'dispatched', dispatched_at: nowIso })
        .in('id', safeCommands.map((c) => c.id))
        .eq('status', 'pending')
    }

    return NextResponse.json({
      success: true,
      deviceId: device.id,
      commands: safeCommands,
    })
  } catch (err: any) {
    console.error('❌ [api/remote-control/web-bridge] Error:', err)
    return NextResponse.json({ error: err?.message || 'Error en web-bridge' }, { status: 500 })
  }
}
