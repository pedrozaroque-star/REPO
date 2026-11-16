/**
 * @module scripts/process-training-videos
 * @description Herramienta oficial CLI para procesar, auditar, analizar con Gemini Multimodal y
 * sincronizar los videos SOP del Módulo TRAINING de Tacos Gavilan con Supabase Storage (`training-media`),
 * Voz Neural Masculina (`Orus` en ES y EN) y la tabla `public.training_sop_modules`.
 *
 * @businessRules
 * - Modos de ejecución:
 *   1) `--sync-catalog`: Sincroniza los módulos maestros de `lib/training-sop-catalog.ts`, genera sus
 *      audios neuronales frescos (`Orus` ES/EN) y actualiza `public.training_sop_modules`.
 *   2) `--analyze-slug=<slug> [--file=<ruta.mp4>] [--titleEs=...] [--positionKey=...]`: Sube (si se da
 *      `--file`) el `.mp4` a `training-media`, lo analiza cuadro por cuadro con Gemini Multimodal junto
 *      con los ingredientes reales de receta POS en Supabase, sintetiza los `.wav` en `Orus` y guarda todo listo.
 * - Mantiene sincronía exacta de duraciones leyendo el átomo `mvhd` de cada archivo `.mp4`.
 * - Cero mocks: opera directamente contra Gemini API y Supabase Producción (`ywwwdcvgfculqmcfkihq`).
 *
 * @dataFlow
 * Local MP4 / Supabase Storage (`training-media`) -> `analyzeTrainingVideoWithGemini` + `getTrainingStepSpeech` (`Orus`) -> `public.training_sop_modules`
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });

import { supabaseAdmin } from '../lib/supabase';
import {
  DEFAULT_FOUR_DAY_METHOD,
  TRAINING_SOP_VIDEOS,
  type TrainingSopModuleSpec,
  type TrainingVideoStep,
} from '../lib/training-sop-catalog';
import {
  DEFAULT_TRAINING_VOICE,
  ensureTrainingBucket,
  getTrainingStepSpeech,
  TRAINING_MEDIA_BUCKET,
} from '../lib/training-tts';
import {
  analyzeTrainingVideoWithGemini,
  cleanRecipeIngredients,
  type RawRecipeIngredientInput,
} from '../lib/training-video-analyzer';

function getExactMp4Duration(buf: Buffer): number | null {
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
    // Non-MP4 container
  }
  return null;
}

async function synthesizeStepAudioBatch(steps: TrainingVideoStep[]): Promise<TrainingVideoStep[]> {
  const updated: TrainingVideoStep[] = [];
  for (const step of steps) {
    let audioUrlEs = step.audioUrlEs;
    let audioUrlEn = step.audioUrlEn;

    if (step.narrationEs) {
      const esRes = await getTrainingStepSpeech(step.narrationEs, 'es', DEFAULT_TRAINING_VOICE);
      audioUrlEs = esRes.publicUrl;
    }
    if (step.narrationEn) {
      const enRes = await getTrainingStepSpeech(step.narrationEn, 'en', DEFAULT_TRAINING_VOICE);
      audioUrlEn = enRes.publicUrl;
    }

    updated.push({
      ...step,
      audioUrlEs,
      audioUrlEn,
    });
    // Breve pausa para evitar picos por minuto en el pool de llaves TTS
    await new Promise((r) => setTimeout(r, 150));
  }
  return updated;
}

async function fetchPosIngredientsForSlug(slug: string, fallbackTitle: string): Promise<RawRecipeIngredientInput[]> {
  const cleanSearch = fallbackTitle.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
  const { data: items } = await supabaseAdmin
    .from('toast_menu_items')
    .select('guid, name')
    .eq('is_modifier', false)
    .limit(500);

  const match = (items || []).find((m: any) => {
    const mSlug = String(m.name || '')
      .toLowerCase()
      .replace(/\(in store\)/i, '')
      .trim()
      .replace(/[^a-z0-9]+/g, '-');
    return mSlug === slug || mSlug === slug.replace(/^recipe-/, '') || String(m.name || '').toLowerCase() === cleanSearch;
  });

  if (!match?.guid) return [];

  const { data: recipeRows } = await supabaseAdmin
    .from('recipes')
    .select('quantity, unit, type, inventory_item:inventory_items(name, unit_measure)')
    .eq('toast_menu_item_guid', match.guid);

  const mapped: RawRecipeIngredientInput[] = (recipeRows || []).map((r: any) => {
    const inv = Array.isArray(r.inventory_item) ? r.inventory_item[0] : r.inventory_item;
    return {
      name: String(inv?.name || 'Ingrediente').trim(),
      quantity: Number(r.quantity || 1),
      unit: String(r.unit || inv?.unit_measure || 'oz').trim(),
      type: String(r.type || 'food'),
    };
  });

  return cleanRecipeIngredients(mapped);
}

async function syncAllCatalogModules() {
  console.log('=== SINCRONIZANDO 9 MÓDULOS SOP VERIFICADOS Y REGENERANDO VOZ IA (Orus ES + EN) ===');
  await ensureTrainingBucket();

  for (const mod of TRAINING_SOP_VIDEOS) {
    let realDuration = mod.durationSeconds;
    const localVideoName = `${mod.slug}.mp4`;
    const localPath = path.resolve(process.cwd(), 'public', 'training', 'videos', localVideoName);
    try {
      const buf = await fs.readFile(localPath);
      const exact = getExactMp4Duration(buf);
      if (exact) {
        realDuration = exact;
      }
    } catch {
      // Keep catalog duration if local copy is not checked out
    }

    console.log(`\n▶ Procesando [${mod.slug}] (${mod.positionKey}) — Duración=${realDuration}s, Pasos=${mod.steps.length}`);
    const stepsWithFreshVoice = await synthesizeStepAudioBatch(mod.steps);

    const upsertRow = {
      slug: mod.slug,
      position_key: mod.positionKey,
      group_key: mod.groupKey,
      title_es: mod.titleEs,
      title_en: mod.titleEn,
      subtitle_es: mod.subtitleEs,
      subtitle_en: mod.subtitleEn,
      source_video_filename: mod.sourceVideoFilename,
      video_slug: mod.videoSlug,
      video_url: mod.videoUrl,
      duration_seconds: realDuration,
      target_prep_seconds: mod.targetPrepSeconds,
      grill_temp_fahrenheit: mod.grillTempFahrenheit,
      steps_json: stepsWithFreshVoice,
      recipe_specs_json: mod.recipeSpecs,
      quiz_json: mod.quiz,
      day_plan_json: mod.dayPlan || DEFAULT_FOUR_DAY_METHOD,
      voice_id: DEFAULT_TRAINING_VOICE,
      sort_order: mod.sortOrder,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from('training_sop_modules')
      .upsert(upsertRow, { onConflict: 'slug' });

    if (error) {
      throw new Error(`Error guardando ${mod.slug} en Supabase: ${error.message}`);
    }
    console.log(`  ✅ ${mod.slug}: ${stepsWithFreshVoice.length} pasos ES/EN sintetizados con Orus y guardados en DB.`);
  }

  console.log('\n🎉 TODOS LOS MÓDULOS SOP SINCRONIZADOS Y LISTOS CON VOZ IA ACTUALIZADA.');
}

async function analyzeAndSaveSingleSlug(args: Record<string, string>) {
  const slug = String(args['analyze-slug'] || '').trim().toLowerCase();
  if (!slug) {
    throw new Error('Debes indicar --analyze-slug=<slug>');
  }

  await ensureTrainingBucket();
  const baseModule: TrainingSopModuleSpec | undefined = TRAINING_SOP_VIDEOS.find((m) => m.slug === slug);
  const { data: existingRow } = await supabaseAdmin
    .from('training_sop_modules')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  let videoUrl = String(existingRow?.video_url || baseModule?.videoUrl || '').trim();
  let sourceFilename = String(
    existingRow?.source_video_filename || baseModule?.sourceVideoFilename || `${slug}.mp4`
  ).trim();
  let videoBuffer: Buffer | null = null;

  if (args.file) {
    const absFile = path.resolve(process.cwd(), args.file);
    videoBuffer = await fs.readFile(absFile);
    sourceFilename = path.basename(absFile);
    const ext = path.extname(absFile).replace('.', '').toLowerCase() || 'mp4';
    const storagePath = `videos/${slug}-${Date.now()}.${ext}`;
    console.log(`⬆ Subiendo ${sourceFilename} (${(videoBuffer.byteLength / 1048576).toFixed(2)} MB) a Supabase Storage...`);
    const { error: upErr } = await supabaseAdmin.storage
      .from(TRAINING_MEDIA_BUCKET)
      .upload(storagePath, videoBuffer, {
        contentType: ext === 'webm' ? 'video/webm' : ext === 'mov' ? 'video/quicktime' : 'video/mp4',
        cacheControl: '3600',
        upsert: true,
      });
    if (upErr) throw upErr;
    const { data: pubData } = supabaseAdmin.storage.from(TRAINING_MEDIA_BUCKET).getPublicUrl(storagePath);
    videoUrl = pubData.publicUrl;
    console.log(`  ✅ Video subido: ${videoUrl}`);
  } else if (videoUrl) {
    const marker = `/${TRAINING_MEDIA_BUCKET}/`;
    const mIdx = videoUrl.indexOf(marker);
    if (mIdx >= 0) {
      const storagePath = decodeURIComponent(videoUrl.slice(mIdx + marker.length).split('?')[0]);
      const { data: blobData, error } = await supabaseAdmin.storage.from(TRAINING_MEDIA_BUCKET).download(storagePath);
      if (error || !blobData) throw new Error(`No se pudo descargar ${storagePath} desde Storage`);
      videoBuffer = Buffer.from(await blobData.arrayBuffer());
    } else {
      const res = await fetch(videoUrl);
      videoBuffer = Buffer.from(await res.arrayBuffer());
    }
  }

  if (!videoBuffer) {
    throw new Error(`No hay video fuente disponible para "${slug}". Pasa --file=<ruta.mp4>.`);
  }

  const exactDur = getExactMp4Duration(videoBuffer) || Number(existingRow?.duration_seconds || 45);
  const titleEs = args.titleEs || existingRow?.title_es || baseModule?.titleEs || slug;
  const titleEn = args.titleEn || existingRow?.title_en || baseModule?.titleEn || titleEs;
  const positionKey = args.positionKey || existingRow?.position_key || baseModule?.positionKey || 'BURRITOS';

  const posIngredients = await fetchPosIngredientsForSlug(slug, titleEs);
  console.log(`🔍 Analizando "${slug}" (${exactDur}s) con Gemini Multimodal + ${posIngredients.length} ingredientes POS...`);

  const analyzed = await analyzeTrainingVideoWithGemini({
    videoBuffer,
    mimeType: sourceFilename.endsWith('.webm') ? 'video/webm' : 'video/mp4',
    slug,
    titleEs,
    titleEn,
    durationSeconds: exactDur,
    ingredients: posIngredients,
  });

  if (!analyzed) {
    throw new Error('Gemini Multimodal no pudo analizar este video.');
  }

  console.log(`🎙 Sintetizando ${analyzed.steps.length} pasos en voz Orus (ES + EN)...`);
  const stepsWithVoice = await synthesizeStepAudioBatch(analyzed.steps);

  const upsertRow = {
    slug,
    position_key: positionKey,
    group_key: existingRow?.group_key || baseModule?.groupKey || 'cocina',
    title_es: analyzed.titleEs || titleEs,
    title_en: analyzed.titleEn || titleEn,
    subtitle_es: analyzed.subtitleEs,
    subtitle_en: analyzed.subtitleEn,
    source_video_filename: sourceFilename,
    video_slug: slug,
    video_url: videoUrl,
    duration_seconds: exactDur,
    target_prep_seconds: analyzed.targetPrepSeconds || exactDur,
    grill_temp_fahrenheit: analyzed.grillTempFahrenheit,
    steps_json: stepsWithVoice,
    recipe_specs_json:
      analyzed.recipeSpecs.length > 0
        ? analyzed.recipeSpecs
        : existingRow?.recipe_specs_json || baseModule?.recipeSpecs || [],
    quiz_json:
      analyzed.quiz.length > 0 ? analyzed.quiz : existingRow?.quiz_json || baseModule?.quiz || [],
    day_plan_json: existingRow?.day_plan_json || baseModule?.dayPlan || DEFAULT_FOUR_DAY_METHOD,
    voice_id: DEFAULT_TRAINING_VOICE,
    sort_order: existingRow?.sort_order ?? baseModule?.sortOrder ?? 50,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from('training_sop_modules')
    .upsert(upsertRow, { onConflict: 'slug' });
  if (error) throw error;

  console.log(`🎉 Módulo "${slug}" analizado, narrado con Orus y guardado en Supabase con ${stepsWithVoice.length} pasos exactos.`);
}

async function main() {
  const args: Record<string, string> = {};
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith('--')) {
      const [k, ...rest] = raw.slice(2).split('=');
      args[k] = rest.length > 0 ? rest.join('=') : 'true';
    }
  }

  if (args['analyze-slug']) {
    await analyzeAndSaveSingleSlug(args);
  } else {
    await syncAllCatalogModules();
  }
}

main().catch((err) => {
  console.error('❌ ERROR en process-training-videos:', err);
  process.exit(1);
});
