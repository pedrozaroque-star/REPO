/**
 * @module lib/qb-classes-locations
 * @description Mapeo oficial de Clases (ClassRef), Ubicaciones/Departamentos (DepartmentRef),
 * Clientes de Efectivo (CustomerRef *-COH) y Cuentas Bancarias de Depósito de QuickBooks Online
 * para las 15 sucursales de Tacos Gavilan, extraído directamente de la configuración oficial de Cohesion.
 * 
 * @businessRules
 * - QuickBooks Online exige enviar obligatoriamente:
 *   1. `ClassRef: { value: classId, name: className }`
 *   2. `DepartmentRef: { value: locationId, name: locationName }`
 *   3. Para la cuenta 13200 (Deposit To Bank / Undeposited Funds):
 *      `Entity: { Type: 'Customer', EntityRef: { value: cohCustomerId, name: cohCustomerName } }`
 *   4. Para los depósitos de tarjetas y EBT (Cuentas 10000+): cada tienda deposita en su cuenta bancaria específica:
 *      - Downey deposita en `10005 - Paramount` (QB ID: 48)
 *      - Huntington Park deposita en `10008 - Santa fe` (QB ID: 37)
 *      - Broadway LA deposita en `10010 - Vernon` (QB ID: 46)
 *      - South Gate usa la clase `Souht Gate` (con la tipografía exacta de QuickBooks)
 * - Si falta alguno de estos identificadores numéricos, Intuit rechaza el request con error de validación.
 */

export interface QBStoreRefs {
  classId: string
  className: string
  locationId: string
  locationName: string
  cohCustomerId: string
  cohCustomerName: string
  bankAccount: string
  bankAccountQbId: string
  bankAccountName: string
}

export const QB_STORE_REFS_MAP: Record<string, QBStoreRefs> = {
  azusa: {
    classId: '2200000000000075341',
    className: 'Azusa',
    locationId: '12',
    locationName: 'Azusa',
    cohCustomerId: '1227',
    cohCustomerName: 'AZUSA-COH',
    bankAccount: '10000',
    bankAccountQbId: '213',
    bankAccountName: '10000 - Azusa',
  },
  bell: {
    classId: '2700000000000006003',
    className: 'Bell',
    locationId: '10',
    locationName: 'Bell',
    cohCustomerId: '1235',
    cohCustomerName: 'BELL- COH',
    bankAccount: '10001',
    bankAccountQbId: '189',
    bankAccountName: '10001 - Bell',
  },
  broadway: {
    classId: '4',
    className: 'Broadway LA',
    locationId: '3',
    locationName: 'Broadway LA',
    cohCustomerId: '1224',
    cohCustomerName: 'BROADWAY-COH',
    bankAccount: '10010',
    bankAccountQbId: '46',
    bankAccountName: '10010 - Vernon',
  },
  'broadway la': {
    classId: '4',
    className: 'Broadway LA',
    locationId: '3',
    locationName: 'Broadway LA',
    cohCustomerId: '1224',
    cohCustomerName: 'BROADWAY-COH',
    bankAccount: '10010',
    bankAccountQbId: '46',
    bankAccountName: '10010 - Vernon',
  },
  central: {
    classId: '3',
    className: 'Central LA',
    locationId: '4',
    locationName: 'Central LA',
    cohCustomerId: '1226',
    cohCustomerName: 'CENTRAL-COH',
    bankAccount: '10002',
    bankAccountQbId: '45',
    bankAccountName: '10002 - Central',
  },
  'central la': {
    classId: '3',
    className: 'Central LA',
    locationId: '4',
    locationName: 'Central LA',
    cohCustomerId: '1226',
    cohCustomerName: 'CENTRAL-COH',
    bankAccount: '10002',
    bankAccountQbId: '45',
    bankAccountName: '10002 - Central',
  },
  downey: {
    classId: '5',
    className: 'Downey',
    locationId: '5',
    locationName: 'Downey',
    cohCustomerId: '1217',
    cohCustomerName: 'DOWNEY-COH',
    bankAccount: '10005',
    bankAccountQbId: '48',
    bankAccountName: '10005 - Paramount',
  },
  hollywood: {
    classId: '2200000000000083328',
    className: 'Hollywood',
    locationId: '14',
    locationName: 'Hollywood',
    cohCustomerId: '1239',
    cohCustomerName: 'HOLLYWOOD- COH',
    bankAccount: '10003',
    bankAccountQbId: '212',
    bankAccountName: '10003 - Hollywood',
  },
  'huntington park': {
    classId: '1',
    className: 'Huntington Park',
    locationId: '2',
    locationName: 'Huntington Park',
    cohCustomerId: '1238',
    cohCustomerName: 'HUNTINGTON PARK- COH',
    bankAccount: '10008',
    bankAccountQbId: '37',
    bankAccountName: '10008 - Santa fe',
  },
  huntington: {
    classId: '1',
    className: 'Huntington Park',
    locationId: '2',
    locationName: 'Huntington Park',
    cohCustomerId: '1238',
    cohCustomerName: 'HUNTINGTON PARK- COH',
    bankAccount: '10008',
    bankAccountQbId: '37',
    bankAccountName: '10008 - Santa fe',
  },
  'la puente': {
    classId: '2200000000000140845',
    className: 'La Puente',
    locationId: '19',
    locationName: 'La Puente',
    cohCustomerId: '1231',
    cohCustomerName: 'LA PUENTE -COH',
    bankAccount: '10013',
    bankAccountQbId: '334',
    bankAccountName: '10013 - La Puente',
  },
  puente: {
    classId: '2200000000000140845',
    className: 'La Puente',
    locationId: '19',
    locationName: 'La Puente',
    cohCustomerId: '1231',
    cohCustomerName: 'LA PUENTE -COH',
    bankAccount: '10013',
    bankAccountQbId: '334',
    bankAccountName: '10013 - La Puente',
  },
  lynwood: {
    classId: '2200000000000075312',
    className: 'Lynwood',
    locationId: '13',
    locationName: 'Lynwood',
    cohCustomerId: '1237',
    cohCustomerName: 'LYNWOOD-COH',
    bankAccount: '10004',
    bankAccountQbId: '258',
    bankAccountName: '10004 - Lynwood',
  },
  norwalk: {
    classId: '2200000000000222249',
    className: 'Norwalk',
    locationId: '24',
    locationName: 'Norwalk',
    cohCustomerId: '1225',
    cohCustomerName: 'NORWALK -COH',
    bankAccount: '10014',
    bankAccountQbId: '378',
    bankAccountName: '10014 - Norwalk',
  },
  rialto: {
    classId: '2200000000000057575',
    className: 'Rialto',
    locationId: '11',
    locationName: 'Rialto',
    cohCustomerId: '1430',
    cohCustomerName: 'RIALTO-COH',
    bankAccount: '10017',
    bankAccountQbId: '412',
    bankAccountName: '10017 - Rialto-8205',
  },
  'santa ana': {
    classId: '2200000000000136142',
    className: 'Santa Ana',
    locationId: '18',
    locationName: 'Santa Ana',
    cohCustomerId: '1230',
    cohCustomerName: 'SANTA ANA -COH',
    bankAccount: '10007',
    bankAccountQbId: '272',
    bankAccountName: '10007 - Santa ana',
  },
  slauson: {
    classId: '2200000000000164243',
    className: 'Slauson',
    locationId: '20',
    locationName: 'Slauson',
    cohCustomerId: '1363',
    cohCustomerName: 'SLAUSON-COH',
    bankAccount: '10015',
    bankAccountQbId: '379',
    bankAccountName: '10015 - Slauson',
  },
  'south gate': {
    classId: '2200000000000140757',
    className: 'Souht Gate', // Cohesion exact match with QB typo
    locationId: '16',
    locationName: 'South Gate',
    cohCustomerId: '1240',
    cohCustomerName: 'SOUTH GATE- COH',
    bankAccount: '10009',
    bankAccountQbId: '211',
    bankAccountName: '10009 - South Gate',
  },
  'west covina': {
    classId: '2200000000000134063',
    className: 'West Covina',
    locationId: '17',
    locationName: 'West Covina',
    cohCustomerId: '1228',
    cohCustomerName: 'WEST COVINA-COH',
    bankAccount: '10012',
    bankAccountQbId: '282',
    bankAccountName: '10012 - West covina',
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
    bankAccount: '10000',
    bankAccountQbId: '213',
    bankAccountName: '10000 - Azusa',
  }
}
