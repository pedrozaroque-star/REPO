/**
 * @module lib/toast-stores
 * @description Client-safe mapping catalog of Toast restaurant external IDs (GUIDs) and store codes for Tacos Gavilan.
 * Safe for use in both Client Components and Server Components (zero Node.js dependencies).
 * 
 * @businessRules
 * - **Mapeo Canónico de Tiendas**: NUNCA hardcodear GUIDs de tiendas de manera aislada en componentes; este catálogo es la fuente canónica para mapear códigos de tienda (ej. 'LYNWOOD') a sus identificadores Toast.
 * - **Compatibilidad Universal**: Diseñado sin dependencias de Node.js ('fs', 'path') para ser importado con total seguridad tanto en componentes 'use client' como en API routes del backend.
 * 
 * @dataFlow
 * - Client (order-ready-board, etc.) / Server (order-ready-sync, webhook, etc.) -> import { TOAST_STORE_MAP, STORE_GUID_BY_CODE } from '@/lib/toast-stores'
 */

export const TOAST_STORE_MAP: Record<string, { code: string; name: string }> = {
  '80a1ec95-bc73-402e-8884-e5abbe9343e6': { code: 'LYNWOOD', name: 'Lynwood (#14)' },
  'acf15327-54c8-4da4-8d0d-3ac0544dc422': { code: 'RIALTO', name: 'Rialto' },
  'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8': { code: 'AZUSA', name: 'Azusa' },
  '42ed15a6-106b-466a-9076-1e8f72451f6b': { code: 'NORWALK', name: 'Norwalk' },
  'b7f63b01-f089-4ad7-a346-afdb1803dc1a': { code: 'DOWNEY', name: 'Downey' },
  '475bc112-187d-4b9c-884d-1f6a041698ce': { code: 'LABROADWY', name: 'LA Broadway' },
  'a83901db-2431-4283-834e-9502a2ba4b3b': { code: 'BELL', name: 'Bell' },
  '5fbb58f5-283c-4ea4-9415-04100ee6978b': { code: 'HOLLYWOOD', name: 'Hollywood' },
  '47256ade-2cd4-4073-9632-84567ad9e2c8': { code: 'HPARK', name: 'Huntington Park' },
  '8685e942-3f07-403a-afb6-faec697cd2cb': { code: 'LACENTRAL', name: 'LA Central' },
  '3a803939-eb13-4def-a1a4-462df8e90623': { code: 'LAPUENTE', name: 'La Puente' },
  '3c2d8251-c43c-43b8-8306-387e0a4ed7c2': { code: 'SANTAANA', name: 'Santa Ana' },
  '9625621e-1b5e-48d7-87ae-7094fab5a4fd': { code: 'SLAUSON', name: 'Slauson' },
  '95866cfc-eeb8-4af9-9586-f78931e1ea04': { code: 'SOUTHGATE', name: 'South Gate' },
  '5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02': { code: 'WCOVINA', name: 'West Covina' }
}

export const STORE_GUID_BY_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(TOAST_STORE_MAP).map(([guid, v]) => [v.code, guid])
)
