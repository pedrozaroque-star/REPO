/**
 * @module lib/toast-stores
 * @description Catálogo isomórfico (Client + Server, cero dependencias de Node.js) de identificadores externos
 * Toast (GUIDs), códigos internos y nombres limpios de las 15 sucursales de Tacos Gavilan en orden alfabético (A–Z).
 *
 * @businessRules
 * - **Mapeo Canónico de Tiendas**: NUNCA hardcodear GUIDs de tiendas de manera aislada en componentes; este catálogo es la fuente canónica para mapear códigos de tienda (ej. `'LYNWOOD'`) a sus identificadores Toast.
 * - **Cero Números `#` y Orden Alfabético (A–Z)**: Todos los nombres de sucursal (`name`) se mantienen limpios sin prefijos ni sufijos `#` y las entradas están declaradas en estricto orden alfabético (`Azusa` -> `West Covina`).
 * - **Compatibilidad Universal**: Diseñado sin dependencias de Node.js (`fs`, `path`) para ser importado con total seguridad tanto en componentes `'use client'` como en API routes del backend.
 *
 * @dataFlow
 * - Client (`order-ready-board`, etc.) / Server (`order-ready-sync`, webhook, etc.) -> `import { TOAST_STORE_MAP, STORE_GUID_BY_CODE, TOAST_STORES_SORTED } from '@/lib/toast-stores'`
 *
 * @notes
 * - [2026-11-24] Eliminado sufijo `(#14)` en `Lynwood` y ordenadas las 15 entradas alfabéticamente (A–Z).
 */

import { sortStoresAlphabetically } from '@/lib/store-display'

export const TOAST_STORE_MAP: Record<string, { code: string; name: string }> = {
  'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8': { code: 'AZUSA', name: 'Azusa' },
  'a83901db-2431-4283-834e-9502a2ba4b3b': { code: 'BELL', name: 'Bell' },
  'b7f63b01-f089-4ad7-a346-afdb1803dc1a': { code: 'DOWNEY', name: 'Downey' },
  '5fbb58f5-283c-4ea4-9415-04100ee6978b': { code: 'HOLLYWOOD', name: 'Hollywood' },
  '47256ade-2cd4-4073-9632-84567ad9e2c8': { code: 'HPARK', name: 'Huntington Park' },
  '475bc112-187d-4b9c-884d-1f6a041698ce': { code: 'LABROADWY', name: 'LA Broadway' },
  '8685e942-3f07-403a-afb6-faec697cd2cb': { code: 'LACENTRAL', name: 'LA Central' },
  '3a803939-eb13-4def-a1a4-462df8e90623': { code: 'LAPUENTE', name: 'La Puente' },
  '80a1ec95-bc73-402e-8884-e5abbe9343e6': { code: 'LYNWOOD', name: 'Lynwood' },
  '42ed15a6-106b-466a-9076-1e8f72451f6b': { code: 'NORWALK', name: 'Norwalk' },
  'acf15327-54c8-4da4-8d0d-3ac0544dc422': { code: 'RIALTO', name: 'Rialto' },
  '3c2d8251-c43c-43b8-8306-387e0a4ed7c2': { code: 'SANTAANA', name: 'Santa Ana' },
  '9625621e-1b5e-48d7-87ae-7094fab5a4fd': { code: 'SLAUSON', name: 'Slauson' },
  '95866cfc-eeb8-4af9-9586-f78931e1ea04': { code: 'SOUTHGATE', name: 'South Gate' },
  '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02': { code: 'WCOVINA', name: 'West Covina' }
}

export const STORE_GUID_BY_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(TOAST_STORE_MAP).map(([guid, v]) => [v.code, guid])
)

export const TOAST_STORES_SORTED: ReadonlyArray<{ guid: string; code: string; name: string }> =
  sortStoresAlphabetically(
    Object.entries(TOAST_STORE_MAP).map(([guid, v]) => ({
      guid,
      code: v.code,
      name: v.name
    })),
    (s) => s.name
  )
