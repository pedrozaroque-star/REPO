import { NextResponse, NextRequest } from 'next/server'
import { getSupabaseAdminClient } from '@/lib/supabase'

// Ruta POST: Recibe datos de RONOS
export async function POST(request: NextRequest) {
    try {
        // 1. Capa de Seguridad: Validar Llave de API
        // Esperamos que RONOS envíe un header de autorización
        const authHeader = request.headers.get('authorization') || request.headers.get('x-api-key')

        // En producción, verificaremos esto contra una llave segura en .env.local
        // ej: process.env.RONOS_WEBHOOK_SECRET
        const expectedKey = process.env.RONOS_WEBHOOK_SECRET || 'RONOS_TEMP_TEST_KEY_2026'

        if (!authHeader || !authHeader.includes(expectedKey)) {
            console.warn('[RONOS] Intento de acceso denegado. Llave incorrecta o faltante.')
            return NextResponse.json({ error: 'Unauthorized. Invalid API Key.' }, { status: 401 })
        }

        // 2. Recibir Payload (JSON)
        const payload = await request.json()

        // Console log para ver la estructura exacta que manda RONOS en Vercel Logs
        console.log('[RONOS WEBHOOK] Payload recibido:', JSON.stringify(payload, null, 2))

        // 3. Validación básica de estructura
        // Ejemplo genérico: Asumimos que mandan un arreglo de "punches" o de "timesheets"
        const dataArray = payload.punches || payload.data || payload.timesheets

        if (!dataArray || !Array.isArray(dataArray)) {
            console.warn('[RONOS] Formato JSON inesperado. No se encontró arreglo de punches.')
            return NextResponse.json(
                {
                    success: false,
                    error: 'Formato inválido. Se espera un arreglo en la propiedad "punches", "data" o "timesheets".',
                    received_keys: Object.keys(payload)
                },
                { status: 400 }
            )
        }

        // 4. Conexión a Base de Datos (Admin Client para saltar RLS)
        const supabase = await getSupabaseAdminClient()

        // Variables para conteo
        let inserted = 0
        let errors = 0

        // 5. Procesar los registros recibidos
        for (const item of dataArray) {
            try {
                // Aquí adaptaremos los campos exactos una vez que Vikesh nos diga cómo se llaman.
                // Ejemplo de lo que esperamos que envíen:
                const ronosEmployeeId = item.employeeId || item.employee_id || item.assignmentId
                const locationId = item.locationId || item.storeId
                const clockIn = item.clockInTime || item.startTime
                const clockOut = item.clockOutTime || item.endTime
                const totalHours = item.hours || item.regular_hours

                // Si falta información vital, saltar y registrar
                if (!ronosEmployeeId || !clockIn) {
                    throw new Error('Falta EmployeeID o ClockIn')
                }

                // ---------------------------------------------------------
                // TODO: Lógica de guardado en la base de datos (Supabase)
                // Esto se descomentará y ajustará cuando tengamos su JSON real
                // ---------------------------------------------------------

                /*
                // Paso A: Buscar el empleado en nuestra DB usando el ID de Ronos
                const { data: employee } = await supabase
                    .from('toast_employees')
                    .select('toast_guid')
                    .eq('external_employee_id', ronosEmployeeId)
                    .single()

                if (employee) {
                    // Paso B: Insertar el punch (marcaje)
                    await supabase.from('punches').upsert({
                        toast_id: `ronos-${item.id || Date.now()}`,
                        employee_toast_guid: employee.toast_guid,
                        clock_in: clockIn,
                        clock_out: clockOut,
                        regular_hours: totalHours || 0,
                        source: 'RONOS',
                        last_updated: new Date().toISOString()
                    })
                }
                */

                inserted++
            } catch (err: any) {
                console.error(`[RONOS] Error procesando registro: ${err.message}`, item)
                errors++
            }
        }

        return NextResponse.json({
            success: true,
            message: 'Webhook recibido y procesado correctamente',
            summary: {
                total_received: dataArray.length,
                inserted,
                errors
            }
        }, { status: 200 })

    } catch (err: any) {
        console.error('[RONOS WEBHOOK] Error fatal:', err)
        return NextResponse.json({ error: 'Internal Server Error', details: err.message }, { status: 500 })
    }
}
