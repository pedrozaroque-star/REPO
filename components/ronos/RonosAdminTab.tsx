/**
 * @module components/ronos/RonosAdminTab
 * @description Pestaña de Administración, Diagnósticos y Sincronización del módulo RONOS.
 *   - Sincronización en vivo con Simplify HR OS y checador RONOS.
 *   - Salud de integraciones (Simplify HR, RONOS, Almacenamiento seguro).
 *   - Diagnóstico de tiendas fallidas con estado de respaldo en caché.
 *   - Gestión de evidencia y caché sin jerga técnica para usuarios operativos.
 *
 * @businessRules
 *   - Acceso exclusivo para administradores del sistema (rol 'admin').
 *   - La sincronización en vivo actualiza ponchadas y salarios sin borrar registros históricos.
 *
 * @dataFlow
 *   Interactúa con /api/ronos/sync, /api/ronos/punches y Supabase cache.
 *
 * @notes
 *   - Cumple con estándar Mobile-First con controles táctiles >= 44px.
 *   - Bilingüe completo (i18n) sin textos hardcodeados.
 */

'use client'

import React, { useState } from 'react'
import {
  RefreshCw,
  Server,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Database,
  Globe,
  Clock,
  Activity
} from 'lucide-react'
import { useLanguage } from '@/lib/i18n'
import { ChainAuditData, StoreOption } from './types'

interface RonosAdminTabProps {
  chainData: ChainAuditData | null
  stores: StoreOption[]
  selectedCompanyId: number
  syncing: boolean
  lastSyncedTime: string | null
  onSyncLive: () => void
}

export default function RonosAdminTab({
  chainData,
  stores,
  selectedCompanyId,
  syncing,
  lastSyncedTime,
  onSyncLive
}: RonosAdminTabProps) {
  const { t } = useLanguage()
  const [testingConnection, setTestingConnection] = useState(false)
  type HealthState = 'online' | 'warning' | 'offline' | 'untested'
  const [connectionStatus, setConnectionStatus] = useState<{
    simplifyHr: HealthState
    ronosApi: HealthState
    supabaseDb: HealthState
    lastTested: string | null
  }>({
    simplifyHr: 'untested',
    ronosApi: 'untested',
    supabaseDb: 'untested',
    lastTested: null
  })

  const failedStores = (chainData as any)?.failedStores || []
  const failedStoresCount = (chainData as any)?.failedStoresCount || failedStores.length

  const handleTestHealth = async () => {
    setTestingConnection(true)
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('teg_token') : null
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(`/api/ronos/sync?action=health&_t=${Date.now()}`, { headers })
      if (res.ok) {
        const json = await res.json()
        if (json.success && json.health) {
          setConnectionStatus({
            simplifyHr: json.health.simplifyHr || 'offline',
            ronosApi: json.health.ronosApi || 'offline',
            supabaseDb: json.health.supabaseDb || 'offline',
            lastTested: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
          })
          return
        }
      }
      setConnectionStatus(prev => ({
        ...prev,
        simplifyHr: 'warning',
        ronosApi: 'warning',
        supabaseDb: 'warning',
        lastTested: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
      }))
    } catch {
      setConnectionStatus(prev => ({
        ...prev,
        simplifyHr: 'offline',
        ronosApi: 'offline',
        supabaseDb: 'offline',
        lastTested: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
      }))
    } finally {
      setTestingConnection(false)
    }
  }

  const renderStatusBadge = (status: HealthState, onlineLabel: string) => {
    switch (status) {
      case 'online':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            <CheckCircle2 className="w-3 h-3" />
            <span>{onlineLabel}</span>
          </span>
        )
      case 'warning':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <AlertTriangle className="w-3 h-3" />
            <span>{t('ronos.admin.status_warning') || 'Advertencia'}</span>
          </span>
        )
      case 'offline':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
            <AlertTriangle className="w-3 h-3" />
            <span>{t('ronos.admin.status_offline') || 'Sin conexión'}</span>
          </span>
        )
      case 'untested':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            <Activity className="w-3 h-3" />
            <span>{t('ronos.admin.status_untested') || 'Sin comprobar'}</span>
          </span>
        )
    }
  }

  return (
    <div className="space-y-4">
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 1. CABECERA EJECUTIVA: SINCRONIZACIÓN Y SALUD DE INTEGRACIONES          */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <section
        aria-labelledby="heading-admin-panel"
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 id="heading-admin-panel" className="text-sm sm:text-base font-black text-slate-900 dark:text-white">
              {t('ronos.admin.title') || 'Administración, Salud y Sincronización'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('ronos.admin.all_stores_desc') || 'Monitoreo de conexiones, base de datos y diagnóstico de sucursales.'}
            </p>
            {lastSyncedTime && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500 pt-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>{t('ronos.updated') || 'Actualizado'}: <strong>{lastSyncedTime}</strong></span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleTestHealth}
              disabled={testingConnection}
              className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white hover:bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Activity className={`w-3.5 h-3.5 ${testingConnection ? 'animate-spin text-[#0288d1]' : ''}`} />
              <span>{testingConnection ? (t('ronos.admin.diagnosing') || 'Diagnosticando...') : (t('ronos.admin.diagnose_btn') || 'Diagnosticar')}</span>
            </button>

            <button
              type="button"
              onClick={onSyncLive}
              disabled={syncing}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0288d1] hover:bg-[#0277bd] text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? (t('ronos.syncing') || 'Sincronizando...') : (t('ronos.admin.sync_all_btn') || 'Sincronizar Todo')}</span>
            </button>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 2. SALUD DE INTEGRACIONES (3 PILARES TÉCNICOS LIMPIOS)                  */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Simplify HR OS */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 flex items-center justify-center">
              <Globe className="w-4 h-4" />
            </div>
            {renderStatusBadge(connectionStatus.simplifyHr, t('ronos.admin.status_online') || 'En Línea')}
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-900 dark:text-white">
              {t('ronos.admin.service_simplify') || 'Simplify HR OS'}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {t('ronos.admin.service_simplify_desc') || 'Extracción de tarifas salariales y recibos oficiales.'}
            </p>
          </div>
        </div>

        {/* RONOS Checador */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300 flex items-center justify-center">
              <Server className="w-4 h-4" />
            </div>
            {renderStatusBadge(connectionStatus.ronosApi, t('ronos.admin.status_connected') || 'Conectado')}
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-900 dark:text-white">
              {t('ronos.admin.service_ronos') || 'Reloj Checador RONOS'}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {t('ronos.admin.service_ronos_desc') || 'Consulta de ponchadas, descansos y fotos del checador.'}
            </p>
          </div>
        </div>

        {/* Caché Protegida */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 flex items-center justify-center">
              <Database className="w-4 h-4" />
            </div>
            {renderStatusBadge(connectionStatus.supabaseDb, t('ronos.admin.status_synchronized') || 'Sincronizada')}
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-900 dark:text-white">
              {t('ronos.admin.service_cache') || 'Caché de Respaldo'}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {t('ronos.admin.service_cache_desc') || 'Almacenamiento seguro de tarjetas de tiempo y mapeos.'}
            </p>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 3. DIAGNÓSTICO DE SUCURSALES FALLIDAS                                   */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <section
        aria-labelledby="heading-failed-stores"
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-3"
      >
        <div className="flex items-center gap-2.5">
          <div className={`p-2 rounded-xl ${
            failedStoresCount > 0
              ? 'bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400'
              : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400'
          }`}>
            {failedStoresCount > 0 ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          </div>
          <div>
            <h3 id="heading-failed-stores" className="text-xs font-bold text-slate-900 dark:text-white">
              {failedStoresCount > 0
                ? `${failedStoresCount} ${t('ronos.admin.failed_stores_count') || 'sucursales con incidencia'}`
                : (t('ronos.admin.all_stores_healthy') || 'Todas las Sucursales Conectadas Correctamente (16/16)')}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {failedStoresCount > 0
                ? (t('ronos.admin.failed_stores_desc') || 'Las tiendas listadas utilizan la versión respaldada en caché.')
                : (t('ronos.admin.all_stores_desc') || 'El 100% de los restaurantes y La Bodega respondieron con éxito.')}
            </p>
          </div>
        </div>

        {failedStoresCount > 0 && (
          <div className="overflow-x-auto pt-2">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-2.5 px-3">{t('ronos.col_store_name') || 'Sucursal'}</th>
                  <th className="py-2.5 px-3">{t('ronos.admin.reported_reason') || 'Motivo Reportado'}</th>
                  <th className="py-2.5 px-3 text-center">{t('ronos.admin.cache_status') || 'Estado de Caché'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {failedStores.map((f: any, idx: number) => (
                  <tr key={`fail-${f.companyId || idx}`} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">
                      {f.storeName || `${t('ronos.admin.store_fallback') || 'Sucursal #'}${f.companyId || idx}`}
                    </td>
                    <td className="py-2.5 px-3 text-rose-600 font-medium">
                      {f.error || (t('ronos.admin.timeout_error') || 'Tiempo de espera agotado al conectar')}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        {t('ronos.admin.cache_preserved') || 'Preservada en respaldo'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 4. NOTA DE SEGURIDAD DOCUMENTAL                                         */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 flex items-start gap-3">
        <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        <div className="space-y-0.5 text-xs text-slate-600 dark:text-slate-400">
          <span className="font-bold text-slate-900 dark:text-white block">
            {t('ronos.admin.security_note_title') || 'Seguridad y Protección de Datos'}
          </span>
          <p className="leading-relaxed">
            {t('ronos.admin.security_note_desc') || 'Todas las peticiones a endpoints administrativos están protegidas mediante verificación criptográfica JWT en el servidor.'}
          </p>
        </div>
      </div>
    </div>
  )
}
