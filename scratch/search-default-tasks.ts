import { execSync } from 'child_process';

try {
  const originalCode = execSync('git show HEAD:app/roles/page.tsx', { maxBuffer: 10 * 1024 * 1024 }).toString();
  const lines = originalCode.split('\n');
  
  console.log("Lines 400 to 450:");
  console.log(lines.slice(400, 450).join('\n'));
} catch (e: any) {
  console.error("Error:", e.message);
}
