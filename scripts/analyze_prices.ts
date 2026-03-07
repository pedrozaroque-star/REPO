import { createClient } from '@supabase/supabase-js'
import * as xlsx from 'xlsx'
import fs from 'fs'
import path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function run() {
    console.log("Reading Excel file...");
    const excelPath = path.join(process.cwd(), 'docs/Precios/Food Price Changes 2026.xlsx');
    const workbook = xlsx.readFile(excelPath);
    const excelData: Record<string, any[]> = {};
    for (const sheetName of workbook.SheetNames) {
        excelData[sheetName] = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }

    console.log("Fetching PMIX Data from Supabase (Febrero 2026)...");
    const pmixData: any[] = [];

    // Fetch day by day to avoid statement timeout on Supabase
    for (let i = 1; i <= 28; i++) {
        const dateStr = `2026-02-${i.toString().padStart(2, '0')}`;

        const { data, error } = await supabase
            .from('pmix_daily_cache')
            .select('business_date, store_id, items')
            .eq('business_date', dateStr);

        if (error) {
            console.error(`Error fetching PMIX for ${dateStr}:`, error.message);
        } else if (data) {
            pmixData.push(...data);
        }
    }

    console.log(`Fetched ${pmixData.length} PMIX cache daily records.`);

    // Aggregate PMIX
    const aggregatedPmixInStore: Record<string, { quantity: number, gross_sales: number, unit_price: number }> = {};
    const aggregatedPmix3rdParty: Record<string, { quantity: number, gross_sales: number, unit_price: number }> = {};
    if (pmixData) {
        for (const record of pmixData) {
            if (record.items && Array.isArray(record.items)) {
                for (const item of record.items) {
                    const is3rdParty = item.group_name && (item.group_name.toLowerCase().includes('doordash') || item.group_name.toLowerCase().includes('uber') || item.group_name.toLowerCase().includes('grubhub'));
                    const targetDict = is3rdParty ? aggregatedPmix3rdParty : aggregatedPmixInStore;

                    if (!targetDict[item.name]) {
                        targetDict[item.name] = { quantity: 0, gross_sales: 0, unit_price: item.unit_price };
                    }
                    targetDict[item.name].quantity += Number(item.quantity || 0);
                    targetDict[item.name].gross_sales += Number(item.gross_sales || 0);
                    // Update to the maximum unit price to get the most recent regular price
                    if (Number(item.unit_price || 0) > targetDict[item.name].unit_price) {
                        targetDict[item.name].unit_price = Number(item.unit_price || 0);
                    }
                }
            }
        }
    }

    const output = {
        excelData,
        aggregatedPmixInStore,
        aggregatedPmix3rdParty
    };

    const outPath = path.join(process.cwd(), 'docs/Precios/analysis_results.json');
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`Successfully wrote analysis data to ${outPath}`);
}

run().catch(console.error);
