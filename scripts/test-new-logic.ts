
import { calculateInventoryUsage } from './lib/inventory/conversions';

console.log('--- TESTING NEW COST LOGIC ---');

// 1. FOIL CASE (The one that was $83)
const foilUsage = calculateInventoryUsage(
    1,       // recipe qty
    'pza',   // recipe unit
    'Case',  // item unit_type
    3000     // manual factor (qty_per_unit)
);
console.log(`Foil Usage (1 pza from 3000 ct Case): ${foilUsage}`);
console.log(`Foil Cost (Case is $83.84): $${(foilUsage * 83.84).toFixed(4)}`);

// 2. LIMA CASE (Correct Unit)
const limaUsageOk = calculateInventoryUsage(
    1,       // 1 piece
    'pza',
    '210 ct',
    210
);
console.log(`Lima Usage (1 pza from 210 ct): ${limaUsageOk}`);
console.log(`Lima Cost ($19.20 box): $${(limaUsageOk * 19.2).toFixed(4)}`);

// 3. LIMA CASE (Wrong Recipe Unit)
const limaUsageWrong = calculateInventoryUsage(
    1,
    '210 ct', // recipe says "one box"
    '210 ct',
    210
);
console.log(`Lima Usage (1 box from 210 ct box): ${limaUsageWrong}`);
console.log(`Lima Cost ($19.20 box): $${(limaUsageWrong * 19.2).toFixed(4)}`);
