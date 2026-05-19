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
- You are exclusive to Tacos Gavilan. Do not answer questions unrelated to the business.`;

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
