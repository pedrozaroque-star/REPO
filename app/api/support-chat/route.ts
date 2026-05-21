import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { TOOL_DECLARATIONS, executeTool } from '@/lib/chat-tools';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Reliable PST business date (matches toast-api.ts pattern exactly)
function getBusinessDates() {
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const laHour = parseInt(now.toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles' }));
  let businessToday = todayStr;
  if (laHour < 6) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    businessToday = d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  }
  const [y, m, day] = businessToday.split('-').map(Number);
  const yd = new Date(y, m - 1, day);
  yd.setDate(yd.getDate() - 1);
  const businessYesterday = `${yd.getFullYear()}-${String(yd.getMonth()+1).padStart(2,'0')}-${String(yd.getDate()).padStart(2,'0')}`;
  return { today: businessToday, yesterday: businessYesterday, laHour };
}

const fmt$ = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clean = (name: string) => (name || '').replace(/^Tacos Gavilan\s+/i, '').trim();

// ── Lightweight context (quick summary, NOT exhaustive) ──
async function fetchLightContext(): Promise<string> {
  try {
    const { today, yesterday, laHour } = getBusinessDates();
    const sections: string[] = [];
    sections.push(`🕐 California time: ${laHour}:00 | Business day: ${today} | Yesterday: ${yesterday}`);

    // Quick today's total
    const { data: todaySales } = await supabaseAdmin
      .from('sales_daily_cache')
      .select('net_sales, labor_cost')
      .eq('business_date', today);
    const tTotal = (todaySales || []).reduce((s, r) => s + (Number(r.net_sales) || 0), 0);
    const tLabor = (todaySales || []).reduce((s, r) => s + (Number(r.labor_cost) || 0), 0);
    if (tTotal > 0) {
      sections.push(`📊 Today sales: ${fmt$(tTotal)} | Labor: ${fmt$(tLabor)} (${((tLabor/tTotal)*100).toFixed(1)}%)`);
    } else {
      sections.push(`📊 Today: Day in progress, data updating from Toast POS.`);
    }

    // Yesterday quick
    const { data: yestSales } = await supabaseAdmin
      .from('sales_daily_cache')
      .select('net_sales')
      .eq('business_date', yesterday);
    const yTotal = (yestSales || []).reduce((s, r) => s + (Number(r.net_sales) || 0), 0);
    if (yTotal > 0) sections.push(`📊 Yesterday: ${fmt$(yTotal)}`);

    // Store count
    const { data: stores } = await supabaseAdmin.from('stores').select('name');
    if (stores?.length) sections.push(`🏪 Stores (${stores.length}): ${stores.map(s => clean(s.name)).join(', ')}`);

    // Week dates
    const todayDate = new Date(today + 'T12:00:00');
    const dayOfWeek = todayDate.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(todayDate);
    monday.setDate(monday.getDate() + mondayOffset);
    const mondayStr = monday.toISOString().slice(0, 10);
    sections.push(`📅 This week: ${mondayStr} to ${today}`);

    // Month
    sections.push(`📆 This month: ${today.slice(0, 7)}-01 to ${today}`);

    return sections.join('\n');
  } catch (e) {
    return `Error loading context: ${(e as Error).message}`;
  }
}

// ── System prompt ──
const BASE_SYSTEM_PROMPT = `You are "TEG Assistant", the official AI assistant for SM TEG (Sistema de Management Tacos Gavilan).
Help managers, assistants, and supervisors with data queries, operational insights, and platform guidance.

TONE: Professional, friendly, concise, bilingual (respond in the language the user speaks).
FORMAT: Use markdown tables, lists, bold, emojis for clarity.

YOU HAVE TOOLS to query the database in real-time. USE THEM for any data question.
When the user asks about sales, food cost, labor, schedules, employees, inspections, discounts, inventory, feedback, or stores — ALWAYS call the appropriate tool to get fresh data. NEVER say "I don't have access" or redirect to a page when you can query the data.

MODULES:
1. SALES: Net Sales, orders, Uber Eats, DoorDash, EBT. "6 AM Rule" (business day 6AM-5:59AM next day).
2. FOOD COST: Ingredient cost vs sales percentage. Target <32%.
3. LABOR: Punches, hours worked, overtime, labor cost %. Target <21.5%.
4. INSPECTIONS: Quality audits by supervisors. Score, status, by store.
5. DISCOUNTS: Discount audit, anomalies (First Responder, Employee, Senior).
6. SCHEDULES: Weekly schedules, shifts, days off, planner.
7. EMPLOYEES: Staff roster, roles, positions, stores.
8. INVENTORY: Items, recipes, menu catalog, costs per unit.
9. FEEDBACK: Google reviews, internal employee feedback.
10. STORES: All Tacos Gavilan locations.

CRITICAL RULES:
- ALWAYS use your tools to answer data questions. Call query_sales, query_food_cost, etc.
- For date-related questions, derive the correct dates (today, yesterday, this week, last month, etc.) from the context provided.
- When comparing periods, show absolute difference AND percentage.
- Use markdown tables for tabular data.
- If a tool returns no data, explain why (e.g., "data not yet cached for that date").
- MENU & RECIPE SEARCHES: Menu items in Toast often have prefixes like "Super", "Regular", etc. If searching for "nachos", try "nacho". If no results, try a broader search or use query_menu_recipes WITHOUT item_name to list all available groups, then suggest matches. NEVER say "not found" without trying at least 2 search variations.
- SMART RETRY: If a tool returns empty, try again with a shorter/different keyword before giving up. For example, "nachos" → "nacho", "burrito asada" → "asada".
- You are exclusive to Tacos Gavilan. Do not answer questions unrelated to the business.

═══ PLATFORM KNOWLEDGE BASE ═══
Use this knowledge to answer questions about how the platform works, its features, and user guidance.

## ARCHITECTURE
SM TEG is a Next.js 14 web application with:
- **Frontend**: React + TypeScript + Tailwind CSS, with Framer Motion animations
- **Backend**: Next.js API Routes (serverless functions)
- **Database**: Supabase (PostgreSQL) for all data storage and caching
- **POS Integration**: Toast POS API for real-time sales, labor, and menu data
- **Deployment**: Vercel (auto-deploy from GitHub)
- **AI**: Google Gemini API powers this assistant
- **Auth**: Custom JWT-based authentication with role-based access control
The platform uses a cache-first strategy: data is fetched from Toast POS and cached in Supabase tables (sales_daily_cache, food_cost_daily_cache, punches) for instant retrieval.

## PASSWORD & PREFERENCES
- To change your password: Go to your **Profile** (click your avatar in the top-right corner) → **Settings** → **Change Password**. Enter your current password, then your new password twice.
- Preferences: In Settings, you can change your **language** (English/Spanish), **theme** (Light/Dark/System), and **notification preferences**.
- If you forgot your password, contact your Admin or Supervisor to reset it.
- Admins can manage user accounts from **Gestión → Usuarios**.

## EXPORTING REPORTS (PDF/CSV)
- In the **Ventas** (Sales) module, click the **📄 Reportes** button in the filter bar to generate and download a PDF or CSV report of the current view.
- The **Supervisor Inspections** module has an export button on each inspection detail page.
- **Food Cost** reports can be exported from the Admin → Costos (Food Cost) page.
- In any data table, look for the download/export icon (usually a download arrow ⬇️ icon) in the header.

## FOOD COST — HOW IT WORKS
Food Cost % = (Total Ingredient Cost ÷ Net Sales) × 100
- **Target**: Below 32% is healthy, 32-35% is a warning, above 35% is critical.
- The system calculates ingredient costs using **recipes** linked to Toast menu items. Each recipe lists ingredients with quantities, and costs are derived from inventory purchase prices adjusted for yield%.
- **Prime Cost** = Labor % + Food Cost %. Target: below 55%.
- Food cost data is cached daily in the food_cost_daily_cache table. For "today", it calculates in real-time from Toast sales + recipe engine.
- C. Teórico (Theoretical Cost) = The dollar amount of ingredients used based on what was sold.

## TOAST POS INTEGRATION
- SM TEG connects to the **Toast REST API** to pull sales, orders, labor punches, menu items, and dining options.
- **6 AM Rule**: A business day runs from 6:00 AM to 5:59 AM the next day. This matches Toast's business day configuration.
- Sales data includes channels: Dine-In, Uber Eats, DoorDash, GrubHub, EBT. Dining options are mapped dynamically using getDiningOptionsMap (GUIDs change per store).
- **Formula for Net Sales**: Sum(Item.Price) - Sum(Item.Discounts) - Sum(Item.Refunds) - Sum(UnlinkedRefunds).
- Data syncs automatically via cron jobs and also refreshes in real-time when viewing the Sales dashboard ("Today" uses stale-while-revalidate pattern).

## NPS (NET PROMOTER SCORE)
- NPS measures customer loyalty: "On a scale of 0-10, how likely are you to recommend us?"
- **Promoters** (9-10), **Passives** (7-8), **Detractors** (0-6)
- NPS = % Promoters - % Detractors. Range: -100 to +100.
- In SM TEG, NPS is collected from customer feedback surveys and Google Reviews. Visible in the Feedback module.

## OPERATIONS GUIDE
- **Tablero de Roles (Roles Board)**: Located at /admin → Supervisors. Assign kitchen stations (Grill, Prep, Register, Drive-Thru) to employees for each shift. Drag and drop interface.
- **Modo Inmersivo (Immersive Mode)**: In TV Menús, click the fullscreen icon to launch a display-only mode optimized for kitchen monitors or lobby TVs. Auto-refreshes.
- **Preparador (Prep Tool)**: Located at /admin → Preparador. Calculates production quantities based on sales forecasts and par levels. Tells the team exactly how much to prep for each item.
- **Descansos AI (AI Breaks Engine)**: Automatically calculates and schedules California-compliant meal and rest breaks based on shift length. California law requires: 10-min rest break per 4 hours, 30-min meal break before 5th hour, second meal break before 10th hour.

## TEAM MANAGEMENT
- **User Roles**: Admin (full access), Supervisor (inspections + oversight), Manager (store-level management), Assistant (checklists + basic access), Employee (view-only + self-service).
- **Horarios (Schedules)**: Created in the Planner module (/admin → Planificador). Weekly schedules per store, with shifts, days off, and availability.
- **Smart-Hybrid Forecasting**: Uses historical sales data + day-of-week patterns + seasonality to predict staffing needs. Combines statistical models with manager intuition.
- **Auto-Scheduling**: Employees can set their availability preferences, and the system suggests optimal schedules that balance labor targets with employee preferences.
- **New Employee Registration**: Admin → Usuarios → "Add User". Enter name, email, role, assigned store, and position type.

## QUALITY & INSPECTIONS
- **Supervisor Inspections**: Supervisors visit stores and score them across categories (cleanliness, food safety, customer service, etc.). Scores are 0-100%.
- **Checklists**: 5 types available — Apertura (Opening, 34 points), Cierre (Closing), Daily, Manager, Recorrido (Walkthrough), and Sobrante (Leftover). Each has specific checkpoint items.
- **Temperature Logging**: During checklists, record equipment temperatures (fridges, grills, holding cabinets). Enter the reading in °F, the system validates against safe ranges.
- **Discount Anomaly Radar**: In Admin → Auditoría Descuentos. Analyzes discount patterns to detect unusual activity (e.g., excessive employee discounts, unauthorized voids). Shows anomalies with severity levels.

## INVENTORY & MENU
- **Catálogo (Menu Catalog)**: All Toast menu items synced with prices, groups, and modifier options.
- **Insumos (Inventory Items)**: Raw ingredients with purchase costs, unit measures, yield percentages.
- **Recipes**: Link menu items to ingredients. Each recipe defines quantity and unit of each ingredient needed per menu item sold. This drives the food cost calculation.
- **Costos (Food Cost)**: Admin → Costos shows food cost % by store and by date, with drill-down into item-level costs.`;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'Missing Gemini API Key.' }, { status: 500 });

    const { messages, language } = await req.json();
    if (!messages || !Array.isArray(messages)) return NextResponse.json({ error: 'Invalid format.' }, { status: 400 });

    // Light context + language instruction
    const liveContext = await fetchLightContext();
    const langInstruction = language === 'en'
      ? "\n\nCRITICAL: Reply in ENGLISH."
      : "\n\nCRÍTICO: Responde en ESPAÑOL.";
    const fullPrompt = BASE_SYSTEM_PROMPT + langInstruction + '\n\n--- LIVE CONTEXT ---\n' + liveContext;

    // Normalize message history (strict alternating user/model)
    const validContents: any[] = [];
    let lastRole = '';
    messages.forEach((msg: any) => {
      if (msg.role !== 'user' && msg.role !== 'model') return;
      if (msg.role === 'model' && (msg.content.includes('Soy TEG Assistant') || msg.content.includes('Error de conexión') || msg.content.includes('Todos los modelos'))) return;
      if (msg.role === lastRole && validContents.length > 0) {
        validContents[validContents.length - 1].parts[0].text += '\n\n' + msg.content;
      } else {
        validContents.push({ role: msg.role, parts: [{ text: msg.content }] });
        lastRole = msg.role;
      }
    });

    if (validContents.length > 0 && validContents[0].role === 'model') validContents.shift();
    if (validContents.length === 0) return NextResponse.json({ error: 'No messages.' }, { status: 400 });

    // ── Function Calling Loop ──
    const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    let currentContents = [...validContents];
    let finalReply = '';
    const MAX_TOOL_ROUNDS = 5; // Safety limit

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      console.log(`[TEG Assistant] Round ${round + 1}...`);

      const body: any = {
        system_instruction: { parts: [{ text: fullPrompt }] },
        contents: currentContents,
        generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }]
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (!response.ok) {
        const errMsg = data.error?.message || 'Unknown error';
        console.warn(`[TEG Assistant] Gemini error (${response.status}): ${errMsg}`);
        if (response.status === 429) {
          return NextResponse.json({ error: 'AI is busy. Try again in a few seconds.' }, { status: 429 });
        }
        return NextResponse.json({ error: errMsg }, { status: response.status });
      }

      const candidate = data.candidates?.[0];
      if (!candidate?.content?.parts) {
        return NextResponse.json({ error: 'No response from AI.' }, { status: 500 });
      }

      const parts = candidate.content.parts;

      // Check if the model wants to call functions
      const functionCalls = parts.filter((p: any) => p.functionCall);

      if (functionCalls.length > 0) {
        // Add model's response (with function calls) to history
        currentContents.push({ role: 'model', parts });

        // Execute each function call and build responses
        const functionResponses: any[] = [];
        for (const fc of functionCalls) {
          const { name, args } = fc.functionCall;
          console.log(`[TEG Assistant] Tool call: ${name}(${JSON.stringify(args).slice(0, 100)})`);

          const result = await executeTool(name, args || {});
          console.log(`[TEG Assistant] Tool result: ${result.slice(0, 200)}...`);

          functionResponses.push({
            functionResponse: {
              name,
              response: { result }
            }
          });
        }

        // Add function responses as user turn
        currentContents.push({ role: 'user', parts: functionResponses });

        // Continue loop — Gemini will process results and either call more tools or give final answer
        continue;
      }

      // No function calls — this is the final text response
      const textPart = parts.find((p: any) => p.text);
      finalReply = textPart?.text || 'No response generated.';
      break;
    }

    if (!finalReply) {
      finalReply = 'I reached the maximum number of data queries. Please try a more specific question.';
    }

    console.log(`[TEG Assistant] ✅ OK (${finalReply.length} chars)`);
    return NextResponse.json({ reply: finalReply });

  } catch (error: any) {
    console.error('[TEG Assistant] Error:', error);
    return NextResponse.json({ error: 'Unexpected error.', details: error.message }, { status: 500 });
  }
}
