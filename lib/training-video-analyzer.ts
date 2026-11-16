/**
 * @module lib/training-video-analyzer
 * @description Analizador Multimodal con Gemini Vision para videos SOP reales del Módulo TRAINING
 * de Tacos Gavilan. Al subir o reprocesar cualquier archivo `.mp4`, `.mov` o `.webm`, este servicio
 * sube temporalmente el video a Gemini File API, lo inspecciona segundo a segundo junto con las
 * porciones reales de la receta en el sistema (`recipes`) y genera pasos cronológicos bilingües (ES/EN),
 * tiempos exactos (`startSec`..`endSec`), utensilios observados, porciones clave, tabla de gramajes
 * y preguntas de Quiz sin inventar acciones que no aparezcan en pantalla.
 *
 * @businessRules
 * - Nombre oficial de la marca: Tacos Gavilan.
 * - Siempre priorizar ingredientes culinarios (`food`, `raw`, `cooked`) y filtrar empaques duplicados por canal.
 * - Regla crítica de Torta: 0.6 oz Mayonesa, 1.5 oz Frijol, 6 oz Carne Asada, 2.3 oz Aguacate, Papelito Para Torta — NUNCA lleva crema.
 * - Limpieza garantizada: el archivo subido temporalmente a Gemini File API siempre se elimina en `finally`.
 * - Fallback seguro: si Gemini no está disponible o falla un lote, retorna `null` sin bloquear la subida del video.
 *
 * @dataFlow
 * `app/api/training/video/route.ts` / `scripts/process-training-videos.ts`
 *   -> Gemini File API (`upload/v1beta/files` resumable -> `state: ACTIVE`)
 *   -> `gemini-2.5-flash` (`generateContent` JSON)
 *   -> validación cronológica (`0 <= startSec < endSec`)
 *   -> `DELETE v1beta/files/{name}`
 */

import { getGeminiKeyPool } from '@/lib/order-ready-tts';
import type {
  RecipeIngredientSpec,
  TrainingQuizQuestion,
  TrainingVideoStep,
} from '@/lib/training-sop-catalog';

export interface RawRecipeIngredientInput {
  name: string;
  quantity: number;
  unit: string;
  type?: string;
}

export interface AnalyzedTrainingVideoResult {
  titleEs: string;
  titleEn: string;
  subtitleEs: string;
  subtitleEn: string;
  targetPrepSeconds: number;
  grillTempFahrenheit: number | null;
  steps: TrainingVideoStep[];
  recipeSpecs: RecipeIngredientSpec[];
  quiz: TrainingQuizQuestion[];
}

const ANALYZER_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro'];

function formatSecLabel(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

/**
 * Filtra y deduplica ingredientes de receta:
 * 1) Prefiere ingredientes culinarios (`food`, `raw`, `cooked`).
 * 2) Evita duplicar empaques repetidos en `cogs_dine_in` / `cogs_takeout` / `cogs_delivery`.
 */
export function cleanRecipeIngredients(
  rawIngredients: RawRecipeIngredientInput[]
): RawRecipeIngredientInput[] {
  if (!Array.isArray(rawIngredients) || rawIngredients.length === 0) return [];

  const deduped = new Map<string, RawRecipeIngredientInput>();
  for (const ing of rawIngredients) {
    const cleanName = String(ing?.name || '').trim();
    if (!cleanName) continue;
    const normKey = `${cleanName.toLowerCase()}::${String(ing.unit || 'oz').trim().toLowerCase()}`;
    const type = String(ing?.type || 'food').trim().toLowerCase();
    const isFood = type === 'food' || type === 'raw' || type === 'cooked';

    const existing = deduped.get(normKey);
    if (!existing) {
      deduped.set(normKey, {
        name: cleanName,
        quantity: Number(ing.quantity) || 1,
        unit: String(ing.unit || 'oz').trim(),
        type,
      });
    } else if (isFood && !['food', 'raw', 'cooked'].includes(String(existing.type || ''))) {
      deduped.set(normKey, {
        name: cleanName,
        quantity: Number(ing.quantity) || 1,
        unit: String(ing.unit || 'oz').trim(),
        type,
      });
    }
  }

  const all = Array.from(deduped.values());
  const culinary = all.filter((i) => ['food', 'raw', 'cooked'].includes(String(i.type || '')));
  if (culinary.length > 0) {
    // Mantener papelito / aluminios útiles solo una vez si existen
    const wrappers = all.filter(
      (i) =>
        !['food', 'raw', 'cooked'].includes(String(i.type || '')) &&
        /(papelito|aluminio|foil|wax)/i.test(i.name)
    );
    return [...culinary, ...wrappers];
  }
  return all;
}

async function uploadBufferToGeminiFiles(
  videoBuffer: Buffer,
  mimeType: string,
  displayName: string,
  apiKey: string
): Promise<{ name: string; uri: string; mimeType: string }> {
  const safeMime = mimeType && mimeType.startsWith('video/') ? mimeType : 'video/mp4';

  // Paso 1: Iniciar subida resumable
  const startRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(videoBuffer.byteLength),
        'X-Goog-Upload-Header-Content-Type': safeMime,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ file: { display_name: displayName.slice(0, 80) } }),
    }
  );

  if (!startRes.ok) {
    const errText = await startRes.text().catch(() => '');
    throw new Error(`Gemini File API start failed (${startRes.status}): ${errText.slice(0, 200)}`);
  }

  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    throw new Error('Gemini File API did not return x-goog-upload-url');
  }

  // Paso 2: Subir bytes del video
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(videoBuffer.byteLength),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    signal: AbortSignal.timeout(45000),
    body: new Uint8Array(videoBuffer),
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => '');
    throw new Error(`Gemini File API upload failed (${uploadRes.status}): ${errText.slice(0, 200)}`);
  }

  const filePayload: any = await uploadRes.json();
  let fileObj = filePayload?.file || filePayload;
  if (!fileObj?.name || !fileObj?.uri) {
    throw new Error('Gemini File API response missing file name/uri');
  }

  // Paso 3: Esperar a que Gemini procese el video (ACTIVE)
  const deadline = Date.now() + 25000;
  while (fileObj.state === 'PROCESSING' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const pollRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileObj.name}?key=${encodeURIComponent(apiKey)}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (pollRes.ok) {
      fileObj = await pollRes.json();
    }
  }

  if (fileObj.state === 'FAILED') {
    throw new Error('Gemini File API video processing failed');
  }

  return {
    name: String(fileObj.name),
    uri: String(fileObj.uri),
    mimeType: String(fileObj.mimeType || safeMime),
  };
}

async function deleteGeminiFileQuietly(fileName: string, apiKey: string): Promise<void> {
  if (!fileName) return;
  try {
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${encodeURIComponent(apiKey)}`,
      { method: 'DELETE', signal: AbortSignal.timeout(8000) }
    );
  } catch {
    // Ignore cleanup errors on expired temp files
  }
}

function normalizeAnalyzedSteps(
  slug: string,
  rawSteps: any[],
  durationSeconds: number
): TrainingVideoStep[] {
  const totalDur = Math.max(10, Math.round(durationSeconds || 45));
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) return [];

  const sorted = [...rawSteps]
    .filter((s) => s && (s.narrationEs || s.titleEs))
    .sort((a, b) => Number(a.startSec || 0) - Number(b.startSec || 0));

  if (sorted.length === 0) return [];

  const cleanSteps: TrainingVideoStep[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const raw = sorted[i];
    const prevEnd = i === 0 ? 0 : cleanSteps[i - 1].endSec;
    const rawStart = Number(raw.startSec ?? prevEnd);
    const startSec = i === 0 ? 0 : Math.max(prevEnd, Math.min(totalDur - 2, Math.round(rawStart)));

    const isLast = i === sorted.length - 1;
    const rawEnd = Number(raw.endSec ?? (isLast ? totalDur : startSec + 6));
    const endSec = isLast
      ? Math.max(startSec + 2, totalDur)
      : Math.max(startSec + 2, Math.min(totalDur - (sorted.length - 1 - i) * 2, Math.round(rawEnd)));

    cleanSteps.push({
      id: `${slug}-step-${i + 1}`,
      stepNumber: i + 1,
      startSec,
      endSec,
      timestampLabel: `${formatSecLabel(startSec)} - ${formatSecLabel(endSec)}`,
      titleEs: String(raw.titleEs || `Paso ${i + 1}`).trim(),
      titleEn: String(raw.titleEn || raw.titleEs || `Step ${i + 1}`).trim(),
      narrationEs: String(raw.narrationEs || raw.titleEs || '').trim(),
      narrationEn: String(raw.narrationEn || raw.narrationEs || '').trim(),
      keyPortionEs: String(raw.keyPortionEs || 'Estándar SOP').trim(),
      keyPortionEn: String(raw.keyPortionEn || raw.keyPortionEs || 'SOP Standard').trim(),
      utensilEs: String(raw.utensilEs || 'Estándar de línea').trim(),
      utensilEn: String(raw.utensilEn || raw.utensilEs || 'Line standard').trim(),
      ...(raw.criticalRuleEs ? { criticalRuleEs: String(raw.criticalRuleEs).trim() } : {}),
      ...(raw.criticalRuleEn ? { criticalRuleEn: String(raw.criticalRuleEn).trim() } : {}),
    });
  }

  return cleanSteps;
}

/**
 * Analiza un video real de capacitación cuadro por cuadro con Gemini Multimodal
 * para generar títulos, pasos cronológicos reales, porciones y quiz sin inventar acciones.
 */
export async function analyzeTrainingVideoWithGemini(params: {
  videoBuffer: Buffer;
  mimeType: string;
  slug: string;
  titleEs: string;
  titleEn: string;
  durationSeconds: number;
  ingredients: RawRecipeIngredientInput[];
}): Promise<AnalyzedTrainingVideoResult | null> {
  const { videoBuffer, mimeType, slug, titleEs, titleEn, durationSeconds, ingredients } = params;
  const keys = getGeminiKeyPool();
  if (keys.length === 0 || videoBuffer.byteLength === 0) return null;

  const cleanIngredients = cleanRecipeIngredients(ingredients);
  const totalDur = Math.max(10, Math.round(durationSeconds || 45));

  const recipeSummary =
    cleanIngredients.length > 0
      ? cleanIngredients
          .map((ing) => `- ${ing.quantity} ${ing.unit} ${ing.name}`)
          .join('\n')
      : '- Estándar operativo de cocina / servicio Tacos Gavilan';

  const promptText = [
    `Eres el Director de Operaciones de Tacos Gavilan auditando un video real de capacitación SOP.`,
    `Producto / Categoría: "${titleEs}" (slug: ${slug}). Duración total del video: ${totalDur} segundos.`,
    `Ingredientes oficiales de receta en POS:`,
    recipeSummary,
    ``,
    `INSTRUCCIONES ESTRICTAS:`,
    `1. Mira TODO el video del segundo 0 al segundo ${totalDur}. Describe ÚNICAMENTE lo que realmente ocurre en pantalla y los utensilios reales observados (cuchara perforada vs pinzas, cilindro dispensador, vasito medidor rojo, tapa de rosca vs presión, cantidad real de compartimentos del contenedor o cantidad exacta de piezas/tacos).`,
    `2. PROHIBIDO inventar ingredientes o pasos que no se muestren ni contradecir la receta oficial. Si es Torta, recuerda que NUNCA lleva crema (lleva 0.6 oz mayonesa, 1.5 oz frijol, 2.3 oz aguacate, 6 oz carne).`,
    `3. Divide el video en pasos cronológicos contiguos sin empalmes: el Paso 1 empieza en startSec=0 y el último Paso termina en endSec=${totalDur}. Cada paso debe corresponder al segundo exacto donde inicia esa acción en el video.`,
    `4. Redacta narrationEs (español latinoamericano natural para instructor masculino) y narrationEn (inglés claro y humano) mencionando números y fracciones en palabras ("seis onzas", "uno punto cinco onzas") para que suene fluido en Voz Neural.`,
    `5. Incluye recipeSpecs exactos y 1–2 preguntas de quiz de 4 opciones basadas estrictamente en los gramajes reales y técnica vista.`,
    ``,
    `Responde ÚNICAMENTE con un objeto JSON válido con esta estructura exacta:`,
    `{`,
    `  "titleEs": "string",`,
    `  "titleEn": "string",`,
    `  "subtitleEs": "string",`,
    `  "subtitleEn": "string",`,
    `  "targetPrepSeconds": number,`,
    `  "grillTempFahrenheit": number | null,`,
    `  "steps": [`,
    `    {`,
    `      "startSec": number,`,
    `      "endSec": number,`,
    `      "titleEs": "string",`,
    `      "titleEn": "string",`,
    `      "narrationEs": "string",`,
    `      "narrationEn": "string",`,
    `      "keyPortionEs": "string",`,
    `      "keyPortionEn": "string",`,
    `      "utensilEs": "string",`,
    `      "utensilEn": "string",`,
    `      "criticalRuleEs": "string opcional",`,
    `      "criticalRuleEn": "string opcional"`,
    `    }`,
    `  ],`,
    `  "recipeSpecs": [`,
    `    { "itemEs": "string", "itemEn": "string", "quantity": "string", "unit": "string", "utensilEs": "string", "utensilEn": "string", "notesEs": "string opcional", "notesEn": "string opcional" }`,
    `  ],`,
    `  "quiz": [`,
    `    { "id": "string", "questionEs": "string", "questionEn": "string", "optionsEs": ["a","b","c","d"], "optionsEn": ["a","b","c","d"], "correctIndex": 0, "explanationEs": "string", "explanationEn": "string" }`,
    `  ]`,
    `}`,
  ].join('\n');

  for (const apiKey of keys.slice(0, 3)) {
    let uploadedName = '';
    try {
      const uploaded = await uploadBufferToGeminiFiles(
        videoBuffer,
        mimeType,
        `${slug}.${mimeType.includes('webm') ? 'webm' : 'mp4'}`,
        apiKey
      );
      uploadedName = uploaded.name;

      for (const model of ANALYZER_MODELS) {
        const genRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(45000),
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      fileData: {
                        mimeType: uploaded.mimeType,
                        fileUri: uploaded.uri,
                      },
                    },
                    { text: promptText },
                  ],
                },
              ],
              generationConfig: {
                temperature: 0.15,
                responseMimeType: 'application/json',
              },
            }),
          }
        );

        if (!genRes.ok) {
          continue;
        }

        const genJson: any = await genRes.json();
        const rawText = genJson?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) continue;

        const parsed = JSON.parse(rawText);
        const normalizedSteps = normalizeAnalyzedSteps(slug, parsed?.steps || [], totalDur);
        if (normalizedSteps.length === 0) continue;

        const normalizedSpecs: RecipeIngredientSpec[] = Array.isArray(parsed?.recipeSpecs)
          ? parsed.recipeSpecs
              .filter((r: any) => r && r.itemEs)
              .map((r: any) => ({
                itemEs: String(r.itemEs).trim(),
                itemEn: String(r.itemEn || r.itemEs).trim(),
                quantity: String(r.quantity || '1').trim(),
                unit: String(r.unit || 'oz').trim(),
                utensilEs: String(r.utensilEs || 'Estándar de línea').trim(),
                utensilEn: String(r.utensilEn || r.utensilEs || 'Line standard').trim(),
                ...(r.notesEs ? { notesEs: String(r.notesEs).trim() } : {}),
                ...(r.notesEn ? { notesEn: String(r.notesEn).trim() } : {}),
              }))
          : [];

        const normalizedQuiz: TrainingQuizQuestion[] = Array.isArray(parsed?.quiz)
          ? parsed.quiz
              .filter(
                (q: any) =>
                  q &&
                  q.questionEs &&
                  Array.isArray(q.optionsEs) &&
                  q.optionsEs.length >= 2 &&
                  Array.isArray(q.optionsEn) &&
                  q.optionsEn.length >= 2
              )
              .map((q: any, qIdx: number) => ({
                id: String(q.id || `q-${slug}-${qIdx + 1}`).trim(),
                questionEs: String(q.questionEs).trim(),
                questionEn: String(q.questionEn || q.questionEs).trim(),
                optionsEs: q.optionsEs.map((o: any) => String(o).trim()),
                optionsEn: q.optionsEn.map((o: any) => String(o).trim()),
                correctIndex: Math.max(
                  0,
                  Math.min(q.optionsEs.length - 1, Number(q.correctIndex) || 0)
                ),
                explanationEs: String(q.explanationEs || '').trim(),
                explanationEn: String(q.explanationEn || q.explanationEs || '').trim(),
              }))
          : [];

        return {
          titleEs: String(parsed?.titleEs || titleEs).trim(),
          titleEn: String(parsed?.titleEn || titleEn || titleEs).trim(),
          subtitleEs: String(parsed?.subtitleEs || `Procedimiento oficial de ${titleEs}`).trim(),
          subtitleEn: String(parsed?.subtitleEn || `Official procedure for ${titleEn || titleEs}`).trim(),
          targetPrepSeconds: Math.max(15, Number(parsed?.targetPrepSeconds) || totalDur),
          grillTempFahrenheit:
            typeof parsed?.grillTempFahrenheit === 'number'
              ? parsed.grillTempFahrenheit
              : null,
          steps: normalizedSteps,
          recipeSpecs: normalizedSpecs,
          quiz: normalizedQuiz,
        };
      }
    } catch (err) {
      console.warn('[analyzeTrainingVideoWithGemini] Attempt failed, trying next key:', err);
    } finally {
      if (uploadedName) {
        await deleteGeminiFileQuietly(uploadedName, apiKey);
      }
    }
  }

  return null;
}
