const xlsx = require('xlsx');
const fs = require('fs');
const wb = xlsx.readFile('docs/Precios/Food Price Changes 2026.xlsx');
const ws = wb.Sheets['3rd Party - Food Item Prices an'];
const jd = xlsx.utils.sheet_to_json(ws);
const html = fs.readFileSync('docs/Precios/price_strategy_report_v3.html', 'utf8');
let fails = [];
jd.forEach(r => {
    let name = r['3rd Party - Food Item Prices'];
    let price = r['__EMPTY_3'];
    if (name && price && typeof price === 'number') {
        let escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(' ').join('\\s+');
        let regex = new RegExp('<td>(?:⭐ )?' + escaped + '</td>\\s*<td>\\$' + price.toFixed(2) + '</td>', 'i');
        if (!regex.test(html)) {
            fails.push(name + ' -> Expected $' + price.toFixed(2));
        }
    }
});
console.log('Fails 3rd Party:', fails.length ? fails : 'None!');
