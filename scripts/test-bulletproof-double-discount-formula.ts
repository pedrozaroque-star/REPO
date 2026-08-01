import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

async function testBulletproofFormula() {
    console.log('=== Testing True Double Discount vs Superseded Formula ===')

    // Test Santa Ana #696
    const { data: rows696 } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-26')
        .ilike('store_name', '%Santa Ana%')
        .eq('check_id', '696')

    // Test Lynwood #940
    const { data: rows940 } = await supabase
        .from('sales_discounts_log')
        .select('*')
        .eq('business_date', '2026-07-26')
        .ilike('store_name', '%Lynwood%')
        .eq('check_id', '940')

    function isTrueDoubleDiscount(rows: any[]) {
        if (!rows || rows.length < 2) return false
        const types = Array.from(new Set(rows.map(r => r.discount_name)))
        if (types.length < 2) return false

        const amounts = rows.map(r => Number(r.discount_amount))
        // 1. Duplicado fantasma (ej: $9.93 y $9.93)
        const isGhostDuplicate = amounts.every(a => Math.abs(a - amounts[0]) < 0.01)
        if (isGhostDuplicate) return false

        const maxSingle = Math.max(...amounts)
        const sumAmounts = amounts.reduce((a, b) => a + b, 0)

        // Si uno de los descuentos por sí solo equivale al total descontado acumulado (o si maxSingle es el unico aplicado al dinero), entonces la regla menor fue reemplazada en POS.
        // En un verdadero doble descuento, la suma de los montos es mayor que cualquier descuento individual (sumAmounts > maxSingle + 0.05) Y NINGUNO por sí solo es igual a sumAmounts.
        // Pero en Ticket #696: $2.40 es el descuento total del dinero. El de $1.20 fue sobrescrito.
        // ¿Cómo detectamos si $2.40 fue el único descuento real aplicado al dinero?
        // Porque $2.40 es exactamente el 50% de la Mulita ($4.79)! Si se hubiera aplicado también el 25% ($1.20), el descuento total habría sido $3.60.
        // Por lo tanto, si la suma de los montos no es la que se cobró o si una regla es un reemplazo cancelado:
        
        // Regla: En un verdadero doble descuento, ambos montos se sumaron y NINGUNO de los montos grabados es igual al total cobrado por separado.
        // Si maxSingle es igual al descuento principal del ticket y el otro monto fue reemplazado:
        return true
    }

    console.log('Ticket #696 rows:', rows696?.map(r => `${r.discount_name}: $${r.discount_amount}`))
    console.log('Ticket #940 rows:', rows940?.map(r => `${r.discount_name}: $${r.discount_amount}`))
}

testBulletproofFormula()
