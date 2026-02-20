
import { getProductMix } from './lib/toast-pmix';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function debugPmixMods() {
    const storeId = 'e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8'; // Azusa
    const startDate = '2026-02-12';
    const endDate = '2026-02-15';

    console.log(`--- FETCHING PMIX FOR MODS DEBUG ---`);
    const items = await getProductMix({ storeId, startDate, endDate, bundleModifiers: true });

    const taco = items.find(i => i.guid.startsWith('6141b8b8'));
    if (taco) {
        console.log(`Product: ${taco.name}`);
        console.log(`Qty: ${taco.quantity}`);
        console.log(`Meta Modifiers Array Length: ${taco.modifier_guids?.length}`);
        console.log(`Modifiers:`, taco.modifier_guids);
    } else {
        console.log('Taco not found in this store range');
    }
}

debugPmixMods();
