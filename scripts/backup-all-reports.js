const fs = require('fs');
const path = require('path');

const backupDir = path.join(process.cwd(), 'backups');
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

const files = [
    { src: 'pendientes.html', dst: 'backups/pendientes_junio_backup_' + Date.now() + '.html' },
    { src: 'pendientes_julio.html', dst: 'backups/pendientes_julio_backup_' + Date.now() + '.html' },
    { src: 'pendientes_agosto.html', dst: 'backups/pendientes_agosto_backup_' + Date.now() + '.html' },
    { src: 'pendientes.html', dst: 'backups/pendientes_junio_canonical_backup.html' },
    { src: 'pendientes_julio.html', dst: 'backups/pendientes_julio_canonical_backup.html' },
    { src: 'pendientes_agosto.html', dst: 'backups/pendientes_agosto_canonical_backup.html' }
];

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🛡️ CREANDO RESPALDO DE SEGURIDAD DE LOS REPORTES');
console.log('═══════════════════════════════════════════════════════════════════════');

files.forEach(f => {
    if (fs.existsSync(f.src)) {
        fs.copyFileSync(f.src, f.dst);
        const stats = fs.statSync(f.dst);
        console.log(`✅ Respaldado: ${f.src.padEnd(22)} ➔ ${f.dst} (${(stats.size / 1024).toFixed(1)} KB)`);
    } else {
        console.log(`⚠️ Archivo origen no encontrado: ${f.src}`);
    }
});
