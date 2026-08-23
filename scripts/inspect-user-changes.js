const fs = require('fs');

const content = fs.readFileSync('pendientes_agosto.html', 'utf-8');
console.log('Total lines:', content.split('\n').length);
console.log('Total bytes:', content.length);

// Look for stats
const statNumbers = [...content.matchAll(/class="(?:stat-number|stat-num)"[^>]*>([^<]+)/g)].map(m => m[1].trim());
console.log('Stat numbers found:', statNumbers);

// Look for tasks in tab 2
const taskTitles = [...content.matchAll(/<h3 class="task-title">([^<]+)<\/h3>/g)].map(m => m[1].trim());
console.log(`Task titles count: ${taskTitles.length}`);
console.log('Sample task titles:', taskTitles.slice(0, 5));

// Check tab labels
const tabLabels = [...content.matchAll(/class="tab-label">([\s\S]*?)<\/label>/g)].map(m => m[1].replace(/\s+/g, ' ').trim());
console.log('Tab labels:', tabLabels);

// Check if HTML structure is closed properly
console.log('Ends with </html>:', content.trim().endsWith('</html>'));
