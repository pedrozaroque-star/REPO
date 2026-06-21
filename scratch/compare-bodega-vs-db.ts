/**
 * Comparar la lista de empaque de la bodega (documento del usuario) vs la base de datos.
 * Cualquier discrepancia en quantity_per_unit causaría food cost incorrecto.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// ═══════════════════════════════════════════════════════════
// DATOS DEL DOCUMENTO DE LA BODEGA (imagen del usuario)
// ═══════════════════════════════════════════════════════════
const BODEGA_SPECS: { name: string; packSize: string; expectedQty: number; expectedUnit: string }[] = [
    // PAGE 1 - Bebidas/Salsas
    { name: 'Horchata', packSize: 'Bag of 1 Gallon', expectedQty: 1, expectedUnit: 'gal' },
    { name: 'Tamarindo Concentrate', packSize: 'Bag of 1 Gallon', expectedQty: 1, expectedUnit: 'gal' },
    { name: 'Jamaica Concentrate', packSize: 'Bag of 1 Gallon', expectedQty: 1, expectedUnit: 'gal' },
    { name: 'Piña Concentrate', packSize: 'Bag of 1 Gallon', expectedQty: 1, expectedUnit: 'gal' },
    { name: 'Salsa Roja', packSize: 'Bag of 1 Gallon', expectedQty: 1, expectedUnit: 'gal' },
    { name: 'Salsa Verde', packSize: 'Bag of 1 Gallon', expectedQty: 1, expectedUnit: 'gal' },
    { name: '1.5 oz Salsa Roja Pack', packSize: 'Crate of 400 ct', expectedQty: 400, expectedUnit: 'pza' },
    { name: '1.5 oz Salsa Verde Pack', packSize: 'Crate of 400 ct', expectedQty: 400, expectedUnit: 'pza' },
    { name: '1.5 oz Salsa Roja Taquera', packSize: 'Crate of 400 ct', expectedQty: 400, expectedUnit: 'pza' },
    
    // PAGE 1 - Carnes
    { name: 'Carne Asada', packSize: 'Bag of 10 lbs', expectedQty: 10, expectedUnit: 'lb' },
    { name: 'Pastor', packSize: 'Bag of 10 lbs', expectedQty: 10, expectedUnit: 'lb' },
    { name: 'Cabeza', packSize: 'Bag of 5 lbs', expectedQty: 5, expectedUnit: 'lb' },
    { name: 'Lengua', packSize: 'Bag of 5 lbs', expectedQty: 5, expectedUnit: 'lb' },
    { name: 'Buche 6 oz', packSize: 'Bag of 6 oz', expectedQty: 6, expectedUnit: 'oz' },
    { name: 'Carnitas 6 oz', packSize: 'Bag of 6 oz', expectedQty: 6, expectedUnit: 'oz' },
    { name: 'Pollo', packSize: 'Bag of 10 lbs', expectedQty: 10, expectedUnit: 'lb' },
    { name: 'Chorizo 8 oz', packSize: 'Bag of 8 oz', expectedQty: 8, expectedUnit: 'oz' },
    { name: 'Salchicha Bag', packSize: 'Bag of 1 lb', expectedQty: 1, expectedUnit: 'lb' },
    { name: 'Milaneza', packSize: 'Bag of 2.6 lbs', expectedQty: 2.6, expectedUnit: 'lb' },
    { name: 'Jamon Pack', packSize: 'Pack of 2 lbs', expectedQty: 2, expectedUnit: 'lb' },
    
    // PAGE 1 - Granos/Frijoles
    { name: 'Arroz', packSize: 'Bag of 5 lbs', expectedQty: 5, expectedUnit: 'lb' },
    { name: 'Frijol Entero', packSize: 'Bag of 10 lbs', expectedQty: 10, expectedUnit: 'lb' },
    { name: 'Frijol Molido', packSize: 'Bag of 10 lbs', expectedQty: 10, expectedUnit: 'lb' },
    
    // PAGE 1 - Otros
    { name: 'Papelito Para Torta', packSize: 'I Pack of 3.90 oz', expectedQty: 60, expectedUnit: 'pza' }, // Special: 60 piezas per case
    { name: '1 oz Bolsa de Mixta', packSize: 'Case of 190 ct', expectedQty: 190, expectedUnit: 'pza' },
    { name: 'Onion/ Cil. Mix', packSize: 'Bag of 5 Lbs', expectedQty: 5, expectedUnit: 'lb' },
    { name: 'Bolsa Aguacate', packSize: 'Bag of 2 lbs', expectedQty: 2, expectedUnit: 'lb' },
    { name: 'Mulitas Con Queso', packSize: 'Bag of 3.06 lbs or 12 mulitas', expectedQty: 12, expectedUnit: 'pza' },
    { name: 'Bolsa Crema', packSize: 'Bag of 1.5 Lbs', expectedQty: 1.5, expectedUnit: 'lb' },
    
    // PAGE 2
    { name: 'Bolsa Mayonesa', packSize: 'Bag of 1.5 lb', expectedQty: 1.5, expectedUnit: 'lb' },
    { name: 'Queso Rayado', packSize: 'Bag of 2 lbs', expectedQty: 2, expectedUnit: 'lb' },
    { name: 'Queso Cotija 021', packSize: 'Bag of 12 oz', expectedQty: 12, expectedUnit: 'oz' },
    { name: 'Queso Tortas/platos/Desayuno', packSize: 'Pack of 1 lb', expectedQty: 1, expectedUnit: 'lb' },
    { name: 'Quesadilla Bodega', packSize: 'Pack of 12', expectedQty: 12, expectedUnit: 'pza' },
    { name: 'Huevo', packSize: 'Case of 15 dz', expectedQty: 180, expectedUnit: 'pza' }, // 15 dozen = 180
    { name: 'Salsa Huevos Rancheros', packSize: 'Bag of 2.30 lb', expectedQty: 2.30, expectedUnit: 'lb' },
    { name: 'Rajas y Zanahorias', packSize: 'Bag of 6 lbs 9 oz', expectedQty: 6.5625, expectedUnit: 'lb' },
    { name: '2 oz Bolsas de Rajas', packSize: 'Case of 165 ct', expectedQty: 165, expectedUnit: 'pza' },
    { name: 'Onion Pepper Mix', packSize: 'Bag of 5 lb', expectedQty: 5, expectedUnit: 'lb' },
    { name: 'Lima Bolsita', packSize: 'Case of 210 ct', expectedQty: 210, expectedUnit: 'pza' },
    { name: 'Bolsa Lima 5 LB', packSize: 'Bag Of 5 Lb', expectedQty: 5, expectedUnit: 'lb' },
    { name: 'Champurrado Mix', packSize: 'Bag of 1 Gallon', expectedQty: 1, expectedUnit: 'gal' },
    { name: 'Amarillo Cheese', packSize: 'Case of 560 oz', expectedQty: 560, expectedUnit: 'oz' },
    { name: 'Tortilla Nachos', packSize: 'Bag of 4.5 oz', expectedQty: 4.5, expectedUnit: 'oz' },
    { name: '1100 Tortilla,White Corn', packSize: 'bag of 5 dz (60CT)', expectedQty: 60, expectedUnit: 'pza' },
    { name: '358-9673BT', packSize: 'Bag of 1 dz', expectedQty: 12, expectedUnit: 'pza' },
    { name: '358_9604BT', packSize: 'Bag of 1 dz', expectedQty: 12, expectedUnit: 'pza' },
    { name: 'Teleras', packSize: 'Pack of 6', expectedQty: 6, expectedUnit: 'pza' },
    { name: 'Sopes', packSize: 'Bag of 1 dz', expectedQty: 12, expectedUnit: 'pza' },
    { name: 'Agua Gavilan', packSize: 'Case of 24 unis', expectedQty: 24, expectedUnit: 'pza' },
];

async function compareSpecs() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: items } = await supabase
        .from('inventory_items')
        .select('id, name, purchase_unit_cost, quantity_per_unit, unit_measure, unit_type');

    if (!items) { console.log('No items found'); return; }

    console.log('═══════════════════════════════════════════════════════════════════════════════════════');
    console.log('  COMPARACIÓN: BODEGA (documento) vs BASE DE DATOS');
    console.log('═══════════════════════════════════════════════════════════════════════════════════════');
    console.log(`${'Item'.padEnd(40)} | ${'Bodega'.padEnd(22)} | ${'DB qty'.padStart(8)} | ${'DB unit'.padStart(6)} | ${'Expected'.padStart(8)} | Status`);
    console.log('─'.repeat(110));

    let mismatches = 0;
    const fixes: { id: string; name: string; field: string; oldVal: any; newVal: any }[] = [];

    for (const spec of BODEGA_SPECS) {
        // Find item in DB by name (fuzzy match)
        const item = items.find(i => 
            i.name.toLowerCase().includes(spec.name.toLowerCase()) ||
            spec.name.toLowerCase().includes(i.name.toLowerCase().substring(0, 10))
        );

        if (!item) {
            console.log(`  ❓ ${spec.name.padEnd(38)} | ${spec.packSize.padEnd(22)} | ${'N/A'.padStart(8)} | ${'N/A'.padStart(6)} | ${spec.expectedQty.toString().padStart(8)} | NOT FOUND`);
            continue;
        }

        const dbQty = Number(item.quantity_per_unit || 1);
        const dbUnit = item.unit_measure || '?';
        const qtyMatch = Math.abs(dbQty - spec.expectedQty) < 0.1;
        
        const status = qtyMatch ? '✅' : '❌ MISMATCH';
        
        if (!qtyMatch) {
            mismatches++;
            fixes.push({ 
                id: item.id, 
                name: item.name, 
                field: 'quantity_per_unit', 
                oldVal: dbQty, 
                newVal: spec.expectedQty 
            });
        }

        const costPerUnit = (item.purchase_unit_cost || 0) / spec.expectedQty;
        console.log(`  ${status} ${item.name.substring(0, 36).padEnd(36)} | ${spec.packSize.substring(0, 22).padEnd(22)} | ${dbQty.toString().padStart(8)} | ${dbUnit.padStart(6)} | ${spec.expectedQty.toString().padStart(8)} | $${item.purchase_unit_cost}→$${costPerUnit.toFixed(4)}/u`);
    }

    console.log('─'.repeat(110));
    console.log(`\n  📊 TOTAL: ${BODEGA_SPECS.length} items comparados, ${mismatches} DISCREPANCIAS encontradas`);
    
    if (fixes.length > 0) {
        console.log(`\n  🔧 FIXES NECESARIOS:`);
        fixes.forEach(f => {
            console.log(`    "${f.name}": quantity_per_unit ${f.oldVal} → ${f.newVal}`);
        });
    }
}

compareSpecs();
