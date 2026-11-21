/**
 * @module SyncToastStores
 * @description Sincroniza información de tiendas desde la API de Toast hacia la base de datos (`public.stores` en Supabase).
 * @businessRules
 * - Exige rol estricto `'admin'` vía `verifyStaffAuth`.
 * - Procesa GUIDs de Toast y los limpia de prefijos corporativos.
 * - Mapea a las columnas correctas de la tabla `stores` (`external_id` para GUID y `zip_code` para código postal).
 * - JAMÁS sobrescribe `stores.weekly_hours` con arreglos vacíos `[]` ni pisa direcciones reales con direcciones falsas hardcodeadas.
 * @dataFlow
 * - Toast API (Partners API) -> sync-toast API -> stores Table (Supabase)
 * @notes
 * - [2026-11-20] FIX CRÍTICO: Eliminado `FALLBACK_ADDRESSES` con direcciones falsas y bloqueado el borrado de `weekly_hours` a `[]`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyStaffAuth } from '@/lib/auth-server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthToken } from '@/lib/toast-api'

export const dynamic = 'force-dynamic' // No caching

// MASTER MAPPING: Toast GUID -> Clean DB Name
const GUID_TO_CLEAN_NAME: Record<string, string> = {
    "acf15327-54c8-4da4-8d0d-3ac0544dc422": "Rialto",
    "e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8": "Azusa",
    "42ed15a6-106b-466a-9076-1e8f72451f6b": "Norwalk",
    "b7f63b01-f089-4ad7-a346-afdb1803dc1a": "Downey",
    "475bc112-187d-4b9c-884d-1f6a041698ce": "LA Broadway",
    "a83901db-2431-4283-834e-9502a2ba4b3b": "Bell",
    "5fbb58f5-283c-4ea4-9415-04100ee6978b": "Hollywood",
    "47256ade-2cd4-4073-9632-84567ad9e2c8": "Huntington Park",
    "8685e942-3f07-403a-afb6-faec697cd2cb": "LA Central",
    "3a803939-eb13-4def-a1a4-462df8e90623": "La Puente",
    "80a1ec95-bc73-402e-8884-e5abbe9343e6": "Lynwood",
    "3c2d8251-c43c-43b8-8306-387e0a4ed7c2": "Santa Ana",
    "9625621e-1b5e-48d7-87ae-7094fab5a4fd": "Slauson",
    "95866cfc-eeb8-4af9-9586-f78931e1ea04": "South Gate",
    "5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02": "West Covina"
}

export async function POST(request: NextRequest) {
    const auth = verifyStaffAuth(request, { allowedRoles: ['admin'], allowCron: false })
    if (!auth.authorized) return auth.response!

    try {
        const toastToken = await getAuthToken()
        if (!toastToken) throw new Error('Failed to auth with Toast')

        console.log('🔄 Syncing Deep Details from Toast Partners API...')

        const rawRes = await fetch(`${process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'}/partners/v1/restaurants`, {
            headers: { 'Authorization': `Bearer ${toastToken}` }
        })
        const rawData = await rawRes.json()
        const rawList = Array.isArray(rawData) ? rawData : (rawData.restaurants || [])

        let created = 0
        let updated = 0
        let errors = 0
        const logs: string[] = []

        for (const rawStore of rawList) {
            const toastId = rawStore.restaurantGuid || rawStore.guid || rawStore.id
            const rawName = (rawStore.restaurantName || rawStore.name || 'Unknown Store').trim()

            // 🎯 Determine Clean Name
            let cleanName = GUID_TO_CLEAN_NAME[toastId]
            if (!cleanName) {
                if (rawName.includes(' - ')) {
                    cleanName = rawName.split(' - ').pop()?.trim() || rawName
                } else if (rawName.includes('(')) {
                    cleanName = rawName.match(/\(([^)]+)\)/)?.[1].trim() || rawName
                } else {
                    // Remove corporate prefixes dynamically
                    cleanName = rawName
                        .replace(/tacos\s+(el\s+)?gavilan\s*/gi, '')
                        .trim()
                }
            }

            // ⚠️ FETCH FULL DETAILS (Standard Toast)
            let detail: any = {}
            try {
                // Rate limit guard
                await new Promise(r => setTimeout(r, 100))
                const detailRes = await fetch(`${process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'}/partners/v1/restaurants/${toastId}`, {
                    headers: { 'Authorization': `Bearer ${toastToken}` }
                })
                if (detailRes.ok) detail = await detailRes.json()
            } catch (e) { }

            // Extract Data strictly from Toast response (never inject fake hardcoded addresses)
            const addr1 = (detail.address?.address1 || detail.address?.street1 || '').trim()
            const city = (detail.address?.city || '').trim()
            const state = (detail.address?.state || '').trim()
            const zip = (detail.address?.zipCode || detail.address?.zip || '').trim()
            const phone = (detail.phoneNumber || detail.phone || '').trim()

            const lat = detail.latitude || detail.address?.latitude || null
            const lng = detail.longitude || detail.address?.longitude || null

            const derivedOpen = '09:00'
            const derivedClose = '01:00'

            // DB Operations
            let existing: any = null

            // 1. GUID Match (using external_id column)
            const { data: byGuid } = await supabaseAdmin.from('stores').select('*').eq('external_id', toastId).maybeSingle()
            if (byGuid) existing = byGuid

            // 2. Name Match
            if (!existing) {
                const { data: byName } = await supabaseAdmin.from('stores').select('*').ilike('name', cleanName).maybeSingle()
                if (byName) existing = byName
            }

            const dbId = existing?.id

            if (dbId) {
                // UPDATE (Safe Mode: preserve existing canonical address & NEVER overwrite weekly_hours with [])
                const updatePayload: any = {
                    external_id: toastId,
                    name: cleanName,
                    ...(!existing.address && addr1 ? { address: addr1 } : {}),
                    ...(!existing.city && city ? { city: city } : {}),
                    ...(!existing.state && state ? { state: state } : {}),
                    ...(!existing.zip_code && zip ? { zip_code: zip } : {}),
                    ...(phone ? { phone: phone } : {}),
                }
                if (!existing.latitude && !existing.longitude && lat && lng) {
                    updatePayload.latitude = lat
                    updatePayload.longitude = lng
                }

                const { error: updErr } = await supabaseAdmin.from('stores').update(updatePayload).eq('id', dbId)

                if (updErr) {
                    // Safe Fallback (No risky columns; preserve existing canonical address)
                    const safePayload: any = {
                        name: cleanName,
                        ...(!existing.address && addr1 ? { address: addr1 } : {}),
                        ...(!existing.city && city ? { city: city } : {}),
                        ...(!existing.state && state ? { state: state } : {}),
                        ...(phone ? { phone: phone } : {}) // Try phone in safe mode
                    }
                    const { error: retryErr } = await supabaseAdmin.from('stores').update(safePayload).eq('id', dbId)
                    if (retryErr) {
                        // ULTRA SAFE FALLBACK (No Phone)
                        const ultraSafe = { ...safePayload }; delete ultraSafe.phone
                        const { error: finalErr } = await supabaseAdmin.from('stores').update(ultraSafe).eq('id', dbId)
                        if (finalErr) logs.push(`Failed Update: ${cleanName}`)
                        else logs.push(`Updated (Address Only): ${cleanName}`)
                    } else {
                        updated++; logs.push(`Updated (Core): ${cleanName}`)
                    }
                } else {
                    updated++; logs.push(`Updated Full: ${cleanName}`)
                }

            } else {
                // CREATE
                let baseCode = cleanName.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, '')
                if (baseCode.length < 3) baseCode = (cleanName + 'XXX').substring(0, 3).toUpperCase()

                const newStore = {
                    name: cleanName,
                    address: addr1,
                    city: city,
                    state: state,
                    zip_code: zip,
                    phone: phone,
                    is_active: true,
                    external_id: toastId,
                    code: baseCode,
                    latitude: lat,
                    longitude: lng,
                    opening_time: derivedOpen,
                    closing_time: derivedClose
                }
                const { error: insErr } = await supabaseAdmin.from('stores').insert(newStore)
                if (insErr) {
                    // Create Fallback
                    const safePayload: any = { ...newStore }
                    delete safePayload.external_id
                    delete safePayload.zip_code
                    delete safePayload.latitude
                    delete safePayload.longitude
                    delete safePayload.weekly_hours

                    if (insErr.message.includes('stores_code_key')) {
                        safePayload.code = baseCode + Math.floor(Math.random() * 90 + 10)
                    }
                    const { error: retryErr } = await supabaseAdmin.from('stores').insert(safePayload)
                    if (retryErr) {
                        delete safePayload.phone
                        const { error: finalErr } = await supabaseAdmin.from('stores').insert(safePayload)
                        if (finalErr) logs.push(`Failed Create: ${cleanName}`)
                        else logs.push(`Created (Minimal): ${cleanName}`)
                    }
                    else { created++; logs.push(`Created: ${cleanName}`) }
                } else {
                    created++; logs.push(`Created: ${cleanName}`)
                }
            }
        }

        return NextResponse.json({ success: true, updated, created, errors, logs })

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
