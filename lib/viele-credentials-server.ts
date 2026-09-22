/**
 * @module lib/viele-credentials-server
 * @description Almacén seguro de credenciales privadas para el módulo Viele & Sons.
 *              Protegido mediante 'server-only' para impedir que cualquier importación
 *              accidental en componentes de cliente se empaquete en el bundle de JavaScript público.
 *
 * @businessRules
 * - Marca oficial: Tacos Gavilan (estrictamente).
 * - Cada una de las 15 sucursales cuenta con un usuario y contraseña institucional en Viele & Sons.
 * - Las credenciales se leen exclusivamente de `VIELE_STORE_ACCOUNTS_JSON` en el entorno del servidor;
 *   nunca se guardan en el repositorio ni se devuelven al cliente.
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

interface VieleStoreSecret {
  email: string;
  password: string;
  defaultShipTo?: string;
}

function getVieleStoreSecrets(): Record<string, VieleStoreSecret> {
  const raw = process.env.VIELE_STORE_ACCOUNTS_JSON;
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, VieleStoreSecret>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    console.error('[VieleCredentials] VIELE_STORE_ACCOUNTS_JSON no contiene JSON válido');
    return {};
  }
}

/**
 * Obtiene una cuenta completa exclusivamente en el servidor. Devuelve undefined si la
 * sucursal no existe o si su secreto aún no está configurado en el entorno.
 */
export function getVieleStoreAccount(storeId: number): VieleStoreAccount | undefined {
  const store = VIELE_PUBLIC_STORES[storeId];
  const secret = getVieleStoreSecrets()[String(storeId)];
  if (!store || !secret?.email?.trim() || !secret?.password) return undefined;

  return {
    ...store,
    email: secret.email.trim(),
    password: secret.password,
    defaultShipTo: secret.defaultShipTo
  };
}

/** Obtiene únicamente las cuentas que tienen secretos válidos configurados en el entorno. */
export function getVieleStoreAccounts(): VieleStoreAccount[] {
  return Object.keys(VIELE_PUBLIC_STORES)
    .map(Number)
    .map(getVieleStoreAccount)
    .filter((account): account is VieleStoreAccount => Boolean(account));
}

/** Lista sucursales públicas cuya cuenta privada aún no fue configurada en el entorno. */
export function getMissingVieleStoreCredentialStoreIds(): number[] {
  return Object.keys(VIELE_PUBLIC_STORES)
    .map(Number)
    .filter(storeId => !getVieleStoreAccount(storeId));
}
