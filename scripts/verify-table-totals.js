const fs = require('fs');

const html = fs.readFileSync('pendientes_agosto.html', 'utf-8');

// Check rows in table
const rowMatches = [...html.matchAll(/<tr>\s*<td class="date-cell">([^<]+)<\/td>\s*<td class="time-cell">([^<]+)<\/td>\s*<td class="hours-cell">([^<]+)<\/td>/g)];

console.log(`Total rows in table: ${rowMatches.length}`);
let sumHours = 0;
rowMatches.forEach(r => {
    const h = parseFloat(r[3]);
    sumHours += h;
    console.log(`- ${r[1].trim()}: ${r[2].trim()} -> ${h} hrs`);
});

console.log(`\nSum of table hours: ${sumHours.toFixed(2)} hrs`);

// Check table footer
const tfootMatch = html.match(/<tr class="total-row">[\s\S]*?<\/tr>/i) || html.match(/TOTAL[\s\S]*?<\/tr>/i);
if (tfootMatch) console.log('\nFooter row:', tfootMatch[0]);
