'use client';

/**
 * @module TraineeKioskPortalPage
 * @description Portal móvil, tableta y kiosco público de capacitación (`/training/portal`)
 * conectado en tiempo real con las 15 sucursales reales (`public.stores`), plantilla real
 * del Planificador (`toast_employees`) y validación anti-suplantación de PIN RONOS de 4 dígitos
 * (`POST /api/training/ronos-auth`).
 *
 * @businessRules
 * 1. Pre-selección desde Email (`?store=14&emp=...` o `?code=TG-XXXX`): sucursal y nombre quedan
 *    listos automáticamente para que el nuevo ingreso entre solo con su PIN RONOS.
 * 2. Antigüedad (2+ Semanas = Certificado Oficial): empleados con >= 14 días muestran directamente
 *    su Certificado Oficial Ejecutivo por Puesto (`OfficialCertificateView`).
 * 3. Reproductor 100% Limpio y Silenciado:
 *    - Audio original `.mp4` siempre mudo (`muted`, `volume = 0`); solo se escucha el Tutor de Voz (`Orus`).
 *    - Sin barra de progreso; únicamente Pausa/Reproducir y Pantalla Completa.
 *    - Cuando `autoPausedForVoice === true`, no muestra controles sobre el reproductor.
 * 4. 100% Adaptado a Móviles y Tabletas Vertical y Horizontal (`md:grid-cols-12`).
 * 5. Cero textos crudos ni enlaces a rutas protegidas administrativas.
 *
 * @dataFlow
 * - GET `/api/training/catalog` -> Sucursales, plantilla sin PII pública, videos y categorías base Asada.
 * - POST `/api/training/ronos-auth` -> Valida titularidad de PIN RONOS en vivo.
 * - GET / PUT `/api/training/enrollments` -> Consulta y actualiza avance de Día 1–4.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLanguage } from '@/lib/i18n';
import type {
  TrainingSopModuleSpec,
  TrainingVideoStep,
  StationPositionMeta,
  TrainingQuizQuestion,
} from '@/lib/training-sop-catalog';
import {
  OfficialCertificateView,
  type RecipeProductItem,
} from '@/components/training/OfficialCertificateView';
import {
  KeyRound,
  CheckCircle2,
  Play,
  Pause,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Scale,
  Award,
  Store as StoreIcon,
  UserCheck,
  Lock,
  Maximize2,
  Volume2,
  Sparkles,
  RefreshCw,
} from 'lucide-react';

interface RealStoreInfo {
  id: number;
  code: string;
  name: string;
  external_id: string;
  supervisor_name: string | null;
  has_drive_thru: boolean;
  managers: {
    id: number;
    fullName: string;
    role: string;
  }[];
}

interface RoleStationPortalSpec {
  stationKey: string;
  labelEs: string;
  labelEn: string;
  order: number;
  dayTarget?: number;
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
  assigned_station: string;
  job_role_key: 'COCINERO' | 'CAJERA' | 'LIDERAZGO';
  job_role_title_es: string;
  job_role_title_en: string;
  job_role_badge_es: string;
  job_role_badge_en: string;
  required_stations: RoleStationPortalSpec[];
  is_leader: boolean;
  sort_order: number;
  first_seen_date: string;
  tenure_days: number;
  tenure_weeks: number;
  is_new_hire: boolean;
  auto_certified: boolean;
  certificate_folio: string;
  ronos_synced: boolean;
}

function buildFallbackQuizForPortal(mod: TrainingSopModuleSpec): TrainingQuizQuestion[] {
  if (Array.isArray(mod.quiz) && mod.quiz.length > 0) {
    return mod.quiz;
  }
  const firstSpec = mod.recipeSpecs?.[0];
  const itemEs = firstSpec?.itemEs || mod.titleEs;
  const itemEn = firstSpec?.itemEn || mod.titleEn;
  const qtyText = firstSpec ? `${firstSpec.quantity} ${firstSpec.unit}` : '6 oz';

  return [
    {
      id: `${mod.slug}-portal-q1`,
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
      explanationEs: `Sirve exactamente ${qtyText} de ${itemEs}.`,
      explanationEn: `Serve exactly ${qtyText} of ${itemEn}.`,
    },
  ];
}

function TraineePortalInner() {
  const searchParams = useSearchParams();
  const initialCode = searchParams.get('code') || '';
  const initialStoreParam = searchParams.get('store') || '';
  const initialEmpParam = searchParams.get('emp') || '';
  const { language, setLanguage, t } = useLanguage();
  const lang = language === 'en' ? 'en' : 'es';

  const [ronosPin, setRonosPin] = useState('');
  const [validating, setValidating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<any | null>(null);
  const [authenticatedEmployee, setAuthenticatedEmployee] =
    useState<RealPlanificadorEmployee | null>(null);
  const [showCertifiedView, setShowCertifiedView] = useState<boolean>(false);

  const [videos, setVideos] = useState<TrainingSopModuleSpec[]>([]);
  const [positions, setPositions] = useState<StationPositionMeta[]>([]);
  const [stores, setStores] = useState<RealStoreInfo[]>([]);
  const [allEmployees, setAllEmployees] = useState<RealPlanificadorEmployee[]>([]);
  const [recipeProducts, setRecipeProducts] = useState<RecipeProductItem[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<number>(
    initialStoreParam ? Number(initialStoreParam) : 14
  );
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(initialEmpParam);
  const [selectedStationKey, setSelectedStationKey] = useState<string>('BURRITOS');
  const [selectedVideoSlug, setSelectedVideoSlug] = useState<string>('burrito-ok');
  const [activeDayTab, setActiveDayTab] = useState<1 | 2 | 3 | 4>(1);
  const [day1SubStep, setDay1SubStep] = useState<'video' | 'portions' | 'quiz'>('video');

  // Video Player & Orus Voice refs
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSpokenStepIdRef = useRef<string | null>(null);
  const autoPausedForVoiceRef = useRef<boolean>(false);
  const pausedBoundaryStepIdRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isVoiceSpeaking, setIsVoiceSpeaking] = useState(false);
  const [autoPausedForVoice, setAutoPausedForVoice] = useState(false);

  // Day 1 Quiz
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizResult, setQuizResult] = useState<{ score: number; passed: boolean } | null>(null);

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
    };
  }, [stopAllMedia]);

  const loadCatalog = useCallback(async () => {
    try {
      const res = await fetch('/api/training/catalog', { cache: 'no-store' });
      const data = await res.json();
      if (data.ok) {
        setVideos(data.modules || []);
        setPositions(data.positions || []);
        const realStores: RealStoreInfo[] = data.stores || [];
        setStores(realStores);
        const emps: RealPlanificadorEmployee[] = data.employees || [];
        setAllEmployees(emps);
        setRecipeProducts(data.recipeProducts || []);

        if (initialStoreParam) {
          setSelectedStoreId(Number(initialStoreParam));
        } else if (realStores.length > 0) {
          const lynwood = realStores.find((s) => Number(s.id) === 14) || realStores[0];
          setSelectedStoreId(Number(lynwood.id));
        }
        if (initialEmpParam) {
          setSelectedEmployeeId(initialEmpParam);
        }
      }
    } catch (err) {
      console.error('[TraineePortal] Catalog load error:', err);
    }
  }, [initialStoreParam, initialEmpParam]);

  const verifyAccessCode = useCallback(async (rawCode: string) => {
    const clean = rawCode.trim().toUpperCase();
    if (!clean) return;
    setValidating(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/training/enrollments?code=${encodeURIComponent(clean)}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || t('training.portal_code_error'));
        setEnrollment(null);
      } else {
        setEnrollment(data.enrollment);
        setSelectedStationKey(data.enrollment.position_key || 'BURRITOS');
        setActiveDayTab((data.enrollment.current_day || 1) as 1 | 2 | 3 | 4);
      }
    } catch {
      setErrorMsg(t('training.portal_connection_error'));
    } finally {
      setValidating(false);
    }
  }, [t]);

  useEffect(() => {
    loadCatalog();
    if (initialCode) {
      verifyAccessCode(initialCode);
    }
  }, [initialCode, loadCatalog, verifyAccessCode]);

  // Match authenticated employee automatically when loaded via ?code=TG-XXXX link
  useEffect(() => {
    if (enrollment && !authenticatedEmployee && allEmployees.length > 0) {
      const matched = allEmployees.find(
        (e) => e.full_name.toLowerCase() === String(enrollment.employee_name || '').toLowerCase()
      );
      if (matched) {
        setAuthenticatedEmployee(matched);
      }
    }
  }, [enrollment, authenticatedEmployee, allEmployees]);

  const selectedStore = useMemo(
    () => stores.find((s) => Number(s.id) === Number(selectedStoreId)) || stores[0] || null,
    [stores, selectedStoreId]
  );

  const storeEmployees = useMemo(() => {
    if (!selectedStore) return [];
    const extId = String(selectedStore.external_id || '');
    return allEmployees.filter((emp) => emp.store_ids.includes(extId));
  }, [allEmployees, selectedStore]);

  const handleEnterWithRonosPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployeeId || !selectedStore) return;
    const emp =
      storeEmployees.find((x) => x.id === selectedEmployeeId) ||
      allEmployees.find((x) => x.id === selectedEmployeeId);
    if (!emp) return;

    const cleanPin = ronosPin.replace(/\D/g, '').trim();
    if (cleanPin.length !== 4) {
      setErrorMsg(t('training.ronos_enter_4_digits'));
      return;
    }

    setValidating(true);
    setErrorMsg(null);
    try {
      const validStation = positions.some((p) => p.positionKey === emp.assigned_station)
        ? emp.assigned_station
        : emp.required_stations?.[0]?.stationKey || 'CARNES';
      const defaultTrainer =
        selectedStore.managers?.[0]?.fullName ||
        selectedStore.supervisor_name ||
        t('training.fallback_store_manager');

      const res = await fetch('/api/training/ronos-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: selectedStore.id,
          storeName: selectedStore.name,
          pin: cleanPin,
          employeeId: emp.id,
          employeeName: emp.full_name,
          expectedEmployeeName: emp.full_name,
          employeePhone: emp.phone,
          positionKey: validStation,
          stationKey: validStation,
          trainerName: defaultTrainer,
          autoCertified: Boolean(emp.auto_certified),
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.enrollment) {
        setAuthenticatedEmployee(emp);
        setEnrollment(data.enrollment);
        setSelectedStationKey(validStation);
        setActiveDayTab((data.enrollment.current_day || 1) as 1 | 2 | 3 | 4);
        setShowCertifiedView(Boolean(emp.auto_certified));
      } else if (data.code === 'PIN_OWNER_MISMATCH' && data.pinOwnerName) {
        setErrorMsg(
          t('training.ronos_mismatch_error', {
            owner: data.pinOwnerName,
            selected: emp.full_name,
          })
        );
      } else {
        setErrorMsg(data.error || t('training.ronos_pin_invalid'));
      }
    } catch {
      setErrorMsg(t('training.ronos_connection_error'));
    } finally {
      setValidating(false);
    }
  };

  const roleRequiredStations = useMemo<RoleStationPortalSpec[]>(() => {
    if (authenticatedEmployee?.required_stations?.length) {
      return authenticatedEmployee.required_stations;
    }
    return [
      { stationKey: 'CARNES', labelEs: '1. Cocción de Carnes', labelEn: '1. Meat Cooking & Grill', order: 1, dayTarget: 1 },
      { stationKey: 'TORTILLAS', labelEs: '2. Tortillas', labelEn: '2. Tortillas Station', order: 2, dayTarget: 1 },
      { stationKey: 'TACOS', labelEs: '3. Tacos y Platos', labelEn: '3. Tacos & Plates', order: 3, dayTarget: 2 },
      { stationKey: 'TORTAS/QUESADILLAS', labelEs: '4. Plancha de Tortas, Mulitas y Quesadillas', labelEn: '4. Tortas, Mulitas & Quesadillas Flat-Top', order: 4, dayTarget: 2 },
      { stationKey: 'BURRITOS', labelEs: '5. Burritos', labelEn: '5. Burritos Line', order: 5, dayTarget: 3 },
      { stationKey: 'PREPARACION', labelEs: '6. Preparación', labelEn: '6. Prep & Portions', order: 6, dayTarget: 3 },
    ];
  }, [authenticatedEmployee]);

  const assignedPosition = useMemo(() => {
    if (!enrollment) return null;
    const targetKey = selectedStationKey || enrollment.position_key || 'CARNES';
    return (
      positions.find((p) => p.positionKey === targetKey) ||
      positions.find((p) => p.positionKey === enrollment.position_key) ||
      positions[0] ||
      null
    );
  }, [enrollment, positions, selectedStationKey]);

  const stationRecipeProducts = useMemo(() => {
    const activeKey = assignedPosition?.positionKey || selectedStationKey || 'CARNES';
    return recipeProducts.filter((prod) => {
      if (activeKey === 'TORTAS/QUESADILLAS' || activeKey === 'TORTAS/MULITAS') {
        return prod.positionKey === 'TORTAS/QUESADILLAS' || prod.positionKey === 'TORTAS/MULITAS';
      }
      if (activeKey === 'Ventana 1' || activeKey === 'Ventana 2') {
        return prod.positionKey === 'Caja 1 / Salón' || prod.positionKey === 'Uber + Salsas';
      }
      return prod.positionKey === activeKey;
    });
  }, [recipeProducts, assignedPosition, selectedStationKey]);

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

  const stationVideos = useMemo(() => {
    const activeVideos = allAvailableModules.filter((v) => Boolean(v.videoUrl) && v.videoUrl !== 'DELETED');
    if (!assignedPosition) return activeVideos;
    const isTortas =
      assignedPosition.positionKey === 'TORTAS/QUESADILLAS' ||
      assignedPosition.positionKey === 'TORTAS/MULITAS';
    const matched = activeVideos.filter(
      (v) =>
        assignedPosition.primaryVideoSlugs.includes(v.slug) ||
        (isTortas
          ? v.positionKey === 'TORTAS/QUESADILLAS' || v.positionKey === 'TORTAS/MULITAS'
          : v.positionKey === assignedPosition.positionKey)
    );
    return matched.length > 0 ? matched : activeVideos;
  }, [allAvailableModules, assignedPosition]);

  const currentVideo = useMemo(() => {
    const exact = stationVideos.find((v) => v.slug === selectedVideoSlug);
    return exact || stationVideos[0] || null;
  }, [stationVideos, selectedVideoSlug]);

  const activeDay1Quiz = useMemo(
    () => (currentVideo ? buildFallbackQuizForPortal(currentVideo) : []),
    [currentVideo]
  );

  useEffect(() => {
    if (stationVideos.length > 0 && !stationVideos.some((v) => v.slug === selectedVideoSlug)) {
      setSelectedVideoSlug(stationVideos[0].slug);
    }
  }, [stationVideos, selectedVideoSlug]);

  // Step index without jumping to the last step at t = 0 or between gaps
  const currentStepIndex = useMemo(() => {
    if (!currentVideo || !currentVideo.steps.length) return 0;
    const directIdx = currentVideo.steps.findIndex(
      (s) => currentTime >= s.startSec && currentTime < s.endSec
    );
    if (directIdx >= 0) return directIdx;
    if (currentTime < currentVideo.steps[0].startSec) return 0;

    let latestStarted = 0;
    for (let i = 0; i < currentVideo.steps.length; i++) {
      if (currentTime >= currentVideo.steps[i].startSec) {
        latestStarted = i;
      }
    }
    return latestStarted;
  }, [currentVideo, currentTime]);

  const currentStep = useMemo(() => {
    if (!currentVideo || !currentVideo.steps.length) return null;
    return currentVideo.steps[currentStepIndex] || currentVideo.steps[0];
  }, [currentVideo, currentStepIndex]);

  const playStepVoice = useCallback(
    async (step: TrainingVideoStep, pauseVideoWhileSpeaking = false) => {
      if (!audioRef.current) return;
      const textToSpeak = lang === 'en' ? step.narrationEn || step.narrationEs : step.narrationEs;
      if (!textToSpeak) return;

      const srcUrl =
        lang === 'en' && step.audioUrlEn
          ? step.audioUrlEn
          : lang === 'es' && step.audioUrlEs
          ? step.audioUrlEs
          : `/api/training/tts?text=${encodeURIComponent(textToSpeak)}&voice=Orus&lang=${lang}`;

      if (videoRef.current) {
        videoRef.current.muted = true;
        videoRef.current.volume = 0;
      }
      if (pauseVideoWhileSpeaking && videoRef.current && !videoRef.current.paused) {
        autoPausedForVoiceRef.current = true;
        setAutoPausedForVoice(true);
        videoRef.current.pause();
        setIsPlaying(false);
      }

      try {
        audioRef.current.pause();
        audioRef.current.src = srcUrl;
        audioRef.current.load();
        setIsVoiceSpeaking(true);
        await audioRef.current.play();
      } catch {
        setIsVoiceSpeaking(false);
        autoPausedForVoiceRef.current = false;
        setAutoPausedForVoice(false);
      }
    },
    [lang]
  );

  const resumeAfterVoiceOrError = useCallback(() => {
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
  }, [currentVideo]);

  // Consistent with /training: play step narration while video plays, smart-pause at step end if live audio still playing
  const handleTimeUpdate = useCallback(() => {
    const vid = videoRef.current;
    if (!vid || !currentVideo) return;
    if (!vid.muted || vid.volume !== 0) {
      vid.muted = true;
      vid.volume = 0;
    }
    const now = vid.currentTime;
    setCurrentTime(now);

    const step = currentVideo.steps.find((s) => now >= s.startSec && now < s.endSec);
    if (!step) return;

    if (!vid.paused && lastSpokenStepIdRef.current !== step.id) {
      lastSpokenStepIdRef.current = step.id;
      playStepVoice(step, false);
    }

    const isAudioActuallyPlaying = Boolean(
      audioRef.current && !audioRef.current.paused && !audioRef.current.ended
    );
    if (
      isAudioActuallyPlaying &&
      pausedBoundaryStepIdRef.current !== step.id &&
      now >= step.endSec - 0.35 &&
      !vid.paused
    ) {
      pausedBoundaryStepIdRef.current = step.id;
      autoPausedForVoiceRef.current = true;
      vid.pause();
      setIsPlaying(false);
      setAutoPausedForVoice(true);
    }
  }, [currentVideo, playStepVoice]);

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
    playStepVoice(step, false);
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
      if (vid.currentTime < 0.3 && currentVideo?.steps[0]) {
        lastSpokenStepIdRef.current = currentVideo.steps[0].id;
        playStepVoice(currentVideo.steps[0], false);
      }
      vid.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      vid.pause();
      if (audioRef.current) audioRef.current.pause();
      setIsVoiceSpeaking(false);
      setIsPlaying(false);
    }
  };

  const toggleFullscreenVideo = () => {
    const container = videoContainerRef.current || videoRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (container.requestFullscreen) {
      container.requestFullscreen().catch(() => {});
    } else if ((videoRef.current as any)?.webkitEnterFullscreen) {
      (videoRef.current as any).webkitEnterFullscreen();
    }
  };

  const submitDay1Quiz = async () => {
    if (!currentVideo || !enrollment) return;
    const questions = activeDay1Quiz;
    let correct = 0;
    for (const q of questions) {
      if (quizAnswers[q.id] === q.correctIndex) correct++;
    }
    const score = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 100;
    const passed = score >= 80;
    setQuizResult({ score, passed });

    const res = await fetch('/api/training/enrollments', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: enrollment.id,
        action: 'complete_day1',
        quizScore: score,
        videosWatched: [currentVideo.slug],
      }),
    });
    const data = await res.json();
    if (data.ok && data.enrollment) {
      setEnrollment(data.enrollment);
    }
  };

  return (
    <div
      className="min-h-screen w-full text-[#0F172A]"
      style={{ backgroundColor: '#FFFAF5', colorScheme: 'light' }}
    >
      <audio
        ref={audioRef}
        onEnded={resumeAfterVoiceOrError}
        onError={resumeAfterVoiceOrError}
        className="hidden"
      />

      {/* Encabezado Público Limpio */}
      <header className="bg-white border-b border-[#F1E4D8] px-4 sm:px-6 py-3 shadow-xs print:hidden">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FFF5EB] border border-[#FFC72C] p-1 flex items-center justify-center">
              <img src="/logo.png" alt="Tacos Gavilan" className="w-full h-full object-contain" />
            </div>
            <h1 className="text-base sm:text-xl font-black text-[#0F172A]">
              {t('training.simple_title')} — Tacos Gavilan
            </h1>
          </div>

          <div className="flex items-center gap-2.5">
            {enrollment && (
              <button
                type="button"
                onClick={() => {
                  stopAllMedia();
                  setEnrollment(null);
                  setAuthenticatedEmployee(null);
                  setRonosPin('');
                  setQuizAnswers({});
                  setQuizResult(null);
                }}
                className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                {t('training.portal_change_employee')} ({enrollment.access_code})
              </button>
            )}
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={() => setLanguage('es')}
                className={`px-2.5 py-1 rounded-lg text-xs font-black cursor-pointer ${
                  lang === 'es' ? 'bg-[#DA291C] text-white' : 'text-slate-600'
                }`}
              >
                ES
              </button>
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`px-2.5 py-1 rounded-lg text-xs font-black cursor-pointer ${
                  lang === 'en' ? 'bg-[#DA291C] text-white' : 'text-slate-600'
                }`}
              >
                EN
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-5 sm:py-7">
        {!enrollment ? (
          <div className="max-w-xl mx-auto bg-white rounded-3xl border border-[#F1E4D8] p-6 sm:p-8 shadow-md space-y-6 mt-2">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-2xl bg-[#FFF5EB] border border-[#FFC72C] mx-auto flex items-center justify-center">
                <Lock className="w-7 h-7 text-[#DA291C]" />
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-[#0F172A]">
                {t('training.portal_welcome_title')}
              </h2>
              <p className="text-sm font-medium text-slate-600">
                {t('training.ronos_pin_helper')}
              </p>
            </div>

            <form
              onSubmit={handleEnterWithRonosPin}
              className="p-5 rounded-2xl bg-[#FFFAF5] border border-[#F1E4D8] space-y-4"
            >
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1.5">
                  1. {t('training.store_label')}
                </label>
                <div className="flex items-center gap-2.5 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5">
                  <StoreIcon className="w-4 h-4 text-[#DA291C] shrink-0" />
                  <select
                    value={selectedStoreId}
                    onChange={(e) => {
                      setSelectedStoreId(Number(e.target.value));
                      setSelectedEmployeeId('');
                    }}
                    className="w-full bg-transparent text-sm sm:text-base font-black text-[#0F172A] focus:outline-none cursor-pointer"
                  >
                    {stores.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1.5">
                  2. {t('training.employee_planificador_label')}
                </label>
                <div className="flex items-center gap-2.5 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5">
                  <UserCheck className="w-4 h-4 text-[#DA291C] shrink-0" />
                  <select
                    value={selectedEmployeeId}
                    onChange={(e) => setSelectedEmployeeId(e.target.value)}
                    className="w-full bg-transparent text-sm sm:text-base font-black text-[#0F172A] focus:outline-none cursor-pointer"
                  >
                    <option value="">{t('training.select_employee_option')}</option>
                    {storeEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.full_name} —{' '}
                        {lang === 'en' ? emp.job_role_title_en : emp.job_role_title_es}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1.5">
                  3. {t('training.ronos_pin_label')}
                </label>
                <div className="flex items-center gap-2.5 bg-white border border-[#FFC72C] rounded-xl px-3.5 py-2.5">
                  <KeyRound className="w-4 h-4 text-[#DA291C] shrink-0" />
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={ronosPin}
                    onChange={(e) => setRonosPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder={t('training.ronos_pin_placeholder')}
                    className="w-full bg-transparent text-center text-2xl font-mono font-black tracking-[0.5em] text-[#DA291C] focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={!selectedEmployeeId || ronosPin.length !== 4 || validating}
                className="w-full py-3.5 rounded-xl bg-[#DA291C] hover:bg-[#B91C1C] disabled:opacity-40 text-white text-base font-black shadow-sm cursor-pointer transition-all"
              >
                {validating ? t('training.portal_verifying_ronos') : t('training.ronos_verify_btn')}
              </button>
            </form>

            {errorMsg && (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-bold text-center">
                {errorMsg}
              </div>
            )}
          </div>
        ) : showCertifiedView && authenticatedEmployee?.auto_certified ? (
          <div className="space-y-5">
            <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 print:hidden">
              <div className="flex items-center gap-3">
                <Award className="w-8 h-8 text-emerald-700 shrink-0" />
                <div>
                  <div className="text-xs font-black uppercase text-emerald-800">
                    {t('training.badge_certified_2w')} ({authenticatedEmployee.tenure_weeks}{' '}
                    {t('training.weeks_in_scheduler')})
                  </div>
                  <h3 className="text-base sm:text-lg font-black text-[#0F172A]">
                    {t('training.certified_banner_title')}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCertifiedView(false)}
                className="px-4 py-2.5 rounded-xl bg-[#0F172A] text-white text-xs sm:text-sm font-black cursor-pointer"
              >
                {t('training.review_videos_optional_btn')}
              </button>
            </div>

            <OfficialCertificateView
              employeeName={authenticatedEmployee.full_name}
              storeName={enrollment.store_name || selectedStore?.name || 'Tacos Gavilan'}
              jobRoleTitle={
                lang === 'en'
                  ? authenticatedEmployee.job_role_title_en
                  : authenticatedEmployee.job_role_title_es
              }
              certifiedStations={authenticatedEmployee.required_stations}
              stationName={enrollment.position_key || authenticatedEmployee.assigned_station}
              folio={authenticatedEmployee.certificate_folio}
              issuedDate={authenticatedEmployee.first_seen_date}
              tenureWeeks={authenticatedEmployee.tenure_weeks}
              score={100}
              managerName={enrollment.trainer_name || t('training.fallback_store_manager')}
              supervisorName={selectedStore?.supervisor_name || t('training.fallback_operations_dir')}
              lang={lang}
            />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Barra de Contexto y Progreso de 4 Días */}
            <div className="bg-white rounded-3xl border border-[#F1E4D8] p-4 sm:p-6 shadow-xs space-y-4 print:hidden">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-bold uppercase text-[#DA291C]">
                    {enrollment.access_code} • {enrollment.store_name}
                  </div>
                  <h2 className="text-xl sm:text-2xl font-black text-[#0F172A]">
                    {t('training.portal_hello', { name: enrollment.employee_name })}
                  </h2>
                  <p className="text-xs sm:text-sm font-bold text-slate-700 mt-1">
                    {t('training.portal_role_to_certify')}{' '}
                    <span className="px-2.5 py-0.5 rounded-lg bg-[#FFF8E7] border border-[#FFC72C] text-[#DA291C] font-black">
                      {authenticatedEmployee
                        ? lang === 'en'
                          ? authenticatedEmployee.job_role_title_en
                          : authenticatedEmployee.job_role_title_es
                        : t('training.fallback_certified_cook')}
                    </span>
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {authenticatedEmployee?.auto_certified && (
                    <button
                      type="button"
                      onClick={() => {
                        stopAllMedia();
                        setShowCertifiedView(true);
                      }}
                      className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs sm:text-sm font-black cursor-pointer flex items-center gap-1.5"
                    >
                      <Award className="w-4 h-4" />
                      <span>{t('training.view_official_certificate')}</span>
                    </button>
                  )}
                  {[1, 2, 3, 4].map((d) => {
                    const isActive = activeDayTab === d;
                    const isDone =
                      (d === 1 && enrollment.day1_completed) ||
                      (d === 2 && enrollment.day2_completed) ||
                      (d === 3 && enrollment.day3_completed) ||
                      (d === 4 && enrollment.day4_completed);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => {
                          stopAllMedia();
                          setActiveDayTab(d as 1 | 2 | 3 | 4);
                        }}
                        className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-black cursor-pointer transition-all flex items-center gap-1.5 border ${
                          isActive
                            ? 'bg-[#DA291C] text-white border-[#DA291C] shadow-xs'
                            : 'bg-[#FFFAF5] text-[#0F172A] border-[#F1E4D8] hover:bg-[#FFF0E5]'
                        }`}
                      >
                        {isDone && <CheckCircle2 className="w-4 h-4" />}
                        <span>{t('training.portal_day_label', { day: d })}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Estaciones del Puesto */}
              <div className="pt-3 border-t border-slate-100">
                <div className="text-xs font-bold uppercase text-slate-500 mb-2">
                  {t('training.portal_stations_label')}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  {roleRequiredStations.map((st) => {
                    const isActive =
                      (assignedPosition?.positionKey || selectedStationKey) === st.stationKey;
                    const dayNum = st.dayTarget ?? st.order ?? 1;
                    return (
                      <button
                        key={st.stationKey}
                        type="button"
                        onClick={() => {
                          stopAllMedia();
                          setCurrentTime(0);
                          setSelectedStationKey(st.stationKey);
                        }}
                        className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                          isActive
                            ? 'bg-[#0F172A] text-white border-[#0F172A] shadow-xs'
                            : 'bg-[#FFFAF5] text-[#0F172A] border-[#F1E4D8] hover:border-[#DA291C]'
                        }`}
                      >
                        <div className="text-[10px] font-black uppercase text-[#FFC72C]">
                          {t('training.portal_day_label', { day: dayNum })}
                        </div>
                        <div className="text-xs font-black leading-snug mt-0.5">
                          {lang === 'en' ? st.labelEn : st.labelEs}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {activeDayTab === 1 && currentVideo && (
              <div className="space-y-5">
                {/* 3 Sub-Pasos Día 1 */}
                <div className="bg-white rounded-2xl border border-[#F1E4D8] p-2.5 flex flex-wrap gap-2">
                  {[
                    { id: 'video' as const, label: t('training.substep_video') },
                    {
                      id: 'portions' as const,
                      label: `${t('training.substep_portions')} (${stationRecipeProducts.length})`,
                    },
                    { id: 'quiz' as const, label: t('training.substep_quiz') },
                  ].map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => {
                        if (sub.id !== 'video') stopAllMedia();
                        setDay1SubStep(sub.id);
                      }}
                      className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-black cursor-pointer ${
                        day1SubStep === sub.id
                          ? 'bg-[#0F172A] text-white'
                          : 'bg-[#FFFAF5] text-slate-700 border border-[#F1E4D8]'
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>

                {day1SubStep === 'video' && (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
                    <div className="md:col-span-7 bg-white rounded-3xl border border-[#F1E4D8] p-4 sm:p-5 space-y-3.5 shadow-xs">
                      {stationVideos.length > 1 && (
                        <div className="flex flex-wrap gap-1.5">
                          {stationVideos.map((v) => (
                            <button
                              key={v.slug}
                              type="button"
                              onClick={() => {
                                stopAllMedia();
                                setCurrentTime(0);
                                setSelectedVideoSlug(v.slug);
                              }}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer ${
                                v.slug === currentVideo.slug
                                  ? 'bg-[#0F172A] text-white border-[#0F172A]'
                                  : 'bg-[#FFFAF5] text-slate-800 border-[#F1E4D8]'
                              }`}
                            >
                              {lang === 'en' ? v.titleEn : v.titleEs}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Reproductor 100% Limpio y Silenciado (controles ocultos si autoPausedForVoice) */}
                      <div
                        ref={videoContainerRef}
                        className="relative rounded-2xl overflow-hidden bg-black aspect-video select-none"
                      >
                        <video
                          key={currentVideo.videoUrl || currentVideo.slug}
                          ref={videoRef}
                          src={currentVideo.videoUrl || ''}
                          muted
                          onLoadedMetadata={(e) => {
                            e.currentTarget.muted = true;
                            e.currentTarget.volume = 0;
                          }}
                          onTimeUpdate={handleTimeUpdate}
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
                          controlsList="nodownload noplaybackrate noremoteplayback"
                          className="w-full h-full object-contain cursor-pointer"
                        />

                        {autoPausedForVoice && currentStep && (
                          <div className="absolute inset-x-4 bottom-4 rounded-2xl bg-[#0F172A]/90 text-white p-4 border-2 border-[#FFC72C] shadow-xl pointer-events-none">
                            <div className="flex items-center gap-2 text-xs font-black uppercase text-[#FFC72C] mb-1">
                              <Volume2 className="w-4 h-4 animate-pulse" />
                              {t('training.player_explaining_step')} (
                              {t('training.player_step_of', {
                                current: currentStep.stepNumber,
                                total: currentVideo.steps.length,
                              })}
                              )
                            </div>
                            <p className="text-sm font-bold leading-snug">
                              “{lang === 'en' ? currentStep.narrationEn : currentStep.narrationEs}”
                            </p>
                          </div>
                        )}

                        {!autoPausedForVoice && currentVideo.videoUrl && (
                          <div className="absolute bottom-3 right-3 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={togglePlayVideo}
                              className="px-3.5 py-2 rounded-xl bg-black/75 hover:bg-black text-white text-xs font-black flex items-center gap-1.5 cursor-pointer"
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
                              onClick={toggleFullscreenVideo}
                              className="p-2 rounded-xl bg-black/75 hover:bg-black text-white cursor-pointer"
                              title={t('training.player_fullscreen')}
                            >
                              <Maximize2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>

                      {!autoPausedForVoice && (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={togglePlayVideo}
                            className={`flex-1 py-3 px-4 rounded-xl text-white text-sm font-black flex items-center justify-center gap-2 cursor-pointer ${
                              isPlaying ? 'bg-amber-500' : 'bg-[#DA291C]'
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
                            className="py-3 px-4 rounded-xl bg-[#FFFAF5] border border-[#F1E4D8] text-[#0F172A] text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <RotateCcw className="w-4 h-4 text-[#DA291C]" />
                            <span>{t('training.repeat_step_btn')}</span>
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="md:col-span-5 bg-white rounded-3xl border border-[#F1E4D8] p-5 space-y-4 shadow-xs">
                      {currentStep && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="px-3 py-1 rounded-full bg-[#FFF0E5] text-[#DA291C] text-xs font-black">
                              {t('training.player_step_of', {
                                current: currentStep.stepNumber,
                                total: currentVideo.steps.length,
                              })}
                            </span>
                            <span className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                              <Sparkles className="w-3.5 h-3.5" />
                              {t('training.portal_active_tutor_label')}
                            </span>
                          </div>
                          <h3 className="text-lg font-black text-[#0F172A]">
                            {lang === 'en' ? currentStep.titleEn : currentStep.titleEs}
                          </h3>
                          <p className="text-sm font-semibold text-slate-800 bg-[#FFFAF5] p-3.5 rounded-xl border border-[#F1E4D8]">
                            “{lang === 'en' ? currentStep.narrationEn : currentStep.narrationEs}”
                          </p>
                          {currentStep.keyPortionEs && (
                            <div className="p-3 rounded-xl bg-[#FFF8E7] border border-[#FFC72C] font-black text-xs sm:text-sm text-[#0F172A] flex items-center gap-2">
                              <Scale className="w-4 h-4 text-[#DA291C]" />
                              {lang === 'en'
                                ? currentStep.keyPortionEn
                                : currentStep.keyPortionEs}
                            </div>
                          )}
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
                          className="py-3 px-4 rounded-xl border border-slate-200 bg-[#FFFAF5] disabled:opacity-40 text-xs sm:text-sm font-bold text-[#0F172A] flex items-center justify-center gap-1 cursor-pointer"
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
                          className="py-3 px-4 rounded-xl bg-[#0F172A] disabled:opacity-40 text-xs sm:text-sm font-bold text-white flex items-center justify-center gap-1 cursor-pointer"
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
                        className="w-full py-3.5 rounded-xl bg-emerald-600 text-white text-sm font-black cursor-pointer"
                      >
                        {t('training.next_go_to_portions')} →
                      </button>
                    </div>
                  </div>
                )}

                {day1SubStep === 'portions' && (
                  <div className="space-y-5">
                    <div className="bg-white rounded-3xl border border-[#F1E4D8] p-5 sm:p-6 space-y-4 shadow-xs">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-lg sm:text-xl font-black text-[#0F172A]">
                          {t('training.recipe_specs_title')}
                        </h3>
                        <button
                          type="button"
                          onClick={() => setDay1SubStep('quiz')}
                          className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs sm:text-sm font-black cursor-pointer"
                        >
                          {t('training.next_go_to_quiz')} →
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                        {currentVideo.recipeSpecs.map((sp, i) => (
                          <div
                            key={i}
                            className="p-4 rounded-2xl bg-[#FFFAF5] border border-[#F1E4D8] flex items-center justify-between gap-3"
                          >
                            <div>
                              <div className="text-sm sm:text-base font-black text-[#0F172A]">
                                {lang === 'en' ? sp.itemEn : sp.itemEs}
                              </div>
                              <div className="text-xs font-medium text-slate-600">
                                {lang === 'en' ? sp.utensilEn : sp.utensilEs}
                              </div>
                            </div>
                            <span className="px-3 py-1 rounded-xl bg-[#DA291C] text-white text-sm font-black">
                              {sp.quantity} {sp.unit}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {stationRecipeProducts.length > 0 && (
                      <div className="bg-white rounded-3xl border border-[#F1E4D8] p-5 sm:p-6 shadow-xs space-y-4">
                        <h3 className="text-base sm:text-lg font-black text-[#0F172A]">
                          {t('training.station_categories_title', {
                            count: stationRecipeProducts.length,
                          })}
                        </h3>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[420px] overflow-y-auto pr-1">
                          {stationRecipeProducts.map((prod) => (
                            <div
                              key={prod.guid}
                              className="p-3.5 rounded-2xl bg-[#FFFAF5] border border-[#F1E4D8] flex flex-col justify-between gap-2.5"
                            >
                              <div>
                                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-[#FFF0E5] text-[#DA291C]">
                                  {prod.category}
                                </span>
                                <h4 className="text-sm font-black text-[#0F172A] mt-1">
                                  {prod.name}
                                </h4>
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {prod.ingredients.slice(0, 4).map((ing, idx) => (
                                    <span
                                      key={idx}
                                      className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-slate-700"
                                    >
                                      {ing.name}:{' '}
                                      <strong>
                                        {ing.quantity} {ing.unit}
                                      </strong>
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
                              {prod.hasVideo && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    stopAllMedia();
                                    setCurrentTime(0);
                                    setSelectedVideoSlug(prod.slug);
                                    setDay1SubStep('video');
                                  }}
                                  className="w-full py-2 px-3 rounded-xl bg-[#DA291C] text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer"
                                >
                                  <Play className="w-3.5 h-3.5 fill-current" />
                                  <span>{t('training.product_watch_video')}</span>
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {day1SubStep === 'quiz' && (
                  <div className="bg-white rounded-3xl border border-[#F1E4D8] p-5 sm:p-6 space-y-5 shadow-xs">
                    <h3 className="text-lg sm:text-xl font-black text-[#0F172A]">
                      {t('training.quiz_day1_title')}
                    </h3>
                    <div className="space-y-4">
                      {activeDay1Quiz.map((q, idx) => (
                        <div
                          key={q.id}
                          className="p-4 rounded-2xl bg-[#FFFAF5] border border-[#F1E4D8] space-y-3"
                        >
                          <div className="text-sm sm:text-base font-black text-[#0F172A]">
                            {idx + 1}. {lang === 'en' ? q.questionEn : q.questionEs}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {(lang === 'en' ? q.optionsEn : q.optionsEs).map((opt, oIdx) => {
                              const selected = quizAnswers[q.id] === oIdx;
                              return (
                                <button
                                  key={oIdx}
                                  type="button"
                                  onClick={() =>
                                    setQuizAnswers((prev) => ({ ...prev, [q.id]: oIdx }))
                                  }
                                  className={`text-left p-3.5 rounded-xl border text-xs sm:text-sm font-bold cursor-pointer ${
                                    selected
                                      ? 'bg-[#0F172A] text-white border-[#0F172A]'
                                      : 'bg-white text-slate-800 border-slate-200'
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
                    <button
                      type="button"
                      onClick={submitDay1Quiz}
                      className="px-7 py-3.5 rounded-xl bg-[#DA291C] text-white text-sm sm:text-base font-black cursor-pointer"
                    >
                      {t('training.quiz_submit_btn')}
                    </button>
                    {quizResult && (
                      <div
                        className={`p-4 rounded-xl border text-sm sm:text-base font-bold ${
                          quizResult.passed
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                            : 'bg-red-50 border-red-200 text-red-800'
                        }`}
                      >
                        {quizResult.passed
                          ? t('training.quiz_passed_msg', { score: quizResult.score })
                          : t('training.quiz_failed_msg', { score: quizResult.score })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeDayTab > 1 && (
              <div className="space-y-5">
                {enrollment.day4_completed ? (
                  <OfficialCertificateView
                    employeeName={enrollment.employee_name}
                    storeName={enrollment.store_name || 'Tacos Gavilan'}
                    jobRoleTitle={
                      authenticatedEmployee
                        ? lang === 'en'
                          ? authenticatedEmployee.job_role_title_en
                          : authenticatedEmployee.job_role_title_es
                        : t('training.fallback_certified_cook')
                    }
                    certifiedStations={roleRequiredStations}
                    stationName={enrollment.position_key}
                    folio={enrollment.certificate_folio || 'TG-CERT-2026'}
                    issuedDate={enrollment.day4_completed_at || undefined}
                    score={enrollment.day4_final_score ?? 100}
                    managerName={enrollment.trainer_name || t('training.fallback_store_manager')}
                    supervisorName={
                      selectedStore?.supervisor_name || t('training.fallback_operations_dir')
                    }
                    lang={lang}
                  />
                ) : (
                  <div className="bg-white rounded-3xl border border-[#F1E4D8] p-6 sm:p-8 text-center space-y-4 shadow-xs">
                    <h3 className="text-xl font-black text-[#0F172A]">
                      {t('training.portal_in_person_day_title', { day: activeDayTab })}
                    </h3>
                    <p className="text-sm sm:text-base text-slate-600 max-w-xl mx-auto">
                      {t('training.portal_in_person_day_desc')}
                    </p>
                    <button
                      type="button"
                      onClick={() => verifyAccessCode(enrollment.access_code)}
                      disabled={validating}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0F172A] text-white text-xs sm:text-sm font-black cursor-pointer"
                    >
                      <RefreshCw className={`w-4 h-4 ${validating ? 'animate-spin' : ''}`} />
                      <span>{t('training.portal_refresh_progress_btn')}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default function TraineeKioskPortalPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center text-[#0F172A] font-black"
          style={{ backgroundColor: '#FFFAF5' }}
        >
          Tacos Gavilan...
        </div>
      }
    >
      <TraineePortalInner />
    </Suspense>
  );
}
