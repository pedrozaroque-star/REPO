/**
 * @module verify-packaging-vs-bodega
 * @description Compara los quantity_per_unit de la base de datos con la lista
 * de empaque de la bodega para encontrar discrepancias.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Datos de la lista de la bodega (06/19/2026)
const BODEGA_LIST = [
    // Carnes
    { name: 'Carne Asada', unit: 'lb', qty: 10 },
    { name: 'Pastor', unit: 'lb', qty: 10 },
    { name: 'Cabeza', unit: 'lb', qty: 5 },
    { name: 'Lengua', unit: 'lb', qty: 5 },
    { name: 'Buche 6 oz', unit: 'oz', qty: 6 },
    { name: 'Carnitas 6 oz', unit: 'oz', qty: 6 },
    { name: 'Pollo', unit: 'lb', qty: 10 },
    { name: 'Chorizo 8 oz', unit: 'oz', qty: 8 },
    { name: 'Salchicha Bag', unit: 'lb', qty: 1 },
    { name: 'Milaneza', unit: 'lb', qty: 2.6 },
    { name: 'Jamon Pack', unit: 'lb', qty: 2 },
    // Bases
    { name: 'Arroz', unit: 'lb', qty: 5 },
    { name: 'Frijol Entero', unit: 'lb', qty: 10 },
    { name: 'Frijol Molido', unit: 'lb', qty: 10 },
    // Tortillas/Pan
    { name: 'Papelito Para Torta', unit: 'oz', qty: 3.9 },
    { name: '1100', unit: 'dz', qty: 5 }, // 5 dz = 60 pza
    { name: '358-9673BT 13" Flour Tortilla', unit: 'dz', qty: 1 }, // 1 dz = 12
    { name: '358_9604BT Tortilla Regular 8 in', unit: 'dz', qty: 1 },
    { name: 'Teleras', unit: 'pza', qty: 6 },
    { name: 'Sopes', unit: 'dz', qty: 1 },
    { name: 'Tortilla Nachos', unit: 'oz', qty: 4.5 },
    // Quesos
    { name: 'Queso Rayado', unit: 'lb', qty: 2 },
    { name: 'Queso Cotija 021', unit: 'oz', qty: 12 },
    { name: 'Queso Tortas', unit: 'lb', qty: 1 },
    { name: 'Quesadilla Bodega', unit: 'pza', qty: 12 },
    { name: 'Mulitas Con Queso', unit: 'lb', qty: 3.06 },
    { name: 'Amarillo Cheese', unit: 'oz', qty: 560 },
    // Salsas/Concentrados
    { name: 'Horchata', unit: 'gal', qty: 1 },
    { name: 'Tamarindo Concentrate', unit: 'gal', qty: 1 },
    { name: 'Jamaica Concentrate', unit: 'gal', qty: 1 },
    { name: 'Piña Concentrate', unit: 'gal', qty: 1 },
    { name: 'Salsa Roja', unit: 'gal', qty: 1 },
    { name: 'Salsa Verde', unit: 'gal', qty: 1 },
    { name: 'Champurrado Mix', unit: 'gal', qty: 1 },
    // Bolsas/Packs
    { name: 'Bolsa Aguacate', unit: 'lb', qty: 2 },
    { name: 'Bolsa Crema', unit: 'lb', qty: 1.5 },
    { name: 'Bolsa Mayonesa', unit: 'lb', qty: 1.5 },
    { name: '1 oz Bolsa de Mixta', unit: 'ct', qty: 190 },
    { name: 'Onion/ Cil. Mix', unit: 'lb', qty: 5 },
    { name: 'Lima Bolsita', unit: 'ct', qty: 210 },
    { name: 'Bolsa Lima 5 LB', unit: 'lb', qty: 5 },
    { name: 'Onion Pepper Mix', unit: 'lb', qty: 5 },
    // Huevos
    { name: 'Huevo', unit: 'dz', qty: 15 }, // Case of 15 dz = 180 eggs
    // Salsas empacadas
    { name: '1.5 oz Salsa Roja Pack', unit: 'ct', qty: 400 },
    { name: '1.5 oz Salsa Verde Pack', unit: 'ct', qty: 400 },
    { name: '1.5 oz Salsa Roja Taquera', unit: 'ct', qty: 400 },
    // Otros
    { name: 'Salsa Huevos Rancheros', unit: 'lb', qty: 2.3 },
    { name: 'Rajas y Zanahorias', unit: 'lb', qty: 6.5625 }, // 6 lbs 9 oz
    { name: '2 oz Bolsas de Rajas', unit: 'ct', qty: 165 },
    { name: 'Agua Gavilan', unit: 'pza', qty: 24 },
];

async function verify() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: items } = await supabase
        .from('inventory_items')
        .select('id, name, purchase_unit_cost, quantity_per_unit, unit_type');

    if (!items) { console.log('No items'); return; }

    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('  VERIFICACIÓN: DB vs Lista de Bodega');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    
    let matches = 0, mismatches = 0, notFound = 0;

    for (const bodega of BODEGA_LIST) {
        // Find matching DB item by name (fuzzy)
        const dbItem = items.find(i => {
            const dbName = i.name.toLowerCase().trim();
            const bName = bodega.name.toLowerCase().trim();
            return dbName === bName || dbName.includes(bName) || bName.includes(dbName);
        });

        if (!dbItem) {
            console.log(`  ❓ NOT FOUND: "${bodega.name}" (Bodega: ${bodega.qty} ${bodega.unit})`);
            notFound++;
            continue;
        }

        const dbQty = dbItem.quantity_per_unit || 1;
        const dbUnit = (dbItem.unit_type || '').toLowerCase();
        
        // Normalize units for comparison
        let bodegaQtyNormalized = bodega.qty;
        let bodegaUnitNormalized = bodega.unit;
        
        // Convert dz to pza
        if (bodega.unit === 'dz') {
            bodegaQtyNormalized = bodega.qty * 12;
            bodegaUnitNormalized = 'pza';
        }

        const qtyMatch = Math.abs(dbQty - bodegaQtyNormalized) < 0.5;
        const costPerUnit = dbItem.purchase_unit_cost / dbQty;
        
        if (qtyMatch) {
            matches++;
            console.log(`  ✅ "${dbItem.name}" | DB: ${dbQty} ${dbUnit} | Bodega: ${bodega.qty} ${bodega.unit} | Price: $${dbItem.purchase_unit_cost} ($${costPerUnit.toFixed(4)}/${dbUnit || 'unit'})`);
        } else {
            mismatches++;
            console.log(`  ⚠️  MISMATCH: "${dbItem.name}"`);
            console.log(`      DB:     ${dbQty} ${dbUnit} | Price: $${dbItem.purchase_unit_cost}`);
            console.log(`      Bodega: ${bodegaQtyNormalized} ${bodegaUnitNormalized} (original: ${bodega.qty} ${bodega.unit})`);
            console.log(`      DB cost/unit: $${costPerUnit.toFixed(4)} | If bodega qty: $${(dbItem.purchase_unit_cost / bodegaQtyNormalized).toFixed(4)}`);
        }
    }

    console.log('\n═══ RESUMEN ═══');
    console.log(`  ✅ Coinciden: ${matches}`);
    console.log(`  ⚠️  Discrepancias: ${mismatches}`);
    console.log(`  ❓ No encontrados: ${notFound}`);
}

verify().catch(console.error);
