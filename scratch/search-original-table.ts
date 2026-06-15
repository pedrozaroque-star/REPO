import { execSync } from 'child_process';

try {
  const originalCode = execSync('git show HEAD:app/roles/page.tsx', { maxBuffer: 10 * 1024 * 1024 }).toString();
  const lines = originalCode.split('\n');
  
  // Search for the table tbody rendering in HEAD
  const tbodyIdx = lines.findIndex(l => l.includes('<tbody') && l.includes('className='));
  if (tbodyIdx !== -1) {
    console.log(`Found tbody in HEAD at line ${tbodyIdx + 1}:`);
    console.log(lines.slice(tbodyIdx, tbodyIdx + 150).join('\n'));
  }
} catch (e: any) {
  console.error("Error:", e.message);
}
