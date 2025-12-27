const fs = require('fs').promises;
const path = require('path');

const root = process.cwd();
const excludeDirs = ['.git', '.next', 'node_modules'];
const binExt = new Set(['.png', '.jpg', '.jpeg', '.ico', '.zip', '.exe', '.dll', '.tar', '.gz', '.tgz', '.bmp', '.webp', '.pdf']);

function isExcluded(full) {
  const parts = full.split(path.sep).map(p => p.toLowerCase());
  return excludeDirs.some(d => parts.includes(d));
}

async function walk(dir) {
  let out = '';
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a,b)=>a.name.localeCompare(b.name));
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(root, full);
    if (isExcluded(full)) continue;
    if (e.isDirectory()) {
      out += await walk(full);
    } else {
      const ext = path.extname(e.name).toLowerCase();
      if (binExt.has(ext)) continue;
      try {
        const content = await fs.readFile(full, 'utf8');
        out += '----- ' + rel.replace(/\\/g,'/') + '\n' + content + '\n\n';
      } catch (err) {
        // skip files we can't read as text
      }
    }
  }
  return out;
}

(async () => {
  try {
    const data = await walk(root);
    await fs.writeFile(path.join(root, 'all_project_files.txt'), data, 'utf8');
    console.log('CREATED');
    const st = await fs.stat(path.join(root, 'all_project_files.txt'));
    console.log(st.size + ' bytes');
  } catch (err) {
    console.error('ERROR', err);
    process.exit(1);
  }
})();
