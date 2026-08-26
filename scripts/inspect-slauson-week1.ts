import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { callRonosApi } from '../lib/ronos-api';

async function checkSlausonWeek154376() {
  console.log('='.repeat(70));
  console.log('       CONSULTA A RONOS API PARA SEMANA 154376 (SLAUSON 328)     ');
  console.log('='.repeat(70));

  const weekData: any = await callRonosApi('WorkWeek/AdminGetWeekByWeekId', {
    weekId: 154376
  });

  console.log('Week 154376 response:', {
    id: weekData?.id,
    name: weekData?.name,
    startDate: weekData?.startDate,
    endDate: weekData?.endDate,
    totalEmployees: weekData?.employees?.length
  });

  for (const emp of (weekData?.employees || [])) {
    const name = `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
    if (
      name.toLowerCase().includes('brandon') ||
      name.toLowerCase().includes('lorenzo') ||
      name.toLowerCase().includes('jennifer') ||
      name.toLowerCase().includes('rosalinda') ||
      name.toLowerCase().includes('jesus')
    ) {
      console.log(`\nEmployee: ${name} (ID: ${emp.id || emp.userId})`);
      console.log(`  Reg: ${emp.regularHours} | OT: ${emp.overtimeHours} | DT: ${emp.doubleTimeHours} | Total: ${emp.totalHours}`);
      
      // Fetch manager user week to inspect workDays
      const userWeek: any = await callRonosApi('WorkWeek/ManagerGetUserWeekByWeekId', {
        weekId: 154376,
        userId: emp.id || emp.userId
      });

      console.log(`  WorkDays count: ${userWeek?.workDays?.length}`);
      for (const d of (userWeek?.workDays || [])) {
        if (d.sickHours > 0 || d.vacationHours > 0 || d.holidayHours > 0 || d.regularHours > 0) {
          console.log(`    Date: ${d.workDate} | Reg: ${d.regularHours} | OT: ${d.overtimeHours} | Sick: ${d.sickHours} | Vac: ${d.vacationHours} | Hol: ${d.holidayHours}`);
        }
      }
    }
  }
}

checkSlausonWeek154376().catch(console.error);
