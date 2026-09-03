/**
 * @module lib/qb-classes-locations
 * @description Mapeo oficial de Clases (ClassRef), Ubicaciones/Departamentos (DepartmentRef)
 * y Clientes de Efectivo (CustomerRef *-COH) de QuickBooks Online para las sucursales de Tacos Gavilan.
 * 
 * @businessRules
 * - QuickBooks Online exige enviar obligatoriamente:
 *   1. `ClassRef: { value: classId, name: className }`
 *   2. `DepartmentRef: { value: locationId, name: locationName }`
 *   3. Para la cuenta 13200 (Deposit To Bank / Undeposited Funds):
 *      `Entity: { Type: 'Customer', EntityRef: { value: cohCustomerId, name: cohCustomerName } }`
 * - Si falta alguno de estos identificadores numéricos, Intuit rechaza el request con error de validación.
 */

export interface QBStoreRefs {
  classId: string
  className: string
  locationId: string
  locationName: string
  cohCustomerId: string
  cohCustomerName: string
}

export const QB_STORE_REFS_MAP: Record<string, QBStoreRefs> = {
  azusa: {
    classId: '2200000000000075341',
    className: 'Azusa',
    locationId: '12',
    locationName: 'Azusa',
    cohCustomerId: '1227',
    cohCustomerName: 'AZUSA-COH',
  },
  bell: {
    classId: '2700000000000006003',
    className: 'Bell',
    locationId: '10',
    locationName: 'Bell',
    cohCustomerId: '1235',
    cohCustomerName: 'BELL- COH',
  },
  broadway: {
    classId: '4',
    className: 'Broadway LA',
    locationId: '3',
    locationName: 'Broadway LA',
    cohCustomerId: '1224',
    cohCustomerName: 'BROADWAY-COH',
  },
  'broadway la': {
    classId: '4',
    className: 'Broadway LA',
    locationId: '3',
    locationName: 'Broadway LA',
    cohCustomerId: '1224',
    cohCustomerName: 'BROADWAY-COH',
  },
  central: {
    classId: '3',
    className: 'Central LA',
    locationId: '4',
    locationName: 'Central LA',
    cohCustomerId: '1226',
    cohCustomerName: 'CENTRAL-COH',
  },
  'central la': {
    classId: '3',
    className: 'Central LA',
    locationId: '4',
    locationName: 'Central LA',
    cohCustomerId: '1226',
    cohCustomerName: 'CENTRAL-COH',
  },
  downey: {
    classId: '5',
    className: 'Downey',
    locationId: '5',
    locationName: 'Downey',
    cohCustomerId: '1217',
    cohCustomerName: 'DOWNEY-COH',
  },
  hollywood: {
    classId: '2200000000000083328',
    className: 'Hollywood',
    locationId: '14',
    locationName: 'Hollywood',
    cohCustomerId: '1239',
    cohCustomerName: 'HOLLYWOOD- COH',
  },
  'huntington park': {
    classId: '1',
    className: 'Huntington Park',
    locationId: '2',
    locationName: 'Huntington Park',
    cohCustomerId: '1238',
    cohCustomerName: 'HUNTINGTON PARK- COH',
  },
  huntington: {
    classId: '1',
    className: 'Huntington Park',
    locationId: '2',
    locationName: 'Huntington Park',
    cohCustomerId: '1238',
    cohCustomerName: 'HUNTINGTON PARK- COH',
  },
  'la puente': {
    classId: '2200000000000140845',
    className: 'La Puente',
    locationId: '19',
    locationName: 'La Puente',
    cohCustomerId: '1231',
    cohCustomerName: 'LA PUENTE -COH',
  },
  puente: {
    classId: '2200000000000140845',
    className: 'La Puente',
    locationId: '19',
    locationName: 'La Puente',
    cohCustomerId: '1231',
    cohCustomerName: 'LA PUENTE -COH',
  },
  lynwood: {
    classId: '2200000000000075312',
    className: 'Lynwood',
    locationId: '13',
    locationName: 'Lynwood',
    cohCustomerId: '1237',
    cohCustomerName: 'LYNWOOD-COH',
  },
  norwalk: {
    classId: '2200000000000222249',
    className: 'Norwalk',
    locationId: '24',
    locationName: 'Norwalk',
    cohCustomerId: '1225',
    cohCustomerName: 'NORWALK -COH',
  },
  rialto: {
    classId: '2200000000000057575',
    className: 'Rialto',
    locationId: '11',
    locationName: 'Rialto',
    cohCustomerId: '1430',
    cohCustomerName: 'RIALTO-COH',
  },
  'santa ana': {
    classId: '2200000000000136142',
    className: 'Santa Ana',
    locationId: '18',
    locationName: 'Santa Ana',
    cohCustomerId: '1230',
    cohCustomerName: 'SANTA ANA -COH',
  },
  slauson: {
    classId: '2200000000000164243',
    className: 'Slauson',
    locationId: '20',
    locationName: 'Slauson',
    cohCustomerId: '1363',
    cohCustomerName: 'SLAUSON-COH',
  },
  'south gate': {
    classId: '2200000000000140757',
    className: 'South Gate',
    locationId: '16',
    locationName: 'South Gate',
    cohCustomerId: '1240',
    cohCustomerName: 'SOUTH GATE- COH',
  },
  'west良好的covina': {
    classId: '2200000000000134063',
    className: 'West Covina',
    locationId: '17',
    locationName: 'West Covina',
    cohCustomerId: '1228',
    cohCustomerName: 'WEST COVINA-COH',
  },
  'west covina': {
    classId: '2200000000000134063',
    className: 'West Covina',
    locationId: '17',
    locationName: 'West Covina',
    cohCustomerId: '1228',
    cohCustomerName: 'WEST COVINA-COH',
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

  return {
    classId: '2',
    className: 'Warehouse',
    locationId: '1',
    locationName: 'Warehouse',
    cohCustomerId: '1227',
    cohCustomerName: 'AZUSA-COH',
  }
}
