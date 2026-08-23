const fs = require('fs');

// Let's audit and update the rows for August 20 in pendientes_agosto.html
let reportHtml = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html', 'utf-8');

// Let's check how August 20 is represented in the table
const aug20RowOld = `<!-- ROW 36: 20-Aug-2026 Session 1 -->`;

// Let's see the entire table section in pendientes_agosto.html
console.log('Searching for Aug 20 rows in pendientes_agosto.html...');
const aug20Idx = reportHtml.indexOf('20-Ago-2026');
console.log('Found 20-Ago-2026 at index:', aug20Idx);
