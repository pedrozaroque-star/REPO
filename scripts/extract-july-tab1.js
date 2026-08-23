const fs = require('fs');

const julyHtml = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_julio.html', 'utf-8');

// Find where the 20 task cards start in July
const startIndex = julyHtml.indexOf('<!-- Contenedor Pestaña 1: Lista de Pendientes -->');
const endIndex = julyHtml.indexOf('<!-- Contenedor Pestaña 2: Reporte Mensual');

const tab1 = julyHtml.substring(startIndex, endIndex);

// Save Tab 1 chunk to inspect
fs.writeFileSync('c:/Users/pedro/Desktop/teg-modernizado/scratch/july_tab1.html', tab1, 'utf-8');
console.log('Saved july_tab1.html with length:', tab1.length);
