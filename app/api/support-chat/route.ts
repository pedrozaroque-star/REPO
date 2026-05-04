import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Model fallback chain: highly resilient list of known-good aliases
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-flash-latest',
  'gemini-pro-latest'
];
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

    // ─── 10. Recent inspections ───
    const { data: inspections } = await supabaseAdmin
      .from('inspecciones')
      .select('tienda_nombre, puntaje_total, created_at')
      .order('created_at', { ascending: false })
      .limit(3);
    if (inspections && inspections.length > 0) {
      const lines = inspections.map(i => `  ${clean(i.tienda_nombre)}: ${i.puntaje_total}% (${new Date(i.created_at).toLocaleDateString('es')})`).join('\n');
      sections.push(`📋 ÚLTIMAS INSPECCIONES:\n${lines}`);
    }

    return '\n\n--- DATOS EN TIEMPO REAL DEL SISTEMA ---\n' + sections.join('\n\n');
  } catch (error) {
    console.error('[TEG Assistant] Context fetch error:', error);
    return '\n[Error obteniendo datos. Responde con información general.]';
  }
}

const BASE_SYSTEM_PROMPT = `Eres "TEG Assistant", el asistente virtual interno oficial y soporte técnico de SM TEG (Sistema de Management Tacos Gavilan).
Tu trabajo es ayudar a gerentes, asistentes y supervisores a usar la plataforma, resolver dudas operativas y guiar paso a paso.

TONO: Profesional, amable, conciso, bilingüe (responde en el idioma que te hablen).
FORMATO: Usa listas, negritas (**), y emojis para claridad. No des respuestas excesivamente largas.

MÓDULOS:
1. TABLERO OPERATIVO (Roles): Asignar estaciones (Cashier, Cocina, Drive Thru). "Modo Inmersivo" para monitores.
2. VENTAS Y REPORTES: Net Sales desde Toast POS. "6 AM Rule" (día laboral: 6AM - 5:59AM siguiente).
3. PLANIFICADOR: Schedules semanales con Smart-Hybrid forecasting.
4. AUDITORÍA DESCUENTOS: Radar de anomalías para detectar fraudes.
5. INSPECCIONES/CHECKLISTS: Auditorías de calidad, temperaturas, limpieza.
6. INVENTARIO Y COSTOS: Food Cost, insumos, catálogos.
7. CONFIGURACIÓN: Perfil, contraseña, preferencias.
8. DESCANSOS (AI): Breaks automáticos con California labor law (10 min rest, 30 min meal antes 5ta hora).

REGLAS CRÍTICAS:
- SIEMPRE que tengas datos reales del sistema, ÚSALOS. Da cifras exactas, porcentajes, y nombres de tiendas.
- Si el día de hoy muestra $0, explica que el día está en curso y los datos se actualizan en tiempo real desde Toast.
- Cuando compares días, muestra la diferencia en $ y en %.
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

    // Try models in fallback chain
    let lastError = '';
    for (const model of GEMINI_MODELS) {
      try {
        const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;
        console.log(`[TEG Assistant] Trying model: ${model}`);
        
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: fullPrompt }] },
            contents: validContents,
            generationConfig: { temperature: 0.3, maxOutputTokens: 1500 }
          })
        });

        const data = await response.json();
        
        if (!response.ok) {
          const errMsg = data.error?.message || 'Error desconocido';
          console.warn(`[TEG Assistant] ${model} failed (${response.status}): ${errMsg}`);
          lastError = errMsg;
          // Continue to the next model regardless of the error type (404, 429, 500, etc.)
          // This ensures maximum resilience if a model name is deprecated or temporarily unavailable.
          continue;
        }

        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!reply) { lastError = 'Sin respuesta'; continue; }

        console.log(`[TEG Assistant] ✅ Success with ${model}`);
        return NextResponse.json({ reply });
      } catch (e: any) {
        console.warn(`[TEG Assistant] ${model} exception:`, e.message);
        lastError = e.message;
        continue;
      }
    }

    // All models failed
    return NextResponse.json({ error: `Todos los modelos están sobrecargados. ${lastError}` }, { status: 429 });
  } catch (error: any) {
    console.error('[TEG Assistant] Error:', error);
    return NextResponse.json({ error: 'Error inesperado.', details: error.message }, { status: 500 });
  }
}
