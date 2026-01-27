
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

// LYNWOOD ID
const STORE_ID = 'b7f63b01-f089-4ad7-a346-afdb1803dc1a';
const API_HOST = 'https://ws-api.toasttab.com';

async function diagnoseDeep() {
    console.log('--- DEEP FINANCIAL FORENSICS (Lynwood Jan 26) ---');

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error('MISSING SUPABASE_SERVICE_ROLE_KEY in env');
        return;
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: config, error } = await supabase.from('toast_api_credentials').select('*').single();
    if (error || !config) {
        console.error('DB Error:', error);
        throw new Error('No creds in DB');
    }

    console.log('Authenticating with Toast...');
    const authRes = await fetch(`${API_HOST}/authentication/v1/authentication/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clientId: config.client_id,
            client_secret: config.client_secret,
            userAccessType: 'TOAST_MACHINE_CLIENT'
        })
    });

    if (!authRes.ok) throw new Error(`Auth Failed: ${authRes.status}`);
    const authData = await authRes.json();
    const token = authData.token.accessToken;

    // TARGET DATE: JAN 26 2026
    const TARGET_DATE = '20260126';
    console.log(`Fetching Orders for: ${TARGET_DATE}`);

    let page = 1;
    let url = new URL(`${API_HOST}/orders/v2/ordersBulk`);
    url.searchParams.append('businessDate', TARGET_DATE);
    url.searchParams.append('pageSize', '100');

    // Request FULL fields
    url.searchParams.append('fields', [
        'openedDate', 'voided',
        'checks.voided', 'checks.amount', 'checks.taxAmount', 'checks.totalAmount',
        'checks.payments.tipAmount', 'checks.payments.amount', 'checks.payments.refundStatus',
        'checks.selections.price', 'checks.selections.tax', 'checks.selections.voided',
        'checks.appliedDiscounts'
    ].join(','));

    // ACCUMULATORS
    let totalCheckAmount = 0;
    let totalTax = 0;
    let totalTip = 0;
    let computedNetFast = 0; // Check Amount - Tax - Tip
    let computedNetItem = 0; // Selection Price - Discount (Rough)

    let countOrders = 0;

    while (true) {
        url.searchParams.set('page', String(page));
        // console.log(`Page ${page}...`);
        const res = await fetch(url.toString(), {
            headers: { 'Authorization': `Bearer ${token}`, 'Toast-Restaurant-External-ID': STORE_ID }
        });
        if (!res.ok) break;

        const orders = await res.json();
        if (!Array.isArray(orders) || orders.length === 0) break;

        orders.forEach((order: any) => {
            if (order.voided) return;
            countOrders++;

            if (order.checks) {
                order.checks.forEach((check: any) => {
                    if (check.voided) return;

                    const amt = check.amount || 0;
                    const tax = check.taxAmount || 0;
                    let tip = 0;
                    check.payments?.forEach((p: any) => tip += (p.tipAmount || 0));

                    totalCheckAmount += amt;
                    totalTax += tax;
                    totalTip += tip;

                    // FORMULA A: Fast Mode (Amt - Tax - Tip)
                    computedNetFast += (amt - tax - tip);


                    // ITEM CALC (Rough)
                    let checkItemTotal = 0;
                    check.selections?.forEach((sel: any) => {
                        if (sel.voided) return;
                        checkItemTotal += (sel.price || 0);
                    });
                    let checkDisc = 0;
                    check.appliedDiscounts?.forEach((d: any) => checkDisc += (d.discountAmount || 0));

                    computedNetItem += (checkItemTotal - checkDisc);
                });
            }
        });
        page++;
    }

    console.log('\n--- RESULTS ---');
    console.log(`Orders: ${countOrders}`);
    console.log(`Checks Total: $${totalCheckAmount.toFixed(2)}`);
    console.log(`Tax: $${totalTax.toFixed(2)}`);
    console.log(`Tip: $${totalTip.toFixed(2)}`);
    console.log(`--------------------------------`);
    console.log(`COMPUTED NET (Fast Mode):   $${computedNetFast.toFixed(2)}`);
    console.log(`COMPUTED NET (Item Mode):   $${computedNetItem.toFixed(2)}`);
    console.log(`--------------------------------`);

    const TARGET_REAL = 11144;
    console.log(`Gap to ${TARGET_REAL}: $${(TARGET_REAL - computedNetFast).toFixed(2)}`);

}

diagnoseDeep();
