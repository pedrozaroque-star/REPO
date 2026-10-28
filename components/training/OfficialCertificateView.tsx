'use client';

/**
 * @module OfficialCertificateView
 * @description Componentes ejecutivos para el Módulo TRAINING (Academia SOP Tacos Gavilan):
 * 1) `OfficialCertificateView`: Diploma corporativo imprimible de alta distinción que certifica al
 *    colaborador por su PUESTO OFICIAL (ej. Cocinero, Cajera, Liderazgo) acreditando TODAS las
 *    estaciones de trabajo de ese puesto en sus 4 días (ej. para Cocinero: Cocción de Carnes,
 *    Tortillas, Tacos, Plancha de Tortas/Mulitas/Quesadillas, Burritos y Preparación).
 * 2) `PrintableRecipeChecklistModal`: Formato maestro digital e imprimible en papel de todos los
 *    artículos vendidos con receta agrupados por Estación de Trabajo del módulo de Actividades.
 *
 * @businessRules
 * - Certificación por Puesto (Cocinero, Cajera, Liderazgo), NO por una sola estación aislada.
 * - Un Cocinero se certifica en todas sus 6 estaciones de cocina en 4 días, realizando al interior
 *   los productos de las recetas de cada estación.
 * - Nombre oficial de la marca: estrictamente "Tacos Gavilan".
 * - Estricto Light Mode Corporativo (#FFFAF5, #FFFFFF, #DA291C, #FFC72C, #0F172A).
 */

import React, { useState } from 'react';
import { Award, CheckCircle2, Printer, ShieldCheck, X, Search } from 'lucide-react';

export interface CertifiedStationItem {
  stationKey: string;
  labelEs: string;
  labelEn: string;
}

export interface CertificateProps {
  employeeName: string;
  storeName: string;
  stationName: string; // Nombre del Puesto Oficial o Estación
  jobRoleTitle?: string;
  certifiedStations?: CertifiedStationItem[];
  folio: string;
  issuedDate?: string;
  managerName: string;
  supervisorName?: string | null;
  tenureWeeks?: number;
  score?: number | null;
  lang: 'es' | 'en';
  onPrint?: () => void;
  onEnableRetraining?: () => void;
  showRetrainingBtn?: boolean;
}

const DEFAULT_COOK_STATIONS: CertifiedStationItem[] = [
  { stationKey: 'CARNES', labelEs: '1. Cocción de Carnes', labelEn: '1. Meat Grilling & Cooking' },
  { stationKey: 'TORTILLAS', labelEs: '2. Tortillas', labelEn: '2. Tortillas & Steamer' },
  { stationKey: 'TACOS', labelEs: '3. Tacos y Platos', labelEn: '3. Tacos & Plates' },
  {
    stationKey: 'TORTAS/QUESADILLAS',
    labelEs: '4. Plancha de Tortas, Mulitas y Quesadillas',
    labelEn: '4. Tortas, Mulitas & Quesadillas Flat-Top',
  },
  { stationKey: 'BURRITOS', labelEs: '5. Burritos', labelEn: '5. Burritos, Sopes & Nachos' },
  { stationKey: 'PREPARACION', labelEs: '6. Preparación', labelEn: '6. Kitchen Prep & Party Trays' },
];

export function OfficialCertificateView({
  employeeName,
  storeName,
  stationName,
  jobRoleTitle,
  certifiedStations,
  folio,
  issuedDate,
  managerName,
  supervisorName,
  tenureWeeks,
  score = 100,
  lang,
  onPrint,
  onEnableRetraining,
  showRetrainingBtn = false,
}: CertificateProps) {
  const formattedDate = issuedDate
    ? new Date(issuedDate).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-MX', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : new Date().toLocaleDateString(lang === 'en' ? 'en-US' : 'es-MX', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

  const effectiveRoleTitle = jobRoleTitle || stationName;
  const effectiveStations =
    certifiedStations && certifiedStations.length > 0 ? certifiedStations : DEFAULT_COOK_STATIONS;

  const handlePrint = () => {
    if (onPrint) {
      onPrint();
    } else {
      window.print();
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Controles superiores en pantalla (ocultos al imprimir) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 bg-white rounded-2xl border-2 border-[#FFC72C] px-4 py-3 shadow-xs print:hidden">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-black uppercase text-emerald-700">
              {lang === 'es'
                ? 'Certificado Oficial por Puesto (Todas sus Estaciones)'
                : 'Official Role Certificate (All Workstations)'}
              {tenureWeeks !== undefined && tenureWeeks >= 2
                ? ` • ${tenureWeeks} ${lang === 'es' ? 'semanas en Planificador' : 'weeks in Planner'}`
                : ''}
            </div>
            <div className="text-xs font-semibold text-slate-600">
              Folio: <strong className="font-mono text-[#0F172A]">{folio}</strong>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {showRetrainingBtn && onEnableRetraining && (
            <button
              type="button"
              onClick={onEnableRetraining}
              className="px-3.5 py-2 rounded-xl bg-[#FFF8E7] hover:bg-[#FFC72C]/30 border border-[#FFC72C] text-[#0F172A] text-xs font-black cursor-pointer transition-all"
            >
              {lang === 'es'
                ? '🎬 Ver Estaciones, Recetas y Videos del Puesto'
                : '🎬 View Role Stations, Recipes & Videos'}
            </button>
          )}
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#DA291C] hover:bg-[#B91C1C] text-white text-xs sm:text-sm font-black shadow-sm cursor-pointer transition-all"
          >
            <Printer className="w-4 h-4 text-[#FFC72C]" />
            {lang === 'es' ? 'Imprimir Certificado Oficial' : 'Print Official Certificate'}
          </button>
        </div>
      </div>

      {/* DIPLOMA CORPORATIVO EJECUTIVO TACOS GAVILAN */}
      <div
        id="official-certificate-printable"
        className="relative bg-white rounded-3xl border-[6px] border-[#DA291C] p-3 sm:p-5 shadow-2xl print:shadow-none print:border-[5px] print:rounded-none"
      >
        <div className="relative border-[3px] border-[#FFC72C] rounded-2xl p-6 sm:p-10 bg-gradient-to-b from-[#FFFDF9] via-white to-[#FFF9F0]">
          {/* Esquinas ornamentales doradas */}
          <div className="absolute top-3 left-3 w-6 h-6 border-t-4 border-l-4 border-[#DA291C] rounded-tl-md" />
          <div className="absolute top-3 right-3 w-6 h-6 border-t-4 border-r-4 border-[#DA291C] rounded-tr-md" />
          <div className="absolute bottom-3 left-3 w-6 h-6 border-b-4 border-l-4 border-[#DA291C] rounded-bl-md" />
          <div className="absolute bottom-3 right-3 w-6 h-6 border-b-4 border-r-4 border-[#DA291C] rounded-br-md" />

          {/* Encabezado Institucional */}
          <div className="flex flex-col items-center text-center space-y-2">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-[#FFF5EB] border-2 border-[#FFC72C] p-2.5 flex items-center justify-center shadow-sm">
              <img
                src="/logo.png"
                alt="Tacos Gavilan"
                className="w-full h-full object-contain"
              />
            </div>

            <div className="text-[11px] sm:text-xs font-black tracking-[0.22em] uppercase text-[#DA291C] pt-1">
              {lang === 'es'
                ? 'ACADEMIA CORPORATIVA DE OPERACIONES & ESTÁNDARES SOP • TACOS GAVILAN'
                : 'CORPORATE OPERATIONS & SOP STANDARDS ACADEMY • TACOS GAVILAN'}
            </div>

            <h2 className="text-2xl sm:text-4xl font-black text-[#0F172A] tracking-tight uppercase">
              {lang === 'es'
                ? 'CERTIFICADO OFICIAL DE PUESTO OPERATIVO'
                : 'OFFICIAL OPERATIONAL ROLE CERTIFICATE'}
            </h2>

            <p className="text-xs sm:text-sm font-bold text-slate-600 max-w-xl">
              {lang === 'es'
                ? 'Por medio del presente documento oficial se certifica que el colaborador:'
                : 'This official document hereby certifies that the team member:'}
            </p>
          </div>

          {/* Nombre del Colaborador */}
          <div className="my-5 sm:my-6 text-center">
            <div className="inline-block border-b-4 border-[#FFC72C] px-6 sm:px-12 pb-2">
              <div className="text-2xl sm:text-4xl font-black text-[#DA291C] tracking-wide">
                {employeeName}
              </div>
            </div>
          </div>

          {/* Cuerpo de Acreditación por Puesto y Estaciones */}
          <div className="text-center max-w-3xl mx-auto space-y-4">
            <p className="text-xs sm:text-sm font-semibold text-slate-700 leading-relaxed">
              {lang === 'es'
                ? 'Ha acreditado satisfactoriamente en el programa intensivo de 4 días el dominio práctico de recetas, gramajes exactos en onzas (oz), temperaturas críticas, inocuidad alimentaria y velocidad de línea en TODAS las estaciones de trabajo que integran su Puesto Oficial:'
                : 'Has successfully completed the 4-day intensive program demonstrating recipe mastery, exact ounce portions (oz), critical temperatures, food safety, and line speed across ALL workstations required for their Official Role:'}
            </p>

            {/* Tarjeta Central de PUESTO + SUCURSAL + CALIFICACIÓN */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-[#FFF8E7] border-2 border-[#FFC72C] rounded-2xl p-4 text-center items-center">
              <div>
                <div className="text-[10px] font-black uppercase text-slate-500">
                  {lang === 'es' ? 'Puesto Oficial Certificado' : 'Certified Official Role'}
                </div>
                <div className="text-sm sm:text-base font-black text-[#DA291C] mt-0.5">
                  {effectiveRoleTitle}
                </div>
              </div>

              <div className="border-y sm:border-y-0 sm:border-x border-[#FFC72C] py-2 sm:py-0">
                <div className="text-[10px] font-black uppercase text-slate-500">
                  {lang === 'es' ? 'Sucursal Oficial' : 'Official Store'}
                </div>
                <div className="text-sm sm:text-base font-black text-[#0F172A] mt-0.5">
                  Tacos Gavilan — {storeName}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-black uppercase text-slate-500">
                  {lang === 'es' ? 'Calificación / Estatus' : 'Score / Status'}
                </div>
                <div className="text-sm sm:text-base font-black text-emerald-700 mt-0.5 flex items-center justify-center gap-1">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{score || 100}% APROBADO (4 DÍAS)</span>
                </div>
              </div>
            </div>

            {/* Desglose de TODAS las Estaciones de Trabajo Acreditadas en el Puesto */}
            <div className="bg-white border-2 border-[#FED7AA] rounded-2xl p-4 text-left space-y-2.5">
              <div className="text-[11px] font-black uppercase tracking-wider text-[#DA291C] text-center">
                {lang === 'es'
                  ? `ESTACIONES DE TRABAJO Y RECETAS ACREDITADAS (${effectiveStations.length} ESTACIONES DEL MÓDULO DE ACTIVIDADES):`
                  : `ACCREDITED WORKSTATIONS & RECIPES (${effectiveStations.length} STATIONS FROM ACTIVITIES MODULE):`}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {effectiveStations.map((st) => (
                  <div
                    key={st.stationKey}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#FFFAF5] border border-[#FFC72C] text-xs font-black text-[#0F172A]"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{lang === 'en' ? st.labelEn : st.labelEs}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sello Dorado y Bloques de Firma */}
          <div className="mt-7 pt-6 border-t border-[#F1E4D8] grid grid-cols-1 sm:grid-cols-3 gap-6 items-end text-center">
            {/* Firma 1: Gerente de Sucursal */}
            <div className="space-y-1">
              <div className="text-sm font-black text-[#0F172A]">
                {managerName || 'Gerente de Sucursal'}
              </div>
              <div className="border-t-2 border-slate-400 pt-1 text-[11px] font-extrabold uppercase text-slate-500">
                {lang === 'es' ? 'Gerente Certificador de Sucursal' : 'Certifying Store Manager'}
              </div>
            </div>

            {/* Sello Central */}
            <div className="flex flex-col items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#FFC72C] via-[#F59E0B] to-[#D97706] p-1 shadow-md flex items-center justify-center">
                <div className="w-full h-full rounded-full border-2 border-white flex flex-col items-center justify-center text-white">
                  <Award className="w-6 h-6" />
                  <span className="text-[8px] font-black tracking-tighter uppercase">
                    100% SOP
                  </span>
                </div>
              </div>
              <div className="mt-2 text-[11px] font-mono font-black text-[#0F172A]">
                {folio}
              </div>
              <div className="text-[10px] font-semibold text-slate-500">
                {formattedDate}
              </div>
            </div>

            {/* Firma 2: Supervisor / Dirección de Operaciones */}
            <div className="space-y-1">
              <div className="text-sm font-black text-[#0F172A]">
                {supervisorName || 'Dirección de Operaciones'}
              </div>
              <div className="border-t-2 border-slate-400 pt-1 text-[11px] font-extrabold uppercase text-slate-500">
                {lang === 'es'
                  ? 'Supervisión & Operaciones Tacos Gavilan'
                  : 'Supervision & Operations Tacos Gavilan'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface RecipeProductItem {
  guid: string;
  slug: string;
  name: string;
  baseProductName?: string;
  category: string;
  price: number;
  positionKey: string;
  hasVideo: boolean;
  videoUrl: string | null;
  sourceVideoFilename: string | null;
  durationSeconds: number;
  targetPrepSeconds: number;
  grillTempFahrenheit: number | null;
  variantCount?: number;
  variantsIncluded?: string[];
  ingredients: {
    id: string | number;
    name: string;
    quantity: number;
    unit: string;
    type: string;
  }[];
  steps: any[];
  recipeSpecs: any[];
}

const STATION_LABELS_MAP: Record<string, string> = {
  CARNES: '1. Cocción de Carnes (CARNES)',
  TORTILLAS: '2. Tortillas y Vaporera (TORTILLAS)',
  TACOS: '3. Tacos y Platos (TACOS)',
  'TORTAS/QUESADILLAS': '4. Plancha de Tortas, Mulitas y Quesadillas',
  'TORTAS/MULITAS': '4. Plancha de Tortas, Mulitas y Quesadillas',
  BURRITOS: '5. Burritos, Sopes y Nachos (BURRITOS)',
  PREPARACION: '6. Preparación y Party Trays (PREPARACION)',
  'Caja 1 / Salón': '7. Caja, Bebidas y Postres (SALÓN)',
  'Uber + Salsas': '8. Uber + Salsas y Entrega (EXPO)',
};

export function PrintableRecipeChecklistModal({
  isOpen,
  onClose,
  recipeProducts,
  storeName,
  employeeName,
  trainerName,
  lang,
}: {
  isOpen: boolean;
  onClose: () => void;
  recipeProducts: RecipeProductItem[];
  storeName: string;
  employeeName: string;
  trainerName: string;
  lang: 'es' | 'en';
}) {
  const [search, setSearch] = useState('');
  const [selectedStation, setSelectedStation] = useState('ALL');
  const [selectedCat, setSelectedCat] = useState('ALL');
  const [digitalChecks, setDigitalChecks] = useState<Record<string, boolean>>({});

  if (!isOpen) return null;

  const categories = Array.from(new Set(recipeProducts.map((p) => p.category))).sort();
  const stationKeys = Array.from(new Set(recipeProducts.map((p) => p.positionKey)));

  const filtered = recipeProducts.filter((p) => {
    if (selectedStation !== 'ALL' && p.positionKey !== selectedStation) return false;
    if (selectedCat !== 'ALL' && p.category !== selectedCat) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.positionKey.toLowerCase().includes(q) ||
        p.ingredients.some((i) => i.name.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const toggleCheck = (key: string) => {
    setDigitalChecks((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 print:static print:bg-white print:p-0">
      <div className="bg-white rounded-3xl border-2 border-[#FFC72C] max-w-6xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden print:max-h-none print:border-none print:shadow-none print:rounded-none">
        {/* Barra de acciones superior (oculta al imprimir) */}
        <div className="px-5 py-4 bg-[#FFFDF9] border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div>
            <h3 className="text-lg sm:text-xl font-black text-[#0F172A]">
              {lang === 'es'
                ? `📋 Lista Maestra por Estación y Receta (${filtered.length} de ${recipeProducts.length} Productos)`
                : `📋 Master Checklist by Station & Recipe (${filtered.length} of ${recipeProducts.length} Products)`}
            </h3>
            <p className="text-xs font-semibold text-slate-600">
              {lang === 'es'
                ? 'Control de entrenamiento de 4 días en papel y digital organizado por Estación de Trabajo y Receta'
                : '4-day paper and digital training control sheet organized by Workstation and Recipe'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#DA291C] hover:bg-[#B91C1C] text-white text-xs sm:text-sm font-black cursor-pointer shadow-sm"
            >
              <Printer className="w-4 h-4 text-[#FFC72C]" />
              {lang === 'es' ? 'Imprimir Lista en Papel' : 'Print Paper Checklist'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center font-black cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filtros por Estación de Trabajo y Categoría (ocultos al imprimir) */}
        <div className="px-5 py-3 bg-[#FFFAF5] border-b border-slate-200 flex flex-wrap items-center gap-3 print:hidden">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                lang === 'es'
                  ? 'Buscar platillo, estación o ingrediente...'
                  : 'Search dish, station, or ingredient...'
              }
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 bg-white text-sm font-bold"
            />
          </div>

          <select
            value={selectedStation}
            onChange={(e) => setSelectedStation(e.target.value)}
            className="px-3.5 py-2 rounded-xl border-2 border-[#FFC72C] bg-white text-sm font-black text-[#0F172A] cursor-pointer"
          >
            <option value="ALL">
              {lang === 'es' ? '🔥 Todas las Estaciones de Trabajo' : '🔥 All Workstations'} (
              {recipeProducts.length})
            </option>
            {stationKeys.map((stKey) => (
              <option key={stKey} value={stKey}>
                {STATION_LABELS_MAP[stKey] || stKey}
              </option>
            ))}
          </select>

          <select
            value={selectedCat}
            onChange={(e) => setSelectedCat(e.target.value)}
            className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm font-bold cursor-pointer"
          >
            <option value="ALL">
              {lang === 'es' ? 'Todas las Categorías' : 'All Categories'}
            </option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {/* Contenido Imprimible y Digital */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4 print:overflow-visible print:p-2">
          {/* Encabezado de Hoja Impresa */}
          <div className="border-2 border-[#DA291C] rounded-2xl p-4 bg-[#FFFDF9]">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3">
              <div className="flex items-center gap-3">
                <img src="/logo.png" alt="Tacos Gavilan" className="w-12 h-12 object-contain" />
                <div>
                  <div className="text-xs font-black uppercase text-[#DA291C]">
                    TACOS GAVILAN • CONTROL OFICIAL DE ENTRENAMIENTO POR PUESTO Y ESTACIÓN (4 DÍAS)
                  </div>
                  <div className="text-lg font-black text-[#0F172A]">
                    Bitácora de Estaciones de Trabajo y Productos con Receta ({filtered.length}{' '}
                    Productos)
                  </div>
                </div>
              </div>
              <div className="text-xs font-bold text-slate-700 space-y-0.5 text-right">
                <div>
                  Sucursal: <strong>{storeName}</strong>
                </div>
                <div>
                  Colaborador: <strong>{employeeName || '______________________'}</strong>
                </div>
                <div>
                  Entrenador / Manager: <strong>{trainerName || '______________________'}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Tabla de todos los artículos vendidos con su estación y receta */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-[#0F172A] text-white uppercase font-black">
                  <th className="p-2.5 border border-slate-300">#</th>
                  <th className="p-2.5 border border-slate-300">
                    {lang === 'es'
                      ? 'Estación de Trabajo / Producto Vendido'
                      : 'Workstation / Sold Item'}
                  </th>
                  <th className="p-2.5 border border-slate-300">
                    {lang === 'es'
                      ? 'Receta Oficial en Sistema (Ingredientes y Medidas)'
                      : 'Official System Recipe (Ingredients & Portions)'}
                  </th>
                  <th className="p-2.5 border border-slate-300 text-center">
                    {lang === 'es' ? 'Día 1 (Video/Receta)' : 'Day 1 (Video/Recipe)'}
                  </th>
                  <th className="p-2.5 border border-slate-300 text-center">
                    {lang === 'es' ? 'Día 2 (Guiado)' : 'Day 2 (Guided)'}
                  </th>
                  <th className="p-2.5 border border-slate-300 text-center">
                    {lang === 'es' ? 'Día 3 (Lo Hace Solo)' : 'Day 3 (Solo)'}
                  </th>
                  <th className="p-2.5 border border-slate-300 text-center">
                    {lang === 'es' ? 'Día 4 (Certificado)' : 'Day 4 (Certified)'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((prod, idx) => (
                  <tr
                    key={prod.guid}
                    className={idx % 2 === 0 ? 'bg-white' : 'bg-[#FFFAF5]'}
                  >
                    <td className="p-2 border border-slate-300 font-black text-slate-500">
                      {idx + 1}
                    </td>
                    <td className="p-2 border border-slate-300">
                      <div className="text-[10px] font-black uppercase text-[#DA291C]">
                        {STATION_LABELS_MAP[prod.positionKey] || prod.positionKey}
                      </div>
                      <div className="font-black text-[#0F172A] text-xs sm:text-sm">
                        {prod.name}
                      </div>
                      {prod.variantsIncluded && prod.variantsIncluded.length > 1 && (
                        <div className="text-[10px] font-bold text-slate-600 mt-0.5 leading-snug">
                          <span className="text-[#DA291C] font-black">
                            Cubre {prod.variantCount || prod.variantsIncluded.length} variantes:
                          </span>{' '}
                          {prod.variantsIncluded.join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="p-2 border border-slate-300">
                      <div className="flex flex-wrap gap-1">
                        {prod.ingredients.map((ing, i) => (
                          <span
                            key={i}
                            className="inline-block px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-[11px] font-bold text-slate-800"
                          >
                            <strong>
                              {ing.quantity} {ing.unit}
                            </strong>{' '}
                            {ing.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    {(['d1', 'd2', 'd3', 'd4'] as const).map((dayKey) => {
                      const ck = `${prod.guid}-${dayKey}`;
                      const isChecked = !!digitalChecks[ck];
                      return (
                        <td
                          key={dayKey}
                          onClick={() => toggleCheck(ck)}
                          className="p-2 border border-slate-300 text-center cursor-pointer select-none"
                        >
                          <div
                            className={`w-5 h-5 mx-auto rounded border-2 flex items-center justify-center font-black text-xs ${
                              isChecked
                                ? 'bg-emerald-600 border-emerald-600 text-white'
                                : 'bg-white border-slate-400 text-transparent'
                            }`}
                          >
                            ✓
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
