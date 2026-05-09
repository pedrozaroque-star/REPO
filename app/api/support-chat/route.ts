import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Reliable PST business date (matches toast-api.ts pattern exactly)
function getBusinessDates() {
  const now = new Date();
  // Use the SAME pattern as toast-api.ts line 884
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const laHour = parseInt(now.toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles' }));
  
  // 6 AM Rule: if before 6 AM, business day is still yesterday
  let businessToday = todayStr;
  if (laHour < 6) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    businessToday = d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  }
  
  // Yesterday = one day before businessToday
  const [y, m, day] = businessToday.split('-').map(Number);
  const yd = new Date(y, m - 1, day);
  yd.setDate(yd.getDate() - 1);
  const businessYesterday = `${yd.getFullYear()}-${String(yd.getMonth()+1).padStart(2,'0')}-${String(yd.getDate()).padStart(2,'0')}`;

  return { today: businessToday, yesterday: businessYesterday, laHour };
}

const fmt$ = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clean = (name: string) => (name || '').replace(/^Tacos Gavilan\s+/i, '').trim();

// Fetch comprehensive system context from Supabase
// Helper: date math without UTC drift
function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function addDays(dateStr: string, n: number) {
  const [y,m,d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  dt.setDate(dt.getDate() + n);
  return fmtDate(dt);
}
function getMonday(dateStr: string) {
  const [y,m,d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday=1
  dt.setDate(dt.getDate() + diff);
  return fmtDate(dt);
}

// Aggregate helper: sum a range from sales_daily_cache
async function fetchRangeTotals(startDate: string, endDate: string) {
  let allRows: any[] = [];
  let page = 0;
  const pageSize = 1000;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabaseAdmin
      .from('sales_daily_cache')
      .select('store_name, net_sales, order_count, labor_cost, uber_sales, doordash_sales, grubhub_sales')
      .gte('business_date', startDate)
      .lte('business_date', endDate)
      .range(page * pageSize, (page+1) * pageSize - 1);
    if (error) break;
    if (data) { allRows = allRows.concat(data); if (data.length < pageSize) hasMore = false; else page++; }
    else hasMore = false;
  }
  // Aggregate by store
  const byStore: Record<string, { sales: number, orders: number, labor: number, uber: number, dd: number }> = {};
  let total = 0, orders = 0, labor = 0, uber = 0, dd = 0, gh = 0;
  for (const r of allRows) {
    const s = Number(r.net_sales) || 0;
    const o = Number(r.order_count) || 0;
    const l = Number(r.labor_cost) || 0;
    const u = Number(r.uber_sales) || 0;
    const d = Number(r.doordash_sales) || 0;
    total += s; orders += o; labor += l;
    uber += u;
    dd += d;
    gh += Number(r.grubhub_sales) || 0;
    const name = clean(r.store_name);
    if (!byStore[name]) byStore[name] = { sales: 0, orders: 0, labor: 0, uber: 0, dd: 0 };
    byStore[name].sales += s;
    byStore[name].orders += o;
    byStore[name].labor += l;
    byStore[name].uber += u;
    byStore[name].dd += d;
  }
  const sorted = Object.entries(byStore).sort((a,b) => b[1].sales - a[1].sales);
  return { total, orders, labor, uber, dd, gh, byStore: sorted, rowCount: allRows.length };
}

async function fetchSystemContext(): Promise<string> {
  try {
    const { today, yesterday, laHour } = getBusinessDates();
    const sections: string[] = [];
    sections.push(`🕐 Hora California: ${laHour}:00 | Business day: ${today} | Ayer: ${yesterday}`);

    // ─── 1. Today's sales (per store detail) ───
    const { data: todaySales } = await supabaseAdmin
      .from('sales_daily_cache')
      .select('store_name, net_sales, order_count, labor_cost, uber_sales, doordash_sales')
      .eq('business_date', today)
      .order('net_sales', { ascending: false });

    const todayTotal = (todaySales || []).reduce((s, r) => s + (Number(r.net_sales) || 0), 0);
    const todayOrders = (todaySales || []).reduce((s, r) => s + (Number(r.order_count) || 0), 0);
    const todayLabor = (todaySales || []).reduce((s, r) => s + (Number(r.labor_cost) || 0), 0);

    if (todaySales && todayTotal > 0) {
      const todayUber = (todaySales || []).reduce((s, r) => s + (Number(r.uber_sales) || 0), 0);
      const todayDD = (todaySales || []).reduce((s, r) => s + (Number(r.doordash_sales) || 0), 0);
      const lines = todaySales.filter(s => Number(s.net_sales) > 0).map(s =>
        `  ${clean(s.store_name)}: Total ${fmt$(Number(s.net_sales))} (Uber: ${fmt$(Number(s.uber_sales) || 0)} | DD: ${fmt$(Number(s.doordash_sales) || 0)})`
      ).join('\n');
      sections.push(`📊 VENTAS HOY (${today}):\nTotal: ${fmt$(todayTotal)} | Órdenes: ${todayOrders} | Labor: ${fmt$(todayLabor)} (${todayTotal > 0 ? ((todayLabor/todayTotal)*100).toFixed(1) : 0}%)\nGlobal Uber: ${fmt$(todayUber)} | Global DD: ${fmt$(todayDD)}\nDesglose por tienda (Top 15):\n${lines}`);
    } else {
      sections.push(`📊 VENTAS HOY (${today}): Día en curso, datos actualizándose desde Toast POS.`);
    }

    // ─── 2. Yesterday ───
    const yest = await fetchRangeTotals(yesterday, yesterday);
    if (yest.total > 0) {
      const lines = yest.byStore.map(([n,v]) => `  ${n}: Total ${fmt$(v.sales)} (Uber: ${fmt$(v.uber)} | DD: ${fmt$(v.dd)})`).join('\n');
      sections.push(`📊 VENTAS AYER (${yesterday}):\nTotal: ${fmt$(yest.total)} | Órdenes: ${yest.orders} | Labor: ${fmt$(yest.labor)} (${((yest.labor/yest.total)*100).toFixed(1)}%)\nGlobal Uber: ${fmt$(yest.uber)} | Global DD: ${fmt$(yest.dd)}\nDesglose por tienda (Top 15):\n${lines}`);
    }

    // ─── 3. Hoy vs Ayer ───
    if (todayTotal > 0 && yest.total > 0) {
      const diff = todayTotal - yest.total;
      sections.push(`📈 HOY vs AYER: ${diff >= 0 ? '+' : ''}${fmt$(diff)} (${((diff/yest.total)*100).toFixed(1)}%)`);
    }

    // ─── 4. This Week (Mon-today) ───
    const thisMonday = getMonday(today);
    const thisWeek = await fetchRangeTotals(thisMonday, today);
    if (thisWeek.total > 0) {
      const lines = thisWeek.byStore.map(([n,v]) => `  ${n}: Total ${fmt$(v.sales)} (Uber: ${fmt$(v.uber)} | DD: ${fmt$(v.dd)})`).join('\n');
      sections.push(`📅 ESTA SEMANA (${thisMonday} a ${today}):\nTotal: ${fmt$(thisWeek.total)} | Órdenes: ${thisWeek.orders} | Labor: ${fmt$(thisWeek.labor)} (${((thisWeek.labor/thisWeek.total)*100).toFixed(1)}%)\nGlobal Uber: ${fmt$(thisWeek.uber)} | Global DD: ${fmt$(thisWeek.dd)}\nDesglose por tienda (Top 15):\n${lines}`);
    }

    // ─── 5. Last Week (Mon-Sun) ───
    const [y,m,d] = thisMonday.split('-').map(Number);
    const dtLastMon = new Date(y, m-1, d - 7);
    const dtLastSun = new Date(y, m-1, d - 1);
    const lastMonday = fmtDate(dtLastMon);
    const lastSunday = fmtDate(dtLastSun);
    const lastWeek = await fetchRangeTotals(lastMonday, lastSunday);
    if (lastWeek.total > 0) {
      const lines = lastWeek.byStore.map(([n,v]) => `  ${n}: Total ${fmt$(v.sales)} (Uber: ${fmt$(v.uber)} | DD: ${fmt$(v.dd)})`).join('\n');
      sections.push(`📅 SEMANA PASADA (${lastMonday} a ${lastSunday}):\nTotal: ${fmt$(lastWeek.total)} | Órdenes: ${lastWeek.orders} | Labor: ${fmt$(lastWeek.labor)} (${((lastWeek.labor/lastWeek.total)*100).toFixed(1)}%)\nGlobal Uber: ${fmt$(lastWeek.uber)} | Global DD: ${fmt$(lastWeek.dd)}\nDesglose por tienda (Top 15):\n${lines}`);
    }

    // ─── 6. Week vs Week comparison ───
    if (thisWeek.total > 0 && lastWeek.total > 0) {
      const diff = thisWeek.total - lastWeek.total;
      sections.push(`📈 SEMANA ACTUAL vs PASADA: ${diff >= 0 ? '+' : ''}${fmt$(diff)} (${((diff/lastWeek.total)*100).toFixed(1)}%)`);
    }

    // ─── 7. Current Month ───
    const monthStart = today.slice(0, 7) + '-01';
    const thisMonth = await fetchRangeTotals(monthStart, today);
    if (thisMonth.total > 0) {
      sections.push(`📆 MES ACTUAL (${monthStart} a ${today}):\nTotal: ${fmt$(thisMonth.total)} | Órdenes: ${thisMonth.orders} | Labor: ${fmt$(thisMonth.labor)} (${((thisMonth.labor/thisMonth.total)*100).toFixed(1)}%)`);
    }

    // ─── 8. Last Month ───
    const [ty, tm] = today.split('-').map(Number);
    const prevM = tm === 1 ? 12 : tm - 1;
    const prevY = tm === 1 ? ty - 1 : ty;
    const lastMonthStart = `${prevY}-${String(prevM).padStart(2,'0')}-01`;
    const lastMonthEnd = `${prevY}-${String(prevM).padStart(2,'0')}-${new Date(prevY, prevM, 0).getDate()}`;
    const prevMonth = await fetchRangeTotals(lastMonthStart, lastMonthEnd);
    if (prevMonth.total > 0) {
      sections.push(`📆 MES ANTERIOR (${lastMonthStart} a ${lastMonthEnd}):\nTotal: ${fmt$(prevMonth.total)} | Órdenes: ${prevMonth.orders}`);
    }

    // ─── 9. Store count ───
    const { count } = await supabaseAdmin.from('tiendas').select('id', { count: 'exact', head: true }).eq('activa', true);
    if (count) sections.push(`🏪 Tiendas activas: ${count}`);

    // ─── 10. Inspections (comprehensive weekly summary) ───
    // Declare maps outside try so they're accessible across sections
    const storeIdMap: Record<string, string> = {};
    try {
      const { data: thisWeekInsp } = await supabaseAdmin
        .from('supervisor_inspections')
        .select('id, store_id, inspector_id, overall_score, inspection_date, estatus_admin, shift')
        .gte('inspection_date', thisMonday)
        .lte('inspection_date', today)
        .order('inspection_date', { ascending: false });

      const { data: lastWeekInsp } = await supabaseAdmin
        .from('supervisor_inspections')
        .select('id, store_id, inspector_id, overall_score, inspection_date, estatus_admin, shift')
        .gte('inspection_date', lastMonday)
        .lte('inspection_date', lastSunday)
        .order('inspection_date', { ascending: false });

      // Get users for name mapping (reusable across modules)
      const { data: allUsers } = await supabaseAdmin
        .from('users')
        .select('id, full_name, role, email, store_id');

      const { data: allStores } = await supabaseAdmin
        .from('stores')
        .select('id, name, external_id');

      const userMap: Record<string, string> = {};
      const userRoleMap: Record<string, string> = {};
      (allUsers || []).forEach(u => { userMap[u.id] = u.full_name || 'Desconocido'; userRoleMap[u.id] = u.role || ''; });
      const storeMap: Record<string, string> = {};
      (allStores || []).forEach(s => { 
        storeMap[s.id] = clean(s.name); 
        storeIdMap[s.external_id] = clean(s.name); 
        // Also map by numeric id (schedules/users use numeric store_id)
        storeIdMap[String(s.id)] = clean(s.name);
        storeIdMap[s.id] = clean(s.name);
      });

      // Users summary
      if (allUsers && allUsers.length > 0) {
        const byRole: Record<string, number> = {};
        allUsers.forEach(u => { byRole[u.role || 'sin_rol'] = (byRole[u.role || 'sin_rol'] || 0) + 1; });
        const roleLines = Object.entries(byRole).sort((a,b) => b[1] - a[1]).map(([r,c]) => `${r}: ${c}`).join(' | ');
        sections.push(`👥 USUARIOS REGISTRADOS: ${allUsers.length} total\nPor rol: ${roleLines}`);
      }

      // Stores summary
      if (allStores && allStores.length > 0) {
        sections.push(`🏪 TIENDAS: ${allStores.length} activas → ${allStores.map(s => clean(s.name)).join(', ')}`);
      }

      // This week inspections
      if (thisWeekInsp && thisWeekInsp.length > 0) {
        const avgScore = Math.round(thisWeekInsp.reduce((s, i) => s + (i.overall_score || 0), 0) / thisWeekInsp.length);
        const pending = thisWeekInsp.filter(i => (i.estatus_admin || 'pendiente') === 'pendiente').length;
        const approved = thisWeekInsp.filter(i => ['aprobado','cerrado'].includes(i.estatus_admin || '')).length;
        const rejected = thisWeekInsp.filter(i => i.estatus_admin === 'rechazado').length;

        const bySup: Record<string, { count: number; totalScore: number }> = {};
        thisWeekInsp.forEach(i => {
          const name = userMap[i.inspector_id] || 'Desconocido';
          if (!bySup[name]) bySup[name] = { count: 0, totalScore: 0 };
          bySup[name].count++; bySup[name].totalScore += (i.overall_score || 0);
        });
        const supLines = Object.entries(bySup).sort((a,b) => b[1].count - a[1].count)
          .map(([name, v]) => `  ${name}: ${v.count} inspecciones (Promedio: ${Math.round(v.totalScore / v.count)}%)`).join('\n');

        const byStore: Record<string, { count: number; totalScore: number }> = {};
        thisWeekInsp.forEach(i => {
          const name = storeMap[i.store_id] || 'Desconocida';
          if (!byStore[name]) byStore[name] = { count: 0, totalScore: 0 };
          byStore[name].count++; byStore[name].totalScore += (i.overall_score || 0);
        });
        const storeLines = Object.entries(byStore).sort((a,b) => b[1].count - a[1].count)
          .map(([name, v]) => `  ${name}: ${v.count} inspecciones (${Math.round(v.totalScore / v.count)}%)`).join('\n');

        sections.push(`📋 INSPECCIONES ESTA SEMANA (${thisMonday} a ${today}):\nTotal: ${thisWeekInsp.length} | Promedio: ${avgScore}% | Pendientes: ${pending} | Aprobadas: ${approved} | Rechazadas: ${rejected}\nPor Supervisor:\n${supLines}\nPor Tienda:\n${storeLines}`);
      } else {
        sections.push(`📋 INSPECCIONES ESTA SEMANA: 0 registradas.`);
      }

      // Last week inspections
      if (lastWeekInsp && lastWeekInsp.length > 0) {
        const avgScore = Math.round(lastWeekInsp.reduce((s, i) => s + (i.overall_score || 0), 0) / lastWeekInsp.length);
        const pending = lastWeekInsp.filter(i => (i.estatus_admin || 'pendiente') === 'pendiente').length;
        const approved = lastWeekInsp.filter(i => ['aprobado','cerrado'].includes(i.estatus_admin || '')).length;

        const bySup: Record<string, { count: number; totalScore: number }> = {};
        lastWeekInsp.forEach(i => {
          const name = userMap[i.inspector_id] || 'Desconocido';
          if (!bySup[name]) bySup[name] = { count: 0, totalScore: 0 };
          bySup[name].count++; bySup[name].totalScore += (i.overall_score || 0);
        });
        const supLines = Object.entries(bySup).sort((a,b) => b[1].count - a[1].count)
          .map(([name, v]) => `  ${name}: ${v.count} inspecciones (${Math.round(v.totalScore / v.count)}%)`).join('\n');

        sections.push(`📋 INSPECCIONES SEMANA PASADA (${lastMonday} a ${lastSunday}):\nTotal: ${lastWeekInsp.length} | Promedio: ${avgScore}% | Pendientes: ${pending} | Aprobadas: ${approved}\nPor Supervisor:\n${supLines}`);
      }
    } catch (e) { console.warn('[TEG Assistant] Inspections fetch error:', e); }

    // ─── 11. Employees (Toast) ───
    try {
      const { data: employees } = await supabaseAdmin
        .from('toast_employees')
        .select('id, first_name, last_name, store_id, job_title, deleted')
        .eq('deleted', false);
      if (employees && employees.length > 0) {
        const byStore: Record<string, number> = {};
        employees.forEach(e => {
          const name = storeIdMap[e.store_id] || e.store_id || 'Sin tienda';
          byStore[name] = (byStore[name] || 0) + 1;
        });
        const storeLines = Object.entries(byStore).sort((a,b) => b[1] - a[1])
          .map(([name, c]) => `${name}: ${c}`).join(' | ');
        sections.push(`🧑‍🍳 EMPLEADOS ACTIVOS (Toast): ${employees.length} total\nPor Tienda: ${storeLines}`);
      }
    } catch (e) { console.warn('[TEG Assistant] Employees fetch error:', e); }

    // ─── 12. Labor (Punches this week) ───
    try {
      const { data: punches, count: punchCount } = await supabaseAdmin
        .from('punches')
        .select('employee_name, store_id, in_date, hours_worked, is_overtime', { count: 'exact' })
        .gte('in_date', thisMonday)
        .lte('in_date', today);
      if (punches && punches.length > 0) {
        const totalHours = punches.reduce((s, p) => s + (Number(p.hours_worked) || 0), 0);
        const overtimeCount = punches.filter(p => p.is_overtime).length;
        const uniqueEmployees = new Set(punches.map(p => p.employee_name)).size;
        sections.push(`⏰ LABOR ESTA SEMANA (Punches ${thisMonday} a ${today}):\nTotal registros: ${punchCount} | Horas trabajadas: ${totalHours.toFixed(1)}h | Overtime: ${overtimeCount} registros | Empleados únicos: ${uniqueEmployees}`);
      }
    } catch (e) { console.warn('[TEG Assistant] Punches fetch error:', e); }

    // ─── 13. HORARIOS (módulo /horarios — tabla 'schedules' + 'users') ───
    try {
      const thisSunday = addDays(thisMonday, 6);

      // Fetch users (the people who appear in the Horarios module)
      const { data: usersData } = await supabaseAdmin
        .from('users')
        .select('id, full_name, role, store_id, position_type')
        .eq('is_active', true)
        .limit(1000);

      // Build user lookup: user.id → { name, role, store }
      const userLookup: Record<string, { name: string; role: string; store: string; position: string }> = {};
      (usersData || []).forEach((u: any) => {
        // Build descriptive role: "manager" or "asistente (cashier)" or "supervisor"
        const posLabel = u.position_type ? ` (${u.position_type})` : '';
        const fullRole = `${u.role || ''}${posLabel}`.trim();
        userLookup[String(u.id)] = {
          name: u.full_name || 'Sin nombre',
          role: fullRole,
          store: storeIdMap[u.store_id] || storeIdMap[String(u.store_id)] || u.store_id || '',
          position: u.position_type || ''
        };
      });

      // Fetch schedules for this week (this is the table supervisors fill)
      const { data: schedules } = await supabaseAdmin
        .from('schedules')
        .select('user_id, store_id, date, start_time, end_time, shift_label, role')
        .gte('date', thisMonday)
        .lte('date', thisSunday)
        .limit(10000);

      // Format time helper (HH:mm → readable)
      const fmtHHMM = (time: string): string => {
        if (!time) return '?';
        try {
          const [hStr, mStr] = time.split(':');
          const h = parseInt(hStr);
          const ampm = h >= 12 ? 'pm' : 'am';
          const h12 = h % 12 || 12;
          const min = mStr === '00' ? '' : `:${mStr}`;
          return `${h12}${min}${ampm}`;
        } catch { return time; }
      };

      if (schedules && schedules.length > 0) {
        const weekDays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
        const allDates: string[] = [];
        for (let i = 0; i < 7; i++) allDates.push(addDays(thisMonday, i));

        // Build per-user schedule
        const userSchedule: Record<string, { name: string; role: string; store: string; days: Record<string, string> }> = {};
        schedules.forEach((s: any) => {
          if (!s.user_id) return;
          const uid = String(s.user_id);
          const user = userLookup[uid];

          if (!userSchedule[uid]) {
            userSchedule[uid] = {
              name: user?.name || `Usuario ${uid.slice(0,6)}`,
              role: user?.role || '',
              store: user?.store || (storeIdMap[s.store_id] || s.store_id || ''),
              days: {}
            };
            allDates.forEach(d => { userSchedule[uid].days[d] = 'OFF'; });
          }
          // Mark the day with the shift time
          const timeStr = (s.start_time && s.end_time) 
            ? `${fmtHHMM(s.start_time)}-${fmtHHMM(s.end_time)}`
            : (s.shift_label || 'Asignado');
          userSchedule[uid].days[s.date] = timeStr;
        });

        // Build readable schedule lines
        const schedLines: string[] = [];
        for (const [, u] of Object.entries(userSchedule)) {
          const role = u.role ? ` (${u.role})` : '';
          const store = u.store ? ` [${u.store}]` : '';
          const days = allDates.map((d, i) => `${weekDays[i]}:${u.days[d]}`).join(' | ');
          schedLines.push(`  ${u.name}${role}${store}: ${days}`);
        }

        // Days off summary — include role for identification
        const offSummary = allDates.map((d, i) => {
          const day = weekDays[i];
          const offs = Object.values(userSchedule)
            .filter(u => u.days[d] === 'OFF')
            .map(u => u.role ? `${u.name} (${u.role})` : u.name);
          return offs.length > 0 ? `  ${day}: ${offs.join(', ')}` : `  ${day}: Todos trabajan`;
        }).join('\n');

        sections.push(`📅 MÓDULO HORARIOS ESTA SEMANA (${thisMonday} a ${thisSunday}):\nTotal entradas: ${schedules.length} | Empleados: ${Object.keys(userSchedule).length}\n\nHORARIO POR EMPLEADO:\n${schedLines.join('\n')}\n\nDÍAS LIBRES (OFF):\n${offSummary}`);
      }
    } catch (e) { console.warn('[TEG Assistant] Schedules fetch error:', e); }

    // ─── 13b. PLANIFICADOR (módulo /planificador — tabla 'shifts' + 'toast_employees' + 'toast_jobs') ───
    // Contiene puestos específicos: Cashier, Line Cook, etc.
    try {
      const thisSunday = addDays(thisMonday, 6);

      // Fetch toast_jobs for job title resolution
      const { data: jobsData } = await supabaseAdmin
        .from('toast_jobs')
        .select('id, guid, title');
      const jobIdToTitle: Record<string, string> = {};
      (jobsData || []).forEach((j: any) => {
        jobIdToTitle[String(j.id)] = j.title;
        if (j.guid) jobIdToTitle[String(j.guid)] = j.title;
      });

      // Fetch active toast employees
      const { data: allEmps } = await supabaseAdmin
        .from('toast_employees')
        .select('id, first_name, last_name, toast_guid, store_ids, job_references, chosen_name')
        .eq('deleted', false)
        .limit(1000);

      const empNameMap: Record<string, { name: string; job: string; store: string }> = {};
      (allEmps || []).forEach((e: any) => {
        const displayName = e.chosen_name
          || `${e.first_name || ''} ${e.last_name || ''}`.trim()
          || 'Sin nombre';
        const storeId = Array.isArray(e.store_ids) ? e.store_ids[0] : (e.store_ids || '');
        const entry = {
          name: displayName,
          job: '',
          store: storeIdMap[storeId] || storeId || ''
        };
        empNameMap[String(e.id)] = entry;
        if (e.toast_guid) empNameMap[String(e.toast_guid)] = entry;
      });

      // Fetch shifts for this week
      const { data: rawShifts } = await supabaseAdmin
        .from('shifts')
        .select('employee_id, store_id, shift_date, start_time, end_time, status, job_id')
        .gte('shift_date', thisMonday)
        .lte('shift_date', thisSunday)
        .not('employee_id', 'is', null)
        .limit(10000);

      const fmtISO = (iso: string): string => {
        try {
          const d = new Date(iso);
          const h = d.getHours(); const m = d.getMinutes();
          const ampm = h >= 12 ? 'pm' : 'am';
          const h12 = h % 12 || 12;
          return m === 0 ? `${h12}${ampm}` : `${h12}:${m.toString().padStart(2, '0')}${ampm}`;
        } catch { return iso; }
      };

      if (rawShifts && rawShifts.length > 0) {
        const weekDays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
        const allDates: string[] = [];
        for (let i = 0; i < 7; i++) allDates.push(addDays(thisMonday, i));

        const empSched: Record<string, { name: string; job: string; store: string; days: Record<string, string> }> = {};
        rawShifts.forEach((s: any) => {
          if (!s.employee_id) return;
          const eid = String(s.employee_id);
          const emp = empNameMap[eid] || empNameMap[s.employee_id];
          const jobFromShift = s.job_id ? (jobIdToTitle[String(s.job_id)] || '') : '';

          if (!empSched[eid]) {
            empSched[eid] = {
              name: emp?.name || `Empleado ${eid.slice(0,6)}`,
              job: jobFromShift || emp?.job || '',
              store: emp?.store || (storeIdMap[s.store_id] || s.store_id || ''),
              days: {}
            };
            allDates.forEach(d => { empSched[eid].days[d] = 'OFF'; });
          }
          if (jobFromShift && !empSched[eid].job) empSched[eid].job = jobFromShift;
          empSched[eid].days[s.shift_date] = `${fmtISO(s.start_time)}-${fmtISO(s.end_time)}`;
        });

        const planLines: string[] = [];
        for (const [, e] of Object.entries(empSched)) {
          const job = e.job ? ` (${e.job})` : '';
          const store = e.store ? ` [${e.store}]` : '';
          const days = allDates.map((d, i) => `${weekDays[i]}:${e.days[d]}`).join(' | ');
          planLines.push(`  ${e.name}${job}${store}: ${days}`);
        }

        const planOff = allDates.map((d, i) => {
          const day = weekDays[i];
          const offs = Object.values(empSched)
            .filter(e => e.days[d] === 'OFF')
            .map(e => e.job ? `${e.name} (${e.job})` : e.name);
          return offs.length > 0 ? `  ${day}: ${offs.join(', ')}` : `  ${day}: Todos trabajan`;
        }).join('\n');

        const published = rawShifts.filter((s: any) => s.status === 'published').length;
        sections.push(`📋 MÓDULO PLANIFICADOR ESTA SEMANA (${thisMonday} a ${thisSunday}):\nTotal turnos: ${rawShifts.length} | Publicados: ${published}\nNOTA: Los puestos (Cashier, Line Cook, etc.) vienen de Toast POS.\n\nHORARIO POR EMPLEADO:\n${planLines.join('\n')}\n\nDÍAS LIBRES (OFF):\n${planOff}`);
      }
    } catch (e) { console.warn('[TEG Assistant] Shifts fetch error:', e); }

    // ─── 14. Punch Violations ───
    try {
      const { data: violations } = await supabaseAdmin
        .from('punch_violations')
        .select('type, employee_name, store_id, violation_date')
        .gte('violation_date', thisMonday)
        .lte('violation_date', today);
      if (violations && violations.length > 0) {
        const byType: Record<string, number> = {};
        violations.forEach(v => { byType[v.type || 'otro'] = (byType[v.type || 'otro'] || 0) + 1; });
        const typeLine = Object.entries(byType).map(([t,c]) => `${t}: ${c}`).join(' | ');
        sections.push(`⚠️ VIOLACIONES LABORALES ESTA SEMANA: ${violations.length} total\nPor tipo: ${typeLine}`);
      }
    } catch (e) { /* table may not exist */ }

    // ─── 15. Customer Feedback / Google Reviews ───
    try {
      const { data: reviews } = await supabaseAdmin
        .from('customer_feedback')
        .select('store_name, rating, source, created_at')
        .gte('created_at', addDays(today, -30))
        .order('created_at', { ascending: false })
        .limit(50);
      if (reviews && reviews.length > 0) {
        const avgRating = (reviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / reviews.length).toFixed(1);
        const bySource: Record<string, number> = {};
        reviews.forEach(r => { bySource[r.source || 'google'] = (bySource[r.source || 'google'] || 0) + 1; });
        const srcLine = Object.entries(bySource).map(([s,c]) => `${s}: ${c}`).join(' | ');
        sections.push(`⭐ RESEÑAS CLIENTES (últimos 30 días): ${reviews.length} reseñas | Rating promedio: ${avgRating}★\nPor fuente: ${srcLine}`);
      }
    } catch (e) { /* table may not exist */ }

    // ─── 16. Discount Audit ───
    try {
      const { data: discounts } = await supabaseAdmin
        .from('discount_audit_log')
        .select('discount_name, store_name, discount_amount, business_date')
        .gte('business_date', thisMonday)
        .lte('business_date', today);
      if (discounts && discounts.length > 0) {
        const totalAmt = discounts.reduce((s, d) => s + (Math.abs(Number(d.discount_amount)) || 0), 0);
        const byType: Record<string, { count: number; amount: number }> = {};
        discounts.forEach(d => {
          const name = d.discount_name || 'Desconocido';
          if (!byType[name]) byType[name] = { count: 0, amount: 0 };
          byType[name].count++;
          byType[name].amount += Math.abs(Number(d.discount_amount)) || 0;
        });
        const topDiscounts = Object.entries(byType).sort((a,b) => b[1].amount - a[1].amount).slice(0, 8)
          .map(([name, v]) => `  ${name}: ${v.count}x (${fmt$(v.amount)})`).join('\n');
        sections.push(`🏷️ DESCUENTOS ESTA SEMANA: ${discounts.length} aplicados | Total: ${fmt$(totalAmt)}\nTop descuentos:\n${topDiscounts}`);
      }
    } catch (e) { /* table may not exist */ }

    // ─── 17. Internal Feedback (employee suggestions) ───
    try {
      const { data: feedback } = await supabaseAdmin
        .from('feedback')
        .select('id, category, status, created_at')
        .gte('created_at', addDays(today, -30))
        .order('created_at', { ascending: false });
      if (feedback && feedback.length > 0) {
        const pending = feedback.filter(f => (f.status || 'pendiente') === 'pendiente').length;
        const byCat: Record<string, number> = {};
        feedback.forEach(f => { byCat[f.category || 'general'] = (byCat[f.category || 'general'] || 0) + 1; });
        const catLine = Object.entries(byCat).map(([c,n]) => `${c}: ${n}`).join(' | ');
        sections.push(`💬 FEEDBACK INTERNO (30 días): ${feedback.length} total | Pendientes: ${pending}\nPor categoría: ${catLine}`);
      }
    } catch (e) { /* table may not exist */ }

    // ─── 18. Notifications (recent) ───
    try {
      const { count: notifCount } = await supabaseAdmin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', addDays(today, -7));
      if (notifCount && notifCount > 0) {
        sections.push(`🔔 NOTIFICACIONES (última semana): ${notifCount} enviadas`);
      }
    } catch (e) { /* silent */ }

    // ─── 19. Toast Jobs (positions) ───
    try {
      const { data: jobs } = await supabaseAdmin
        .from('toast_jobs')
        .select('guid, title');
      if (jobs && jobs.length > 0) {
        sections.push(`💼 PUESTOS DE TRABAJO (Toast): ${jobs.length} → ${jobs.map(j => j.title).join(', ')}`);
      }
    } catch (e) { /* silent */ }

    // ─── 20. Assistant Checklists ───
    try {
      const { count: asstCount } = await supabaseAdmin
        .from('assistant_checklists')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', addDays(today, -30));
      if (asstCount && asstCount > 0) {
        sections.push(`✅ CHECKLISTS ASISTENTES (30 días): ${asstCount} completados`);
      }
    } catch (e) { /* silent */ }

    // ─── 21. Manager Checklists ───
    try {
      const { count: mgrCount } = await supabaseAdmin
        .from('manager_checklists')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', addDays(today, -30));
      if (mgrCount && mgrCount > 0) {
        sections.push(`📝 CHECKLISTS MANAGERS (30 días): ${mgrCount} completados`);
      }
    } catch (e) { /* silent */ }

    // ─── 22. Inspection Comments ───
    try {
      const { count: commCount } = await supabaseAdmin
        .from('inspection_comments')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', addDays(today, -7));
      if (commCount && commCount > 0) {
        sections.push(`💬 COMENTARIOS DE INSPECCIONES (7 días): ${commCount} comentarios`);
      }
    } catch (e) { /* silent */ }

    // ─── 23. Inventory Items ───
    try {
      const { data: invItems } = await supabaseAdmin
        .from('inventory_items')
        .select('id, name, category, unit, cost_per_unit');
      if (invItems && invItems.length > 0) {
        const byCat: Record<string, number> = {};
        invItems.forEach(i => { byCat[i.category || 'sin categoría'] = (byCat[i.category || 'sin categoría'] || 0) + 1; });
        const catLine = Object.entries(byCat).sort((a,b) => b[1] - a[1]).map(([c,n]) => `${c}: ${n}`).join(' | ');
        sections.push(`📦 INVENTARIO INSUMOS: ${invItems.length} items registrados\nPor categoría: ${catLine}`);
      }
    } catch (e) { /* silent */ }

    // ─── 24. Recipes ───
    try {
      const { count: recipeCount } = await supabaseAdmin
        .from('recipes')
        .select('id', { count: 'exact', head: true });
      if (recipeCount && recipeCount > 0) {
        sections.push(`🍽️ RECETAS: ${recipeCount} recetas registradas`);
      }
    } catch (e) { /* silent */ }

    // ─── 25. Toast Menu Items ───
    try {
      const { count: menuCount } = await supabaseAdmin
        .from('toast_menu_items')
        .select('id', { count: 'exact', head: true });
      if (menuCount && menuCount > 0) {
        sections.push(`🍔 ITEMS MENÚ (Toast): ${menuCount} productos en catálogo`);
      }
    } catch (e) { /* silent */ }

    // ─── 26. Weekly Budgets ───
    try {
      const { data: budgets } = await supabaseAdmin
        .from('weekly_budgets')
        .select('store_id, week_start, target_labor_pct, target_sales')
        .gte('week_start', lastMonday)
        .order('week_start', { ascending: false })
        .limit(30);
      if (budgets && budgets.length > 0) {
        sections.push(`💰 PRESUPUESTOS SEMANALES: ${budgets.length} registros activos (desde ${lastMonday})`);
      }
    } catch (e) { /* silent */ }

    // ─── 27. Schedule Templates ───
    try {
      const { count: tmpCount } = await supabaseAdmin
        .from('schedule_templates')
        .select('id', { count: 'exact', head: true });
      if (tmpCount && tmpCount > 0) {
        sections.push(`📋 PLANTILLAS DE HORARIO: ${tmpCount} templates guardados`);
      }
    } catch (e) { /* silent */ }

    // ─── 28. Staff Evaluations ───
    try {
      const { data: evals } = await supabaseAdmin
        .from('staff_evaluations')
        .select('id, store_id, overall_rating, created_at')
        .gte('created_at', addDays(today, -30))
        .order('created_at', { ascending: false });
      if (evals && evals.length > 0) {
        const avgRating = (evals.reduce((s, e) => s + (Number(e.overall_rating) || 0), 0) / evals.length).toFixed(1);
        sections.push(`🌟 EVALUACIONES STAFF (30 días): ${evals.length} evaluaciones | Rating promedio: ${avgRating}/5`);
      }
    } catch (e) { /* silent */ }

    return '\n\n--- DATOS EN TIEMPO REAL DEL SISTEMA ---\n' + sections.join('\n\n');
  } catch (error) {
    console.error('[TEG Assistant] Context fetch error:', error);
    return '\n[Error obteniendo datos. Responde con información general.]';
  }
}

const BASE_SYSTEM_PROMPT = `Eres "TEG Assistant", el asistente virtual interno oficial y soporte técnico de SM TEG (Sistema de Management Tacos Gavilan).
Tu trabajo es ayudar a gerentes, asistentes y supervisores a usar la plataforma, resolver dudas operativas y guiar paso a paso.

TONO: Profesional, amable, conciso, bilingüe (responde en el idioma que te hablen).
FORMATO: Usa tablas markdown, listas, negritas (**), y emojis para claridad. No des respuestas excesivamente largas.

MÓDULOS DEL SISTEMA:
1. VENTAS Y REPORTES: Net Sales desde Toast POS. "6 AM Rule" (día laboral: 6AM - 5:59AM siguiente). Canales: Uber Eats, DoorDash, EBT.
2. INSPECCIONES/CHECKLISTS: Auditorías de calidad por supervisores. Puntaje, estatus (pendiente/aprobado/rechazado), desglose por tienda y supervisor.
3. PLANIFICADOR LABORAL: Turnos semanales, Smart-Hybrid forecasting, drag & drop, templates.
4. LABOR/PUNCHES: Registros de entrada/salida (Toast), horas trabajadas, overtime, violaciones laborales.
5. EMPLEADOS: Roster completo de Toast, distribución por tienda, puestos de trabajo.
6. TABLERO OPERATIVO (Roles): Asignar estaciones (Cashier, Cocina, Drive Thru). "Modo Inmersivo" para monitores.
7. AUDITORÍA DESCUENTOS: Radar de anomalías, tipos de descuento, montos, frecuencia.
8. INVENTARIO Y COSTOS: Food Cost, insumos, catálogos de menú, preparador.
9. FEEDBACK: Comentarios internos de empleados y sugerencias.
10. RESEÑAS CLIENTES: Google Reviews, ratings promedio, tendencias.
11. DESCANSOS (AI): Breaks automáticos con California labor law (10 min rest, 30 min meal antes 5ta hora).
12. NOTIFICACIONES: Alertas del sistema, comentarios de inspección, actualizaciones.
13. CONFIGURACIÓN: Perfil, contraseña, tiendas, preferencias.

DATOS EN TIEMPO REAL QUE TIENES ACCESO:
- Ventas: Hoy, ayer, esta semana, semana pasada, mes actual, mes anterior. Desglose por tienda, canal (Uber/DD), labor cost %. 
- Inspecciones: Esta semana y semana pasada. Conteo por supervisor, por tienda, promedio de puntaje, estatus.
- Empleados: Total activos, distribución por tienda, puestos de trabajo disponibles.
- Labor: Punches de esta semana, horas totales, overtime, empleados únicos.
- Horarios/Turnos: DETALLE COMPLETO por empleado incluyendo nombre, puesto, tienda, y horario día por día (Lun-Dom). Incluye quién tiene OFF cada día. SIEMPRE responde con nombres completos, NUNCA con IDs.
- Violaciones laborales: Tipo y frecuencia semanal.
- Reseñas de clientes: Últimos 30 días, rating promedio, fuentes.
- Descuentos: Tipos, montos, frecuencia semanal.
- Feedback interno: Últimos 30 días, categorías, pendientes.
- Notificaciones: Conteo semanal.
- Usuarios: Total registrados, desglose por rol.
- Tiendas: Listado completo de ubicaciones activas.
- Checklists: Asistentes y Managers completados (30 días). Comentarios de inspección (7 días).
- Inventario: Items registrados por categoría. Recetas. Menú de Toast (catálogo completo).
- Presupuestos: Semanales por tienda (target labor %, target sales).
- Evaluaciones Staff: Rating promedio, cantidad (30 días).

REGLAS CRÍTICAS:
- SIEMPRE que tengas datos reales del sistema, ÚSALOS. Da cifras exactas, porcentajes, y nombres de tiendas.
- NUNCA digas "no tengo acceso a esos datos" si los datos están en tu contexto. Búscalos primero.
- Si el día de hoy muestra $0, explica que el día está en curso y los datos se actualizan en tiempo real desde Toast.
- Cuando compares períodos, muestra la diferencia en valores absolutos Y porcentaje.
- Para tablas de datos, usa formato markdown con encabezados claros.
- Eres parte exclusiva de Tacos Gavilan.`;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'Falta la API Key de Gemini.' }, { status: 500 });

    const { messages, language } = await req.json();
    if (!messages || !Array.isArray(messages)) return NextResponse.json({ error: 'Formato inválido.' }, { status: 400 });

    // Fetch live context
    const liveContext = await fetchSystemContext();
    
    // Enforce language
    const langInstruction = language === 'en' 
      ? "\n\nCRITICAL INSTRUCTION: The user is using the ENGLISH interface. YOU MUST REPLY COMPLETELY IN ENGLISH. DO NOT USE SPANISH."
      : "\n\nINSTRUCCIÓN CRÍTICA: El usuario está usando la interfaz en ESPAÑOL. DEBES RESPONDER COMPLETAMENTE EN ESPAÑOL.";

    const fullPrompt = BASE_SYSTEM_PROMPT + langInstruction + liveContext;

    // Normalize history: Gemini API strictly requires alternating user/model turns, and must start with a user.
    const validContents: { role: string; parts: { text: string }[] }[] = [];
    let lastRole = '';

    messages.forEach((msg: any) => {
      if (msg.role !== 'user' && msg.role !== 'model') return;
      
      // Filter out internal system messages that confuse the AI's memory
      if (msg.role === 'model' && (msg.content.includes('Soy TEG Assistant') || msg.content.includes('Error de conexión') || msg.content.includes('Todos los modelos'))) return;

      if (msg.role === lastRole && validContents.length > 0) {
        // Group consecutive messages from the same role to maintain strict alternation
        validContents[validContents.length - 1].parts[0].text += '\n\n' + msg.content;
      } else {
        validContents.push({ role: msg.role, parts: [{ text: msg.content }] });
        lastRole = msg.role;
      }
    });

    // API requirement: History MUST start with a 'user' message
    if (validContents.length > 0 && validContents[0].role === 'model') {
      validContents.shift();
    }

    if (validContents.length === 0) return NextResponse.json({ error: 'Sin mensajes.' }, { status: 400 });

    // ─── Single direct call to Gemini (no retries, fail fast) ───
    const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    console.log(`[TEG Assistant] Calling ${GEMINI_MODEL}...`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: fullPrompt }] },
        contents: validContents,
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096 }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.error?.message || 'Error desconocido';
      console.warn(`[TEG Assistant] ${GEMINI_MODEL} failed (${response.status}): ${errMsg}`);
      if (response.status === 429) {
        return NextResponse.json({ 
          error: 'La IA tiene mucho tráfico en este momento. Espera unos segundos y vuelve a intentar.' 
        }, { status: 429 });
      }
      return NextResponse.json({ error: errMsg }, { status: response.status });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!reply) {
      return NextResponse.json({ error: 'La IA no generó respuesta. Intenta de nuevo.' }, { status: 500 });
    }

    console.log(`[TEG Assistant] ✅ OK`);
    return NextResponse.json({ reply });
  } catch (error: any) {
    console.error('[TEG Assistant] Error:', error);
    return NextResponse.json({ error: 'Error inesperado.', details: error.message }, { status: 500 });
  }
}
