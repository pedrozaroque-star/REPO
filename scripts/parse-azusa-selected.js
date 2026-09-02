const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'cohesion_dump', 'site_mappings', 'azusa_mapping.json'), 'utf8'));

console.log('--- Selected Values in Azusa Mapping ---');
const selected = data.selects.filter(s => s.selectedValue && s.selectedValue !== '0' && s.selectedValue !== '');
console.log(`Total selects: ${data.selects.length}, with selected values: ${selected.length}`);
selected.forEach(s => {
  console.log(`ID: ${s.id} | Name: ${s.name} => ${s.selectedText} (${s.selectedValue})`);
});

// Let's also check all table rows that have values
console.log('\n--- Tables ---');
data.tables.forEach((t, i) => {
  console.log(`Table ${i}: Headers:`, t.headers);
  t.rows.forEach(r => {
    // print only rows that have content
    const rowStr = r.join(' | ');
    if (rowStr.includes('[SELECT:') && !rowStr.includes('[SELECT: Please Select') && !rowStr.includes('[SELECT: <Not Selected>')) {
      console.log('  Row:', rowStr);
    }
  });
});
