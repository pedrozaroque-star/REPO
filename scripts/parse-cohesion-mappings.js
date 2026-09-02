const path = require('path');
const d = require(path.join(__dirname, 'cohesion_dump', 'all_mappings', 'azusa_full_form.json'));
const selects = d.inputs.filter(i => i.tag === 'SELECT');
const selected = selects.filter(s => s.selectedText && s.selectedText !== '-- none --' && s.selectedText !== '-- Not Mapped --');
selected.forEach(s => {
  console.log(`${s.name} | ${s.id} | value=${s.value} | selected='${s.selectedText}'`);
});
console.log(`\nTotal configured: ${selected.length} / ${selects.length} selects`);
