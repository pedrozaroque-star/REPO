import { getAuthToken, getToastRestaurants } from '../lib/toast-api';

const TOAST_API_HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com'

async function run() {
    const token = await getAuthToken();
    const stores = await getToastRestaurants(token);

    // Find Broadway
    const broadways = stores.filter((s: any) => s.name.toLowerCase().includes('broadway'));

    if (broadways.length > 0) {
        const storeId = broadways[0].id;
        console.log(`\nFetching ALL ordersBulk for ${storeId} on 2026-01-10...`);
        let page = 1;
        let hasMore = true;
        let totalNet = 0;
        let totalOrders = 0;

        while (hasMore) {
            const url = new URL(`${TOAST_API_HOST}/orders/v2/ordersBulk`);
            url.searchParams.append('businessDate', '20260110');
            url.searchParams.append('pageSize', '100');
            url.searchParams.append('page', String(page));

            const res = await fetch(url.toString(), {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Toast-Restaurant-External-ID': storeId
                }
            });

            if (!res.ok) {
                console.log(`Failed page ${page}: Status ${res.status}`);
                break;
            }

            const data = await res.json();
            console.log(`Page ${page}: ${data.length} orders`);

            if (data.length === 0) {
                hasMore = false;
                break;
            }

            totalOrders += data.length;

            let net = 0;
            data.forEach((o: any) => {
                if (o.voided) return;
                o.checks?.forEach((c: any) => {
                    if (c.voided) return;
                    const amt = Number(c.amount || 0);
                    const tax = Number(c.taxAmount || 0);
                    let tip = 0;
                    c.payments?.forEach((p: any) => tip += Number(p.tipAmount || 0));
                    net += (amt - tax - tip);
                });
            });
            totalNet += net;

            if (data.length < 100) hasMore = false;
            else page++;
        }

        console.log(`\nTotal Orders: ${totalOrders}`);
        console.log(`Total Net: $${totalNet}`);
    }
}
run();
