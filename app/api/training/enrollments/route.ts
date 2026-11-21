/**
 * @module app/api/training/enrollments/route
 * @description API de inscripciones, progreso de los 4 días, códigos de acceso temporal (`TG-XXXX`)
 * y emisión de Certificados Oficiales de Estación para el Módulo TRAINING de Tacos Gavilan.
 *
 * @businessRules
 * - Cada empleado en entrenamiento recibe un Código de Acceso Temporal único (`TG-XXXX`) válido por 4 días (96 horas),
 *   renovable con 1 clic por el Manager, Supervisor o Administrador.
 * - Progreso secuencial estructurado en 4 días:
 *   * Día 1: Observación de videos SOP con voz masculina IA (`Orus`) + Quiz Teórico (>= 80%).
 *   * Día 2: Práctica Supervisada (mínimo 5 repeticiones validadas con firma de Entrenador/Manager).
 *   * Día 3: Ejecución Autónoma y Velocidad de Línea (El aprendiz lo hace solo cumpliendo Tiempo Meta + Checklist).
 *   * Día 4: Certificación Oficial (Examen Teórico + Auditoría Práctica Ciega >= 90% -> Folio `TG-CERT-2026-XXXX`).
 * - Ninguna columna autocalculada se envía en payloads de `INSERT` o `UPDATE` (cumpliendo regla Postgres 428C9).
 *
 * @dataFlow
 * - `GET /api/training/enrollments` (o `?code=TG-XXXX`) -> `public.training_enrollments`
 * - `POST /api/training/enrollments` -> crea inscripción y genera código temporal `TG-XXXX`
 * - `PUT /api/training/enrollments` -> actualiza progreso de Día 1, Día 2, Día 3, Certificación Día 4 o extiende vigencia
 * - `DELETE /api/training/enrollments?id=...` -> elimina registro de entrenamiento
 *
 * @notes
 * - Blindaje de Seguridad (2026-11-21): `GET ?code=` limita a `10 consultas / 10 min` por IP para impedir enumerar `TG-1000..TG-9999`; `PUT` sin sesión de staff exige `accessCode` obligatorio verificado con `crypto.timingSafeEqual` (`401` si falta, `403` si no coincide); `GET`/`POST`/`DELETE` aplican `authorizeStoreScope` por sucursal.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, formatStoreName } from '@/lib/supabase';
import { getJwtSecret, getServerUser, verifyStaffAuth, authorizeStoreScope } from '@/lib/auth-server';

const ENROLLMENT_ADMIN_ROLES = new Set([
  'admin',
  'administrador',
  'supervisor',
  'manager',
  'asistente',
  'assistant',
  'gerente',
  'general_manager',
  'shift_leader',
  'shift leader',
  'shiftleader',
]);

const DAY4_CERTIFICATION_ROLES = [
  'admin',
  'administrador',
  'supervisor',
  'manager',
  'asistente',
  'assistant',
  'gerente',
  'general_manager',
];

const MAX_LOOKUP_BUCKETS = 2000;
const CODE_LOOKUP_LIMIT = 10;
const CODE_LOOKUP_WINDOW_MS = 10 * 60_000;
const codeLookupBuckets = new Map<string, number[]>();

function extractTrustedIp(headers: Headers): string {
  const vercelFwd = headers.get('x-vercel-forwarded-for') || '';
  const firstVercel = vercelFwd.split(',')[0]?.trim();
  if (firstVercel) return firstVercel.slice(0, 64);
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp.slice(0, 64);
  const fwd = headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0]?.trim().slice(0, 64) || 'unknown';
}

function checkCodeLookupRateLimit(key: string, limit = CODE_LOOKUP_LIMIT, windowMs = CODE_LOOKUP_WINDOW_MS): {
  allowed: boolean;
  retryAfterSec: number;
} {
  const now = Date.now();
  if (codeLookupBuckets.size >= MAX_LOOKUP_BUCKETS && !codeLookupBuckets.has(key)) {
    for (const [k, arr] of codeLookupBuckets) {
      const valid = arr.filter((t) => now - t < windowMs);
      if (valid.length === 0) codeLookupBuckets.delete(k);
      else codeLookupBuckets.set(k, valid);
    }
    if (codeLookupBuckets.size >= MAX_LOOKUP_BUCKETS) {
      const oldest = codeLookupBuckets.keys().next().value;
      if (oldest) codeLookupBuckets.delete(oldest);
    }
  }
  const hits = (codeLookupBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    codeLookupBuckets.set(key, hits);
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000));
    return { allowed: false, retryAfterSec };
  }
  hits.push(now);
  codeLookupBuckets.set(key, hits);
  return { allowed: true, retryAfterSec: 0 };
}

function safeTimingEqualStrings(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    const ha = createHash('sha256').update(bufA).digest();
    const hb = createHash('sha256').update(bufB).digest();
    timingSafeEqual(ha, hb);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function buildSignedTraineeCookieValue(enrollmentId: string, accessCode: string): string | null {
  const secret = getJwtSecret() || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!secret.trim()) return null;
  const cleanId = String(enrollmentId).trim();
  const cleanCode = String(accessCode).trim().toUpperCase();
  const sig = createHmac('sha256', secret.trim()).update(`trainee:${cleanId}:${cleanCode}`).digest('hex');
  return `${cleanId}.${cleanCode}.${sig}`;
}

function extractVerifiedTraineeCookieCode(req: NextRequest, expectedEnrollmentId: string): string | null {
  const secret = getJwtSecret() || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!secret.trim()) return null;
  const rawCookie = req.cookies.get('teg_trainee_pass')?.value?.trim() || '';
  if (!rawCookie) return null;
  const parts = rawCookie.split('.');
  if (parts.length !== 3) return null;
  const [cookieId, cookieCode, cookieSig] = parts;
  if (!cookieId || !cookieCode || !cookieSig) return null;
  if (cookieId !== expectedEnrollmentId) return null;
  const expectedSig = createHmac('sha256', secret.trim()).update(`trainee:${cookieId}:${cookieCode}`).digest('hex');
  if (!safeTimingEqualStrings(cookieSig, expectedSig)) return null;
  return cookieCode.toUpperCase();
}

async function hydrateStaffStoreUser(req: NextRequest) {
  const serverUser = await getServerUser(req);
  if (!serverUser) return null;
  const role = String(serverUser.role || '').trim().toLowerCase();
  if (role !== 'admin' && role !== 'administrador' && role !== 'supervisor' && (serverUser.store_id === undefined || serverUser.store_id === null)) {
    const numId = Number(serverUser.id);
    if (Number.isFinite(numId) && numId > 0) {
      const { data: dbUser } = await supabaseAdmin.from('users').select('store_id, store_scope').eq('id', numId).maybeSingle();
      if (dbUser) {
        serverUser.store_id = dbUser.store_id ?? serverUser.store_id;
        serverUser.store_scope = dbUser.store_scope ?? serverUser.store_scope;
      }
    }
  }
  return serverUser;
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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawCodeParam = (searchParams.get('code') || '').trim().toUpperCase();
    const codeParam = rawCodeParam.replace(/[^A-Z0-9-]/g, '');
    const storeIdParam = searchParams.get('store_id');
    const statusParam = searchParams.get('status');

    // 1. Consulta por Código de Acceso Temporal (Modo Aprendiz / Tableta) con Rate Limit Anti-Enumeración
    if (codeParam) {
      const ip = extractTrustedIp(req.headers);
      const rl = checkCodeLookupRateLimit(`get-code:${ip}`);
      if (!rl.allowed) {
        return NextResponse.json(
          {
            ok: false,
            code: 'RATE_LIMITED',
            error: `Demasiadas consultas de código. Espera ${rl.retryAfterSec}s antes de volver a intentar.`,
            errorEn: `Too many code lookups. Please wait ${rl.retryAfterSec}s before trying again.`,
          },
          { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
        );
      }

      const normalizedCode = codeParam.startsWith('TG-') ? codeParam : `TG-${codeParam}`;
      const candidates = Array.from(new Set([codeParam, normalizedCode])).filter((c) => c.length >= 4 && c.length <= 24);
      const { data: enrollment, error } = await supabaseAdmin
        .from('training_enrollments')
        .select('*')
        .in('access_code', candidates)
        .limit(1)
        .maybeSingle();

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      if (!enrollment) {
        return NextResponse.json(
          {
            ok: false,
            error: 'Código de entrenamiento no encontrado. Verifica tu código TG-XXXX con tu Manager.',
            errorEn: 'Training code not found. Please verify your TG-XXXX code with your Manager.',
          },
          { status: 404 }
        );
      }

      const now = new Date();
      const expiresAt = new Date(enrollment.expires_at);
      const isExpired = expiresAt.getTime() < now.getTime() && enrollment.status !== 'CERTIFIED';

      if (isExpired) {
        return NextResponse.json(
          {
            ok: false,
            expired: true,
            enrollment,
            error: 'Tu acceso temporal de 4 días ha expirado. Solicita a tu Manager que renueve tu pase.',
            errorEn: 'Your 4-day temporary access has expired. Ask your Manager to extend your pass.',
          },
          { status: 403 }
        );
      }

      await supabaseAdmin
        .from('training_enrollments')
        .update({ last_accessed_at: now.toISOString() })
        .eq('id', enrollment.id);

      const res = NextResponse.json({
        ok: true,
        enrollment: {
          ...enrollment,
          last_accessed_at: now.toISOString(),
        },
      });

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

      return res;
    }

    // 2. Consulta general administrativa (Exige sesión autenticada + aislamiento de sucursal)
    const serverUser = await hydrateStaffStoreUser(req);
    const roleLower = String(serverUser?.role || '').trim().toLowerCase();
    if (!serverUser || !ENROLLMENT_ADMIN_ROLES.has(roleLower)) {
      return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });
    }

    const isGlobal = roleLower === 'admin' || roleLower === 'administrador' || roleLower === 'supervisor';
    let effectiveStoreFilter: number | null = null;

    if (!isGlobal) {
      const ownScope = await authorizeStoreScope(serverUser, serverUser.store_id, supabaseAdmin, { action: 'view' });
      if (!ownScope.authorized || !ownScope.resolvedStoreId) {
        return NextResponse.json({ ok: false, error: ownScope.error || 'Sin sucursal asignada.' }, { status: ownScope.status || 403 });
      }
      if (storeIdParam && storeIdParam !== 'all') {
        const reqCheck = await authorizeStoreScope(serverUser, storeIdParam, supabaseAdmin, { action: 'view' });
        if (!reqCheck.authorized) {
          return NextResponse.json({ ok: false, error: reqCheck.error || 'No autorizado para otra sucursal.' }, { status: reqCheck.status || 403 });
        }
      }
      effectiveStoreFilter = ownScope.resolvedStoreId;
    } else if (storeIdParam && storeIdParam !== 'all') {
      const numericStore = Number(storeIdParam);
      if (!isNaN(numericStore) && numericStore > 0) {
        effectiveStoreFilter = numericStore;
      }
    }

    let query = supabaseAdmin
      .from('training_enrollments')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300);

    if (effectiveStoreFilter) {
      query = query.eq('store_id', effectiveStoreFilter);
    }

    if (statusParam && statusParam !== 'all') {
      query = query.eq('status', statusParam);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const nowMs = Date.now();
    const enriched = (data || []).map((row: any) => {
      const expMs = new Date(row.expires_at).getTime();
      const hoursRemaining = Math.max(0, Math.round((expMs - nowMs) / (1000 * 60 * 60)));
      const isExpired = expMs < nowMs && row.status === 'IN_PROGRESS';
      return {
        ...row,
        hours_remaining: hoursRemaining,
        is_expired: isExpired,
      };
    });

    return NextResponse.json({
      ok: true,
      enrollments: enriched,
    });
  } catch (err: any) {
    console.error('[GET /api/training/enrollments] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error al consultar entrenamientos' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const serverUser = await hydrateStaffStoreUser(req);
    if (!serverUser || !ENROLLMENT_ADMIN_ROLES.has(String(serverUser.role || '').trim().toLowerCase())) {
      return NextResponse.json({ ok: false, error: 'No autenticado.' }, { status: 401 });
    }

    const body = await req.json();
    const employeeName = String(body.employeeName || '').trim();
    const storeId = Number(body.storeId);
    const positionKey = String(body.positionKey || '').trim();
    const trainerName = String(body.trainerName || 'Manager de Turno').trim();
    const parsedEmpId = Number(body.employeeId);
    const employeeId =
      body.employeeId && Number.isInteger(parsedEmpId) && parsedEmpId > 0
        ? parsedEmpId
        : null;
    const employeePhone = body.employeePhone ? String(body.employeePhone).trim() : null;
    const durationDays = Math.max(1, Math.min(14, Number(body.durationDays || 4)));

    if (!employeeName || !storeId || isNaN(storeId) || !positionKey) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Nombre del empleado, sucursal y estación de trabajo son obligatorios.',
        },
        { status: 400 }
      );
    }

    const scopeCheck = await authorizeStoreScope(serverUser, storeId, supabaseAdmin, { action: 'complete_checklist' });
    if (!scopeCheck.authorized) {
      return NextResponse.json(
        { ok: false, error: scopeCheck.error || 'No autorizado para inscribir en otra sucursal.' },
        { status: scopeCheck.status || 403 }
      );
    }

    // Obtener nombre limpio de la sucursal desde public.stores
    let storeName = String(body.storeName || '').trim();
    if (!storeName) {
      const { data: storeRow } = await supabaseAdmin
        .from('stores')
        .select('name')
        .eq('id', storeId)
        .maybeSingle();
      storeName = formatStoreName(storeRow?.name || `Sucursal #${storeId}`);
    }

    const safeIlikeName = employeeName.replace(/[\\%_]/g, '\\$&');
    const { data: existingEnrollment } = await supabaseAdmin
      .from('training_enrollments')
      .select('*')
      .eq('store_id', storeId)
      .ilike('employee_name', safeIlikeName)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingEnrollment) {
      const expMs = new Date(existingEnrollment.expires_at).getTime();
      const needsRefresh = expMs < Date.now() && existingEnrollment.status !== 'CERTIFIED';
      const needsStationUpdate = positionKey && existingEnrollment.position_key !== positionKey;
      if (needsRefresh || needsStationUpdate) {
        const refreshedExp = needsRefresh
          ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString()
          : existingEnrollment.expires_at;
        const { data: refreshed } = await supabaseAdmin
          .from('training_enrollments')
          .update({
            expires_at: refreshedExp,
            status: needsRefresh ? 'IN_PROGRESS' : existingEnrollment.status,
            position_key: positionKey || existingEnrollment.position_key,
            trainer_name: trainerName || existingEnrollment.trainer_name,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingEnrollment.id)
          .select('*')
          .single();
        return NextResponse.json({
          ok: true,
          enrollment: refreshed || existingEnrollment,
          existed: true,
        });
      }
      return NextResponse.json({
        ok: true,
        enrollment: existingEnrollment,
        existed: true,
      });
    }

    // Generar código temporal único TG-XXXX
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

    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const insertPayload = {
      access_code: accessCode,
      employee_name: employeeName,
      employee_id: employeeId,
      employee_phone: employeePhone,
      store_id: storeId,
      store_name: storeName,
      position_key: positionKey,
      trainer_name: trainerName,
      current_day: 1,
      status: 'IN_PROGRESS',
      day1_completed: false,
      day1_videos_watched: [],
      day2_completed: false,
      day2_supervised_reps: 0,
      day2_checklist_json: {},
      day3_completed: false,
      day3_solo_reps: 0,
      day3_checklist_json: {},
      day4_completed: false,
      expires_at: expiresAt,
    };

    const { data, error } = await supabaseAdmin
      .from('training_enrollments')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      enrollment: data,
    });
  } catch (err: any) {
    console.error('[POST /api/training/enrollments] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error creando inscripción de entrenamiento' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const id = String(body.id || '').trim();
    const action = String(body.action || 'update_progress').trim();
    const normalizedAction = action.toLowerCase();

    const requiresManagerOrAdminCertAuth =
      normalizedAction === 'certify_day4' ||
      normalizedAction === 'extend_access' ||
      body.day4_completed !== undefined ||
      body.day4Completed !== undefined ||
      body.certificate_folio !== undefined ||
      body.certificateFolio !== undefined ||
      body.examScore !== undefined ||
      body.practicalScore !== undefined ||
      (typeof body.status === 'string' && body.status.trim().toUpperCase() === 'CERTIFIED');

    const staffAuth = verifyStaffAuth(req, {
      allowedRoles: requiresManagerOrAdminCertAuth ? DAY4_CERTIFICATION_ROLES : undefined,
      allowCron: false,
    });

    if (requiresManagerOrAdminCertAuth && !staffAuth.authorized) {
      return staffAuth.response!;
    }

    if (!id) {
      return NextResponse.json(
        { ok: false, error: 'ID de inscripción requerido.' },
        { status: 400 }
      );
    }

    // Si no tiene sesión de staff, exigir código TG-XXXX no vacío ANTES de consultar DB + aplicar rate limit por IP
    let providedCodeRaw = '';
    if (!staffAuth.authorized) {
      providedCodeRaw = String(body.accessCode || body.code || '').trim().toUpperCase();
      if (!providedCodeRaw) {
        providedCodeRaw = extractVerifiedTraineeCookieCode(req, id) || '';
      }
      if (!providedCodeRaw) {
        return NextResponse.json(
          {
            ok: false,
            error: 'No autenticado: se requiere sesión de personal o código de acceso TG-XXXX válido.',
          },
          { status: 401 }
        );
      }

      const ip = extractTrustedIp(req.headers);
      const putRl = checkCodeLookupRateLimit(`put-code:${ip}`, 15, CODE_LOOKUP_WINDOW_MS);
      if (!putRl.allowed) {
        return NextResponse.json(
          {
            ok: false,
            code: 'RATE_LIMITED',
            error: `Demasiados intentos. Espera ${putRl.retryAfterSec}s.`,
          },
          { status: 429, headers: { 'Retry-After': String(putRl.retryAfterSec) } }
        );
      }
    }

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('training_enrollments')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !existing) {
      return NextResponse.json(
        { ok: false, error: 'Inscripción no encontrada.' },
        { status: 404 }
      );
    }

    if (staffAuth.authorized && staffAuth.user) {
      const serverUser = (await hydrateStaffStoreUser(req)) || {
        id: staffAuth.user.id,
        email: staffAuth.user.email,
        name: staffAuth.user.user_metadata?.full_name || staffAuth.user.email,
        role: staffAuth.user.role,
        store_id: staffAuth.user.user_metadata?.store_id,
        store_ids: staffAuth.user.user_metadata?.store_ids,
        store_scope: staffAuth.user.user_metadata?.store_scope,
      };
      const storeScopeCheck = await authorizeStoreScope(
        serverUser,
        existing.store_id,
        supabaseAdmin,
        { requireWrite: requiresManagerOrAdminCertAuth, action: requiresManagerOrAdminCertAuth ? undefined : 'complete_checklist' }
      );
      if (!storeScopeCheck.authorized) {
        return NextResponse.json(
          { ok: false, error: storeScopeCheck.error || 'No autorizado para esta sucursal.' },
          { status: storeScopeCheck.status }
        );
      }
    } else {
      // Flujo de aprendiz (Día 1–3): exige coincidencia criptográfica constante de código TG-XXXX vigente
      const storedCode = String(existing.access_code || '').trim().toUpperCase();
      if (!/^TG-[A-Z0-9]{4,}$/.test(storedCode)) {
        return NextResponse.json(
          { ok: false, error: 'Código temporal TG-XXXX inválido para esta inscripción.' },
          { status: 403 }
        );
      }
      const normalizedProvided = providedCodeRaw.startsWith('TG-') ? providedCodeRaw : `TG-${providedCodeRaw}`;
      const codeMatches =
        safeTimingEqualStrings(providedCodeRaw, storedCode) ||
        safeTimingEqualStrings(normalizedProvided, storedCode);

      if (!codeMatches) {
        return NextResponse.json(
          { ok: false, error: 'Código de acceso TG-XXXX no coincide con la inscripción.' },
          { status: 403 }
        );
      }
      const expMs = new Date(existing.expires_at).getTime();
      if (isNaN(expMs) || expMs < Date.now() || existing.status === 'EXPIRED') {
        return NextResponse.json(
          { ok: false, expired: true, error: 'Tu pase temporal TG-XXXX ha expirado. Solicita renovación a tu Manager.' },
          { status: 403 }
        );
      }
      if (existing.status === 'CERTIFIED') {
        return NextResponse.json(
          { ok: false, error: 'Esta inscripción ya se encuentra certificada.' },
          { status: 403 }
        );
      }
    }

    const nowIso = new Date().toISOString();
    const patch: Record<string, any> = {
      updated_at: nowIso,
    };

    if (action === 'complete_day1') {
      const quizScore = Math.max(0, Math.min(100, Number(body.quizScore ?? existing.day1_quiz_score ?? 100)));
      const incomingWatched = Array.isArray(body.videosWatched) ? body.videosWatched.map(String) : [];
      const existingWatched = Array.isArray(existing.day1_videos_watched)
        ? existing.day1_videos_watched.map(String)
        : [];
      const mergedWatched = Array.from(new Set([...existingWatched, ...incomingWatched]));

      patch.day1_quiz_score = quizScore;
      patch.day1_videos_watched = mergedWatched;
      if (quizScore >= 80 || existing.day1_completed) {
        patch.day1_completed = true;
        patch.day1_completed_at = existing.day1_completed_at || nowIso;
        patch.current_day = Math.max(Number(existing.current_day || 1), 2);
      } else {
        patch.day1_completed = false;
      }
    } else if (action === 'complete_day2') {
      patch.day2_completed = true;
      patch.day2_completed_at = nowIso;
      patch.day2_supervised_reps = Number(body.supervisedReps ?? existing.day2_supervised_reps ?? 5);
      if (body.checklistJson) patch.day2_checklist_json = body.checklistJson;
      if (body.supervisorNotes !== undefined) patch.day2_supervisor_notes = String(body.supervisorNotes);
      patch.day2_approved_by = String(body.approvedBy || existing.trainer_name || 'Manager');
      patch.current_day = Math.max(Number(existing.current_day || 2), 3);
    } else if (action === 'complete_day3') {
      patch.day3_completed = true;
      patch.day3_completed_at = nowIso;
      patch.day3_solo_reps = Number(body.soloReps ?? existing.day3_solo_reps ?? 5);
      if (body.bestTimeSeconds !== undefined && body.bestTimeSeconds !== null) {
        patch.day3_best_time_seconds = Number(body.bestTimeSeconds);
      }
      if (body.checklistJson) patch.day3_checklist_json = body.checklistJson;
      patch.day3_approved_by = String(body.approvedBy || existing.trainer_name || 'Manager');
      patch.current_day = Math.max(Number(existing.current_day || 3), 4);
    } else if (action === 'certify_day4') {
      const examScore = Math.min(100, Math.max(0, Number(body.examScore ?? 100)));
      const practicalScore = Math.min(100, Math.max(0, Number(body.practicalScore ?? 100)));
      const finalScore = Math.round((examScore + practicalScore) / 2);
      const passed = finalScore >= 90;

      patch.day4_exam_score = examScore;
      patch.day4_practical_score = practicalScore;
      patch.day4_final_score = finalScore;
      patch.day4_certified_by = String(body.certifiedBy || existing.trainer_name || 'Manager');

      if (passed) {
        patch.day4_completed = true;
        patch.day4_completed_at = nowIso;
        patch.status = 'CERTIFIED';
        patch.current_day = 4;
        patch.certificate_folio =
          existing.certificate_folio || generateCertificateFolio(Number(existing.store_id || 1));
      } else {
        patch.day4_completed = false;
        patch.status = 'NEEDS_REINFORCEMENT';
      }
    } else if (action === 'extend_access') {
      const extraDays = Math.max(1, Math.min(14, Number(body.extraDays || 4)));
      const baseMs = Math.max(Date.now(), new Date(existing.expires_at).getTime());
      patch.expires_at = new Date(baseMs + extraDays * 24 * 60 * 60 * 1000).toISOString();
      if (existing.status === 'EXPIRED') {
        patch.status = 'IN_PROGRESS';
      }
    } else {
      if (Array.isArray(body.day1VideosWatched)) {
        patch.day1_videos_watched = body.day1VideosWatched;
      }
      if (body.day1QuizScore !== undefined) {
        patch.day1_quiz_score = Number(body.day1QuizScore);
      }
      if (body.day2SupervisedReps !== undefined) {
        patch.day2_supervised_reps = Number(body.day2SupervisedReps);
      }
      if (body.day2ChecklistJson !== undefined) {
        patch.day2_checklist_json = body.day2ChecklistJson;
      }
      if (body.day2SupervisorNotes !== undefined) {
        patch.day2_supervisor_notes = String(body.day2SupervisorNotes);
      }
      if (body.day3SoloReps !== undefined) {
        patch.day3_solo_reps = Number(body.day3SoloReps);
      }
      if (body.day3BestTimeSeconds !== undefined) {
        patch.day3_best_time_seconds = Number(body.day3BestTimeSeconds);
      }
      if (body.day3ChecklistJson !== undefined) {
        patch.day3_checklist_json = body.day3ChecklistJson;
      }
      if (body.currentDay !== undefined) {
        patch.current_day = Math.max(1, Math.min(4, Number(body.currentDay)));
      }
    }

    const { data: updated, error: upErr } = await supabaseAdmin
      .from('training_enrollments')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      enrollment: updated,
    });
  } catch (err: any) {
    console.error('[PUT /api/training/enrollments] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error actualizando progreso de entrenamiento' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const serverUser = await hydrateStaffStoreUser(req);
    if (!serverUser || !ENROLLMENT_ADMIN_ROLES.has(String(serverUser.role || '').trim().toLowerCase())) {
      return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = (searchParams.get('id') || '').trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: 'ID requerido' }, { status: 400 });
    }

    const { data: target } = await supabaseAdmin
      .from('training_enrollments')
      .select('id, store_id')
      .eq('id', id)
      .maybeSingle();

    if (!target) {
      return NextResponse.json({ ok: false, error: 'Inscripción no encontrada.' }, { status: 404 });
    }

    const scopeCheck = await authorizeStoreScope(serverUser, target.store_id, supabaseAdmin, { requireWrite: true });
    if (!scopeCheck.authorized) {
      return NextResponse.json(
        { ok: false, error: scopeCheck.error || 'No autorizado para eliminar registros de otra sucursal.' },
        { status: scopeCheck.status || 403 }
      );
    }

    const { error } = await supabaseAdmin
      .from('training_enrollments')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[DELETE /api/training/enrollments] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error eliminando registro' },
      { status: 500 }
    );
  }
}
