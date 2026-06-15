import fs from 'fs';
import path from 'path';

const logPath = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain\\43ac0447-df87-481d-9ccc-33117d59f184\\.system_generated\\tasks\\task-283.log';

try {
  if (fs.existsSync(logPath)) {
    const content = fs.readFileSync(logPath, 'utf8');
    console.log('--- LOG CONTENT ---');
    console.log(content);
    console.log('--- END OF LOG ---');
  } else {
    console.log('Log file does not exist at:', logPath);
    // Let's try searching the parent directory
    const parentDir = path.dirname(logPath);
    if (fs.existsSync(parentDir)) {
      console.log('Files in parent directory:', fs.readdirSync(parentDir));
      const grandParent = path.dirname(parentDir);
      console.log('Files in grandparent:', fs.readdirSync(grandParent));
    } else {
      console.log('Parent directory does not exist either:', parentDir);
    }
  }
} catch (e: any) {
  console.error('Error:', e.message);
}
