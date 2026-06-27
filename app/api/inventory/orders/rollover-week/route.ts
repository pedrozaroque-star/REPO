/**
 * @module api/inventory/orders/rollover-week
 * @description API route para ejecutar el cierre/rollover de semana.
 *              Equivalente al macro `cambiarNombre()` del Google Sheets.
 *
 * @businessRules
 * - Solo se puede cerrar la semana si TODOS los items tienen sobrante del Domingo
 * - Al cerrar: clona las bases de la semana actual a la nueva semana
 * - Recalcula el PAR Ideal con el promedio de las últimas 8 semanas
 * - No se puede cerrar una semana futura
 *
 * @dataFlow
 * - Lee inventory_items (con excel_reference) para saber cuáles participan
 * - Lee inventory_counts del domingo para validar completitud
 * - Clona inventory_weekly_bases → nueva semana
 * - Recalcula inventory_par_ideal con promedio histórico
 *
 * @notes
 * - [2026-06-24] Implementación inicial.
 */

import { NextRequest, NextResponse } from 'next/server'
import { executeWeekRollover } from '@/app/inventory/orders/actions'

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { storeId, currentMonday } = body

        if (!storeId || !currentMonday) {
            return NextResponse.json(
                { error: 'storeId y currentMonday son requeridos' },
                { status: 400 }
            )
        }

        // Validar formato de fecha
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/
        if (!dateRegex.test(currentMonday)) {
            return NextResponse.json(
                { error: 'Formato de fecha inválido. Use YYYY-MM-DD.' },
                { status: 400 }
            )
        }

        const result = await executeWeekRollover(storeId, currentMonday)

        if (result.error) {
            return NextResponse.json(
                { error: result.error, missingCount: (result as any).missingCount },
                { status: 400 }
            )
        }

        return NextResponse.json({
            success: true,
            nextMonday: result.nextMonday,
            message: 'Semana cerrada exitosamente'
        })

    } catch (error: any) {
        console.error('[Rollover] Error:', error)
        return NextResponse.json(
            { error: error.message || 'Error al cerrar la semana' },
            { status: 500 }
        )
    }
}
