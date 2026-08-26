import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabaseAdmin } from '../lib/supabase';

async function checkEmpIdError() {
  console.log('='.repeat(70));
  console.log('       TEST DE UPSERT CON "EMP007984" EN SUPABASE                ');
  console.log('='.repeat(70));

  const testPayload = [{
    company_id: 328,
    week_id: 154376,
    employee_user_id: 9999999,
    employee_id: Number("EMP007984"), // NaN!
    full_name: 'Test Justin',
    first_name: 'Test',
    last_name: 'Justin',
    pin: '1234',
    job_title: 'Crew',
    regular_hours: 10,
    overtime_hours: 0,
    double_time_hours: 0,
    total_weekly_hours: 10,
    meal_penalty_count: 0,
    sick_hours: 0,
    vacation_hours: 0,
    holiday_hours: 0,
    bereavement_hours: 0,
    unpaid_leave_hours: 0,
    broken_hours: 0,
    active: true,
    updated_at: new Date().toISOString()
  }];

  const { data, error } = await supabaseAdmin
    .from('ronos_employee_timecards_cache')
    .upsert(testPayload, { onConflict: 'company_id,week_id,employee_user_id' });

  console.log('Upsert with NaN error:', error);
}

checkEmpIdError().catch(console.error);
