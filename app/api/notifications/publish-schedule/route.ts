
/**
 * @module PublishScheduleAPI
 * @description API endpoint to publish weekly employee schedules, send email notifications, and auto-resolve breaks and activities.
 * @businessRules
 * - Resolves daily tasks dynamically from the global `position_activities` configuration.
 * - Auto-detects store model type (Regular vs DriveThru) based on weekly assignments.
 * - Handles shifts and break calculations.
 * @dataFlow
 * - Reads from `shifts`, `toast_employees`, `station_assignments`, and `position_activities`.
 * - Updates shifts in database and sends email notifications.
 * @notes
 * - Employs resolvePositionKey helper to dynamically map any employee and station combination to a standard position key.
 * - Resolves roles and activities from Toast job title directly when no manual station assignment is configured.
 * - Integrates robust store model auto-detection checking store name as a fallback for Drive-Thru.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import path from 'path'
import fs from 'fs'
import { generateSmartForecast } from '@/lib/intelligence'
import { scheduleBreaksWithDemand } from '@/lib/breaks-engine'
import {
    generateScheduleICS,
    buildGoogleCalendarUrl,
    buildCalendarApiUrl,
    CalendarStoreInfo,
    CalendarShiftItem
} from '@/lib/calendar-helper'

// Helper to translate employee job + station group to the 6 standard roles
function resolvePositionKey(jobTitle: string, stationName?: string, stationGroup?: string): string {
  const title = (jobTitle || '').toLowerCase();
  
  if (title.includes('manager') && !title.includes('asst') && !title.includes('assist') && !title.includes('asistente') && !title.includes('shift')) {
    return 'MANAGER';
  }
  
  if (title.includes('asst') || title.includes('assist') || title.includes('asistente')) {
    return 'ASSISTANT';
  }
  
  if (title.includes('shift') || title.includes('leader') || title.includes('encargado')) {
    const group = (stationGroup || '').toLowerCase();
    const station = (stationName || '').toLowerCase();
    const isKitchen = group === 'kitchen' || ['burritos', 'tortillas', 'tacos', 'carnes', 'preparacion', 'cubrir descansos (cocina)'].some(s => station.includes(s));
    return isKitchen ? 'SHIFT_LEADER_MALE' : 'SHIFT_LEADER_FEMALE';
  }
  
  if (title.includes('cook') || title.includes('cocinero') || title.includes('prep') || title.includes('preparador') || title.includes('taquero') || title.includes('tortill')) {
    return 'COOK_MALE';
  }
  
  if (title.includes('cashier') || title.includes('cajera') || title.includes('cajero')) {
    return 'CASHIER';
  }
  
  const group = (stationGroup || '').toLowerCase();
  if (group === 'kitchen') {
    return 'COOK_MALE';
  }
  return 'CASHIER';
}

function normalizeText(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

const STATION_BACKUPS: Record<string, string[]> = {
  // Kitchen
  'BURRITOS': ['TACOS', 'CARNES', 'TORTAS/QUESADILLAS', 'PREPARACION'],
  'TORTILLAS': ['TACOS', 'CARNES', 'BURRITOS', 'PREPARACION'],
  'TORTAS/QUESADILLAS': ['TORTAS/MULITAS', 'TACOS', 'CARNES'],
  'TORTAS/MULITAS': ['TORTAS/QUESADILLAS', 'TACOS', 'CARNES'],
  'TACOS': ['CARNES', 'BURRITOS', 'TORTAS/QUESADILLAS', 'PREPARACION'],
  'CARNES': ['TACOS', 'BURRITOS', 'TORTAS/QUESADILLAS', 'PREPARACION'],
  'PREPARACION': ['CARNES', 'TACOS', 'BURRITOS'],
  'CUBRIR DESCANSOS (COCINA)': ['TACOS', 'CARNES'],

  // Drive-Thru support
  'TORTAS/QUESADILLAS (DT)': ['TORTAS/QUESADILLAS', 'TACOS/BURRITOS (DT)'],
  'TACOS/BURRITOS (DT)': ['TACOS', 'BURRITOS', 'TORTAS/QUESADILLAS (DT)'],
  'CUBRIR DESCANSOS (DT)': ['CUBRIR DESCANSOS (COCINA)', 'CUBRIR DESCANSOS (SALÓN)'],

  // Front / Salon
  'Ventana 1': ['Ventana 2', 'Ventana 2 (B)', 'Caja 1 / Salón', 'ENTREGA'],
  'Ventana 2': ['Ventana 1', 'Ventana 2 (B)', 'Caja 1 / Salón', 'ENTREGA'],
  'Ventana 2 (B)': ['Ventana 2', 'Ventana 1', 'Caja 1 / Salón', 'ENTREGA'],
  'Caja 1 / Salón': ['Caja 2', 'Caja 3', 'Ventana 1', 'Uber + Salsas'],
  'Caja 2': ['Caja 1 / Salón', 'Caja 3', 'Uber + Salsas'],
  'Caja 3': ['Caja 2', 'Caja 1 / Salón', 'Uber + Salsas'],
  'Caja 4': ['Caja 3', 'Caja 2', 'Caja 1 / Salón'],
  'Caja 5': ['Caja 4', 'Caja 3', 'Caja 2'],
  'Uber + Salsas': ['Caja 1 / Salón', 'Caja 2', 'ENTREGA'],
  'ENTREGA': ['Uber + Salsas', 'Caja 1 / Salón', 'Ventana 1'],
  'LIMPIEZA': ['Caja 1 / Salón', 'Caja 2', 'Uber + Salsas'],
  'CUBRIR DESCANSOS (SALÓN)': ['Caja 1 / Salón', 'Ventana 1']
};

// Initialize clients
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
const supabase = createClient(supabaseUrl, supabaseKey)


// Función para obtener transporte (ESTRICTO: Solo OAuth por Usuario)
async function getTransporter(userId?: string) {
    if (!userId) {
        throw new Error('Usuario no identificado. No se pueden enviar correos anónimos.')
    }

    // DEBUG: Check Service Role Key presence (Safe log)
    const isServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY
    console.log('🔍 [API] Fetching creds for:', userId, 'Using ServiceKey:', isServiceKey)

    // 1. Intentar obtener credenciales OAuth del usuario
    const { data: user, error } = await supabase.from('users')
        .select('google_refresh_token, google_email_connected')
        .eq('id', userId)
        .single()

    if (error) {
        console.error('❌ [API] DB Error fetching user:', error)
    }

    // AUTO-HEALING: If user not found in public.users but exists in auth.users, create it.
    if (!user) {
        console.warn('⚠️ [API] User record missing in public.users. Checking auth.users...')
        // We can't query auth.users directly via client easily without service role admin magic 
        // OR we just fail here because if public.users is empty, they haven't run the OAuth flow correctly anyway.
        // But let's log explicitly.
    }

    if (user?.google_refresh_token && user?.google_email_connected) {
        console.log(`✅ [API] Found OAuth2 for user ${user.google_email_connected}`)

        // MANUAL TOKEN REFRESH (To fix 535 errors)
        try {
            const tokenUrl = 'https://oauth2.googleapis.com/token'
            const params = new URLSearchParams()
            params.append('client_id', process.env.GOOGLE_CLIENT_ID!)
            params.append('client_secret', process.env.GOOGLE_CLIENT_SECRET!)
            params.append('refresh_token', user.google_refresh_token)
            params.append('grant_type', 'refresh_token')

            console.log('🔄 [API] Refreshing Access Token manually...')
            const refreshRes = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params
            })

            if (!refreshRes.ok) {
                const errData = await refreshRes.json()
                console.error('❌ [API] Failed to refresh token:', errData)
                throw new Error(`Token Refresh Failed: ${errData.error_description || errData.error}`)
            }

            const tokens = await refreshRes.json()
            const accessToken = tokens.access_token
            console.log('✅ [API] Access Token refreshed successfully!')

            // FETCH REAL USER PROFILE (To ensure 'user' matches the token owner)
            const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` }
            })
            const profile = await profileRes.json()
            const realEmail = profile.email
            console.log(`✅ [API] Authenticated as Google User: ${realEmail} (Expected: ${user.google_email_connected})`)

            return {
                accessToken, // EXPOSE TOKEN
                fromEmail: realEmail
            }
        } catch (e) {
            console.error('❌ [API] Critical Auth Error during refresh:', e)
            throw new Error('GMAIL_AUTH_FAILED: ' + (e as Error).message)
        }
    } else {
        console.warn('⚠️ [API] User found but missing tokens:', JSON.stringify(user))
    }

    // SI LLEGAMOS AQUI: El usuario no tiene credenciales conectadas.
    // YA NO HACEMOS FALLBACK a la cuenta global por seguridad y política de empresa.
    throw new Error('GMAIL_NOT_CONNECTED')
}

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { store_id, start_date, end_date, sender_user_id } = body

        if (!store_id || !start_date || !end_date) {
            return NextResponse.json({ error: 'Missing required fields: store_id, start_date, end_date' }, { status: 400 })
        }

        // 1. Init Credentials
        let accessToken;
        let fromEmail;

        let fallbackUsed = false;

        try {
            const creds = await getTransporter(sender_user_id)
            accessToken = creds.accessToken
            fromEmail = creds.fromEmail
        } catch (error: any) {
            console.warn(`⚠️ [API] Falló la cuenta principal (${error.message}). Intentando fallback a carlos@tacosgavilan.com de emergencia.`)
            const { data: carlosUser } = await supabase.from('users').select('id').eq('email', 'carlos@tacosgavilan.com').single()
            
            if (carlosUser) {
                try {
                    const fallbackCreds = await getTransporter(carlosUser.id)
                    accessToken = fallbackCreds.accessToken
                    fromEmail = fallbackCreds.fromEmail
                    fallbackUsed = true;
                    console.log(`✅ [API] Fallback exitoso. Usando cuenta de Carlos: ${fromEmail}`)

                    // Invalidate manager's account so they are forced to reconnect next time
                    if (sender_user_id && sender_user_id !== carlosUser.id) {
                        console.log(`🧹 [API] Limpiando credenciales caducadas del manager: ${sender_user_id}`)
                        await supabase.from('users').update({ google_email_connected: null, google_refresh_token: null }).eq('id', sender_user_id)
                    }

                } catch (fallbackError) {
                    console.error('❌ [API] Fallback también falló.', fallbackError)
                    throw error // Lanza el error original para que la UI reaccione correctamente
                }
            } else {
                throw error
            }
        }

        // 2. Fetch Published Shifts
        // FIX RACE CONDITION: When shift_ids are explicitly provided, the client JUST updated
        // them to 'published' via anon key. To prevent a race where this server-side query
        // (via service role) runs before the client write propagates, we FIRST ensure the
        // update is applied atomically here, then query.
        if (body.shift_ids && Array.isArray(body.shift_ids) && body.shift_ids.length > 0) {
            console.log(`🔄 [API] Ensuring ${body.shift_ids.length} shifts are marked as 'published' (atomic guarantee)...`)
            const { error: ensureError } = await supabase
                .from('shifts')
                .update({ status: 'published' })
                .in('id', body.shift_ids)
            if (ensureError) {
                console.error('❌ [API] Failed to ensure publish status:', ensureError)
            }
        }

        let query = supabase
            .from('shifts')
            .select('*')
            .eq('store_id', store_id)
            .eq('status', 'published')
            .gte('shift_date', start_date)
            .lte('shift_date', end_date)

        const { data: shifts, error: shiftError } = await query

        if (shiftError) {
            console.error('❌ [API] Error querying shifts:', shiftError)
            return NextResponse.json({ success: false, error: 'Database error fetching shifts: ' + shiftError.message }, { status: 500 })
        }

        if (!shifts || shifts.length === 0) {
            console.warn('⚠️ [API] No published shifts found for store:', store_id, 'IDs:', body.shift_ids?.length || 0)
            return NextResponse.json({ success: true, stats: { email: 0, errors: 0 }, message: 'No published shifts found to notify' })
        }

        // 3. Identify Employees (Target explicit list or all in view)
        let targetEmployeeIds: string[] = []
        if (body.employee_ids && Array.isArray(body.employee_ids) && body.employee_ids.length > 0) {
            targetEmployeeIds = body.employee_ids
        } else {
            targetEmployeeIds = [...new Set(shifts.map(s => s.employee_id).filter(Boolean))]
        }

        if (targetEmployeeIds.length === 0) return NextResponse.json({ message: 'No employees to notify' })

        // 4. Fetch Employee Contact Info
        const { data: employees, error: empError } = await supabase
            .from('toast_employees')
            .select('*')
            .in('id', targetEmployeeIds)

        if (empError) throw empError

        // --- 5. STATION ASSIGNMENTS FETCH ---
        const { data: stationAssignments } = await supabase
            .from('station_assignments')
            .select('*')
            .eq('store_id', store_id)
            .gte('assignment_date', start_date)
            .lte('assignment_date', end_date)

        // --- 6. SMART BREAKS GENERATION (Fidelity Alignment with Tablet) ---
        const { data: allJobs } = await supabase.from('toast_jobs').select('*')

        // POR PETICIÓN DEL USUARIO: Forzar el recálculo de TODOS los turnos 
        // usando el motor inteligente al publicar, y guardarlo en la BD.
        const needsCalcShifts = shifts;

        if (needsCalcShifts.length > 0) {
            console.log(`🤖 [API] Recalculando breaks para TODOS los ${needsCalcShifts.length} shifts al Publicar.`)
            
            const datesToProcess = [...new Set(needsCalcShifts.map(s => s.shift_date))]
            
            for (const dateStr of datesToProcess) {
                try {
                    // Fetch current day's complete context to ensure leader/tropa rules
                    const { data: dayShifts } = await supabase.from('shifts').select('*').eq('store_id', store_id).eq('shift_date', dateStr)
                    if (!dayShifts) continue

                    // Get Forecast
                    const { hours: hoursToDraw } = await generateSmartForecast(store_id, dateStr)
                    
                    // Identify employees for this day context
                    const dayEmpIds = [...new Set(dayShifts.map(s => s.employee_id).filter(Boolean))]
                    const { data: dayEmployees } = await supabase.from('toast_employees').select('*').in('id', dayEmpIds)

                    const shiftsForAi = dayShifts
                        .filter((s: any) => s.is_callback !== true) // FIDELITY: Skip absentees in calculation
                        .map((s: any) => {
                            const emp = (dayEmployees || []).find(e => e.id === s.employee_id || e.toast_guid === s.employee_toast_guid)
                            let extTitle = ''
                            if (emp?.job_references?.[0]) {
                                const job = (allJobs || []).find((j: any) => j.guid === emp.job_references[0].guid)
                                if (job) extTitle = job.title
                            }
                            if (!extTitle && s.job_id) {
                                const shiftJob = (allJobs || []).find((j: any) => j.guid === s.job_id || String(j.id) === String(s.job_id))
                                if (shiftJob) extTitle = shiftJob.title
                            }
                            
                            const titleLower = extTitle.toLowerCase()
                            const empNameLower = emp ? `${emp.first_name} ${emp.last_name}`.toLowerCase() : ''
                            
                            // FIDELITY LOGIC: Must match app/descansos/page.tsx
                            const isLeader = titleLower.includes('manager') || 
                                             titleLower.includes('asst') || 
                                             titleLower.includes('shift') || 
                                             titleLower.includes('lead') ||
                                             titleLower.includes('asistente') ||
                                             titleLower.includes('assistant') ||
                                             titleLower.includes('encargado') ||
                                             empNameLower.includes('alberto romero') ||
                                             empNameLower.includes('manager');

                            return { ...s, is_leader: isLeader, job_title: extTitle }
                        })

                    const augmented = scheduleBreaksWithDemand(shiftsForAi as any, hoursToDraw || [])
                    
                    // Aplicar y Guardar a TODOS los turnos recalculados
                    for (const aug of augmented) {
                        const originalIdx = shifts.findIndex(ls => ls.id === aug.id)
                        if (originalIdx !== -1) {
                            // Forzamos la actualización en memoria para el email
                            shifts[originalIdx].breaks_schedule = aug.breaks_schedule
                            // Forzamos el guardado en la BD para que quede grabado
                            await supabase.from('shifts').update({ breaks_schedule: aug.breaks_schedule }).eq('id', aug.id)
                        }
                    }
                } catch (e) {
                    console.error(`❌ [API] Error filling breaks for ${dateStr}:`, e)
                }
            }
        }
        // --- 5.1 POSITION ACTIVITIES FETCH (New Global position-based rules) ---
        const { data: positionActivities } = await supabase
            .from('position_activities')
            .select(`
                *,
                operating_procedures (
                    id,
                    activity
                )
            `);

        const { data: allProcedures } = await supabase
            .from('operating_procedures')
            .select('id, activity, start_time, duration_minutes, shift_type');

        // 6. Send Email Notifications (VIA GMAIL API REST - NO SMTP)
        const results = { email: 0, errors: 0 }

        // Get store info for branding and calendar events
        const { data: store } = await supabase
            .from('stores')
            .select('name, address, city, state, zip_code, phone')
            .eq('external_id', store_id)
            .single()
        const storeName = store?.name || 'Tu Equipo'

        // --- ACTIVITIES PILOT: Solo tiendas habilitadas reciben actividades en el correo ---
        // Para habilitar más tiendas, agregar su Toast external_id (GUID) a esta lista.
        const ACTIVITIES_PILOT_STORES = [
            '9625621e-1b5e-48d7-87ae-7094fab5a4fd', // Slauson
        ];
        const isActivitiesEnabled = ACTIVITIES_PILOT_STORES.includes(store_id);

        // CHUNK PROCESSING FUNCTION (Using Nodemailer Stream for Robust Attachments)
        const processChunk = async (chunk: any[]) => {
            const promises = chunk.map(async (emp: any) => {
                const empShifts = shifts
                    .filter(s => s.employee_id === emp.id)
                    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()) // SORT BY DATE

                if (empShifts.length === 0) return

                // Prepare structured shifts for iCalendar generation
                const calendarShifts: CalendarShiftItem[] = empShifts.map((s: any) => {
                    const dayStr = s.shift_date;
                    let empShiftType = 'AM';
                    const startDate = new Date(s.start_time);
                    if (startDate.getHours() >= 17) empShiftType = 'PM';
                    const shiftSuffix = `_${empShiftType}`;
                    const myPositions = (stationAssignments || []).filter(a => 
                        a.employee_id === emp.id && 
                        a.assignment_date === dayStr &&
                        (a.sub_position?.endsWith(shiftSuffix) || (!a.sub_position?.includes('_AM') && !a.sub_position?.includes('_PM')))
                    );
                    const myPos = myPositions.length > 0 ? myPositions[0] : null;
                    let posTitle = s.job_title || s.role || '';
                    if (myPos?.position_name) {
                        posTitle = myPos.sub_position ? `${myPos.position_name} (${myPos.sub_position.replace(/_AM|_PM/g, '')})` : myPos.position_name;
                    }

                    return {
                        id: s.id,
                        shift_date: s.shift_date,
                        start_time: s.start_time,
                        end_time: s.end_time,
                        position_title: posTitle,
                        breaks: s.breaks_schedule && Array.isArray(s.breaks_schedule) ? s.breaks_schedule : []
                    };
                });

                const storeInfo: CalendarStoreInfo = {
                    name: storeName,
                    address: store?.address || '',
                    city: store?.city || '',
                    state: store?.state || 'CA',
                    zip_code: store?.zip_code || '',
                    phone: store?.phone || ''
                };

                const empFullName = `${emp.chosen_name || emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'Empleado';

                const icsContent = generateScheduleICS({
                    store: storeInfo,
                    employeeName: empFullName,
                    shifts: calendarShifts,
                    calendarName: `Horario ${storeName}`
                });

                const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://tacosgavilan.vercel.app');
                const calendarDownloadUrl = buildCalendarApiUrl({
                    baseUrl: appBaseUrl,
                    employeeId: emp.id,
                    storeId: store_id,
                    startDate: start_date,
                    endDate: end_date
                });

                // Build shift rows for email table
                const shiftRows = empShifts.map((s: any) => {
                    const startDate = new Date(s.start_time)
                    const endDate = new Date(s.end_time)

                    const dayName = startDate.toLocaleDateString('es-US', { weekday: 'long', timeZone: 'America/Los_Angeles' })
                    const dayNum = startDate.toLocaleDateString('es-US', { day: 'numeric', timeZone: 'America/Los_Angeles' })
                    const month = startDate.toLocaleDateString('es-US', { month: 'short', timeZone: 'America/Los_Angeles' })
                    const start = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' })
                    const end = endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' })

                    // BUSCAR POSICIONES / STATIONS (un empleado puede tener múltiples posiciones)
                    const dayStr = s.shift_date; // Usar la fecha del shift mapeada correctamente en DB en vez de la conversión UTC

                    // Determine shift type from start time
                    let empShiftType = 'AM';
                    if (startDate.getHours() >= 17) {
                        empShiftType = 'PM';
                    }
                    const shiftSuffix = `_${empShiftType}`;

                    // Find ALL positions for this employee on this day & shift
                    const myPositions = (stationAssignments || []).filter(a => 
                        a.employee_id === emp.id && 
                        a.assignment_date === dayStr &&
                        (a.sub_position?.endsWith(shiftSuffix) || (!a.sub_position?.includes('_AM') && !a.sub_position?.includes('_PM')))
                    );
                    const myPosition = myPositions.length > 0 ? myPositions[0] : null;

                    let positionBadge = '';
                    let tasksHtml = '';

                    const laDateStr = startDate.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
                    const jsDay = new Date(laDateStr).getDay(); // 0=Sunday, 6=Saturday
                    const myDayIndex = jsDay === 0 ? 6 : jsDay - 1; // Mon=0, Tue=1...Sun=6

                    // Helper to match frequency strings (like 'Diario', 'Domingo', 'Jueves y Domingo', '6')
                    const isFreqMatch = (paFrequency: string, dayIdx: string | number): boolean => {
                      if (!paFrequency) return false;
                      const freqLower = paFrequency.toLowerCase();
                      if (freqLower === 'diario') return true;
                      if (paFrequency === String(dayIdx)) return true;
                      
                      const dayNamesMap: Record<string, string[]> = {
                        '0': ['lunes'],
                        '1': ['martes'],
                        '2': ['miercoles', 'miércoles'],
                        '3': ['jueves'],
                        '4': ['viernes'],
                        '5': ['sabado', 'sábado'],
                        '6': ['domingo']
                      };
                      
                      const names = dayNamesMap[String(dayIdx)];
                      if (!names) return false;
                      
                      return names.some(name => freqLower.includes(name));
                    };

                    // Determine if store has Drive-Thru:
                    // 1. Check if there's any DT station assigned this week
                    // 2. Fallback: Check storeName against known DT store patterns
                    let hasDT = (stationAssignments || []).some(a => {
                        const pos = (a.sub_position || a.main_station || '').toLowerCase();
                        return pos.includes('(dt)') || pos.includes('ventana');
                    });
                    if (!hasDT && storeName) {
                        const normalizedStore = storeName.toLowerCase();
                        hasDT = ['norwalk', 'rialto', 'santa ana', 'santaana', 'south gate', 'southgate', 'downey', 'bell', 'lynwood', 'hpark', 'huntington park'].some(sName => normalizedStore.includes(sName));
                    }

                    const job = (allJobs || []).find((j: any) => j.id === s.job_id || String(j.guid) === String(s.job_id) || String(j.id) === String(s.job_id));
                    const jobTitle = job?.title || '';

                    if (s.is_callback === true) {
                        positionBadge = `
                            <div style="margin-top: 4px; font-size: 13px; font-weight: 800; color: #dc2626; background: #fef2f2; padding: 4px 10px; border-radius: 6px; display: inline-block; border: 1px solid #fee2e2;">
                                AUSENTE / CALLBACK
                            </div>
                        `;
                        tasksHtml = '';
                    } else if (myPositions.length > 0 && isActivitiesEnabled) {
                        // Show ALL station names in the badge
                        const stationNames = myPositions.map(p => p.main_station || p.sub_position?.replace(shiftSuffix, '')).filter(Boolean);
                        const stationDisplay = stationNames.join(' + ');
                        positionBadge = `
                            <div style="margin-top: 4px; font-size: 13px; font-weight: 800; color: #4f46e5; background: #eef2ff; padding: 4px 10px; border-radius: 6px; display: inline-block; border: 1px solid #c7d2fe;">
                                <span style="font-size: 10px; color: #6366f1; text-transform: uppercase;">Posición:</span> ${stationDisplay}
                            </div>
                        `;

                        const shiftType = empShiftType;
                        const storeModel = hasDT ? 'DRIVE_THRU' : 'REGULAR';

                        // Resolve role key from the first position (for leadership detection)
                        const shiftStation = myPosition!.sub_position || myPosition!.main_station;
                        const roleKey = resolvePositionKey(jobTitle, shiftStation, myPosition!.station_group);
                        const isLeadership = roleKey && ['MANAGER', 'ASSISTANT', 'SHIFT_LEADER_MALE', 'SHIFT_LEADER_FEMALE'].includes(roleKey);

                        // Collect custom tasks from all positions
                        const allCustomTasks: string[] = [];
                        myPositions.forEach(pos => {
                            if (pos.tasks && Array.isArray(pos.tasks)) {
                                allCustomTasks.push(...pos.tasks.filter(Boolean));
                            }
                        });

                        let finalTasks: string[] = [];

                        if (allCustomTasks.length > 0) {
                            const resolved = allCustomTasks.map((taskText: string) => {
                                const normText = normalizeText(taskText);
                                const matchedAct = (allProcedures || []).find((act: any) => normalizeText(act.activity) === normText);
                                return {
                                    text: matchedAct ? matchedAct.activity : taskText,
                                    sort_order: matchedAct?.start_time 
                                        ? parseInt(matchedAct.start_time.split(':')[0]) * 60 + parseInt(matchedAct.start_time.split(':')[1])
                                        : 9999
                                };
                            });
                            resolved.sort((a: any, b: any) => a.sort_order - b.sort_order);
                            finalTasks = resolved.map((r: any) => r.text);
                        } else {
                            // Fetch active activities for ALL assigned positions
                            // Collect station names from all positions
                            const allStationKeys = myPositions.map(p => p.main_station).filter(Boolean);

                            const activeMappings = (positionActivities || []).filter((item: any) => {
                                const matchPos = allStationKeys.includes(item.position_key) || (isLeadership && item.position_key === roleKey);
                                if (!matchPos) return false;

                                const matchShift = item.shift === 'AMBOS' || item.shift === shiftType;
                                const matchFreq = isFreqMatch(item.frequency, myDayIndex);
                                const matchModel = item.store_model === 'AMBOS' || item.store_model === storeModel;
                                return matchShift && matchFreq && matchModel;
                            });

                            let resolvedActivities = [...activeMappings];

                            // NOTE: Auto-redistribución de estaciones vacantes y herencia de Assistant
                            // fueron removidas para mantener consistencia con el frontend (Asignación Diaria).
                            // El correo ahora SOLO muestra actividades directas de la estación/rol asignado.

                            // Deduplicate and sort by sort_order
                            const seen = new Set<string>();
                            const uniqueResolved: any[] = [];
                            resolvedActivities.forEach((item: any) => {
                                const key = item.activity_id || item.id;
                                if (item.operating_procedures?.activity && !seen.has(key)) {
                                    seen.add(key);
                                    uniqueResolved.push(item);
                                }
                            });

                            // Sort by sort_order
                            uniqueResolved.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));

                            finalTasks = uniqueResolved.map((item: any) => {
                                return item.operating_procedures?.activity;
                            }).filter(Boolean);
                        }

                        if (finalTasks.length > 0) {
                            const tasksList = finalTasks.map((taskStr: string) => {
                                return `<li style="font-size: 11px; color: #4b5563; margin-bottom: 2px;">${taskStr}</li>`
                            }).join('');
                            
                            tasksHtml = `
                                <div style="margin-top: 8px; text-align: left; background: #f8fafc; padding: 8px 12px; border-radius: 6px; border: 1px solid #e2e8f0;">
                                    <div style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: 800; margin-bottom: 4px;">Actividades Asignadas:</div>
                                    <ul style="margin: 0; padding-left: 16px; font-weight: 600; font-size: 11px;">
                                        ${tasksList}
                                    </ul>
                                </div>
                            `;
                        }
                    } else if (isActivitiesEnabled) {
                        // Fallback resolution directly from Toast Job Title & Shift Hours (only for pilot stores)
                        let shiftType = 'AM';
                        if (startDate.getHours() >= 17) {
                            shiftType = 'PM';
                        }

                        const storeModel = hasDT ? 'DRIVE_THRU' : 'REGULAR';
                        const roleKey = resolvePositionKey(jobTitle, undefined, undefined);
                        const isLeadership = roleKey && ['MANAGER', 'ASSISTANT', 'SHIFT_LEADER_MALE', 'SHIFT_LEADER_FEMALE'].includes(roleKey);

                        const getFriendlyRoleName = (key: string): string => {
                            switch (key) {
                                case 'MANAGER': return 'Gerente / Manager';
                                case 'ASSISTANT': return 'Asistente / Assistant';
                                case 'SHIFT_LEADER_MALE': return 'Shift Leader - Cocina';
                                case 'SHIFT_LEADER_FEMALE': return 'Shift Leader - Servicio';
                                case 'COOK_MALE': return 'Cocinero / Cook';
                                case 'CASHIER': return 'Cajera / Cashier';
                                default: return 'Colaborador';
                            }
                        };

                        const displayRoleName = getFriendlyRoleName(roleKey);
                        positionBadge = `
                            <div style="margin-top: 4px; font-size: 13px; font-weight: 800; color: #0f766e; background: #f0fdfa; padding: 4px 10px; border-radius: 6px; display: inline-block; border: 1px solid #99f6e4;">
                                <span style="font-size: 10px; color: #0d9488; text-transform: uppercase;">Rol:</span> ${displayRoleName}
                            </div>
                        `;

                        // Fetch active activities for this position
                        const activeMappings = (positionActivities || []).filter((item: any) => {
                            const matchPos = item.position_key === roleKey;
                            if (!matchPos) return false;

                            const matchShift = item.shift === 'AMBOS' || item.shift === shiftType;
                            const matchFreq = isFreqMatch(item.frequency, myDayIndex);
                            const matchModel = item.store_model === 'AMBOS' || item.store_model === storeModel;
                            return matchShift && matchFreq && matchModel;
                        });

                        let resolvedActivities = [...activeMappings];

                            // NOTE: Auto-redistribución de estaciones vacantes y herencia de Assistant
                            // fueron removidas para mantener consistencia con el frontend (Asignación Diaria).
                            // El correo ahora SOLO muestra actividades directas del rol detectado.

                        // Deduplicate and sort by sort_order
                        const seen = new Set<string>();
                        const uniqueResolved: any[] = [];
                        resolvedActivities.forEach((item: any) => {
                            const key = item.activity_id || item.id;
                            if (item.operating_procedures?.activity && !seen.has(key)) {
                                seen.add(key);
                                uniqueResolved.push(item);
                            }
                        });

                        // Sort by sort_order
                        uniqueResolved.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));

                        const finalTasks = uniqueResolved.map((item: any) => {
                            return item.operating_procedures?.activity;
                        }).filter(Boolean);

                        if (finalTasks.length > 0) {
                            const tasksList = finalTasks.map((taskStr: string) => {
                                return `<li style="font-size: 11px; color: #4b5563; margin-bottom: 2px;">${taskStr}</li>`
                            }).join('');
                            
                            tasksHtml = `
                                <div style="margin-top: 8px; text-align: left; background: #f8fafc; padding: 8px 12px; border-radius: 6px; border: 1px solid #e2e8f0;">
                                    <div style="font-size: 10px; color: #64748b; text-transform: uppercase; font-weight: 800; margin-bottom: 4px;">Actividades Asignadas:</div>
                                    <ul style="margin: 0; padding-left: 16px; font-weight: 600; font-size: 11px;">
                                        ${tasksList}
                                    </ul>
                                </div>
                            `;
                        }
                    }

                    let breaksHtml = '';
                    if (s.breaks_schedule && Array.isArray(s.breaks_schedule) && s.breaks_schedule.length > 0) {
                        const list = s.breaks_schedule.map((b: any) => {
                            const bTime = new Date(b.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' });
                            const bName = b.type === 'meal_30' ? 'Almuerzo' : 'Descanso';
                            const bColor = b.type === 'meal_30' ? '#d97706' : '#059669';
                            return `<span style="display: inline-block; font-size: 11px; background: ${bColor}10; color: ${bColor}; padding: 2px 6px; border-radius: 4px; margin: 2px; font-weight: 700;">${bName}: ${bTime}</span>`
                        }).join(' ');
                        
                        breaksHtml = `
                            <div style="margin-top: 10px; border-top: 1px dashed #e5e7eb; pt: 8px;">
                                <div style="font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 800; margin-bottom: 4px;">Breaks Programados:</div>
                                ${list}
                            </div>
                        `;
                    }

                    const singleGoogleCalUrl = buildGoogleCalendarUrl({
                        title: `🌮 Turno Tacos Gavilan - ${storeName}${myPosition?.position_name ? ` (${myPosition.position_name})` : ''}`,
                        details: `Turno de trabajo en Tacos Gavilan ${storeName}.\nHorario: ${start} - ${end}${myPosition?.position_name ? `\nPosición: ${myPosition.position_name}` : ''}`,
                        location: `${storeName}, ${store?.address || ''}, ${store?.city || ''}, CA ${store?.zip_code || ''}`.replace(/,\s*,/g, ',').trim(),
                        startTime: s.start_time,
                        endTime: s.end_time
                    });

                    return `
                        <tr>
                            <td style="padding: 16px; border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #4f46e5; text-transform: capitalize;">
                                ${dayName}<br>
                                <span style="font-size: 24px; font-weight: 800; color: #1f2937;">${dayNum}</span>
                                <span style="font-size: 12px; color: #6b7280; text-transform: uppercase; margin-left: 4px;">${month}</span>
                            </td>
                            <td style="padding: 16px; border-bottom: 1px solid #e5e7eb; text-align: center; font-size: 16px; font-weight: 600; color: #1f2937;">
                                <div>${start} - ${end}</div>
                                ${positionBadge}
                                ${tasksHtml}
                                ${breaksHtml}
                                <div style="margin-top: 10px;">
                                    <a href="${singleGoogleCalUrl}" target="_blank" style="display: inline-block; font-size: 11px; font-weight: 700; color: #4338ca; background: #e0e7ff; padding: 4px 10px; border-radius: 6px; text-decoration: none; border: 1px solid #c7d2fe;">
                                        📅 Google Calendar
                                    </a>
                                </div>
                            </td>
                        </tr>
                    `
                }).join('')

                // FULL HTML TEMPLATE (With Phone Calendar Sync Button & Logo)
                const fullHtml = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Tu Nuevo Horario</title>
                    </head>
                    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px;">
                        <table role="presentation" style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.2);">
                            <tr>
                                <td style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 40px 30px; text-align: center;">
                                    <!-- LOGO INJECTION -->
                                    <img src="cid:logo" alt="Logo" style="display: block; margin: 0 auto 20px auto; width: 80px; height: auto;" />
                                    <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 800;">📅 Tu Nuevo Horario</h1>
                                    <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">${storeName}</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 40px 30px 20px 30px;">
                                    <h2 style="margin: 0 0 16px 0; color: #1f2937; font-size: 24px;">¡Hola, ${emp.first_name}! 👋</h2>
                                    <p style="margin: 0; color: #6b7280; font-size: 16px; line-height: 1.6;">El Gerente (${fromEmail}) ha publicado tus turnos:</p>
                                </td>
                            </tr>

                            <!-- 📲 PHONE CALENDAR SYNC CTA BUTTON (iOS & Android) -->
                            <tr>
                                <td style="padding: 0 30px 20px 30px;">
                                    <div style="background: linear-gradient(135deg, #eff6ff 0%, #e0e7ff 100%); border: 2px solid #bfdbfe; border-radius: 16px; padding: 22px 20px; text-align: center;">
                                        <div style="font-size: 17px; font-weight: 800; color: #1e3a8a; margin-bottom: 6px;">
                                            📲 Sincroniza tus Turnos con tu Teléfono
                                        </div>
                                        <p style="margin: 0 0 16px 0; color: #2563eb; font-size: 13px; font-weight: 600; line-height: 1.4;">
                                            Agrega todos tus turnos de la semana al calendario de tu <strong>iPhone</strong> o <strong>Android</strong> con alarmas automáticas 1 hora antes de cada turno.
                                        </p>
                                        <table role="presentation" style="margin: 0 auto; border-collapse: collapse;">
                                            <tr>
                                                <td style="border-radius: 12px; background: #2563eb; text-align: center; box-shadow: 0 4px 12px rgba(37,99,235,0.35);">
                                                    <a href="${calendarDownloadUrl}" target="_blank" style="display: inline-block; padding: 13px 26px; font-size: 14px; font-weight: 800; color: #ffffff; text-decoration: none; border-radius: 12px; letter-spacing: 0.3px;">
                                                        📲 Agregar a mi Calendario (iPhone / Android)
                                                    </a>
                                                </td>
                                            </tr>
                                        </table>
                                        <div style="margin-top: 12px; font-size: 11px; color: #64748b; font-weight: 500;">
                                            💡 También puedes abrir el archivo adjunto <strong>.ics</strong> para importar todos los turnos directamente.
                                        </div>
                                    </div>
                                </td>
                            </tr>

                            <tr>
                                <td style="padding: 0 30px 20px 30px;">
                                    <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f9fafb; border-radius: 16px; overflow: hidden; border: 2px solid #e5e7eb;">
                                        <thead>
                                            <tr style="background: #f3f4f6;">
                                                <th style="padding:16px; text-align: left; font-size: 14px; color: #374151;">Día</th>
                                                <th style="padding:16px; text-align: center; font-size: 14px; color: #374151;">Horario y Descansos</th>
                                            </tr>
                                        </thead>
                                        <tbody>${shiftRows}</tbody>
                                    </table>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 0 30px 40px 30px;">
                                    <div style="background: #fffbeb; border: 2px solid #fcd34d; border-radius: 12px; padding: 20px; text-align: center;">
                                        <p style="margin: 0; color: #92400e; font-size: 16px; font-weight: 800; line-height: 1.5;">
                                            ⚠️ AVISO IMPORTANTE:<br>
                                            Los horarios de breaks (descansos) y lunches (almuerzos) son una guía inicial y <span style="text-decoration: underline;">podrán cambiar</span> de acuerdo a las necesidades operativas del restaurante y el flujo de clientes.
                                        </p>
                                    </div>
                                </td>
                            </tr>
                             <tr>
                                <td style="padding: 30px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;">
                                    <p style="margin: 0; color: #9ca3af; font-size: 13px;">Enviado por ${fromEmail} a través de Sistema de Monitoreo TEG.</p>
                                </td>
                            </tr>
                        </table>
                    </body>
                    </html>
                `

                // Prepare Attachments Safely (Logo + Native .ics Calendar File)
                const attachments: any[] = []
                const logoPath = path.join(process.cwd(), 'public', 'logo.png')

                // Only attach if file exists (prevents crash on Prod if path differs)
                if (fs.existsSync(logoPath)) {
                    attachments.push({
                        filename: 'logo.png',
                        path: logoPath,
                        cid: 'logo'
                    })
                }

                // Attach Native .ics Calendar File for Instant Phone Recognition
                const safeStoreName = (storeName || 'Tacos_Gavilan').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '')
                attachments.push({
                    filename: `Horario_${safeStoreName}_${start_date}.ics`,
                    content: icsContent,
                    contentType: 'text/calendar; charset=utf-8; method=PUBLISH'
                })

                const mailOptions = {
                    from: `"${storeName} Schedule" <${fromEmail}>`,
                    to: emp.email,
                    subject: `📅 Horario: ${storeName}`,
                    html: fullHtml,
                    attachments
                }

                // COMPILE RAW MESSAGE (Without Sending via SMTP)
                if (emp.email) {
                    try {
                        const compiler = nodemailer.createTransport({ streamTransport: true, newline: 'windows' })
                        const info = await compiler.sendMail(mailOptions)

                        // Convert Nodemailer Output (Stream or Buffer) to Buffer
                        const rawBuffer = await new Promise<Buffer>((resolve, reject) => {
                            const message = info.message as any

                            // If it's already a Buffer, return it
                            if (Buffer.isBuffer(message)) {
                                return resolve(message)
                            }

                            // If it's a stream (most likely)
                            if (typeof message.pipe === 'function') {
                                const chunks: Buffer[] = []
                                message.on('data', (chunk: Buffer) => chunks.push(chunk))
                                message.on('end', () => resolve(Buffer.concat(chunks)))
                                message.on('error', (err: Error) => reject(err))
                                return
                            }

                            // Fallback (shouldn't happen with streamTransport: true)
                            reject(new Error('Nodemailer returned unknown message format'))
                        })

                        const raw = rawBuffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

                        // SEND VIA GMAIL API
                        const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${accessToken}`, // Scoped variable
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ raw })
                        })

                        if (!sendRes.ok) {
                            const err = await sendRes.json()
                            throw new Error(JSON.stringify(err))
                        }

                        const resInfo = await sendRes.json()
                        console.log(`Email sent to ${emp.email} via API: ${resInfo.id}`)
                        results.email++

                    } catch (e) {
                        console.error(`Email failed for ${emp.first_name}:`, e)
                        results.errors++
                    }
                }
            })
            await Promise.all(promises)
        }

        // --- BATCH PROCESSOR ---
        const BATCH_SIZE = 5 // Low batch size to be safe
        for (let i = 0; i < employees.length; i += BATCH_SIZE) {
            const chunk = employees.slice(i, i + BATCH_SIZE)
            await processChunk(chunk)
            // Small delay to prevent SMTP rate limiting or Serverless timeout issues
            await new Promise(r => setTimeout(r, 500))
        }

        // --- 7. SEND CONSOLIDATED REPORT TO MANAGER ---
        if (results.email > 0) {
            console.log(`📊 [API] Generating Consolidated Report for Manager: ${fromEmail}`)
            
            // Helper for sorting (replicated from lib/utils.ts for API use)
            const getApiRoleWeight = (title: string, empShifts: any[]) => {
                const t = (title || '').toLowerCase();
                if (t.includes('manager') && !t.includes('asst') && !t.includes('assist') && !t.includes('asistente') && !t.includes('shift')) return 10;
                
                let totalAmHours = 0;
                let totalPmHours = 0;
                empShifts.forEach(s => {
                    const start = new Date(s.start_time);
                    const end = new Date(s.end_time);
                    const startH = start.getHours() + (start.getMinutes() / 60);
                    let endH = end.getHours() + (end.getMinutes() / 60);
                    if (endH < startH) endH += 24;
                    const overlapAm = Math.max(0, Math.min(endH, 17) - startH);
                    const overlapPm = Math.max(0, endH - Math.max(startH, 17));
                    totalAmHours += overlapAm;
                    totalPmHours += overlapPm;
                });

                const blockScore = totalPmHours > totalAmHours ? 2000 : 1000;
                let roleScore = 99;
                if (t.includes('asst') || t.includes('assist') || t.includes('asistente')) roleScore = 1;
                else if (t.includes('shift') || t.includes('leader') || t.includes('encargado')) roleScore = 2;
                else if (t.includes('cashier') || t.includes('cajera')) roleScore = 3;
                else if (t.includes('cook') || t.includes('cocinero') || t.includes('prep') || t.includes('preparador') || t.includes('taquero') || t.includes('tortill')) roleScore = 4;
                return blockScore + roleScore;
            };

            // Fix: ensure we have names for ALL employees in the report shifts
            const allEmpIdInShifts = [...new Set(shifts.map(s => s.employee_id).filter(Boolean))]
            const { data: allShiftsEmployees } = await supabase.from('toast_employees').select('id, first_name, last_name, job_references').in('id', allEmpIdInShifts)
            
            // Sort employees by Planner Weight
            const empMap = (allShiftsEmployees || []).sort((a,b) => {
                const aShifts = shifts.filter(s => s.employee_id === a.id);
                const bShifts = shifts.filter(s => s.employee_id === b.id);
                const aJob = a.job_references?.[0]?.title || '';
                const bJob = b.job_references?.[0]?.title || '';
                const wA = getApiRoleWeight(aJob, aShifts);
                const wB = getApiRoleWeight(bJob, bShifts);
                if (wA !== wB) return wA - wB;
                return a.first_name.localeCompare(b.first_name);
            })
            
            // Get unique dates for columns
            const reportDates = [...new Set(shifts.map(s => s.shift_date))].sort()
            
            const tableHeaders = reportDates.map(d => {
                const dateObj = new Date(d + 'T12:00:00')
                return `<th style="padding: 6px; border: 1px solid #ddd; font-size: 10px; background: #f1f5f9; text-transform: uppercase;">${dateObj.toLocaleDateString('es-US', { weekday: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })}</th>`
            }).join('')

            const reportRows = empMap.map(emp => {
                const empShifts = shifts.filter(s => s.employee_id === emp.id)
                if (empShifts.length === 0) return ''

                const cells = reportDates.map(dateStr => {
                    const dayShifts = empShifts.filter(s => s.shift_date === dateStr)
                    if (dayShifts.length === 0) return `<td style="border: 1px solid #eee; background: #fafafa;"></td>`

                    const content = dayShifts.map(s => {
                        const sTime = new Date(s.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' }).replace(':00', '')
                        const eTime = new Date(s.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' }).replace(':00', '')
                        
                        let bInfo = ''
                        if (s.breaks_schedule && Array.isArray(s.breaks_schedule)) {
                            bInfo = s.breaks_schedule.map((b: any) => {
                                const bt = new Date(b.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' }).replace(':00', '')
                                // ORANGE for Lunch, GREEN for Break
                                const color = b.type === 'meal_30' ? '#f97316' : '#22c55e';
                                return `<div style="font-size: 8px; color: ${color}; font-weight: bold;">${b.type === 'meal_30' ? 'L:' : 'B:'}${bt}</div>`
                            }).join('')
                        }

                        return `
                            <div style="font-size: 9px; font-weight: bold; margin-bottom: 2px;">${sTime}-${eTime}</div>
                            ${bInfo}
                        `
                    }).join('<div style="margin: 4px 0; border-top: 1px solid #eee;"></div>')

                    return `<td style="padding: 4px; border: 1px solid #eee; vertical-align: top; min-width: 60px;">${content}</td>`
                }).join('')

                return `
                    <tr>
                        <td style="padding: 6px; border: 1px solid #ddd; font-weight: bold; font-size: 11px; background: #fdfdfd; white-space: nowrap;">${emp.first_name} ${emp.last_name?.charAt(0) || ''}.</td>
                        ${cells}
                    </tr>
                `
            }).join('')

            const managerHtml = `
                <!DOCTYPE html>
                <html>
                <body style="font-family: 'Inter', Arial, sans-serif; color: #1e293b; padding: 0; margin: 0; background-color: #f8fafc;">
                    <div style="max-width: 1100px; margin: 0 auto; background: white; padding: 40px; border: 1px solid #e2e8f0;">
                        
                        <!-- PDF HEADER STYLE -->
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #4f46e5; padding-bottom: 20px; margin-bottom: 30px;">
                            <div style="flex: 1;">
                                <h1 style="margin: 0; font-size: 24px; font-weight: 900; color: #1e293b; letter-spacing: -0.025em;">REPORTES DE PROGRAMACIÓN</h1>
                                <p style="margin: 4px 0 0 0; font-size: 14px; font-weight: 600; color: #6366f1; text-transform: uppercase;">${storeName}</p>
                            </div>
                            <div style="text-align: right; font-size: 11px; line-height: 1.6;">
                                <div style="font-weight: 900; color: #4f46e5;">DOCUMENTO OFICIAL</div>
                                <div><b>Publicado:</b> ${new Date().toLocaleDateString('es-US', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
                                <div><b>Manager ID:</b> ${fromEmail}</div>
                                <div style="margin-top: 10px; background: #eff6ff; color: #1d4ed8; padding: 4px 8px; border-radius: 4px; display: inline-block;">
                                    Confirmaciones de envío: <b>${results.email}</b>
                                </div>
                            </div>
                        </div>

                        <!-- GRID CONTENT -->
                        <table style="width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; table-layout: fixed;">
                            <thead>
                                <tr style="background: #f8fafc;">
                                    <th style="width: 130px; padding: 10px 8px; border: 1px solid #e2e8f0; font-size: 10px; color: #64748b; text-align: left;">COLABORADOR</th>
                                    ${tableHeaders}
                                </tr>
                            </thead>
                            <tbody style="font-size: 10px; color: #334155;">
                                ${reportRows}
                            </tbody>
                        </table>

                        <!-- PDF FOOTER -->
                        <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8;">
                            <div>© ${new Date().getFullYear()} Tacos Gavilan - Sistema de Gestión de Labor</div>
                            <div style="font-style: italic;">* L: Lunch (30m) | B: Break (10m)</div>
                            <div>Página 1 de 1</div>
                        </div>
                    </div>

                    <style>
                        @media print {
                            body { background: white !important; }
                            div { border: none !important; padding: 0 !important; }
                            table { page-break-inside: auto; }
                            tr { page-break-inside: avoid; page-break-after: auto; }
                        }
                    </style>
                </body>
                </html>
            `

            // --- PDF ATTACHMENT GENERATION ---
            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            
            // Header Content
            doc.setFontSize(18);
            doc.setTextColor(79, 70, 229); // #4f46e5
            doc.text(`HORARIO MAESTRO: ${storeName}`, 14, 20);
            
            doc.setFontSize(10);
            doc.setTextColor(100, 116, 139);
            const dateRangeStr = reportDates.length > 0 ? `${reportDates[0]} - ${reportDates[reportDates.length-1]}` : '';
            doc.text(`Periodo: ${dateRangeStr} | Generado por: ${fromEmail}`, 14, 28);
            doc.text(`Fecha de Publicación: ${new Date().toLocaleString()}`, 14, 33);

            // Table Data Preparation
            const head = [['EMPLEADO', ...reportDates.map(d => {
                const dateObj = new Date(d + 'T12:00:00');
                return dateObj.toLocaleDateString('es-US', { weekday: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' }).toUpperCase();
            })]];

            const body = empMap.map(emp => {
                const empShifts = shifts.filter(s => s.employee_id === emp.id);
                const row = [`${emp.first_name} ${emp.last_name?.charAt(0) || ''}.`];
                
                reportDates.forEach(dateStr => {
                    const dayShifts = empShifts.filter(s => s.shift_date === dateStr);
                    if (dayShifts.length === 0) {
                        row.push('');
                    } else {
                        const cellText = dayShifts.map(s => {
                            const sTime = new Date(s.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' }).replace(':00', '');
                            const eTime = new Date(s.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' }).replace(':00', '');
                            let bText = '';
                            if (s.breaks_schedule && Array.isArray(s.breaks_schedule)) {
                                bText = '\n' + s.breaks_schedule.map((b: any) => {
                                    const bt = new Date(b.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' }).replace(':00', '');
                                    return `${b.type === 'meal_30' ? 'L:' : 'B:'}${bt}`;
                                }).join('  ');
                            }
                            return `${sTime}-${eTime}${bText}`;
                        }).join('\n---\n');
                        row.push(cellText);
                    }
                });
                return row;
            });

            autoTable(doc, {
                startY: 40,
                head: head,
                body: body,
                theme: 'grid',
                styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak', halign: 'center', valign: 'middle' },
                headStyles: { fillColor: [79, 70, 229], textColor: 255, halign: 'center', fontStyle: 'bold' },
                columnStyles: { 0: { fontStyle: 'bold', fontSize: 8, cellWidth: 35, halign: 'left', fillColor: [249, 250, 251] } },
                alternateRowStyles: { fillColor: [255, 255, 255] },
                willDrawCell: (data) => {
                    // Prevent default text drawing for body columns (>0) to allow for colored manual drawing
                    if (data.section === 'body' && data.column.index > 0) {
                        data.cell.styles.textColor = 255; // White to "hide" but keep spacing logic
                        // Actually better: just store current text and clear it for default engine
                        (data.cell as any)._coloredText = data.cell.text;
                        data.cell.text = [];
                    }
                },
                didDrawCell: (data) => {
                    if (data.section === 'body' && data.column.index > 0) {
                        const cell = data.cell;
                        const lines = (cell as any)._coloredText || [];
                        if (lines.length === 0) return;

                        let currentY = cell.y + 4;
                        const centerX = cell.x + cell.width / 2;

                        doc.setFontSize(7);
                        
                        lines.forEach((line: string) => {
                            if (line === '---') {
                                doc.setDrawColor(240);
                                doc.line(cell.x + 2, currentY, cell.x + cell.width - 2, currentY);
                                currentY += 4;
                                return;
                            }

                            if (line.includes('L:')) {
                                doc.setTextColor(249, 115, 22); // Orange #f97316
                                doc.setFont('helvetica', 'bold');
                                doc.setFontSize(7);
                            } else if (line.includes('B:')) {
                                doc.setTextColor(34, 197, 94); // Green #22c55e
                                doc.setFont('helvetica', 'bold');
                                doc.setFontSize(7);
                            } else {
                                doc.setTextColor(30, 41, 59); // Dark blue-gray #1e293b
                                doc.setFont('helvetica', 'bold');
                                doc.setFontSize(8);
                            }
                            
                            doc.text(line, centerX, currentY, { align: 'center' });
                            currentY += 4;
                        });
                    }
                }
            });

            // Footer
            const pageCount = (doc as any).internal.getNumberOfPages();
            for (let i = 1; i <= pageCount; i++) {
                doc.setPage(i);
                doc.setFontSize(8);
                doc.setTextColor(150);
                doc.text(`Sistema TEG Tacos Gavilan | Página ${i} de ${pageCount}`, doc.internal.pageSize.width / 2, doc.internal.pageSize.height - 10, { align: 'center' });
            }

            const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

            try {
                const compiler = nodemailer.createTransport({ streamTransport: true, newline: 'windows' })
                const info = await compiler.sendMail({
                    from: `"Sistema TEG" <${fromEmail}>`,
                    to: fromEmail,
                    subject: `📑 RESUMEN PUBLICACIÓN: ${storeName}`,
                    html: managerHtml,
                    attachments: [
                        {
                            filename: `Horario_${storeName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`,
                            content: pdfBuffer
                        }
                    ]
                })
                const rawBuffer = await new Promise<Buffer>((resolve, reject) => {
                    const message = info.message as any
                    if (Buffer.isBuffer(message)) return resolve(message)
                    const chunks: Buffer[] = []
                    message.on('data', (chunk: Buffer) => chunks.push(chunk))
                    message.on('end', () => resolve(Buffer.concat(chunks)))
                    message.on('error', (err: Error) => reject(err))
                })
                const raw = rawBuffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
                
                await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ raw })
                })
                console.log(`✅ Manager Report (with PDF) sent to ${fromEmail}`)
            } catch (me) {
                console.error('❌ Failed to send Manager Report:', me)
            }
        }

        return NextResponse.json({ success: true, stats: results })

    } catch (error: any) {
        console.error('Notification Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
