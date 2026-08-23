const fs = require('fs');

const data = JSON.parse(fs.readFileSync('scripts/lynwood_all_shifts_dump.json', 'utf-8'));
const { lynwoodEmps, shifts } = data;

console.log('Lynwood Employees count:', lynwoodEmps.length);
console.log('Shifts count:', shifts.length);

// Let's print all employees with their jobs and email
lynwoodEmps.forEach(e => {
    console.log(`- ${e.first_name} ${e.last_name} | Email: ${e.email} | Job: ${e.job_title} | ID: ${e.id} | GUID: ${e.toast_guid}`);
});
