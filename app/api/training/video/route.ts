/**
 * @module app/api/training/video/route
 * @description Endpoint para subir, reemplazar o eliminar el video SOP de cualquier categoría o producto con receta
 * en el Módulo TRAINING (Academia SOP Tacos Gavilan), soportando subida directa firmada a Supabase Storage
 * (sin límite de 4.5 MB de Vercel Serverless) y adaptación automática de Voz IA (`Orus`) en ES/EN.
 *
 * @businessRules
 * - Exige usuario autenticado con rol autorizado (`admin`, `supervisor`, `manager`, `asistente`, `assistant`, `gerente`).
 * - Soporta flujo en 2 pasos para archivos reales pesados (`5–100 MB` `.mp4`/`.mov`/`.webm`):
 *   1) `POST` JSON `{ action: 'create-upload-url', slug, fileName, contentType }` -> firma URL temporal en `training-media`.
 *   2) El navegador sube directo vía `PUT` a `signedUrl`.
 *   3) `POST` JSON `{ action: 'finalize-upload', slug, publicUrl, durationSeconds, ... }` -> analiza el video cuadro por cuadro con Gemini Multimodal, genera pasos/porciones/quiz y sintetiza voz IA (`Orus`) en ES/EN.
 * - Soporta también `{ action: 'reprocess-video', slug }` para que el ADMIN pueda volver a analizar cualquier video ya subido con Gemini Vision y regenerar voz IA.
 * - Mantiene compatibilidad `multipart/form-data` para archivos pequeños (`< 4.5 MB`).
 * - Garantiza segmentos de tiempo válidos (`0 <= startSec < endSec`) incluso en videos cortos.
 *
 * @dataFlow
 * - `POST /api/training/video` -> Supabase Storage (`training-media`) -> `analyzeTrainingVideoWithGemini` -> `training_sop_modules` + TTS (`Orus`)
 * - `DELETE /api/training/video?slug=...` -> Marca el video como eliminado en `training_sop_modules`
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getServerUser } from '@/lib/auth-server';
import {
  DEFAULT_FOUR_DAY_METHOD,
  TRAINING_SOP_VIDEOS,
  TrainingVideoStep,
} from '@/lib/training-sop-catalog';
import {
  DEFAULT_TRAINING_VOICE,
  ensureTrainingBucket,
  getTrainingStepSpeech,
  TRAINING_MEDIA_BUCKET,
} from '@/lib/training-tts';
import {
  analyzeTrainingVideoWithGemini,
  cleanRecipeIngredients,
} from '@/lib/training-video-analyzer';

export const maxDuration = 60;

const ALLOWED_VIDEO_ROLES = new Set([
  'admin',
  'supervisor',
  'manager',
  'asistente',
  'assistant',
  'gerente',
]);

const ALLOWED_VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v']);

function sanitizeSlug(rawSlug: string): string {
  return String(rawSlug || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function formatSecLabel(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

function buildTimedSteps(
  slug: string,
  titleEs: string,
  titleEn: string,
  durationSeconds: number,
  existingSteps: TrainingVideoStep[],
  ingredients: Array<{ name: string; quantity: number; unit: string }>
): { steps: TrainingVideoStep[]; normalizedDuration: number } {
  const rawDur = Math.max(10, Math.round(Number(durationSeconds) || 45));

  if (existingSteps.length === 0 && ingredients.length > 0) {
    const count = ingredients.length;
    const effectiveDur = Math.max(rawDur, count * 3);
    const segLen = effectiveDur / count;
    const steps = ingredients.map((ing, idx) => {
      const startSec = Math.round(idx * segLen);
      const nextEdge = idx === count - 1 ? effectiveDur : Math.round((idx + 1) * segLen);
      const endSec = Math.max(startSec + 2, nextEdge);
      return {
        id: `${slug}-step-${idx + 1}`,
        stepNumber: idx + 1,
        startSec,
        endSec,
        timestampLabel: `${formatSecLabel(startSec)} - ${formatSecLabel(endSec)}`,
        titleEs: `Paso ${idx + 1}: ${ing.name}`,
        titleEn: `Step ${idx + 1}: ${ing.name}`,
        narrationEs: `Paso ${idx + 1} para ${titleEs}: sirve exactamente ${ing.quantity} ${ing.unit} de ${ing.name}.`,
        narrationEn: `Step ${idx + 1} for ${titleEn}: serve exactly ${ing.quantity} ${ing.unit} of ${ing.name}.`,
        keyPortionEs: `${ing.quantity} ${ing.unit} ${ing.name}`,
        keyPortionEn: `${ing.quantity} ${ing.unit} ${ing.name}`,
        utensilEs: ing.unit === 'oz' ? 'Porcionador oficial' : 'Pinza / Mano enguantada',
        utensilEn: ing.unit === 'oz' ? 'Official scoop' : 'Tongs / Gloved hand',
      };
    });
    return { steps, normalizedDuration: effectiveDur };
  }

  if (existingSteps.length > 0) {
    const count = existingSteps.length;
    const effectiveDur = Math.max(rawDur, count * 3);
    const segLen = effectiveDur / count;
    const steps = existingSteps.map((st, idx) => {
      const startSec = Math.round(idx * segLen);
      const nextEdge = idx === count - 1 ? effectiveDur : Math.round((idx + 1) * segLen);
      const endSec = Math.max(startSec + 2, nextEdge);
      return {
        ...st,
        id: st.id || `${slug}-step-${idx + 1}`,
        stepNumber: idx + 1,
        startSec,
        endSec,
        timestampLabel: `${formatSecLabel(startSec)} - ${formatSecLabel(endSec)}`,
      };
    });
    return { steps, normalizedDuration: effectiveDur };
  }

  return { steps: [], normalizedDuration: rawDur };
}

function extractMp4DurationSeconds(buf: Buffer): number | null {
  try {
    const idx = buf.indexOf('mvhd');
    if (idx > 0 && idx + 28 < buf.length) {
      const ver = buf[idx + 4];
      const ts = buf.readUInt32BE(idx + (ver === 1 ? 24 : 16));
      const d = ver === 1 ? Number(buf.readBigUInt64BE(idx + 28)) : buf.readUInt32BE(idx + 20);
      if (ts > 0 && d > 0) {
        return Math.max(10, Math.round(d / ts));
      }
    }
  } catch {
    // Non-MP4 or fragmented WebM container
  }
  return null;
}

async function loadVideoBytesFromUrl(publicVideoUrl: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    if (publicVideoUrl.startsWith('/training/videos/')) {
      const localPath = path.resolve(process.cwd(), 'public', publicVideoUrl.replace(/^\/+/, ''));
      const buf = await fs.readFile(localPath);
      return { buffer: buf, mimeType: 'video/mp4' };
    }
    const marker = `/${TRAINING_MEDIA_BUCKET}/`;
    const mIdx = publicVideoUrl.indexOf(marker);
    if (mIdx >= 0) {
      const storagePath = decodeURIComponent(publicVideoUrl.slice(mIdx + marker.length).split('?')[0]);
      const { data: blobData, error } = await supabaseAdmin.storage
        .from(TRAINING_MEDIA_BUCKET)
        .download(storagePath);
      if (!error && blobData) {
        const arr = Buffer.from(await blobData.arrayBuffer());
        return { buffer: arr, mimeType: blobData.type || 'video/mp4' };
      }
    }
    const res = await fetch(publicVideoUrl, { signal: AbortSignal.timeout(25000) });
    if (res.ok) {
      const arr = Buffer.from(await res.arrayBuffer());
      return { buffer: arr, mimeType: res.headers.get('content-type') || 'video/mp4' };
    }
  } catch (err) {
    console.warn('[loadVideoBytesFromUrl] Could not load video bytes:', err);
  }
  return null;
}

async function finalizeVideoModuleRecord(params: {
  slug: string;
  titleEs: string;
  titleEn: string;
  positionKey: string;
  durationSeconds: number;
  ingredients: Array<{ name: string; quantity: number; unit: string; type?: string }>;
  publicVideoUrl: string;
  sourceVideoFilename: string;
  autoAdaptVoice: boolean;
  analyzeWithAi?: boolean;
  videoBuffer?: Buffer | null;
  mimeType?: string;
}) {
  const {
    slug,
    titleEs,
    titleEn,
    positionKey,
    durationSeconds,
    ingredients,
    publicVideoUrl,
    sourceVideoFilename,
    autoAdaptVoice,
    analyzeWithAi = true,
    videoBuffer,
    mimeType = 'video/mp4',
  } = params;

  const baseModule = TRAINING_SOP_VIDEOS.find((m) => m.slug === slug);
  const { data: existingRow } = await supabaseAdmin
    .from('training_sop_modules')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  const cleanedIngredients = cleanRecipeIngredients(ingredients);

  // Obtener bytes del video si deseamos análisis multimodal con Gemini
  let loadedBytes: { buffer: Buffer; mimeType: string } | null = videoBuffer
    ? { buffer: videoBuffer, mimeType }
    : null;
  if (!loadedBytes && analyzeWithAi && publicVideoUrl && publicVideoUrl !== 'DELETED') {
    loadedBytes = await loadVideoBytesFromUrl(publicVideoUrl);
  }

  const exactContainerDur = loadedBytes ? extractMp4DurationSeconds(loadedBytes.buffer) : null;
  const effectiveDurationSec = exactContainerDur || Math.max(10, Math.round(Number(durationSeconds) || 45));

  const aiAnalysis =
    analyzeWithAi && loadedBytes && loadedBytes.buffer.byteLength <= 95 * 1024 * 1024
      ? await analyzeTrainingVideoWithGemini({
          videoBuffer: loadedBytes.buffer,
          mimeType: loadedBytes.mimeType,
          slug,
          titleEs: titleEs || existingRow?.title_es || baseModule?.titleEs || slug,
          titleEn: titleEn || existingRow?.title_en || baseModule?.titleEn || slug,
          durationSeconds: effectiveDurationSec,
          ingredients: cleanedIngredients,
        })
      : null;

  const hasAiSteps = Boolean(aiAnalysis && aiAnalysis.steps.length > 0);
  const existingSteps: TrainingVideoStep[] =
    Array.isArray(existingRow?.steps_json) && existingRow.steps_json.length > 0
      ? existingRow.steps_json
      : baseModule?.steps || [];

  const fallbackTimed = !hasAiSteps
    ? buildTimedSteps(
        slug,
        titleEs,
        titleEn,
        effectiveDurationSec,
        existingSteps,
        cleanedIngredients
      )
    : null;

  let stepsToSave: TrainingVideoStep[] = hasAiSteps
    ? aiAnalysis!.steps
    : fallbackTimed!.steps;
  const normalizedDuration = hasAiSteps ? effectiveDurationSec : fallbackTimed!.normalizedDuration;

  if (autoAdaptVoice && stepsToSave.length > 0) {
    // Sintetizar en paralelo acotado para evitar timeouts de serverless
    stepsToSave = await Promise.all(
      stepsToSave.map(async (st) => {
        let audioUrlEs = hasAiSteps ? undefined : st.audioUrlEs;
        let audioUrlEn = hasAiSteps ? undefined : st.audioUrlEn;

        const [resEs, resEn] = await Promise.allSettled([
          st.narrationEs && !audioUrlEs
            ? getTrainingStepSpeech(st.narrationEs, 'es', DEFAULT_TRAINING_VOICE)
            : Promise.resolve(null),
          st.narrationEn && !audioUrlEn
            ? getTrainingStepSpeech(st.narrationEn, 'en', DEFAULT_TRAINING_VOICE)
            : Promise.resolve(null),
        ]);

        if (resEs.status === 'fulfilled' && resEs.value) {
          audioUrlEs = resEs.value.publicUrl;
        }
        if (resEn.status === 'fulfilled' && resEn.value) {
          audioUrlEn = resEn.value.publicUrl;
        }
        return { ...st, audioUrlEs, audioUrlEn };
      })
    );
  }

  const recipeSpecsToSave =
    aiAnalysis && aiAnalysis.recipeSpecs.length > 0
      ? aiAnalysis.recipeSpecs
      : Array.isArray(existingRow?.recipe_specs_json) && existingRow.recipe_specs_json.length > 0
      ? existingRow.recipe_specs_json
      : baseModule?.recipeSpecs ||
        cleanedIngredients.map((ing) => ({
          itemEs: ing.name,
          itemEn: ing.name,
          quantity: String(ing.quantity),
          unit: ing.unit,
          utensilEs: ing.unit === 'oz' ? 'Medida oficial' : 'Estándar de línea',
          utensilEn: ing.unit === 'oz' ? 'Official measure' : 'Line standard',
        }));

  const quizToSave =
    aiAnalysis && aiAnalysis.quiz.length > 0
      ? aiAnalysis.quiz
      : existingRow?.quiz_json || baseModule?.quiz || [];

  const upsertPayload = {
    slug,
    position_key: positionKey || existingRow?.position_key || baseModule?.positionKey || 'BURRITOS',
    group_key: existingRow?.group_key || baseModule?.groupKey || 'cocina',
    title_es:
      (aiAnalysis?.titleEs && aiAnalysis.titleEs.length > 3 ? aiAnalysis.titleEs : null) ||
      titleEs ||
      existingRow?.title_es ||
      baseModule?.titleEs ||
      slug,
    title_en:
      (aiAnalysis?.titleEn && aiAnalysis.titleEn.length > 3 ? aiAnalysis.titleEn : null) ||
      titleEn ||
      existingRow?.title_en ||
      baseModule?.titleEn ||
      slug,
    subtitle_es:
      aiAnalysis?.subtitleEs ||
      existingRow?.subtitle_es ||
      baseModule?.subtitleEs ||
      `Procedimiento oficial de ${titleEs}`,
    subtitle_en:
      aiAnalysis?.subtitleEn ||
      existingRow?.subtitle_en ||
      baseModule?.subtitleEn ||
      `Official procedure for ${titleEn}`,
    source_video_filename: sourceVideoFilename,
    video_slug: slug,
    video_url: publicVideoUrl,
    duration_seconds: normalizedDuration,
    target_prep_seconds:
      aiAnalysis?.targetPrepSeconds ||
      existingRow?.target_prep_seconds ||
      baseModule?.targetPrepSeconds ||
      normalizedDuration,
    grill_temp_fahrenheit:
      aiAnalysis?.grillTempFahrenheit ??
      existingRow?.grill_temp_fahrenheit ??
      baseModule?.grillTempFahrenheit ??
      null,
    steps_json: stepsToSave,
    recipe_specs_json: recipeSpecsToSave,
    quiz_json: quizToSave,
    day_plan_json: existingRow?.day_plan_json || baseModule?.dayPlan || DEFAULT_FOUR_DAY_METHOD,
    voice_id: DEFAULT_TRAINING_VOICE,
    sort_order: existingRow?.sort_order ?? baseModule?.sortOrder ?? 50,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  const { data: savedRow, error: saveErr } = await supabaseAdmin
    .from('training_sop_modules')
    .upsert(upsertPayload, { onConflict: 'slug' })
    .select('*')
    .single();

  if (saveErr) throw saveErr;

  return { savedRow, stepsToSave, analyzedWithAi: Boolean(aiAnalysis) };
}

export async function POST(req: NextRequest) {
  try {
    const serverUser = await getServerUser(req);
    if (!serverUser) {
      return NextResponse.json({ ok: false, error: 'No autenticado.' }, { status: 401 });
    }
    if (!ALLOWED_VIDEO_ROLES.has(String(serverUser.role || '').trim().toLowerCase())) {
      return NextResponse.json(
        { ok: false, error: 'Sin permiso para subir o modificar videos SOP.' },
        { status: 403 }
      );
    }

    const contentType = req.headers.get('content-type') || '';

    // Flujo recomendado para archivos grandes (> 4.5 MB): URL firmada directa a Supabase Storage
    if (contentType.includes('application/json')) {
      const body = await req.json();
      const action = String(body?.action || '').trim();
      const safeSlug = sanitizeSlug(body?.slug || '');

      if (!safeSlug) {
        return NextResponse.json(
          { ok: false, error: 'Falta el identificador del producto (slug).' },
          { status: 400 }
        );
      }

      if (action === 'create-upload-url') {
        const rawFileName = String(body?.fileName || 'video.mp4');
        const extRaw = (rawFileName.split('.').pop() || 'mp4')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '');
        if (!ALLOWED_VIDEO_EXTS.has(extRaw)) {
          return NextResponse.json(
            { ok: false, error: 'Formato no válido. Usa un archivo .mp4, .mov o .webm.' },
            { status: 400 }
          );
        }

        await ensureTrainingBucket();
        const storagePath = `videos/${safeSlug}-${Date.now()}.${extRaw}`;
        const { data: signedData, error: signErr } = await supabaseAdmin.storage
          .from(TRAINING_MEDIA_BUCKET)
          .createSignedUploadUrl(storagePath);

        if (signErr || !signedData?.signedUrl) {
          throw new Error(`No se pudo generar URL de subida: ${signErr?.message || 'Storage error'}`);
        }

        const { data: pubData } = supabaseAdmin.storage
          .from(TRAINING_MEDIA_BUCKET)
          .getPublicUrl(storagePath);

        return NextResponse.json({
          ok: true,
          signedUrl: signedData.signedUrl,
          token: signedData.token,
          path: storagePath,
          publicUrl: pubData.publicUrl,
        });
      }

      if (action === 'finalize-upload') {
        const publicUrl = String(body?.publicUrl || '').trim();
        if (!publicUrl || !publicUrl.includes(`/${TRAINING_MEDIA_BUCKET}/`)) {
          return NextResponse.json(
            { ok: false, error: 'URL pública de video inválida.' },
            { status: 400 }
          );
        }

        const titleEs = String(body?.titleEs || safeSlug).trim();
        const titleEn = String(body?.titleEn || titleEs).trim();
        const positionKey = String(body?.positionKey || 'BURRITOS').trim();
        const durationSeconds = Number(body?.durationSeconds || 45);
        const sourceVideoFilename = String(body?.sourceVideoFilename || `${safeSlug}.mp4`).trim();
        const ingredients = Array.isArray(body?.ingredients) ? body.ingredients : [];
        const autoAdaptVoice = body?.autoAdaptVoice !== false;
        const analyzeWithAi = body?.analyzeWithAi !== false;

        const { savedRow, stepsToSave, analyzedWithAi } = await finalizeVideoModuleRecord({
          slug: safeSlug,
          titleEs,
          titleEn,
          positionKey,
          durationSeconds,
          ingredients,
          publicVideoUrl: publicUrl,
          sourceVideoFilename,
          autoAdaptVoice,
          analyzeWithAi,
        });

        return NextResponse.json({
          ok: true,
          videoUrl: publicUrl,
          module: savedRow,
          steps: stepsToSave,
          analyzedWithAi,
        });
      }

      if (action === 'reprocess-video') {
        const baseModule = TRAINING_SOP_VIDEOS.find((m) => m.slug === safeSlug);
        const { data: existingRow } = await supabaseAdmin
          .from('training_sop_modules')
          .select('*')
          .eq('slug', safeSlug)
          .maybeSingle();

        const targetUrl = String(
          existingRow?.video_url || baseModule?.videoUrl || ''
        ).trim();
        if (!targetUrl || targetUrl === 'DELETED') {
          return NextResponse.json(
            { ok: false, error: 'Este producto aún no tiene un video activo para analizar.' },
            { status: 400 }
          );
        }

        const ingredients = Array.isArray(body?.ingredients) ? body.ingredients : [];
        const { savedRow, stepsToSave, analyzedWithAi } = await finalizeVideoModuleRecord({
          slug: safeSlug,
          titleEs: String(body?.titleEs || existingRow?.title_es || baseModule?.titleEs || safeSlug).trim(),
          titleEn: String(body?.titleEn || existingRow?.title_en || baseModule?.titleEn || safeSlug).trim(),
          positionKey: String(
            body?.positionKey || existingRow?.position_key || baseModule?.positionKey || 'BURRITOS'
          ).trim(),
          durationSeconds: Number(
            body?.durationSeconds || existingRow?.duration_seconds || baseModule?.durationSeconds || 45
          ),
          ingredients,
          publicVideoUrl: targetUrl,
          sourceVideoFilename: String(
            existingRow?.source_video_filename || baseModule?.sourceVideoFilename || `${safeSlug}.mp4`
          ).trim(),
          autoAdaptVoice: true,
          analyzeWithAi: true,
        });

        return NextResponse.json({
          ok: true,
          videoUrl: targetUrl,
          module: savedRow,
          steps: stepsToSave,
          analyzedWithAi,
        });
      }

      return NextResponse.json(
        { ok: false, error: 'Acción JSON no soportada.' },
        { status: 400 }
      );
    }

    // Flujo multipart directo (archivos pequeños < 4.5 MB)
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const safeSlug = sanitizeSlug(String(formData.get('slug') || ''));
    const titleEs = String(formData.get('titleEs') || safeSlug).trim();
    const titleEn = String(formData.get('titleEn') || titleEs).trim();
    const positionKey = String(formData.get('positionKey') || 'BURRITOS').trim();
    const durationSeconds = Number(formData.get('durationSeconds') || 45);
    const ingredientsRaw = String(formData.get('ingredientsJson') || '[]');
    const autoAdaptVoice = String(formData.get('autoAdaptVoice') ?? 'true') !== 'false';

    if (!safeSlug) {
      return NextResponse.json(
        { ok: false, error: 'Falta el identificador del producto (slug).' },
        { status: 400 }
      );
    }

    if (!file) {
      return NextResponse.json(
        { ok: false, error: 'Selecciona un archivo de video (.mp4, .webm o .mov) para subir.' },
        { status: 400 }
      );
    }

    const ext = (file.name.split('.').pop() || 'mp4')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    if (!ALLOWED_VIDEO_EXTS.has(ext)) {
      return NextResponse.json(
        { ok: false, error: 'Formato no válido. Usa un archivo .mp4, .mov o .webm.' },
        { status: 400 }
      );
    }

    await ensureTrainingBucket();

    const storagePath = `videos/${safeSlug}-${Date.now()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(TRAINING_MEDIA_BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type || 'video/mp4',
        cacheControl: '3600',
        upsert: true,
      });

    if (uploadErr) {
      throw new Error(`Error subiendo video a Storage: ${uploadErr.message}`);
    }

    const { data: pubData } = supabaseAdmin.storage
      .from(TRAINING_MEDIA_BUCKET)
      .getPublicUrl(storagePath);

    let parsedIngredients: Array<{ name: string; quantity: number; unit: string }> = [];
    try {
      parsedIngredients = JSON.parse(ingredientsRaw);
    } catch {
      parsedIngredients = [];
    }

    const { savedRow, stepsToSave, analyzedWithAi } = await finalizeVideoModuleRecord({
      slug: safeSlug,
      titleEs,
      titleEn,
      positionKey,
      durationSeconds,
      ingredients: parsedIngredients,
      publicVideoUrl: pubData.publicUrl,
      sourceVideoFilename: file.name,
      autoAdaptVoice,
      analyzeWithAi: true,
      videoBuffer: buffer,
      mimeType: file.type || 'video/mp4',
    });

    return NextResponse.json({
      ok: true,
      videoUrl: pubData.publicUrl,
      module: savedRow,
      steps: stepsToSave,
      analyzedWithAi,
    });
  } catch (err: any) {
    console.error('[POST /api/training/video] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error al subir el video de entrenamiento.' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const serverUser = await getServerUser(req);
    if (!serverUser) {
      return NextResponse.json({ ok: false, error: 'No autenticado.' }, { status: 401 });
    }
    if (!ALLOWED_VIDEO_ROLES.has(String(serverUser.role || '').trim().toLowerCase())) {
      return NextResponse.json(
        { ok: false, error: 'Sin permiso para eliminar videos SOP.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const safeSlug = sanitizeSlug(searchParams.get('slug') || '');
    if (!safeSlug) {
      return NextResponse.json(
        { ok: false, error: 'Se requiere el parámetro slug para eliminar el video.' },
        { status: 400 }
      );
    }

    const baseModule = TRAINING_SOP_VIDEOS.find((m) => m.slug === safeSlug);
    const { data: existingRow } = await supabaseAdmin
      .from('training_sop_modules')
      .select('*')
      .eq('slug', safeSlug)
      .maybeSingle();

    const { data: updatedRow, error } = await supabaseAdmin
      .from('training_sop_modules')
      .upsert(
        {
          slug: safeSlug,
          position_key: existingRow?.position_key || baseModule?.positionKey || 'BURRITOS',
          group_key: existingRow?.group_key || baseModule?.groupKey || 'cocina',
          title_es: existingRow?.title_es || baseModule?.titleEs || safeSlug,
          title_en: existingRow?.title_en || baseModule?.titleEn || safeSlug,
          subtitle_es: existingRow?.subtitle_es || baseModule?.subtitleEs || '',
          subtitle_en: existingRow?.subtitle_en || baseModule?.subtitleEn || '',
          source_video_filename: null,
          video_slug: null,
          video_url: 'DELETED',
          duration_seconds: existingRow?.duration_seconds || baseModule?.durationSeconds || 60,
          target_prep_seconds: existingRow?.target_prep_seconds || baseModule?.targetPrepSeconds || 45,
          grill_temp_fahrenheit: existingRow?.grill_temp_fahrenheit ?? baseModule?.grillTempFahrenheit ?? null,
          steps_json: existingRow?.steps_json || baseModule?.steps || [],
          recipe_specs_json: existingRow?.recipe_specs_json || baseModule?.recipeSpecs || [],
          quiz_json: existingRow?.quiz_json || baseModule?.quiz || [],
          day_plan_json: existingRow?.day_plan_json || baseModule?.dayPlan || DEFAULT_FOUR_DAY_METHOD,
          voice_id: existingRow?.voice_id || DEFAULT_TRAINING_VOICE,
          sort_order: existingRow?.sort_order ?? baseModule?.sortOrder ?? 50,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'slug' }
      )
      .select('*')
      .single();

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      message: 'Video eliminado del producto correctamente.',
      module: updatedRow,
    });
  } catch (err: any) {
    console.error('[DELETE /api/training/video] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error al eliminar el video.' },
      { status: 500 }
    );
  }
}
