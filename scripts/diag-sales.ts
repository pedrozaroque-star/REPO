import { getAuthToken } from '../lib/toast-api'

async function diag() {
    console.log('Fetching raw logic test...');
    const token = await getAuthToken();
    const headers = {
        Authorization: 'Bearer ' + token,
        'Toast-Restaurant-External-ID': '80a1ec95-bc73-402e-8884-e5abbe9343e6'
    };

    let sumFast = 0;
    let sumPrecision = 0;
    let sumToastNative = 0; // Check amount native net minus tips? Toast also gives us `netAmount` or something? Actually `amount - taxAmount - tipAmount` is what fast uses.

    for (let i = 1; i <= 28; i++) {
        let page = 1;
        let hasMore = true;
        let dayStart = `202602${String(i).padStart(2, '0')}`;
        console.log(`Fetching day ${dayStart}...`);

        while (hasMore) {
            const url = `https://ws-api.toasttab.com/orders/v2/ordersBulk?businessDate=${dayStart}&page=${page}&pageSize=100`;
            const res = await fetch(url, { headers });

            if (res.status === 429) {
                console.log('Rate limited! Waiting 5s...');
                await new Promise(r => setTimeout(r, 5000));
                continue;
            }

            const data = await res.json();

            if (!Array.isArray(data) || data.length === 0) {
                hasMore = false;
                break;
            }

            data.forEach(o => {
                if (o.voided) return;
                o.checks?.forEach(c => {
                    if (c.voided) return;

                    // Fast Mode Logic
                    let checkAmt = Number(c.amount || 0);
                    let checkTax = Number(c.taxAmount || 0);
                    let checkTip = 0;
                    c.payments?.forEach(p => checkTip += Number(p.tipAmount || 0));
                    sumFast += (checkAmt - checkTax - checkTip); // Includes Service Charges

                    // Precision Mode Logic
                    let itemNet = 0;
                    let itemRefund = 0;
                    c.selections?.forEach(s => {
                        let isGiftCard = s.toastGiftCard || s.displayName?.toLowerCase().includes('gift card');
                        if (s.voided || (s.deferred && !isGiftCard)) return;
                        let price = Number(s.price || 0);
                        if (s.taxInclusion === 'INCLUDED') price -= Number(s.tax || 0);
                        itemNet += price;
                        if (s.refundDetails) itemRefund += Number(s.refundDetails.refundAmount || 0);
                    });
                    let cNet = itemNet;
                    if (c.appliedDiscounts) {
                        cNet -= c.appliedDiscounts.reduce((a, b) => a + (b.amount || 0), 0);
                    }
                    cNet -= itemRefund;
                    let pRef = 0;
                    c.payments?.forEach(p => pRef += Number(p.refundAmount || 0));
                    if (pRef > itemRefund + 0.01) cNet -= (pRef - itemRefund);

                    sumPrecision += cNet;
                });
            });
            if (data.length < 100) hasMore = false;
            else page++;
        }
    }

    console.log('Fast:', sumFast.toFixed(2));
    console.log('Precision:', sumPrecision.toFixed(2));
}

diag().catch(console.error);
