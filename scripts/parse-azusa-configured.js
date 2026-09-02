const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'cohesion_dump', 'all_mappings', 'azusa_full_form.json'), 'utf8'));

const configured = data.inputs.filter(item => {
  if (item.type === 'checkbox' || item.type === 'radio') {
    return item.checked;
  }
  if (item.tag === 'SELECT') {
    return item.value && item.value !== '0' && item.value !== '' && !item.selectedText.startsWith('Please Select') && !item.selectedText.startsWith('<Not Selected>');
  }
  if (item.type === 'text' || item.type === 'number') {
    return item.value && item.value.trim() !== '';
  }
  return false;
});

console.log(`Total configured fields for Azusa: ${configured.length}`);
configured.forEach(c => {
  console.log(`[${c.name}] (${c.type || c.tag}) Val: "${c.value}" | Selected: "${c.selectedText}" | Label: "${c.label.slice(0, 100)}"`);
});
