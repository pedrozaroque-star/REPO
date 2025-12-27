const fs = require('fs').promises;
const path = require('path');

const root = process.cwd();
const targets = ['app','components','lib'];
const binExt = new Set(['.png', '.jpg', '.jpeg', '.ico', '.zip', '.exe', '.dll', '.tar', '.gz', '.tgz', '.bmp', '.webp', '.pdf']);

async function walkDir(dir) {
  let out = '';
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a,b)=>a.name.localeCompare(b.name));
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).replace(/\\/g,'/');
      if (e.isDirectory()) {
        out += await walkDir(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (binExt.has(ext)) continue;
        try {
          const content = await fs.readFile(full, 'utf8');
          out += '----- ' + rel + '\n' + content + '\n\n';
        } catch (err) {
          // skip unreadable files
        }
      }
    }
  } catch (err) {
    // directory might not exist, ignore
  }
  return out;
}

(async ()=>{
  try {
    let data = '';
    for (const t of targets) {
      const dir = path.join(root, t);
      data += await walkDir(dir);
    }
    const outPath = path.join(root, 'app_components_lib_files.txt');
    await fs.writeFile(outPath, data, 'utf8');
    const st = await fs.stat(outPath);
    console.log('CREATED', outPath, st.size + 'bytes');
  } catch (err) {
    console.error('ERROR', err);
    process.exit(1);
  }
})();
