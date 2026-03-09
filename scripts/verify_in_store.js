const fs = require('fs');
const xlsx = require('xlsx');

const html = fs.readFileSync('docs/Precios/price_strategy_report_v3.html', 'utf8');
const wb = xlsx.readFile('docs/Precios/Food Price Changes 2026.xlsx');

const jd = xlsx.utils.sheet_to_json(wb.Sheets['In Store - Food Item Prices and']);
let fails = [];
for (let i = 1; i < jd.length; i++) {
    let r = jd[i];
    let name = r['In Store - Food Item Prices'];
    let price = r['__EMPTY_4'];

    if (name && price !== undefined && price !== '' && price !== 'N/A' && typeof price === 'number') {
        let escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(' ').join('\\s+');
        let regex = new RegExp('<td>(?:⭐ )?' + escaped + '</td>\\s*<td>\\$' + price.toFixed(2) + '</td>', 'i');

        if (!regex.test(html)) {
            // Check if name is found
            let nameRegex = new RegExp('<td>(?:⭐ )?' + escaped + '</td>', 'i');
            if (nameRegex.test(html)) {
                fails.push(name + ' -> Expected $' + price.toFixed(2) + ' (Found name, but price mismatched)');
            } else {
                fails.push(name + ' -> Expected $' + price.toFixed(2) + ' (Name not found in HTML table)');
            }
        }
    }
}
console.log('Fails In-Store:', fails.length ? fails : 'None!');
