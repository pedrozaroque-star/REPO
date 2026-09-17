/**
 * @module RefreshV31Week
 * @description Regenera la semana indicada mediante la API autenticada de proyecciones y verifica el resultado por tienda.
 * @businessRules Solo debe ejecutarse con autorización explícita, porque reemplaza caché de proyecciones para la semana seleccionada.
 * @dataFlow stores -> POST /api/projections/generate forceRecalc -> sales_projections_cache.
 * @notes Diseñado para actualizaciones controladas; no altera ventas reales ni reportes.
 */

import dotenv from 'dotenv'
import jwt from 'jsonwebtoken'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const WEEK_START = '2026-09-13'
const DAYS = 7
const PARALLEL_STORES = 3

async function main() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const signingKey = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET
    if (!url || !serviceKey || !signingKey) throw new Error('Missing required Supabase or JWT configuration')

    const db = createClient(url, serviceKey)
    const token = jwt.sign({
        sub: 'codex-forecast-refresh', email: 'codex@tacosgavilan.local', user_role: 'admin'
    }, signingKey, { expiresIn: '15m' })
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

    const { data: stores, error } = await db
        .from('stores')
        .select('external_id, name')
        .not('external_id', 'is', null)
        .order('name')
    if (error || !stores) throw new Error(error?.message || 'Could not load stores')

    const results: Array<{ store: string; status: number; days: number; partial: boolean; error?: string }> = []
    for (let index = 0; index < stores.length; index += PARALLEL_STORES) {
        const batch = await Promise.all(stores.slice(index, index + PARALLEL_STORES).map(async store => {
            try {
                const response = await fetch('http://localhost:3000/api/projections/generate', {
                    method: 'POST', headers,
                    body: JSON.stringify({ storeId: store.external_id, weekStart: WEEK_START, days: DAYS, forceRecalc: true })
                })
                const body = await response.json() as { partial?: boolean; projections?: Record<string, number>; error?: string; errors?: Array<{ error?: string }> }
                return {
                    store: store.name,
                    status: response.status,
                    days: Object.keys(body.projections || {}).length,
                    partial: body.partial === true,
                    error: body.error || body.errors?.[0]?.error
                }
            } catch (cause) {
                return { store: store.name, status: 0, days: 0, partial: true, error: cause instanceof Error ? cause.message : String(cause) }
            }
        }))
        results.push(...batch)
    }

    const failed = results.filter(result => result.status !== 200 || result.partial || result.days !== DAYS)
    console.log(JSON.stringify({ weekStart: WEEK_START, stores: stores.length, results, failed }, null, 2))
    if (failed.length > 0) process.exitCode = 1
}

main().catch(error => { console.error(error); process.exit(1) })
