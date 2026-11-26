/**
 * @module api/remote-control/commands
 * @description Endpoint administrativo para emitir, consultar y cancelar comandos remotos
 *              hacia un equipo específico o en lote masivo ("Aplicar a las 15 sucursales")
 *              sobre PCs Windows, Tabletas Android y TVs de Menú Digital.
 *
 * @businessRules
 * - Acceso exclusivo para administradores activos (`requireActiveAdmin`).
 * - Valida cada `commandType` contra la lista blanca de su `device_type` (`COMMANDS_BY_DEVICE_TYPE`).
 * - Sanitiza estrictamente payloads (volumen 0–100, rutas internas `/...`, URLs `https://`, texto plano anti-XSS).
 * - Los comandos de `reboot_pc` vencen en 5 minutos; el resto en 15 minutos por defecto (máximo 60 min).
 * - Para comandos de TV persistentes (`set_blackout`, `show_overlay`, `clear_overlay`), sincroniza
 *   también `desired_config` en `remote_fleet_devices` para sobrevivir reinicios de la TV.
 *
 * @dataFlow
 * - UI `/admin/control-remoto` -> POST/GET/PATCH `/api/remote-control/commands` -> Supabase (`remote_fleet_commands`).
 */

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  getRemoteStoreDisplayName,
  isSafeHttpOrHttpsUrl,
  isSafeInternalRoute,
  isValidCommandForDeviceType,
  normalizeRemoteStoreCode,
  sanitizePlainOverlayText,
  type RemoteDeviceType,
} from '@/lib/remote-control'
import { expireStaleCommands, requireActiveAdmin } from '@/lib/remote-control-server'

export const dynamic = 'force-dynamic'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sanitizeCommandPayload(
  deviceType: RemoteDeviceType,
  commandType: string,
  rawPayload: unknown
): { ok: true; payload: Record<string, any> } | { ok: false; error: string } {
  const src = (rawPayload && typeof rawPayload === 'object' ? rawPayload : {}) as Record<string, any>

  switch (commandType) {
    case 'set_volume': {
      const vol = Number(src.volumePct)
      if (!Number.isFinite(vol) || vol < 0 || vol > 100) {
        return { ok: false, error: 'El volumen debe estar entre 0 y 100.' }
      }
      return { ok: true, payload: { volumePct: Math.round(vol) } }
    }
    case 'open_url': {
      const url = String(src.url || '').trim()
      if (!isSafeHttpOrHttpsUrl(url) && !isSafeInternalRoute(url)) {
        return { ok: false, error: 'URL inválida: debe iniciar con https:// o ser una ruta interna /...' }
      }
      return { ok: true, payload: { url, fullscreen: Boolean(src.fullscreen) } }
    }
    case 'reopen_board':
    case 'restart_browser': {
      const targetPath = src.targetPath ? String(src.targetPath).trim() : '/order-ready-board'
      if (!isSafeInternalRoute(targetPath) && !isSafeHttpOrHttpsUrl(targetPath)) {
        return { ok: false, error: 'Ruta de tablero inválida.' }
      }
      return { ok: true, payload: { targetPath, fullscreen: Boolean(src.fullscreen) } }
    }
    case 'navigate_url': {
      const targetRoute = String(src.url || src.targetPath || '').trim()
      if (!isSafeInternalRoute(targetRoute)) {
        return { ok: false, error: 'Para tabletas, la navegación solo permite rutas internas válidas (ej. /inventory/preparador).' }
      }
      return { ok: true, payload: { url: targetRoute } }
    }
    case 'show_banner':
    case 'show_overlay': {
      const message = sanitizePlainOverlayText(src.message, 280)
      if (!message) {
        return { ok: false, error: 'Escribe un mensaje válido para mostrar en pantalla.' }
      }
      const durationSecRaw = Number(src.durationSec ?? 0)
      const durationSec = Number.isFinite(durationSecRaw)
        ? Math.max(0, Math.min(3600, Math.round(durationSecRaw)))
        : 0
      return { ok: true, payload: { message, durationSec } }
    }
    case 'switch_screen': {
      const sn = parseInt(String(src.screenNumber ?? ''), 10)
      if (!Number.isFinite(sn) || sn < 1 || sn > 20) {
        return { ok: false, error: 'El número de pantalla TV debe estar entre 1 y 20.' }
      }
      return { ok: true, payload: { screenNumber: sn } }
    }
    case 'set_blackout': {
      return {
        ok: true,
        payload: {
          blackout: Boolean(src.blackout),
          message: sanitizePlainOverlayText(src.message, 180) || null,
        },
      }
    }
    case 'run_powershell': {
      if (deviceType !== 'windows_pc') {
        return { ok: false, error: 'PowerShell solo es válido en equipos Windows PC.' }
      }
      const script = String(src.script || '').trim()
      if (!script) {
        return { ok: false, error: 'El script PowerShell no puede estar vacío.' }
      }
      if (script.length > 12_000) {
        return { ok: false, error: 'El script excede el límite seguro de 12,000 caracteres.' }
      }
      return { ok: true, payload: { script } }
    }
    default:
      return { ok: true, payload: src }
  }
}

export async function GET(request: Request) {
  const auth = await requireActiveAdmin(request)
  if (!auth.authorized) return auth.response!

  try {
    await expireStaleCommands()
    const { searchParams } = new URL(request.url)
    const deviceId = searchParams.get('deviceId')?.trim() || ''
    const storeCode = normalizeRemoteStoreCode(searchParams.get('storeCode'))
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '60', 10) || 60, 1), 200)

    let query = supabaseAdmin
      .from('remote_fleet_commands')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (deviceId && UUID_REGEX.test(deviceId)) {
      query = query.eq('device_id', deviceId)
    }
    if (storeCode) {
      query = query.eq('store_code', storeCode)
    }

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({
      success: true,
      commands: (data || []).map((c: any) => ({
        ...c,
        storeName: getRemoteStoreDisplayName(c.store_code),
      })),
    })
  } catch (err: any) {
    console.error('❌ [api/remote-control/commands GET] Error:', err)
    return NextResponse.json({ error: err?.message || 'Error consultando comandos' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await requireActiveAdmin(request)
  if (!auth.authorized) return auth.response!

  try {
    const body = await request.json()
    const commandType = String(body?.commandType || '').trim()
    if (!commandType) {
      return NextResponse.json({ error: 'Falta commandType' }, { status: 400 })
    }

    // Resolver lista de dispositivos destino: individual, lista explícita o lote por tipo/sucursales
    let targetDevices: any[] = []

    if (body?.deviceId && UUID_REGEX.test(String(body.deviceId))) {
      const { data, error } = await supabaseAdmin
        .from('remote_fleet_devices')
        .select('*')
        .eq('id', String(body.deviceId))
        .maybeSingle()
      if (error) throw error
      if (!data) return NextResponse.json({ error: 'Dispositivo no encontrado' }, { status: 404 })
      targetDevices = [data]
    } else if (Array.isArray(body?.deviceIds) && body.deviceIds.length > 0) {
      const validIds = body.deviceIds.filter((x: unknown) => typeof x === 'string' && UUID_REGEX.test(x))
      if (validIds.length === 0) {
        return NextResponse.json({ error: 'Lista de deviceIds inválida' }, { status: 400 })
      }
      const { data, error } = await supabaseAdmin
        .from('remote_fleet_devices')
        .select('*')
        .in('id', validIds)
      if (error) throw error
      targetDevices = data || []
    } else if (body?.bulkTarget && typeof body.bulkTarget === 'object') {
      const targetType = String(body.bulkTarget.deviceType || '').trim() as RemoteDeviceType
      let q = supabaseAdmin
        .from('remote_fleet_devices')
        .select('*')
        .neq('enrollment_status', 'revoked')

      if (targetType === 'windows_pc' || targetType === 'android_tablet' || targetType === 'tv_display') {
        q = q.eq('device_type', targetType)
      }
      if (targetType === 'windows_pc') {
        q = q.eq('enrollment_status', 'enrolled')
      }
      if (Array.isArray(body.bulkTarget.storeCodes) && body.bulkTarget.storeCodes.length > 0) {
        const cleanCodes = body.bulkTarget.storeCodes
          .map((c: unknown) => normalizeRemoteStoreCode(String(c)))
          .filter(Boolean) as string[]
        if (cleanCodes.length > 0) {
          q = q.in('store_code', cleanCodes)
        }
      }

      const { data, error } = await q
      if (error) throw error
      targetDevices = data || []
    } else {
      return NextResponse.json(
        { error: 'Debes indicar deviceId, deviceIds o bulkTarget' },
        { status: 400 }
      )
    }

    if (targetDevices.length === 0) {
      return NextResponse.json(
        { error: 'No hay dispositivos elegibles o enrolados para recibir este comando.' },
        { status: 400 }
      )
    }

    // Validar compatibilidad de comando y sanitizar payload
    const validTargets = targetDevices.filter(
      (d) => d.enrollment_status !== 'revoked' && isValidCommandForDeviceType(d.device_type, commandType)
    )

    if (validTargets.length === 0) {
      return NextResponse.json(
        { error: `El comando '${commandType}' no es compatible con los dispositivos seleccionados.` },
        { status: 400 }
      )
    }

    const sanitized = sanitizeCommandPayload(validTargets[0].device_type, commandType, body?.payload)
    if (!sanitized.ok) {
      return NextResponse.json({ error: sanitized.error }, { status: 400 })
    }

    const defaultTtlMin = commandType === 'reboot_pc' ? 5 : 15
    const requestedTtlMin = Number(body?.ttlMinutes ?? defaultTtlMin)
    const ttlMin = Number.isFinite(requestedTtlMin)
      ? Math.max(1, Math.min(60, Math.round(requestedTtlMin)))
      : defaultTtlMin

    const expiresAt = new Date(Date.now() + ttlMin * 60_000).toISOString()
    const batchId = validTargets.length > 1 ? crypto.randomUUID() : null

    const rowsToInsert = validTargets.map((d) => ({
      device_id: d.id,
      store_code: d.store_code,
      device_type: d.device_type,
      command_type: commandType,
      payload: sanitized.payload,
      status: 'pending',
      requested_by_user_id: auth.userId || null,
      requested_by_name: auth.userName || 'Admin',
      batch_id: batchId,
      expires_at: expiresAt,
    }))

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('remote_fleet_commands')
      .insert(rowsToInsert)
      .select('*')

    if (insErr) throw insErr

    // Persistir estado de TV si el comando controla blackout u overlay
    if (commandType === 'set_blackout' || commandType === 'show_overlay' || commandType === 'clear_overlay') {
      await Promise.all(
        validTargets
          .filter((d) => d.device_type === 'tv_display')
          .map((d) => {
            const nextConfig = { ...(d.desired_config || {}) }
            if (commandType === 'set_blackout') {
              nextConfig.blackoutMode = Boolean(sanitized.payload.blackout)
              if (sanitized.payload.message !== undefined) {
                nextConfig.overlayMessage = sanitized.payload.message
              }
            } else if (commandType === 'show_overlay') {
              nextConfig.overlayMessage = sanitized.payload.message
            } else if (commandType === 'clear_overlay') {
              nextConfig.overlayMessage = null
              nextConfig.blackoutMode = false
            }
            return supabaseAdmin
              .from('remote_fleet_devices')
              .update({ desired_config: nextConfig, updated_at: new Date().toISOString() })
              .eq('id', d.id)
          })
      )
    }

    return NextResponse.json(
      {
        success: true,
        batchId,
        count: inserted?.length || 0,
        commands: inserted || [],
      },
      { status: 201 }
    )
  } catch (err: any) {
    console.error('❌ [api/remote-control/commands POST] Error:', err)
    return NextResponse.json({ error: err?.message || 'Error enviando comando remoto' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const auth = await requireActiveAdmin(request)
  if (!auth.authorized) return auth.response!

  try {
    const body = await request.json()
    const commandId = String(body?.commandId || '').trim()
    if (!UUID_REGEX.test(commandId)) {
      return NextResponse.json({ error: 'commandId inválido' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('remote_fleet_commands')
      .update({
        status: 'cancelled',
        completed_at: new Date().toISOString(),
        error_message: `Cancelado manualmente por ${auth.userName || 'Admin'}`,
      })
      .eq('id', commandId)
      .in('status', ['pending', 'dispatched'])
      .select('*')
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return NextResponse.json({ error: 'El comando ya finalizó o no existe' }, { status: 404 })
    }

    return NextResponse.json({ success: true, command: data })
  } catch (err: any) {
    console.error('❌ [api/remote-control/commands PATCH] Error:', err)
    return NextResponse.json({ error: err?.message || 'Error cancelando comando' }, { status: 500 })
  }
}
