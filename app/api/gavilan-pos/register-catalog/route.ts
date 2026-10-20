/**
 * @module app/api/gavilan-pos/register-catalog/route
 * @description Catálogo real para la pantalla de Caja de Gavilan POS: platillos In Store de Toast
 *              (`toast_menu_items`) agrupados por familia + modificadores basados en uso real
 *              (`gavilan_pos_register_modifiers`) + estado 86 / estación (`gavilan_pos_menu_items`).
 *
 * @businessRules
 * - Solo menús In Store (`In Store Menu` / `In Store Drinks`). Kiosk, Online y 3rd Party quedan fuera.
 * - Se ocultan: Tripa sin ventas en 349 días, `Test Item`, separadores, `Empleado`/`Policia` y GUIDs duplicados
 *   (ver `hiddenReasonFor` en `lib/gavilan-pos/register-layout.ts`).
 * - Precio = precio vivo de Toast (`toast_menu_items.price`). Modificadores con precio real cobrado (PMIX).
 * - Estación de cocina: `gavilan_pos_menu_items.station_code` si existe (editable en Estudio de Menú), si no, la de la familia.
 * - Requiere sesión TEG válida (`teg_token`).
 *
 * @dataFlow
 * - Supabase (service role) → JSON `{ families, items, modifiers, hidden }` → `components/gavilan-pos/CashierRegister.tsx`.
 *
 * @notes
 * - El cliente guarda la respuesta en `localStorage` (`gavilan_pos_register_catalog_v1`) para operar offline.
 */
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getServerUser } from '@/lib/auth-server'
import {
    REGISTER_FAMILIES,
    familyFromToastGroup,
    hiddenReasonFor,
    isSecondaryItem,
    proteinOf,
    proteinSortKey,
    beverageSortKey,
    type RegisterCatalogItem,
    type RegisterModifierOption,
    type RegisterFamilyKey,
    type PrepStation,
} from '@/lib/gavilan-pos/register-layout'

export const dynamic = 'force-dynamic'

const VALID_STATIONS: PrepStation[] = ['PARRILLA', 'LINEA', 'TORTILLAS', 'BEBIDAS', 'NONE']

export async function GET(req: Request) {
    const user = await getServerUser(req)
    if (!user) {
        return NextResponse.json({ ok: false, error: 'No autenticado. Inicia sesión nuevamente.' }, { status: 401 })
    }

    try {
        const [{ data: toastItems, error: itemsErr }, { data: posMenu, error: posErr }, { data: mods, error: modsErr }] = await Promise.all([
            supabaseAdmin
                .from('toast_menu_items')
                .select('guid, name, price, group_name, is_modifier, active')
                .eq('is_modifier', false)
                .eq('active', true),
            supabaseAdmin.from('gavilan_pos_menu_items').select('id, is_86ed, station_code'),
            supabaseAdmin
                .from('gavilan_pos_register_modifiers')
                .select('id, family, kind, group_key, label, toast_guid, price, is_default, is_alert, usage_units, sort_order')
                .eq('is_active', true)
                .order('family', { ascending: true })
                .order('kind', { ascending: true })
                .order('sort_order', { ascending: true }),
        ])
        if (itemsErr) throw itemsErr
        if (posErr) throw posErr
        if (modsErr) throw modsErr

        const posById = new Map((posMenu || []).map((r: any) => [String(r.id), r]))
        const familyStation = new Map(REGISTER_FAMILIES.map(f => [f.key, f.prepStation]))

        const items: RegisterCatalogItem[] = []
        const hidden: { name: string; reason: string }[] = []
        for (const row of toastItems || []) {
            const family = familyFromToastGroup(row.group_name)
            if (!family) continue
            const reason = hiddenReasonFor(row.name, row.guid)
            if (reason) {
                hidden.push({ name: row.name, reason })
                continue
            }
            const pos: any = posById.get(String(row.guid))
            const station = VALID_STATIONS.includes(pos?.station_code) ? pos.station_code : (familyStation.get(family) || 'LINEA')
            const price = Number(row.price)
            items.push({
                guid: row.guid,
                name: String(row.name).trim(),
                family,
                price: Number.isFinite(price) ? Math.round(price * 100) / 100 : 0,
                prepStation: station as PrepStation,
                protein: proteinOf(row.name),
                secondary: isSecondaryItem(row.name),
                inStock: pos ? !pos.is_86ed : true,
            })
        }
        items.sort((a, b) => {
            if (a.family !== b.family) return a.family.localeCompare(b.family)
            if (a.secondary !== b.secondary) return a.secondary ? 1 : -1
            if (a.family === 'bebidas') {
                const ba = beverageSortKey(a.name)
                const bb = beverageSortKey(b.name)
                if (ba !== bb) return ba - bb
            }
            const pa = proteinSortKey(a.name)
            const pb = proteinSortKey(b.name)
            if (pa !== pb) return pa - pb
            return a.name.localeCompare(b.name)
        })

        const familyKeys = new Set(REGISTER_FAMILIES.map(f => f.key))
        const modifiers: RegisterModifierOption[] = (mods || [])
            .filter((m: any) => familyKeys.has(m.family))
            .map((m: any) => ({
                id: m.id,
                family: m.family as RegisterFamilyKey,
                kind: m.kind,
                groupKey: m.group_key,
                label: m.label,
                toastGuid: m.toast_guid,
                price: Math.round(Number(m.price || 0) * 100) / 100,
                isDefault: Boolean(m.is_default),
                isAlert: Boolean(m.is_alert),
                usageUnits: Number(m.usage_units || 0),
                sortOrder: Number(m.sort_order || 0),
            }))

        return NextResponse.json({
            ok: true,
            generatedAt: new Date().toISOString(),
            source: 'toast_menu_items + gavilan_pos_register_modifiers (pmix_daily_cache 349 días x 15 tiendas)',
            families: REGISTER_FAMILIES.map(f => ({ key: f.key, units349d: f.units349d })),
            items,
            modifiers,
            hidden,
        })
    } catch (error: any) {
        console.error('[Gavilan POS Register Catalog GET Error]:', error)
        return NextResponse.json({ ok: false, error: error?.message || 'Error cargando catálogo' }, { status: 500 })
    }
}
