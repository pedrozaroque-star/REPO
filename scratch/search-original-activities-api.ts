import { execSync } from 'child_process';

try {
  const originalCode = execSync('git show HEAD:app/api/roles/activities/route.ts', { maxBuffer: 10 * 1024 * 1024 }).toString();
  console.log(originalCode);
} catch (e: any) {
  console.error("Error:", e.message);
}
