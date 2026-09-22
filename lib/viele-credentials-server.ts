/**
 * @module lib/viele-credentials-server
 * @description Almacén seguro de credenciales privadas para el módulo Viele & Sons.
 *              Protegido mediante 'server-only' para impedir que cualquier importación
 *              accidental en componentes de cliente se empaquete en el bundle de JavaScript público.
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan (estrictamente).
 * - Cada una de las 15 sucursales cuenta con un usuario y contraseña institucional en Viele & Sons.
 * - SOLO debe ejecutarse en el entorno Node.js / servidor de Next.js.
 *
 * @dataFlow
 * - Importado exclusivamente por lib/viele-api.ts, lib/viele-price-sync.ts y endpoints de API en el servidor.
 *
 * @notes
 * - [2026-09-21] Separado de VIELE_STORE_ACCOUNTS público para resolver el hallazgo de seguridad #1 de la auditoría.
 */

import 'server-only';
import { VIELE_PUBLIC_STORES, VielePublicStore } from './viele-stores-public';

export interface VieleStoreAccount extends VielePublicStore {
  email: string;
  password: string;
  defaultShipTo?: string;
}

export const VIELE_STORE_ACCOUNTS: Record<number, VieleStoreAccount> = {
  1: { ...VIELE_PUBLIC_STORES[1], email: 'rialto@tacosgavilan.com', password: 'teg562' },
  3: { ...VIELE_PUBLIC_STORES[3], email: 'westcovina@tacosgavilan.com', password: 'teg562' },
  4: { ...VIELE_PUBLIC_STORES[4], email: 'azusa@tacosgavilan.com', password: 'teg562' },
  5: { ...VIELE_PUBLIC_STORES[5], email: 'broadway@tacosgavilan.com', password: 'teg562' },
  6: { ...VIELE_PUBLIC_STORES[6], email: 'central@tacosgavilan.com', password: 'teg562' },
  7: { ...VIELE_PUBLIC_STORES[7], email: 'slauson@tacosgavilan.com', password: 'teg562' },
  8: { ...VIELE_PUBLIC_STORES[8], email: 'hollywood@tacosgavilan.com', password: 'teg562' },
  9: { ...VIELE_PUBLIC_STORES[9], email: 'santaana@tacosgavilan.com', password: 'teg562' },
  10: { ...VIELE_PUBLIC_STORES[10], email: 'lapuente@tacosgavilan.com', password: 'teg562' },
  11: { ...VIELE_PUBLIC_STORES[11], email: 'huntingtonpark@tacosgavilan.com', password: 'teg562' },
  12: { ...VIELE_PUBLIC_STORES[12], email: 'norwalk@tacosgavilan.com', password: 'teg562' },
  13: { ...VIELE_PUBLIC_STORES[13], email: 'bell@tacosgavilan.com', password: 'teg562' },
  14: { ...VIELE_PUBLIC_STORES[14], email: 'lynwood@tacosgavilan.com', password: 'teg562' },
  15: { ...VIELE_PUBLIC_STORES[15], email: 'southgate@tacosgavilan.com', password: 'teg562' },
  16: { ...VIELE_PUBLIC_STORES[16], email: 'downey@tacosgavilan.com', password: 'teg562' }
};
