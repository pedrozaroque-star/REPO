const fs = require('fs');

const lines = fs.readFileSync('c:/Users/pedro/Desktop/teg-modernizado/pendientes_julio.html', 'utf-8').split('\n');

const tasksSection = lines.slice(906, 1755).join('\n');

console.log('Total characters in tasks section:', tasksSection.length);

// Extract all task titles and their current sections (Completado, En Progreso, Pendiente)
const taskMatches = tasksSection.match(/<h3 class="task-title">([\s\S]*?)<\/h3>/g);
console.log('Found tasks:', taskMatches.length);

taskMatches.forEach((tm, i) => {
    const title = tm.replace(/<[^>]+>/g, '').trim();
    console.log(`${i+1}. ${title}`);
});
