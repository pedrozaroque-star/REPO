
import { getSupabaseAdminClient } from '../lib/supabase'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const SODA_RECIPES = [
    // format: { toast_guid: string, inventory_id: string, qty: number, unit: string }

    // COKE (Classic)
    { toast_guid: 'b9d2f1ea-9fd4-4dd8-8102-ee205715210e', inventory_id: 'd7d3d6f5-7426-49b0-8567-9d3b4f3c196f', qty: 2.38, unit: 'oz' }, // Medium
    { toast_guid: '0f067ef6-8e09-49d8-aa68-bdd2619184a9', inventory_id: 'd7d3d6f5-7426-49b0-8567-9d3b4f3c196f', qty: 3.47, unit: 'oz' }, // Large

    // DIET COKE
    { toast_guid: 'e43f6806-a27c-4bea-a17e-cb60af738de4', inventory_id: '8d211e94-2f16-40e8-aabf-22a26b981011', qty: 2.38, unit: 'oz' }, // Medium
    { toast_guid: 'bc4a75f9-6a1a-4abc-b595-14f7e73133b2', inventory_id: '8d211e94-2f16-40e8-aabf-22a26b981011', qty: 3.47, unit: 'oz' }, // Large

    // SPRITE
    { toast_guid: '72c67593-8f8d-49c4-97a7-1ab4e1d51ff9', inventory_id: 'baea9049-eae9-4cf4-9c78-b0c0c42e2ca5', qty: 2.38, unit: 'oz' }, // Medium
    { toast_guid: 'b59c2171-058a-4871-bb2e-4841d3ee697c', inventory_id: 'baea9049-eae9-4cf4-9c78-b0c0c42e2ca5', qty: 3.47, unit: 'oz' }, // Large

    // LEMONADE
    { toast_guid: '2fd3dccc-a577-4d37-ab29-c70efaa3ce77', inventory_id: 'f3805b35-5471-458b-a6a8-52e4ff13ca9e', qty: 2.38, unit: 'oz' }, // Medium
    { toast_guid: 'cec6b9a8-7a20-4599-9451-2db5cdd54d70', inventory_id: 'f3805b35-5471-458b-a6a8-52e4ff13ca9e', qty: 3.47, unit: 'oz' }, // Large

    // FANTA ORANGE
    { toast_guid: '6a387e5d-d702-47be-8f64-d18e0607c1e6', inventory_id: 'ec94de24-258e-46f9-93a7-9a5ec2508d5b', qty: 2.38, unit: 'oz' }, // Medium
    { toast_guid: '99f1334b-9110-4f0c-abee-25932cd33171', inventory_id: 'ec94de24-258e-46f9-93a7-9a5ec2508d5b', qty: 3.47, unit: 'oz' }, // Large

    // FANTA STRAWBERRY
    { toast_guid: 'ca3711d8-0140-4454-bf63-5da1bf3a3393', inventory_id: 'b0fdb895-3807-406d-9e85-cdc001dac951', qty: 2.38, unit: 'oz' }, // Medium 1
    { toast_guid: 'b8a150e5-fba9-451a-9b5c-fd141724bd2d', inventory_id: 'b0fdb895-3807-406d-9e85-cdc001dac951', qty: 2.38, unit: 'oz' }, // Medium 2
    { toast_guid: '0f60ee4a-ee95-4ffd-a679-86f5fdf1f8e4', inventory_id: 'b0fdb895-3807-406d-9e85-cdc001dac951', qty: 3.47, unit: 'oz' }, // Large

    // COKE ZERO
    { toast_guid: '846a67b5-6ae5-42a4-8f76-bb56d4a2a648', inventory_id: '7ce71a1e-7843-4070-9199-3cd1fbafa69e', qty: 2.38, unit: 'oz' }, // Medium
    { toast_guid: 'f4f37555-c0c0-4a7e-8a3c-5d9e1ae79a0f', inventory_id: '7ce71a1e-7843-4070-9199-3cd1fbafa69e', qty: 3.47, unit: 'oz' }, // Large

    // ICED TEA
    { toast_guid: '86e3277e-ae0b-4ca8-8974-c345e5a66c8e', inventory_id: '1cddf490-00c5-43dc-b60f-9edc526a3cd3', qty: 3.47, unit: 'oz' }, // Large
]

async function seedSodaRecipes() {
    const supabase = await getSupabaseAdminClient()
    console.log(`Seeding ${SODA_RECIPES.length} soda recipes...`)

    for (const recipe of SODA_RECIPES) {
        console.log(` - Mapping GUID ${recipe.toast_guid} to inventory ${recipe.inventory_id} (${recipe.qty} ${recipe.unit})`)

        const { error } = await supabase
            .from('recipes')
            .upsert({
                toast_menu_item_guid: recipe.toast_guid,
                inventory_item_id: recipe.inventory_id,
                quantity: recipe.qty,
                unit: recipe.unit
            }, { onConflict: 'toast_menu_item_guid, inventory_item_id' })

        if (error) {
            console.error(`Error upserting recipe for ${recipe.toast_guid}:`, error.message)
        }
    }

    console.log("Seed complete.")
}

seedSodaRecipes()
