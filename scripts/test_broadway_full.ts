import { getAuthToken, getToastRestaurants } from '../lib/toast-api';

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function run() {
    const token = await getAuthToken();
    const storeId = '475bc112-187d-4b9c-884d-1f6a041698ce'; // Broadway

    console.log(`\nFetching ordersBulk for ${storeId} on 2026-01-10 with FULL FIELDS...`);
    const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`);
    url.searchParams.append('businessDate', '20260110');
    url.searchParams.append('pageSize', '2');
    url.searchParams.append('page', '1');
    url.searchParams.append('fields', [
        'diningOption', 'voided', 'openedDate', 'numberOfGuests',
        'checks.voided', 'checks.amount', 'checks.taxAmount', 'checks.appliedDiscounts',
        'checks.appliedServiceCharges', 'checks.payments.tipAmount', 'checks.payments.amount',
        'checks.payments.displayName', 'checks.payments.paymentInstrument', 'checks.payments.type',
        'checks.payments.otherPayment', 'checks.payments.refundStatus', 'checks.payments.refundAmount',
        'checks.selections.price', 'checks.selections.preDiscountPrice', 'checks.selections.quantity',
        'checks.selections.tax', 'checks.selections.taxInclusion', 'checks.selections.displayName',
        'checks.selections.voided', 'checks.selections.deferred', 'checks.selections.refundDetails',
        'checks.selections.toastGiftCard', 'checks.serviceCharges', 'serviceCharges', 'source', 'deliveryService'
    ].join(','));

    const res = await fetch(url.toString(), {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Toast-Restaurant-External-ID': storeId
        }
    });

    if (res.ok) {
        const data = await res.json();
        console.log(`Orders found: ${data.length}`);
        let fullNet = 0;
        let basicNet = 0;

        data.forEach((o: any) => {
            if (o.voided) return;
            o.checks?.forEach((c: any) => {
                if (c.voided) return;

                // Fast Mode Logic
                const amt = Number(c.amount || 0);
                const tax = Number(c.taxAmount || 0);
                let tip = 0;
                c.payments?.forEach((p: any) => tip += Number(p.tipAmount || 0));
                const bNet = (amt - tax - tip);
                basicNet += bNet;

                // Full Mode Logic
                let checkItemNetSum = 0;
                c.selections?.forEach((sel: any) => {
                    if (sel.voided) return;
                    if (sel.deferred) return;
                    let itemPrice = Number(sel.price || 0);
                    if (sel.taxInclusion === 'INCLUDED') {
                        itemPrice -= Number(sel.tax || 0);
                    }
                    checkItemNetSum += itemPrice;
                });

                let checkNet = checkItemNetSum;
                if (c.appliedDiscounts) {
                    checkNet -= c.appliedDiscounts.reduce((s: number, d: any) => s + (d.amount || 0), 0);
                }

                console.log(`Check - Basic Net: $${bNet.toFixed(2)} | Full Net (Items): $${checkNet.toFixed(2)} | Selections length: ${c.selections?.length || 0}`);
                if (c.selections) {
                    c.selections.forEach((sel: any) => {
                        console.log(`  -> Item: ${sel.displayName} | Price: ${sel.price} | Voided: ${sel.voided} | Deferred: ${sel.deferred}`);
                    });
                } else {
                    console.log('  -> No items found in selections array!');
                }

                fullNet += checkNet;
            });
        });

        console.log(`\nTotals -> Basic: $${basicNet.toFixed(2)} | Full: $${fullNet.toFixed(2)}`);
    } else {
        console.log(`Error: ${await res.text()}`);
    }
}
run();
