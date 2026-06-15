import { execSync } from 'child_process';

try {
  const originalCode = execSync('git show HEAD:app/roles/page.tsx', { maxBuffer: 10 * 1024 * 1024 }).toString();
  const lines = originalCode.split('\n');
  console.log(`Original file lines: ${lines.length}`);
  
  // Find where tasks is used or where assignments are rendered
  console.log("\nSearching for 'tasks' occurrences in HEAD:");
  lines.forEach((l, idx) => {
    if (l.includes('.tasks') || l.includes('tasks:') || l.includes('tasks.') || l.includes('tasks =')) {
      if (idx > 200 && idx < 3000) { // filter out boilerplate imports/types
        console.log(`Line ${idx + 1}: ${l.trim()}`);
      }
    }
  });

  // Find where BoardSlot is rendered
  const slotIdx = lines.findIndex(l => l.includes('<BoardSlot') || l.includes('BoardSlot'));
  if (slotIdx !== -1) {
    console.log(`\nFound BoardSlot reference at line ${slotIdx + 1}:`);
    console.log(lines.slice(slotIdx - 5, slotIdx + 20).join('\n'));
  }
} catch (e: any) {
  console.error("Error:", e.message);
}
