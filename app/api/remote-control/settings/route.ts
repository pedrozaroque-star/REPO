/**
 * @module api/remote-control/settings
 * @description Lectura y actualización de la configuración global del Centro de Control Remoto
 *              (URL consola Action1, URL instalador `.msi` de Action1, RustDesk opcional y políticas por defecto de Watchdog).
 *
 * @businessRules
 * - Acceso exclusivo para administradores activos (`requireActiveAdmin`).
 * - Valida URLs con `isSafeHttpOrHttpsUrl` antes de persistirlas en `remote_fleet_settings`.
 *
 * @dataFlow
 * - UI `/admin/control-remoto` -> GET/PATCH `/api/remote-control/settings` -> Supabase (`remote_fleet_settings`).
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  DEFAULT_PC_WATCHDOG_CONFIG,
  isSafeHttpOrHttpsUrl,
  sanitizePcWatchdogConfig,
} from '@/lib/remote-control'
import { requireActiveAdmin } from '@/lib/remote-control-server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireActiveAdmin(request)
  if (!auth.authorized) return auth.response!

  try {
    const { data, error } = await supabaseAdmin
      .from('remote_fleet_settings')
      .select('*')
      .eq('id', 'global')
      .maybeSingle()

    if (error) throw error
    return NextResponse.json({
      success: true,
      settings: data || {
        id: 'global',
        action1_org_url: null,
        action1_installer_url: null,
        rustdesk_relay_host: null,
        rustdesk_public_key: null,
        default_pc_watchdog: DEFAULT_PC_WATCHDOG_CONFIG,
        updated_by: null,
        updated_at: new Date().toISOString(),
      },
    })
  } catch (err: any) {
    console.error('❌ [api/remote-control/settings GET] Error:', err)
    return NextResponse.json({ error: err?.message || 'Error leyendo configuración global' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const auth = await requireActiveAdmin(request)
  if (!auth.authorized) return auth.response!

  try {
    const body = await request.json()

    const action1OrgUrl = typeof body?.action1OrgUrl === 'string' ? body.action1OrgUrl.trim() : ''
    if (action1OrgUrl && !isSafeHttpOrHttpsUrl(action1OrgUrl)) {
      return NextResponse.json({ error: 'URL de consola Action1 inválida' }, { status: 400 })
    }

    const action1InstallerUrl =
      typeof body?.action1InstallerUrl === 'string' ? body.action1InstallerUrl.trim() : ''
    if (action1InstallerUrl && !isSafeHttpOrHttpsUrl(action1InstallerUrl)) {
      return NextResponse.json({ error: 'URL del instalador .msi de Action1 inválida' }, { status: 400 })
    }

    const rustdeskRelayHost =
      typeof body?.rustdeskRelayHost === 'string'
        ? body.rustdeskRelayHost.trim().slice(0, 180) || null
        : null
    const rustdeskPublicKey =
      typeof body?.rustdeskPublicKey === 'string'
        ? body.rustdeskPublicKey.trim().slice(0, 180) || null
        : null

    const defaultPcWatchdog = sanitizePcWatchdogConfig(body?.defaultPcWatchdog)

    const { data, error } = await supabaseAdmin
      .from('remote_fleet_settings')
      .upsert(
        {
          id: 'global',
          action1_org_url: action1OrgUrl || null,
          action1_installer_url: action1InstallerUrl || null,
          rustdesk_relay_host: rustdeskRelayHost,
          rustdesk_public_key: rustdeskPublicKey,
          default_pc_watchdog: defaultPcWatchdog,
          updated_by: auth.userName || auth.email || 'Admin',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )
      .select('*')
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, settings: data })
  } catch (err: any) {
    console.error('❌ [api/remote-control/settings PATCH] Error:', err)
    return NextResponse.json({ error: err?.message || 'Error guardando configuración global' }, { status: 500 })
  }
}
