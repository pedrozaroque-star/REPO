/**
 * @module components/StaffEvaluationForm
 * @description Formulario interactivo para la captura de evaluaciones de desempeño de personal (STAFF y Corporativo).
 * Permite registrar evaluaciones tanto de personal de sucursal (Cajeros, Cocineros, Managers) como de soporte corporativo
 * (Recursos Humanos / RRHH, Bodega Central, Mantenimiento, Administración / Oficina y puestos personalizados).
 * @businessRules
 * - La jornada laboral inicia a las 6:00 AM y termina a las 5:59 AM del día siguiente.
 * - Puestos de línea u operativos omiten por defecto las preguntas de liderazgo (Sección 2).
 * - Puestos con mando o de supervisión/RRHH evalúan las 5 secciones completas (25 criterios).
 * - El evaluador puede activar/desactivar explícitamente la evaluación de liderazgo para cualquier puesto.
 * - Soporta selección de 'Oficina Central / Corporativo' (store_id = null, location_name asignado) o las 15 sucursales.
 * - Cada pregunta se califica de 1 a 5 estrellas. El desempeño general se puntúa de 1 a 10.
 * - Se almacena en columnas estructuradas (q1_1 a q5_5) y en JSONB 'answers' para trazabilidad.
 * @dataFlow
 * - Carga tiendas ('stores') -> Carga plantilla ('staff_evaluation_v1') -> Captura -> Supabase ('staff_evaluations').
 * @notes
 * - La columna 'store_id' es NULLABLE para permitir personal corporativo sin violar FK hacia 'stores'.
 * - 100% bilingüe (ES / EN) integrado con useLanguage().
 */

'use client'

import React, { useState, useEffect } from 'react'
import {
    MapPin, Send, CheckCircle2, User, UserCheck, Briefcase,
    Star, Camera, Sparkles, AlertCircle, RefreshCw, ThumbsUp, ThumbsDown,
    Building2, ShieldCheck, ToggleLeft, ToggleRight
} from 'lucide-react'
import { getSupabaseClient, formatStoreName } from '@/lib/supabase'
import { useDynamicChecklist } from '@/hooks/useDynamicChecklist'
import DynamicQuestion from '@/components/checklists/DynamicQuestion'
import SurpriseLoader from '@/components/SurpriseLoader'
import { useLanguage } from '@/lib/i18n'
import { EVALUATION_SECTIONS } from './StaffEvaluationReviewModal'

export const STORE_ROLES = [
    'Cajero(a)',
    'Cocinero',
    'Shift Leader',
    'Asistente',
    'Manager',
    'Supervisor'
]

export const CORPORATE_ROLES = [
    'Recursos Humanos (RRHH)',
    'Bodega Central',
    'Mantenimiento',
    'Administración / Oficina',
    'Otro'
]

export const STAFF_ROLES = [
    ...STORE_ROLES,
    ...CORPORATE_ROLES
]

const DEFAULT_LEAD_ROLES = new Set([
    'shift leader',
    'asistente',
    'manager',
    'supervisor',
    'recursos humanos (rrhh)',
    'recursos humanos',
    'rrhh'
])

export const isLeadRole = (role: string): boolean => {
    return DEFAULT_LEAD_ROLES.has((role || '').toLowerCase().trim())
}

interface Store {
    id: string
    name: string
    latitude: number | null
    longitude: number | null
    address?: string
    city?: string
}

interface StaffEvaluationFormProps {
    preselectedStoreId?: string
    onCompleted?: (newEvaluation: any) => void
    isKioskMode?: boolean
}

export default function StaffEvaluationForm({
    preselectedStoreId,
    onCompleted,
    isKioskMode = false
}: StaffEvaluationFormProps) {
    const { t, language } = useLanguage()
    const isEs = language === 'es'

    const [stores, setStores] = useState<Store[]>([])
    const [selectedStore, setSelectedStore] = useState<string>(preselectedStoreId || '')
    const [detectingLocation, setDetectingLocation] = useState(false)
    const [gpsDone, setGpsDone] = useState(false)
    const [loading, setLoading] = useState(false)
    const [showThanks, setShowThanks] = useState(false)
    const [submittedRecord, setSubmittedRecord] = useState<any>(null)

    const [formData, setFormData] = useState({
        evaluator_name: '',
        evaluated_name: '',
        evaluated_role: '',
        fortalezas: '',
        areas_mejora: '',
        recomendaria: 'si',
        desempeno_general: 10,
        comentarios: ''
    })

    const [selectedRole, setSelectedRole] = useState<string>('')
    const [customRole, setCustomRole] = useState<string>('')
    const [isLeadershipEnabled, setIsLeadershipEnabled] = useState<boolean>(false)

    const [answers, setAnswers] = useState<{ [key: string]: any }>({})
    const [questionPhotos, setQuestionPhotos] = useState<{ [key: string]: string[] }>({})

    const { data: template, loading: checklistLoading } = useDynamicChecklist('staff_evaluation_v1')

    useEffect(() => {
        fetchStores()
    }, [])

    useEffect(() => {
        if (preselectedStoreId) {
            setSelectedStore(preselectedStoreId)
        }
    }, [preselectedStoreId])

    useEffect(() => {
        if (stores.length > 0 && !selectedStore && !gpsDone && isKioskMode) {
            setGpsDone(true)
            detectLocation()
        }
    }, [stores, selectedStore, gpsDone, isKioskMode])

    const fetchStores = async () => {
        try {
            const supabase = await getSupabaseClient()
            const { data } = await supabase
                .from('stores')
                .select('id, name, latitude, longitude, address, city')
                .order('name')

            const mapped = (Array.isArray(data) ? data : []).map(store => ({
                ...store,
                id: String(store.id),
                latitude: store.latitude ? parseFloat(store.latitude) : null,
                longitude: store.longitude ? parseFloat(store.longitude) : null
            }))
            setStores(mapped)
        } catch (err) {
            console.error('Error fetching stores:', err)
        }
    }

    const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
        const R = 6371
        const dLat = (lat2 - lat1) * Math.PI / 180
        const dLon = (lon2 - lon1) * Math.PI / 180
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return R * c
    }

    const detectLocation = () => {
        if (!navigator.geolocation) return
        setDetectingLocation(true)
        navigator.geolocation.getCurrentPosition(
            pos => {
                const { latitude, longitude } = pos.coords
                let closest: Store | null = null
                let minDistance = Infinity

                stores.forEach(s => {
                    if (s.latitude && s.longitude) {
                        const d = calculateDistance(latitude, longitude, s.latitude, s.longitude)
                        if (d < minDistance) {
                            minDistance = d
                            closest = s
                        }
                    }
                })

                const MAX_DISTANCE_KM = 4.02 // 2.5 miles
                if (closest && minDistance <= MAX_DISTANCE_KM) {
                    setSelectedStore((closest as Store).id)
                }
                setDetectingLocation(false)
            },
            () => {
                setDetectingLocation(false)
            },
            { enableHighAccuracy: true, timeout: 10000 }
        )
    }

    const resetForm = () => {
        setFormData({
            evaluator_name: '',
            evaluated_name: '',
            evaluated_role: '',
            fortalezas: '',
            areas_mejora: '',
            recomendaria: 'si',
            desempeno_general: 10,
            comentarios: ''
        })
        setSelectedRole('')
        setCustomRole('')
        setIsLeadershipEnabled(false)
        setAnswers({})
        setQuestionPhotos({})
        setShowThanks(false)
        setSubmittedRecord(null)
    }

    const handleRoleSelect = (role: string) => {
        setSelectedRole(role)
        const isLead = isLeadRole(role)
        setIsLeadershipEnabled(isLead)
        if (role === 'Otro') {
            setFormData(prev => ({ ...prev, evaluated_role: customRole.trim() || 'Otro' }))
        } else {
            setFormData(prev => ({ ...prev, evaluated_role: role }))
        }
    }

    const handleCustomRoleChange = (val: string) => {
        setCustomRole(val)
        setFormData(prev => ({ ...prev, evaluated_role: val.trim() || 'Otro' }))
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!selectedStore) {
            alert(isEs ? 'Por favor selecciona la sucursal o ubicación' : 'Please select a store or location')
            return
        }
        if (!formData.evaluated_name.trim()) {
            alert(isEs ? 'Ingresa el nombre del colaborador a evaluar' : 'Please enter the staff member name')
            return
        }
        if (!selectedRole || (selectedRole === 'Otro' && !customRole.trim())) {
            alert(isEs ? 'Selecciona o especifica el puesto del colaborador' : 'Please select or specify the staff member role')
            return
        }

        setLoading(true)
        try {
            const supabase = await getSupabaseClient()
            const allPhotos = Object.values(questionPhotos).flat()

            // Build atomic question answers mapping
            const atomicQuestions: Record<string, number | null> = {}

            EVALUATION_SECTIONS.forEach(section => {
                section.questions.forEach(q => {
                    if (section.isLeadSection && !isLeadershipEnabled) {
                        atomicQuestions[q.col] = null
                        return
                    }
                    if (q.isLead && !isLeadershipEnabled) {
                        atomicQuestions[q.col] = null
                        return
                    }
                    const answerVal = answers[q.qid] || answers[String(q.qid)]
                    atomicQuestions[q.col] = answerVal !== undefined && answerVal !== null ? Number(answerVal) : null
                })
            })

            const isCorporate = selectedStore === 'corporate'
            const currentStore = !isCorporate ? stores.find(s => s.id === selectedStore) : null
            const storeId = isCorporate ? null : parseInt(selectedStore, 10)
            const locationName = isCorporate
                ? (isEs ? 'Oficina Central / Corporativo' : 'Corporate / Central Office')
                : (currentStore ? formatStoreName(currentStore.name) : `Tienda ${selectedStore}`)

            const finalRole = selectedRole === 'Otro' ? (customRole.trim() || 'Otro') : selectedRole

            const payload: any = {
                store_id: storeId,
                location_name: locationName,
                evaluation_date: new Date().toISOString(),
                evaluator_name: formData.evaluator_name.trim() || null,
                evaluated_name: formData.evaluated_name.trim(),
                evaluated_role: finalRole,
                ...atomicQuestions,
                fortalezas: formData.fortalezas.trim() || null,
                areas_mejora: formData.areas_mejora.trim() || null,
                recomendaria: formData.recomendaria,
                desempeno_general: Number(formData.desempeno_general),
                comentarios: formData.comentarios.trim() || null,
                language: language,
                photo_urls: allPhotos.length > 0 ? allPhotos : null,
                review_status: 'pending',
                answers: {
                    ...answers,
                    is_lead_role: isLeadershipEnabled,
                    location_name: locationName,
                    custom_role: selectedRole === 'Otro' ? customRole.trim() : undefined,
                    '__question_photos': questionPhotos
                }
            }

            const { data, error } = await supabase
                .from('staff_evaluations')
                .insert([payload])
                .select()

            if (error) throw error

            const created = data && data.length > 0 ? data[0] : payload
            setSubmittedRecord(created)
            setShowThanks(true)

            // Notificación ejecutiva a Raquel, Roberto, Gonzalo y Carlos
            try {
                fetch('/api/evaluacion/notify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(created)
                }).catch(notifyErr => {
                    console.warn('[StaffEvaluationForm] Aviso: error asíncrono notificando a directivos:', notifyErr)
                })
            } catch (notifyErr) {
                console.warn('[StaffEvaluationForm] Error al despachar notificación:', notifyErr)
            }

            if (onCompleted) {
                onCompleted(created)
            }
        } catch (err: any) {
            console.error('Error submitting staff evaluation:', err)
            alert((isEs ? 'Error al enviar la evaluación: ' : 'Error submitting evaluation: ') + err.message)
        } finally {
            setLoading(false)
        }
    }

    const currentStoreInfo = stores.find(s => s.id === selectedStore)
    const isLead = isLeadershipEnabled

    if (showThanks) {
        return (
            <div className="flex flex-col items-center justify-center p-8 sm:p-12 text-center rounded-3xl bg-gradient-to-br from-slate-900 via-red-950 to-black text-white shadow-2xl border border-red-900/40 my-6 animate-in zoom-in-95 duration-500">
                <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-amber-400 to-yellow-300 text-slate-950 flex items-center justify-center shadow-[0_0_50px_rgba(251,191,36,0.5)] mb-6">
                    <CheckCircle2 size={54} strokeWidth={2.5} />
                </div>
                <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight mb-2">
                    {isEs ? '¡Evaluación Registrada con Éxito!' : 'Evaluation Submitted Successfully!'}
                </h2>
                <p className="text-base sm:text-lg text-white/80 max-w-lg mb-8 leading-relaxed font-light">
                    {isEs
                        ? `La evaluación para ${formData.evaluated_name} (${formData.evaluated_role}) ha sido guardada y notificada a Dirección Corporativa.`
                        : `The evaluation for ${formData.evaluated_name} (${formData.evaluated_role}) has been recorded and corporate management notified.`}
                </p>

                <div className="flex flex-wrap items-center justify-center gap-4">
                    <button
                        onClick={resetForm}
                        className="px-8 py-3.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl shadow-lg hover:shadow-red-600/30 transition-all flex items-center gap-2"
                    >
                        <RefreshCw size={18} />
                        <span>{isEs ? 'Realizar otra evaluación' : 'Submit another evaluation'}</span>
                    </button>
                </div>
            </div>
        )
    }

    return (
        <form onSubmit={handleSubmit} className="w-full max-w-3xl mx-auto space-y-6">

            {/* SECCIÓN 1: UBICACIÓN Y TIENDA */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl shadow-xl overflow-hidden border border-slate-200 dark:border-slate-800 transition-all">
                <div className="h-2 bg-gradient-to-r from-red-600 to-amber-500 w-full" />
                <div className="p-6 sm:p-8 space-y-4">
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                            <MapPin size={18} className="text-red-600" />
                            {isEs ? '1. Ubicación de la Evaluación' : '1. Evaluation Location'}
                        </label>
                        {stores.length > 0 && (
                            <button
                                type="button"
                                onClick={detectLocation}
                                disabled={detectingLocation}
                                className="text-xs font-bold text-red-600 dark:text-red-400 hover:underline flex items-center gap-1 disabled:opacity-50"
                            >
                                <span>📍</span>
                                <span>{detectingLocation ? (isEs ? 'Detectando...' : 'Detecting...') : (isEs ? 'Detectar por GPS' : 'Auto GPS')}</span>
                            </button>
                        )}
                    </div>

                    <select
                        value={selectedStore}
                        onChange={e => setSelectedStore(e.target.value)}
                        required
                        className="w-full px-4 py-3.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-bold text-base text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-red-600 transition-all"
                    >
                        <option value="">{isEs ? '-- Selecciona la Ubicación o Sucursal --' : '-- Select Location or Store --'}</option>
                        <optgroup label={isEs ? '🏢 Oficinas & Soporte Central' : '🏢 Corporate & Central Office'}>
                            <option value="corporate">
                                {isEs ? 'Oficina Central / Corporativo' : 'Corporate / Central Office'}
                            </option>
                        </optgroup>
                        <optgroup label={isEs ? '🌮 Sucursales (Restaurantes)' : '🌮 Store Locations'}>
                            {stores.map(s => (
                                <option key={s.id} value={s.id}>
                                    {formatStoreName(s.name)}
                                </option>
                            ))}
                        </optgroup>
                    </select>

                    {selectedStore === 'corporate' && (
                        <div className="flex items-start gap-2.5 p-3.5 bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-900/40 text-xs text-blue-900 dark:text-blue-200 animate-in fade-in duration-300">
                            <Building2 size={18} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                            <div>
                                <span className="font-black text-sm block text-blue-950 dark:text-blue-100">
                                    {isEs ? 'Oficina Central / Corporativo' : 'Corporate / Central Office'}
                                </span>
                                <span className="text-blue-800 dark:text-blue-300 mt-0.5 block">
                                    {isEs
                                        ? 'Evaluación de soporte corporativo, Recursos Humanos (RRHH), Bodega Central o Administración.'
                                        : 'Evaluation for corporate staff, HR, Central Warehouse, or Administration.'}
                                </span>
                            </div>
                        </div>
                    )}

                    {currentStoreInfo && (
                        <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/20 rounded-xl border border-red-100 dark:border-red-900/30 text-xs text-red-900 dark:text-red-200 animate-in fade-in duration-300">
                            <span>📍</span>
                            <div>
                                <span className="font-bold">{formatStoreName(currentStoreInfo.name)}</span>
                                {currentStoreInfo.address && <span className="block text-red-700 dark:text-red-300">{currentStoreInfo.address}, {currentStoreInfo.city}</span>}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* SECCIÓN 2: INFORMACIÓN DEL PERSONAL EVALUADO */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl shadow-xl overflow-hidden border border-slate-200 dark:border-slate-800 transition-all">
                <div className="h-2 bg-gradient-to-r from-red-600 to-amber-500 w-full" />
                <div className="p-6 sm:p-8 space-y-5">
                    <h3 className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                        <UserCheck size={18} className="text-red-600" />
                        {isEs ? '2. Datos del Personal y Evaluador' : '2. Staff Member & Evaluator'}
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                <UserCheck size={14} className="text-red-600" />
                                {isEs ? 'Nombre de la Persona a Evaluar *' : 'Staff Member Name *'}
                            </label>
                            <input
                                type="text"
                                required
                                placeholder={isEs ? 'Ej. Carmen, Stephany, Juan Pérez...' : 'e.g. John Doe, Jane Smith...'}
                                value={formData.evaluated_name}
                                onChange={e => setFormData({ ...formData, evaluated_name: e.target.value })}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-bold text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-red-600 transition-all"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                <Briefcase size={14} className="text-red-600" />
                                {isEs ? 'Puesto / Rol *' : 'Role / Position *'}
                            </label>
                            <select
                                required
                                value={selectedRole}
                                onChange={e => handleRoleSelect(e.target.value)}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-bold text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-red-600 transition-all"
                            >
                                <option value="">{isEs ? '-- Selecciona Puesto --' : '-- Select Role --'}</option>
                                <optgroup label={isEs ? '🌮 Personal de Sucursal (Restaurante)' : '🌮 Store Staff'}>
                                    {STORE_ROLES.map(r => (
                                        <option key={r} value={r}>{r}</option>
                                    ))}
                                </optgroup>
                                <optgroup label={isEs ? '🏢 Corporativo, RRHH & Soporte' : '🏢 Corporate, HR & Support'}>
                                    {CORPORATE_ROLES.map(r => (
                                        <option key={r} value={r}>{r}</option>
                                    ))}
                                </optgroup>
                            </select>
                        </div>
                    </div>

                    {/* Campo de puesto personalizado si selecciona 'Otro' */}
                    {selectedRole === 'Otro' && (
                        <div className="p-4 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
                            <label className="block text-xs font-black text-amber-900 dark:text-amber-200 uppercase tracking-wider flex items-center gap-1.5">
                                <Sparkles size={14} className="text-amber-600" />
                                {isEs ? 'Especifica el Puesto o Cargo Exacto *' : 'Specify Exact Role or Title *'}
                            </label>
                            <input
                                type="text"
                                required
                                placeholder={isEs ? 'Ej. Coordinador de Nómina, Chofer, TI / Sistemas, etc.' : 'e.g. Payroll Coordinator, Driver, IT Specialist, etc.'}
                                value={customRole}
                                onChange={e => handleCustomRoleChange(e.target.value)}
                                className="w-full px-4 py-2.5 bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 rounded-xl font-bold text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-amber-500 transition-all"
                            />
                        </div>
                    )}

                    {/* Toggle interactivo de Liderazgo */}
                    {selectedRole && (
                        <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 transition-all">
                            <div className="pr-4">
                                <span className="block text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                                    <ShieldCheck size={15} className={isLeadershipEnabled ? 'text-red-600' : 'text-slate-400'} />
                                    {isEs ? '¿Evaluar criterios de Liderazgo y Manejo de Equipo?' : 'Evaluate Leadership & Team Management?'}
                                </span>
                                <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                    {isLeadershipEnabled
                                        ? (isEs ? 'Activo: Se evaluarán las 5 áreas completas (25 criterios incluyendo liderazgo y resolución de conflictos).' : 'Enabled: All 5 areas will be evaluated (25 criteria including leadership and conflict resolution).')
                                        : (isEs ? 'Inactivo: Se evaluarán 4 áreas operativas (19 criterios, omitiendo sección de liderazgo).' : 'Disabled: 4 operational areas will be evaluated (19 criteria, leadership omitted).')}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsLeadershipEnabled(!isLeadershipEnabled)}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                    isLeadershipEnabled ? 'bg-red-600' : 'bg-slate-300 dark:bg-slate-700'
                                }`}
                                title={isLeadershipEnabled ? 'Desactivar liderazgo' : 'Activar liderazgo'}
                            >
                                <span
                                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                        isLeadershipEnabled ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                />
                            </button>
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <User size={14} className="text-slate-400" />
                            {isEs ? 'Tu Nombre (Evaluador - Opcional)' : 'Your Name (Evaluator - Optional)'}
                        </label>
                        <input
                            type="text"
                            placeholder={isEs ? 'Nombre del Gerente, Supervisor, Director o Compañero' : 'Manager, Supervisor, Director or Peer Name'}
                            value={formData.evaluator_name}
                            onChange={e => setFormData({ ...formData, evaluator_name: e.target.value })}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-medium text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-red-600 transition-all"
                        />
                    </div>
                </div>
            </div>

            {/* SECCIÓN 3: CHECKLIST DE CRITERIOS */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl shadow-xl overflow-hidden border border-slate-200 dark:border-slate-800 transition-all">
                <div className="h-2 bg-gradient-to-r from-red-600 to-amber-500 w-full" />
                <div className="p-6 sm:p-8 space-y-6">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                            <Star size={18} className="text-amber-500" />
                            {isEs ? '3. Criterios de Evaluación (1 a 5 Estrellas)' : '3. Evaluation Criteria (1 to 5 Stars)'}
                        </h3>
                        {selectedRole && (
                            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                {isLeadershipEnabled
                                    ? (isEs ? 'Evaluando 25 Criterios (Con Liderazgo)' : 'Evaluating 25 Criteria (With Leadership)')
                                    : (isEs ? 'Evaluando 19 Criterios (Liderazgo Omitido)' : 'Evaluating 19 Criteria (Leadership Omitted)')}
                            </span>
                        )}
                    </div>

                    {checklistLoading ? (
                        <div className="py-12 flex justify-center">
                            <SurpriseLoader />
                        </div>
                    ) : (
                        <div className="space-y-8">
                            {template?.sections.map((section: any) => {
                                const isLeadSection = section.title.toLowerCase().includes('liderazgo') || section.title.toLowerCase().includes('leadership')
                                if (isLeadSection && !isLead) return null

                                return (
                                    <div key={section.id} className="space-y-4">
                                        <div className="flex items-center gap-4">
                                            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                                            <h4 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em]">
                                                {section.title}
                                            </h4>
                                            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                                        </div>

                                        <div className="space-y-3">
                                            {section.questions.map((q: any, idx: number) => {
                                                const isLeadQ = q.text.toLowerCase().includes('(líder)') || q.text.toLowerCase().includes('(lider)') || q.text.toLowerCase().includes('(lead)')
                                                if (isLeadQ && !isLead) return null

                                                return (
                                                    <DynamicQuestion
                                                        key={q.id}
                                                        question={q}
                                                        index={idx}
                                                        value={answers[q.id]}
                                                        photos={questionPhotos[q.id] || []}
                                                        onChange={val => setAnswers(prev => ({ ...prev, [q.id]: val }))}
                                                        onPhotosChange={urls => setQuestionPhotos(prev => ({ ...prev, [q.id]: urls }))}
                                                    />
                                                )
                                            })}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* SECCIÓN 4: EVALUACIÓN CUALITATIVA */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl shadow-xl overflow-hidden border border-slate-200 dark:border-slate-800 transition-all">
                <div className="h-2 bg-gradient-to-r from-red-600 to-amber-500 w-full" />
                <div className="p-6 sm:p-8 space-y-5">
                    <h3 className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                        <Sparkles size={18} className="text-amber-500" />
                        {isEs ? '4. Fortalezas, Mejoras y Calificación General' : '4. Strengths, Opportunities & Rating'}
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-2">
                                {isEs ? 'Fortalezas del Empleado' : 'Staff Strengths'}
                            </label>
                            <textarea
                                value={formData.fortalezas}
                                onChange={e => setFormData({ ...formData, fortalezas: e.target.value })}
                                rows={3}
                                placeholder={isEs ? '¿En qué destaca? ¿Qué hace muy bien?' : 'What do they excel at?'}
                                className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-red-600 resize-none font-medium"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-2">
                                {isEs ? 'Áreas de Mejora / Oportunidad' : 'Areas for Improvement'}
                            </label>
                            <textarea
                                value={formData.areas_mejora}
                                onChange={e => setFormData({ ...formData, areas_mejora: e.target.value })}
                                rows={3}
                                placeholder={isEs ? '¿En qué necesita apoyo o capacitación?' : 'Where can they improve or need training?'}
                                className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-red-600 resize-none font-medium"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                        <div>
                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-2">
                                {isEs ? '¿Lo recomiendas para crecimiento?' : 'Recommend for Advancement?'}
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, recomendaria: 'si' })}
                                    className={`py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 border transition-all ${
                                        formData.recomendaria === 'si'
                                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/30'
                                            : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100'
                                    }`}
                                >
                                    <ThumbsUp size={16} />
                                    <span>{isEs ? 'Sí' : 'Yes'}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, recomendaria: 'no' })}
                                    className={`py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 border transition-all ${
                                        formData.recomendaria === 'no'
                                            ? 'bg-red-600 text-white border-red-600 shadow-md shadow-red-600/30'
                                            : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100'
                                    }`}
                                >
                                    <ThumbsDown size={16} />
                                    <span>{isEs ? 'No' : 'No'}</span>
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-2">
                                {isEs ? 'Desempeño General (Escala 1 a 10) *' : 'Overall Performance (Scale 1-10) *'}
                            </label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="range"
                                    min="1"
                                    max="10"
                                    value={formData.desempeno_general}
                                    onChange={e => setFormData({ ...formData, desempeno_general: parseInt(e.target.value, 10) })}
                                    className="flex-1 accent-red-600 h-2 bg-slate-200 dark:bg-slate-700 rounded-lg cursor-pointer"
                                />
                                <span className="w-12 text-center text-2xl font-black text-red-600 dark:text-red-400">
                                    {formData.desempeno_general}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-2">
                            {isEs ? 'Comentarios Adicionales' : 'Additional Comments'}
                        </label>
                        <textarea
                            value={formData.comentarios}
                            onChange={e => setFormData({ ...formData, comentarios: e.target.value })}
                            rows={3}
                            placeholder={isEs ? 'Observaciones generales del turno o detalles importantes...' : 'General observations or specific incidents...'}
                            className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-red-600 resize-none font-medium"
                        />
                    </div>
                </div>
            </div>

            {/* SECCIÓN 5: BOTÓN ENVIAR */}
            <div className="pt-2">
                <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-4 px-6 bg-gradient-to-r from-red-600 via-red-700 to-red-800 hover:from-red-700 hover:to-red-900 text-white font-black text-base uppercase tracking-wider rounded-2xl shadow-xl hover:shadow-red-600/30 active:scale-[0.99] transition-all flex items-center justify-center gap-3 disabled:opacity-60"
                >
                    {loading ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>{isEs ? 'Enviando Evaluación...' : 'Submitting Evaluation...'}</span>
                        </>
                    ) : (
                        <>
                            <Send size={20} />
                            <span>{isEs ? 'Enviar Evaluación de Staff' : 'Submit Staff Evaluation'}</span>
                        </>
                    )}
                </button>
            </div>
        </form>
    )
}
