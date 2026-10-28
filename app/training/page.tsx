'use client';

/**
 * @module TrainingAcademyPage
 * @description Módulo Oficial de Entrenamiento Operativo (Academia SOP Tacos Gavilan)
 * conectado 100% en tiempo real con las 15 sucursales reales (`public.stores`), la plantilla real
 * del Planificador (`toast_employees`, `shifts`, `station_assignments`), el padrón en vivo de RONOS
 * (`verifyRonosPin`) y el catálogo completo de los 218+ productos vendidos con receta (`toast_menu_items` + `recipes`).
 *
 * @businessRules
 * 1. Regla de Antigüedad (2+ Semanas en Planificador = Ya Certificados) vs Nuevo Ingreso:
 *    - Todos los empleados activos con 2 o más semanas (>= 14 días) en el Planificador ya cuentan automáticamente
 *      con su Certificado Oficial de Competencia Operativa listo para ver e imprimir.
 *    - Solo los empleados de nuevo ingreso (< 2 semanas en el Planificador) entran al flujo activo de capacitación
 *      (con opción de habilitar re-entrenamiento si un veterano cambia de estación).
 * 2. Clave de 4 Dígitos de RONOS Sincronizada:
 *    - Valida el PIN real de 4 dígitos de RONOS en vivo (`POST /api/training/ronos-auth` -> `verifyRonosPin`),
 *      exactamente igual que el módulo Blindaje Delivery.
 * 3. Envío de Link por Email (Cero SMS) + Modo PC del Manager:
 *    - Permite enviar el enlace directo de capacitación al correo electrónico del nuevo ingreso vía Gmail OAuth2
 *      (`POST /api/training/send-email`) para que entre desde su teléfono con su PIN de RONOS, o iniciar la capacitación
 *      directamente en la PC/Tableta del Manager.
 * 4. 100% Adaptado a Móviles y Tabletas (Vertical y Horizontal):
 *    - Diseño responsivo completo en orientación vertical (portrait) y horizontal (landscape).
 * 5. Catálogo Completo de Productos Vendidos con Receta + Subir / Editar / Eliminar Video + Voz IA (`Orus`):
 *    - Lista todos los productos vendidos con receta real del sistema, permitiendo subir, reemplazar o eliminar su video,
 *      y pausar el video en cualquier segundo para agregar un paso con texto que al guardar se convierte en Voz IA (`Orus`).
 * 6. Reproductor de Video 100% Limpio:
 *    - Sin barra de progreso nativa. Solo permite Pausar/Reproducir o Pantalla Completa (Fullscreen).
 *    - Cada vez que el video se pausa automáticamente para explicar un paso, NO muestra controles sobre el video.
 *
 * @dataFlow
 * - `GET / PUT / DELETE /api/training/catalog`
 * - `POST /api/training/video`
 * - `POST /api/training/ronos-auth`
 * - `POST /api/training/send-email`
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { useAuth } from '@/components/ProtectedRoute';
import type {
  TrainingSopModuleSpec,
  TrainingVideoStep,
  StationPositionMeta,
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
  Users,
  Car,
  Crown,
  Timer,
  Printer,
  Wand2,
  ExternalLink,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  Plus,
  Minus,
  Trash2,
  HelpCircle,
  MapPin,
  Store as StoreIcon,
  UserCheck,
  Mail,
  Monitor,
  Upload,
  Maximize2,
  Search,
  Video,
  ShieldCheck,
  PlusCircle,
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
  required_stations?: {
    stationKey: string;
    activitiesKeys: string[];
    order: number;
    labelEs: string;
    labelEn: string;
    shortDescEs: string;
    shortDescEn: string;
  }[];
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

function formatSeconds(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const mins = Math.floor(safe / 60);
  const rem = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export default function TrainingAcademyPage() {
  const { language, setLanguage, t } = useLanguage();
  const { user } = useAuth();
  const lang = language === 'en' ? 'en' : 'es';

  // Real Data from Supabase & Planificador
  const [videos, setVideos] = useState<TrainingSopModuleSpec[]>([]);
  const [positions, setPositions] = useState<EnrichedPosition[]>([]);
  const [stores, setStores] = useState<RealStoreInfo[]>([]);
  const [allEmployees, setAllEmployees] = useState<RealPlanificadorEmployee[]>([]);
  const [recipeProducts, setRecipeProducts] = useState<RecipeProductItem[]>([]);
  const [enrollments, setEnrollments] = useState<TrainingEnrollment[]>([]);

  // Real Store & Real Planificador Employee Selection
  const [selectedStoreId, setSelectedStoreId] = useState<number>(14);
  const [employeeFilterMode, setEmployeeFilterMode] = useState<'new_hires' | 'certified' | 'all'>('all');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [selectedTrainerName, setSelectedTrainerName] = useState<string>('');
  const [allowVeteranRetraining, setAllowVeteranRetraining] = useState<boolean>(false);

  // RONOS PIN Verification state
  const [ronosPinInput, setRonosPinInput] = useState<string>('');
  const [ronosVerifiedInfo, setRonosVerifiedInfo] = useState<{
    employeeUserId: number;
    fullName: string;
    ronosCode: string;
  } | null>(null);
  const [ronosVerifyBusy, setRonosVerifyBusy] = useState<boolean>(false);
  const [ronosErrorMsg, setRonosErrorMsg] = useState<string | null>(null);

  // Email Invitation state (Point 4: Email only, zero SMS)
  const [showEmailModal, setShowEmailModal] = useState<boolean>(false);
  const [emailInput, setEmailInput] = useState<string>('');
  const [sendingEmailBusy, setSendingEmailBusy] = useState<boolean>(false);
  const [emailFeedback, setEmailFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // Printable Master Recipe Checklist Modal (Point 8)
  const [showPrintableChecklistModal, setShowPrintableChecklistModal] = useState<boolean>(false);

  // Navigation state
  const [selectedGroup, setSelectedGroup] = useState<'cocina' | 'salon' | 'drive_thru' | 'liderazgo'>('cocina');
  const [selectedPositionKey, setSelectedPositionKey] = useState<string>('BURRITOS');
  const [selectedVideoSlug, setSelectedVideoSlug] = useState<string>('burrito-ok');
  const [activeTab, setActiveTab] = useState<'day1' | 'day2' | 'day3' | 'day4' | 'catalog'>('day1');
  const [day1SubStep, setDay1SubStep] = useState<'video' | 'portions' | 'quiz'>('video');
  const [day3ShiftTab, setDay3ShiftTab] = useState<'Apertura' | 'Regular' | 'Cierre'>('Apertura');
  const [activeTraineeId, setActiveTraineeId] = useState<string | null>(null);

  // Recipe Catalog & Video Upload / Replace / Delete state (Point 6)
  const [catalogSearch, setCatalogSearch] = useState<string>('');
  const [catalogCategory, setCatalogCategory] = useState<string>('ALL');
  const [uploadingVideoSlug, setUploadingVideoSlug] = useState<string | null>(null);
  const [deletingVideoSlug, setDeletingVideoSlug] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingUploadProduct, setPendingUploadProduct] = useState<{
    slug: string;
    name: string;
    positionKey: string;
    ingredients: any[];
  } | null>(null);

  // Pause-to-Add-Step with AI Voice state (Point 7)
  const [showAddStepAtPauseBox, setShowAddStepAtPauseBox] = useState<boolean>(false);
  const [pausedTimestampSec, setPausedTimestampSec] = useState<number>(0);
  const [newStepTitle, setNewStepTitle] = useState<string>('');
  const [newStepNarration, setNewStepNarration] = useState<string>('');
  const [newStepPortion, setNewStepPortion] = useState<string>('');
  const [savingPausedStepBusy, setSavingPausedStepBusy] = useState<boolean>(false);

  // Modals
  const [showStationModal, setShowStationModal] = useState<boolean>(false);
  const [showHowItWorksModal, setShowHowItWorksModal] = useState<boolean>(false);
  const [showStepEditorModal, setShowStepEditorModal] = useState<boolean>(false);

  // Video & Orus Neural Male Voice Player state (Point 9: Clean player, no progress bar)
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSpokenStepIdRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [autoPausePerStep, setAutoPausePerStep] = useState(true);
  const [isVoiceSpeaking, setIsVoiceSpeaking] = useState(false);
  const [autoPausedForVoice, setAutoPausedForVoice] = useState(false);
  const [showAllVideosInSelector, setShowAllVideosInSelector] = useState(false);

  // Day 1 Quiz state
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizSubmittedResult, setQuizSubmittedResult] = useState<{ score: number; passed: boolean } | null>(null);

  // Day 2 Supervised Practice state
  const [day2Rubric, setDay2Rubric] = useState<Record<string, boolean>>({});
  const [day2Reps, setDay2Reps] = useState<number>(0);
  const [day2SavedBanner, setDay2SavedBanner] = useState<boolean>(false);

  // Day 3 Solo Execution + Stopwatch state
  const [stopwatchRunning, setStopwatchRunning] = useState<boolean>(false);
  const [stopwatchElapsedDeci, setStopwatchElapsedDeci] = useState<number>(0);
  const [day3BestTimeSec, setDay3BestTimeSec] = useState<number | null>(null);
  const [day3SoloReps, setDay3SoloReps] = useState<number>(0);
  const [day3ActivitiesChecked, setDay3ActivitiesChecked] = useState<Record<string, boolean>>({});

  // Day 4 Final Certification state
  const [day4ExamAnswers, setDay4ExamAnswers] = useState<Record<string, number>>({});
  const [day4AuditChecks, setDay4AuditChecks] = useState<Record<string, boolean>>({
    scale_accuracy: true,
    assembly_technique: true,
    speed_benchmark: true,
    temp_food_safety: true,
    autonomous_routines: true,
  });
  const [certificationResult, setCertificationResult] = useState<{
    passed: boolean;
    combinedScore: number;
    examScore: number;
    practicalScore: number;
    folio: string | null;
  } | null>(null);

  // AI Step & Voice Editor state
  const [editableSteps, setEditableSteps] = useState<TrainingVideoStep[]>([]);
  const [aiGeneratingStepIdx, setAiGeneratingStepIdx] = useState<number | null>(null);
  const [savingStepsBusy, setSavingStepsBusy] = useState<boolean>(false);

  const loadTrainingData = useCallback(async () => {
    try {
      const [catRes, enrRes] = await Promise.all([
        fetch('/api/training/catalog'),
        fetch('/api/training/enrollments'),
      ]);
      const catJson = await catRes.json();
      const enrJson = await enrRes.json();

      if (catJson.ok) {
        setVideos(catJson.modules || []);
        setPositions(catJson.positions || []);
        const realStores: RealStoreInfo[] = catJson.stores || [];
        setStores(realStores);
        setAllEmployees(catJson.employees || []);
        setRecipeProducts(catJson.recipeProducts || []);

        if (realStores.length > 0) {
          const userStoreId = user?.store_id ? Number(user.store_id) : null;
          const preferred =
            (userStoreId && realStores.find((s) => Number(s.id) === userStoreId)) ||
            realStores.find((s) => Number(s.id) === 14) ||
            realStores[0];
          if (preferred) {
            setSelectedStoreId((prev) =>
              realStores.some((s) => Number(s.id) === Number(prev)) ? prev : Number(preferred.id)
            );
          }
        }
      }
      if (enrJson.ok) {
        setEnrollments(enrJson.enrollments || []);
      }
    } catch (err) {
      console.error('[TrainingAcademyPage] Error loading data:', err);
    }
  }, [user?.store_id]);

  useEffect(() => {
    loadTrainingData();
  }, [loadTrainingData]);

  const selectedStore = useMemo(() => {
    return stores.find((s) => Number(s.id) === Number(selectedStoreId)) || stores[0] || null;
  }, [stores, selectedStoreId]);

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
    () => storeEmployees.filter((emp) => emp.auto_certified),
    [storeEmployees]
  );

  const filteredStoreEmployees = useMemo(() => {
    if (employeeFilterMode === 'new_hires') return newHireStoreEmployees;
    if (employeeFilterMode === 'certified') return certifiedStoreEmployees;
    return storeEmployees;
  }, [employeeFilterMode, newHireStoreEmployees, certifiedStoreEmployees, storeEmployees]);

  const storeTrainers = useMemo(() => {
    const names = new Set<string>();
    if (selectedStore?.managers) {
      for (const m of selectedStore.managers) {
        if (m.fullName) names.add(`${m.fullName} (${m.role})`);
      }
    }
    for (const emp of storeEmployees) {
      if (emp.is_leader && emp.full_name) {
        const roleLabel = emp.job_titles[0] || 'Líder';
        names.add(`${emp.full_name} (${roleLabel})`);
      }
    }
    if (selectedStore?.supervisor_name) {
      names.add(`${selectedStore.supervisor_name} (Supervisor)`);
    }
    return Array.from(names);
  }, [selectedStore, storeEmployees]);

  useEffect(() => {
    if (storeTrainers.length > 0 && (!selectedTrainerName || !storeTrainers.includes(selectedTrainerName))) {
      setSelectedTrainerName(storeTrainers[0]);
    }
  }, [storeTrainers, selectedTrainerName]);

  const selectedEmployee = useMemo(() => {
    if (!selectedEmployeeId) return null;
    return storeEmployees.find((e) => e.id === selectedEmployeeId) || null;
  }, [storeEmployees, selectedEmployeeId]);

  const activeTrainee = useMemo(
    () => enrollments.find((e) => e.id === activeTraineeId) || null,
    [enrollments, activeTraineeId]
  );

  const ensureEnrollmentForEmployee = useCallback(
    async (
      emp: RealPlanificadorEmployee,
      stationKey: string,
      store: RealStoreInfo | null,
      trainer: string
    ): Promise<TrainingEnrollment | null> => {
      if (!store) return null;
      const existingLocal = enrollments.find(
        (enr) =>
          Number(enr.store_id) === Number(store.id) &&
          enr.employee_name.toLowerCase() === emp.full_name.toLowerCase() &&
          enr.position_key === stationKey
      );
      if (existingLocal) {
        setActiveTraineeId(existingLocal.id);
        return existingLocal;
      }

      try {
        const res = await fetch('/api/training/enrollments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employeeName: emp.full_name,
            employeeId: emp.id,
            employeePhone: emp.phone,
            storeId: store.id,
            storeName: store.name,
            positionKey: stationKey,
            trainerName: trainer || storeTrainers[0] || 'Manager',
            durationDays: 4,
          }),
        });
        const data = await res.json();
        if (data.ok && data.enrollment) {
          setEnrollments((prev) => {
            const without = prev.filter((x) => x.id !== data.enrollment.id);
            return [data.enrollment, ...without];
          });
          setActiveTraineeId(data.enrollment.id);
          return data.enrollment;
        }
      } catch (err) {
        console.error('[TrainingAcademyPage] Error ensuring employee enrollment:', err);
      }
      return null;
    },
    [enrollments, storeTrainers]
  );

  const handleSelectPlanificadorEmployee = async (empId: string) => {
    setSelectedEmployeeId(empId);
    setRonosVerifiedInfo(null);
    setRonosPinInput('');
    setRonosErrorMsg(null);
    setAllowVeteranRetraining(false);

    if (!empId) {
      setActiveTraineeId(null);
      return;
    }
    const emp = storeEmployees.find((e) => e.id === empId);
    if (!emp) return;

    setEmailInput(emp.email || '');

    const validStation = positions.some((p) => p.positionKey === emp.assigned_station)
      ? emp.assigned_station
      : selectedPositionKey;
    setSelectedPositionKey(validStation);

    if (emp.is_new_hire) {
      await ensureEnrollmentForEmployee(emp, validStation, selectedStore, selectedTrainerName);
    }
  };

  // Point 3: Verify 4-digit RONOS PIN live
  const handleVerifyRonosPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStore || !/^\d{4}$/.test(ronosPinInput.trim())) {
      setRonosErrorMsg('Ingresa los 4 dígitos numéricos del PIN de RONOS.');
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
          pin: ronosPinInput.trim(),
          employeeId: selectedEmployee?.id || null,
          expectedEmployeeName: selectedEmployee?.full_name || null,
          stationKey: selectedPositionKey,
          trainerName: selectedTrainerName,
          autoCertified: selectedEmployee?.auto_certified || false,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setRonosErrorMsg(data.error || 'PIN de RONOS inválido.');
      } else {
        setRonosVerifiedInfo(data.ronosEmployee);
        // Si no había empleado seleccionado, intentar seleccionarlo por nombre
        if (!selectedEmployeeId && data.ronosEmployee?.fullName) {
          const matched = storeEmployees.find(
            (emp) => emp.full_name.toLowerCase() === String(data.ronosEmployee.fullName).toLowerCase()
          );
          if (matched) {
            setSelectedEmployeeId(matched.id);
          }
        }
      }
    } catch {
      setRonosErrorMsg('Error de conexión con RONOS.');
    } finally {
      setRonosVerifyBusy(false);
    }
  };

  // Point 4: Send Training Link by Email (Zero SMS)
  const handleSendTrainingEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStore || !selectedEmployee) return;
    setSendingEmailBusy(true);
    setEmailFeedback(null);
    try {
      const res = await fetch('/api/training/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: selectedStore.id,
          storeName: selectedStore.name,
          employeeId: selectedEmployee.id,
          employeeName: selectedEmployee.full_name,
          email: emailInput.trim(),
          stationLabel: selectedPositionKey,
          trainerName: selectedTrainerName,
          originUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setEmailFeedback({
          ok: false,
          msg: data.error || 'No se pudo enviar el correo.',
        });
      } else {
        setEmailFeedback({
          ok: true,
          msg: `Correo enviado exitosamente a ${data.sentTo}. El empleado ya puede abrirlo desde su teléfono e ingresar con su clave de RONOS.`,
        });
        setAllEmployees((prev) =>
          prev.map((emp) =>
            emp.id === selectedEmployee.id ? { ...emp, email: emailInput.trim() } : emp
          )
        );
      }
    } catch {
      setEmailFeedback({ ok: false, msg: 'Error de red enviando el correo.' });
    } finally {
      setSendingEmailBusy(false);
    }
  };

  const currentPosition = useMemo(
    () => positions.find((p) => p.positionKey === selectedPositionKey) || positions[0] || null,
    [positions, selectedPositionKey]
  );

  const groupPositions = useMemo(
    () => positions.filter((p) => p.groupKey === selectedGroup),
    [positions, selectedGroup]
  );

  // Combine modules with recipeProducts that have custom/uploaded videos or steps
  const allAvailableModules = useMemo(() => {
    const bySlug = new Map<string, TrainingSopModuleSpec>();
    for (const v of videos) {
      bySlug.set(v.slug, v);
    }
    for (const rp of recipeProducts) {
      if (!bySlug.has(rp.slug)) {
        bySlug.set(rp.slug, {
          slug: rp.slug,
          positionKey: rp.positionKey,
          groupKey: 'cocina',
          titleEs: rp.name,
          titleEn: rp.name,
          subtitleEs: `${rp.category} • Receta Oficial`,
          subtitleEn: `${rp.category} • Official Recipe`,
          sourceVideoFilename: rp.sourceVideoFilename,
          videoSlug: rp.slug,
          videoUrl: rp.videoUrl,
          durationSeconds: rp.durationSeconds,
          targetPrepSeconds: rp.targetPrepSeconds,
          grillTempFahrenheit: rp.grillTempFahrenheit,
          steps: rp.steps || [],
          recipeSpecs: rp.recipeSpecs || [],
          quiz: [],
          dayPlan: [],
          sortOrder: 99,
        });
      }
    }
    return Array.from(bySlug.values());
  }, [videos, recipeProducts]);

  const stationVideos = useMemo(() => {
    const withVideoOnly = allAvailableModules.filter((v) => Boolean(v.videoUrl));
    if (!currentPosition) return withVideoOnly;
    if (showAllVideosInSelector) return withVideoOnly;
    const matched = withVideoOnly.filter(
      (v) =>
        currentPosition.primaryVideoSlugs.includes(v.slug) ||
        v.positionKey === currentPosition.positionKey
    );
    return matched.length > 0 ? matched : withVideoOnly;
  }, [allAvailableModules, currentPosition, showAllVideosInSelector]);

  const currentVideo = useMemo(() => {
    const exactMatch = allAvailableModules.find((v) => v.slug === selectedVideoSlug);
    if (exactMatch && exactMatch.videoUrl) return exactMatch;
    if (stationVideos.length > 0) return stationVideos[0];
    return exactMatch || allAvailableModules[0] || null;
  }, [allAvailableModules, stationVideos, selectedVideoSlug]);

  const currentStepIndex = useMemo(() => {
    if (!currentVideo || !currentVideo.steps.length) return 0;
    const idx = currentVideo.steps.findIndex(
      (s) => currentTime >= s.startSec && currentTime < s.endSec
    );
    return idx >= 0 ? idx : currentVideo.steps.length - 1;
  }, [currentVideo, currentTime]);

  const currentStep = useMemo(() => {
    if (!currentVideo || !currentVideo.steps.length) return null;
    return currentVideo.steps[currentStepIndex] || currentVideo.steps[0];
  }, [currentVideo, currentStepIndex]);

  const playStepVoiceover = useCallback(
    (step: TrainingVideoStep) => {
      if (!voiceEnabled) return;
      const audioEl = audioRef.current;
      if (!audioEl) return;

      const textToSpeak = lang === 'en' ? step.narrationEn : step.narrationEs;
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

      audioEl.src = srcUrl;
      setIsVoiceSpeaking(true);
      audioEl.play().catch(() => {
        setIsVoiceSpeaking(false);
      });
    },
    [voiceEnabled, lang]
  );

  const handleAudioEnded = useCallback(() => {
    setIsVoiceSpeaking(false);
    if (videoRef.current) {
      videoRef.current.muted = true;
      videoRef.current.volume = 0;
      if (autoPausedForVoice) {
        setAutoPausedForVoice(false);
        videoRef.current.play().catch(() => {});
      }
    }
  }, [autoPausedForVoice]);

  const handleVideoTimeUpdate = useCallback(() => {
    const vid = videoRef.current;
    if (!vid || !currentVideo) return;
    const nowSec = vid.currentTime;
    setCurrentTime(nowSec);

    const activeStep = currentVideo.steps.find(
      (s) => nowSec >= s.startSec && nowSec < s.endSec
    );

    if (activeStep) {
      if (!vid.paused && lastSpokenStepIdRef.current !== activeStep.id) {
        lastSpokenStepIdRef.current = activeStep.id;
        playStepVoiceover(activeStep);
      }

      if (
        autoPausePerStep &&
        voiceEnabled &&
        isVoiceSpeaking &&
        !vid.paused &&
        nowSec >= activeStep.endSec - 0.35
      ) {
        vid.pause();
        setAutoPausedForVoice(true);
      }
    }
  }, [currentVideo, playStepVoiceover, autoPausePerStep, voiceEnabled, isVoiceSpeaking]);

  const jumpToStep = (step: TrainingVideoStep) => {
    const vid = videoRef.current;
    if (!vid) return;
    setAutoPausedForVoice(false);
    lastSpokenStepIdRef.current = step.id;
    vid.currentTime = step.startSec;
    setCurrentTime(step.startSec);
    vid
      .play()
      .then(() => {
        setIsPlaying(true);
        playStepVoiceover(step);
      })
      .catch(() => {});
  };

  const togglePlayVideo = () => {
    const vid = videoRef.current;
    if (!vid) return;
    setAutoPausedForVoice(false);
    if (vid.paused) {
      if (vid.currentTime < 0.3 && currentVideo?.steps[0]) {
        lastSpokenStepIdRef.current = currentVideo.steps[0].id;
        playStepVoiceover(currentVideo.steps[0]);
      }
      vid
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {});
    } else {
      vid.pause();
      if (audioRef.current) audioRef.current.pause();
      setIsPlaying(false);
      setIsVoiceSpeaking(false);
    }
  };

  // Point 9: Fullscreen handler on clean video player
  const handleToggleFullscreen = () => {
    const container = videoContainerRef.current || videoRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (container.requestFullscreen) {
      container.requestFullscreen().catch(() => {});
    }
  };

  // Point 7: Pause video at current second and open box to add step with text -> AI Voice
  const handlePauseToAddStepHere = () => {
    const vid = videoRef.current;
    if (vid && !vid.paused) {
      vid.pause();
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
    setAutoPausedForVoice(false);
    const sec = vid ? Math.floor(vid.currentTime) : Math.floor(currentTime);
    setPausedTimestampSec(sec);
    setNewStepTitle('');
    setNewStepNarration('');
    setNewStepPortion('');
    setShowAddStepAtPauseBox(true);
  };

  const handleSavePausedStepWithAiVoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentVideo || !newStepNarration.trim()) return;
    setSavingPausedStepBusy(true);
    try {
      const startSec = Math.max(0, pausedTimestampSec);
      const endSec = startSec + 6;
      const newStep: TrainingVideoStep = {
        id: `${currentVideo.slug}-step-${Date.now()}`,
        stepNumber: currentVideo.steps.length + 1,
        startSec,
        endSec,
        timestampLabel: `${formatSeconds(startSec)} - ${formatSeconds(endSec)}`,
        titleEs: newStepTitle.trim() || `Paso en ${formatSeconds(startSec)}`,
        titleEn: newStepTitle.trim() || `Step at ${formatSeconds(startSec)}`,
        narrationEs: newStepNarration.trim(),
        narrationEn: newStepNarration.trim(),
        keyPortionEs: newStepPortion.trim() || 'Estándar SOP',
        keyPortionEn: newStepPortion.trim() || 'SOP Standard',
        utensilEs: 'Estándar de línea',
        utensilEn: 'Line standard',
      };

      const nextSteps = [...currentVideo.steps, newStep];

      const res = await fetch('/api/training/catalog', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: currentVideo.slug,
          positionKey: currentVideo.positionKey,
          titleEs: currentVideo.titleEs,
          titleEn: currentVideo.titleEn,
          steps: nextSteps,
          regenerateVoice: true,
        }),
      });
      const data = await res.json();
      if (data.ok && data.steps) {
        setVideos((prev) => {
          const exists = prev.some((v) => v.slug === currentVideo.slug);
          if (exists) {
            return prev.map((v) =>
              v.slug === currentVideo.slug ? { ...v, steps: data.steps } : v
            );
          }
          return [...prev, { ...currentVideo, steps: data.steps }];
        });
        setRecipeProducts((prev) =>
          prev.map((rp) =>
            rp.slug === currentVideo.slug ? { ...rp, steps: data.steps } : rp
          )
        );
        setShowAddStepAtPauseBox(false);
        // Play the newly generated AI voice immediately
        const added = data.steps.find((s: TrainingVideoStep) => s.startSec === startSec);
        if (added) {
          playStepVoiceover(added);
        }
      }
    } catch (err) {
      console.error('[TrainingAcademyPage] Error saving paused step:', err);
    } finally {
      setSavingPausedStepBusy(false);
    }
  };

  // Point 6: Upload / Replace Video for any Recipe Product
  const triggerVideoUploadForProduct = (prod: {
    slug: string;
    name: string;
    positionKey: string;
    ingredients: any[];
  }) => {
    setPendingUploadProduct(prod);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleVideoFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pendingUploadProduct) return;

    setUploadingVideoSlug(pendingUploadProduct.slug);
    try {
      // Read actual video duration in browser before uploading so AI voice steps adapt 100% to the video length
      const videoDurationSec = await new Promise<number>((resolve) => {
        const tempVid = document.createElement('video');
        tempVid.preload = 'metadata';
        tempVid.onloadedmetadata = () => {
          URL.revokeObjectURL(tempVid.src);
          const dur = Number(tempVid.duration);
          resolve(Number.isFinite(dur) && dur > 2 ? Math.round(dur) : 45);
        };
        tempVid.onerror = () => resolve(45);
        tempVid.src = URL.createObjectURL(file);
      });

      const formData = new FormData();
      formData.append('file', file);
      formData.append('slug', pendingUploadProduct.slug);
      formData.append('titleEs', pendingUploadProduct.name);
      formData.append('titleEn', pendingUploadProduct.name);
      formData.append('positionKey', pendingUploadProduct.positionKey);
      formData.append('durationSeconds', String(videoDurationSec));
      formData.append('ingredientsJson', JSON.stringify(pendingUploadProduct.ingredients || []));
      formData.append('autoAdaptVoice', 'true');

      const res = await fetch('/api/training/video', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.ok && data.videoUrl) {
        await loadTrainingData();
        setSelectedVideoSlug(pendingUploadProduct.slug);
        setActiveTab('day1');
        setDay1SubStep('video');
      }
    } catch (err) {
      console.error('[TrainingAcademyPage] Video upload error:', err);
    } finally {
      setUploadingVideoSlug(null);
      setPendingUploadProduct(null);
    }
  };

  // Point 6: Delete Video if procedure changes
  const handleDeleteProductVideo = async (slug: string) => {
    setDeletingVideoSlug(slug);
    try {
      const res = await fetch(`/api/training/catalog?slug=${encodeURIComponent(slug)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.ok) {
        setVideos((prev) =>
          prev.map((v) => (v.slug === slug ? { ...v, videoUrl: null } : v))
        );
        setRecipeProducts((prev) =>
          prev.map((rp) =>
            rp.slug === slug ? { ...rp, hasVideo: false, videoUrl: null } : rp
          )
        );
      }
    } catch (err) {
      console.error('[TrainingAcademyPage] Delete video error:', err);
    } finally {
      setDeletingVideoSlug(null);
    }
  };

  useEffect(() => {
    if (!stopwatchRunning) return;
    const timer = setInterval(() => {
      setStopwatchElapsedDeci((prev) => prev + 1);
    }, 100);
    return () => clearInterval(timer);
  }, [stopwatchRunning]);

  const saveTraineeProgress = async (action: string, payload: Record<string, any>) => {
    let targetEnrollment = activeTrainee;
    if (!targetEnrollment && selectedEmployee) {
      targetEnrollment = await ensureEnrollmentForEmployee(
        selectedEmployee,
        selectedPositionKey,
        selectedStore,
        selectedTrainerName
      );
    }
    if (!targetEnrollment) return;

    try {
      const res = await fetch('/api/training/enrollments', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: targetEnrollment.id,
          action,
          ...payload,
        }),
      });
      const data = await res.json();
      if (data.ok && data.enrollment) {
        setEnrollments((prev) =>
          prev.map((e) => (e.id === data.enrollment.id ? data.enrollment : e))
        );
      }
    } catch (err) {
      console.error('[TrainingAcademyPage] Error saving progress:', err);
    }
  };

  const handleGradeDay1Quiz = async () => {
    if (!currentVideo) return;
    const questions = currentVideo.quiz;
    if (!questions.length) {
      setQuizSubmittedResult({ score: 100, passed: true });
      return;
    }
    let correctCount = 0;
    for (const q of questions) {
      if (quizAnswers[q.id] === q.correctIndex) {
        correctCount++;
      }
    }
    const score = Math.round((correctCount / questions.length) * 100);
    const passed = score >= 80;
    setQuizSubmittedResult({ score, passed });

    if (passed) {
      const watched = Array.from(
        new Set([...(activeTrainee?.day1_videos_watched || []), currentVideo.slug])
      );
      await saveTraineeProgress('complete_day1', {
        quizScore: score,
        videosWatched: watched,
      });
    }
  };

  const handleCompleteDay2 = async () => {
    setDay2SavedBanner(true);
    setTimeout(() => setDay2SavedBanner(false), 4500);
    await saveTraineeProgress('complete_day2', {
      supervisedReps: day2Reps,
      checklistJson: day2Rubric,
      approvedBy: selectedTrainerName,
      supervisorNotes: '',
    });
    setActiveTab('day3');
  };

  const handleStopAndRecordStopwatch = async () => {
    setStopwatchRunning(false);
    const recordedSec = Math.max(1, Math.round(stopwatchElapsedDeci / 10));
    const newBest =
      day3BestTimeSec === null ? recordedSec : Math.min(day3BestTimeSec, recordedSec);
    const newReps = day3SoloReps + 1;
    setDay3BestTimeSec(newBest);
    setDay3SoloReps(newReps);

    await saveTraineeProgress('update_progress', {
      day3SoloReps: newReps,
      day3BestTimeSeconds: newBest,
      day3ChecklistJson: day3ActivitiesChecked,
    });
  };

  const handleCompleteDay3 = async () => {
    await saveTraineeProgress('complete_day3', {
      soloReps: day3SoloReps,
      bestTimeSeconds: day3BestTimeSec,
      checklistJson: day3ActivitiesChecked,
      approvedBy: selectedTrainerName,
    });
    setActiveTab('day4');
  };

  const handleIssueDay4Certification = async () => {
    if (!currentVideo) return;
    const questions = currentVideo.quiz;
    let correct = 0;
    for (const q of questions) {
      if (day4ExamAnswers[q.id] === q.correctIndex) correct++;
    }
    const examScore = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 100;

    const weights: Record<string, number> = {
      scale_accuracy: 25,
      assembly_technique: 25,
      speed_benchmark: 20,
      temp_food_safety: 15,
      autonomous_routines: 15,
    };
    let practicalScore = 0;
    for (const [k, pts] of Object.entries(weights)) {
      if (day4AuditChecks[k]) practicalScore += pts;
    }

    const combinedScore = Math.round((examScore + practicalScore) / 2);
    const passed = combinedScore >= 90;
    const fallbackFolio = passed
      ? selectedEmployee?.certificate_folio ||
        `TG-CERT-${new Date().getFullYear()}-S${selectedStore?.id || 14}-${String(
          Math.floor(1000 + Math.random() * 9000)
        )}`
      : null;

    setCertificationResult({
      passed,
      combinedScore,
      examScore,
      practicalScore,
      folio: activeTrainee?.certificate_folio || fallbackFolio,
    });

    await saveTraineeProgress('certify_day4', {
      examScore,
      practicalScore,
      certifiedBy: selectedTrainerName,
    });
  };

  const openStepEditor = () => {
    if (!currentVideo) return;
    setEditableSteps(JSON.parse(JSON.stringify(currentVideo.steps)));
    setShowStepEditorModal(true);
  };

  const handleAiRefineStep = async (idx: number) => {
    if (!currentVideo) return;
    const step = editableSteps[idx];
    if (!step) return;
    setAiGeneratingStepIdx(idx);
    try {
      const res = await fetch('/api/training/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'ai-explain',
          dishTitle: lang === 'en' ? currentVideo.titleEn : currentVideo.titleEs,
          stepTitle: lang === 'en' ? step.titleEn : step.titleEs,
          rawHint: lang === 'en' ? step.narrationEn : step.narrationEs,
          stepNumber: step.stepNumber,
          voice: 'Orus',
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setEditableSteps((prev) => {
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            narrationEs: data.narrationEs || next[idx].narrationEs,
            narrationEn: data.narrationEn || next[idx].narrationEn,
            keyPortionEs: data.keyPortionEs || next[idx].keyPortionEs,
            keyPortionEn: data.keyPortionEn || next[idx].keyPortionEn,
            audioUrlEs: data.audioUrlEs || next[idx].audioUrlEs,
            audioUrlEn: data.audioUrlEn || next[idx].audioUrlEn,
          };
          return next;
        });
      }
    } catch (err) {
      console.error('[TrainingAcademyPage] AI refine error:', err);
    } finally {
      setAiGeneratingStepIdx(null);
    }
  };

  const handleSaveEditedSteps = async () => {
    if (!currentVideo) return;
    setSavingStepsBusy(true);
    try {
      const res = await fetch('/api/training/catalog', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: currentVideo.slug,
          positionKey: currentVideo.positionKey,
          titleEs: currentVideo.titleEs,
          titleEn: currentVideo.titleEn,
          steps: editableSteps,
          regenerateVoice: true,
        }),
      });
      const data = await res.json();
      if (data.ok && data.steps) {
        setVideos((prev) =>
          prev.map((v) => (v.slug === currentVideo.slug ? { ...v, steps: data.steps } : v))
        );
        setRecipeProducts((prev) =>
          prev.map((rp) => (rp.slug === currentVideo.slug ? { ...rp, steps: data.steps } : rp))
        );
        setShowStepEditorModal(false);
      }
    } catch (err) {
      console.error('[TrainingAcademyPage] Save steps error:', err);
    } finally {
      setSavingStepsBusy(false);
    }
  };

  const groupedActivities = useMemo(() => {
    const live = currentPosition?.activities || [];
    const groups: Record<'Apertura' | 'Regular' | 'Cierre', { id: string; name: string; time?: string }[]> = {
      Apertura: [],
      Regular: [],
      Cierre: [],
    };

    if (live.length > 0) {
      for (const act of live) {
        const rawType = (act.shiftType || 'Regular').toLowerCase();
        const key: 'Apertura' | 'Regular' | 'Cierre' = rawType.includes('aper')
          ? 'Apertura'
          : rawType.includes('cier')
          ? 'Cierre'
          : 'Regular';
        groups[key].push({
          id: `live-${act.id}`,
          name: act.activity,
          time: `${act.durationMinutes || 15} min`,
        });
      }
    } else if (currentPosition) {
      groups.Apertura = [
        {
          id: 'f-ap-1',
          name:
            lang === 'es'
              ? `Encender equipo de ${currentPosition.labelEs}, revisar temperatura y sanitizar estación.`
              : `Turn on ${currentPosition.labelEn} equipment, check temperature, and sanitize station.`,
          time: '06:00 AM',
        },
        {
          id: 'f-ap-2',
          name:
            lang === 'es'
              ? 'Colocar utensilios medidores limpios y revisar báscula digital en cero (0.0 oz).'
              : 'Place clean measuring utensils and verify digital scale is zeroed (0.0 oz).',
          time: '06:30 AM',
        },
      ];
      groups.Regular = (lang === 'es'
        ? currentPosition.keyRulesEs
        : currentPosition.keyRulesEn
      ).map((rule, idx) => ({
        id: `f-reg-${idx}`,
        name: rule,
        time: lang === 'es' ? 'Turno' : 'Shift',
      }));
      groups.Cierre = [
        {
          id: 'f-ci-1',
          name:
            lang === 'es'
              ? 'Tapar, poner etiqueta de fecha y guardar alimentos según regla FIFO.'
              : 'Cover, date-label, and store food items following FIFO rule.',
          time: lang === 'es' ? 'Cierre' : 'Closing',
        },
        {
          id: 'f-ci-2',
          name:
            lang === 'es'
              ? 'Lavar, desengrasar y dejar la estación lista para mañana a las 6:00 AM.'
              : 'Wash, degrease, and leave station ready for tomorrow at 6:00 AM.',
          time: lang === 'es' ? 'Cierre' : 'Closing',
        },
      ];
    }
    return groups;
  }, [currentPosition, lang]);

  const DEFAULT_COOK_STATIONS = useMemo(
    () => [
      {
        stationKey: 'CARNES',
        activitiesKeys: ['CARNES'],
        order: 1,
        labelEs: '1. Cocción de Carnes',
        labelEn: '1. Meat Grilling & Cooking',
        shortDescEs: 'Plancha a 250°F, Asada, Pastor, Pollo, Cabeza, Lengua, Carnitas, Buche y Chorizo.',
        shortDescEn: 'Flat-top at 250°F, Asada, Pastor, Pollo, Cabeza, Lengua, Carnitas, Buche, and Chorizo.',
      },
      {
        stationKey: 'TORTILLAS',
        activitiesKeys: ['TORTILLAS'],
        order: 2,
        labelEs: '2. Tortillas',
        labelEn: '2. Tortillas & Steamer',
        shortDescEs: 'Tortillas de maíz y harina, control de humedad en vaporera, chips y papelito.',
        shortDescEn: 'Corn and flour tortillas, steamer moisture control, chips, and wax paper.',
      },
      {
        stationKey: 'TACOS',
        activitiesKeys: ['TACOS'],
        order: 3,
        labelEs: '3. Tacos y Platos',
        labelEn: '3. Tacos & Plates',
        shortDescEs: 'Tacos (2 tortillas maíz + 1.5 oz carne), Taco Plate, Platos de Carne y Desayunos.',
        shortDescEn: 'Tacos (2 corn tortillas + 1.5 oz meat), Taco Plate, Meat Plates, and Breakfast plates.',
      },
      {
        stationKey: 'TORTAS/QUESADILLAS',
        activitiesKeys: ['TORTAS/QUESADILLAS', 'TORTAS/MULITAS'],
        order: 4,
        labelEs: '4. Plancha de Tortas, Mulitas y Quesadillas',
        labelEn: '4. Tortas, Mulitas & Quesadillas Flat-Top',
        shortDescEs: 'Tortas en Telera (sin crema), Mulitas, Super Mulitas, Quesadillas y Super Quesadillas.',
        shortDescEn: 'Telera Tortas (no sour cream), Mulitas, Super Mulitas, Quesadillas, and Super Quesadillas.',
      },
      {
        stationKey: 'BURRITOS',
        activitiesKeys: ['BURRITOS'],
        order: 5,
        labelEs: '5. Burritos',
        labelEn: '5. Burritos, Sopes & Nachos',
        shortDescEs: 'Burritos Regulares, Super Burritos, Pura Carne, Burritos de Desayuno, Sopes y Super Nachos.',
        shortDescEn: 'Regular Burritos, Super Burritos, All-Meat Burritos, Breakfast Burritos, Sopes, and Super Nachos.',
      },
      {
        stationKey: 'PREPARACION',
        activitiesKeys: ['PREPARACION'],
        order: 6,
        labelEs: '6. Preparación',
        labelEn: '6. Kitchen Prep & Party Trays',
        shortDescEs: 'Arroz, Frijol, Cilindros de Crema y Aguacate, Salsas, Ollas y Party Trays (Catering).',
        shortDescEn: 'Rice, Beans, Sour Cream & Avocado Cylinders, Salsas, Pots, and Party Trays (Catering).',
      },
    ],
    []
  );

  const roleRequiredStations = useMemo(() => {
    if (selectedEmployee?.required_stations && selectedEmployee.required_stations.length > 0) {
      return selectedEmployee.required_stations;
    }
    return DEFAULT_COOK_STATIONS;
  }, [selectedEmployee, DEFAULT_COOK_STATIONS]);

  // Productos con receta al interior de la Estación de Trabajo seleccionada
  const stationRecipeProducts = useMemo(() => {
    return recipeProducts.filter((p) => {
      if (selectedPositionKey === 'TORTAS/QUESADILLAS' || selectedPositionKey === 'TORTAS/MULITAS') {
        return p.positionKey === 'TORTAS/QUESADILLAS' || p.positionKey === 'TORTAS/MULITAS';
      }
      return p.positionKey === selectedPositionKey;
    });
  }, [recipeProducts, selectedPositionKey]);

  const catalogCategories = useMemo(
    () => Array.from(new Set(recipeProducts.map((p) => p.category))).sort(),
    [recipeProducts]
  );

  const filteredRecipeProducts = useMemo(() => {
    return recipeProducts.filter((p) => {
      if (catalogCategory !== 'ALL' && p.category !== catalogCategory) return false;
      if (catalogSearch.trim()) {
        const q = catalogSearch.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          p.ingredients.some((i) => i.name.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [recipeProducts, catalogCategory, catalogSearch]);

  // Determinar si el empleado seleccionado tiene 2+ semanas en el Planificador y debe mostrar su Certificado Oficial directamente
  const showAutoVeteranCertificate =
    Boolean(selectedEmployee && selectedEmployee.auto_certified) &&
    !allowVeteranRetraining &&
    activeTab !== 'catalog';

  return (
    <div
      className="min-h-screen w-full text-[#0F172A] selection:bg-[#DA291C] selection:text-white"
      style={{
        backgroundColor: '#FFFAF5',
        colorScheme: 'light',
      }}
    >
      <audio
        ref={audioRef}
        onEnded={handleAudioEnded}
        onError={() => setIsVoiceSpeaking(false)}
        className="hidden"
      />

      {/* Input oculto para subir o reemplazar videos (.mp4 / .webm / .mov) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        onChange={handleVideoFileSelected}
        className="hidden"
      />

      {/* =====================================================================
          1. BARRA SUPERIOR RESPONSIVA (MÓVIL, TABLETA VERTICAL/HORIZONTAL Y PC)
         ===================================================================== */}
      <header className="sticky top-0 z-30 border-b-2 border-[#DA291C]/15 bg-white shadow-xs print:hidden">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#FFF5EB] border-2 border-[#FFC72C] flex items-center justify-center p-1.5 shrink-0">
              <img src="/logo.png" alt="Tacos Gavilan" className="w-full h-full object-contain" />
            </div>
            <div>
              <h1 className="text-lg sm:text-2xl font-black text-[#0F172A] tracking-tight leading-tight">
                {t('training.simple_title')} — Tacos Gavilan
              </h1>
              <p className="text-xs font-semibold text-slate-600 hidden sm:block">
                {t('training.simple_subtitle')}
              </p>
            </div>
          </div>

          {/* Botones de Acción Rápida */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Punto 6: Catálogo de Todos los Productos con Receta + Videos */}
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === 'catalog' ? 'day1' : 'catalog')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl text-xs sm:text-sm font-black border-2 transition-all cursor-pointer ${
                activeTab === 'catalog'
                  ? 'bg-[#DA291C] text-white border-[#DA291C]'
                  : 'bg-[#FFF8E7] hover:bg-[#FFC72C]/30 text-[#0F172A] border-[#FFC72C]'
              }`}
            >
              <Video className="w-4 h-4 text-[#DA291C] shrink-0" />
              <span>
                {t('training.all_recipe_products_tab', { count: recipeProducts.length })}
              </span>
            </button>

            {/* Punto 8: Botón para Imprimir la Lista de Artículos Vendidos (Control en Papel y Digital) */}
            <button
              type="button"
              onClick={() => setShowPrintableChecklistModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl text-xs sm:text-sm font-black bg-white hover:bg-[#FFF5EB] text-[#0F172A] border-2 border-slate-200 cursor-pointer transition-all"
            >
              <Printer className="w-4 h-4 text-[#DA291C] shrink-0" />
              <span>{t('training.print_items_checklist_btn')}</span>
            </button>

            {/* Portal Móvil / Kiosco */}
            <Link
              href={
                selectedStore
                  ? `/training/portal?store=${selectedStore.id}${
                      selectedEmployee ? `&emp=${selectedEmployee.id}` : ''
                    }`
                  : '/training/portal'
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl text-xs sm:text-sm font-bold bg-[#FFF5EB] hover:bg-[#FFE8D1] text-[#DA291C] border border-[#FED7AA] transition-all"
            >
              <ExternalLink className="w-4 h-4" />
              <span className="hidden md:inline">{t('training.btn_open_portal')}</span>
            </Link>

            <button
              type="button"
              onClick={() => setShowHowItWorksModal(true)}
              className="inline-flex items-center gap-1 px-3 py-2.5 rounded-2xl text-xs font-bold bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 cursor-pointer"
              title={t('training.how_it_works_btn')}
            >
              <HelpCircle className="w-4 h-4 text-[#DA291C]" />
            </button>

            {/* ES / EN Switch */}
            <div className="inline-flex rounded-2xl border-2 border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={() => setLanguage('es')}
                className={`px-2.5 py-1 rounded-xl text-xs font-black cursor-pointer ${
                  lang === 'es' ? 'bg-[#DA291C] text-white' : 'text-slate-600'
                }`}
              >
                ES
              </button>
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`px-2.5 py-1 rounded-xl text-xs font-black cursor-pointer ${
                  lang === 'en' ? 'bg-[#DA291C] text-white' : 'text-slate-600'
                }`}
              >
                EN
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-5 print:p-0">
        {/* =====================================================================
            2. BARRA LIMPIA CONECTADA AL PLANIFICADOR Y RONOS:
               SUCURSAL REAL + EMPLEADO + CLAVE RONOS + 6 ESTACIONES DEL PUESTO
           ===================================================================== */}
        <section className="bg-white rounded-3xl border-2 border-[#FED7AA] p-4 sm:p-5 shadow-xs space-y-3.5 print:hidden">
          {/* Fila 1: Filtro Rápido de Personal + Estado RONOS */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setEmployeeFilterMode('new_hires');
                  setSelectedEmployeeId('');
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer border transition-all ${
                  employeeFilterMode === 'new_hires'
                    ? 'bg-[#DA291C] text-white border-[#DA291C]'
                    : 'bg-[#FFF5EB] text-[#DA291C] border-[#FED7AA]'
                }`}
              >
                🆕 {t('training.filter_new_hires')} ({newHireStoreEmployees.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmployeeFilterMode('certified');
                  setSelectedEmployeeId('');
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer border transition-all ${
                  employeeFilterMode === 'certified'
                    ? 'bg-emerald-700 text-white border-emerald-700'
                    : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                }`}
              >
                🎓 {t('training.filter_veterans_certified')} ({certifiedStoreEmployees.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmployeeFilterMode('all');
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer border transition-all ${
                  employeeFilterMode === 'all'
                    ? 'bg-[#0F172A] text-white border-[#0F172A]'
                    : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                👥 {t('training.filter_all_employees')} ({storeEmployees.length})
              </button>
            </div>

            {ronosVerifiedInfo && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-900 text-xs font-black">
                <ShieldCheck className="w-4 h-4 text-emerald-700" />
                <span>
                  {t('training.ronos_verified_badge')}: {ronosVerifiedInfo.fullName} (
                  {ronosVerifiedInfo.ronosCode})
                </span>
              </div>
            )}
          </div>

          {/* Fila 2: 3 Controles Limpios (Sucursal + Empleado Planificador + Clave RONOS) */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            {/* 1. Sucursal Real */}
            <div className="md:col-span-3 flex items-center gap-2.5 bg-[#FFFAF5] border border-[#FED7AA] rounded-2xl px-3.5 py-2">
              <StoreIcon className="w-4 h-4 text-[#DA291C] shrink-0" />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[10px] font-extrabold uppercase text-slate-500">
                  {t('training.store_label')}
                </span>
                <select
                  value={selectedStoreId}
                  onChange={(e) => {
                    setSelectedStoreId(Number(e.target.value));
                    setSelectedEmployeeId('');
                    setRonosVerifiedInfo(null);
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

            {/* 2. Empleado Real del Planificador */}
            <div className="md:col-span-6 flex items-center gap-2.5 bg-[#FFFAF5] border border-[#FED7AA] rounded-2xl px-3.5 py-2">
              <UserCheck className="w-4 h-4 text-[#DA291C] shrink-0" />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[10px] font-extrabold uppercase text-slate-500">
                  {t('training.employee_planificador_label')} ({filteredStoreEmployees.length})
                </span>
                <select
                  value={selectedEmployeeId}
                  onChange={(e) => handleSelectPlanificadorEmployee(e.target.value)}
                  className="bg-transparent text-sm font-black text-[#0F172A] focus:outline-none cursor-pointer truncate"
                >
                  <option value="">{t('training.select_employee_option')}</option>
                  {filteredStoreEmployees.map((emp) => {
                    const jobLabel = emp.job_titles[0] || emp.assigned_station;
                    const badge = emp.is_new_hire
                      ? '🆕 NUEVO INGRESO'
                      : `🎓 CERTIFICADO (${emp.tenure_weeks} sem)`;
                    return (
                      <option key={emp.id} value={emp.id}>
                        {emp.full_name} — {jobLabel} [{badge}]
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {/* 3. Clave de 4 Dígitos de RONOS Sincronizada */}
            <form
              onSubmit={handleVerifyRonosPin}
              className="md:col-span-3 flex items-center gap-2 bg-[#FFF8E7] border border-[#FFC72C] rounded-2xl px-3 py-2"
            >
              <KeyRound className="w-4 h-4 text-[#DA291C] shrink-0" />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[10px] font-extrabold uppercase text-slate-600">
                  {t('training.ronos_pin_label')}
                </span>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={ronosPinInput}
                  onChange={(e) =>
                    setRonosPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))
                  }
                  placeholder="••••"
                  className="w-full bg-transparent text-sm font-mono font-black tracking-widest text-[#0F172A] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={ronosVerifyBusy || ronosPinInput.length !== 4}
                className="px-2.5 py-1 rounded-xl bg-[#0F172A] text-white text-xs font-black cursor-pointer disabled:opacity-40 shrink-0"
              >
                {ronosVerifyBusy ? '...' : 'OK'}
              </button>
            </form>
          </div>

          {/* Fila 3: Barra Compacta de Estaciones de Trabajo del Puesto */}
          <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-black uppercase text-slate-500 mr-1">
              {selectedEmployee
                ? lang === 'en'
                  ? `${selectedEmployee.job_role_badge_en}:`
                  : `${selectedEmployee.job_role_badge_es}:`
                : lang === 'en'
                ? 'Stations (4 Days):'
                : 'Estaciones (4 Días):'}
            </span>

            {roleRequiredStations.map((st) => {
              const isSelected = selectedPositionKey === st.stationKey;
              return (
                <button
                  key={st.stationKey}
                  type="button"
                  onClick={() => {
                    setSelectedPositionKey(st.stationKey);
                    const firstVidWithUrl = videos.find(
                      (v) =>
                        Boolean(v.videoUrl) &&
                        (st.stationKey === 'TORTAS/QUESADILLAS'
                          ? v.positionKey === 'TORTAS/QUESADILLAS' ||
                            v.positionKey === 'TORTAS/MULITAS'
                          : v.positionKey === st.stationKey)
                    );
                    if (firstVidWithUrl) {
                      setSelectedVideoSlug(firstVidWithUrl.slug);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-black transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#DA291C] text-white border-[#DA291C] shadow-xs'
                      : 'bg-[#FFFAF5] hover:bg-[#FFF0E5] text-[#0F172A] border-[#FED7AA]'
                  }`}
                >
                  {lang === 'en' ? st.labelEn : st.labelEs}
                </button>
              );
            })}
          </div>

          {ronosErrorMsg && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold">
              ⚠️ {ronosErrorMsg}
            </div>
          )}

          {/* Punto 4: Si hay un empleado seleccionado, mostrar barra para Enviar Link a su Email o Iniciar en la PC del Manager */}
          {selectedEmployee && (
            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm font-bold">
                <span className="text-[#0F172A] font-black">{selectedEmployee.full_name}</span>
                <span className="px-2.5 py-1 rounded-full bg-[#FFF8E7] border border-[#FFC72C] text-[#0F172A] text-xs font-black">
                  {lang === 'en'
                    ? selectedEmployee.job_role_title_en
                    : selectedEmployee.job_role_title_es}
                </span>
                {selectedEmployee.is_new_hire ? (
                  <span className="px-2.5 py-1 rounded-full bg-red-100 text-[#DA291C] text-xs font-black">
                    🆕 Nuevo Ingreso ({selectedEmployee.tenure_days} días en Planificador)
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-black">
                    🎓 Certificado Oficial ({selectedEmployee.tenure_weeks} semanas en Planificador)
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEmailInput(selectedEmployee.email || '');
                    setEmailFeedback(null);
                    setShowEmailModal(true);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#DA291C] hover:bg-[#B91C1C] text-white text-xs sm:text-sm font-black shadow-xs cursor-pointer transition-all"
                >
                  <Mail className="w-4 h-4" />
                  <span>{t('training.send_email_link_btn')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAllowVeteranRetraining(true);
                    setActiveTab('day1');
                    setDay1SubStep('video');
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white text-xs sm:text-sm font-black cursor-pointer transition-all"
                >
                  <Monitor className="w-4 h-4 text-[#FFC72C]" />
                  <span>{t('training.start_on_manager_pc_btn')}</span>
                </button>
              </div>
            </div>
          )}
        </section>

        {/* =====================================================================
            PUNTO 1 & 2: SI EL EMPLEADO YA TIENE 2+ SEMANAS EN EL PLANIFICADOR,
            MOSTRAR AUTOMÁTICAMENTE SU CERTIFICADO OFICIAL POR PUESTO Y ESTACIONES
           ===================================================================== */}
        {showAutoVeteranCertificate && selectedEmployee && (
          <section className="py-2">
            <OfficialCertificateView
              employeeName={selectedEmployee.full_name}
              storeName={selectedStore?.name || 'Lynwood'}
              stationName={
                (lang === 'en'
                  ? selectedEmployee.job_role_title_en
                  : selectedEmployee.job_role_title_es) ||
                selectedEmployee.job_titles[0] ||
                'Cocinero Certificado'
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
                selectedTrainerName.replace(/\s*\(.*\)/, '') ||
                'Gerente de Sucursal'
              }
              supervisorName={selectedStore?.supervisor_name}
              tenureWeeks={selectedEmployee.tenure_weeks}
              score={100}
              lang={lang}
              showRetrainingBtn={true}
              onEnableRetraining={() => {
                setAllowVeteranRetraining(true);
                setActiveTab('day1');
              }}
            />
          </section>
        )}

        {/* =====================================================================
            PUNTO 6: CATÁLOGO DE CATEGORÍAS CON RECETA Y VIDEO (BASE CARNE ASADA)
            (SUBIR, EDITAR O ELIMINAR VIDEO + VER RECETA OFICIAL)
           ===================================================================== */}
        {activeTab === 'catalog' && (
          <section className="bg-white rounded-3xl border-2 border-[#FFC72C] p-5 sm:p-7 shadow-xs space-y-5 print:hidden">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="px-3 py-1 rounded-full bg-[#FFF0E5] text-[#DA291C] text-xs font-black uppercase">
                  ENTRENAMIENTO ÁGIL POR CATEGORÍA (BASE CARNE ASADA)
                </span>
                <h2 className="text-xl sm:text-2xl font-black text-[#0F172A] mt-1">
                  Catálogo por Categoría y Video Base ({recipeProducts.length} Categorías Maestras)
                </h2>
                <p className="text-xs sm:text-sm font-semibold text-slate-600">
                  Cada categoría utiliza el platillo de Carne Asada como referencia maestra (el procedimiento es idéntico para las demás proteínas). Sube, reemplaza o elimina el video cuando cambie su procedimiento.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('day1')}
                className="px-4 py-2.5 rounded-2xl border-2 border-slate-200 text-xs sm:text-sm font-black text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                ← {t('training.back_to_video')}
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
                  placeholder="Buscar categoría o platillo (ej. Burrito Asada, Taco Asada, Torta, Quesadilla)..."
                  className="w-full pl-10 pr-4 py-3 rounded-2xl border-2 border-slate-200 bg-[#FFFAF5] text-sm font-bold"
                />
              </div>
              <div className="sm:col-span-5">
                <select
                  value={catalogCategory}
                  onChange={(e) => setCatalogCategory(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl border-2 border-slate-200 bg-[#FFFAF5] text-sm font-bold cursor-pointer"
                >
                  <option value="ALL">Todas las Categorías ({recipeProducts.length})</option>
                  {catalogCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Tarjetas de Categorías Maestras (Base Asada) con su Receta y Botones de Video */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredRecipeProducts.map((prod) => {
                const isUploading = uploadingVideoSlug === prod.slug;
                const isDeleting = deletingVideoSlug === prod.slug;
                return (
                  <div
                    key={prod.guid}
                    className="rounded-3xl bg-[#FFFAF5] border-2 border-[#FED7AA] p-4 flex flex-col justify-between gap-3.5"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-base font-black text-[#0F172A] leading-snug">
                            {prod.name}
                          </div>
                          <div className="text-xs font-bold text-[#DA291C]">
                            {prod.category} • {prod.positionKey}
                          </div>
                        </div>
                        {prod.hasVideo ? (
                          <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-black shrink-0">
                            🎬 Video Activo
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full bg-slate-200 text-slate-700 text-[11px] font-bold shrink-0">
                            Sin Video
                          </span>
                        )}
                      </div>

                      {/* Ingredientes Reales de la Receta Base (Asada) */}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {prod.ingredients.map((ing, i) => (
                          <span
                            key={i}
                            className="px-2.5 py-1 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-800"
                          >
                            <strong className="text-[#DA291C]">
                              {ing.quantity} {ing.unit}
                            </strong>{' '}
                            {ing.name}
                          </span>
                        ))}
                      </div>

                      {/* Proteínas / Variantes que cubre este mismo video */}
                      {prod.variantsIncluded && prod.variantsIncluded.length > 1 && (
                        <div className="p-2.5 rounded-2xl bg-[#FFF8E7] border border-[#FFC72C] text-[11px] font-bold text-slate-700 leading-snug">
                          <span className="text-[#DA291C] font-black">
                            📌 Mismo procedimiento para {prod.variantCount || prod.variantsIncluded.length} variantes (solo cambia la proteína):
                          </span>{' '}
                          {prod.variantsIncluded.join(', ')}
                        </div>
                      )}
                    </div>

                    {/* Botones de Acción: Ver / Subir / Cambiar / Eliminar Video */}
                    <div className="pt-2 border-t border-[#FED7AA] flex flex-wrap items-center gap-2">
                      {prod.hasVideo && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedVideoSlug(prod.slug);
                            setActiveTab('day1');
                            setDay1SubStep('video');
                          }}
                          className="flex-1 py-2 px-3 rounded-xl bg-[#DA291C] hover:bg-[#B91C1C] text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Ver Video y Pasos</span>
                        </button>
                      )}

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
                        className="py-2 px-3 rounded-xl bg-[#FFF8E7] hover:bg-[#FFC72C]/40 border border-[#FFC72C] text-[#0F172A] text-xs font-black flex items-center gap-1.5 cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5 text-[#DA291C]" />
                        <span>
                          {isUploading
                            ? 'Subiendo y Adaptando Voz IA...'
                            : prod.hasVideo
                            ? t('training.replace_video_btn')
                            : t('training.upload_video_btn')}
                        </span>
                      </button>

                      {prod.hasVideo && (
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => handleDeleteProductVideo(prod.slug)}
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

        {/* =====================================================================
            3. FLUJO DE ENTRENAMIENTO DE 4 DÍAS (PARA NUEVOS INGRESOS O PRÁCTICA)
           ===================================================================== */}
        {!showAutoVeteranCertificate && activeTab !== 'catalog' && (
          <>
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 print:hidden">
              {[
                {
                  id: 'day1' as const,
                  num: '1',
                  title: t('training.day1_short'),
                  desc: t('training.day1_short_desc'),
                  done: activeTrainee?.day1_completed,
                },
                {
                  id: 'day2' as const,
                  num: '2',
                  title: t('training.day2_short'),
                  desc: t('training.day2_short_desc'),
                  done: activeTrainee?.day2_completed,
                },
                {
                  id: 'day3' as const,
                  num: '3',
                  title: t('training.day3_short'),
                  desc: t('training.day3_short_desc'),
                  done: activeTrainee?.day3_completed,
                },
                {
                  id: 'day4' as const,
                  num: '4',
                  title: t('training.day4_short'),
                  desc: t('training.day4_short_desc'),
                  done: activeTrainee?.day4_completed,
                },
              ].map((dayCard) => {
                const isSelected = activeTab === dayCard.id;
                return (
                  <button
                    key={dayCard.id}
                    type="button"
                    onClick={() => setActiveTab(dayCard.id)}
                    className={`text-left p-3.5 sm:p-4 rounded-3xl border-2 transition-all cursor-pointer flex items-center gap-3 ${
                      isSelected
                        ? 'bg-[#DA291C] text-white border-[#DA291C] shadow-md'
                        : 'bg-white hover:bg-[#FFF5EB] text-[#0F172A] border-slate-200'
                    }`}
                  >
                    <div
                      className={`w-10 h-10 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center text-lg sm:text-xl font-black shrink-0 ${
                        isSelected
                          ? 'bg-[#FFC72C] text-[#0F172A]'
                          : dayCard.done
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-[#FFF0E5] text-[#DA291C]'
                      }`}
                    >
                      {dayCard.done ? <CheckCircle2 className="w-6 h-6" /> : dayCard.num}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm sm:text-base font-black leading-tight truncate">
                        {dayCard.title}
                      </div>
                      <div
                        className={`text-[11px] sm:text-xs font-medium mt-0.5 line-clamp-1 ${
                          isSelected ? 'text-white/90' : 'text-slate-500'
                        }`}
                      >
                        {dayCard.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </section>

            {/* VISTA DÍA 1: VIDEO LIMPIO SIN BARRA DE PROGRESO + PAUSAR PARA AGREGAR PASO CON VOZ IA */}
            {activeTab === 'day1' && currentVideo && (
              <div className="space-y-4">
                {/* Barra única de Sub-Pasos del Día 1 + Acciones de Video */}
                <div className="bg-white rounded-3xl border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {[
                      { id: 'video' as const, label: `🎬 ${t('training.substep_video')}` },
                      {
                        id: 'portions' as const,
                        label: `⚖️ ${t('training.substep_portions')} (${stationRecipeProducts.length})`,
                      },
                      { id: 'quiz' as const, label: `✅ ${t('training.substep_quiz')}` },
                    ].map((sub) => {
                      const active = day1SubStep === sub.id;
                      return (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => setDay1SubStep(sub.id)}
                          className={`px-4 py-2 rounded-2xl text-xs sm:text-sm font-black transition-all cursor-pointer ${
                            active
                              ? 'bg-[#0F172A] text-white shadow-xs'
                              : 'bg-[#FFFAF5] hover:bg-[#FFF0E5] text-slate-700 border border-slate-200'
                          }`}
                        >
                          {sub.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        triggerVideoUploadForProduct({
                          slug: currentVideo.slug,
                          name: currentVideo.titleEs,
                          positionKey: currentVideo.positionKey,
                          ingredients: currentVideo.recipeSpecs.map((r) => ({
                            name: r.itemEs,
                            quantity: Number(r.quantity) || 1,
                            unit: r.unit,
                          })),
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-extrabold bg-[#FFFAF5] hover:bg-[#FFF0E5] text-[#0F172A] border border-slate-200 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-[#DA291C]" />
                      <span>{t('training.replace_video_btn')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={openStepEditor}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-extrabold bg-[#FFF8E7] hover:bg-[#FFC72C]/30 text-[#B45309] border border-[#FFC72C] cursor-pointer"
                    >
                      <Wand2 className="w-4 h-4 text-[#DA291C]" />
                      {t('training.btn_edit_steps_ai')}
                    </button>
                  </div>
                </div>

                {day1SubStep === 'video' && (
                  <div className="grid grid-cols-1 md:landscape:grid-cols-12 lg:grid-cols-12 gap-5 items-start">
                    {/* Left 7 Cols: Reproductor de Video 100% Limpio (con selector de video integrado arriba) */}
                    <div className="md:landscape:col-span-7 lg:col-span-7 bg-white rounded-3xl border-2 border-slate-200 p-4 sm:p-5 shadow-xs space-y-3.5">
                      {/* Selector compacto de videos de la estación */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {stationVideos.map((vid) => {
                            const isCurrent = vid.slug === currentVideo.slug;
                            return (
                              <button
                                key={vid.slug}
                                type="button"
                                onClick={() => {
                                  setSelectedVideoSlug(vid.slug);
                                  setIsPlaying(false);
                                  setCurrentTime(0);
                                  setAutoPausedForVoice(false);
                                  lastSpokenStepIdRef.current = null;
                                  if (audioRef.current) audioRef.current.pause();
                                }}
                                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 border ${
                                  isCurrent
                                    ? 'bg-[#DA291C] text-white border-[#DA291C] shadow-xs'
                                    : 'bg-[#FFFAF5] hover:bg-[#FFF0E5] text-[#0F172A] border-slate-200'
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
                          className="text-[11px] font-extrabold text-[#DA291C] hover:underline cursor-pointer"
                        >
                          {showAllVideosInSelector
                            ? t('training.show_station_videos_only')
                            : t('training.show_all_9_videos')}
                        </button>
                      </div>

                      {/* Marco del Reproductor de Video (Mudo para escuchar únicamente la Voz IA del Tutor) */}
                      <div
                        ref={videoContainerRef}
                        className="relative rounded-2xl overflow-hidden bg-black aspect-video border-2 border-slate-900/10 select-none"
                      >
                        {currentVideo.videoUrl ? (
                          <video
                            key={currentVideo.videoUrl || currentVideo.slug}
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
                            onClick={togglePlayVideo}
                            playsInline
                            controls={false}
                            disablePictureInPicture
                            controlsList="nodownload nofullscreen noremoteplayback"
                            className="w-full h-full object-contain bg-black cursor-pointer"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-white p-6 text-center space-y-3">
                            <Video className="w-12 h-12 text-[#FFC72C]" />
                            <div className="text-base font-black">
                              Este producto aún no tiene video asignado
                            </div>
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
                              Subir Video para {currentVideo.titleEs}
                            </button>
                          </div>
                        )}

                        {/* PUNTO 9: Cuando el video se pausa por la explicación del paso (autoPausedForVoice),
                            NO mostrar ningún control del reproductor sobre el video */}
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
                                  <span>{lang === 'es' ? 'Pausar' : 'Pause'}</span>
                                </>
                              ) : (
                                <>
                                  <Play className="w-4 h-4 fill-current" />
                                  <span>{lang === 'es' ? 'Reproducir' : 'Play'}</span>
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

                      {/* Barra Única de Controles debajo del Video (sin duplicados) */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
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
                                <span>{t('training.big_pause_btn')}</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-4 h-4 fill-current" />
                                <span>{t('training.big_play_btn')}</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              if (currentStep) jumpToStep(currentStep);
                            }}
                            className="px-3.5 py-2.5 rounded-xl text-xs font-black bg-[#FFF8E7] hover:bg-[#FFC72C]/40 text-[#0F172A] border border-[#FFC72C] flex items-center gap-1.5 cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5 text-[#DA291C]" />
                            <span>{t('training.listen_again_btn')}</span>
                          </button>

                          <button
                            type="button"
                            onClick={handlePauseToAddStepHere}
                            className="px-3.5 py-2.5 rounded-xl bg-[#FFF0E5] hover:bg-[#FED7AA]/60 text-[#DA291C] border border-[#FED7AA] text-xs font-black flex items-center gap-1.5 cursor-pointer"
                          >
                            <PlusCircle className="w-3.5 h-3.5" />
                            <span>{t('training.pause_add_step_btn')}</span>
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
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
                            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black border cursor-pointer ${
                              voiceEnabled
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                : 'bg-slate-100 text-slate-600 border-slate-300'
                            }`}
                          >
                            {voiceEnabled ? (
                              <Volume2 className="w-4 h-4 text-emerald-600" />
                            ) : (
                              <VolumeX className="w-4 h-4 text-slate-500" />
                            )}
                            <span>
                              {voiceEnabled
                                ? t('training.player_voice_active')
                                : t('training.player_voice_muted')}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={handleToggleFullscreen}
                            className="p-2 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white cursor-pointer"
                            title={t('training.fullscreen_btn')}
                          >
                            <Maximize2 className="w-4 h-4 text-[#FFC72C]" />
                          </button>
                        </div>
                      </div>

                      {/* Formulario Inline al Pausar Video para Agregar Paso con Texto -> Voz IA */}
                      {showAddStepAtPauseBox && (
                        <form
                          onSubmit={handleSavePausedStepWithAiVoice}
                          className="p-4 rounded-2xl bg-[#FFF8E7] border-2 border-[#FFC72C] space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-black uppercase text-[#DA291C]">
                              🎙️ Nuevo Paso con Voz IA (Orus) en este punto del video
                            </span>
                            <button
                              type="button"
                              onClick={() => setShowAddStepAtPauseBox(false)}
                              className="text-xs font-black text-slate-500 cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <input
                              type="text"
                              value={newStepTitle}
                              onChange={(e) => setNewStepTitle(e.target.value)}
                              placeholder="Título corto del paso (ej. Doblar laterales)"
                              className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-bold"
                            />
                            <input
                              type="text"
                              value={newStepPortion}
                              onChange={(e) => setNewStepPortion(e.target.value)}
                              placeholder="Medida o regla clave (ej. 6 oz Carne Asada)"
                              className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-bold"
                            />
                          </div>

                          <textarea
                            rows={2}
                            required
                            value={newStepNarration}
                            onChange={(e) => setNewStepNarration(e.target.value)}
                            placeholder="Escribe aquí la explicación del paso... Al guardar se convertirá automáticamente en la Voz IA masculina (Orus)."
                            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold"
                          />

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
                                ? 'Generando Voz IA...'
                                : `💾 ${t('training.save_step_ai_voice_btn')}`}
                            </button>
                          </div>
                        </form>
                      )}
                    </div>

                    {/* Right 5 Cols: Tarjeta Limpia del Paso Actual */}
                    <div className="md:landscape:col-span-5 lg:col-span-5 bg-white rounded-3xl border-2 border-[#FFC72C] p-5 space-y-4">
                      <div className="space-y-2">
                        <div className="text-xs font-black uppercase text-slate-500">
                          {lang === 'es'
                            ? 'Pasos del Procedimiento (Toca para escuchar):'
                            : 'Procedure Steps (Tap to listen):'}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {currentVideo.steps.map((st, idx) => {
                            const isActive = idx === currentStepIndex;
                            return (
                              <button
                                key={st.id}
                                type="button"
                                onClick={() => jumpToStep(st)}
                                className={`w-10 h-10 rounded-2xl text-sm font-black transition-all cursor-pointer border-2 ${
                                  isActive
                                    ? 'bg-[#DA291C] text-white border-[#DA291C] shadow-xs scale-105'
                                    : 'bg-[#FFFAF5] hover:bg-[#FFF0E5] text-[#0F172A] border-slate-200'
                                }`}
                              >
                                {st.stepNumber}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {currentStep && (
                        <div className="rounded-2xl bg-[#FFFDF9] border-2 border-[#FED7AA] p-4 sm:p-5 space-y-3.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="px-3 py-1 rounded-full bg-[#DA291C] text-white text-xs font-black uppercase">
                              {t('training.player_step_of', {
                                current: currentStep.stepNumber,
                                total: currentVideo.steps.length,
                              })}
                            </span>
                            {isVoiceSpeaking && (
                              <span className="inline-flex items-center gap-1.5 text-xs font-black text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                                <Volume2 className="w-4 h-4 animate-bounce" />
                                {lang === 'es' ? 'Voz IA explicando...' : 'AI Voice speaking...'}
                              </span>
                            )}
                          </div>

                          <h3 className="text-lg sm:text-xl font-black text-[#0F172A] leading-snug">
                            {lang === 'en' ? currentStep.titleEn : currentStep.titleEs}
                          </h3>

                          <p className="text-sm sm:text-base font-bold text-slate-800 leading-relaxed bg-white p-3.5 rounded-2xl border border-slate-200">
                            “{lang === 'en' ? currentStep.narrationEn : currentStep.narrationEs}”
                          </p>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {currentStep.keyPortionEs && (
                              <div className="p-2.5 rounded-2xl bg-[#FFF8E7] border border-[#FFC72C] flex items-center gap-2">
                                <Scale className="w-4 h-4 text-[#DA291C] shrink-0" />
                                <div className="text-xs font-black text-[#0F172A]">
                                  {lang === 'en'
                                    ? currentStep.keyPortionEn
                                    : currentStep.keyPortionEs}
                                </div>
                              </div>
                            )}
                            {currentStep.utensilEs && (
                              <div className="p-2.5 rounded-2xl bg-[#FFF0E5] border border-[#FED7AA] flex items-center gap-2">
                                <Thermometer className="w-4 h-4 text-[#DA291C] shrink-0" />
                                <div className="text-xs font-black text-[#0F172A]">
                                  {lang === 'en'
                                    ? currentStep.utensilEn
                                    : currentStep.utensilEs}
                                </div>
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
                          className="py-3 px-4 rounded-2xl border-2 border-slate-200 bg-[#FFFAF5] hover:bg-slate-100 disabled:opacity-40 text-xs sm:text-sm font-black text-[#0F172A] flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <ChevronLeft className="w-4 h-4" />
                          {t('training.prev_step_btn')}
                        </button>

                        <button
                          type="button"
                          disabled={currentStepIndex >= currentVideo.steps.length - 1}
                          onClick={() => {
                            const next = currentVideo.steps[currentStepIndex + 1];
                            if (next) jumpToStep(next);
                          }}
                          className="py-3 px-4 rounded-2xl bg-[#0F172A] hover:bg-slate-800 disabled:opacity-40 text-xs sm:text-sm font-black text-white flex items-center justify-center gap-1 cursor-pointer"
                        >
                          {t('training.next_step_btn')}
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => setDay1SubStep('portions')}
                        className="w-full py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-black shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <span>{t('training.next_go_to_portions')}</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {day1SubStep === 'portions' && (
                  <div className="space-y-5">
                    <div className="bg-white rounded-3xl border-2 border-[#FFC72C] p-6 space-y-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-xl sm:text-2xl font-black text-[#0F172A]">
                          {t('training.recipe_specs_title')} —{' '}
                          {lang === 'en' ? currentVideo.titleEn : currentVideo.titleEs}
                        </h3>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setDay1SubStep('video')}
                            className="px-4 py-2 rounded-2xl border-2 border-slate-200 text-xs sm:text-sm font-black text-slate-700 cursor-pointer"
                          >
                            ← {t('training.back_to_video')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDay1SubStep('quiz')}
                            className="px-4 py-2 rounded-2xl bg-emerald-600 text-white text-xs sm:text-sm font-black cursor-pointer"
                          >
                            {t('training.next_go_to_quiz')} →
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {currentVideo.recipeSpecs.map((spec, idx) => (
                          <div
                            key={idx}
                            className="rounded-3xl bg-[#FFFAF5] border-2 border-[#FED7AA] p-5 flex flex-col justify-between gap-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="text-base sm:text-lg font-black text-[#0F172A]">
                                {lang === 'en' ? spec.itemEn : spec.itemEs}
                              </div>
                              <span className="px-3.5 py-1.5 rounded-2xl bg-[#DA291C] text-white text-sm sm:text-base font-black shrink-0">
                                {spec.quantity} {spec.unit}
                              </span>
                            </div>
                            <div className="text-xs sm:text-sm font-bold text-slate-700 bg-white px-3.5 py-2 rounded-2xl border border-slate-200">
                              🥄 {lang === 'en' ? spec.utensilEn : spec.utensilEs}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* PRODUCTOS DE LAS RECETAS AL INTERIOR DE ESTA ESTACIÓN DE TRABAJO (MOVIDO AQUÍ PARA EVITAR RUIDO DEBAJO DEL VIDEO) */}
                    {stationRecipeProducts.length > 0 && (
                      <div className="bg-white rounded-3xl border-2 border-[#FED7AA] p-5 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <span className="px-3 py-1 rounded-full bg-[#FFF5EB] border border-[#FFC72C] text-[#DA291C] text-[11px] font-black uppercase">
                              CATEGORÍAS DE LA ESTACIÓN (BASE CARNE ASADA):{' '}
                              {currentPosition?.labelEs || selectedPositionKey}
                            </span>
                            <h3 className="text-lg sm:text-xl font-black text-[#0F172A] mt-1">
                              🍲 Categorías y Recetas Base de esta Estación ({stationRecipeProducts.length})
                            </h3>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <div className="relative">
                              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                              <input
                                type="text"
                                value={catalogSearch}
                                onChange={(e) => setCatalogSearch(e.target.value)}
                                placeholder={
                                  lang === 'es' ? 'Filtrar platillo...' : 'Filter dish...'
                                }
                                className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 bg-[#FFFAF5] text-xs font-bold"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowPrintableChecklistModal(true)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#FFF8E7] border border-[#FFC72C] text-xs font-black text-[#0F172A] cursor-pointer"
                            >
                              <Printer className="w-4 h-4 text-[#DA291C]" />
                              <span>Imprimir Lista</span>
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[540px] overflow-y-auto pr-1">
                          {stationRecipeProducts
                            .filter(
                              (prod) =>
                                !catalogSearch.trim() ||
                                prod.name.toLowerCase().includes(catalogSearch.trim().toLowerCase())
                            )
                            .map((prod) => {
                              const isUploading = uploadingVideoSlug === prod.slug;
                              return (
                                <div
                                  key={prod.guid}
                                  className="rounded-2xl bg-[#FFFAF5] border border-[#FED7AA] p-3.5 flex flex-col justify-between gap-2.5"
                                >
                                  <div>
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="text-sm font-black text-[#0F172A]">
                                        {prod.name}
                                      </div>
                                      {prod.hasVideo ? (
                                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black shrink-0">
                                          🎬 Video
                                        </span>
                                      ) : (
                                        <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold shrink-0">
                                          Receta
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex flex-wrap gap-1 mt-2">
                                      {prod.ingredients.map((ing, i) => (
                                        <span
                                          key={i}
                                          className="px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-800"
                                        >
                                          <strong className="text-[#DA291C]">
                                            {ing.quantity} {ing.unit}
                                          </strong>{' '}
                                          {ing.name}
                                        </span>
                                      ))}
                                    </div>
                                    {prod.variantsIncluded && prod.variantsIncluded.length > 1 && (
                                      <div className="mt-2 p-2 rounded-xl bg-[#FFF8E7] border border-[#FFC72C] text-[10px] font-bold text-slate-700 leading-snug">
                                        <span className="text-[#DA291C] font-black">
                                          Cubre {prod.variantCount || prod.variantsIncluded.length} variantes:
                                        </span>{' '}
                                        {prod.variantsIncluded.join(', ')}
                                      </div>
                                    )}
                                  </div>

                                  <div className="pt-2 border-t border-[#FED7AA]/60 flex items-center gap-1.5">
                                    {prod.hasVideo && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedVideoSlug(prod.slug);
                                          setDay1SubStep('video');
                                          setIsPlaying(false);
                                          setCurrentTime(0);
                                        }}
                                        className="flex-1 py-1.5 px-2.5 rounded-xl bg-[#DA291C] text-white text-xs font-black flex items-center justify-center gap-1 cursor-pointer"
                                      >
                                        <Play className="w-3 h-3 fill-current" />
                                        <span>Ver Video</span>
                                      </button>
                                    )}
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
                                      className="py-1.5 px-2.5 rounded-xl bg-white border border-[#FFC72C] text-[#0F172A] text-xs font-black flex items-center gap-1 cursor-pointer"
                                    >
                                      <Upload className="w-3 h-3 text-[#DA291C]" />
                                      <span>
                                        {isUploading
                                          ? '...'
                                          : prod.hasVideo
                                          ? 'Cambiar Video'
                                          : 'Subir Video'}
                                      </span>
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {day1SubStep === 'quiz' && (
                  <div className="bg-white rounded-3xl border-2 border-[#FFC72C] p-6 space-y-5">
                    <h3 className="text-xl sm:text-2xl font-black text-[#0F172A]">
                      {t('training.quiz_day1_title')}
                    </h3>
                    <div className="space-y-4">
                      {currentVideo.quiz.map((q, qIdx) => (
                        <div
                          key={q.id}
                          className="p-4 sm:p-5 rounded-3xl bg-[#FFFAF5] border-2 border-slate-200 space-y-3"
                        >
                          <div className="text-base font-black text-[#0F172A]">
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
                                  className={`text-left p-3.5 rounded-2xl border-2 text-sm font-bold cursor-pointer ${
                                    isSelected
                                      ? 'bg-[#DA291C] text-white border-[#DA291C]'
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
                      onClick={handleGradeDay1Quiz}
                      className="px-7 py-3.5 rounded-2xl bg-[#DA291C] text-white text-sm sm:text-base font-black cursor-pointer"
                    >
                      ✅ {t('training.quiz_submit_btn')}
                    </button>
                    {quizSubmittedResult && (
                      <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-900 font-black text-sm">
                        {quizSubmittedResult.passed
                          ? t('training.quiz_passed_msg', { score: quizSubmittedResult.score })
                          : t('training.quiz_failed_msg', { score: quizSubmittedResult.score })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* VISTA DÍA 2 */}
            {activeTab === 'day2' && currentPosition && (
              <div className="max-w-4xl mx-auto bg-white rounded-3xl border-2 border-[#FFC72C] p-6 space-y-5">
                <h3 className="text-2xl font-black text-[#0F172A]">{t('training.day2_title')}</h3>
                <div className="rounded-3xl bg-[#FFF9F2] border-2 border-[#FED7AA] p-5 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-extrabold uppercase text-slate-500">
                      {t('training.day2_reps_title')}
                    </div>
                    <div className="text-3xl font-black text-[#DA291C]">
                      {day2Reps} / {currentPosition.day2TargetReps}
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setDay2Reps((r) => Math.max(0, r - 1))}
                      className="w-11 h-11 rounded-2xl bg-white border-2 border-slate-200 flex items-center justify-center cursor-pointer"
                    >
                      <Minus className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDay2Reps((r) => r + 1)}
                      className="px-5 py-3 rounded-2xl bg-[#DA291C] text-white font-black text-sm flex items-center gap-2 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      {t('training.add_one_dish_btn')}
                    </button>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {currentVideo?.steps.map((st) => {
                    const key = `step-${st.id}`;
                    const checked = !!day2Rubric[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() =>
                          setDay2Rubric((prev) => ({ ...prev, [key]: !prev[key] }))
                        }
                        className={`w-full text-left flex items-center gap-3.5 p-3.5 rounded-2xl border-2 cursor-pointer ${
                          checked
                            ? 'bg-emerald-50 border-emerald-400 text-emerald-950'
                            : 'bg-[#FFFAF5] border-slate-200 text-[#0F172A]'
                        }`}
                      >
                        <div
                          className={`w-7 h-7 rounded-xl flex items-center justify-center font-black shrink-0 ${
                            checked ? 'bg-emerald-600 text-white' : 'bg-white border-2 border-slate-300 text-transparent'
                          }`}
                        >
                          ✓
                        </div>
                        <div className="text-sm font-black">
                          Paso {st.stepNumber}: {lang === 'en' ? st.titleEn : st.titleEs}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={handleCompleteDay2}
                  className="w-full py-4 rounded-2xl bg-emerald-600 text-white text-base font-black cursor-pointer"
                >
                  ✅ {t('training.day2_complete_btn')}
                </button>
                {day2SavedBanner && (
                  <div className="p-3 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-bold text-center">
                    ✅ Día 2 guardado exitosamente.
                  </div>
                )}
              </div>
            )}

            {/* VISTA DÍA 3 */}
            {activeTab === 'day3' && currentPosition && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                <div className="lg:col-span-5 bg-white rounded-3xl border-2 border-[#FFC72C] p-6 space-y-4 text-center">
                  <h3 className="text-xl font-black text-[#0F172A] flex items-center justify-center gap-2">
                    <Timer className="w-5 h-5 text-[#DA291C]" />
                    {t('training.day3_stopwatch_title')}
                  </h3>
                  <div className="rounded-3xl bg-[#FFF9F2] border-2 border-[#FED7AA] p-6 space-y-4">
                    <div className="text-5xl font-black font-mono text-[#0F172A]">
                      {formatSeconds(Math.floor(stopwatchElapsedDeci / 10))}
                      <span className="text-2xl text-[#DA291C]">.{stopwatchElapsedDeci % 10}s</span>
                    </div>
                    {!stopwatchRunning ? (
                      <button
                        type="button"
                        onClick={() => setStopwatchRunning(true)}
                        className="w-full py-3.5 rounded-2xl bg-[#DA291C] text-white text-base font-black cursor-pointer"
                      >
                        ▶ {t('training.day3_start_timer')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleStopAndRecordStopwatch}
                        className="w-full py-3.5 rounded-2xl bg-emerald-600 text-white text-base font-black cursor-pointer"
                      >
                        ⏹ {t('training.day3_stop_record')}
                      </button>
                    )}
                  </div>
                </div>

                <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200 p-6 space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    {(['Apertura', 'Regular', 'Cierre'] as const).map((sTab) => (
                      <button
                        key={sTab}
                        type="button"
                        onClick={() => setDay3ShiftTab(sTab)}
                        className={`py-2.5 px-3 rounded-2xl text-xs font-black cursor-pointer border-2 ${
                          day3ShiftTab === sTab
                            ? 'bg-[#0F172A] text-white border-[#0F172A]'
                            : 'bg-[#FFFAF5] text-slate-700 border-slate-200'
                        }`}
                      >
                        {sTab} ({groupedActivities[sTab].length})
                      </button>
                    ))}
                  </div>
                  <div className="space-y-2">
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
                          className={`w-full text-left flex items-center justify-between p-3.5 rounded-2xl border-2 cursor-pointer ${
                            checked
                              ? 'bg-emerald-50 border-emerald-400 text-emerald-950'
                              : 'bg-[#FFFAF5] border-slate-200 text-[#0F172A]'
                          }`}
                        >
                          <span className="text-sm font-bold">{act.name}</span>
                          <span className="text-xs font-bold text-slate-500">{act.time}</span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={handleCompleteDay3}
                    className="w-full py-3.5 rounded-2xl bg-emerald-600 text-white text-base font-black cursor-pointer"
                  >
                    ✅ {t('training.day3_complete_btn')}
                  </button>
                </div>
              </div>
            )}

            {/* VISTA DÍA 4: CERTIFICADO OFICIAL EJECUTIVO IMPRIMIBLE */}
            {activeTab === 'day4' && currentPosition && (
              <div className="space-y-6">
                <div className="max-w-4xl mx-auto bg-white rounded-3xl border-2 border-[#FFC72C] p-6 space-y-5 print:hidden">
                  <h3 className="text-2xl font-black text-[#0F172A]">
                    {t('training.day4_practical_title')} ({currentPosition.positionKey})
                  </h3>
                  <button
                    type="button"
                    onClick={handleIssueDay4Certification}
                    className="w-full py-4 rounded-2xl bg-[#DA291C] hover:bg-[#B91C1C] text-white text-base font-black cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Award className="w-5 h-5 text-[#FFC72C]" />
                    {t('training.day4_certify_btn')}
                  </button>
                </div>

                <OfficialCertificateView
                  employeeName={
                    selectedEmployee?.full_name ||
                    activeTrainee?.employee_name ||
                    'Colaborador Certificado'
                  }
                  storeName={selectedStore?.name || 'Lynwood'}
                  stationName={
                    (lang === 'en'
                      ? selectedEmployee?.job_role_title_en
                      : selectedEmployee?.job_role_title_es) ||
                    'Cocinero Certificado (Todas las Estaciones de Cocina)'
                  }
                  jobRoleTitle={
                    lang === 'en'
                      ? selectedEmployee?.job_role_title_en
                      : selectedEmployee?.job_role_title_es
                  }
                  certifiedStations={roleRequiredStations}
                  folio={
                    certificationResult?.folio ||
                    selectedEmployee?.certificate_folio ||
                    `TG-CERT-2026-S${selectedStore?.id || 14}`
                  }
                  managerName={
                    selectedStore?.managers?.[0]?.fullName ||
                    selectedTrainerName.replace(/\s*\(.*\)/, '') ||
                    'Gerente de Sucursal'
                  }
                  supervisorName={selectedStore?.supervisor_name}
                  tenureWeeks={selectedEmployee?.tenure_weeks}
                  score={certificationResult?.combinedScore || 100}
                  lang={lang}
                />
              </div>
            )}
          </>
        )}
      </main>

      {/* =====================================================================
          MODAL: ENVIAR LINK DE CAPACITACIÓN POR EMAIL AL EMPLEADO (PUNTO 4)
         ===================================================================== */}
      {showEmailModal && selectedEmployee && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-3xl border-2 border-[#FFC72C] max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-[#0F172A] flex items-center gap-2">
                <Mail className="w-5 h-5 text-[#DA291C]" />
                <span>Enviar Capacitación por Email</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowEmailModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-black cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs sm:text-sm font-semibold text-slate-600">
              Se enviará el enlace directo a <strong>{selectedEmployee.full_name}</strong> para que abra su entrenamiento desde su teléfono e ingrese con su <strong>clave de 4 dígitos de RONOS</strong>.
            </p>

            <form onSubmit={handleSendTrainingEmail} className="space-y-3">
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 mb-1">
                  Correo Electrónico del Empleado:
                </label>
                <input
                  type="email"
                  required
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="ejemplo@correo.com"
                  className="w-full px-4 py-3 rounded-2xl border-2 border-slate-200 bg-[#FFFAF5] text-sm font-bold"
                />
              </div>

              {emailFeedback && (
                <div
                  className={`p-3 rounded-2xl text-xs font-bold ${
                    emailFeedback.ok
                      ? 'bg-emerald-50 border border-emerald-300 text-emerald-900'
                      : 'bg-red-50 border border-red-200 text-red-700'
                  }`}
                >
                  {emailFeedback.msg}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEmailModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer"
                >
                  Cerrar
                </button>
                <button
                  type="submit"
                  disabled={sendingEmailBusy || !emailInput.trim()}
                  className="px-5 py-2.5 rounded-xl bg-[#DA291C] hover:bg-[#B91C1C] text-white text-xs font-black cursor-pointer disabled:opacity-40"
                >
                  {sendingEmailBusy ? 'Enviando Correo...' : '📧 Enviar Link a su Email'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: LISTA MAESTRA IMPRIMIBLE DE ARTÍCULOS VENDIDOS CON RECETA (PUNTO 8)
         ===================================================================== */}
      <PrintableRecipeChecklistModal
        isOpen={showPrintableChecklistModal}
        onClose={() => setShowPrintableChecklistModal(false)}
        recipeProducts={recipeProducts}
        storeName={selectedStore?.name || 'Lynwood'}
        employeeName={selectedEmployee?.full_name || ''}
        trainerName={selectedTrainerName}
        lang={lang}
      />

      {/* MODAL SELECTOR DE ESTACIÓN */}
      {showStationModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-3xl border-2 border-[#FFC72C] max-w-3xl w-full max-h-[85vh] flex flex-col p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-[#0F172A]">
                {t('training.section_groups_title')}
              </h3>
              <button
                type="button"
                onClick={() => setShowStationModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-black cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'cocina' as const, label: t('training.group_cocina'), icon: ChefHat },
                { id: 'salon' as const, label: t('training.group_salon'), icon: Users },
                { id: 'drive_thru' as const, label: t('training.group_drive_thru'), icon: Car },
                { id: 'liderazgo' as const, label: t('training.group_liderazgo'), icon: Crown },
              ].map((grp) => {
                const Icon = grp.icon;
                const isSelected = selectedGroup === grp.id;
                return (
                  <button
                    key={grp.id}
                    type="button"
                    onClick={() => setSelectedGroup(grp.id)}
                    className={`p-3 rounded-2xl text-xs font-black flex flex-col items-center gap-1 cursor-pointer border-2 ${
                      isSelected
                        ? 'bg-[#DA291C] text-white border-[#DA291C]'
                        : 'bg-[#FFFAF5] text-[#0F172A] border-slate-200'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-center">{grp.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2.5 pr-1">
              {groupPositions.map((pos) => (
                <button
                  key={pos.positionKey}
                  type="button"
                  onClick={() => {
                    setSelectedPositionKey(pos.positionKey);
                    setShowStationModal(false);
                  }}
                  className="text-left p-3.5 rounded-2xl border-2 border-slate-200 hover:bg-[#FFF0E5] cursor-pointer flex items-center justify-between"
                >
                  <div>
                    <div className="text-sm font-black text-[#0F172A]">
                      {lang === 'en' ? pos.labelEn : pos.labelEs}
                    </div>
                    <div className="text-xs text-slate-500 line-clamp-1">
                      {lang === 'en' ? pos.shortDescEn : pos.shortDescEs}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#DA291C]" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL ¿CÓMO FUNCIONA? */}
      {showHowItWorksModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-3xl border-2 border-[#FFC72C] max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <h3 className="text-lg font-black text-[#0F172A]">
                {t('training.boss_question_title')}
              </h3>
              <button
                type="button"
                onClick={() => setShowHowItWorksModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-black cursor-pointer"
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-slate-700">{t('training.boss_question_desc')}</p>
            <button
              type="button"
              onClick={() => setShowHowItWorksModal(false)}
              className="w-full py-3 rounded-2xl bg-[#DA291C] text-white text-sm font-black cursor-pointer"
            >
              ¡Entendido!
            </button>
          </div>
        </div>
      )}

      {/* MODAL EDITOR DE PASOS Y VOZ IA */}
      {showStepEditorModal && currentVideo && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-3xl border-2 border-[#FFC72C] max-w-3xl w-full max-h-[88vh] flex flex-col p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-[#0F172A]">
                Editar Pasos y Voz IA (Orus) — {currentVideo.titleEs}
              </h3>
              <button
                type="button"
                onClick={() => setShowStepEditorModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-black cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto space-y-3 pr-1 flex-1">
              {editableSteps.map((st, idx) => (
                <div
                  key={st.id}
                  className="p-4 rounded-2xl bg-[#FFFAF5] border border-slate-200 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-black text-[#DA291C]">
                      Paso {st.stepNumber} ({st.timestampLabel}): {st.titleEs}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={aiGeneratingStepIdx === idx}
                        onClick={() => handleAiRefineStep(idx)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[#FFF8E7] border border-[#FFC72C] text-xs font-extrabold text-[#0F172A] cursor-pointer"
                      >
                        <Wand2 className="w-3.5 h-3.5 text-[#DA291C]" />
                        {aiGeneratingStepIdx === idx
                          ? 'Generando...'
                          : t('training.player_regenerate_ai')}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setEditableSteps((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="p-1.5 rounded-lg bg-red-50 text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={2}
                    value={lang === 'en' ? st.narrationEn : st.narrationEs}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditableSteps((prev) => {
                        const next = [...prev];
                        next[idx] = {
                          ...next[idx],
                          narrationEs: val,
                          narrationEn: val,
                        };
                        return next;
                      });
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-semibold bg-white"
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
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
                className="px-5 py-2 rounded-xl bg-[#DA291C] text-white text-xs font-black cursor-pointer"
              >
                {savingStepsBusy ? 'Convirtiendo a Voz IA...' : t('training.save_step_ai_voice_btn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
