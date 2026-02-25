fetch('http://localhost:3000/api/inventory/food-cost?storeId=all&period=last_week&startDate=2026-02-16T06:00:00.000Z&endDate=2026-02-23T05:59:59.000Z')
    .then(res => res.json())
    .then(json => {
        if (!json.data) {
            console.log('No data', json);
            return;
        }
        let totalMeat = 0;
        json.data.forEach((d: any) => { totalMeat += d.total_meat_lbs || 0; });
        console.log('TOTAL MEAT (LAST WEEK):', totalMeat.toFixed(2), 'lbs');

        // Group by category/meat or whatever
        let meats: any = { asada: 0, pollo: 0, pastor: 0, carnitas: 0, cabeza: 0, lengua: 0, buche: 0, chorizo: 0 }
        json.data.forEach((d: any) => {
            const name = d.name.toLowerCase();
            let matched = false;
            for (const k in meats) {
                if (name.includes(k)) {
                    meats[k] += d.total_meat_lbs || 0;
                    matched = true;
                    break;
                }
            }
            if (!matched && d.total_meat_lbs > 0) {
                console.log('UNMATCHED MEAT ITEM:', d.name, d.total_meat_lbs);
            }
        })
        console.log(meats)
    });
