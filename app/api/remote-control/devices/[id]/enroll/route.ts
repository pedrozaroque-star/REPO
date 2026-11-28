/**
 * @module api/remote-control/devices/[id]/enroll
 * @description Genera o revoca el token único criptográfico (`teg_dev_...`) de una PC Windows
 *              y construye al vuelo los instaladores de 1 clic (`.cmd` y `.ps1`) personalizados
 *              para esa sucursal (incluyendo Action1 `.msi` si está configurado globalmente).
 *
 * @businessRules
 * - Acceso exclusivo para administradores activos (`requireActiveAdmin`).
 * - Solo almacena el hash SHA-256 del token en Supabase; el token plano se devuelve una única vez
 *   dentro del paquete de instalación generado.
 * - Soporta `action: 'enroll'` (genera/rota token + devuelve instaladores) y `action: 'revoke'`
 *   (invalida inmediatamente el acceso del equipo).
 *
 * @dataFlow
 * - UI `/admin/control-remoto` -> POST `/api/remote-control/devices/[id]/enroll` -> Supabase + `buildWindowsInstallerCmd/Ps1`.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  DEFAULT_PC_WATCHDOG_CONFIG,
  getRemoteStoreDisplayName,
  sanitizePcWatchdogConfig,
} from '@/lib/remote-control'
import {
  generateDeviceAgentToken,
  requireActiveAdmin,
  resolvePublicBaseUrl,
  stripDeviceSecrets,
} from '@/lib/remote-control-server'
import {
  buildWindowsInstallerCmd,
  buildWindowsInstallerPs1,
} from '@/lib/remote-control-agent-script'

export const dynamic = 'force-dynamic'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  const auth = await requireActiveAdmin(request)
  if (!auth.authorized) return auth.response!

  try {
    const resolved = await Promise.resolve(context.params)
    const id = String(resolved?.id || '').trim()
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'ID de dispositivo inválido' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || 'enroll').trim().toLowerCase()

    const { data: device, error: devErr } = await supabaseAdmin
      .from('remote_fleet_devices')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (devErr) throw devErr
    if (!device) {
      return NextResponse.json({ error: 'Dispositivo no encontrado' }, { status: 404 })
    }

    if (action === 'revoke') {
      const { data: revoked, error: revErr } = await supabaseAdmin
        .from('remote_fleet_devices')
        .update({
          agent_token_hash: null,
          agent_token_prefix: null,
          enrollment_status: 'revoked',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single()

      if (revErr) throw revErr
      return NextResponse.json({
        success: true,
        action: 'revoke',
        device: stripDeviceSecrets(revoked),
      })
    }

    if (device.device_type !== 'windows_pc') {
      return NextResponse.json(
        { error: 'El instalador de agente Windows solo aplica a equipos de tipo windows_pc.' },
        { status: 400 }
      )
    }

    const { data: settings } = await supabaseAdmin
      .from('remote_fleet_settings')
      .select('*')
      .eq('id', 'global')
      .maybeSingle()

    const { plainToken, tokenHash, tokenPrefix } = generateDeviceAgentToken()

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('remote_fleet_devices')
      .update({
        agent_token_hash: tokenHash,
        agent_token_prefix: tokenPrefix,
        enrollment_status: 'enrolled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single()

    if (updErr) throw updErr

    const baseUrl = resolvePublicBaseUrl(request)
    const storeName = getRemoteStoreDisplayName(device.store_code)
    const watchdog = sanitizePcWatchdogConfig(
      device.desired_config && Object.keys(device.desired_config).length > 0
        ? device.desired_config
        : settings?.default_pc_watchdog || DEFAULT_PC_WATCHDOG_CONFIG
    )

    const installerParams = {
      baseUrl,
      storeCode: device.store_code,
      storeName,
      deviceKey: device.device_key,
      displayName: device.display_name,
      agentToken: plainToken,
      watchdog,
      action1InstallerUrl: settings?.action1_installer_url || null,
      action1InstallToken: settings?.action1_install_token || null,
    }

    const installerCmd = buildWindowsInstallerCmd(installerParams)
    const installerPs1 = buildWindowsInstallerPs1(installerParams)
    const safeSlug = device.store_code.replace(/[^A-Z0-9_-]/gi, '')

    return NextResponse.json({
      success: true,
      action: 'enroll',
      device: stripDeviceSecrets(updated),
      tokenPrefix,
      baseUrl,
      includesAction1: Boolean(settings?.action1_installer_url),
      fileNameCmd: `Instalar-TEG-PC-${safeSlug}.cmd`,
      fileNamePs1: `Instalar-TEG-PC-${safeSlug}.ps1`,
      installerCmd,
      installerPs1,
    })
  } catch (err: any) {
    console.error('❌ [api/remote-control/devices/[id]/enroll] Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Error generando instalador del dispositivo' },
      { status: 500 }
    )
  }
}
