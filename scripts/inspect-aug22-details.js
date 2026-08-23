const fs = require('fs');

const html = fs.readFileSync('pendientes_agosto.html', 'utf-8');

// Check August 22 in Gantt
const aug22Gantt = html.match(/22 Ago[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
if (aug22Gantt) {
    console.log('Aug 22 in Gantt:', aug22Gantt[0].substring(0, 400));
}

// Check August 22 in Table
const aug22Table = html.match(/22-Ago-2026[\s\S]*?<\/tr>/);
if (aug22Table) {
    console.log('Aug 22 in Table:', aug22Table[0].substring(0, 400));
}

// Check total in table summary
const tableFooter = html.match(/<tfoot[\s\S]*?<\/tfoot>/i) || html.match(/TOTAL[\s\S]*?<\/tr>/i);
if (tableFooter) {
    console.log('Table footer:', tableFooter[0]);
}
