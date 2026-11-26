'use client';

/**
 * @module TrainingAcademyPage
 * @description Módulo Oficial de Entrenamiento Operativo (Academia SOP 4 Días — Tacos Gavilan).
 * Conectado 100% en tiempo real con las 15 sucursales reales (`public.stores`), plantilla real
 * del Planificador (`toast_employees`), PIN en vivo de RONOS (`/api/training/ronos-auth`),
 * expediente unificado por Puesto (`public.training_enrollments`), catálogo agrupado en
 * Categorías Maestras Base Carne Asada y subida firmada de videos SOP (`Orus`).
 *
 * @businessRules
 * 1. Flujo Guiado Sin Caos Visual:
 *    - Usuarios ADMIN (`role === 'admin'`) acceden directo a `Revisar Videos y Pasos` (`mainView === 'videos'`) por las 8 estaciones y 23 Categorías Maestras sin tener que seleccionar un empleado.
 *    - Managers / Supervisores en `Personal y Capacitación` eligen Sucursal y Persona antes de mostrar el plan de 4 días.
 *    - Empleados con 2+ semanas (>= 14 días) muestran su Certificado Oficial automático por Puesto.
 *    - Nuevos ingresos (< 14 días) siguen el plan secuencial de 4 días en una vista limpia (máx. 1 nivel activo).
 * 2. Entrenamiento por Categoría Maestra (Base Carne Asada):
 *    - Cada categoría utiliza Carne Asada como platillo de referencia (mismo procedimiento para todas las proteínas).
 * 3. Reproductor 100% Limpio y Mudo:
 *    - Audio original `.mp4` siempre silenciado (`muted`, `volume = 0`) para escuchar solo al Tutor de Voz (`Orus`).
 *    - Sin barra de progreso; únicamente Play/Pausa y Pantalla Completa (ocultos al pausarse por explicación de paso).
 * 4. Subida Segura de Videos Reales (> 4.5 MB):
 *    - Flujo firmado directo a Supabase Storage (`create-upload-url` -> `PUT` -> `finalize-upload`) evitando el límite de Vercel.
 * 5. Impresión Limpia (`@media print`):
 *    - Certificado Oficial e Inventario de Categorías imprimibles en papel sin arrastrar barras de navegación ni vistas previas.
 *
 * @dataFlow
 * - `GET / PUT / DELETE /api/training/catalog`
 * - `GET / POST / PUT /api/training/enrollments`
 * - `POST /api/training/video`
 * - `POST /api/training/ronos-auth`
 * - `POST /api/training/send-email`
 * - `POST /api/training/tts`
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { useAuth } from '@/components/ProtectedRoute';
import { formatStoreDisplayName, sortStoresAlphabetically } from '@/lib/store-display';
import type {
  TrainingSopModuleSpec,
  TrainingVideoStep,
  StationPositionMeta,
  TrainingQuizQuestion,
} from '@/lib/training-sop-catalog';
import {
  OfficialCertificateView,
  PrintableRecipeChecklistModal,
  type RecipeProductItem,
} from '@/components/training/OfficialCertificateView';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  CheckCircle2,
  Award,
  KeyRound,
  Scale,
  Thermometer,
  ChefHat,
  Timer,
  Printer,
  Wand2,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  Plus,
  Minus,
  Trash2,
  HelpCircle,
  Store as StoreIcon,
  UserCheck,
  Mail,
  Upload,
  Maximize2,
  Search,
  Video,
  ShieldCheck,
  PlusCircle,
  Loader2,
  AlertCircle,
  Sparkles,
  X,
} from 'lucide-react';

interface EnrichedPosition extends StationPositionMeta {
  activities?: {
    id: string | number;
    activity: string;
    shiftType: string;
    shift: string;
    frequency: string;
    description: string;
    durationMinutes: number;
  }[];
}

interface RealStoreInfo {
  id: number;
  code: string;
  name: string;
  external_id: string;
  supervisor_name: string | null;
  has_drive_thru: boolean;
  ronos_company_id?: number | null;
  managers: {
    id: number;
    fullName: string;
    role: string;
  }[];
}

interface RoleStationItem {
  stationKey: string;
  activitiesKeys: string[];
  order: number;
  dayTarget?: 1 | 2 | 3 | 4;
  labelEs: string;
  labelEn: string;
  shortDescEs: string;
  shortDescEn: string;
}

interface RealPlanificadorEmployee {
  id: string;
  toast_guid: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  store_ids: string[];
  job_titles: string[];
  job_role_key?: 'COCINERO' | 'CAJERA' | 'LIDERAZGO';
  job_role_title_es?: string;
  job_role_title_en?: string;
  job_role_badge_es?: string;
  job_role_badge_en?: string;
  required_stations?: RoleStationItem[];
  assigned_station: string;
  is_leader: boolean;
  sort_order: number;
  first_seen_date: string;
  tenure_days: number;
  tenure_weeks: number;
  is_new_hire: boolean;
  auto_certified: boolean;
  certificate_folio: string;
  ronos_synced: boolean;
  ronos_employee_id: number | null;
}

interface TrainingEnrollment {
  id: string;
  access_code: string;
  employee_name: string;
  employee_id: number | null;
  employee_phone: string | null;
  store_id: number;
  store_name: string;
  position_key: string;
  trainer_name: string;
  current_day: number;
  status: string;
  day1_completed: boolean;
  day1_quiz_score: number | null;
  day1_videos_watched: string[];
  day2_completed: boolean;
  day2_supervised_reps: number;
  day2_checklist_json: Record<string, boolean>;
  day2_approved_by: string | null;
  day2_supervisor_notes: string | null;
  day3_completed: boolean;
  day3_solo_reps: number;
  day3_best_time_seconds: number | null;
  day3_checklist_json: Record<string, boolean>;
  day3_approved_by: string | null;
  day4_completed: boolean;
  day4_exam_score: number | null;
  day4_practical_score: number | null;
  day4_final_score: number | null;
  day4_certified_by: string | null;
  day4_completed_at: string | null;
  certificate_folio: string | null;
  expires_at: string;
  created_at: string;
}

const DEFAULT_DAY4_AUDIT_STATE: Record<string, boolean> = {
  hygiene: false,
  temp: false,
  portion: false,
  presentation: false,
  speed: false,
};

function formatSeconds(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const mins = Math.floor(safe / 60);
  const rem = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function getClientAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('teg_token');
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }
  return headers;
}

function buildFallbackQuizForModule(mod: TrainingSopModuleSpec): TrainingQuizQuestion[] {
  if (Array.isArray(mod.quiz) && mod.quiz.length > 0) {
    return mod.quiz;
  }
  const firstSpec = mod.recipeSpecs?.[0];
  const itemEs = firstSpec?.itemEs || mod.titleEs;
  const itemEn = firstSpec?.itemEn || mod.titleEn;
  const qtyText = firstSpec ? `${firstSpec.quantity} ${firstSpec.unit}` : '6 oz';

  return [
    {
      id: `${mod.slug}-auto-q1`,
      questionEs: `¿Cuál es la medida oficial de "${itemEs}" al preparar ${mod.titleEs}?`,
      questionEn: `What is the official portion of "${itemEn}" when preparing ${mod.titleEn}?`,
      optionsEs: [
        `${qtyText} exactos`,
        'Al cálculo sin medir',
        'El doble de la porción estándar',
        'Media porción para ahorrar producto',
      ],
      optionsEn: [
        `Exactly ${qtyText}`,
        'Guessing without measuring',
        'Double the standard portion',
        'Half portion to save product',
      ],
      correctIndex: 0,
      explanationEs: `Siempre se sirve exactamente ${qtyText} de ${itemEs} usando la báscula o utensilio oficial.`,
      explanationEn: `Always serve exactly ${qtyText} of ${itemEn} using the official scale or scoop.`,
    },
    {
      id: `${mod.slug}-auto-q2`,
      questionEs: 'Para mantener consistencia e inocuidad en la línea de Tacos Gavilan, ¿con qué se verifica la porción?',
      questionEn: 'To maintain consistency and food safety on the Tacos Gavilan line, how is the portion verified?',
      optionsEs: [
        'Báscula calibrada, porcionador oficial y guantes limpios',
        'A ojo sin usar herramientas',
        'Solo cuando sobra tiempo al final del turno',
        'Con cualquier cuchara grande disponible',
      ],
      optionsEn: [
        'Calibrated scale, official scoop, and clean gloves',
        'By eye without using any tools',
        'Only when extra time is left at end of shift',
        'With any large spoon nearby',
      ],
      correctIndex: 0,
      explanationEs: 'La báscula y el porcionador oficial garantizan sabor uniforme y control de inventario.',
      explanationEn: 'Calibrated scales and official scoops ensure uniform taste and inventory control.',
    },
  ];
}

export default function TrainingAcademyPage() {
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const lang = language === 'en' ? 'en' : 'es';

  const userRole = String(user?.role || '').trim().toLowerCase();
  const isAdmin = userRole === 'admin';
  const canManageCatalog = useMemo(
    () => ['admin', 'supervisor', 'manager', 'asistente', 'assistant', 'gerente'].includes(userRole),
    [userRole]
  );

  // Catalog & Roster State
  const [loadingData, setLoadingData] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [videos, setVideos] = useState<TrainingSopModuleSpec[]>([]);
  const [positions, setPositions] = useState<EnrichedPosition[]>([]);
  const [stores, setStores] = useState<RealStoreInfo[]>([]);
  const [allEmployees, setAllEmployees] = useState<RealPlanificadorEmployee[]>([]);
  const [recipeProducts, setRecipeProducts] = useState<RecipeProductItem[]>([]);
  const [enrollments, setEnrollments] = useState<TrainingEnrollment[]>([]);

  // Navigation & Primary View (Máximo 1 vista principal a la vez: Videos Admin / Personal / Catálogo)
  const [mainView, setMainView] = useState<'videos' | 'staff' | 'catalog'>('staff');
  const adminViewInitRef = useRef<boolean>(false);
  const [selectedStoreId, setSelectedStoreId] = useState<number>(0);
  const storeInitializedRef = useRef<boolean>(false);

  // Employee Selection & Filter
  const [employeeFilterMode, setEmployeeFilterMode] = useState<'new_hires' | 'certified' | 'all'>('all');
  const [employeeSearch, setEmployeeSearch] = useState<string>('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [selectedTrainerName, setSelectedTrainerName] = useState<string>('');
  const [allowVeteranRetraining, setAllowVeteranRetraining] = useState<boolean>(false);
  const [activeTraineeId, setActiveTraineeId] = useState<string | null>(null);

  // RONOS Verification
  const [ronosPinInput, setRonosPinInput] = useState<string>('');
  const [ronosVerifiedInfo, setRonosVerifiedInfo] = useState<{
    employeeUserId: number;
    fullName: string;
    ronosCode: string;
  } | null>(null);
  const [ronosVerifyBusy, setRonosVerifyBusy] = useState<boolean>(false);
  const [ronosErrorMsg, setRonosErrorMsg] = useState<string | null>(null);

  // Email Invitation Modal
  const [showEmailModal, setShowEmailModal] = useState<boolean>(false);
  const [emailInput, setEmailInput] = useState<string>('');
  const [emailSending, setEmailSending] = useState<boolean>(false);
  const [emailFeedback, setEmailFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // Station & Active Day Flow
  const [selectedPositionKey, setSelectedPositionKey] = useState<string>('BURRITOS');
  const [selectedVideoSlug, setSelectedVideoSlug] = useState<string>('burrito-ok');
  const [showAllVideosInSelector, setShowAllVideosInSelector] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'day1' | 'day2' | 'day3' | 'day4'>('day1');
  const [day1SubStep, setDay1SubStep] = useState<'video' | 'portions' | 'quiz'>('video');

  // Search States (Separados para evitar conflictos entre Pestaña 2 y Día 1)
  const [catalogSearch, setCatalogSearch] = useState<string>('');
  const [catalogCategory, setCatalogCategory] = useState<string>('ALL');
  const [stationSearch, setStationSearch] = useState<string>('');

  // Upload / Delete / Pause-Add-Step States
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadTargetProduct, setUploadTargetProduct] = useState<{
    slug: string;
    name: string;
    positionKey: string;
    ingredients: any[];
  } | null>(null);
  const [uploadingVideoSlug, setUploadingVideoSlug] = useState<string | null>(null);
  const [deletingVideoSlug, setDeletingVideoSlug] = useState<string | null>(null);
  const [videoActionFeedback, setVideoActionFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const [showAddStepAtPauseBox, setShowAddStepAtPauseBox] = useState<boolean>(false);
  const [pausedTimestampSec, setPausedTimestampSec] = useState<number>(0);
  const [newStepTitle, setNewStepTitle] = useState<string>('');
  const [newStepPortion, setNewStepPortion] = useState<string>('');
  const [newStepNarration, setNewStepNarration] = useState<string>('');
  const [savingPausedStepBusy, setSavingPausedStepBusy] = useState<boolean>(false);
  const [pausedStepError, setPausedStepError] = useState<string | null>(null);

  // Printable Checklist Modal & Help Modal
  const [showPrintableChecklistModal, setShowPrintableChecklistModal] = useState<boolean>(false);
  const [showHowItWorksModal, setShowHowItWorksModal] = useState<boolean>(false);

  // Video & AI Audio State
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSpokenStepIdRef = useRef<string | null>(null);
  const autoPausedForVoiceRef = useRef<boolean>(false);
  const pausedBoundaryStepIdRef = useRef<string | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(true);
  const [isVoiceSpeaking, setIsVoiceSpeaking] = useState<boolean>(false);
  const [autoPausedForVoice, setAutoPausedForVoice] = useState<boolean>(false);
  const [reprocessingVideoSlug, setReprocessingVideoSlug] = useState<string | null>(null);

  // Day 1 Quiz State
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizSubmittedResult, setQuizSubmittedResult] = useState<{ score: number; passed: boolean } | null>(null);

  // Day 2 Guided Reps & Rubric
  const [day2Rubric, setDay2Rubric] = useState<Record<string, boolean>>({});
  const [day2Reps, setDay2Reps] = useState<number>(0);
  const [day2Notes, setDay2Notes] = useState<string>('');
  const [day2SavedBanner, setDay2SavedBanner] = useState<boolean>(false);
  const [day2WarningMsg, setDay2WarningMsg] = useState<string | null>(null);
  const day2BannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Day 3 Stopwatch & Real Activities
  const [stopwatchRunning, setStopwatchRunning] = useState<boolean>(false);
  const [stopwatchElapsedDeci, setStopwatchElapsedDeci] = useState<number>(0);
  const [day3BestTimeSec, setDay3BestTimeSec] = useState<number | null>(null);
  const [day3SoloReps, setDay3SoloReps] = useState<number>(0);
  const [day3ShiftTab, setDay3ShiftTab] = useState<'Apertura' | 'Regular' | 'Cierre'>('Apertura');
  const [day3ActivitiesChecked, setDay3ActivitiesChecked] = useState<Record<string, boolean>>({});
  const [day3WarningMsg, setDay3WarningMsg] = useState<string | null>(null);

  // Day 4 Final Evaluation & Audit
  const [day4ExamAnswers, setDay4ExamAnswers] = useState<Record<string, number>>({});
  const [day4AuditChecks, setDay4AuditChecks] = useState<Record<string, boolean>>(DEFAULT_DAY4_AUDIT_STATE);
  const [certificationResult, setCertificationResult] = useState<{
    passed: boolean;
    combinedScore: number;
    folio: string | null;
  } | null>(null);
  const [day4SavingBusy, setDay4SavingBusy] = useState<boolean>(false);
  const [day4WarningMsg, setDay4WarningMsg] = useState<string | null>(null);

  // Step Editor Modal
  const [showStepEditorModal, setShowStepEditorModal] = useState<boolean>(false);
  const [editingSteps, setEditingSteps] = useState<TrainingVideoStep[]>([]);
  const [savingStepsBusy, setSavingStepsBusy] = useState<boolean>(false);
  const [aiExplainStepBusyId, setAiExplainStepBusyId] = useState<string | null>(null);
  const [editorErrorMsg, setEditorErrorMsg] = useState<string | null>(null);

  const stopAllMedia = useCallback(() => {
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setIsVoiceSpeaking(false);
    autoPausedForVoiceRef.current = false;
    setAutoPausedForVoice(false);
    lastSpokenStepIdRef.current = null;
    pausedBoundaryStepIdRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopAllMedia();
      if (day2BannerTimerRef.current) {
        clearTimeout(day2BannerTimerRef.current);
      }
    };
  }, [stopAllMedia]);

  const resetAndHydrateEnrollmentState = useCallback(
    (targetEnrollment: TrainingEnrollment | null) => {
      stopAllMedia();
      setCurrentTime(0);
      setRonosPinInput('');
      setRonosVerifiedInfo(null);
      setRonosErrorMsg(null);
      setQuizAnswers({});
      setQuizSubmittedResult(null);
      setStopwatchRunning(false);
      setStopwatchElapsedDeci(0);
      setDay2SavedBanner(false);
      setDay2WarningMsg(null);
      setDay3WarningMsg(null);
      setDay4WarningMsg(null);
      setDay4ExamAnswers({});
      setDay4AuditChecks(DEFAULT_DAY4_AUDIT_STATE);
      setCertificationResult(null);

      if (targetEnrollment) {
        setActiveTraineeId(targetEnrollment.id);
        setDay2Reps(Number(targetEnrollment.day2_supervised_reps || 0));
        setDay2Rubric(
          targetEnrollment.day2_checklist_json && typeof targetEnrollment.day2_checklist_json === 'object'
            ? targetEnrollment.day2_checklist_json
            : {}
        );
        setDay2Notes(String(targetEnrollment.day2_supervisor_notes || ''));
        setDay3SoloReps(Number(targetEnrollment.day3_solo_reps || 0));
        setDay3BestTimeSec(
          targetEnrollment.day3_best_time_seconds !== null &&
            targetEnrollment.day3_best_time_seconds !== undefined
            ? Number(targetEnrollment.day3_best_time_seconds)
            : null
        );
        setDay3ActivitiesChecked(
          targetEnrollment.day3_checklist_json && typeof targetEnrollment.day3_checklist_json === 'object'
            ? targetEnrollment.day3_checklist_json
            : {}
        );
        if (targetEnrollment.day4_completed) {
          setCertificationResult({
            passed: true,
            combinedScore: Number(targetEnrollment.day4_final_score ?? 100),
            folio: targetEnrollment.certificate_folio || null,
          });
        }
        const dayNum = Number(targetEnrollment.current_day || 1);
        setActiveTab(dayNum >= 4 ? 'day4' : dayNum === 3 ? 'day3' : dayNum === 2 ? 'day2' : 'day1');
        setDay1SubStep('video');
      } else {
        setActiveTraineeId(null);
        setDay2Reps(0);
        setDay2Rubric({});
        setDay2Notes('');
        setDay3SoloReps(0);
        setDay3BestTimeSec(null);
        setDay3ActivitiesChecked({});
        setActiveTab('day1');
        setDay1SubStep('video');
      }
    },
    [stopAllMedia]
  );

  // Load real Supabase catalog, stores, roster and enrollments
  const loadTrainingData = useCallback(async () => {
    setLoadingData(true);
    setLoadError(null);
    try {
      const authHeaders = getClientAuthHeaders();
      const [catRes, enrRes] = await Promise.all([
        fetch('/api/training/catalog', { cache: 'no-store', headers: authHeaders, credentials: 'include' }),
        fetch('/api/training/enrollments', { cache: 'no-store', headers: authHeaders, credentials: 'include' }),
      ]);
      const catJson = await catRes.json();
      if (!catRes.ok || !catJson.ok) {
        throw new Error(catJson.error || 'Error loading training catalog');
      }
      setVideos(catJson.modules || []);
      setPositions(catJson.positions || []);
      const realStores: RealStoreInfo[] = sortStoresAlphabetically(
        (catJson.stores || []).map((s: RealStoreInfo) => ({ ...s, name: formatStoreDisplayName(s.name) })),
        (s) => s.name
      );
      setStores(realStores);
      setAllEmployees(catJson.employees || []);
      setRecipeProducts(catJson.recipeProducts || []);

      if (enrRes.ok) {
        const enrJson = await enrRes.json();
        if (enrJson.ok) {
          setEnrollments(enrJson.enrollments || []);
        }
      }
    } catch (err: any) {
      console.error('[TrainingPage] Load error:', err);
      setLoadError(err?.message || 'load_error');
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    loadTrainingData();
  }, [loadTrainingData]);

  // Default ADMIN directly into Videos & Steps Review (without requiring employee selection)
  useEffect(() => {
    if (isAdmin && !adminViewInitRef.current) {
      adminViewInitRef.current = true;
      if (!selectedEmployeeId) {
        setMainView('videos');
      }
    }
  }, [isAdmin, selectedEmployeeId]);

  // Initialize store once stores & user are available
  useEffect(() => {
    if (stores.length === 0 || storeInitializedRef.current) return;
    const userStoreNum = Number(user?.store_id || 0);
    const preferred =
      (userStoreNum > 0 && stores.find((s) => Number(s.id) === userStoreNum)) ||
      stores.find((s) => Number(s.id) === 14) ||
      stores[0];
    if (preferred) {
      setSelectedStoreId(Number(preferred.id));
      storeInitializedRef.current = true;
    }
  }, [stores, user?.store_id]);

  // 15 Active Real Stores & Selected Store
  const selectedStore = useMemo(
    () => stores.find((s) => Number(s.id) === Number(selectedStoreId)) || stores[0] || null,
    [stores, selectedStoreId]
  );

  // Active Roster of Selected Store from Planificador
  const storeEmployees = useMemo(() => {
    if (!selectedStore) return [];
    const extId = String(selectedStore.external_id || '');
    return allEmployees.filter((emp) => emp.store_ids.includes(extId));
  }, [allEmployees, selectedStore]);

  const newHireStoreEmployees = useMemo(
    () => storeEmployees.filter((emp) => emp.is_new_hire),
    [storeEmployees]
  );
  const certifiedStoreEmployees = useMemo(
    () => storeEmployees.filter((emp) => !emp.is_new_hire),
    [storeEmployees]
  );

  const filteredStoreEmployees = useMemo(() => {
    const base =
      employeeFilterMode === 'new_hires'
        ? newHireStoreEmployees
        : employeeFilterMode === 'certified'
        ? certifiedStoreEmployees
        : storeEmployees;
    const q = employeeSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (e) =>
        e.full_name.toLowerCase().includes(q) ||
        e.job_titles.some((j) => j.toLowerCase().includes(q)) ||
        (e.job_role_title_es || '').toLowerCase().includes(q) ||
        (e.job_role_title_en || '').toLowerCase().includes(q)
    );
  }, [
    employeeFilterMode,
    employeeSearch,
    newHireStoreEmployees,
    certifiedStoreEmployees,
    storeEmployees,
  ]);

  // Real Managers & Shift Leaders at Selected Store
  const storeTrainers = useMemo(() => {
    const list: string[] = [];
    if (selectedStore?.managers?.length) {
      for (const m of selectedStore.managers) {
        if (m.fullName && !list.includes(m.fullName)) {
          list.push(m.fullName);
        }
      }
    }
    for (const emp of storeEmployees) {
      if (emp.is_leader) {
        if (!list.includes(emp.full_name)) {
          list.push(emp.full_name);
        }
      }
    }
    if (user?.name && !list.includes(user.name)) {
      list.unshift(user.name);
    }
    return list.length > 0 ? list : [t('training.fallback_store_manager')];
  }, [selectedStore, storeEmployees, user?.name, t]);

  useEffect(() => {
    if (storeTrainers.length > 0 && (!selectedTrainerName || !storeTrainers.includes(selectedTrainerName))) {
      setSelectedTrainerName(storeTrainers[0]);
    }
  }, [storeTrainers, selectedTrainerName]);

  const selectedEmployee = useMemo(
    () =>
      storeEmployees.find((e) => e.id === selectedEmployeeId) ||
      allEmployees.find((e) => e.id === selectedEmployeeId) ||
      null,
    [storeEmployees, allEmployees, selectedEmployeeId]
  );

  const activeTrainee = useMemo(
    () => enrollments.find((e) => e.id === activeTraineeId) || null,
    [enrollments, activeTraineeId]
  );

  // Unify all SOP modules (catalog videos + recipeProducts that have custom uploaded videos)
  const allAvailableModules = useMemo(() => {
    const bySlug = new Map<string, TrainingSopModuleSpec>();
    for (const v of videos) {
      bySlug.set(v.slug, v);
    }
    for (const rp of recipeProducts) {
      if (!bySlug.has(rp.slug) && rp.videoUrl) {
        bySlug.set(rp.slug, {
          slug: rp.slug,
          positionKey: rp.positionKey,
          groupKey: 'cocina',
          titleEs: rp.name,
          titleEn: rp.name,
          subtitleEs: rp.category,
          subtitleEn: rp.category,
          sourceVideoFilename: rp.sourceVideoFilename,
          videoSlug: rp.slug,
          videoUrl: rp.videoUrl,
          durationSeconds: rp.durationSeconds || 45,
          targetPrepSeconds: rp.targetPrepSeconds || 45,
          grillTempFahrenheit: rp.grillTempFahrenheit,
          steps: rp.steps || [],
          recipeSpecs: rp.recipeSpecs || [],
          quiz: [],
          dayPlan: videos[0]?.dayPlan || [],
          sortOrder: 99,
        });
      }
    }
    return Array.from(bySlug.values());
  }, [videos, recipeProducts]);

  // Role Stations (from employee's real job role)
  const roleRequiredStations = useMemo<RoleStationItem[]>(() => {
    if (selectedEmployee?.required_stations?.length) {
      return selectedEmployee.required_stations;
    }
    return [];
  }, [selectedEmployee]);

  const currentPosition = useMemo(
    () => positions.find((p) => p.positionKey === selectedPositionKey) || positions[0] || null,
    [positions, selectedPositionKey]
  );

  const pickVideoSlugForStation = useCallback(
    (stationKey: string): string => {
      const posMeta = positions.find((p) => p.positionKey === stationKey);
      const isTortasStation = stationKey === 'TORTAS/QUESADILLAS' || stationKey === 'TORTAS/MULITAS';

      const stationWithVideo = allAvailableModules.find(
        (v) =>
          Boolean(v.videoUrl) &&
          (isTortasStation
            ? v.positionKey === 'TORTAS/QUESADILLAS' || v.positionKey === 'TORTAS/MULITAS'
            : v.positionKey === stationKey || Boolean(posMeta?.primaryVideoSlugs.includes(v.slug)))
      );
      if (stationWithVideo) return stationWithVideo.slug;

      const stationCategory = recipeProducts.find((p) =>
        isTortasStation
          ? p.positionKey === 'TORTAS/QUESADILLAS' || p.positionKey === 'TORTAS/MULITAS'
          : p.positionKey === stationKey
      );
      if (stationCategory) return stationCategory.slug;

      const anyActive = allAvailableModules.find((v) => Boolean(v.videoUrl));
      return anyActive?.slug || 'burrito-ok';
    },
    [allAvailableModules, positions, recipeProducts]
  );

  const stationVideos = useMemo(() => {
    const activeOnly = allAvailableModules.filter((v) => Boolean(v.videoUrl) && v.videoUrl !== 'DELETED');
    if (showAllVideosInSelector) return activeOnly;
    const isTortas =
      selectedPositionKey === 'TORTAS/QUESADILLAS' || selectedPositionKey === 'TORTAS/MULITAS';
    const matched = activeOnly.filter(
      (v) =>
        Boolean(currentPosition?.primaryVideoSlugs.includes(v.slug)) ||
        (isTortas
          ? v.positionKey === 'TORTAS/QUESADILLAS' || v.positionKey === 'TORTAS/MULITAS'
          : v.positionKey === selectedPositionKey)
    );
    return matched;
  }, [allAvailableModules, currentPosition, selectedPositionKey, showAllVideosInSelector]);

  const adminAllStations = useMemo(
    () => [
      { stationKey: 'CARNES', labelKey: 'training.admin_station_carnes' },
      { stationKey: 'TORTILLAS', labelKey: 'training.admin_station_tortillas' },
      { stationKey: 'TACOS', labelKey: 'training.admin_station_tacos' },
      { stationKey: 'TORTAS/QUESADILLAS', labelKey: 'training.admin_station_plancha' },
      { stationKey: 'BURRITOS', labelKey: 'training.admin_station_burritos' },
      { stationKey: 'PREPARACION', labelKey: 'training.admin_station_preparacion' },
      { stationKey: 'Caja 1 / Salón', labelKey: 'training.admin_station_caja' },
      { stationKey: 'Uber + Salsas', labelKey: 'training.admin_station_uber' },
    ],
    []
  );

  // Active video/category fallback-safe selection (honors explicit category clicks even before .mp4 upload)
  const currentVideo = useMemo<TrainingSopModuleSpec | null>(() => {
    const exactInAll = allAvailableModules.find((v) => v.slug === selectedVideoSlug);
    const exactRp = recipeProducts.find((rp) => rp.slug === selectedVideoSlug);
    if (exactInAll && (exactInAll.videoUrl || exactRp)) {
      return {
        ...exactInAll,
        steps: exactInAll.steps.length > 0 ? exactInAll.steps : exactRp?.steps || [],
        recipeSpecs:
          exactInAll.recipeSpecs.length > 0 ? exactInAll.recipeSpecs : exactRp?.recipeSpecs || [],
      };
    }

    if (exactRp) {
      return {
        slug: exactRp.slug,
        positionKey: exactRp.positionKey,
        groupKey: 'cocina',
        titleEs: exactRp.name,
        titleEn: exactRp.name,
        subtitleEs: exactRp.category,
        subtitleEn: exactRp.category,
        sourceVideoFilename: exactRp.sourceVideoFilename,
        videoSlug: exactRp.slug,
        videoUrl: exactRp.videoUrl,
        durationSeconds: exactRp.durationSeconds || 45,
        targetPrepSeconds: exactRp.targetPrepSeconds || 45,
        grillTempFahrenheit: exactRp.grillTempFahrenheit,
        steps: exactRp.steps || [],
        recipeSpecs: exactRp.recipeSpecs || [],
        quiz: [],
        dayPlan: videos[0]?.dayPlan || [],
        sortOrder: 99,
      };
    }

    if (stationVideos.length > 0) {
      return stationVideos[0];
    }

    // Si la estación elegida aún no tiene video .mp4, construir vista limpia de categoría para permitir "Subir Video"
    const matchingRp = recipeProducts.find((rp) => rp.positionKey === selectedPositionKey);
    if (matchingRp) {
      return {
        slug: matchingRp.slug,
        positionKey: matchingRp.positionKey,
        groupKey: 'cocina',
        titleEs: matchingRp.name,
        titleEn: matchingRp.name,
        subtitleEs: matchingRp.category,
        subtitleEn: matchingRp.category,
        sourceVideoFilename: matchingRp.sourceVideoFilename,
        videoSlug: matchingRp.slug,
        videoUrl: matchingRp.videoUrl,
        durationSeconds: matchingRp.durationSeconds || 45,
        targetPrepSeconds: matchingRp.targetPrepSeconds || 45,
        grillTempFahrenheit: matchingRp.grillTempFahrenheit,
        steps: matchingRp.steps || [],
        recipeSpecs: matchingRp.recipeSpecs || [],
        quiz: [],
        dayPlan: videos[0]?.dayPlan || [],
        sortOrder: 99,
      };
    }

    return allAvailableModules[0] || null;
  }, [allAvailableModules, stationVideos, recipeProducts, selectedPositionKey, selectedVideoSlug, videos]);

  const activeDay1Quiz = useMemo(
    () => (currentVideo ? buildFallbackQuizForModule(currentVideo) : []),
    [currentVideo]
  );

  // Corregir índice de paso activo: NUNCA saltar al último paso en huecos o en t = 0
  const currentStepIndex = useMemo(() => {
    if (!currentVideo || currentVideo.steps.length === 0) return 0;
    const directIdx = currentVideo.steps.findIndex(
      (s) => currentTime >= s.startSec && currentTime < s.endSec
    );
    if (directIdx >= 0) return directIdx;

    if (currentTime < currentVideo.steps[0].startSec) return 0;

    let latestStartedIdx = 0;
    for (let i = 0; i < currentVideo.steps.length; i++) {
      if (currentTime >= currentVideo.steps[i].startSec) {
        latestStartedIdx = i;
      }
    }
    return latestStartedIdx;
  }, [currentVideo, currentTime]);

  const currentStep = currentVideo?.steps[currentStepIndex] || null;

  // Categories / Products belonging to the selected station
  const stationRecipeProducts = useMemo(() => {
    return recipeProducts.filter((p) => {
      if (selectedPositionKey === 'TORTAS/QUESADILLAS' || selectedPositionKey === 'TORTAS/MULITAS') {
        return p.positionKey === 'TORTAS/QUESADILLAS' || p.positionKey === 'TORTAS/MULITAS';
      }
      if (selectedPositionKey === 'Ventana 1' || selectedPositionKey === 'Ventana 2') {
        return p.positionKey === 'Caja 1 / Salón' || p.positionKey === 'Uber + Salsas';
      }
      return p.positionKey === selectedPositionKey;
    });
  }, [recipeProducts, selectedPositionKey]);

  const stationReviewItems = useMemo(() => {
    const seen = new Set<string>();
    const items: Array<{ slug: string; label: string; hasVideo: boolean }> = [];
    for (const v of stationVideos) {
      if (seen.has(v.slug)) continue;
      seen.add(v.slug);
      items.push({
        slug: v.slug,
        label: lang === 'en' ? v.titleEn : v.titleEs,
        hasVideo: Boolean(v.videoUrl),
      });
    }
    for (const rp of stationRecipeProducts) {
      if (seen.has(rp.slug)) continue;
      seen.add(rp.slug);
      items.push({
        slug: rp.slug,
        label: rp.name,
        hasVideo: rp.hasVideo,
      });
    }
    return items;
  }, [stationVideos, stationRecipeProducts, lang]);

  const catalogCategories = useMemo(() => {
    return Array.from(new Set(recipeProducts.map((p) => p.category))).sort();
  }, [recipeProducts]);

  const filteredRecipeProducts = useMemo(() => {
    return recipeProducts.filter((p) => {
      if (catalogCategory !== 'ALL' && p.category !== catalogCategory) return false;
      if (catalogSearch.trim()) {
        const q = catalogSearch.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          p.positionKey.toLowerCase().includes(q) ||
          p.ingredients.some((i) => i.name.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [recipeProducts, catalogCategory, catalogSearch]);

  // Day 3 Grouped Shift Activities
  const groupedActivities = useMemo(() => {
    const acts = currentPosition?.activities || [];
    const apertura = acts.filter((a) => a.shiftType.toLowerCase().includes('apertura'));
    const cierre = acts.filter((a) => a.shiftType.toLowerCase().includes('cierre'));
    const regular = acts.filter(
      (a) =>
        !a.shiftType.toLowerCase().includes('apertura') &&
        !a.shiftType.toLowerCase().includes('cierre')
    );

    return {
      Apertura: apertura.map((a) => ({
        id: String(a.id),
        name: a.activity,
        time: `${a.durationMinutes} min`,
      })),
      Regular: regular.map((a) => ({
        id: String(a.id),
        name: a.activity,
        time: `${a.durationMinutes} min`,
      })),
      Cierre: cierre.map((a) => ({
        id: String(a.id),
        name: a.activity,
        time: `${a.durationMinutes} min`,
      })),
    };
  }, [currentPosition]);

  // Enrollment Creation / Retrieval (unified per store + employee for Role Certification)
  const ensureEnrollmentForEmployee = useCallback(
    async (
      emp: RealPlanificadorEmployee,
      stationKey: string,
      trainer?: string
    ): Promise<TrainingEnrollment | null> => {
      if (!selectedStore) return null;
      const existing = enrollments.find(
        (enr) =>
          Number(enr.store_id) === Number(selectedStore.id) &&
          enr.employee_name.toLowerCase() === emp.full_name.toLowerCase()
      );
      if (existing) return existing;

      try {
        const res = await fetch('/api/training/enrollments', {
          method: 'POST',
          headers: getClientAuthHeaders({ 'Content-Type': 'application/json' }),
          credentials: 'include',
          body: JSON.stringify({
            employeeName: emp.full_name,
            employeeId: emp.id,
            employeePhone: emp.phone,
            storeId: selectedStore.id,
            storeName: selectedStore.name,
            positionKey: stationKey,
            trainerName: trainer || selectedTrainerName || storeTrainers[0] || 'Manager',
            durationDays: 4,
          }),
        });
        const data = await res.json();
        if (data.ok && data.enrollment) {
          setEnrollments((prev) => {
            if (prev.some((x) => x.id === data.enrollment.id)) {
              return prev.map((x) => (x.id === data.enrollment.id ? data.enrollment : x));
            }
            return [data.enrollment, ...prev];
          });
          return data.enrollment;
        }
      } catch (err) {
        console.error('[TrainingPage] Error ensuring enrollment:', err);
      }
      return null;
    },
    [enrollments, selectedStore, selectedTrainerName, storeTrainers]
  );

  // Select Planificador Employee (Hydrates / Clears ALL state cleanly)
  const handleSelectPlanificadorEmployee = async (empId: string) => {
    setSelectedEmployeeId(empId);
    setAllowVeteranRetraining(false);

    if (!empId) {
      resetAndHydrateEnrollmentState(null);
      return;
    }

    const emp =
      storeEmployees.find((e) => e.id === empId) ||
      allEmployees.find((e) => e.id === empId);
    if (!emp) {
      resetAndHydrateEnrollmentState(null);
      return;
    }

    setEmailInput(emp.email || '');
    const validStation = positions.some((p) => p.positionKey === emp.assigned_station)
      ? emp.assigned_station
      : emp.required_stations?.[0]?.stationKey || 'CARNES';

    setSelectedPositionKey(validStation);
    setSelectedVideoSlug(pickVideoSlugForStation(validStation));

    if (emp.is_new_hire && selectedStore) {
      const enr = await ensureEnrollmentForEmployee(emp, validStation);
      resetAndHydrateEnrollmentState(enr);
    } else {
      const existingVetEnr =
        enrollments.find(
          (enr) =>
            selectedStore &&
            Number(enr.store_id) === Number(selectedStore.id) &&
            enr.employee_name.toLowerCase() === emp.full_name.toLowerCase()
        ) || null;
      resetAndHydrateEnrollmentState(existingVetEnr);
    }
  };

  // Switch station pill while keeping selected employee's enrollment cleanly
  const handleSelectStationPill = (stationKey: string) => {
    stopAllMedia();
    setCurrentTime(0);
    setSelectedPositionKey(stationKey);
    setSelectedVideoSlug(pickVideoSlugForStation(stationKey));
    setQuizAnswers({});
    setQuizSubmittedResult(null);
    setDay4ExamAnswers({});
    setDay4WarningMsg(null);
  };

  // RONOS PIN Verification (with anti-spoofing ownership validation)
  const handleVerifyRonosPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStore || !selectedEmployee) return;

    const cleanPin = ronosPinInput.replace(/\D/g, '').trim();
    if (cleanPin.length !== 4) {
      setRonosErrorMsg(t('training.ronos_enter_4_digits'));
      return;
    }

    setRonosVerifyBusy(true);
    setRonosErrorMsg(null);
    try {
      const res = await fetch('/api/training/ronos-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: selectedStore.id,
          storeName: selectedStore.name,
          pin: cleanPin,
          employeeId: selectedEmployee.id,
          expectedEmployeeName: selectedEmployee.full_name,
          stationKey: selectedPositionKey,
          trainerName: selectedTrainerName || storeTrainers[0],
          autoCertified: selectedEmployee.auto_certified,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.code === 'PIN_OWNER_MISMATCH' && data.pinOwnerName) {
          setRonosErrorMsg(
            t('training.ronos_mismatch_error', {
              owner: data.pinOwnerName,
              selected: selectedEmployee.full_name,
            })
          );
        } else {
          setRonosErrorMsg(data.error || t('training.ronos_pin_invalid'));
        }
        setRonosVerifiedInfo(null);
      } else {
        setRonosVerifiedInfo(data.ronosEmployee);
        setRonosErrorMsg(null);
        if (data.enrollment) {
          setEnrollments((prev) => {
            if (prev.some((x) => x.id === data.enrollment.id)) {
              return prev.map((x) => (x.id === data.enrollment.id ? data.enrollment : x));
            }
            return [data.enrollment, ...prev];
          });
          setActiveTraineeId(data.enrollment.id);
        }
      }
    } catch {
      setRonosErrorMsg(t('training.ronos_connection_error'));
    } finally {
      setRonosVerifyBusy(false);
    }
  };

  // Send Email Link (Zero SMS)
  const handleSendTrainingEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStore || !selectedEmployee) return;
    setEmailSending(true);
    setEmailFeedback(null);
    try {
      const res = await fetch('/api/training/send-email', {
        method: 'POST',
        headers: getClientAuthHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'include',
        body: JSON.stringify({
          storeId: selectedStore.id,
          storeName: selectedStore.name,
          employeeId: selectedEmployee.id,
          employeeName: selectedEmployee.full_name,
          email: emailInput.trim(),
          stationLabel:
            lang === 'en'
              ? selectedEmployee.job_role_title_en
              : selectedEmployee.job_role_title_es,
          trainerName: selectedTrainerName || storeTrainers[0] || t('training.fallback_store_manager'),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setEmailFeedback({ ok: false, msg: data.error || t('training.email_send_error') });
      } else {
        setEmailFeedback({
          ok: true,
          msg: t('training.email_sent_ok', { email: data.sentTo }),
        });
        setAllEmployees((prev) =>
          prev.map((emp) => (emp.id === selectedEmployee.id ? { ...emp, email: data.sentTo } : emp))
        );
      }
    } catch {
      setEmailFeedback({ ok: false, msg: t('training.email_network_error') });
    } finally {
      setEmailSending(false);
    }
  };

  // Audio playback of AI Male Tutor Voice (Orus) — Video remains 100% muted
  const playStepVoiceover = useCallback(
    async (step: TrainingVideoStep, pauseVideoUntilDone = false) => {
      if (!voiceEnabled) return;
      const vid = videoRef.current;
      if (vid) {
        vid.muted = true;
        vid.volume = 0;
      }

      const textToSpeak = lang === 'en' ? step.narrationEn || step.narrationEs : step.narrationEs;
      if (!textToSpeak) return;

      const prebuiltUrl = lang === 'en' ? step.audioUrlEn : step.audioUrlEs;
      const audioSrc =
        prebuiltUrl ||
        `/api/training/tts?text=${encodeURIComponent(textToSpeak)}&lang=${lang}&voice=Orus`;

      if (pauseVideoUntilDone && vid && !vid.paused) {
        vid.pause();
        autoPausedForVoiceRef.current = true;
        setAutoPausedForVoice(true);
      }

      try {
        const audio = audioRef.current;
        if (!audio) return;
        audio.pause();
        audio.src = audioSrc;
        audio.load();
        setIsVoiceSpeaking(true);
        await audio.play();
      } catch (err) {
        console.warn('[TrainingPlayer] Audio playback blocked:', err);
        setIsVoiceSpeaking(false);
        autoPausedForVoiceRef.current = false;
        setAutoPausedForVoice(false);
      }
    },
    [voiceEnabled, lang]
  );

  const resumeAfterVoiceOrError = () => {
    setIsVoiceSpeaking(false);
    const vid = videoRef.current;
    if (vid) {
      vid.muted = true;
      vid.volume = 0;
    }
    if (autoPausedForVoiceRef.current && vid) {
      autoPausedForVoiceRef.current = false;
      setAutoPausedForVoice(false);
      const pausedStep = currentVideo?.steps.find((s) => s.id === pausedBoundaryStepIdRef.current);
      if (
        pausedStep &&
        vid.currentTime < pausedStep.endSec &&
        Number.isFinite(vid.duration) &&
        pausedStep.endSec < vid.duration - 0.15
      ) {
        vid.currentTime = pausedStep.endSec;
      }
      if (!vid.ended && (!Number.isFinite(vid.duration) || vid.currentTime < vid.duration - 0.15)) {
        vid.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    } else {
      autoPausedForVoiceRef.current = false;
      setAutoPausedForVoice(false);
    }
  };

  // Auto-trigger AI Voice & Smart Pause at step boundary
  const handleVideoTimeUpdate = () => {
    const vid = videoRef.current;
    if (!vid || !currentVideo) return;
    if (!vid.muted || vid.volume !== 0) {
      vid.muted = true;
      vid.volume = 0;
    }
    const now = vid.currentTime;
    setCurrentTime(now);

    const activeStep = currentVideo.steps.find((s) => now >= s.startSec && now < s.endSec);
    if (!activeStep) return;

    if (lastSpokenStepIdRef.current !== activeStep.id && voiceEnabled) {
      lastSpokenStepIdRef.current = activeStep.id;
      playStepVoiceover(activeStep, false);
    }

    const isAudioActuallyPlaying = Boolean(
      audioRef.current && !audioRef.current.paused && !audioRef.current.ended
    );
    if (
      isAudioActuallyPlaying &&
      pausedBoundaryStepIdRef.current !== activeStep.id &&
      now >= activeStep.endSec - 0.35 &&
      !vid.paused
    ) {
      pausedBoundaryStepIdRef.current = activeStep.id;
      autoPausedForVoiceRef.current = true;
      vid.pause();
      setIsPlaying(false);
      setAutoPausedForVoice(true);
    }
  };

  const togglePlayVideo = () => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.muted = true;
    vid.volume = 0;
    autoPausedForVoiceRef.current = false;
    setAutoPausedForVoice(false);
    if (vid.paused) {
      if (vid.ended || (Number.isFinite(vid.duration) && vid.duration > 0 && vid.currentTime >= vid.duration - 0.3)) {
        vid.currentTime = 0;
        lastSpokenStepIdRef.current = null;
        pausedBoundaryStepIdRef.current = null;
      }
      if (vid.currentTime < 0.3 && currentVideo?.steps[0] && voiceEnabled) {
        lastSpokenStepIdRef.current = currentVideo.steps[0].id;
        playStepVoiceover(currentVideo.steps[0], false);
      }
      vid.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      vid.pause();
      if (audioRef.current) audioRef.current.pause();
      setIsVoiceSpeaking(false);
      setIsPlaying(false);
    }
  };

  const handleToggleFullscreen = () => {
    const target = videoContainerRef.current || videoRef.current;
    if (!target) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (target.requestFullscreen) {
      target.requestFullscreen().catch(() => {});
    } else if ((videoRef.current as any)?.webkitEnterFullscreen) {
      (videoRef.current as any).webkitEnterFullscreen();
    }
  };

  const jumpToStep = (step: TrainingVideoStep) => {
    const vid = videoRef.current;
    lastSpokenStepIdRef.current = step.id;
    pausedBoundaryStepIdRef.current = null;
    autoPausedForVoiceRef.current = false;
    setAutoPausedForVoice(false);
    setCurrentTime(step.startSec);
    if (vid) {
      vid.muted = true;
      vid.volume = 0;
      vid.currentTime = step.startSec;
      vid.pause();
      setIsPlaying(false);
    }
    playStepVoiceover(step, false);
  };

  // Pause video right here to add a text step -> auto AI voice (Orus)
  const handlePauseToAddStepHere = () => {
    const vid = videoRef.current;
    let sec = currentTime;
    if (vid) {
      vid.pause();
      sec = vid.currentTime;
      setIsPlaying(false);
    }
    if (audioRef.current) {
      audioRef.current.pause();
      setIsVoiceSpeaking(false);
    }
    setPausedTimestampSec(sec);
    setNewStepTitle('');
    setNewStepPortion('');
    setNewStepNarration('');
    setPausedStepError(null);
    setShowAddStepAtPauseBox(true);
  };

  const handleSavePausedStepWithAiVoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentVideo || !newStepNarration.trim()) return;
    setSavingPausedStepBusy(true);
    setPausedStepError(null);
    try {
      const sSec = Math.max(0, Math.floor(pausedTimestampSec));
      const eSec = sSec + 6;
      const narration = newStepNarration.trim();

      const newStep: TrainingVideoStep = {
        id: `${currentVideo.slug}-custom-${Date.now()}`,
        stepNumber: currentVideo.steps.length + 1,
        startSec: sSec,
        endSec: eSec,
        timestampLabel: `${formatSeconds(sSec)} - ${formatSeconds(eSec)}`,
        titleEs: newStepTitle.trim() || `Paso en ${formatSeconds(sSec)}`,
        titleEn: newStepTitle.trim() || `Step at ${formatSeconds(sSec)}`,
        narrationEs: narration,
        narrationEn: '', // El backend traduce limpiamente al inglés cuando viene vacío
        keyPortionEs: newStepPortion.trim() || 'Estándar SOP',
        keyPortionEn: newStepPortion.trim() || 'SOP Standard',
        utensilEs: 'Estándar de línea',
        utensilEn: 'Line standard',
      };

      const combinedSteps = [...currentVideo.steps, newStep];

      const res = await fetch('/api/training/catalog', {
        method: 'PUT',
        headers: getClientAuthHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'include',
        body: JSON.stringify({
          slug: currentVideo.slug,
          positionKey: currentVideo.positionKey,
          titleEs: currentVideo.titleEs,
          titleEn: currentVideo.titleEn,
          steps: combinedSteps,
          recipeSpecs: currentVideo.recipeSpecs,
          voiceId: 'Orus',
          regenerateVoice: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setPausedStepError(data.error || t('training.step_save_error'));
        return;
      }

      if (data.steps) {
        setVideos((prev) =>
          prev.some((v) => v.slug === currentVideo.slug)
            ? prev.map((v) => (v.slug === currentVideo.slug ? { ...v, steps: data.steps } : v))
            : [...prev, { ...currentVideo, steps: data.steps }]
        );
        setRecipeProducts((prev) =>
          prev.map((rp) => (rp.slug === currentVideo.slug ? { ...rp, steps: data.steps } : rp))
        );
        const savedCreated = data.steps.find((st: TrainingVideoStep) => st.id === newStep.id) || data.steps[data.steps.length - 1];
        setShowAddStepAtPauseBox(false);
        if (savedCreated) {
          playStepVoiceover(savedCreated, false);
        }
      }
    } catch (err: any) {
      setPausedStepError(err?.message || t('training.step_save_error'));
    } finally {
      setSavingPausedStepBusy(false);
    }
  };

  // Signed Direct Upload to Supabase Storage (supports heavy .mp4 files without Vercel 4.5MB limit)
  const triggerVideoUploadForProduct = (product: {
    slug: string;
    name: string;
    positionKey: string;
    ingredients: any[];
  }) => {
    setVideoActionFeedback(null);
    setUploadTargetProduct(product);
    if (uploadInputRef.current) {
      uploadInputRef.current.value = '';
      uploadInputRef.current.click();
    }
  };

  const handleVideoFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadTargetProduct) return;

    const target = uploadTargetProduct;
    setUploadingVideoSlug(target.slug);
    setVideoActionFeedback(null);

    try {
      const durationSec = await new Promise<number>((resolve) => {
        const tempVid = document.createElement('video');
        tempVid.preload = 'metadata';
        const objectUrl = URL.createObjectURL(file);
        tempVid.onloadedmetadata = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(Math.max(12, Math.round(tempVid.duration || 45)));
        };
        tempVid.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(45);
        };
        tempVid.src = objectUrl;
      });

      const authHeaders = getClientAuthHeaders({ 'Content-Type': 'application/json' });

      // Step 1: Request signed upload URL
      const signRes = await fetch('/api/training/video', {
        method: 'POST',
        headers: authHeaders,
        credentials: 'include',
        body: JSON.stringify({
          action: 'create-upload-url',
          slug: target.slug,
          fileName: file.name,
          contentType: file.type || 'video/mp4',
        }),
      });
      const signJson = await signRes.json();
      if (!signRes.ok || !signJson.ok || !signJson.signedUrl) {
        throw new Error(signJson.error || 'Error creating upload URL');
      }

      // Step 2: Upload binary directly to Supabase Storage
      const putRes = await fetch(signJson.signedUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'video/mp4',
          'x-upsert': 'true',
        },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`Storage upload failed (${putRes.status})`);
      }

      // Step 3: Finalize DB record & generate adaptive AI voice steps
      const finRes = await fetch('/api/training/video', {
        method: 'POST',
        headers: authHeaders,
        credentials: 'include',
        body: JSON.stringify({
          action: 'finalize-upload',
          slug: target.slug,
          titleEs: target.name,
          titleEn: target.name,
          positionKey: target.positionKey,
          durationSeconds: durationSec,
          ingredients: target.ingredients || [],
          publicUrl: signJson.publicUrl,
          sourceVideoFilename: file.name,
          autoAdaptVoice: true,
        }),
      });
      const finJson = await finRes.json();
      if (!finRes.ok || !finJson.ok) {
        throw new Error(finJson.error || 'Error finalizing video upload');
      }

      await loadTrainingData();
      setSelectedPositionKey(target.positionKey);
      setSelectedVideoSlug(target.slug);
      setVideoActionFeedback({ ok: true, msg: t('training.video_upload_success') });
    } catch (err: any) {
      console.error('[TrainingPage] Upload error:', err);
      setVideoActionFeedback({
        ok: false,
        msg: t('training.video_upload_error', { error: err?.message || 'Error' }),
      });
    } finally {
      setUploadingVideoSlug(null);
      setUploadTargetProduct(null);
    }
  };

  const handleDeleteProductVideo = async (slug: string, productName: string) => {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(t('training.confirm_delete_video', { name: productName }));
      if (!confirmed) return;
    }

    setDeletingVideoSlug(slug);
    setVideoActionFeedback(null);
    try {
      const res = await fetch(`/api/training/catalog?slug=${encodeURIComponent(slug)}`, {
        method: 'DELETE',
        headers: getClientAuthHeaders(),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || t('training.video_delete_error'));
      }
      await loadTrainingData();
    } catch (err: any) {
      setVideoActionFeedback({
        ok: false,
        msg: err?.message || t('training.video_delete_error'),
      });
    } finally {
      setDeletingVideoSlug(null);
    }
  };

  const handleReprocessVideoWithAi = async () => {
    if (!currentVideo || !currentVideo.videoUrl) return;
    stopAllMedia();
    setReprocessingVideoSlug(currentVideo.slug);
    setVideoActionFeedback(null);
    try {
      const res = await fetch('/api/training/video', {
        method: 'POST',
        headers: getClientAuthHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'include',
        body: JSON.stringify({
          action: 'reprocess-video',
          slug: currentVideo.slug,
          titleEs: currentVideo.titleEs,
          titleEn: currentVideo.titleEn,
          positionKey: currentVideo.positionKey,
          durationSeconds: currentVideo.durationSeconds,
          ingredients: currentVideo.recipeSpecs.map((r) => ({
            name: r.itemEs,
            quantity: Number(r.quantity) || 1,
            unit: r.unit,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || t('training.step_save_error'));
      }
      await loadTrainingData();
      setVideoActionFeedback({ ok: true, msg: t('training.video_reprocessed_ok') });
    } catch (err: any) {
      setVideoActionFeedback({
        ok: false,
        msg: err?.message || t('training.step_save_error'),
      });
    } finally {
      setReprocessingVideoSlug(null);
    }
  };

  // Stopwatch Loop
  useEffect(() => {
    if (!stopwatchRunning) return;
    const interval = setInterval(() => {
      setStopwatchElapsedDeci((prev) => prev + 1);
    }, 100);
    return () => clearInterval(interval);
  }, [stopwatchRunning]);

  const saveTraineeProgress = async (action: string, payload: Record<string, any>) => {
    let targetEnrollment = activeTrainee;
    if (!targetEnrollment && selectedEmployee) {
      targetEnrollment = await ensureEnrollmentForEmployee(selectedEmployee, selectedPositionKey);
    }
    if (!targetEnrollment) return null;

    const res = await fetch('/api/training/enrollments', {
      method: 'PUT',
      headers: getClientAuthHeaders({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify({
        id: targetEnrollment.id,
        action,
        ...payload,
      }),
    });
    const data = await res.json();
    if (res.ok && data.ok && data.enrollment) {
      setEnrollments((prev) => prev.map((e) => (e.id === data.enrollment.id ? data.enrollment : e)));
      setActiveTraineeId(data.enrollment.id);
      return data.enrollment as TrainingEnrollment;
    }
    return null;
  };

  const handleGradeDay1Quiz = async () => {
    if (!currentVideo) return;
    if (!selectedEmployee) {
      setDay4WarningMsg(t('training.select_employee_first_warning'));
      return;
    }

    const questions = activeDay1Quiz;
    let correct = 0;
    for (const q of questions) {
      if (quizAnswers[q.id] === q.correctIndex) correct++;
    }
    const score = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 100;
    const passed = score >= 80;
    setQuizSubmittedResult({ score, passed });

    await saveTraineeProgress('complete_day1', {
      quizScore: score,
      videosWatched: [currentVideo.slug],
    });
  };

  const handleCompleteDay2 = async () => {
    if (!currentPosition) return;
    if (!selectedEmployee) {
      setDay2WarningMsg(t('training.select_employee_first_warning'));
      return;
    }

    const minRequiredReps = Math.min(3, currentPosition.day2TargetReps || 3);
    const verifiedStepsCount = Object.values(day2Rubric).filter(Boolean).length;
    if (day2Reps < minRequiredReps || verifiedStepsCount === 0) {
      setDay2WarningMsg(t('training.day2_validation_warning', { minReps: minRequiredReps }));
      return;
    }

    setDay2WarningMsg(null);
    const saved = await saveTraineeProgress('complete_day2', {
      supervisedReps: day2Reps,
      checklistJson: day2Rubric,
      approvedBy: selectedTrainerName || storeTrainers[0] || t('training.fallback_store_manager'),
      supervisorNotes: day2Notes,
    });

    if (saved) {
      setDay2SavedBanner(true);
      if (day2BannerTimerRef.current) clearTimeout(day2BannerTimerRef.current);
      day2BannerTimerRef.current = setTimeout(() => setDay2SavedBanner(false), 3500);
    }
  };

  const handleStopAndRecordStopwatch = async () => {
    setStopwatchRunning(false);
    if (stopwatchElapsedDeci < 10) {
      setDay3WarningMsg(t('training.day3_min_sec_warning'));
      return;
    }
    setDay3WarningMsg(null);
    const recordedSec = Math.round(stopwatchElapsedDeci / 10);
    const nextReps = day3SoloReps + 1;
    const nextBest =
      day3BestTimeSec === null ? recordedSec : Math.min(day3BestTimeSec, recordedSec);

    setDay3SoloReps(nextReps);
    setDay3BestTimeSec(nextBest);
    setStopwatchElapsedDeci(0);

    await saveTraineeProgress('update_progress', {
      day3SoloReps: nextReps,
      day3BestTimeSeconds: nextBest,
      day3ChecklistJson: day3ActivitiesChecked,
    });
  };

  const handleCompleteDay3 = async () => {
    if (!selectedEmployee) {
      setDay3WarningMsg(t('training.select_employee_first_warning'));
      return;
    }
    if (day3SoloReps < 1 && day3BestTimeSec === null) {
      setDay3WarningMsg(t('training.day3_validation_warning'));
      return;
    }
    setDay3WarningMsg(null);
    const saved = await saveTraineeProgress('complete_day3', {
      soloReps: Math.max(1, day3SoloReps),
      bestTimeSeconds: day3BestTimeSec,
      checklistJson: day3ActivitiesChecked,
      approvedBy: selectedTrainerName || storeTrainers[0] || t('training.fallback_store_manager'),
    });
    if (saved) {
      setActiveTab('day4');
    }
  };

  // Live Day 4 score calculation
  const day4LiveScores = useMemo(() => {
    const questions = activeDay1Quiz;
    let correct = 0;
    for (const q of questions) {
      if (day4ExamAnswers[q.id] === q.correctIndex) correct++;
    }
    const examScore = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 100;

    const auditVals = Object.values(day4AuditChecks);
    const practicalPassed = auditVals.filter(Boolean).length;
    const practicalScore = Math.round((practicalPassed / auditVals.length) * 100);
    const combinedScore = Math.round((examScore + practicalScore) / 2);
    return { examScore, practicalScore, combinedScore };
  }, [activeDay1Quiz, day4ExamAnswers, day4AuditChecks]);

  const handleIssueDay4Certification = async () => {
    if (!currentVideo || !currentPosition) return;
    if (!selectedEmployee) {
      setDay4WarningMsg(t('training.day4_select_employee_warning'));
      return;
    }

    setDay4SavingBusy(true);
    setDay4WarningMsg(null);
    try {
      const { examScore, practicalScore, combinedScore } = day4LiveScores;
      const passed = combinedScore >= 90;

      const updatedEnr = await saveTraineeProgress('certify_day4', {
        examScore,
        practicalScore,
        certifiedBy: selectedTrainerName || storeTrainers[0] || t('training.fallback_store_manager'),
      });

      setCertificationResult({
        passed,
        combinedScore,
        folio: updatedEnr?.certificate_folio || null,
      });

      if (!passed) {
        setDay4WarningMsg(t('training.day4_fail_retry_msg', { score: combinedScore }));
      }
    } finally {
      setDay4SavingBusy(false);
    }
  };

  // AI Step Editor (modal with separate ES and EN inputs)
  const openStepEditor = () => {
    if (!currentVideo) return;
    setEditingSteps(currentVideo.steps.map((s) => ({ ...s })));
    setEditorErrorMsg(null);
    setShowStepEditorModal(true);
  };

  const handleAiExplainStep = async (stepIndex: number) => {
    if (!currentVideo) return;
    const step = editingSteps[stepIndex];
    if (!step) return;
    setAiExplainStepBusyId(step.id);
    setEditorErrorMsg(null);
    try {
      const res = await fetch('/api/training/tts', {
        method: 'POST',
        headers: getClientAuthHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'include',
        body: JSON.stringify({
          mode: 'ai-explain',
          voice: 'Orus',
          dishTitle: currentVideo.titleEs,
          stepTitle: step.titleEs,
          stepNumber: step.stepNumber,
          rawHint: step.narrationEs || step.titleEs,
          narrationEn: step.narrationEn,
          keyPortionEs: step.keyPortionEs,
          keyPortionEn: step.keyPortionEn,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setEditingSteps((prev) =>
          prev.map((s, idx) =>
            idx === stepIndex
              ? {
                  ...s,
                  narrationEs: data.narrationEs || s.narrationEs,
                  narrationEn: data.narrationEn || s.narrationEn,
                  keyPortionEs: data.keyPortionEs || s.keyPortionEs,
                  keyPortionEn: data.keyPortionEn || s.keyPortionEn,
                  audioUrlEs: data.audioUrlEs || s.audioUrlEs,
                  audioUrlEn: data.audioUrlEn || s.audioUrlEn,
                }
              : s
          )
        );
      } else {
        setEditorErrorMsg(data.error || t('training.step_save_error'));
      }
    } catch (err: any) {
      setEditorErrorMsg(err?.message || t('training.step_save_error'));
    } finally {
      setAiExplainStepBusyId(null);
    }
  };

  const handleSaveEditedSteps = async () => {
    if (!currentVideo) return;
    setSavingStepsBusy(true);
    setEditorErrorMsg(null);
    try {
      const res = await fetch('/api/training/catalog', {
        method: 'PUT',
        headers: getClientAuthHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'include',
        body: JSON.stringify({
          slug: currentVideo.slug,
          positionKey: currentVideo.positionKey,
          titleEs: currentVideo.titleEs,
          titleEn: currentVideo.titleEn,
          steps: editingSteps,
          recipeSpecs: currentVideo.recipeSpecs,
          voiceId: 'Orus',
          regenerateVoice: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setEditorErrorMsg(data.error || t('training.step_save_error'));
        return;
      }
      if (data.steps) {
        setVideos((prev) =>
          prev.some((v) => v.slug === currentVideo.slug)
            ? prev.map((v) => (v.slug === currentVideo.slug ? { ...v, steps: data.steps } : v))
            : [...prev, { ...currentVideo, steps: data.steps }]
        );
        setRecipeProducts((prev) =>
          prev.map((rp) => (rp.slug === currentVideo.slug ? { ...rp, steps: data.steps } : rp))
        );
      }
      setShowStepEditorModal(false);
    } catch (err: any) {
      setEditorErrorMsg(err?.message || t('training.step_save_error'));
    } finally {
      setSavingStepsBusy(false);
    }
  };

  const showAutoVeteranCertificate =
    mainView === 'staff' &&
    Boolean(selectedEmployee && selectedEmployee.auto_certified) &&
    !allowVeteranRetraining;

  const isDay4Certified = Boolean(
    activeTrainee?.day4_completed || certificationResult?.passed
  );

  const isAdminFreeVideoReview = isAdmin && mainView === 'videos';
  const isStaffActiveTraining =
    mainView === 'staff' && Boolean(selectedEmployee) && !showAutoVeteranCertificate;

  return (
    <div
      className="min-h-screen w-full text-[#0F172A]"
      style={{ backgroundColor: '#FFFAF5', colorScheme: 'light' }}
    >
      {/* Hidden Audio Player for Male AI Voice (Orus) */}
      <audio
        ref={audioRef}
        onEnded={resumeAfterVoiceOrError}
        onError={resumeAfterVoiceOrError}
        className="hidden"
      />

      {/* Hidden File Input for Signed Direct Video Upload */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        onChange={handleVideoFileSelected}
        className="hidden"
      />

      {/* Contenedor Principal de UI (Oculto cuando el Modal de Lista Maestra está abierto para impresión limpia) */}
      <div className={showPrintableChecklistModal ? 'print:hidden' : ''}>
        {/* 1. ENCABEZADO ÚNICO COMPACTO */}
        <header className="sticky top-0 z-30 border-b border-[#F1E4D8] bg-white shadow-xs print:hidden">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FFF5EB] border border-[#FFC72C] flex items-center justify-center p-1 shrink-0">
                <img src="/logo.png" alt="Tacos Gavilan" className="w-full h-full object-contain" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h1 className="text-base sm:text-xl font-black text-[#0F172A] tracking-tight">
                    {t('training.simple_title')} — Tacos Gavilan
                  </h1>
                  <button
                    type="button"
                    onClick={() => setShowHowItWorksModal(true)}
                    className="p-1 rounded-full text-slate-400 hover:text-[#DA291C] cursor-pointer"
                    title={t('training.how_it_works_btn')}
                  >
                    <HelpCircle className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs font-medium text-slate-500 hidden sm:block">
                  {t('training.simple_subtitle')}
                </p>
              </div>
            </div>

            {/* Pestañas Principales + Hoja de Control */}
            <div className="flex flex-wrap items-center gap-2">
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    stopAllMedia();
                    if (day1SubStep === 'quiz') setDay1SubStep('video');
                    setMainView('videos');
                  }}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer ${
                    mainView === 'videos'
                      ? 'bg-[#DA291C] text-white shadow-xs'
                      : 'bg-[#FFFAF5] hover:bg-[#FFF0E5] text-[#0F172A] border border-[#F1E4D8]'
                  }`}
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>{t('training.tab_admin_videos_review')}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  stopAllMedia();
                  setMainView('staff');
                }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer ${
                  mainView === 'staff'
                    ? 'bg-[#DA291C] text-white shadow-xs'
                    : 'bg-[#FFFAF5] hover:bg-[#FFF0E5] text-[#0F172A] border border-[#F1E4D8]'
                }`}
              >
                <UserCheck className="w-4 h-4" />
                <span>{t('training.tab_staff_training')}</span>
              </button>

              {canManageCatalog && (
                <button
                  type="button"
                  onClick={() => {
                    stopAllMedia();
                    setMainView('catalog');
                  }}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer ${
                    mainView === 'catalog'
                      ? 'bg-[#DA291C] text-white shadow-xs'
                      : 'bg-[#FFFAF5] hover:bg-[#FFF0E5] text-[#0F172A] border border-[#F1E4D8]'
                  }`}
                >
                  <Video className="w-4 h-4" />
                  <span>{t('training.tab_video_catalog', { count: recipeProducts.length })}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowPrintableChecklistModal(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold bg-white hover:bg-[#FFF5EB] text-[#0F172A] border border-slate-200 cursor-pointer transition-all"
              >
                <Printer className="w-4 h-4 text-[#DA291C]" />
                <span>{t('training.btn_print_control_sheet')}</span>
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-3 sm:px-6 py-5 space-y-5 print:p-0">
          {/* Feedback global de carga o subida de video */}
          {videoActionFeedback && (
            <div
              className={`rounded-2xl px-4 py-3 text-xs sm:text-sm font-bold flex items-center justify-between gap-3 border print:hidden ${
                videoActionFeedback.ok
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              <span>{videoActionFeedback.msg}</span>
              <button
                type="button"
                onClick={() => setVideoActionFeedback(null)}
                className="p-1 rounded-lg hover:bg-black/5 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {loadError && (
            <div className="rounded-2xl bg-red-50 border border-red-200 p-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
              <div className="flex items-center gap-2 text-sm font-bold text-red-700">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>{t('training.load_error_banner')}</span>
              </div>
              <button
                type="button"
                onClick={loadTrainingData}
                className="px-4 py-2 rounded-xl bg-[#DA291C] text-white text-xs font-black cursor-pointer"
              >
                {t('training.retry_btn')}
              </button>
            </div>
          )}

          {loadingData && (
            <div className="bg-white rounded-3xl border border-[#F1E4D8] p-12 flex flex-col items-center justify-center gap-3 text-slate-600 print:hidden">
              <Loader2 className="w-8 h-8 animate-spin text-[#DA291C]" />
              <span className="text-sm font-bold">{t('training.loading_training_data')}</span>
            </div>
          )}

          {/* =====================================================================
              VISTA 1: PERSONAL Y CAPACITACIÓN (FLUJO GUIADO SIN CAOS VISUAL)
             ===================================================================== */}
          {!loadingData && mainView === 'staff' && (
            <>
              {/* PASO A: SI NO HAY COLABORADOR ELEGIDO, MOSTRAR SOLO SELECTOR LIMPIO DE PERSONAS */}
              {!selectedEmployee && (
                <section className="bg-white rounded-3xl border border-[#F1E4D8] p-5 sm:p-6 shadow-xs space-y-5 print:hidden">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg sm:text-xl font-black text-[#0F172A]">
                        {t('training.select_person_step_title')}
                      </h2>
                      <p className="text-xs sm:text-sm font-medium text-slate-600 mt-0.5">
                        {t('training.select_person_step_desc')}
                      </p>
                    </div>

                    {/* Filtros Limpios */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEmployeeFilterMode('new_hires')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer border transition-all ${
                          employeeFilterMode === 'new_hires'
                            ? 'bg-[#0F172A] text-white border-[#0F172A]'
                            : 'bg-[#FFFAF5] text-slate-700 border-[#F1E4D8] hover:bg-[#FFF0E5]'
                        }`}
                      >
                        {t('training.filter_new_hires')} ({newHireStoreEmployees.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setEmployeeFilterMode('certified')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer border transition-all ${
                          employeeFilterMode === 'certified'
                            ? 'bg-emerald-700 text-white border-emerald-700'
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                        }`}
                      >
                        {t('training.filter_veterans_certified')} ({certifiedStoreEmployees.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setEmployeeFilterMode('all')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer border transition-all ${
                          employeeFilterMode === 'all'
                            ? 'bg-[#DA291C] text-white border-[#DA291C]'
                            : 'bg-[#FFFAF5] text-slate-700 border-[#F1E4D8] hover:bg-[#FFF0E5]'
                        }`}
                      >
                        {t('training.filter_all_employees')} ({storeEmployees.length})
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => {
                            stopAllMedia();
                            if (day1SubStep === 'quiz') setDay1SubStep('video');
                            setMainView('videos');
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer border border-[#FFC72C] bg-[#FFF8E7] text-[#92400E] hover:bg-[#FFC72C]/25 transition-all"
                        >
                          <Play className="w-3.5 h-3.5 fill-current text-[#DA291C]" />
                          <span>{t('training.admin_shortcut_no_employee_btn')}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Controles: Sucursal + Entrenador en Turno + Buscador */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <div className="md:col-span-4 flex items-center gap-2.5 bg-[#FFFAF5] border border-[#F1E4D8] rounded-2xl px-3.5 py-2.5">
                      <StoreIcon className="w-4 h-4 text-[#DA291C] shrink-0" />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-[10px] font-bold uppercase text-slate-500">
                          {t('training.store_label')}
                        </span>
                        <select
                          value={selectedStoreId}
                          onChange={(e) => {
                            setSelectedStoreId(Number(e.target.value));
                            setSelectedEmployeeId('');
                            resetAndHydrateEnrollmentState(null);
                          }}
                          className="bg-transparent text-sm font-black text-[#0F172A] focus:outline-none cursor-pointer truncate"
                        >
                          {stores.map((st) => (
                            <option key={st.id} value={st.id}>
                              {st.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="md:col-span-4 flex items-center gap-2.5 bg-[#FFFAF5] border border-[#F1E4D8] rounded-2xl px-3.5 py-2.5">
                      <ChefHat className="w-4 h-4 text-[#DA291C] shrink-0" />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-[10px] font-bold uppercase text-slate-500">
                          {t('training.trainer_select_label')}
                        </span>
                        <select
                          value={selectedTrainerName}
                          onChange={(e) => setSelectedTrainerName(e.target.value)}
                          className="bg-transparent text-sm font-black text-[#0F172A] focus:outline-none cursor-pointer truncate"
                        >
                          {storeTrainers.map((tr) => (
                            <option key={tr} value={tr}>
                              {tr}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="md:col-span-4 relative flex items-center">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5" />
                      <input
                        type="text"
                        value={employeeSearch}
                        onChange={(e) => setEmployeeSearch(e.target.value)}
                        placeholder={t('training.search_employee_placeholder')}
                        className="w-full pl-10 pr-4 py-3 rounded-2xl border border-[#F1E4D8] bg-[#FFFAF5] text-sm font-semibold focus:outline-none focus:border-[#DA291C]"
                      />
                    </div>
                  </div>

                  {/* Cuadrícula de Personas Reales del Planificador */}
                  {filteredStoreEmployees.length === 0 ? (
                    <div className="p-8 rounded-2xl bg-[#FFFAF5] border border-[#F1E4D8] text-center text-sm font-semibold text-slate-500">
                      {t('training.no_employees_match')}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[560px] overflow-y-auto pr-1">
                      {filteredStoreEmployees.map((emp) => {
                        const stationCount = emp.required_stations?.length || 6;
                        return (
                          <button
                            key={emp.id}
                            type="button"
                            onClick={() => handleSelectPlanificadorEmployee(emp.id)}
                            className="text-left p-4 rounded-2xl bg-[#FFFAF5] hover:bg-white border border-[#F1E4D8] hover:border-[#DA291C] hover:shadow-sm transition-all cursor-pointer flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="text-sm sm:text-base font-black text-[#0F172A] truncate">
                                {emp.full_name}
                              </div>
                              <div className="text-xs font-bold text-slate-600 truncate">
                                {emp.job_titles[0] ||
                                  (lang === 'en' ? emp.job_role_title_en : emp.job_role_title_es)}
                                {' • '}
                                {t('training.role_stations_count', { count: stationCount })}
                              </div>
                              <div>
                                {emp.is_new_hire ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-100 text-[#DA291C] text-[11px] font-black">
                                    {t('training.new_hire_days_badge', { days: emp.tenure_days })}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-black">
                                    {t('training.certified_weeks_badge', { weeks: emp.tenure_weeks })}
                                  </span>
                                )}
                              </div>
                            </div>
                            <ChevronRight className="w-5 h-5 text-slate-400 shrink-0" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}

              {/* PASO B: EMPLEADO ELEGIDO -> BARRA COMPACTA DE CONTEXTO */}
              {selectedEmployee && (
                <section className="bg-white rounded-2xl border border-[#F1E4D8] p-3.5 sm:p-4 shadow-xs space-y-3 print:hidden">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          stopAllMedia();
                          setSelectedEmployeeId('');
                          setAllowVeteranRetraining(false);
                          resetAndHydrateEnrollmentState(null);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#FFFAF5] hover:bg-[#FFF0E5] border border-[#F1E4D8] text-xs font-bold text-[#0F172A] cursor-pointer"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        <span>{t('training.change_employee_btn')}</span>
                      </button>

                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base sm:text-lg font-black text-[#0F172A]">
                            {selectedEmployee.full_name}
                          </span>
                          <span className="px-2.5 py-0.5 rounded-full bg-[#FFF8E7] border border-[#FFC72C] text-xs font-bold text-[#0F172A]">
                            {lang === 'en'
                              ? selectedEmployee.job_role_badge_en
                              : selectedEmployee.job_role_badge_es}
                          </span>
                          {selectedEmployee.is_new_hire ? (
                            <span className="px-2.5 py-0.5 rounded-full bg-red-100 text-[#DA291C] text-xs font-bold">
                              {t('training.new_hire_days_badge', { days: selectedEmployee.tenure_days })}
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                              {t('training.certified_weeks_badge', { weeks: selectedEmployee.tenure_weeks })}
                            </span>
                          )}
                          {activeTrainee?.access_code && (
                            <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono text-xs font-bold">
                              {t('training.temp_code_badge', { code: activeTrainee.access_code })}
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-medium text-slate-500">
                          {selectedStore?.name} • {t('training.trainer_select_label')}{' '}
                          <strong className="text-slate-700">{selectedTrainerName}</strong>
                        </div>
                      </div>
                    </div>

                    {/* Acciones Derecha: Verificación RONOS + Email Link + Portal */}
                    <div className="flex flex-wrap items-center gap-2">
                      {!showAutoVeteranCertificate && selectedEmployee.auto_certified && (
                        <button
                          type="button"
                          onClick={() => {
                            stopAllMedia();
                            setAllowVeteranRetraining(false);
                          }}
                          className="px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-bold cursor-pointer"
                        >
                          {t('training.back_to_certificate_btn')}
                        </button>
                      )}

                      {(!selectedEmployee.auto_certified || allowVeteranRetraining) && (
                        <>
                          {/* Mini verificación RONOS (anti-suplantación) */}
                          {ronosVerifiedInfo ? (
                            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
                              <ShieldCheck className="w-4 h-4 text-emerald-600" />
                              <span>{ronosVerifiedInfo.ronosCode}</span>
                            </div>
                          ) : (
                            <form
                              onSubmit={handleVerifyRonosPin}
                              className="inline-flex items-center gap-1.5 bg-[#FFFDF9] border border-[#FFC72C] rounded-xl px-2.5 py-1"
                            >
                              <KeyRound className="w-3.5 h-3.5 text-[#DA291C] shrink-0" />
                              <input
                                type="password"
                                inputMode="numeric"
                                maxLength={4}
                                value={ronosPinInput}
                                onChange={(e) =>
                                  setRonosPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))
                                }
                                placeholder="PIN RONOS"
                                className="w-20 bg-transparent text-xs font-mono font-black tracking-widest text-[#0F172A] focus:outline-none"
                              />
                              <button
                                type="submit"
                                disabled={ronosVerifyBusy || ronosPinInput.length !== 4}
                                className="px-2 py-1 rounded-lg bg-[#0F172A] text-white text-[11px] font-black cursor-pointer disabled:opacity-40"
                              >
                                {ronosVerifyBusy ? '...' : t('training.ronos_ok_btn')}
                              </button>
                            </form>
                          )}

                          {canManageCatalog && (
                            <button
                              type="button"
                              onClick={() => {
                                setEmailInput(selectedEmployee.email || '');
                                setEmailFeedback(null);
                                setShowEmailModal(true);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-[#FFF5EB] border border-slate-200 text-xs font-bold text-[#0F172A] cursor-pointer"
                            >
                              <Mail className="w-3.5 h-3.5 text-[#DA291C]" />
                              <span>{t('training.send_to_phone_email_btn')}</span>
                            </button>
                          )}

                          {selectedStore && (
                            <Link
                              href={`/training/portal?store=${selectedStore.id}&emp=${selectedEmployee.id}${
                                activeTrainee?.access_code
                                  ? `&code=${encodeURIComponent(activeTrainee.access_code)}`
                                  : ''
                              }`}
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-[#FFF5EB] border border-slate-200 text-xs font-bold text-[#DA291C]"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">{t('training.btn_open_portal')}</span>
                            </Link>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {ronosErrorMsg && (
                    <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold">
                      {ronosErrorMsg}
                    </div>
                  )}

                  {/* Estaciones del Puesto: Solo visibles cuando estamos en capacitación o repaso (NO encima del certificado automático) */}
                  {!showAutoVeteranCertificate && roleRequiredStations.length > 0 && (
                    <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold uppercase text-slate-500 mr-1">
                        {t('training.stations_header_role')}
                      </span>
                      {roleRequiredStations.map((st) => {
                        const isSelected = selectedPositionKey === st.stationKey;
                        return (
                          <button
                            key={st.stationKey}
                            type="button"
                            onClick={() => handleSelectStationPill(st.stationKey)}
                            className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-[#0F172A] text-white border-[#0F172A]'
                                : 'bg-[#FFFAF5] hover:bg-[#FFF0E5] text-[#0F172A] border-[#F1E4D8]'
                            }`}
                          >
                            {lang === 'en' ? st.labelEn : st.labelEs}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}

              {/* VETERANO CERTIFICADO: SOLO DIPLOMA OFICIAL */}
              {selectedEmployee && showAutoVeteranCertificate && (
                <section className="py-1">
                  <OfficialCertificateView
                    employeeName={selectedEmployee.full_name}
                    storeName={selectedStore?.name || 'Tacos Gavilan'}
                    stationName={
                      (lang === 'en'
                        ? selectedEmployee.job_role_title_en
                        : selectedEmployee.job_role_title_es) || t('training.fallback_certified_cook')
                    }
                    jobRoleTitle={
                      lang === 'en'
                        ? selectedEmployee.job_role_title_en
                        : selectedEmployee.job_role_title_es
                    }
                    certifiedStations={selectedEmployee.required_stations}
                    folio={selectedEmployee.certificate_folio}
                    issuedDate={selectedEmployee.first_seen_date}
                    managerName={
                      selectedStore?.managers?.[0]?.fullName ||
                      selectedTrainerName ||
                      t('training.fallback_store_manager')
                    }
                    supervisorName={selectedStore?.supervisor_name}
                    tenureWeeks={selectedEmployee.tenure_weeks}
                    score={100}
                    lang={lang}
                    showRetrainingBtn={true}
                    onEnableRetraining={() => {
                      setAllowVeteranRetraining(true);
                      setActiveTab('day1');
                      setDay1SubStep('video');
                    }}
                  />
                </section>
              )}

              {/* NUEVO INGRESO (O VETERANO EN MODO REPASO): PROGRAMA DE 4 DÍAS LIMPIO */}
              {selectedEmployee && !showAutoVeteranCertificate && (
                <>
                  {/* Selectores Limpios de los 4 Días */}
                  <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 print:hidden">
                    {[
                      {
                        id: 'day1' as const,
                        num: '1',
                        title: t('training.day1_title_clean'),
                        desc: t('training.day1_desc_clean'),
                        done: activeTrainee?.day1_completed,
                      },
                      {
                        id: 'day2' as const,
                        num: '2',
                        title: t('training.day2_title_clean'),
                        desc: t('training.day2_desc_clean'),
                        done: activeTrainee?.day2_completed,
                      },
                      {
                        id: 'day3' as const,
                        num: '3',
                        title: t('training.day3_title_clean'),
                        desc: t('training.day3_desc_clean'),
                        done: activeTrainee?.day3_completed,
                      },
                      {
                        id: 'day4' as const,
                        num: '4',
                        title: t('training.day4_title_clean'),
                        desc: t('training.day4_desc_clean'),
                        done: activeTrainee?.day4_completed,
                      },
                    ].map((dayCard) => {
                      const isSelected = activeTab === dayCard.id;
                      return (
                        <button
                          key={dayCard.id}
                          type="button"
                          onClick={() => {
                            stopAllMedia();
                            setActiveTab(dayCard.id);
                          }}
                          className={`text-left p-3 sm:p-4 rounded-2xl border transition-all cursor-pointer flex items-center gap-3 ${
                            isSelected
                              ? 'bg-[#DA291C] text-white border-[#DA291C] shadow-sm'
                              : 'bg-white hover:bg-[#FFF5EB] text-[#0F172A] border-[#F1E4D8]'
                          }`}
                        >
                          <div
                            className={`w-9 h-9 rounded-xl flex items-center justify-center text-base font-black shrink-0 ${
                              isSelected
                                ? 'bg-[#FFC72C] text-[#0F172A]'
                                : dayCard.done
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-[#FFF5EB] text-[#DA291C]'
                            }`}
                          >
                            {dayCard.done ? <CheckCircle2 className="w-5 h-5" /> : dayCard.num}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs sm:text-sm font-black leading-tight">
                              {dayCard.title}
                            </div>
                            <div
                              className={`text-[11px] font-medium mt-0.5 hidden sm:block ${
                                isSelected ? 'text-white/85' : 'text-slate-500'
                              }`}
                            >
                              {dayCard.desc}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </section>
                </>
              )}
            </>
          )}

          {/* =====================================================================
              VISTA ADMIN DIRECTA: SELECCIÓN DE ESTACIÓN Y VIDEO SIN ELEGIR EMPLEADO
             ===================================================================== */}
          {!loadingData && isAdminFreeVideoReview && (
            <section className="bg-white rounded-3xl border border-[#F1E4D8] p-4 sm:p-5 shadow-xs space-y-3 print:hidden">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-1 rounded-full bg-[#FFF0E5] text-[#DA291C] text-[11px] font-black uppercase">
                    {t('training.admin_review_badge')}
                  </span>
                  <span className="text-xs sm:text-sm font-medium text-slate-600">
                    {t('training.admin_review_desc')}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-bold uppercase text-slate-500 mr-1">
                  {t('training.admin_review_station_label')}
                </span>
                {adminAllStations.map((st) => {
                  const isSelected = selectedPositionKey === st.stationKey;
                  return (
                    <button
                      key={st.stationKey}
                      type="button"
                      onClick={() => handleSelectStationPill(st.stationKey)}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[#0F172A] text-white border-[#0F172A]'
                          : 'bg-[#FFFAF5] hover:bg-[#FFF0E5] text-[#0F172A] border-[#F1E4D8]'
                      }`}
                    >
                      {t(st.labelKey)}
                    </button>
                  );
                })}
              </div>

              {stationReviewItems.length > 0 && (
                <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-bold uppercase text-slate-500 mr-1">
                    {t('training.admin_review_items_label')}
                  </span>
                  {stationReviewItems.map((item) => {
                    const isCurrent = currentVideo?.slug === item.slug;
                    return (
                      <button
                        key={item.slug}
                        type="button"
                        onClick={() => {
                          stopAllMedia();
                          setCurrentTime(0);
                          setSelectedVideoSlug(item.slug);
                          setDay1SubStep('video');
                        }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                          isCurrent
                            ? 'bg-[#DA291C] text-white border-[#DA291C]'
                            : 'bg-[#FFFAF5] hover:bg-[#FFF0E5] text-[#0F172A] border-[#F1E4D8]'
                        }`}
                      >
                        <Play
                          className={`w-3 h-3 shrink-0 ${
                            item.hasVideo
                              ? isCurrent
                                ? 'fill-current text-white'
                                : 'fill-current text-emerald-600'
                              : isCurrent
                              ? 'text-white/75'
                              : 'text-slate-400'
                          }`}
                        />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* ===========================================================
              DÍA 1 / MODO ADMIN: VIDEO LIMPIO + PASOS + MEDIDAS (+ QUIZ EN PERSONAL)
             =========================================================== */}
          {!loadingData && currentVideo && (isAdminFreeVideoReview || (isStaffActiveTraining && activeTab === 'day1')) && (
            <div className="space-y-4">
              {/* Barra única de sub-pasos */}
              <div className="bg-white rounded-2xl border border-[#F1E4D8] p-2.5 flex flex-wrap items-center justify-between gap-2 print:hidden">
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: 'video' as const, label: t('training.substep_video') },
                    {
                      id: 'portions' as const,
                      label: `${t('training.substep_portions')} (${stationRecipeProducts.length})`,
                    },
                    ...(isAdminFreeVideoReview
                      ? []
                      : [{ id: 'quiz' as const, label: t('training.substep_quiz') }]),
                  ].map((sub) => {
                            const active = day1SubStep === sub.id;
                            return (
                              <button
                                key={sub.id}
                                type="button"
                                onClick={() => {
                                  if (sub.id !== 'video') stopAllMedia();
                                  setDay1SubStep(sub.id);
                                }}
                                className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                                  active
                                    ? 'bg-[#0F172A] text-white'
                                    : 'bg-[#FFFAF5] hover:bg-[#FFF0E5] text-slate-700'
                                }`}
                              >
                                {sub.label}
                              </button>
                            );
                          })}
                        </div>

                        {canManageCatalog && (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={uploadingVideoSlug === currentVideo.slug}
                              onClick={() =>
                                triggerVideoUploadForProduct({
                                  slug: currentVideo.slug,
                                  name: lang === 'en' ? currentVideo.titleEn : currentVideo.titleEs,
                                  positionKey: currentVideo.positionKey,
                                  ingredients: currentVideo.recipeSpecs.map((r) => ({
                                    name: r.itemEs,
                                    quantity: Number(r.quantity) || 1,
                                    unit: r.unit,
                                  })),
                                })
                              }
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#FFFAF5] hover:bg-[#FFF0E5] text-[#0F172A] border border-slate-200 cursor-pointer"
                            >
                              <Upload className="w-3.5 h-3.5 text-[#DA291C]" />
                              <span>
                                {uploadingVideoSlug === currentVideo.slug
                                  ? t('training.uploading_video_status')
                                  : t('training.replace_video_btn')}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={openStepEditor}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#FFF8E7] hover:bg-[#FFC72C]/30 text-[#92400E] border border-[#FFC72C] cursor-pointer"
                            >
                              <Wand2 className="w-3.5 h-3.5 text-[#DA291C]" />
                              <span>{t('training.btn_edit_steps_ai')}</span>
                            </button>

                            {isAdmin && Boolean(currentVideo.videoUrl) && (
                              <button
                                type="button"
                                disabled={reprocessingVideoSlug === currentVideo.slug}
                                onClick={handleReprocessVideoWithAi}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#FFFAF5] hover:bg-[#FFF0E5] disabled:opacity-50 text-[#0F172A] border border-[#F1E4D8] cursor-pointer"
                              >
                                <Sparkles className="w-3.5 h-3.5 text-[#DA291C]" />
                                <span>
                                  {reprocessingVideoSlug === currentVideo.slug
                                    ? t('training.reprocessing_video_status')
                                    : t('training.reprocess_video_ai_btn')}
                                </span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {day1SubStep === 'video' && (
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
                          {/* Izquierda 7 Cols: Reproductor de Video 100% Limpio & Silenciado */}
                          <div className="md:col-span-7 bg-white rounded-3xl border border-[#F1E4D8] p-4 sm:p-5 shadow-xs space-y-3.5">
                            {(stationVideos.length > 1 || showAllVideosInSelector) && (
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {stationVideos.map((vid) => {
                                    const isCurrent = vid.slug === currentVideo.slug;
                                    return (
                                      <button
                                        key={vid.slug}
                                        type="button"
                                        onClick={() => {
                                          stopAllMedia();
                                          setSelectedVideoSlug(vid.slug);
                                          setCurrentTime(0);
                                        }}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border ${
                                          isCurrent
                                            ? 'bg-[#0F172A] text-white border-[#0F172A]'
                                            : 'bg-[#FFFAF5] hover:bg-[#FFF0E5] text-[#0F172A] border-[#F1E4D8]'
                                        }`}
                                      >
                                        <Play className="w-3 h-3 fill-current shrink-0" />
                                        <span>{lang === 'en' ? vid.titleEn : vid.titleEs}</span>
                                      </button>
                                    );
                                  })}
                                </div>

                                <button
                                  type="button"
                                  onClick={() => setShowAllVideosInSelector((prev) => !prev)}
                                  className="text-[11px] font-bold text-[#DA291C] hover:underline cursor-pointer"
                                >
                                  {showAllVideosInSelector
                                    ? t('training.show_station_videos_only')
                                    : t('training.show_all_9_videos')}
                                </button>
                              </div>
                            )}

                            {!showAllVideosInSelector && stationVideos.length <= 1 && (
                              <div className="flex items-center justify-between gap-2">
                                <h3 className="text-sm sm:text-base font-black text-[#0F172A] truncate">
                                  {lang === 'en' ? currentVideo.titleEn : currentVideo.titleEs}
                                </h3>
                                <button
                                  type="button"
                                  onClick={() => setShowAllVideosInSelector(true)}
                                  className="text-[11px] font-bold text-[#DA291C] hover:underline cursor-pointer shrink-0"
                                >
                                  {t('training.show_all_9_videos')}
                                </button>
                              </div>
                            )}

                            {/* Video sin barra de progreso + sin controles cuando autoPausedForVoice === true */}
                            <div
                              ref={videoContainerRef}
                              className="relative rounded-2xl overflow-hidden bg-black aspect-video border border-slate-900/10 select-none"
                            >
                              {currentVideo.videoUrl ? (
                                <video
                                  key={currentVideo.videoUrl}
                                  ref={videoRef}
                                  src={currentVideo.videoUrl}
                                  muted
                                  onLoadedMetadata={(e) => {
                                    e.currentTarget.muted = true;
                                    e.currentTarget.volume = 0;
                                  }}
                                  onTimeUpdate={handleVideoTimeUpdate}
                                  onPlay={(e) => {
                                    e.currentTarget.muted = true;
                                    e.currentTarget.volume = 0;
                                    setIsPlaying(true);
                                  }}
                                  onPause={() => setIsPlaying(false)}
                                  onEnded={() => {
                                    setIsPlaying(false);
                                    autoPausedForVoiceRef.current = false;
                                    setAutoPausedForVoice(false);
                                    lastSpokenStepIdRef.current = null;
                                    pausedBoundaryStepIdRef.current = null;
                                  }}
                                  onClick={togglePlayVideo}
                                  playsInline
                                  controls={false}
                                  disablePictureInPicture
                                  controlsList="nodownload nofullscreen noremoteplayback"
                                  className="w-full h-full object-contain bg-black cursor-pointer"
                                />
                              ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center text-white p-6 text-center space-y-3">
                                  <Video className="w-11 h-11 text-[#FFC72C]" />
                                  <div className="text-sm sm:text-base font-black">
                                    {t('training.no_video_yet_title')}
                                  </div>
                                  {canManageCatalog && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        triggerVideoUploadForProduct({
                                          slug: currentVideo.slug,
                                          name: currentVideo.titleEs,
                                          positionKey: currentVideo.positionKey,
                                          ingredients: [],
                                        })
                                      }
                                      className="px-4 py-2.5 rounded-xl bg-[#DA291C] text-white text-xs font-black cursor-pointer"
                                    >
                                      {t('training.upload_video_for_btn', {
                                        name: lang === 'en' ? currentVideo.titleEn : currentVideo.titleEs,
                                      })}
                                    </button>
                                  )}
                                </div>
                              )}

                              {/* Al pausar automáticamente por voz explicativa NO mostrar ningún control sobre el video */}
                              {!autoPausedForVoice && currentVideo.videoUrl && (
                                <div className="absolute bottom-3 right-3 flex items-center gap-2 z-10">
                                  <button
                                    type="button"
                                    onClick={togglePlayVideo}
                                    className="px-3.5 py-2 rounded-xl bg-black/75 hover:bg-black text-white text-xs font-black flex items-center gap-1.5 backdrop-blur-xs cursor-pointer"
                                  >
                                    {isPlaying ? (
                                      <>
                                        <Pause className="w-4 h-4 fill-current" />
                                        <span>{t('training.pause_btn')}</span>
                                      </>
                                    ) : (
                                      <>
                                        <Play className="w-4 h-4 fill-current" />
                                        <span>{t('training.play_btn')}</span>
                                      </>
                                    )}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={handleToggleFullscreen}
                                    className="p-2 rounded-xl bg-black/75 hover:bg-black text-white backdrop-blur-xs cursor-pointer"
                                    title={t('training.fullscreen_btn')}
                                  >
                                    <Maximize2 className="w-4 h-4" />
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* Única Barra Compacta de Acciones debajo del Video (sin controles duplicados) */}
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={togglePlayVideo}
                                  className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-black shadow-xs flex items-center gap-1.5 cursor-pointer transition-all ${
                                    isPlaying
                                      ? 'bg-amber-500 hover:bg-amber-600 text-white'
                                      : 'bg-[#DA291C] hover:bg-[#B91C1C] text-white'
                                  }`}
                                >
                                  {isPlaying ? (
                                    <>
                                      <Pause className="w-4 h-4 fill-current" />
                                      <span>{t('training.pause_btn')}</span>
                                    </>
                                  ) : (
                                    <>
                                      <Play className="w-4 h-4 fill-current" />
                                      <span>{t('training.play_btn')}</span>
                                    </>
                                  )}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    if (currentStep) jumpToStep(currentStep);
                                  }}
                                  className="px-3.5 py-2.5 rounded-xl text-xs font-bold bg-[#FFFAF5] hover:bg-[#FFF0E5] text-[#0F172A] border border-[#F1E4D8] flex items-center gap-1.5 cursor-pointer"
                                >
                                  <RotateCcw className="w-3.5 h-3.5 text-[#DA291C]" />
                                  <span>{t('training.repeat_step_btn')}</span>
                                </button>

                                {canManageCatalog && (
                                  <button
                                    type="button"
                                    onClick={handlePauseToAddStepHere}
                                    className="px-3 py-2.5 rounded-xl bg-[#FFF8E7] hover:bg-[#FFC72C]/30 text-[#92400E] border border-[#FFC72C] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                                  >
                                    <PlusCircle className="w-3.5 h-3.5 text-[#DA291C]" />
                                    <span>{t('training.add_step_here_btn')}</span>
                                  </button>
                                )}
                              </div>

                              <button
                                type="button"
                                onClick={() => {
                                  const next = !voiceEnabled;
                                  setVoiceEnabled(next);
                                  if (!next && audioRef.current) {
                                    audioRef.current.pause();
                                    setIsVoiceSpeaking(false);
                                  }
                                }}
                                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border cursor-pointer ${
                                  voiceEnabled
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                    : 'bg-slate-100 text-slate-600 border-slate-200'
                                }`}
                              >
                                {voiceEnabled ? (
                                  <Volume2 className="w-4 h-4 text-emerald-600" />
                                ) : (
                                  <VolumeX className="w-4 h-4 text-slate-500" />
                                )}
                                <span>
                                  {voiceEnabled
                                    ? t('training.voice_tutor_on')
                                    : t('training.voice_tutor_off')}
                                </span>
                              </button>
                            </div>

                            {/* Formulario Inline al Pausar Video para Agregar Paso -> Voz IA */}
                            {showAddStepAtPauseBox && (
                              <form
                                onSubmit={handleSavePausedStepWithAiVoice}
                                className="p-4 rounded-2xl bg-[#FFFDF9] border border-[#FFC72C] space-y-3"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-black text-[#DA291C]">
                                    {t('training.new_step_modal_title')} ({formatSeconds(pausedTimestampSec)})
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setShowAddStepAtPauseBox(false)}
                                    className="text-xs font-black text-slate-500 cursor-pointer"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                  <input
                                    type="text"
                                    value={newStepTitle}
                                    onChange={(e) => setNewStepTitle(e.target.value)}
                                    placeholder={t('training.new_step_title_ph')}
                                    className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-semibold"
                                  />
                                  <input
                                    type="text"
                                    value={newStepPortion}
                                    onChange={(e) => setNewStepPortion(e.target.value)}
                                    placeholder={t('training.new_step_portion_ph')}
                                    className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-semibold"
                                  />
                                </div>

                                <textarea
                                  rows={2}
                                  required
                                  value={newStepNarration}
                                  onChange={(e) => setNewStepNarration(e.target.value)}
                                  placeholder={t('training.new_step_narration_ph')}
                                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold"
                                />

                                {pausedStepError && (
                                  <div className="text-xs font-bold text-red-600">{pausedStepError}</div>
                                )}

                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setShowAddStepAtPauseBox(false)}
                                    className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-600 cursor-pointer"
                                  >
                                    {t('common.cancel')}
                                  </button>
                                  <button
                                    type="submit"
                                    disabled={savingPausedStepBusy || !newStepNarration.trim()}
                                    className="px-4 py-2 rounded-xl bg-[#DA291C] hover:bg-[#B91C1C] text-white text-xs font-black cursor-pointer disabled:opacity-40"
                                  >
                                    {savingPausedStepBusy
                                      ? t('training.generating_ai_voice')
                                      : t('training.save_step_ai_voice_btn')}
                                  </button>
                                </div>
                              </form>
                            )}
                          </div>

                          {/* Derecha 5 Cols: Tarjeta Limpia del Paso Actual */}
                          <div className="md:col-span-5 bg-white rounded-3xl border border-[#F1E4D8] p-5 shadow-xs space-y-4">
                            <div className="space-y-2">
                              <div className="text-xs font-bold uppercase text-slate-500">
                                {t('training.steps_header')}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {currentVideo.steps.map((st, idx) => {
                                  const isActive = idx === currentStepIndex;
                                  return (
                                    <button
                                      key={st.id}
                                      type="button"
                                      onClick={() => jumpToStep(st)}
                                      className={`w-10 h-10 rounded-xl text-sm font-black transition-all cursor-pointer border ${
                                        isActive
                                          ? 'bg-[#0F172A] text-white border-[#0F172A] shadow-xs'
                                          : 'bg-[#FFFAF5] hover:bg-[#FFF0E5] text-[#0F172A] border-[#F1E4D8]'
                                      }`}
                                    >
                                      {st.stepNumber}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {currentStep && (
                              <div className="rounded-2xl bg-[#FFFAF5] border border-[#F1E4D8] p-4 space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="px-2.5 py-1 rounded-full bg-[#FFF0E5] text-[#DA291C] text-xs font-black">
                                    {t('training.player_step_of', {
                                      current: currentStep.stepNumber,
                                      total: currentVideo.steps.length,
                                    })}
                                  </span>
                                  {isVoiceSpeaking && (
                                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                                      <Volume2 className="w-3.5 h-3.5 animate-pulse" />
                                      {t('training.tutor_speaking_badge')}
                                    </span>
                                  )}
                                </div>

                                <h3 className="text-base sm:text-lg font-black text-[#0F172A] leading-snug">
                                  {lang === 'en' ? currentStep.titleEn : currentStep.titleEs}
                                </h3>

                                <p className="text-sm font-semibold text-slate-800 leading-relaxed bg-white p-3.5 rounded-xl border border-slate-200">
                                  “{lang === 'en' ? currentStep.narrationEn : currentStep.narrationEs}”
                                </p>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {currentStep.keyPortionEs && (
                                    <div className="p-2.5 rounded-xl bg-[#FFF8E7] border border-[#FFC72C] flex items-center gap-2">
                                      <Scale className="w-4 h-4 text-[#DA291C] shrink-0" />
                                      <span className="text-xs font-bold text-[#0F172A]">
                                        {lang === 'en'
                                          ? currentStep.keyPortionEn
                                          : currentStep.keyPortionEs}
                                      </span>
                                    </div>
                                  )}
                                  {currentStep.utensilEs && (
                                    <div className="p-2.5 rounded-xl bg-white border border-[#F1E4D8] flex items-center gap-2">
                                      <Thermometer className="w-4 h-4 text-[#DA291C] shrink-0" />
                                      <span className="text-xs font-bold text-[#0F172A]">
                                        {lang === 'en' ? currentStep.utensilEn : currentStep.utensilEs}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            <div className="grid grid-cols-2 gap-2.5">
                              <button
                                type="button"
                                disabled={currentStepIndex <= 0}
                                onClick={() => {
                                  const prev = currentVideo.steps[currentStepIndex - 1];
                                  if (prev) jumpToStep(prev);
                                }}
                                className="py-2.5 px-4 rounded-xl border border-slate-200 bg-[#FFFAF5] hover:bg-slate-100 disabled:opacity-40 text-xs sm:text-sm font-bold text-[#0F172A] flex items-center justify-center gap-1 cursor-pointer"
                              >
                                <ChevronLeft className="w-4 h-4" />
                                <span>{t('training.prev_step_btn')}</span>
                              </button>

                              <button
                                type="button"
                                disabled={currentStepIndex >= currentVideo.steps.length - 1}
                                onClick={() => {
                                  const next = currentVideo.steps[currentStepIndex + 1];
                                  if (next) jumpToStep(next);
                                }}
                                className="py-2.5 px-4 rounded-xl bg-[#0F172A] hover:bg-slate-800 disabled:opacity-40 text-xs sm:text-sm font-bold text-white flex items-center justify-center gap-1 cursor-pointer"
                              >
                                <span>{t('training.next_step_btn')}</span>
                                <ChevronRight className="w-4 h-4" />
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                stopAllMedia();
                                setDay1SubStep('portions');
                              }}
                              className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-black shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                            >
                              <span>{t('training.next_go_to_portions')}</span>
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}

                      {day1SubStep === 'portions' && (
                        <div className="space-y-5">
                          <div className="bg-white rounded-3xl border border-[#F1E4D8] p-5 sm:p-6 space-y-5 shadow-xs">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <h3 className="text-lg sm:text-xl font-black text-[#0F172A]">
                                {t('training.recipe_specs_title')} —{' '}
                                {lang === 'en' ? currentVideo.titleEn : currentVideo.titleEs}
                              </h3>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setDay1SubStep('video')}
                                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs sm:text-sm font-bold text-slate-700 cursor-pointer"
                                >
                                  ← {t('training.back_to_video')}
                                </button>
                                {!isAdminFreeVideoReview && (
                                  <button
                                    type="button"
                                    onClick={() => setDay1SubStep('quiz')}
                                    className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs sm:text-sm font-black cursor-pointer"
                                  >
                                    {t('training.next_go_to_quiz')} →
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                              {currentVideo.recipeSpecs.map((spec, idx) => (
                                <div
                                  key={idx}
                                  className="rounded-2xl bg-[#FFFAF5] border border-[#F1E4D8] p-4 flex flex-col justify-between gap-2.5"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="text-sm sm:text-base font-black text-[#0F172A]">
                                      {lang === 'en' ? spec.itemEn : spec.itemEs}
                                    </div>
                                    <span className="px-3 py-1 rounded-xl bg-[#DA291C] text-white text-xs sm:text-sm font-black shrink-0">
                                      {spec.quantity} {spec.unit}
                                    </span>
                                  </div>
                                  <div className="text-xs font-semibold text-slate-600 bg-white px-3 py-1.5 rounded-xl border border-slate-200">
                                    {lang === 'en' ? spec.utensilEn : spec.utensilEs}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {stationRecipeProducts.length > 0 && (
                            <div className="bg-white rounded-3xl border border-[#F1E4D8] p-5 space-y-4 shadow-xs">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <span className="text-[11px] font-black uppercase text-[#DA291C]">
                                    {lang === 'en' ? currentPosition?.labelEn : currentPosition?.labelEs}
                                  </span>
                                  <h3 className="text-lg font-black text-[#0F172A]">
                                    {t('training.station_categories_title', {
                                      count: stationRecipeProducts.length,
                                    })}
                                  </h3>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="relative">
                                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                    <input
                                      type="text"
                                      value={stationSearch}
                                      onChange={(e) => setStationSearch(e.target.value)}
                                      placeholder={t('training.filter_dish_ph')}
                                      className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 bg-[#FFFAF5] text-xs font-semibold"
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setShowPrintableChecklistModal(true)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#FFFAF5] border border-[#FFC72C] text-xs font-bold text-[#0F172A] cursor-pointer"
                                  >
                                    <Printer className="w-3.5 h-3.5 text-[#DA291C]" />
                                    <span>{t('training.print_list_btn')}</span>
                                  </button>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[520px] overflow-y-auto pr-1">
                                {stationRecipeProducts
                                  .filter(
                                    (prod) =>
                                      !stationSearch.trim() ||
                                      prod.name.toLowerCase().includes(stationSearch.trim().toLowerCase())
                                  )
                                  .map((prod) => {
                                    const isUploading = uploadingVideoSlug === prod.slug;
                                    return (
                                      <div
                                        key={prod.guid}
                                        className="rounded-2xl bg-[#FFFAF5] border border-[#F1E4D8] p-3.5 flex flex-col justify-between gap-2.5"
                                      >
                                        <div>
                                          <div className="flex items-start justify-between gap-2">
                                            <div className="text-sm font-black text-[#0F172A]">
                                              {prod.name}
                                            </div>
                                            {prod.hasVideo ? (
                                              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold shrink-0">
                                                {t('training.video_badge')}
                                              </span>
                                            ) : (
                                              <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold shrink-0">
                                                {t('training.recipe_badge')}
                                              </span>
                                            )}
                                          </div>
                                          <div className="flex flex-wrap gap-1 mt-2">
                                            {prod.ingredients.map((ing, i) => (
                                              <span
                                                key={i}
                                                className="px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-800"
                                              >
                                                <strong className="text-[#DA291C]">
                                                  {ing.quantity} {ing.unit}
                                                </strong>{' '}
                                                {ing.name}
                                              </span>
                                            ))}
                                          </div>
                                          {prod.variantsIncluded && prod.variantsIncluded.length > 1 && (
                                            <div className="mt-2 p-2 rounded-xl bg-[#FFF8E7] border border-[#FFC72C] text-[10px] font-semibold text-slate-700 leading-snug">
                                              <span className="text-[#DA291C] font-black">
                                                {t('training.covers_variants_label', {
                                                  count: prod.variantCount || prod.variantsIncluded.length,
                                                })}
                                              </span>{' '}
                                              {prod.variantsIncluded.join(', ')}
                                            </div>
                                          )}
                                        </div>

                                        <div className="pt-2 border-t border-[#F1E4D8] flex items-center gap-1.5">
                                          {prod.hasVideo && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                stopAllMedia();
                                                setSelectedVideoSlug(prod.slug);
                                                setDay1SubStep('video');
                                                setCurrentTime(0);
                                              }}
                                              className="flex-1 py-1.5 px-2.5 rounded-xl bg-[#DA291C] text-white text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                                            >
                                              <Play className="w-3 h-3 fill-current" />
                                              <span>{t('training.product_watch_video')}</span>
                                            </button>
                                          )}
                                          {canManageCatalog && (
                                            <button
                                              type="button"
                                              disabled={isUploading}
                                              onClick={() =>
                                                triggerVideoUploadForProduct({
                                                  slug: prod.slug,
                                                  name: prod.name,
                                                  positionKey: prod.positionKey,
                                                  ingredients: prod.ingredients,
                                                })
                                              }
                                              className="py-1.5 px-2.5 rounded-xl bg-white border border-[#FFC72C] text-[#0F172A] text-xs font-bold flex items-center gap-1 cursor-pointer"
                                            >
                                              <Upload className="w-3 h-3 text-[#DA291C]" />
                                              <span>
                                                {isUploading
                                                  ? '...'
                                                  : prod.hasVideo
                                                  ? t('training.replace_video_btn')
                                                  : t('training.upload_video_btn')}
                                              </span>
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {day1SubStep === 'quiz' && !isAdminFreeVideoReview && (
                        <div className="bg-white rounded-3xl border border-[#F1E4D8] p-5 sm:p-6 space-y-5 shadow-xs">
                          <h3 className="text-lg sm:text-xl font-black text-[#0F172A]">
                            {t('training.quiz_day1_title')}
                          </h3>
                          <div className="space-y-4">
                            {activeDay1Quiz.map((q, qIdx) => (
                              <div
                                key={q.id}
                                className="p-4 sm:p-5 rounded-2xl bg-[#FFFAF5] border border-[#F1E4D8] space-y-3"
                              >
                                <div className="text-sm sm:text-base font-black text-[#0F172A]">
                                  {qIdx + 1}. {lang === 'en' ? q.questionEn : q.questionEs}
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                  {(lang === 'en' ? q.optionsEn : q.optionsEs).map((opt, oIdx) => {
                                    const isSelected = quizAnswers[q.id] === oIdx;
                                    return (
                                      <button
                                        key={oIdx}
                                        type="button"
                                        onClick={() =>
                                          setQuizAnswers((prev) => ({ ...prev, [q.id]: oIdx }))
                                        }
                                        className={`text-left p-3.5 rounded-xl border text-xs sm:text-sm font-bold cursor-pointer ${
                                          isSelected
                                            ? 'bg-[#0F172A] text-white border-[#0F172A]'
                                            : 'bg-white text-slate-800 border-slate-200 hover:border-[#DA291C]'
                                        }`}
                                      >
                                        {opt}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="flex flex-wrap items-center gap-3">
                            <button
                              type="button"
                              onClick={handleGradeDay1Quiz}
                              className="px-7 py-3.5 rounded-2xl bg-[#DA291C] hover:bg-[#B91C1C] text-white text-sm sm:text-base font-black cursor-pointer"
                            >
                              {t('training.quiz_submit_btn')}
                            </button>
                          </div>

                          {quizSubmittedResult && (
                            <div
                              className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-3 ${
                                quizSubmittedResult.passed
                                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                  : 'bg-red-50 border-red-200 text-red-800'
                              }`}
                            >
                              <div className="text-sm sm:text-base font-bold">
                                {quizSubmittedResult.passed
                                  ? t('training.quiz_passed_msg', { score: quizSubmittedResult.score })
                                  : t('training.quiz_failed_msg', { score: quizSubmittedResult.score })}
                              </div>
                              {quizSubmittedResult.passed ? (
                                <button
                                  type="button"
                                  onClick={() => setActiveTab('day2')}
                                  className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs sm:text-sm font-black cursor-pointer"
                                >
                                  {t('training.quiz_continue_day2_btn')}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setQuizAnswers({});
                                    setQuizSubmittedResult(null);
                                  }}
                                  className="px-4 py-2 rounded-xl bg-white border border-red-300 text-red-700 text-xs font-bold cursor-pointer"
                                >
                                  {t('training.quiz_retry_btn')}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

          {/* ===========================================================
              DÍAS 2, 3 Y 4: SOLO CUANDO HAY COLABORADOR ACTIVO SELECCIONADO
             =========================================================== */}
          {!loadingData && isStaffActiveTraining && selectedEmployee && (
            <>
                  {/* ===========================================================
                      DÍA 2: PRÁCTICA SUPERVISADA (CON VALIDACIÓN, RÚBRICA Y NOTAS)
                     =========================================================== */}
                  {activeTab === 'day2' && currentPosition && (
                    <div className="max-w-4xl mx-auto bg-white rounded-3xl border border-[#F1E4D8] p-5 sm:p-6 space-y-5 shadow-xs">
                      <div>
                        <h3 className="text-lg sm:text-xl font-black text-[#0F172A]">
                          {t('training.day2_title')}
                        </h3>
                        <p className="text-xs sm:text-sm font-medium text-slate-600 mt-1">
                          {t('training.day2_subtitle')}
                        </p>
                      </div>

                      <div className="rounded-2xl bg-[#FFFAF5] border border-[#F1E4D8] p-4 flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <div className="text-xs font-bold uppercase text-slate-500">
                            {t('training.day2_reps_title')}
                          </div>
                          <div className="text-3xl font-black text-[#DA291C]">
                            {day2Reps} / {currentPosition.day2TargetReps}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setDay2Reps((r) => Math.max(0, r - 1))}
                            className="p-3 rounded-xl bg-white border border-slate-300 cursor-pointer"
                          >
                            <Minus className="w-5 h-5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDay2Reps((r) => r + 1)}
                            className="px-5 py-3 rounded-xl bg-[#DA291C] text-white text-sm sm:text-base font-black flex items-center gap-2 cursor-pointer"
                          >
                            <Plus className="w-5 h-5" />
                            <span>{t('training.add_one_dish_btn')}</span>
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-bold uppercase text-slate-500">
                          {t('training.day2_steps_check_label')}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {(currentVideo?.steps || []).map((st) => {
                            const checked = !!day2Rubric[st.id];
                            return (
                              <button
                                key={st.id}
                                type="button"
                                onClick={() =>
                                  setDay2Rubric((prev) => ({ ...prev, [st.id]: !prev[st.id] }))
                                }
                                className={`text-left p-3.5 rounded-xl border flex items-center justify-between gap-2 cursor-pointer ${
                                  checked
                                    ? 'bg-emerald-50 border-emerald-400 text-emerald-950'
                                    : 'bg-[#FFFAF5] border-[#F1E4D8] text-[#0F172A]'
                                }`}
                              >
                                <span className="text-xs sm:text-sm font-bold">
                                  {t('training.day2_step_prefix', {
                                    num: st.stepNumber,
                                    title: lang === 'en' ? st.titleEn : st.titleEs,
                                  })}
                                </span>
                                <span
                                  className={`w-5 h-5 rounded-md border flex items-center justify-center text-xs font-black shrink-0 ${
                                    checked
                                      ? 'bg-emerald-600 border-emerald-600 text-white'
                                      : 'bg-white border-slate-300 text-transparent'
                                  }`}
                                >
                                  ✓
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase text-slate-500">
                          {t('training.day2_notes_label')}
                        </label>
                        <textarea
                          rows={2}
                          value={day2Notes}
                          onChange={(e) => setDay2Notes(e.target.value)}
                          placeholder={t('training.day2_notes_ph')}
                          className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-[#FFFAF5] text-sm font-medium"
                        />
                      </div>

                      {day2WarningMsg && (
                        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold">
                          {day2WarningMsg}
                        </div>
                      )}

                      {day2SavedBanner && (
                        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-sm font-bold flex flex-wrap items-center justify-between gap-2">
                          <span>{t('training.day2_saved_ok')}</span>
                          <button
                            type="button"
                            onClick={() => setActiveTab('day3')}
                            className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-black cursor-pointer"
                          >
                            {t('training.day3_title_clean')} →
                          </button>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={handleCompleteDay2}
                          className="flex-1 py-3.5 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm sm:text-base font-black cursor-pointer"
                        >
                          {t('training.day2_complete_btn')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ===========================================================
                      DÍA 3: CRONÓMETRO COMPLETO CON RESET Y ACTIVIDADES DE TURNO
                     =========================================================== */}
                  {activeTab === 'day3' && currentPosition && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                      <div className="lg:col-span-5 bg-white rounded-3xl border border-[#F1E4D8] p-5 sm:p-6 space-y-4 text-center shadow-xs">
                        <h3 className="text-lg sm:text-xl font-black text-[#0F172A] flex items-center justify-center gap-2">
                          <Timer className="w-5 h-5 text-[#DA291C]" />
                          <span>{t('training.day3_stopwatch_title')}</span>
                        </h3>

                        <div className="rounded-2xl bg-[#FFFAF5] border border-[#F1E4D8] p-5 space-y-4">
                          <div className="text-5xl font-black font-mono text-[#0F172A]">
                            {formatSeconds(Math.floor(stopwatchElapsedDeci / 10))}
                            <span className="text-2xl text-[#DA291C]">.{stopwatchElapsedDeci % 10}s</span>
                          </div>

                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="p-2 rounded-xl bg-white border border-slate-200">
                              <div className="text-[10px] font-bold text-slate-500">
                                {t('training.day3_target_time')}
                              </div>
                              <div className="font-black text-[#0F172A]">
                                {currentVideo?.targetPrepSeconds || 45}s
                              </div>
                            </div>
                            <div className="p-2 rounded-xl bg-white border border-slate-200">
                              <div className="text-[10px] font-bold text-slate-500">
                                {t('training.day3_best_time')}
                              </div>
                              <div className="font-black text-emerald-700">
                                {day3BestTimeSec !== null
                                  ? `${day3BestTimeSec}s`
                                  : t('training.day3_no_best_time')}
                              </div>
                            </div>
                            <div className="p-2 rounded-xl bg-white border border-slate-200">
                              <div className="text-[10px] font-bold text-slate-500">
                                {t('training.day3_attempts_count', { count: day3SoloReps })}
                              </div>
                              <div className="font-black text-[#DA291C]">
                                {day3SoloReps}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {!stopwatchRunning ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setDay3WarningMsg(null);
                                  setStopwatchRunning(true);
                                }}
                                className="flex-1 py-3 rounded-xl bg-[#DA291C] text-white text-sm font-black cursor-pointer"
                              >
                                ▶ {t('training.day3_start_timer')}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={handleStopAndRecordStopwatch}
                                className="flex-1 py-3 rounded-xl bg-emerald-600 text-white text-sm font-black cursor-pointer"
                              >
                                ⏹ {t('training.day3_stop_record')}
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                setStopwatchRunning(false);
                                setStopwatchElapsedDeci(0);
                              }}
                              className="px-4 py-3 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-bold cursor-pointer"
                            >
                              {t('training.day3_reset_timer')}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="lg:col-span-7 bg-white rounded-3xl border border-[#F1E4D8] p-5 sm:p-6 space-y-4 shadow-xs">
                        <div className="text-xs font-bold uppercase text-slate-500">
                          {t('training.day3_activities_title')}
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          {(
                            [
                              { key: 'Apertura' as const, label: t('training.shift_opening') },
                              { key: 'Regular' as const, label: t('training.shift_regular') },
                              { key: 'Cierre' as const, label: t('training.shift_closing') },
                            ] as const
                          ).map((sTab) => (
                            <button
                              key={sTab.key}
                              type="button"
                              onClick={() => setDay3ShiftTab(sTab.key)}
                              className={`py-2 px-3 rounded-xl text-xs font-bold cursor-pointer border ${
                                day3ShiftTab === sTab.key
                                  ? 'bg-[#0F172A] text-white border-[#0F172A]'
                                  : 'bg-[#FFFAF5] text-slate-700 border-[#F1E4D8]'
                              }`}
                            >
                              {sTab.label} ({groupedActivities[sTab.key].length})
                            </button>
                          ))}
                        </div>

                        <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                          {groupedActivities[day3ShiftTab].map((act) => {
                            const checked = !!day3ActivitiesChecked[act.id];
                            return (
                              <button
                                key={act.id}
                                type="button"
                                onClick={() =>
                                  setDay3ActivitiesChecked((prev) => ({
                                    ...prev,
                                    [act.id]: !prev[act.id],
                                  }))
                                }
                                className={`w-full text-left flex items-center justify-between gap-2 p-3 rounded-xl border cursor-pointer ${
                                  checked
                                    ? 'bg-emerald-50 border-emerald-400 text-emerald-950'
                                    : 'bg-[#FFFAF5] border-[#F1E4D8] text-[#0F172A]'
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <span
                                    className={`w-5 h-5 rounded-md border flex items-center justify-center text-xs font-black shrink-0 ${
                                      checked
                                        ? 'bg-emerald-600 border-emerald-600 text-white'
                                        : 'bg-white border-slate-300 text-transparent'
                                    }`}
                                  >
                                    ✓
                                  </span>
                                  <span className="text-xs sm:text-sm font-bold">{act.name}</span>
                                </div>
                                <span className="text-xs font-semibold text-slate-500 shrink-0">
                                  {act.time}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {day3WarningMsg && (
                          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold">
                            {day3WarningMsg}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={handleCompleteDay3}
                          className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm sm:text-base font-black cursor-pointer"
                        >
                          {t('training.day3_complete_btn')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ===========================================================
                      DÍA 4: EXAMEN TEÓRICO REAL + AUDITORÍA PRÁCTICA REAL + CERTIFICADO
                     =========================================================== */}
                  {activeTab === 'day4' && currentPosition && (
                    <div className="space-y-6">
                      <div className="max-w-4xl mx-auto bg-white rounded-3xl border border-[#F1E4D8] p-5 sm:p-6 space-y-5 shadow-xs print:hidden">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="text-lg sm:text-xl font-black text-[#0F172A]">
                              {t('training.day4_title_role', {
                                role:
                                  (lang === 'en'
                                    ? selectedEmployee.job_role_badge_en
                                    : selectedEmployee.job_role_badge_es) ||
                                  currentPosition.labelEs,
                              })}
                            </h3>
                            <p className="text-xs sm:text-sm font-medium text-slate-600 mt-1">
                              {t('training.day4_subtitle_role')}
                            </p>
                          </div>

                          <div
                            className={`px-3.5 py-2 rounded-xl text-xs font-black border ${
                              day4LiveScores.combinedScore >= 90
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                : 'bg-amber-50 border-amber-200 text-amber-900'
                            }`}
                          >
                            {t('training.day4_live_score_label', {
                              score: day4LiveScores.combinedScore,
                              exam: day4LiveScores.examScore,
                              practical: day4LiveScores.practicalScore,
                            })}
                          </div>
                        </div>

                        {/* 1. Verificación Teórica */}
                        <div className="space-y-3">
                          <div className="text-xs font-black uppercase text-[#DA291C]">
                            {t('training.day4_theory_section')}
                          </div>
                          {activeDay1Quiz.map((q, qIdx) => (
                            <div
                              key={q.id}
                              className="p-4 rounded-2xl bg-[#FFFAF5] border border-[#F1E4D8] space-y-2.5"
                            >
                              <div className="text-sm font-bold text-[#0F172A]">
                                {qIdx + 1}. {lang === 'en' ? q.questionEn : q.questionEs}
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {(lang === 'en' ? q.optionsEn : q.optionsEs).map((opt, oIdx) => {
                                  const isSelected = day4ExamAnswers[q.id] === oIdx;
                                  return (
                                    <button
                                      key={oIdx}
                                      type="button"
                                      onClick={() =>
                                        setDay4ExamAnswers((prev) => ({ ...prev, [q.id]: oIdx }))
                                      }
                                      className={`text-left p-3 rounded-xl border text-xs sm:text-sm font-bold cursor-pointer ${
                                        isSelected
                                          ? 'bg-[#0F172A] text-white border-[#0F172A]'
                                          : 'bg-white text-slate-800 border-slate-200 hover:border-[#DA291C]'
                                      }`}
                                    >
                                      {opt}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* 2. Auditoría Práctica en Línea (5 Puntos Reales) */}
                        <div className="space-y-2.5">
                          <div className="text-xs font-black uppercase text-[#DA291C]">
                            {t('training.day4_practical_section')}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {(
                              [
                                { key: 'hygiene', label: t('training.day4_audit_item_1') },
                                { key: 'temp', label: t('training.day4_audit_item_2') },
                                { key: 'portion', label: t('training.day4_audit_item_3') },
                                { key: 'presentation', label: t('training.day4_audit_item_4') },
                                { key: 'speed', label: t('training.day4_audit_item_5') },
                              ] as const
                            ).map((item) => {
                              const checked = !!day4AuditChecks[item.key];
                              return (
                                <button
                                  key={item.key}
                                  type="button"
                                  onClick={() =>
                                    setDay4AuditChecks((prev) => ({
                                      ...prev,
                                      [item.key]: !prev[item.key],
                                    }))
                                  }
                                  className={`text-left p-3 rounded-xl border flex items-center justify-between gap-2 cursor-pointer ${
                                    checked
                                      ? 'bg-emerald-50 border-emerald-400 text-emerald-950'
                                      : 'bg-[#FFFAF5] border-[#F1E4D8] text-[#0F172A]'
                                  }`}
                                >
                                  <span className="text-xs sm:text-sm font-bold">{item.label}</span>
                                  <span
                                    className={`w-5 h-5 rounded-md border flex items-center justify-center text-xs font-black shrink-0 ${
                                      checked
                                        ? 'bg-emerald-600 border-emerald-600 text-white'
                                        : 'bg-white border-slate-300 text-transparent'
                                    }`}
                                  >
                                    ✓
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {day4WarningMsg && (
                          <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs sm:text-sm font-bold">
                            {day4WarningMsg}
                          </div>
                        )}

                        {isDay4Certified && (
                          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs sm:text-sm font-bold">
                            {t('training.day4_completed_banner', {
                              score:
                                certificationResult?.combinedScore ??
                                activeTrainee?.day4_final_score ??
                                100,
                              folio:
                                certificationResult?.folio ||
                                activeTrainee?.certificate_folio ||
                                selectedEmployee.certificate_folio,
                            })}
                          </div>
                        )}

                        <button
                          type="button"
                          disabled={day4SavingBusy}
                          onClick={handleIssueDay4Certification}
                          className="w-full py-4 rounded-2xl bg-[#DA291C] hover:bg-[#B91C1C] disabled:opacity-50 text-white text-sm sm:text-base font-black cursor-pointer flex items-center justify-center gap-2"
                        >
                          <Award className="w-5 h-5 text-[#FFC72C]" />
                          <span>{t('training.day4_certify_btn')}</span>
                        </button>
                      </div>

                      {/* Solo mostrar el Diploma Oficial cuando haya sido realmente aprobado */}
                      {isDay4Certified && (
                        <OfficialCertificateView
                          employeeName={
                            selectedEmployee.full_name ||
                            activeTrainee?.employee_name ||
                            t('training.fallback_certified_worker')
                          }
                          storeName={selectedStore?.name || 'Tacos Gavilan'}
                          stationName={
                            (lang === 'en'
                              ? selectedEmployee.job_role_title_en
                              : selectedEmployee.job_role_title_es) ||
                            t('training.fallback_certified_cook')
                          }
                          jobRoleTitle={
                            lang === 'en'
                              ? selectedEmployee.job_role_title_en
                              : selectedEmployee.job_role_title_es
                          }
                          certifiedStations={roleRequiredStations}
                          folio={
                            certificationResult?.folio ||
                            activeTrainee?.certificate_folio ||
                            selectedEmployee.certificate_folio
                          }
                          issuedDate={activeTrainee?.day4_completed_at || undefined}
                          managerName={
                            selectedStore?.managers?.[0]?.fullName ||
                            selectedTrainerName ||
                            t('training.fallback_store_manager')
                          }
                          supervisorName={selectedStore?.supervisor_name}
                          score={
                            certificationResult?.combinedScore ??
                            activeTrainee?.day4_final_score ??
                            100
                          }
                          lang={lang}
                        />
                      )}
                    </div>
                  )}
            </>
          )}

          {/* =====================================================================
              VISTA 2: CATÁLOGO DE CATEGORÍAS CON RECETA Y VIDEO (BASE CARNE ASADA)
             ===================================================================== */}
          {!loadingData && mainView === 'catalog' && canManageCatalog && (
            <section className="bg-white rounded-3xl border border-[#F1E4D8] p-5 sm:p-7 shadow-xs space-y-5 print:hidden">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="px-3 py-1 rounded-full bg-[#FFF0E5] text-[#DA291C] text-xs font-black uppercase">
                    {t('training.catalog_badge')}
                  </span>
                  <h2 className="text-xl sm:text-2xl font-black text-[#0F172A] mt-1">
                    {t('training.catalog_title', { count: recipeProducts.length })}
                  </h2>
                  <p className="text-xs sm:text-sm font-medium text-slate-600">
                    {t('training.catalog_subtitle')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMainView('staff')}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs sm:text-sm font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  ← {t('training.tab_staff_training')}
                </button>
              </div>

              {/* Buscador y Filtro por Categoría */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-7 relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    placeholder={t('training.catalog_search_ph')}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-[#FFFAF5] text-sm font-semibold"
                  />
                </div>
                <div className="sm:col-span-5">
                  <select
                    value={catalogCategory}
                    onChange={(e) => setCatalogCategory(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-[#FFFAF5] text-sm font-bold cursor-pointer"
                  >
                    <option value="ALL">
                      {t('training.catalog_all_categories', { count: recipeProducts.length })}
                    </option>
                    {catalogCategories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Tarjetas de Categorías Maestras Base Asada */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredRecipeProducts.map((prod) => {
                  const isUploading = uploadingVideoSlug === prod.slug;
                  const isDeleting = deletingVideoSlug === prod.slug;
                  return (
                    <div
                      key={prod.guid}
                      className="rounded-2xl bg-[#FFFAF5] border border-[#F1E4D8] p-4 flex flex-col justify-between gap-3.5"
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-sm sm:text-base font-black text-[#0F172A] leading-snug">
                              {prod.name}
                            </div>
                            <div className="text-xs font-bold text-[#DA291C]">
                              {prod.category} • {prod.positionKey}
                            </div>
                          </div>
                          {prod.hasVideo ? (
                            <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold shrink-0">
                              {t('training.video_active_badge')}
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[11px] font-bold shrink-0">
                              {t('training.no_video_badge')}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {prod.ingredients.map((ing, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-800"
                            >
                              <strong className="text-[#DA291C]">
                                {ing.quantity} {ing.unit}
                              </strong>{' '}
                              {ing.name}
                            </span>
                          ))}
                        </div>

                        {prod.variantsIncluded && prod.variantsIncluded.length > 1 && (
                          <div className="p-2.5 rounded-xl bg-[#FFF8E7] border border-[#FFC72C] text-[11px] font-semibold text-slate-700 leading-snug">
                            <span className="text-[#DA291C] font-black">
                              {t('training.same_procedure_note', {
                                count: prod.variantCount || prod.variantsIncluded.length,
                              })}
                            </span>{' '}
                            {prod.variantsIncluded.join(', ')}
                          </div>
                        )}
                      </div>

                      <div className="pt-2 border-t border-[#F1E4D8] flex flex-wrap items-center gap-2">
                        {prod.hasVideo ? (
                          <button
                            type="button"
                            onClick={() => {
                              stopAllMedia();
                              setSelectedPositionKey(prod.positionKey);
                              setSelectedVideoSlug(prod.slug);
                              setDay1SubStep('video');
                              if (isAdmin && !selectedEmployee) {
                                setMainView('videos');
                              } else {
                                if (selectedEmployee?.auto_certified) {
                                  setAllowVeteranRetraining(true);
                                }
                                setMainView('staff');
                                setActiveTab('day1');
                              }
                            }}
                            className="flex-1 py-2 px-3 rounded-xl bg-[#DA291C] hover:bg-[#B91C1C] text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>{t('training.watch_video_btn')}</span>
                          </button>
                        ) : isAdmin ? (
                          <button
                            type="button"
                            onClick={() => {
                              stopAllMedia();
                              setSelectedPositionKey(prod.positionKey);
                              setSelectedVideoSlug(prod.slug);
                              setMainView('videos');
                              setDay1SubStep('video');
                            }}
                            className="flex-1 py-2 px-3 rounded-xl bg-[#FFF8E7] hover:bg-[#FFC72C]/30 border border-[#FFC72C] text-[#92400E] text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Wand2 className="w-3.5 h-3.5 text-[#DA291C]" />
                            <span>{t('training.review_steps_btn')}</span>
                          </button>
                        ) : null}

                        <button
                          type="button"
                          disabled={isUploading}
                          onClick={() =>
                            triggerVideoUploadForProduct({
                              slug: prod.slug,
                              name: prod.name,
                              positionKey: prod.positionKey,
                              ingredients: prod.ingredients,
                            })
                          }
                          className="py-2 px-3 rounded-xl bg-white hover:bg-[#FFF8E7] border border-[#FFC72C] text-[#0F172A] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5 text-[#DA291C]" />
                          <span>
                            {isUploading
                              ? t('training.uploading_video_status')
                              : prod.hasVideo
                              ? t('training.replace_video_btn')
                              : t('training.upload_video_btn')}
                          </span>
                        </button>

                        {prod.hasVideo && (
                          <button
                            type="button"
                            disabled={isDeleting}
                            onClick={() => handleDeleteProductVideo(prod.slug, prod.name)}
                            title={t('training.delete_video_btn')}
                            className="p-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </main>
      </div>

      {/* MODAL: ENVIAR LINK DE CAPACITACIÓN POR EMAIL */}
      {showEmailModal && selectedEmployee && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-3xl border border-[#FFC72C] max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-[#0F172A] flex items-center gap-2">
                <Mail className="w-5 h-5 text-[#DA291C]" />
                <span>{t('training.email_modal_title')}</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowEmailModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-black cursor-pointer flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs sm:text-sm font-medium text-slate-600">
              {t('training.email_modal_desc', { name: selectedEmployee.full_name })}
            </p>

            <form onSubmit={handleSendTrainingEmail} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
                  {t('training.email_label')}
                </label>
                <input
                  type="email"
                  required
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder={t('training.email_placeholder')}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 bg-[#FFFAF5] text-sm font-semibold"
                />
              </div>

              {emailFeedback && (
                <div
                  className={`p-3 rounded-xl text-xs font-bold border ${
                    emailFeedback.ok
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                      : 'bg-red-50 border-red-200 text-red-700'
                  }`}
                >
                  {emailFeedback.msg}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEmailModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer"
                >
                  {t('training.close_btn')}
                </button>
                <button
                  type="submit"
                  disabled={emailSending || !emailInput.trim()}
                  className="px-5 py-2 rounded-xl bg-[#DA291C] hover:bg-[#B91C1C] text-white text-xs sm:text-sm font-black cursor-pointer disabled:opacity-40"
                >
                  {emailSending ? t('training.email_sending') : t('training.send_email_link_btn')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: LISTA IMPRIMIBLE EN PAPEL Y DIGITAL */}
      <PrintableRecipeChecklistModal
        isOpen={showPrintableChecklistModal}
        onClose={() => setShowPrintableChecklistModal(false)}
        recipeProducts={recipeProducts}
        storeName={selectedStore?.name || 'Tacos Gavilan'}
        employeeName={selectedEmployee?.full_name || ''}
        trainerName={selectedTrainerName || t('training.fallback_store_manager')}
        lang={lang}
      />

      {/* MODAL ¿CÓMO FUNCIONA? */}
      {showHowItWorksModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-3xl border border-[#FFC72C] max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-lg font-black text-[#0F172A]">
                {t('training.boss_question_title')}
              </h3>
              <button
                type="button"
                onClick={() => setShowHowItWorksModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-black cursor-pointer flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">{t('training.boss_question_desc')}</p>
            <button
              type="button"
              onClick={() => setShowHowItWorksModal(false)}
              className="w-full py-3 rounded-xl bg-[#DA291C] text-white text-sm font-black cursor-pointer"
            >
              {t('training.understood_btn')}
            </button>
          </div>
        </div>
      )}

      {/* MODAL EDITOR DE PASOS Y VOZ (CAMPOS ES Y EN SEPARADOS) */}
      {showStepEditorModal && currentVideo && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-3xl border border-[#FFC72C] max-w-3xl w-full max-h-[88vh] flex flex-col p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-[#0F172A]">
                {t('training.editor_modal_title', {
                  name: lang === 'en' ? currentVideo.titleEn : currentVideo.titleEs,
                })}
              </h3>
              <button
                type="button"
                onClick={() => setShowStepEditorModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-black cursor-pointer flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editorErrorMsg && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold">
                {editorErrorMsg}
              </div>
            )}

            <div className="overflow-y-auto space-y-3 pr-1">
              {editingSteps.map((st, idx) => (
                <div
                  key={st.id}
                  className="p-4 rounded-2xl bg-[#FFFAF5] border border-[#F1E4D8] space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-[#DA291C]">
                      {t('training.editor_step_header', {
                        num: st.stepNumber,
                        time: st.timestampLabel,
                      })}
                      : {lang === 'en' ? st.titleEn : st.titleEs}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={aiExplainStepBusyId === st.id}
                        onClick={() => handleAiExplainStep(idx)}
                        className="px-3 py-1 rounded-lg bg-[#FFF8E7] border border-[#FFC72C] text-xs font-bold text-[#92400E] cursor-pointer"
                      >
                        <Wand2 className="w-3.5 h-3.5 inline mr-1" />
                        {aiExplainStepBusyId === st.id
                          ? t('training.editor_generating_btn')
                          : t('training.player_regenerate_ai')}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setEditingSteps((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                        {t('training.editor_es_label')}
                      </label>
                      <textarea
                        rows={2}
                        value={st.narrationEs}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditingSteps((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, narrationEs: val } : item
                            )
                          );
                        }}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                        {t('training.editor_en_label')}
                      </label>
                      <textarea
                        rows={2}
                        value={st.narrationEn}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditingSteps((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, narrationEn: val } : item
                            )
                          );
                        }}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-medium"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowStepEditorModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={savingStepsBusy}
                onClick={handleSaveEditedSteps}
                className="px-5 py-2.5 rounded-xl bg-[#DA291C] text-white text-xs sm:text-sm font-black cursor-pointer"
              >
                {savingStepsBusy
                  ? t('training.editor_converting_btn')
                  : t('training.save_step_ai_voice_btn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
