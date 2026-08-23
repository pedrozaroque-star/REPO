const http = require('http');

// Test file existence directly
const fs = require('fs');
const path = require('path');

const months = ['agosto', 'julio', 'junio'];
months.forEach(m => {
    let fn = 'pendientes_agosto.html';
    if (m === 'julio') fn = 'pendientes_julio.html';
    if (m === 'junio') fn = 'pendientes.html';
    
    const p = path.join(process.cwd(), fn);
    const exists = fs.existsSync(p);
    const size = exists ? fs.statSync(p).size : 0;
    console.log(`✅ [Report API Check] Month: ${m.padEnd(8)} -> File: ${fn.padEnd(24)} -> Exists: ${exists} (${(size/1024).toFixed(1)} KB)`);
});
