const fs = require('fs');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🛡️ VERIFICACIÓN DE INTEGRIDAD DE TODOS LOS REPORTES HISTÓRICOS');
console.log('═══════════════════════════════════════════════════════════════════════');

const files = [
    { name: 'pendientes.html (Junio 2026)', path: 'c:/Users/pedro/Desktop/teg-modernizado/pendientes.html' },
    { name: 'pendientes_julio.html (Julio 2026)', path: 'c:/Users/pedro/Desktop/teg-modernizado/pendientes_julio.html' },
    { name: 'pendientes_agosto.html (Agosto 2026)', path: 'c:/Users/pedro/Desktop/teg-modernizado/pendientes_agosto.html' }
];

files.forEach(f => {
    if (fs.existsSync(f.path)) {
        const stats = fs.statSync(f.path);
        const content = fs.readFileSync(f.path, 'utf-8');
        const lines = content.split('\n').length;
        console.log(`✅ ${f.name}:`);
        console.log(`   - Tamaño: ${(stats.size / 1024).toFixed(1)} KB`);
        console.log(`   - Líneas: ${lines}`);
        console.log(`   - Última modificación: ${stats.mtime.toLocaleString()}`);
    } else {
        console.log(`❌ ${f.name}: NO ENCONTRADO`);
    }
});
