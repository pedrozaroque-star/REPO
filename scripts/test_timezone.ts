const getShiftFromTimeOld = (startTimeStr: string): 'AM' | 'PM' => {
  if (!startTimeStr) return 'AM';
  try {
    if (startTimeStr.includes(':') && !startTimeStr.includes('T')) {
      const hour = parseInt(startTimeStr.split(':')[0], 10);
      return (hour >= 17 || hour < 6) ? 'PM' : 'AM';
    }
    const date = new Date(startTimeStr);
    const hour = date.getHours();
    return (hour >= 17 || hour < 6) ? 'PM' : 'AM';
  } catch (e) {
    return 'AM';
  }
};

const getShiftFromTimeNew = (startTimeStr: string): 'AM' | 'PM' => {
  if (!startTimeStr) return 'AM';
  try {
    if (startTimeStr.includes(':') && !startTimeStr.includes('T')) {
      const hour = parseInt(startTimeStr.split(':')[0], 10);
      return (hour >= 17 || hour < 6) ? 'PM' : 'AM';
    }
    const date = new Date(startTimeStr);
    // Use Intl.DateTimeFormat to extract the hour in America/Los_Angeles timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const hourPart = parts.find(p => p.type === 'hour');
    const hour = hourPart ? parseInt(hourPart.value, 10) : date.getHours();
    return (hour >= 17 || hour < 6) ? 'PM' : 'AM';
  } catch (e) {
    return 'AM';
  }
};

const testTimes = [
  '2026-06-07T17:00:00+00:00',
  '2026-06-07T10:00:00-07:00',
  '2026-06-07T16:59:00-07:00',
  '2026-06-07T17:00:00-07:00',
  '2026-06-07T05:59:00-07:00',
  '2026-06-07T06:00:00-07:00',
  '17:00:00',
  '05:00:00'
];

console.log('Testing getShiftFromTime timezone conversion:');
for (const t of testTimes) {
  console.log(`Time: ${t}`);
  console.log(`  Old: ${getShiftFromTimeOld(t)}`);
  console.log(`  New: ${getShiftFromTimeNew(t)}`);
}
