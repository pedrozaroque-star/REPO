const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { dictionaries } = require('../lib/i18n');

const usedKeys = new Set();
function scan(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory() && f.name !== 'node_modules' && f.name !== '.next' && f.name !== '.git') {
      scan(p);
    } else if (f.isFile() && (f.name.endsWith('.ts') || f.name.endsWith('.tsx'))) {
      const c = fs.readFileSync(p, 'utf8');
      const matches = c.matchAll(/t\(['"](ronos\.[^'"]+)['"]\)/g);
      for (const m of matches) usedKeys.add(m[1]);
    }
  }
}
scan('app');
scan('components');
scan('lib');

function resolve(dict, key) {
  const parts = key.split('.');
  let cur = dict;
  for (const part of parts) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

let missingEs = 0;
let missingEn = 0;

for (const key of usedKeys) {
  const esVal = resolve(dictionaries.es, key);
  const enVal = resolve(dictionaries.en, key);

  if (!esVal) {
    console.error(`MISSING IN ES: ${key}`);
    missingEs++;
  }
  if (!enVal) {
    console.error(`MISSING IN EN: ${key}`);
    missingEn++;
  }
}

console.log(`Audited ${usedKeys.size} active RONOS keys in codebase.`);
console.log(`Missing in ES: ${missingEs}`);
console.log(`Missing in EN: ${missingEn}`);

assert.strictEqual(missingEs, 0, 'Must have 0 missing keys in ES');
assert.strictEqual(missingEn, 0, 'Must have 0 missing keys in EN');

console.log('PASS: 100% i18n key coverage in both Spanish and English!');
