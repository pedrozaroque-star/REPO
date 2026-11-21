/**
 * @module app/api/training/ronos-auth/route
 * @description Endpoint de autenticación en tiempo real mediante PIN de 4 dígitos de RONOS
 * para el Módulo TRAINING (Academia SOP 4 Días Tacos Gavilan).
 *
 * @businessRules
 * - Utiliza exactamente la misma función `verifyRonosPin(storeId, pin)` del módulo Blindaje Delivery (`lib/delivery-armor.ts`),
 *   sincronizada en vivo contra RONOS API y `ronos_employee_timecards_cache`.
 * - Candado Anti-Suplantación (PIN Ownership Check): si el usuario eligió un colaborador específico en la lista,
 *   valida que el titular real del PIN en RONOS coincida con la persona seleccionada (evitando cruces de expediente).
 * - Antigüedad / Auto-Certificación Autoritativa de Servidor: JAMÁS confía en `body.autoCertified` del cliente;
 *   calcula la antigüedad (`>= 14 días`) exclusivamente en servidor contra `toast_employees` y `ronos_employee_timecards_cache`.
 * - Límite de tasa estricto por IP y por PIN (`máx 8 intentos / 10 min`, `429 Retry-After`).
 *
 * @dataFlow
 * - `POST /api/training/ronos-auth` -> Rate Limit -> `verifyRonosPin(storeId, pin)` -> Antigüedad Servidor -> `public.training_enrollments` -> `{ ok: true, ronosEmployee, enrollment }`
 *
 * @notes
 * - Blindaje de Seguridad (2026-11-21): eliminado `body.autoCertified` de entrada del cliente, agregado rate limit acotado por IP+PIN y cookie `HttpOnly` firmada (`teg_trainee_pass`) para progreso del aprendiz.
 */

import { createHash, createHmac } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { verifyRonosPin } from '@/lib/delivery-armor';
import { getJwtSecret } from '@/lib/auth-server';
import { formatStoreName, supabaseAdmin } from '@/lib/supabase';
import { normalizeText } from '@/lib/actividades-resolution';
import { STATION_POSITIONS_CATALOG } from '@/lib/training-sop-catalog';

const MAX_RATE_BUCKETS = 2000;
const PIN_RATE_LIMIT = 8;
const PIN_RATE_WINDOW_MS = 10 * 60_000;
const ronosAuthRateBuckets = new Map<string, number[]>();

function extractTrustedIp(headers: Headers): string {
  const vercelFwd = headers.get('x-vercel-forwarded-for') || '';
  const firstVercel = vercelFwd.split(',')[0]?.trim();
  if (firstVercel) return firstVercel.slice(0, 64);
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp.slice(0, 64);
  const fwd = headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0]?.trim().slice(0, 64) || 'unknown';
}

function checkBoundedRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
  if (ronosAuthRateBuckets.size >= MAX_RATE_BUCKETS && !ronosAuthRateBuckets.has(key)) {
    for (const [k, arr] of ronosAuthRateBuckets) {
      const valid = arr.filter((t) => now - t < windowMs);
      if (valid.length === 0) ronosAuthRateBuckets.delete(k);
      else ronosAuthRateBuckets.set(k, valid);
    }
    if (ronosAuthRateBuckets.size >= MAX_RATE_BUCKETS) {
      const oldest = ronosAuthRateBuckets.keys().next().value;
      if (oldest) ronosAuthRateBuckets.delete(oldest);
    }
  }
  const hits = (ronosAuthRateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    ronosAuthRateBuckets.set(key, hits);
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000));
    return { allowed: false, retryAfterSec };
  }
  hits.push(now);
  ronosAuthRateBuckets.set(key, hits);
  return { allowed: true, retryAfterSec: 0 };
}

function buildSignedTraineeCookieValue(enrollmentId: string, accessCode: string): string | null {
  const secret = getJwtSecret() || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!secret.trim()) return null;
  const cleanId = String(enrollmentId).trim();
  const cleanCode = String(accessCode).trim().toUpperCase();
  const sig = createHmac('sha256', secret.trim()).update(`trainee:${cleanId}:${cleanCode}`).digest('hex');
  return `${cleanId}.${cleanCode}.${sig}`;
}

function generateTemporaryCode(): string {
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `TG-${digits}`;
}

function generateCertificateFolio(storeId: number): string {
  const year = new Date().getFullYear();
  const rand = Math.floor(10000 + Math.random() * 90000);
  return `TG-CERT-${year}-S${storeId}-${rand}`;
}

function namesMatchOwner(ronosFullName: string, selectedName: string): boolean {
  const normRonos = normalizeText(ronosFullName);
  const normSelected = normalizeText(selectedName);
  if (!normRonos || !normSelected) return false;
  if (normRonos === normSelected) return true;

  const ronosTokens = normRonos.split(/\s+/).filter((t) => t.length > 1);
  const selectedTokens = normSelected.split(/\s+/).filter((t) => t.length > 1);
  if (ronosTokens.length === 0 || selectedTokens.length === 0) return false;

  const ronosSet = new Set(ronosTokens);
  const matches = selectedTokens.filter((t) => ronosSet.has(t));
  const minRequired = Math.min(2, selectedTokens.length, ronosTokens.length);
  return matches.length >= minRequired;
}

/**
 * Calcula de forma autoritativa en servidor si el colaborador cumple la antigüedad oficial (>= 14 días / 2+ semanas)
 * usando `toast_employees` y `ronos_employee_timecards_cache`, ignorando por completo cualquier bandera del cliente.
 */
async function resolveAuthoritativeServerTenureCertification(params: {
  ronosEmployeeUserId: number;
  verifiedFullName: string;
  numericEmployeeId: number | null;
}): Promise<boolean> {
  const TENURE_CERT_MS = 14 * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  // 1. Verificar fecha de alta en toast_employees validando coincidencia de nombre con el titular del PIN
  if (params.numericEmployeeId) {
    const { data: empById } = await supabaseAdmin
      .from('toast_employees')
      .select('id, first_name, last_name, created_date, created_at, deleted')
      .eq('id', params.numericEmployeeId)
      .maybeSingle();

    if (empById && empById.deleted !== true) {
      const candidateFull = `${empById.first_name || ''} ${empById.last_name || ''}`.replace(/\s+/g, ' ').trim();
      if (namesMatchOwner(params.verifiedFullName, candidateFull)) {
        const dtRaw = empById.created_date || empById.created_at;
        const dtMs = dtRaw ? Date.parse(String(dtRaw)) : NaN;
        if (Number.isFinite(dtMs) && nowMs - dtMs >= TENURE_CERT_MS) {
          return true;
        }
      }
    }
  }

  // 2. Respaldo autoritativo en ronos_employee_timecards_cache: >= 2 semanas de diferencia entre primera y última semana registrada
  const { data: weekRows } = await supabaseAdmin
    .from('ronos_employee_timecards_cache')
    .select('week_id')
    .eq('employee_user_id', params.ronosEmployeeUserId)
    .order('week_id', { ascending: true })
    .limit(50);

  if (Array.isArray(weekRows) && weekRows.length >= 2) {
    const weeks = weekRows.map((r: any) => Number(r.week_id || 0)).filter((w) => Number.isFinite(w) && w > 0);
    if (weeks.length >= 2) {
      const minWeek = Math.min(...weeks);
      const maxWeek = Math.max(...weeks);
      if (maxWeek - minWeek >= 2) {
        return true;
      }
    }
  }

  return false;
}

export async function POST(req: NextRequest) {
  try {
    const clientIp = extractTrustedIp(req.headers);
    const ipLimit = checkBoundedRateLimit(`ronos-ip:${clientIp}`, PIN_RATE_LIMIT, PIN_RATE_WINDOW_MS);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          code: 'RATE_LIMITED',
          error: `Demasiados intentos de PIN. Espera ${ipLimit.retryAfterSec}s antes de intentar nuevamente.`,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(ipLimit.retryAfterSec) },
        }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'Solicitud JSON inválida.' }, { status: 400 });
    }

    const {
      storeId,
      storeName,
      pin,
      employeeId,
      employeeName,
      expectedEmployeeName,
      employeePhone,
      positionKey,
      stationKey,
      trainerName,
    } = body as Record<string, any>;

    const numericStoreId = Number(storeId || 0);
    const cleanPin = String(pin || '').trim();

    if (!numericStoreId || numericStoreId <= 0 || !Number.isInteger(numericStoreId)) {
      return NextResponse.json(
        { ok: false, error: 'Selecciona una sucursal válida.' },
        { status: 400 }
      );
    }

    if (!/^\d{4}$/.test(cleanPin)) {
      return NextResponse.json(
        { ok: false, error: 'La clave de RONOS debe tener exactamente 4 dígitos numéricos.' },
        { status: 400 }
      );
    }

    const pinDigest = createHash('sha256').update(`${numericStoreId}:${cleanPin}`).digest('hex').slice(0, 24);
    const pinLimit = checkBoundedRateLimit(`ronos-pin:${pinDigest}`, PIN_RATE_LIMIT, PIN_RATE_WINDOW_MS);
    if (!pinLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          code: 'RATE_LIMITED',
          error: `Demasiados intentos sobre esta clave. Espera ${pinLimit.retryAfterSec}s.`,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(pinLimit.retryAfterSec) },
        }
      );
    }

    const verified = await verifyRonosPin(numericStoreId, cleanPin);

    if (!verified.valid || !verified.employeeUserId || !verified.fullName) {
      return NextResponse.json(
        {
          ok: false,
          error: verified.error || 'Clave de RONOS incorrecta o colaborador inactivo en RONOS.',
        },
        { status: 401 }
      );
    }

    const requestedName = String(expectedEmployeeName || employeeName || '').trim();
    if (requestedName && !namesMatchOwner(verified.fullName, requestedName)) {
      return NextResponse.json(
        {
          ok: false,
          code: 'PIN_OWNER_MISMATCH',
          pinOwnerName: verified.fullName,
          error: `El PIN ingresado pertenece a ${verified.fullName} y no coincide con ${requestedName}.`,
        },
        { status: 403 }
      );
    }

    const ronosCode = `RONOS-${verified.employeeUserId}`;
    const effectiveName = requestedName || verified.fullName.trim();
    const effectiveStation = String(stationKey || positionKey || 'BURRITOS').trim();
    const validPos = STATION_POSITIONS_CATALOG.find((p) => p.positionKey === effectiveStation);
    const resolvedPositionKey = validPos ? validPos.positionKey : 'BURRITOS';

    let cleanStoreName = String(storeName || '').trim();
    if (!cleanStoreName) {
      const { data: stRow } = await supabaseAdmin
        .from('stores')
        .select('name')
        .eq('id', numericStoreId)
        .maybeSingle();
      cleanStoreName = formatStoreName(stRow?.name || `Sucursal #${numericStoreId}`);
    }

    const parsedEmpId = Number(employeeId);
    const numericEmployeeId =
      employeeId && Number.isInteger(parsedEmpId) && parsedEmpId > 0 ? parsedEmpId : null;

    // Antigüedad autoritativa calculada en servidor (jamás confiar en body.autoCertified del cliente)
    const serverAutoCertified = await resolveAuthoritativeServerTenureCertification({
      ronosEmployeeUserId: verified.employeeUserId,
      verifiedFullName: verified.fullName,
      numericEmployeeId,
    });

    // Buscar si ya tiene expediente en public.training_enrollments usando columnas reales
    const safeIlikeName = effectiveName.replace(/[\\%_]/g, '\\$&');
    const { data: existingList, error: fetchErr } = await supabaseAdmin
      .from('training_enrollments')
      .select('*')
      .eq('store_id', numericStoreId)
      .ilike('employee_name', safeIlikeName)
      .order('created_at', { ascending: false })
      .limit(1);

    if (fetchErr) {
      throw new Error(`Error consultando training_enrollments: ${fetchErr.message}`);
    }

    let enrollment = existingList?.[0] || null;
    const nowIso = new Date().toISOString();

    if (enrollment) {
      const expMs = new Date(enrollment.expires_at).getTime();
      const needsRefresh = Number.isFinite(expMs) && expMs < Date.now() && enrollment.status !== 'CERTIFIED';
      const patch: Record<string, any> = {
        last_accessed_at: nowIso,
        updated_at: nowIso,
      };
      if (needsRefresh) {
        patch.expires_at = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();
        patch.status = 'IN_PROGRESS';
      }
      if (serverAutoCertified && !enrollment.day4_completed) {
        patch.status = 'CERTIFIED';
        patch.current_day = 4;
        patch.day1_completed = true;
        patch.day1_completed_at = enrollment.day1_completed_at || nowIso;
        patch.day1_quiz_score = enrollment.day1_quiz_score ?? 100;
        patch.day2_completed = true;
        patch.day2_completed_at = enrollment.day2_completed_at || nowIso;
        patch.day2_supervised_reps = Math.max(5, Number(enrollment.day2_supervised_reps || 0));
        patch.day3_completed = true;
        patch.day3_completed_at = enrollment.day3_completed_at || nowIso;
        patch.day3_solo_reps = Math.max(5, Number(enrollment.day3_solo_reps || 0));
        patch.day4_completed = true;
        patch.day4_completed_at = enrollment.day4_completed_at || nowIso;
        patch.day4_final_score = enrollment.day4_final_score ?? 100;
        patch.certificate_folio = enrollment.certificate_folio || generateCertificateFolio(numericStoreId);
      }

      const { data: updated } = await supabaseAdmin
        .from('training_enrollments')
        .update(patch)
        .eq('id', enrollment.id)
        .select('*')
        .single();

      if (updated) {
        enrollment = updated;
      }
    } else {
      let accessCode = generateTemporaryCode();
      for (let attempt = 0; attempt < 8; attempt++) {
        const { data: dup } = await supabaseAdmin
          .from('training_enrollments')
          .select('id')
          .eq('access_code', accessCode)
          .maybeSingle();
        if (!dup) break;
        accessCode = generateTemporaryCode();
      }

      const isAlreadyCertified = serverAutoCertified;
      const expiresAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();

      const insertPayload = {
        access_code: accessCode,
        employee_name: effectiveName,
        employee_id: numericEmployeeId,
        employee_phone: employeePhone ? String(employeePhone).trim().slice(0, 30) : null,
        store_id: numericStoreId,
        store_name: cleanStoreName,
        position_key: resolvedPositionKey,
        trainer_name: String(trainerName || 'Manager de Turno').trim().slice(0, 120),
        current_day: isAlreadyCertified ? 4 : 1,
        status: isAlreadyCertified ? 'CERTIFIED' : 'IN_PROGRESS',
        day1_completed: isAlreadyCertified,
        day1_completed_at: isAlreadyCertified ? nowIso : null,
        day1_quiz_score: isAlreadyCertified ? 100 : null,
        day1_videos_watched: isAlreadyCertified ? validPos?.primaryVideoSlugs || [] : [],
        day2_completed: isAlreadyCertified,
        day2_completed_at: isAlreadyCertified ? nowIso : null,
        day2_supervised_reps: isAlreadyCertified ? 5 : 0,
        day2_checklist_json: {},
        day3_completed: isAlreadyCertified,
        day3_completed_at: isAlreadyCertified ? nowIso : null,
        day3_solo_reps: isAlreadyCertified ? 5 : 0,
        day3_checklist_json: {},
        day4_completed: isAlreadyCertified,
        day4_completed_at: isAlreadyCertified ? nowIso : null,
        day4_exam_score: isAlreadyCertified ? 100 : null,
        day4_practical_score: isAlreadyCertified ? 100 : null,
        day4_final_score: isAlreadyCertified ? 100 : null,
        certificate_folio: isAlreadyCertified ? generateCertificateFolio(numericStoreId) : null,
        expires_at: expiresAt,
        last_accessed_at: nowIso,
      };

      const { data: created, error: createErr } = await supabaseAdmin
        .from('training_enrollments')
        .insert(insertPayload)
        .select('*')
        .single();

      if (createErr || !created) {
        throw new Error(`Error creando expediente de entrenamiento: ${createErr?.message || 'Error desconocido'}`);
      }
      enrollment = created;
    }

    const res = NextResponse.json({
      ok: true,
      ronosEmployee: {
        employeeUserId: verified.employeeUserId,
        fullName: verified.fullName,
        jobTitle: verified.jobTitle || 'Colaborador',
        ronosCode,
      },
      employeeId: numericEmployeeId,
      enrollment,
    });

    if (enrollment?.id && enrollment?.access_code) {
      const signedPass = buildSignedTraineeCookieValue(enrollment.id, enrollment.access_code);
      if (signedPass) {
        res.cookies.set('teg_trainee_pass', signedPass, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/api/training',
          maxAge: 4 * 24 * 60 * 60,
        });
      }
    }

    return res;
  } catch (err: any) {
    console.error('[POST /api/training/ronos-auth] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error al verificar PIN en RONOS.' },
      { status: 500 }
    );
  }
}
