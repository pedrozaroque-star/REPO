import { startOfWeek, addDays } from 'date-fns';

const TIMEZONE = 'America/Los_Angeles';

const formatDateISO = (d: Date) => {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(d);
};

function test() {
    // Current date is Sunday June 7, 2026
    const mockToday = new Date('2026-06-07T12:40:09'); 
    const currentWeekStart = startOfWeek(mockToday, { weekStartsOn: 1 }); // Monday June 1st
    
    console.log("currentWeekStart local string:", currentWeekStart.toString());
    
    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
    
    weekDays.forEach((day, index) => {
        console.log(`Index ${index}:`);
        console.log("  day local string:", day.toString());
        console.log("  formatDateISO(day):", formatDateISO(day));
    });
}

test();
