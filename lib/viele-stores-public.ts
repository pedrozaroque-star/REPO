/**
 * @module lib/viele-stores-public
 * @description Catálogo público de sucursales y formateadores para el módulo Viele & Sons.
 *              Contiene únicamente metadatos públicos de las 15 sucursales (ID, nombre y código de cliente Sage 100).
 *              Este archivo es 100% seguro para importarse en componentes Client y Server sin exponer credenciales.
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan (estrictamente).
 * - 15 sucursales activas numeradas del 1 al 16 (la tienda #2 no está activa en Viele).
 * - NO incluye contraseñas, correos electrónicos ni secretos.
 *
 * @dataFlow
 * - Importado por componentes Client de UI (page.tsx, historial/page.tsx, print-sheet/page.tsx)
 *   y utilidades compartidas de formato de moneda y fechas.
 *
 * @notes
 * - [2026-09-21] Creado para aislar completamente las credenciales privadas (que residen en lib/viele-credentials-server.ts)
 *   y evitar que Next.js incluya secretos en los bundles de JavaScript del cliente.
 */

export interface VielePublicStore {
  storeId: number;
  storeName: string;
  sageCustomerCode: string;
}

export const VIELE_PUBLIC_STORES: Record<number, VielePublicStore> = {
  1: { storeId: 1, storeName: 'Rialto', sageCustomerCode: '00ELG1' },
  3: { storeId: 3, storeName: 'West Covina', sageCustomerCode: '00ELGA10' },
  4: { storeId: 4, storeName: 'Azusa', sageCustomerCode: '00ELG8' },
  5: { storeId: 5, storeName: 'LA Broadway', sageCustomerCode: '00ELG4' },
  6: { storeId: 6, storeName: 'LA Central', sageCustomerCode: '00ELG' },
  7: { storeId: 7, storeName: 'Slauson', sageCustomerCode: '00ELG306' },
  8: { storeId: 8, storeName: 'Hollywood', sageCustomerCode: '00ELGA70' },
  9: { storeId: 9, storeName: 'Santa Ana', sageCustomerCode: '00ELGA1' },
  10: { storeId: 10, storeName: 'La Puente', sageCustomerCode: '00ELGA13' },
  11: { storeId: 11, storeName: 'Huntington Park', sageCustomerCode: '00ELG24' },
  12: { storeId: 12, storeName: 'Norwalk', sageCustomerCode: '00ELGA109' },
  13: { storeId: 13, storeName: 'Bell', sageCustomerCode: '00ELGA4' },
  14: { storeId: 14, storeName: 'Lynwood', sageCustomerCode: '00ELG3' },
  15: { storeId: 15, storeName: 'South Gate', sageCustomerCode: '00ELGA5' },
  16: { storeId: 16, storeName: 'Downey', sageCustomerCode: '00ELGA7' }
};

/**
 * Formatea fecha YYYY-MM-DD al formato MM/DD/YYYY requerido por ClearNine
 */
export function formatShipDateForViele(dateStr: string): string {
  if (!dateStr) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts;
    return `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${year}`;
  }
  return dateStr;
}

/**
 * Formatea fecha ISO o YYYY-MM-DD al estándar de EE.UU. (MM/DD/YYYY)
 */
export function formatUsDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(cleanDate)) return cleanDate;
  const parts = cleanDate.split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts;
    return `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${year}`;
  }
  return cleanDate;
}

/**
 * Formato de fecha completa en formato estadounidense (e.g., "Tuesday, September 8, 2026")
 */
export function formatUsFullDate(dateStr: string | null | undefined, locale = 'en-US'): string {
  if (!dateStr) return '';
  const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
  const parts = cleanDate.split('-').map(Number);
  if (parts.length === 3) {
    const [y, m, d] = parts;
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return dt.toLocaleDateString(locale, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC'
    });
  }
  return cleanDate;
}

/**
 * Formatea un importe numérico a moneda con separador de miles en estándar estadounidense ($X,XXX.XX)
 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(Number(amount))) return '$0.00';
  return '$' + Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Formatea un número o cantidad de cajas con separador de miles estándar de EE.UU. (e.g. 1,215)
 */
export function formatNumber(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(Number(val))) return '0';
  return Number(val).toLocaleString('en-US');
}

/**
 * Valida si un storeId coincide con el scope de un usuario (id, array de ids, o nombres de tienda)
 */
export function matchStoreIdWithScope(storeId: number, scope: any): boolean {
  if (!scope) return false;
  const store = VIELE_PUBLIC_STORES[storeId];
  if (!store) return false;

  if (Array.isArray(scope)) {
    return scope.some(entry => {
      if (typeof entry === 'number') return entry === storeId;
      if (typeof entry === 'string') {
        const s = entry.trim().toUpperCase();
        if (s === String(storeId)) return true;
        const cleanName = store.storeName.toUpperCase();
        if (s.includes(cleanName) || cleanName.includes(s)) return true;
      }
      return false;
    });
  }
  if (typeof scope === 'string') {
    const s = scope.trim().toUpperCase();
    if (s === String(storeId)) return true;
    const cleanName = store.storeName.toUpperCase();
    return s.includes(cleanName) || cleanName.includes(s);
  }
  if (typeof scope === 'number') {
    return scope === storeId;
  }
  return false;
}

