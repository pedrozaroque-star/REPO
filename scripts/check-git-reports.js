const { execSync } = require('child_process');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔍 REVISANDO COMMITS HISTÓRICOS DE PENDIENTES.HTML Y PENDIENTES_JULIO.HTML');
console.log('═══════════════════════════════════════════════════════════════════════');

try {
    const gitLog = execSync('git log -n 10 --oneline -- pendientes.html pendientes_julio.html pendientes_agosto.html', { encoding: 'utf-8' });
    console.log('Git log:\n', gitLog);
} catch (e) {
    console.error(e.message);
}
