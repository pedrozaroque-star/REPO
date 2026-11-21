/**
 * @module app/api/training/tts/route
 * @description Endpoint de síntesis de voz neuronal masculina ("Orus" / "Puck") y generación de guiones SOP con IA
 * para el Módulo TRAINING (Academia SOP 4 Días de Tacos Gavilan).
 *
 * @businessRules
 * - Sintetiza narraciones paso a paso con voz masculina neutra, cálida y humana (`Orus` por defecto).
 * - Incluye modo `ai-explain` para que Carlos o un Administrador puedan describir brevemente un paso o platillo
 *   y la IA redacte el guion instructivo bilingüe (ES/EN) respetando los gramajes oficiales de Tacos Gavilan,
 *   generando de inmediato el audio neuronal masculino en Supabase Storage.
 * - `POST` exige sesión válida de personal (`verifyStaffAuth`) o expediente de entrenamiento activo verificado (`enrollmentId + accessCode` vía `crypto.timingSafeEqual`) más límite de tasa por IP.
 *
 * @dataFlow
 * - `GET /api/training/tts?text=...&lang=es|en&voice=Orus` -> Rate Limit -> `getTrainingStepSpeech()` -> stream `audio/wav`
 * - `POST /api/training/tts` `{ text, lang, voice, forceRegenerate, mode, enrollmentId, accessCode }` -> Auth + Rate Limit -> JSON con `publicUrl` o guion mejorado por IA.
 *
 * @notes
 * - Blindaje Paid Tier 1 (2026-11-20): usa `getGeminiKeyPoolWithRemote()`, modelos `3.x` (`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite-preview`, `gemini-3.5-flash`), header `x-goog-api-key` y filtro `!p?.thought`.
 * - Blindaje de Seguridad (2026-11-21): `POST` protegido contra síntesis anónima (exige `verifyStaffAuth` o `enrollmentId + accessCode` vigente) + rate limit por IP acotado en `GET` y `POST`.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_TRAINING_VOICE,
  getTrainingStepSpeech,
  isValidTrainingVoice,
  TrainingTtsLang,
  TrainingVoiceId,
} from '@/lib/training-tts';
import { getGeminiKeyPoolWithRemote } from '@/lib/order-ready-tts';
import { getJwtSecret, getServerUser, verifyStaffAuth } from '@/lib/auth-server';
import { supabaseAdmin } from '@/lib/supabase';

const EXPLAIN_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.5-flash',
] as const;

const ALLOWED_TTS_ADMIN_ROLES = new Set([
  'admin',
  'administrador',
  'supervisor',
  'manager',
  'asistente',
  'assistant',
  'gerente',
  'general_manager',
]);

const MAX_TTS_RATE_BUCKETS = 2000;
const ttsRateBuckets = new Map<string, number[]>();

function extractTrustedIp(headers: Headers): string {
  const vercelFwd = headers.get('x-vercel-forwarded-for') || '';
  const firstVercel = vercelFwd.split(',')[0]?.trim();
  if (firstVercel) return firstVercel.slice(0, 64);
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp.slice(0, 64);
  const fwd = headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0]?.trim().slice(0, 64) || 'unknown';
}

function checkBoundedRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  if (ttsRateBuckets.size >= MAX_TTS_RATE_BUCKETS && !ttsRateBuckets.has(key)) {
    for (const [k, arr] of ttsRateBuckets) {
      const valid = arr.filter((t) => now - t < windowMs);
      if (valid.length === 0) ttsRateBuckets.delete(k);
      else ttsRateBuckets.set(k, valid);
    }
    if (ttsRateBuckets.size >= MAX_TTS_RATE_BUCKETS) {
      const oldest = ttsRateBuckets.keys().next().value;
      if (oldest) ttsRateBuckets.delete(oldest);
    }
  }
  const hits = (ttsRateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    ttsRateBuckets.set(key, hits);
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000));
    return { allowed: false, retryAfterSec };
  }
  hits.push(now);
  ttsRateBuckets.set(key, hits);
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

function parseVerifiedTraineePassCookie(req: NextRequest): { enrollmentId: string; accessCode: string } | null {
  const secret = getJwtSecret() || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!secret.trim()) return null;
  const raw = req.cookies.get('teg_trainee_pass')?.value?.trim() || '';
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [enrollmentId, accessCode, sig] = parts;
  if (!enrollmentId || !accessCode || !sig) return null;
  const expectedSig = createHmac('sha256', secret.trim()).update(`trainee:${enrollmentId}:${accessCode}`).digest('hex');
  if (!safeTimingEqualStrings(sig, expectedSig)) return null;
  return { enrollmentId, accessCode: accessCode.toUpperCase() };
}

async function verifyActiveTraineeAccess(req: NextRequest, body: any): Promise<boolean> {
  const cookieCreds = parseVerifiedTraineePassCookie(req);
  const enrollmentId = String(body?.enrollmentId || body?.id || cookieCreds?.enrollmentId || '').trim();
  const rawCode = String(body?.accessCode || body?.code || cookieCreds?.accessCode || '').trim().toUpperCase();

  if (!enrollmentId || !rawCode) return false;

  const { data: enrollment, error } = await supabaseAdmin
    .from('training_enrollments')
    .select('id, access_code, status, expires_at')
    .eq('id', enrollmentId)
    .maybeSingle();

  if (error || !enrollment) return false;

  const storedCode = String(enrollment.access_code || '').trim().toUpperCase();
  if (!storedCode) return false;

  const normalizedProvided = rawCode.startsWith('TG-') ? rawCode : `TG-${rawCode}`;
  const matches =
    safeTimingEqualStrings(rawCode, storedCode) ||
    safeTimingEqualStrings(normalizedProvided, storedCode);
  if (!matches) return false;

  if (enrollment.status === 'EXPIRED') return false;
  const expMs = new Date(enrollment.expires_at).getTime();
  if (enrollment.status !== 'CERTIFIED' && (!Number.isFinite(expMs) || expMs < Date.now())) {
    return false;
  }

  return true;
}

export async function GET(req: NextRequest) {
  try {
    const ip = extractTrustedIp(req.headers);
    const rl = checkBoundedRateLimit(`train-tts-get:${ip}`, 60, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, code: 'RATE_LIMITED', error: 'Demasiadas solicitudes de audio. Intenta en unos segundos.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }

    const { searchParams } = new URL(req.url);
    const text = (searchParams.get('text') || '').trim();
    const langParam = searchParams.get('lang');
    const lang: TrainingTtsLang = langParam === 'en' ? 'en' : 'es';
    const voiceParam = searchParams.get('voice');
    const voice: TrainingVoiceId = isValidTrainingVoice(voiceParam)
      ? voiceParam
      : DEFAULT_TRAINING_VOICE;
    const force = searchParams.get('regen') === '1';
    const format = searchParams.get('format');

    if (force) {
      const serverUser = await getServerUser(req);
      if (!serverUser || !ALLOWED_TTS_ADMIN_ROLES.has(String(serverUser.role || '').trim().toLowerCase())) {
        return NextResponse.json({ ok: false, error: 'No autorizado para regenerar audio.' }, { status: 401 });
      }
    }

    if (!text || text.length > 1500) {
      return NextResponse.json(
        { ok: false, error: 'Texto inválido o demasiado largo (máx 1500 caracteres).' },
        { status: 400 }
      );
    }

    const result = await getTrainingStepSpeech(text, lang, voice, force);

    if (format === 'json') {
      return NextResponse.json({
        ok: true,
        publicUrl: result.publicUrl,
        storagePath: result.storagePath,
        voice,
        lang,
      });
    }

    return new NextResponse(new Uint8Array(result.wav), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Training-Voice': voice,
        'X-Training-Audio-Url': result.publicUrl,
      },
    });
  } catch (err: any) {
    console.error('[GET /api/training/tts] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error generando voz masculina de entrenamiento' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = extractTrustedIp(req.headers);
    const rl = checkBoundedRateLimit(`train-tts-post:${ip}`, 30, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, code: 'RATE_LIMITED', error: `Demasiadas solicitudes. Espera ${rl.retryAfterSec}s.` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'Cuerpo JSON inválido.' }, { status: 400 });
    }

    const staffAuth = verifyStaffAuth(req, { allowCron: false });
    if (!staffAuth.authorized) {
      const traineeAuthorized = await verifyActiveTraineeAccess(req, body);
      if (!traineeAuthorized) {
        return NextResponse.json(
          {
            ok: false,
            error: 'No autorizado: se requiere sesión de personal o inscripción activa (enrollmentId + accessCode).',
          },
          { status: 401 }
        );
      }
    }

    const mode = body.mode || 'tts';
    const voice: TrainingVoiceId = isValidTrainingVoice(body.voice)
      ? body.voice
      : DEFAULT_TRAINING_VOICE;

    // Modo IA: Generar o perfeccionar explicación de un paso con IA + sintetizar voz masculina (Exclusivo liderazgo)
    if (mode === 'ai-explain') {
      const serverUser = await getServerUser(req);
      if (!serverUser || !ALLOWED_TTS_ADMIN_ROLES.has(String(serverUser.role || '').trim().toLowerCase())) {
        return NextResponse.json({ ok: false, error: 'No autorizado para editar guiones con IA.' }, { status: 401 });
      }

      const dishTitle = String(body.dishTitle || 'Platillo Tacos Gavilan').trim();
      const stepTitle = String(body.stepTitle || 'Paso de preparación').trim();
      const rawHint = String(body.rawHint || body.narrationEs || '').trim();
      const stepNumber = Number(body.stepNumber || 1);

      const keys = await getGeminiKeyPoolWithRemote();
      if (keys.length === 0) {
        return NextResponse.json(
          { ok: false, error: 'No GEMINI_API_KEY configured' },
          { status: 500 }
        );
      }

      const aiPrompt = `Eres el Director de Entrenamiento Operativo (SOP) de Tacos Gavilan.
Redacta la narración hablada para el Paso ${stepNumber} ("${stepTitle}") del módulo "${dishTitle}".
Notas o instrucciones del usuario: "${rawHint}"

Reglas estrictas de Tacos Gavilan:
- Nombre oficial de la marca: estrictamente "Tacos Gavilan".
- La narración será leída por una voz masculina neutra, cálida, clara y humana mientras el empleado nuevo ve el video.
- Sé directo, claro y preciso (entre 22 y 40 palabras).
- Respeta los gramajes oficiales cuando apliquen: Burrito (6 oz carne, 4 oz frijol, 6 oz arroz; Super añade 2.1 oz queso Jack, 2.3 oz aguacate, 1.5 oz crema), Torta (1 telera, 0.6 oz mayonesa, 1.5 oz frijol, 6 oz carne, 2.3 oz aguacate, NUNCA lleva crema), Mulita (1.5 oz carne; Super añade 1.15 oz aguacate, 0.75 oz crema), Quesadilla (6 oz carne; Super añade 1.5 oz crema, 2.3 oz aguacate), Plato (6 oz carne, 4 oz arroz, 4 oz frijol, 2 oz aguacate, 0.15 oz cotija), Taco (2 tortillas maíz, 1.5 oz carne), Plancha (250°F).

Devuelve ÚNICAMENTE un JSON válido con esta estructura exacta (sin markdown):
{"narrationEs":"...","narrationEn":"...","keyPortionEs":"...","keyPortionEn":"..."}`;

      let narrationEs = rawHint;
      let narrationEn = String(body.narrationEn || '').trim();
      let keyPortionEs = String(body.keyPortionEs || '');
      let keyPortionEn = String(body.keyPortionEn || '');

      let generatedOk = false;
      for (const key of keys) {
        let switchKey = false;
        for (const model of EXPLAIN_MODELS) {
          try {
            const res = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
              {
                method: 'POST',
                headers: {
                  'x-goog-api-key': key,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: aiPrompt }] }],
                  generationConfig: { temperature: 0.25 },
                }),
              }
            );
            if (res.ok) {
              const data: any = await res.json();
              const parts = data?.candidates?.[0]?.content?.parts;
              const rawText = Array.isArray(parts)
                ? parts
                    .filter((p: any) => !p?.thought && typeof p?.text === 'string')
                    .map((p: any) => p.text)
                    .join('\n')
                : '';
              const cleaned = rawText.replace(/```json|```/gi, '').trim();
              const parsed = JSON.parse(cleaned);
              if (parsed.narrationEs) narrationEs = parsed.narrationEs;
              if (parsed.narrationEn) narrationEn = parsed.narrationEn;
              if (parsed.keyPortionEs) keyPortionEs = parsed.keyPortionEs;
              if (parsed.keyPortionEn) keyPortionEn = parsed.keyPortionEn;
              generatedOk = true;
              break;
            }
            const errTxt = await res.text().catch(() => '');
            if (
              res.status === 401 ||
              res.status === 402 ||
              res.status === 403 ||
              /quota_limit_value["':\s]*0\b/i.test(errTxt)
            ) {
              switchKey = true;
              break;
            }
          } catch {
            // try next model / key
          }
        }
        if (generatedOk) break;
        if (switchKey) continue;
      }

      const [ttsEs, ttsEn] = await Promise.all([
        narrationEs ? getTrainingStepSpeech(narrationEs, 'es', voice, true) : Promise.resolve(null),
        narrationEn && narrationEn !== narrationEs
          ? getTrainingStepSpeech(narrationEn, 'en', voice, true)
          : Promise.resolve(null),
      ]);

      return NextResponse.json({
        ok: true,
        narrationEs,
        narrationEn: narrationEn || `Step ${stepNumber} for ${dishTitle}: Follow the official Tacos Gavilan preparation standard.`,
        keyPortionEs,
        keyPortionEn,
        audioUrlEs: ttsEs?.publicUrl || undefined,
        audioUrlEn: ttsEn?.publicUrl || undefined,
      });
    }

    // Modo estándar: sintetizar texto específico
    const text = String(body.text || '').trim();
    const lang: TrainingTtsLang = body.lang === 'en' ? 'en' : 'es';
    const forceRegenerate = Boolean(body.forceRegenerate);

    if (forceRegenerate) {
      const serverUser = await getServerUser(req);
      if (!serverUser || !ALLOWED_TTS_ADMIN_ROLES.has(String(serverUser.role || '').trim().toLowerCase())) {
        return NextResponse.json({ ok: false, error: 'No autorizado para regenerar audio.' }, { status: 401 });
      }
    }

    if (!text || text.length > 1500) {
      return NextResponse.json(
        { ok: false, error: 'Texto requerido (máx 1500 caracteres).' },
        { status: 400 }
      );
    }

    const result = await getTrainingStepSpeech(text, lang, voice, forceRegenerate);
    return NextResponse.json({
      ok: true,
      publicUrl: result.publicUrl,
      storagePath: result.storagePath,
      voice,
      lang,
    });
  } catch (err: any) {
    console.error('[POST /api/training/tts] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error en servicio de voz de entrenamiento' },
      { status: 500 }
    );
  }
}
