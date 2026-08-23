const fs = require('fs');
const path = require('path');

console.log('═══════════════════════════════════════════════════════════════════════');
console.log('🔍 AUDITORÍA INTEGRAL DE MÓDULOS DEL SISTEMA SM TEG');
console.log('═══════════════════════════════════════════════════════════════════════');

const projectRoot = 'c:\\Users\\pedro\\Desktop\\teg-modernizado';

// Check app directory for all routes
function scanDir(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            if (!file.startsWith('.') && file !== 'node_modules' && file !== '.next') {
                results = results.concat(scanDir(fullPath));
            }
        } else {
            if (file === 'page.tsx' || file === 'route.ts') {
                results.push(fullPath);
            }
        }
    });
    return results;
}

const allPagesAndRoutes = scanDir(path.join(projectRoot, 'app'));
console.log(`Total páginas y endpoints encontrados en /app: ${allPagesAndRoutes.length}`);

// Group by top-level module
const moduleMap = {};
allPagesAndRoutes.forEach(p => {
    const rel = path.relative(path.join(projectRoot, 'app'), p);
    const top = rel.split(path.sep)[0];
    if (!moduleMap[top]) moduleMap[top] = [];
    moduleMap[top].push(rel);
});

console.log('\n📂 Estructura de módulos en /app:');
Object.keys(moduleMap).forEach(mod => {
    console.log(` - ${mod} (${moduleMap[mod].length} archivos)`);
});
