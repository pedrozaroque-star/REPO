import dotenv from 'dotenv';
import path from 'path';

// Force load environmental variables
const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

import { NextRequest } from 'next/server';

// Import all cron handlers
import { GET as syncSales } from '../app/api/cron/sync-sales/route';
import { GET as syncLabor } from '../app/api/cron/sync-labor/route';
import { GET as syncReviews } from '../app/api/cron/sync-reviews/route';
import { GET as checkIntegrity } from '../app/api/cron/integrity-check/route';
import { GET as syncPmix } from '../app/api/cron/sync-pmix/route';
import { GET as reportBreaks } from '../app/api/cron/report-breaks/route';

// Quickbooks router might not exist physically if it was removed, but it's in vercel.json.
// Let's use a dynamic import to fail gracefully if it doesn't exist.

async function runCron(name: string, handler: any) {
    try {
        console.log(`\n========================================`);
        console.log(`🚀 RUNNING CRONJOB: ${name}`);
        console.log(`========================================`);
        
        // Mock authorization headers to pass Vercel Cron Secret check
        const secret = process.env.CRON_SECRET || '';
        const req = new NextRequest(new URL("http://localhost"), {
            headers: {
                authorization: `Bearer ${secret}`
            }
        });
        
        const res = await handler(req);
        let data;
        try {
            data = await res.json();
        } catch {
            data = await res.text();
        }
        
        console.log(`✅ ${name} COMPLETED. Response:`);
        console.dir(data, { depth: null, colors: true });
    } catch (err: any) {
        console.error(`❌ ERROR IN ${name}:`, err.message || err);
    }
}

async function main() {
    console.log(`🛠️ INICIANDO EJECUCIÓN MANUAL DE TODOS LOS CRONJOBS DEL LUNES 03/16/2026\n`);
    
    // 1. Sync Sales (Core)
    await runCron('sync-sales', syncSales);
    
    // 2. Sync Labor (Core)
    await runCron('sync-labor', syncLabor);
    
    // 3. Sync PMix
    await runCron('sync-pmix', syncPmix);

    // 4. Sync Reviews
    if (syncReviews) {
        await runCron('sync-reviews', syncReviews);
    }

    // 5. Monday Specific: Report Breaks 
    if (reportBreaks) {
        await runCron('report-breaks', reportBreaks);
    }

    // 6. Monday Specific: Sync Quickbooks (if exists)
    try {
        const qbModule = await import('../app/api/inventory/sync-quickbooks/route');
        if (qbModule && qbModule.GET) {
            await runCron('sync-quickbooks', qbModule.GET);
        }
    } catch(e) {
        console.log(`⚠️ Quickbooks sync not found or disabled, skipping...`);
    }
    
    // 7. Integrity Check (Heals issues found in recent days)
    await runCron('integrity-check', checkIntegrity);
    
    console.log(`\n🎉 TODOS LOS CRONJOBS FINALIZADOS EXITOSAMENTE.`);
    process.exit(0);
}

main();
