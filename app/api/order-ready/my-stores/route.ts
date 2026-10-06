/**
 * @module api/order-ready/my-stores
 * @description Devuelve las tiendas que el usuario autenticado puede ver en el Order Ready Board.
 *
 * @businessRules
 * - admin: todas (`all: true`). supervisor: solo su alcance. manager/asistente: solo su tienda (ver lib/order-ready-access.ts).
 *
 * @dataFlow
 * - Board -> GET /api/order-ready/my-stores (cookie teg_token) -> { all, codes } -> el tablero filtra su selector.
 *
 * @notes
 * - 401 si no hay sesión válida.
 */

import { NextResponse } from 'next/server'
import { getOrderReadyAccess } from '@/lib/order-ready-access'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const access = await getOrderReadyAccess(request)
    if (!access) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    return NextResponse.json({ success: true, all: access.all, codes: access.codes })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 })
  }
}
