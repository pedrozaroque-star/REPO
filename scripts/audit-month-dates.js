const fs = require('fs');

// Check June
const juneBackupHtml = fs.readFileSync('backups/pendientes_junio_canonical_backup.html', 'utf-8');
const juneDates = [...juneBackupHtml.matchAll(/<strong>(\d{2}-[A-Za-z]{3}-\d{4})<\/strong>/g)].map(m => m[1]);
console.log('June dates count:', juneDates.length);
const leakedJuneDates = juneDates.filter(d => !d.includes('Jun'));
console.log('Leaked non-June in June backup:', leakedJuneDates);

// Check July
const julyBackupHtml = fs.readFileSync('backups/pendientes_julio_canonical_backup.html', 'utf-8');
const julyDates = [...julyBackupHtml.matchAll(/<strong>(\d{2}-[A-Za-z]{3}-\d{4})<\/strong>/g)].map(m => m[1]);
console.log('July dates count:', julyDates.length);
const pureJulyDates = julyDates.filter(d => d.includes('Jul'));
const leakedJulyDates = julyDates.filter(d => !d.includes('Jul'));
console.log(`July pure: ${pureJulyDates.length}, Leaked non-July in July backup: ${leakedJulyDates.length} ->`, leakedJulyDates);
