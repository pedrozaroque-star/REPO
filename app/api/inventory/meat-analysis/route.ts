import { NextRequest, NextResponse } from 'next/server'
import { getProductMix } from '@/lib/toast-pmix'
import { getSupabaseAdminClient } from '@/lib/supabase'
import { InventoryItem } from '@/types/inventory'

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams
        const storeId = searchParams.get('storeId')
        const startDate = searchParams.get('startDate')
        const endDate = searchParams.get('endDate')
        const inventoryItemId = searchParams.get('ingredientId') // Optional: Filter by specific ingredient

        if (!storeId || !startDate || !endDate) {
            return NextResponse.json({ error: 'Missing params' }, { status: 400 })
        }

        // 1. Fetch Sales (PMIX)
        const pmixItems = await getProductMix({ storeId, startDate, endDate })

        // 2. Fetch Data
        const supabase = await getSupabaseAdminClient()

        const { data: recipesData, error: recipeError } = await supabase
            .from('recipes')
            .select('*')

        if (recipeError) throw recipeError

        const { data: inventoryData, error: invError } = await supabase
            .from('inventory_items')
            .select('*')

        if (invError) throw invError

        // 4. Analyze Consumption
        const analysis = {
            ingredientId: inventoryItemId,
            ingredientName: '',
            totalQuantityUsed: 0,
            totalRawLbs: 0,
            yieldPercent: 100,
            breakdown: [] as any[]
        }

        const targetItem = inventoryData.find((i: any) => i.id === inventoryItemId) as InventoryItem
        if (!targetItem) {
            return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })
        }

        analysis.ingredientName = targetItem.name
        const yieldRatio = (targetItem.yield_percent || 100) / 100
        analysis.yieldPercent = targetItem.yield_percent || 100

        // Calculate Cost Per Lb
        let costPerLb = 0
        if (targetItem.purchase_unit_cost) {
            const qtyPerUnit = targetItem.quantity_per_unit || 1
            const unit = targetItem.unit_measure?.toLowerCase() || ''

            // Base cost per "Inventory Unit" (e.g. per Case)
            // We need cost per Raw Pound.

            if (unit === 'oz' || unit === 'onzas') {
                // Cost per Oz * 16
                costPerLb = (targetItem.purchase_unit_cost / qtyPerUnit) * 16
            } else if (unit === 'kg' || unit === 'kilos') {
                // Cost per Kg / 2.20462
                costPerLb = (targetItem.purchase_unit_cost / qtyPerUnit) / 2.20462
            } else {
                // Assume Lb if 'lb', 'lbs', or 'pza' (if typical meat bag).
                // Default: Cost / Quantity = Cost/Lb
                costPerLb = targetItem.purchase_unit_cost / qtyPerUnit
            }
        }

        // Map relevant recipes for quick lookup
        const recipeLookup = new Map<string, any>()
        recipesData.forEach((r: any) => {
            if (r.inventory_item_id === inventoryItemId) {
                recipeLookup.set(r.toast_menu_item_guid, r)
            }
        })

        // Process each sold item
        pmixItems.forEach(soldItem => {
            // Check if this item uses the ingredient
            const recipeRow = recipeLookup.get(soldItem.guid)
            if (!recipeRow) return

            const soldQty = soldItem.quantity
            const portionQty = Number(recipeRow.quantity || 0)
            const unit = recipeRow.unit

            let lbsAmount = 0
            let totalAmount = soldQty * portionQty

            if (unit === 'oz') lbsAmount = totalAmount / 16
            else if (unit === 'lb') lbsAmount = totalAmount
            else if (unit === 'g') lbsAmount = totalAmount * 0.00220462
            else if (unit === 'kg') lbsAmount = totalAmount * 2.20462

            // Yield application (Cooked -> Raw)
            // Recipes are usually "Cooked Portions" (e.g. 1.5 oz cooked meat).
            // We need Raw Lbs.
            const rawLbs = lbsAmount / yieldRatio
            analysis.totalRawLbs += rawLbs

            // Financials
            const salesAmount = soldItem.net_sales || 0
            const costAmount = rawLbs * costPerLb
            const utilityAmount = salesAmount - costAmount

            analysis.breakdown.push({
                guid: soldItem.guid,
                itemName: soldItem.name,
                soldQty: soldItem.quantity,
                portionQty: portionQty,
                unit: unit,
                rawLbs: rawLbs,
                yieldPct: yieldRatio * 100,
                salesAmount,
                costAmount,
                utilityAmount
            })
        })

        analysis.breakdown.sort((a, b) => b.rawLbs - a.rawLbs)

        return NextResponse.json(analysis)

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
