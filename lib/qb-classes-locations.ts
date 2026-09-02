/**
 * @module lib/qb-classes-locations
 * @description Mapeo oficial de Clases (ClassRef) y Ubicaciones/Departamentos (DepartmentRef) de QuickBooks Online
 * para las sucursales de Tacos Gavilan.
 * 
 * @businessRules
 * - QuickBooks Online exige enviar obligatoriamente `ClassRef: { value: classId, name: className }` y
 *   `DepartmentRef: { value: locationId, name: locationName }` en cada línea del JournalEntry.
 * - Si falta el campo `value` numérico, Intuit rechaza el request con HTTP 400 (ValidationFault code: 2020).
 */

export interface QBStoreRefs {
  classId: string
  className: string
  locationId: string
  locationName: string
}

export const QB_STORE_REFS_MAP: Record<string, QBStoreRefs> = {
  azusa: {
    classId: '2200000000000075341',
    className: 'Azusa',
    locationId: '12',
    locationName: 'Azusa',
  },
  bell: {
    classId: '2700000000000006003',
    className: 'Bell',
    locationId: '10',
    locationName: 'Bell',
  },
  broadway: {
    classId: '4',
    className: 'Broadway LA',
    locationId: '3',
    locationName: 'Broadway LA',
  },
  'broadway la': {
    classId: '4',
    className: 'Broadway LA',
    locationId: '3',
    locationName: 'Broadway LA',
  },
  central: {
    classId: '3',
    className: 'Central LA',
    locationId: '4',
    locationName: 'Central LA',
  },
  'central la': {
    classId: '3',
    className: 'Central LA',
    locationId: '4',
    locationName: 'Central LA',
  },
  downey: {
    classId: '5',
    className: 'Downey',
    locationId: '5',
    locationName: 'Downey',
  },
  hollywood: {
    classId: '2200000000000083328',
    className: 'Hollywood',
    locationId: '14',
    locationName: 'Hollywood',
  },
  'huntington park': {
    classId: '1',
    className: 'Huntington Park',
    locationId: '2',
    locationName: 'Huntington Park',
  },
  huntington: {
    classId: '1',
    className: 'Huntington Park',
    locationId: '2',
    locationName: 'Huntington Park',
  },
  'la puente': {
    classId: '2200000000000140845',
    className: 'La Puente',
    locationId: '19',
    locationName: 'La Puente',
  },
  puente: {
    classId: '2200000000000140845',
    className: 'La Puente',
    locationId: '19',
    locationName: 'La Puente',
  },
  lynwood: {
    classId: '2200000000000075312',
    className: 'Lynwood',
    locationId: '13',
    locationName: 'Lynwood',
  },
  norwalk: {
    classId: '2200000000000222249',
    className: 'Norwalk',
    locationId: '24',
    locationName: 'Norwalk',
  },
  rialto: {
    classId: '2200000000000057575',
    className: 'Rialto',
    locationId: '11',
    locationName: 'Rialto',
  },
  'santa ana': {
    classId: '2200000000000136142',
    className: 'Santa Ana',
    locationId: '18',
    locationName: 'Santa Ana',
  },
  slauson: {
    classId: '2200000000000164243',
    className: 'Slauson',
    locationId: '20',
    locationName: 'Slauson',
  },
  'south gate': {
    classId: '2200000000000140757',
    className: 'South Gate',
    locationId: '16',
    locationName: 'South Gate',
  },
  'west covina': {
    classId: '2200000000000134063',
    className: 'West Covina',
    locationId: '17',
    locationName: 'West Covina',
  },
  warehouse: {
    classId: '2',
    className: 'Warehouse',
    locationId: '1',
    locationName: 'Warehouse',
  },
  pepes: {
    classId: '8',
    className: 'pepes',
    locationId: '8',
    locationName: 'Pepes',
  },
  bristol: {
    classId: '2200000000000240369',
    className: 'Bristol',
    locationId: '25',
    locationName: 'Bristol',
  },
  ontario: {
    classId: '2200000000000270357',
    className: 'ONTARIO',
    locationId: '27',
    locationName: 'Ontario',
  },
}

export function getQBStoreRefs(storeName: string): QBStoreRefs {
  const clean = storeName.toLowerCase().replace(/tacos\s*gavilan\s*/i, '').trim()
  
  if (QB_STORE_REFS_MAP[clean]) {
    return QB_STORE_REFS_MAP[clean]
  }

  for (const [key, val] of Object.entries(QB_STORE_REFS_MAP)) {
    if (clean.includes(key) || key.includes(clean)) {
      return val
    }
  }

  // Fallback seguro a Warehouse / General
  return {
    classId: '2',
    className: 'Warehouse',
    locationId: '1',
    locationName: 'Warehouse',
  }
}
