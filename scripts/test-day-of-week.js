function getDayOfWeek(dateStr, monthNum, year = 2026) {
    const dayNum = parseInt(dateStr.split('-')[0].trim(), 10);
    const d = new Date(year, monthNum - 1, dayNum);
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    return days[d.getDay()];
}

console.log('19-Ago-2026 ->', getDayOfWeek('19-Ago-2026', 8)); // Expected: Miércoles
console.log('20-Ago-2026 ->', getDayOfWeek('20-Ago-2026', 8)); // Expected: Jueves
console.log('21-Ago-2026 ->', getDayOfWeek('21-Ago-2026', 8)); // Expected: Viernes
console.log('22-Ago-2026 ->', getDayOfWeek('22-Ago-2026', 8)); // Expected: Sábado
