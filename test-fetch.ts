fetch("http://localhost:3000/api/inventory/food-cost?storeId=all&period=today&startDate=2026-02-24T06:00:00.000Z&endDate=2026-02-25T05:59:59.000Z")
    .then(async res => {
        const text = await res.text();
        try {
            const json = JSON.parse(text);
            if (!json.data) { console.log('No data', json); return; }

            let totalMeat = 0;
            json.data.forEach((d: any) => totalMeat += d.total_meat_lbs || 0);
            console.log('--- NEW TOTAL MEAT LBS:', totalMeat.toFixed(2), '---');

            json.data
                .filter((d: any) => d.total_meat_lbs > 0)
                .sort((a: any, b: any) => b.total_meat_lbs - a.total_meat_lbs)
                .slice(0, 15)
                .forEach((d: any) => {
                    console.log(d.name.padEnd(40), d.total_meat_lbs.toFixed(2).padStart(8), 'lbs (Qty: ' + d.quantity + ')');
                });

        } catch (e) {
            console.log('Status', res.status);
            console.log('Text:', text.substring(0, 500));
        }
    })
