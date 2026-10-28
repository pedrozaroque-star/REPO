/**
 * @module app/api/training/catalog/route
 * @description API de catálogo, antigüedad de empleados, recetas reales y configuración SOP para el
 * Módulo TRAINING (Academia SOP 4 Días Tacos Gavilan).
 *
 * @businessRules
 * - Cero datos ficticios: Todas las tiendas provienen de `public.stores` (`is_active = true`) y todos los empleados
 *   provienen directamente del Planificador (`toast_employees`, `toast_jobs`, `shifts`, `station_assignments`).
 * - Regla de Antigüedad (2+ Semanas = Certificado Oficial):
 *   * Todo empleado activo con 2 o más semanas (>= 14 días) en el Planificador (`shifts` / `toast_employees.created_date`)
 *     cuenta automáticamente con su Certificado Oficial (`auto_certified: true`, `is_new_hire: false`).
 *   * Solo los empleados de nuevo ingreso (`< 14 días` en el Planificador) se clasifican como `is_new_hire: true`.
 * - Sincronización con RONOS: Cruza con `ronos_employee_timecards_cache` para indicar sincronización de PIN de 4 dígitos.
 * - Catálogo Completo de Productos Vendidos con Receta:
 *   * Carga todos los artículos activos con receta en el sistema (`toast_menu_items` + `recipes` + `inventory_items`),
 *     vinculándolos con su video SOP en `public.training_sop_modules` y permitiendo subir, editar o eliminar su video
 *     y pasos narrados con la voz IA masculina (`Orus`).
 *
 * @dataFlow
 * - `GET /api/training/catalog` -> `{ ok: true, modules, positions, stores, employees, recipeProducts }`
 * - `PUT /api/training/catalog` -> actualiza pasos/receta/video en `public.training_sop_modules` + convierte texto a voz IA (`Orus`).
 * - `DELETE /api/training/catalog?slug=...` -> elimina el video asociado a un producto si cambia su procedimiento.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  DEFAULT_FOUR_DAY_METHOD,
  STATION_POSITIONS_CATALOG,
  TRAINING_SOP_VIDEOS,
  TrainingSopModuleSpec,
  TrainingVideoStep,
} from '@/lib/training-sop-catalog';
import {
  DEFAULT_TRAINING_VOICE,
  getTrainingStepSpeech,
  isValidTrainingVoice,
  TrainingVoiceId,
} from '@/lib/training-tts';
import { getPositionMatchCandidates, normalizeText } from '@/lib/actividades-resolution';
import { RONOS_STORES_MAP } from '@/lib/ronos-api';

export interface JobRoleStationSpec {
  stationKey: string;
  activitiesKeys: string[];
  order: number;
  labelEs: string;
  labelEn: string;
  shortDescEs: string;
  shortDescEn: string;
}

export interface JobRoleCertificationSpec {
  roleKey: 'COCINERO' | 'CAJERA' | 'LIDERAZGO';
  titleEs: string;
  titleEn: string;
  badgeEs: string;
  badgeEn: string;
  descriptionEs: string;
  descriptionEn: string;
  stations: JobRoleStationSpec[];
}

export const JOB_ROLES_CERTIFICATION_CATALOG: JobRoleCertificationSpec[] = [
  {
    roleKey: 'COCINERO',
    titleEs: 'Cocinero Certificado (Todas las Estaciones de Cocina)',
    titleEn: 'Certified Cook (All Kitchen Stations)',
    badgeEs: 'PUESTO: COCINERO',
    badgeEn: 'ROLE: COOK',
    descriptionEs:
      'En 4 días el Cocinero debe certificarse en las 6 estaciones de trabajo de cocina del módulo de Actividades y elaborar los productos con receta de cada estación.',
    descriptionEn:
      'Within 4 days the Cook must be certified across all 6 kitchen workstations from the Activities module and prepare all recipe products in each station.',
    stations: [
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
        activitiesKeys: ['TACOS', 'TACOS/BURRITOS (DT)'],
        order: 3,
        labelEs: '3. Tacos y Platos',
        labelEn: '3. Tacos & Plates',
        shortDescEs: 'Tacos (2 tortillas maíz + 1.5 oz carne), Taco Plate, Platos de Carne y Desayunos.',
        shortDescEn: 'Tacos (2 corn tortillas + 1.5 oz meat), Taco Plate, Meat Plates, and Breakfast plates.',
      },
      {
        stationKey: 'TORTAS/QUESADILLAS',
        activitiesKeys: ['TORTAS/QUESADILLAS', 'TORTAS/MULITAS', 'TORTAS/QUESADILLAS (DT)'],
        order: 4,
        labelEs: '4. Plancha de Tortas, Mulitas y Quesadillas',
        labelEn: '4. Tortas, Mulitas & Quesadillas Flat-Top',
        shortDescEs: 'Tortas en Telera (sin crema), Mulitas, Super Mulitas, Quesadillas y Super Quesadillas.',
        shortDescEn: 'Telera Tortas (no sour cream), Mulitas, Super Mulitas, Quesadillas, and Super Quesadillas.',
      },
      {
        stationKey: 'BURRITOS',
        activitiesKeys: ['BURRITOS', 'TACOS/BURRITOS (DT)'],
        order: 5,
        labelEs: '5. Burritos',
        labelEn: '5. Burritos, Sopes & Nachos',
        shortDescEs: 'Burritos Regulares, Super Burritos, Pura Carne, Burritos de Desayuno, Sopes y Super Nachos.',
        shortDescEn: 'Regular Burritos, Super Burritos, All-Meat Burritos, Breakfast Burritos, Sopes, and Super Nachos.',
      },
      {
        stationKey: 'PREPARACION',
        activitiesKeys: ['PREPARACION', 'CUBRIR DESCANSOS (COCINA)'],
        order: 6,
        labelEs: '6. Preparación',
        labelEn: '6. Kitchen Prep & Party Trays',
        shortDescEs: 'Arroz, Frijol, Cilindros de Crema y Aguacate, Salsas, Ollas y Party Trays (Catering).',
        shortDescEn: 'Rice, Beans, Sour Cream & Avocado Cylinders, Salsas, Pots, and Party Trays (Catering).',
      },
    ],
  },
  {
    roleKey: 'CAJERA',
    titleEs: 'Cajera Certificada (Caja, Salón, Entrega y Drive-Thru)',
    titleEn: 'Certified Cashier (Register, Dining Room, Expo & Drive-Thru)',
    badgeEs: 'PUESTO: CAJERA',
    badgeEn: 'ROLE: CASHIER',
    descriptionEs:
      'En 4 días la Cajera debe certificarse en todas las estaciones de servicio, bebidas, empaque blindado, entrega y Drive-Thru del módulo de Actividades.',
    descriptionEn:
      'Within 4 days the Cashier must be certified across all service, beverage, armored packing, expo, and Drive-Thru stations from the Activities module.',
    stations: [
      {
        stationKey: 'Caja 1 / Salón',
        activitiesKeys: ['Caja 1 / Salón', 'Caja 2', 'Caja 3'],
        order: 1,
        labelEs: '1. Caja 1, 2 y 3 / Bebidas y Postres',
        labelEn: '1. Registers 1–3 / Drinks & Desserts',
        shortDescEs: 'Toma de orden en POS, Aguas Frescas y Sodas (Medium 22 oz / Large 32 oz), Café, Champurrado y Postres.',
        shortDescEn: 'POS order entry, Aguas Frescas & Fountain Drinks (Medium 22 oz / Large 32 oz), Coffee, Champurrado & Desserts.',
      },
      {
        stationKey: 'Uber + Salsas',
        activitiesKeys: ['Uber + Salsas', 'ENTREGA'],
        order: 2,
        labelEs: '2. Uber + Salsas y Entrega (Expo)',
        labelEn: '2. Uber + Salsas & Order Handoff (Expo)',
        shortDescEs: 'Empaque Blindado con PIN RONOS, salsas Roja/Verde, limones/cebolla y entrega de órdenes.',
        shortDescEn: 'Armored Delivery Packing with RONOS PIN, Red/Green salsas, limes/onions, and order handoff.',
      },
      {
        stationKey: 'Ventana 1',
        activitiesKeys: ['Ventana 1', 'Ventana 2', 'Ventana 2 (B)'],
        order: 3,
        labelEs: '3. Drive-Thru (Ventana 1 y Ventana 2)',
        labelEn: '3. Drive-Thru (Window 1 & Window 2)',
        shortDescEs: 'Saludo inmediato por headset (< 5 seg), cobro ágil y entrega rápida en ventana.',
        shortDescEn: 'Immediate headset greeting (< 5 sec), fast cashiering, and rapid window handoff.',
      },
      {
        stationKey: 'LIMPIEZA',
        activitiesKeys: ['LIMPIEZA', 'CUBRIR DESCANSOS (SALÓN)'],
        order: 4,
        labelEs: '4. Limpieza de Salón y Baños',
        labelEn: '4. Dining Room & Restroom Upkeep',
        shortDescEs: 'Mesas, bancas, barra de salsas, vitroleros y sanitarios impecables durante el turno.',
        shortDescEn: 'Spotless tables, booths, salsa bar, vitroleros, and restrooms throughout the shift.',
      },
    ],
  },
  {
    roleKey: 'LIDERAZGO',
    titleEs: 'Líder de Turno / Manager Certificado (Dominio Total de Tienda)',
    titleEn: 'Certified Shift Leader / Manager (Full Store Mastery)',
    badgeEs: 'PUESTO: LIDERAZGO / MANAGER',
    badgeEn: 'ROLE: LEADERSHIP / MANAGER',
    descriptionEs:
      'Domina y supervisa todas las estaciones de Cocina (Carnes, Tortillas, Tacos, Plancha de Tortas/Mulitas/Quesadillas, Burritos y Preparación) más Caja, Entrega y Liderazgo.',
    descriptionEn:
      'Masters and supervises all Kitchen stations (Meats, Tortillas, Tacos, Tortas/Mulitas/Quesadillas Flat-Top, Burritos & Prep) plus Register, Expo, and Leadership.',
    stations: [
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
        shortDescEs: 'Tortillas de maíz y harina, vaporera, chips y papelito.',
        shortDescEn: 'Corn and flour tortillas, steamer, chips, and wax paper.',
      },
      {
        stationKey: 'TACOS',
        activitiesKeys: ['TACOS'],
        order: 3,
        labelEs: '3. Tacos y Platos',
        labelEn: '3. Tacos & Plates',
        shortDescEs: 'Tacos, Taco Plate, Platos de Carne y Desayunos.',
        shortDescEn: 'Tacos, Taco Plate, Meat Plates, and Breakfast plates.',
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
        shortDescEs: 'Burritos Regulares, Super Burritos, Pura Carne, Sopes y Super Nachos.',
        shortDescEn: 'Regular Burritos, Super Burritos, All-Meat Burritos, Sopes, and Super Nachos.',
      },
      {
        stationKey: 'PREPARACION',
        activitiesKeys: ['PREPARACION'],
        order: 6,
        labelEs: '6. Preparación',
        labelEn: '6. Kitchen Prep & Party Trays',
        shortDescEs: 'Arroz, Frijol, Cilindros de Crema y Aguacate, Salsas, Ollas y Party Trays.',
        shortDescEn: 'Rice, Beans, Sour Cream & Avocado Cylinders, Salsas, Pots, and Party Trays.',
      },
      {
        stationKey: 'Caja 1 / Salón',
        activitiesKeys: ['Caja 1 / Salón', 'Uber + Salsas', 'MANAGER', 'ASSISTANT', 'SHIFT_LEADER_MALE'],
        order: 7,
        labelEs: '7. Caja, Entrega y Supervisión de Turno',
        labelEn: '7. Register, Expo & Shift Supervision',
        shortDescEs: 'Bebidas, Empaque Blindado, Auditoría de Báscula y Liderazgo de Turno.',
        shortDescEn: 'Beverages, Armored Packing, Scale Auditing, and Shift Leadership.',
      },
    ],
  },
];

function resolveJobRoleFromTitles(titles: string[]): JobRoleCertificationSpec {
  const joined = titles.join(' ').toLowerCase();
  if (
    joined.includes('manager') ||
    joined.includes('shift leader') ||
    joined.includes('asst') ||
    joined.includes('assist') ||
    joined.includes('supervisor')
  ) {
    return JOB_ROLES_CERTIFICATION_CATALOG[2]; // LIDERAZGO
  }
  if (joined.includes('cashier') || joined.includes('cajera')) {
    return JOB_ROLES_CERTIFICATION_CATALOG[1]; // CAJERA
  }
  return JOB_ROLES_CERTIFICATION_CATALOG[0]; // COCINERO (Cook, Taquero, Preparador, Prep)
}

function inferStationFromJobTitles(titles: string[]): string {
  const roleSpec = resolveJobRoleFromTitles(titles);
  return roleSpec.stations[0]?.stationKey || 'CARNES';
}

function slugifyProductName(name: string): string {
  const norm = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\(in store\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const canonicalMap: Record<string, string> = {
    'burrito-asada': 'burrito-ok',
    'super-burrito-asada': 'super-burrito-asada',
    'plato-asada': 'plato-asada',
    'taco-plate': 'plato-tacos',
    'taco-asada': 'tacos-asada',
    'tacos-asada': 'tacos-asada',
    'quesadilla-asada': 'quesadilla',
    'super-quesadilla-asada': 'super-quesadilla-asada',
    'mulita-asada': 'mulita',
    'super-mulita-asada': 'super-mulita-asada',
    'torta-asada': 'torta',
    'side-order-carne': 'cocinar-asada',
    'sour-cream': 'preparar-cilindros-de-crema',
  };

  return canonicalMap[norm] || `recipe-${norm}`;
}

interface MasterCategoryRule {
  categoryKey: string;
  displayNameEs: string;
  displayCategoryEs: string;
  positionKey: string;
  preferredBaseNames: string[];
  canonicalVideoSlug?: string;
}

const MASTER_CATEGORY_RULES: MasterCategoryRule[] = [
  {
    categoryKey: 'CARNES_PARRILLA',
    displayNameEs: 'Cocción y Picado de Carne Asada (Base para todas las Carnes)',
    displayCategoryEs: 'Cocción de Carnes',
    positionKey: 'CARNES',
    preferredBaseNames: ['Side Order Carne'],
    canonicalVideoSlug: 'cocinar-asada',
  },
  {
    categoryKey: 'TORTILLAS_VAPORERA',
    displayNameEs: 'Tortillas de Maíz, Harina, Vaporera y Chips',
    displayCategoryEs: 'Tortillas',
    positionKey: 'TORTILLAS',
    preferredBaseNames: ['Tortilla de Maiz', 'Orden Harina', 'Chips'],
    canonicalVideoSlug: 'calentar-tortillas',
  },
  {
    categoryKey: 'TACOS_BASE_ASADA',
    displayNameEs: 'Taco de Asada (Base para todos los Tacos)',
    displayCategoryEs: 'Tacos',
    positionKey: 'TACOS',
    preferredBaseNames: ['Taco Asada'],
    canonicalVideoSlug: 'tacos-asada',
  },
  {
    categoryKey: 'TACO_PLATE_BASE',
    displayNameEs: 'Plato Combinación de Tacos (Taco Plate Asada)',
    displayCategoryEs: 'Combos / Taco Plate',
    positionKey: 'TACOS',
    preferredBaseNames: ['Taco Plate'],
    canonicalVideoSlug: 'plato-tacos',
  },
  {
    categoryKey: 'PLATOS_BASE_ASADA',
    displayNameEs: 'Plato de Carne Asada (Base para todos los Platos)',
    displayCategoryEs: 'Platos',
    positionKey: 'TACOS',
    preferredBaseNames: ['Plato Asada'],
    canonicalVideoSlug: 'plato-asada',
  },
  {
    categoryKey: 'DESAYUNOS_PLATO_ASADA',
    displayNameEs: 'Huevos con Asada (Base para Desayunos en Plato)',
    displayCategoryEs: 'Desayunos (Platos)',
    positionKey: 'TACOS',
    preferredBaseNames: ['Huevos con Asada', 'Huevos Rancheros'],
  },
  {
    categoryKey: 'TORTAS_BASE_ASADA',
    displayNameEs: 'Torta de Asada (Base para todas las Tortas)',
    displayCategoryEs: 'Tortas',
    positionKey: 'TORTAS/QUESADILLAS',
    preferredBaseNames: ['Torta Asada'],
    canonicalVideoSlug: 'torta',
  },
  {
    categoryKey: 'MULITAS_BASE_ASADA',
    displayNameEs: 'Mulita de Asada (Base para todas las Mulitas)',
    displayCategoryEs: 'Mulitas',
    positionKey: 'TORTAS/QUESADILLAS',
    preferredBaseNames: ['Mulita Asada'],
    canonicalVideoSlug: 'mulita',
  },
  {
    categoryKey: 'SUPER_MULITAS_BASE_ASADA',
    displayNameEs: 'Super Mulita de Asada (Base para todas las Super Mulitas)',
    displayCategoryEs: 'Super Mulitas',
    positionKey: 'TORTAS/QUESADILLAS',
    preferredBaseNames: ['Super Mulita Asada'],
    canonicalVideoSlug: 'super-mulita-asada',
  },
  {
    categoryKey: 'QUESADILLAS_BASE_ASADA',
    displayNameEs: 'Quesadilla de Asada (Base para todas las Quesadillas)',
    displayCategoryEs: 'Quesadillas',
    positionKey: 'TORTAS/QUESADILLAS',
    preferredBaseNames: ['Quesadilla Asada'],
    canonicalVideoSlug: 'quesadilla',
  },
  {
    categoryKey: 'SUPER_QUESADILLAS_BASE_ASADA',
    displayNameEs: 'Super Quesadilla de Asada (Base para todas las Super Quesadillas)',
    displayCategoryEs: 'Super Quesadillas',
    positionKey: 'TORTAS/QUESADILLAS',
    preferredBaseNames: ['Super Quesadilla Asada'],
    canonicalVideoSlug: 'super-quesadilla-asada',
  },
  {
    categoryKey: 'BURRITOS_BASE_ASADA',
    displayNameEs: 'Burrito de Asada (Base para todos los Burritos Regulares)',
    displayCategoryEs: 'Burritos',
    positionKey: 'BURRITOS',
    preferredBaseNames: ['Burrito Asada'],
    canonicalVideoSlug: 'burrito-ok',
  },
  {
    categoryKey: 'SUPER_BURRITOS_BASE_ASADA',
    displayNameEs: 'Super Burrito de Asada (Base para todos los Super Burritos)',
    displayCategoryEs: 'Super Burritos',
    positionKey: 'BURRITOS',
    preferredBaseNames: ['Super Burrito Asada'],
    canonicalVideoSlug: 'super-burrito-asada',
  },
  {
    categoryKey: 'PURA_CARNE_BURRITOS_ASADA',
    displayNameEs: 'Burrito Pura Carne de Asada (Base Pura Carne y Super PC)',
    displayCategoryEs: 'Pura Carne Burritos',
    positionKey: 'BURRITOS',
    preferredBaseNames: ['Meat Only Burrito Asada', 'Meat Only Super Burrito Asada'],
  },
  {
    categoryKey: 'BURRITOS_DESAYUNO_ASADA',
    displayNameEs: 'Burrito Huevos con Asada (Base para Burritos de Desayuno)',
    displayCategoryEs: 'Desayunos (Burritos)',
    positionKey: 'BURRITOS',
    preferredBaseNames: ['Burrito Huevos con Asada'],
  },
  {
    categoryKey: 'SOPES_BASE_ASADA',
    displayNameEs: 'Sope de Asada (Base para todos los Sopes)',
    displayCategoryEs: 'Sopes',
    positionKey: 'BURRITOS',
    preferredBaseNames: ['Sope Asada'],
  },
  {
    categoryKey: 'SUPER_NACHOS_BASE_ASADA',
    displayNameEs: 'Super Nachos de Asada (Base para todos los Super Nachos)',
    displayCategoryEs: 'Super Nachos',
    positionKey: 'BURRITOS',
    preferredBaseNames: ['Super Nachos Asada'],
  },
  {
    categoryKey: 'PREP_CREMA_GUACAMOLE',
    displayNameEs: 'Cilindros de Crema, Guacamole y Quesos (Porcionado Frío)',
    displayCategoryEs: 'Preparación Fría',
    positionKey: 'PREPARACION',
    preferredBaseNames: ['Sour Cream', 'Guacamole'],
    canonicalVideoSlug: 'preparar-cilindros-de-crema',
  },
  {
    categoryKey: 'PREP_ARROZ_FRIJOL',
    displayNameEs: 'Arroz, Frijol Frito y Frijol de la Olla',
    displayCategoryEs: 'Arroz y Frijol',
    positionKey: 'PREPARACION',
    preferredBaseNames: ['Side Order Beans/Rice', 'Rice', 'Beans'],
  },
  {
    categoryKey: 'PREP_PARTY_TRAYS',
    displayNameEs: 'Charolas para Fiestas / Party Trays (15-40 Personas Base Asada)',
    displayCategoryEs: 'Catering / Party Trays',
    positionKey: 'PREPARACION',
    preferredBaseNames: ['15 - 20 People', '20 - 25 People'],
  },
  {
    categoryKey: 'CAJA_AGUAS_SODAS',
    displayNameEs: 'Aguas Frescas y Refrescos (Mediana 22 oz y Grande 32 oz)',
    displayCategoryEs: 'Aguas Frescas y Bebidas',
    positionKey: 'Caja 1 / Salón',
    preferredBaseNames: ['Large Horchata', 'Medium Horchata'],
  },
  {
    categoryKey: 'CAJA_CALIENTES_POSTRES',
    displayNameEs: 'Café de Olla, Champurrado y Postres (Flan / Cheesecake)',
    displayCategoryEs: 'Bebidas Calientes y Postres',
    positionKey: 'Caja 1 / Salón',
    preferredBaseNames: ['Champurrado', 'Café de olla', 'Flan'],
  },
  {
    categoryKey: 'UBER_SALSAS_CONDIMENTOS',
    displayNameEs: 'Salsas Roja y Verde, Limones, Cebolla y Empaque',
    displayCategoryEs: 'Salsas y Condimentos',
    positionKey: 'Uber + Salsas',
    preferredBaseNames: ['Salsa Roja', 'Salsa Verde'],
  },
];

function classifyItemIntoMasterCategoryKey(cleanCategory: string, cleanName: string): string {
  const lowCat = String(cleanCategory || '').toLowerCase();
  const lowName = String(cleanName || '').toLowerCase();

  if (lowName.includes('side order carne') || lowName.includes('cocinar')) {
    return 'CARNES_PARRILLA';
  }
  if (
    lowName.includes('tortilla') ||
    lowName.includes('orden harina') ||
    lowName.includes('papelito') ||
    lowName === 'chips'
  ) {
    return 'TORTILLAS_VAPORERA';
  }
  if (lowCat === 'combos' || lowName === 'taco plate') {
    return 'TACO_PLATE_BASE';
  }
  if (lowCat === 'tacos' || lowName.startsWith('taco ')) {
    return 'TACOS_BASE_ASADA';
  }
  if (lowCat === 'platos' || lowName.startsWith('plato ')) {
    return 'PLATOS_BASE_ASADA';
  }
  if (lowName.startsWith('huevos ')) {
    return 'DESAYUNOS_PLATO_ASADA';
  }
  if (lowCat === 'super mulitas' || lowName.startsWith('super mulita')) {
    return 'SUPER_MULITAS_BASE_ASADA';
  }
  if (lowCat === 'mulitas' || lowName.startsWith('mulita')) {
    return 'MULITAS_BASE_ASADA';
  }
  if (lowCat === 'super quesadillas' || lowName.startsWith('super quesadilla')) {
    return 'SUPER_QUESADILLAS_BASE_ASADA';
  }
  if (lowCat === 'quesadillas' || lowName.startsWith('quesadilla')) {
    return 'QUESADILLAS_BASE_ASADA';
  }
  if (
    lowCat.includes('torta') ||
    lowName.startsWith('torta') ||
    lowName.startsWith('pan tostado')
  ) {
    return 'TORTAS_BASE_ASADA';
  }
  if (lowName.startsWith('burrito huevos')) {
    return 'BURRITOS_DESAYUNO_ASADA';
  }
  if (
    lowCat.includes('pura carne') ||
    lowCat.includes('super pc') ||
    lowName.startsWith('meat only')
  ) {
    return 'PURA_CARNE_BURRITOS_ASADA';
  }
  if (lowCat === 'super burritos' || lowName.startsWith('super burrito')) {
    return 'SUPER_BURRITOS_BASE_ASADA';
  }
  if (lowCat === 'sopes' || lowName.startsWith('sope')) {
    return 'SOPES_BASE_ASADA';
  }
  if (lowCat === 'super nachos' || lowName.startsWith('super nachos')) {
    return 'SUPER_NACHOS_BASE_ASADA';
  }
  if (lowCat === 'burritos' || lowName.startsWith('burrito')) {
    return 'BURRITOS_BASE_ASADA';
  }
  if (
    lowName.includes('people') ||
    lowName.includes('fiesta platter') ||
    lowName === 'full flan'
  ) {
    return 'PREP_PARTY_TRAYS';
  }
  if (
    lowName.includes('beans') ||
    lowName.includes('rice')
  ) {
    return 'PREP_ARROZ_FRIJOL';
  }
  if (
    lowName.includes('sour cream') ||
    lowName.includes('guacamole') ||
    lowName.includes('cheese') ||
    lowName.includes('cotija') ||
    lowName === 'egg'
  ) {
    return 'PREP_CREMA_GUACAMOLE';
  }
  if (
    lowCat.includes('condiments') ||
    lowName.includes('salsa') ||
    lowName === 'limes' ||
    lowName === 'onions' ||
    lowName.includes('frijol d/l/o')
  ) {
    return 'UBER_SALSAS_CONDIMENTOS';
  }
  if (
    lowCat.includes('fountain drinks') ||
    lowCat === 'medium drinks' ||
    lowName.includes('horchata') ||
    lowName.includes('jamaica') ||
    lowName.includes('tamarindo') ||
    lowName.includes('fanta') ||
    lowName.includes('coke') ||
    lowName.includes('sprite') ||
    lowName.includes('lemonade') ||
    lowName.includes('tea') ||
    lowName.includes('agua')
  ) {
    return 'CAJA_AGUAS_SODAS';
  }
  if (
    lowCat.includes('misc. drinks') ||
    lowCat.includes('desserts') ||
    lowName.includes('champurrado') ||
    lowName.includes('café') ||
    lowName.includes('coffee') ||
    lowName.includes('water') ||
    lowName === 'flan' ||
    lowName === 'cheesecake'
  ) {
    return 'CAJA_CALIENTES_POSTRES';
  }

  return 'BURRITOS_BASE_ASADA';
}

function inferPositionKeyFromCategory(category: string, name: string): string {
  const lowName = String(name || '').toLowerCase();
  const lowCat = String(category || '').toLowerCase();

  // 1. Estación CARNES (Cocción de Carnes)
  if (lowName.includes('side order carne') || lowName.includes('cocinar')) {
    return 'CARNES';
  }

  // 2. Estación TORTILLAS (Tortillas de Maíz, Harina, Vaporera, Chips y Papelito)
  if (
    lowName.includes('tortilla') ||
    lowName.includes('orden harina') ||
    lowName.includes('papelito') ||
    lowName === 'chips'
  ) {
    return 'TORTILLAS';
  }

  // 3. Estación PLANCHA DE TORTAS, MULITAS Y QUESADILLAS (TORTAS/QUESADILLAS)
  if (
    lowCat.includes('torta') ||
    lowCat.includes('mulita') ||
    lowCat.includes('quesadilla') ||
    lowName.startsWith('torta') ||
    lowName.startsWith('pan tostado') ||
    lowName.includes('mulita') ||
    lowName.includes('quesadilla')
  ) {
    return 'TORTAS/QUESADILLAS';
  }

  // 4. Estación TACOS (Tacos, Taco Plate, Platos y Desayunos en plato)
  if (
    lowCat.includes('tacos') ||
    lowCat.includes('platos') ||
    lowCat.includes('combos') ||
    lowName.startsWith('taco') ||
    lowName.startsWith('plato') ||
    lowName.startsWith('huevos ')
  ) {
    return 'TACOS';
  }

  // 5. Estación BURRITOS (Burritos, Super Burritos, Pura Carne, Burritos de Desayuno, Sopes, Super Nachos)
  if (
    lowCat.includes('burrito') ||
    lowCat.includes('sopes') ||
    lowCat.includes('super nachos') ||
    lowName.includes('burrito') ||
    lowName.startsWith('sope') ||
    lowName.startsWith('super nachos')
  ) {
    return 'BURRITOS';
  }

  // 6. Estación PREPARACION (Catering/Party Trays, Arroz, Frijol, Guacamole, Crema, Quesos, Ollas y Galones)
  if (
    lowCat.includes('catering') ||
    lowName.includes('people') ||
    lowName.includes('tray') ||
    lowName.includes('platter') ||
    lowName.startsWith('olla ') ||
    lowName.startsWith('gallon ') ||
    lowName.includes('guacamole') ||
    lowName.includes('sour cream') ||
    lowName.includes('beans') ||
    lowName.includes('rice') ||
    lowName.includes('cheese') ||
    lowName.includes('cotija') ||
    lowName === 'egg' ||
    lowName === 'full flan'
  ) {
    return 'PREPARACION';
  }

  // 7. Estación UBER + SALSAS / CONDIMENTOS
  if (
    lowCat.includes('condiments') ||
    lowName.includes('salsa') ||
    lowName === 'limes' ||
    lowName === 'onions' ||
    lowName.includes('frijol d/l/o')
  ) {
    return 'Uber + Salsas';
  }

  // 8. Estación CAJA 1 / SALÓN (Bebidas Grandes 32oz, Medianas 22oz, Café, Champurrado, Agua Embotellada y Postres)
  if (
    lowCat.includes('drinks') ||
    lowCat.includes('desserts') ||
    lowName.includes('horchata') ||
    lowName.includes('jamaica') ||
    lowName.includes('tamarindo') ||
    lowName.includes('coke') ||
    lowName.includes('sprite') ||
    lowName.includes('fanta') ||
    lowName.includes('lemonade') ||
    lowName.includes('tea') ||
    lowName.includes('champurrado') ||
    lowName.includes('café') ||
    lowName.includes('coffee') ||
    lowName.includes('water') ||
    lowName === 'flan' ||
    lowName === 'cheesecake'
  ) {
    return 'Caja 1 / Salón';
  }

  return 'BURRITOS';
}

function formatSecLabel(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

export async function GET() {
  try {
    const [
      dbModulesRes,
      paRes,
      storesRes,
      empRes,
      jobsRes,
      usersRes,
      assignRes,
      shiftsRes,
      ronosRes,
      menuItemsRes,
      recipesRes,
    ] = await Promise.all([
      supabaseAdmin
        .from('training_sop_modules')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      supabaseAdmin
        .from('position_activities')
        .select(
          'id, position_key, shift, frequency, store_model, sort_order, operating_procedures(id, activity, shift_type, frequency, description, start_time, duration_minutes)'
        )
        .order('sort_order', { ascending: true }),
      supabaseAdmin
        .from('stores')
        .select('id, code, name, external_id, supervisor_name, has_drive_thru, is_active')
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabaseAdmin
        .from('toast_employees')
        .select('id, toast_guid, first_name, last_name, chosen_name, email, phone, store_ids, job_references, sort_order, deleted, created_date, created_at')
        .eq('deleted', false)
        .order('sort_order', { ascending: true })
        .order('first_name', { ascending: true })
        .limit(1000),
      supabaseAdmin
        .from('toast_jobs')
        .select('id, guid, title'),
      supabaseAdmin
        .from('users')
        .select('id, full_name, email, role, store_id'),
      supabaseAdmin
        .from('station_assignments')
        .select('store_id, employee_id, main_station, assignment_date')
        .order('assignment_date', { ascending: false })
        .limit(1500),
      supabaseAdmin
        .from('shifts')
        .select('employee_id, start_time, created_at')
        .order('start_time', { ascending: true })
        .limit(5000),
      supabaseAdmin
        .from('ronos_employee_timecards_cache')
        .select('company_id, week_id, employee_user_id, employee_id, full_name, pin, job_title')
        .not('pin', 'is', null)
        .order('week_id', { ascending: false })
        .limit(3000),
      supabaseAdmin
        .from('toast_menu_items')
        .select('guid, name, group_name, price, is_modifier, active, recipe_na')
        .eq('active', true)
        .order('name', { ascending: true }),
      supabaseAdmin
        .from('recipes')
        .select('id, toast_menu_item_guid, quantity, unit, type, inventory_item:inventory_items(id, name, unit_measure)'),
    ]);

    const dbModules = dbModulesRes.data || [];
    const bySlug = new Map<string, any>();
    for (const row of dbModules) {
      bySlug.set(row.slug, row);
    }

    // Combinar módulos de DB con catálogo base respetando eliminaciones o reemplazos de video
    const modules: TrainingSopModuleSpec[] = TRAINING_SOP_VIDEOS.map((base) => {
      const dbRow = bySlug.get(base.slug);
      if (!dbRow) return base;
      const isVideoDeleted = dbRow.video_url === 'DELETED' || dbRow.video_url === '';
      return {
        slug: dbRow.slug,
        positionKey: dbRow.position_key || base.positionKey,
        groupKey: (dbRow.group_key as any) || base.groupKey,
        titleEs: dbRow.title_es || base.titleEs,
        titleEn: dbRow.title_en || base.titleEn,
        subtitleEs: dbRow.subtitle_es || base.subtitleEs,
        subtitleEn: dbRow.subtitle_en || base.subtitleEn,
        sourceVideoFilename: isVideoDeleted ? null : (dbRow.source_video_filename || base.sourceVideoFilename),
        videoSlug: isVideoDeleted ? null : (dbRow.video_slug || base.videoSlug),
        videoUrl: isVideoDeleted ? null : (dbRow.video_url || base.videoUrl),
        durationSeconds: Number(dbRow.duration_seconds || base.durationSeconds),
        targetPrepSeconds: Number(dbRow.target_prep_seconds || base.targetPrepSeconds),
        grillTempFahrenheit:
          dbRow.grill_temp_fahrenheit !== null && dbRow.grill_temp_fahrenheit !== undefined
            ? Number(dbRow.grill_temp_fahrenheit)
            : base.grillTempFahrenheit,
        steps:
          Array.isArray(dbRow.steps_json) && dbRow.steps_json.length > 0
            ? dbRow.steps_json
            : base.steps,
        recipeSpecs:
          Array.isArray(dbRow.recipe_specs_json) && dbRow.recipe_specs_json.length > 0
            ? dbRow.recipe_specs_json
            : base.recipeSpecs,
        quiz:
          Array.isArray(dbRow.quiz_json) && dbRow.quiz_json.length > 0
            ? dbRow.quiz_json
            : base.quiz,
        dayPlan:
          Array.isArray(dbRow.day_plan_json) && dbRow.day_plan_json.length > 0
            ? dbRow.day_plan_json
            : base.dayPlan || DEFAULT_FOUR_DAY_METHOD,
        sortOrder: Number(dbRow.sort_order || base.sortOrder),
      };
    });

    for (const dbRow of dbModules) {
      if (!TRAINING_SOP_VIDEOS.some((b) => b.slug === dbRow.slug)) {
        const isVideoDeleted = dbRow.video_url === 'DELETED' || dbRow.video_url === '';
        modules.push({
          slug: dbRow.slug,
          positionKey: dbRow.position_key || 'BURRITOS',
          groupKey: (dbRow.group_key as any) || 'cocina',
          titleEs: dbRow.title_es,
          titleEn: dbRow.title_en,
          subtitleEs: dbRow.subtitle_es || '',
          subtitleEn: dbRow.subtitle_en || '',
          sourceVideoFilename: isVideoDeleted ? null : dbRow.source_video_filename,
          videoSlug: isVideoDeleted ? null : dbRow.video_slug,
          videoUrl: isVideoDeleted ? null : dbRow.video_url,
          durationSeconds: Number(dbRow.duration_seconds || 60),
          targetPrepSeconds: Number(dbRow.target_prep_seconds || 60),
          grillTempFahrenheit: dbRow.grill_temp_fahrenheit,
          steps: Array.isArray(dbRow.steps_json) ? dbRow.steps_json : [],
          recipeSpecs: Array.isArray(dbRow.recipe_specs_json) ? dbRow.recipe_specs_json : [],
          quiz: Array.isArray(dbRow.quiz_json) ? dbRow.quiz_json : [],
          dayPlan: Array.isArray(dbRow.day_plan_json)
            ? dbRow.day_plan_json
            : DEFAULT_FOUR_DAY_METHOD,
          sortOrder: Number(dbRow.sort_order || 99),
        });
      }
    }

    const moduleBySlug = new Map<string, TrainingSopModuleSpec>();
    for (const m of modules) {
      moduleBySlug.set(m.slug, m);
    }

    const allPositionActivities = paRes.data || [];

    const positions = STATION_POSITIONS_CATALOG.map((pos) => {
      const candidates = new Set(
        getPositionMatchCandidates(pos.positionKey).map(normalizeText)
      );
      if (pos.positionKey === 'ACTIVIDADES EXTRA 1') {
        for (let i = 1; i <= 6; i++) {
          candidates.add(normalizeText(`ACTIVIDADES EXTRA ${i}`));
        }
      }
      if (pos.positionKey === 'SHIFT_LEADER_MALE') {
        candidates.add(normalizeText('SHIFT_LEADER_FEMALE'));
      }

      const matched = allPositionActivities.filter((pa: any) =>
        candidates.has(normalizeText(pa.position_key || ''))
      );

      const seenIds = new Set<string>();
      const activities = [];
      for (const pa of matched) {
        const proc = Array.isArray(pa.operating_procedures)
          ? pa.operating_procedures[0]
          : pa.operating_procedures;
        if (!proc || !proc.activity) continue;
        const uniqueKey = `${proc.activity}:${pa.shift}`;
        if (seenIds.has(uniqueKey)) continue;
        seenIds.add(uniqueKey);
        activities.push({
          id: proc.id || pa.id,
          activity: proc.activity,
          shiftType: proc.shift_type || 'Regular',
          shift: pa.shift || 'AMBOS',
          frequency: pa.frequency || proc.frequency || 'Diario',
          description: proc.description || '',
          durationMinutes: proc.duration_minutes || 15,
        });
      }

      return {
        ...pos,
        activities,
      };
    });

    // Mapear Toast Jobs por GUID
    const jobByGuid = new Map<string, string>();
    for (const j of jobsRes.data || []) {
      if (j.guid && j.title) {
        jobByGuid.set(String(j.guid), String(j.title).trim());
      }
    }

    // Mapear última estación asignada por empleado en Actividades
    const latestStationByEmployeeId = new Map<string, string>();
    for (const a of assignRes.data || []) {
      if (a.employee_id && a.main_station && !latestStationByEmployeeId.has(String(a.employee_id))) {
        latestStationByEmployeeId.set(String(a.employee_id), String(a.main_station));
      }
    }

    // Mapear fecha más antigua en el Planificador (shifts)
    const earliestShiftByEmp = new Map<string, string>();
    for (const s of shiftsRes.data || []) {
      const dt = s.start_time || s.created_at;
      if (!s.employee_id || !dt) continue;
      const empId = String(s.employee_id);
      const prev = earliestShiftByEmp.get(empId);
      if (!prev || dt < prev) {
        earliestShiftByEmp.set(empId, dt);
      }
    }

    // Mapear empleados de RONOS por nombre normalizado
    const ronosByNormName = new Map<string, { employeeUserId: number; companyId: number; jobTitle: string }>();
    for (const r of ronosRes.data || []) {
      const normName = normalizeText(String(r.full_name || ''));
      if (normName && !ronosByNormName.has(normName)) {
        ronosByNormName.set(normName, {
          employeeUserId: Number(r.employee_user_id || r.employee_id || 0),
          companyId: Number(r.company_id || 0),
          jobTitle: String(r.job_title || 'Colaborador'),
        });
      }
    }

    // Identificar administradores/supervisores globales para no mezclarlos como aprendices de línea
    const allUsers = usersRes.data || [];
    const globalCorporateNames = new Set(
      allUsers
        .filter((u: any) => !u.store_id && ['admin', 'supervisor'].includes(String(u.role || '').toLowerCase()))
        .map((u: any) => String(u.full_name || '').toLowerCase().trim())
        .filter(Boolean)
    );

    // Enriquecer las 15 sucursales reales con sus Managers y Asistentes reales
    const rawStores = storesRes.data || [];
    const storeByExtId = new Map<string, any>();
    const stores = rawStores.map((st: any) => {
      if (st.external_id) storeByExtId.set(String(st.external_id), st);
      const storeManagers = allUsers
        .filter(
          (u: any) =>
            Number(u.store_id) === Number(st.id) &&
            ['manager', 'asistente', 'gerente'].includes(String(u.role || '').toLowerCase())
        )
        .sort((a: any, b: any) => {
          const rA = String(a.role || '').toLowerCase() === 'manager' ? 0 : 1;
          const rB = String(b.role || '').toLowerCase() === 'manager' ? 0 : 1;
          return rA - rB;
        })
        .map((u: any) => ({
          id: u.id,
          fullName: String(u.full_name || '').trim(),
          role: u.role,
        }));

      const ronosInfo = RONOS_STORES_MAP.find((r) => r.tegStoreId === Number(st.id));

      return {
        id: st.id,
        code: st.code,
        name: String(st.name || '').replace(/toast/i, '').trim(),
        external_id: st.external_id,
        supervisor_name: st.supervisor_name,
        has_drive_thru: Boolean(st.has_drive_thru),
        ronos_company_id: ronosInfo?.ronosCompanyId || null,
        managers: storeManagers,
      };
    });

    const nowMs = Date.now();

    // Enriquecer los empleados reales del Planificador (toast_employees) con regla de 2+ semanas
    const employees = (empRes.data || [])
      .map((emp: any) => {
        const first = String(emp.chosen_name || emp.first_name || '').trim();
        const last = String(emp.last_name || '').trim();
        const fullName = `${first} ${last}`.replace(/\s+/g, ' ').trim();
        const jobRefs = Array.isArray(emp.job_references) ? emp.job_references : [];
        const jobTitles: string[] = Array.from(
          new Set<string>(
            jobRefs
              .map((jr: any) => jobByGuid.get(String(jr?.guid || '')) || String(jr?.title || ''))
              .map((t: string) => t.trim())
              .filter(Boolean)
          )
        );
        const storeIds = Array.isArray(emp.store_ids)
          ? emp.store_ids.map(String)
          : typeof emp.store_ids === 'string'
          ? [emp.store_ids]
          : [];

        const roleSpec = resolveJobRoleFromTitles(jobTitles);
        const assignedStation =
          latestStationByEmployeeId.get(String(emp.id)) ||
          roleSpec.stations[0]?.stationKey ||
          'CARNES';

        const isLeader = roleSpec.roleKey === 'LIDERAZGO';

        // Calcular antigüedad real en el Planificador (shifts / created_date)
        const shiftDt = earliestShiftByEmp.get(String(emp.id));
        const toastCreatedDt = emp.created_date || emp.created_at;
        let firstSeenIso = toastCreatedDt || shiftDt || new Date(nowMs - 30 * 86400000).toISOString();
        if (shiftDt && toastCreatedDt) {
          firstSeenIso = shiftDt < toastCreatedDt ? shiftDt : toastCreatedDt;
        }
        const firstSeenMs = new Date(firstSeenIso).getTime();
        const tenureDays = Number.isFinite(firstSeenMs)
          ? Math.max(0, Math.floor((nowMs - firstSeenMs) / (1000 * 60 * 60 * 24)))
          : 30;
        const tenureWeeks = Math.floor(tenureDays / 7);

        // Regla de Negocio: 2 o más semanas (>= 14 días) en el Planificador = Ya Certificado Oficialmente en su Puesto
        const autoCertified = tenureDays >= 14;
        const isNewHire = tenureDays < 14;
        const shortEmpHash = String(emp.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
        const certificateFolio = `TG-CERT-2026-${shortEmpHash}`;

        const normFullName = normalizeText(fullName);
        const ronosMatch = ronosByNormName.get(normFullName) || null;

        return {
          id: String(emp.id),
          toast_guid: emp.toast_guid,
          first_name: String(emp.first_name || '').trim(),
          last_name: String(emp.last_name || '').trim(),
          full_name: fullName,
          email: emp.email || null,
          phone: emp.phone || null,
          store_ids: storeIds,
          job_titles: jobTitles,
          job_role_key: roleSpec.roleKey,
          job_role_title_es: roleSpec.titleEs,
          job_role_title_en: roleSpec.titleEn,
          job_role_badge_es: roleSpec.badgeEs,
          job_role_badge_en: roleSpec.badgeEn,
          required_stations: roleSpec.stations,
          assigned_station: assignedStation,
          is_leader: isLeader,
          sort_order: Number(emp.sort_order || 999),
          first_seen_date: firstSeenIso,
          tenure_days: tenureDays,
          tenure_weeks: tenureWeeks,
          is_new_hire: isNewHire,
          auto_certified: autoCertified,
          certificate_folio: certificateFolio,
          ronos_synced: Boolean(ronosMatch),
          ronos_employee_id: ronosMatch?.employeeUserId || null,
        };
      })
      .filter((emp) => {
        const lowName = emp.full_name.toLowerCase();
        if (!lowName) return false;
        if (lowName.includes('default online ordering') || lowName.includes('kds')) return false;
        if (globalCorporateNames.has(lowName)) return false;
        if (emp.job_titles.some((j) => j.toLowerCase().includes('super user') || j.toLowerCase().includes('kds'))) {
          const hasStoreJob = emp.job_titles.some((j) =>
            ['manager', 'asst manager', 'shift leader', 'cashier', 'cook', 'prep', 'taquero', 'preparador'].includes(
              j.toLowerCase()
            )
          );
          if (!hasStoreJob) return false;
        }
        return true;
      });

    // Construir el Catálogo Completo de Productos Vendidos con Receta (toast_menu_items + recipes + inventory_items)
    const recipesByGuid = new Map<string, any[]>();
    for (const r of recipesRes.data || []) {
      const g = String(r.toast_menu_item_guid || '');
      if (!g) continue;
      if (!recipesByGuid.has(g)) recipesByGuid.set(g, []);
      recipesByGuid.get(g)!.push(r);
    }

    const rawMenuItems = (menuItemsRes.data || []).filter(
      (m: any) => !m.is_modifier && !m.recipe_na && (recipesByGuid.get(String(m.guid))?.length || 0) > 0
    );

    const uniqueMenuByName = new Map<string, any>();
    for (const m of rawMenuItems) {
      const cleanName = String(m.name || '')
        .replace(/\(in store\)/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      const key = cleanName.toLowerCase();
      const existing = uniqueMenuByName.get(key);
      const isInStore = String(m.group_name || '').toLowerCase().includes('in store');
      if (
        !existing ||
        (isInStore && !String(existing.group_name || '').toLowerCase().includes('in store'))
      ) {
        uniqueMenuByName.set(key, { ...m, cleanName });
      }
    }

    const allRawRecipeItems = Array.from(uniqueMenuByName.values()).map((item: any) => {
      const slug = slugifyProductName(item.cleanName);
      const rawIngredients = recipesByGuid.get(String(item.guid)) || [];

      const cleanCategory = String(item.group_name || 'Menú General')
        .replace(/In Store Menu\s*>\s*/i, '')
        .replace(/In Store Drinks\s*>\s*/i, '')
        .replace(/3rd Party Menu\s*>\s*/i, '')
        .replace(/Online Drinks\s*>\s*/i, '')
        .replace(/\(In Store\)/gi, '')
        .trim();

      const ingredients = rawIngredients.map((ing: any) => {
        const inv = Array.isArray(ing.inventory_item) ? ing.inventory_item[0] : ing.inventory_item;
        const rawName = String(inv?.name || 'Ingrediente').trim();
        const unit = String(ing.unit || inv?.unit_measure || 'oz').trim();
        const qty = Number(ing.quantity || 0);
        return {
          id: ing.id,
          name: rawName,
          quantity: qty,
          unit,
          type: String(ing.type || 'food'),
        };
      });

      const masterCategoryKey = classifyItemIntoMasterCategoryKey(cleanCategory, item.cleanName);

      return {
        guid: String(item.guid),
        slug,
        name: item.cleanName,
        category: cleanCategory,
        price: Number(item.price || 0),
        ingredients,
        masterCategoryKey,
      };
    });

    // Agrupar por Categoría Maestra usando SIEMPRE el platillo de Asada (o base de la categoría)
    // para que el entrenamiento sea ágil por categoría y no muestre 225 variantes repetitivas de proteína
    const itemsByMasterKey = new Map<string, typeof allRawRecipeItems>();
    for (const rawItem of allRawRecipeItems) {
      const list = itemsByMasterKey.get(rawItem.masterCategoryKey) || [];
      list.push(rawItem);
      itemsByMasterKey.set(rawItem.masterCategoryKey, list);
    }

    const recipeProducts = MASTER_CATEGORY_RULES.map((rule) => {
      const groupItems = itemsByMasterKey.get(rule.categoryKey) || [];
      if (groupItems.length === 0) return null;

      // Elegir como platillo maestro el de Asada (según preferredBaseNames o coincidencia con "asada")
      let baseItem =
        groupItems.find((it) =>
          rule.preferredBaseNames.some((pref) => it.name.toLowerCase() === pref.toLowerCase())
        ) ||
        groupItems.find((it) => it.name.toLowerCase().includes('asada')) ||
        groupItems[0];

      const effectiveSlug = rule.canonicalVideoSlug || baseItem.slug;
      const linkedModule =
        moduleBySlug.get(effectiveSlug) || moduleBySlug.get(baseItem.slug) || null;

      const defaultStepsFromRecipe: TrainingVideoStep[] = baseItem.ingredients.map((ing, idx) => {
        const startSec = idx * 6;
        const endSec = startSec + 6;
        return {
          id: `${effectiveSlug}-step-${idx + 1}`,
          stepNumber: idx + 1,
          startSec,
          endSec,
          timestampLabel: `${formatSecLabel(startSec)} - ${formatSecLabel(endSec)}`,
          titleEs: `Paso ${idx + 1}: ${ing.name}`,
          titleEn: `Step ${idx + 1}: ${ing.name}`,
          narrationEs: `Paso ${idx + 1} para ${baseItem.name}: agrega exactamente ${ing.quantity} ${ing.unit} de ${ing.name}.`,
          narrationEn: `Step ${idx + 1} for ${baseItem.name}: add exactly ${ing.quantity} ${ing.unit} of ${ing.name}.`,
          keyPortionEs: `${ing.quantity} ${ing.unit} ${ing.name}`,
          keyPortionEn: `${ing.quantity} ${ing.unit} ${ing.name}`,
          utensilEs: ing.unit === 'oz' ? 'Porcionador / Báscula oficial' : 'Pinza / Mano enguantada',
          utensilEn: ing.unit === 'oz' ? 'Official scoop / Scale' : 'Tongs / Gloved hand',
        };
      });

      const effectiveSteps =
        linkedModule && Array.isArray(linkedModule.steps) && linkedModule.steps.length > 0
          ? linkedModule.steps
          : defaultStepsFromRecipe;

      const effectiveRecipeSpecs =
        linkedModule && Array.isArray(linkedModule.recipeSpecs) && linkedModule.recipeSpecs.length > 0
          ? linkedModule.recipeSpecs
          : baseItem.ingredients.map((ing) => ({
              itemEs: ing.name,
              itemEn: ing.name,
              quantity: String(ing.quantity),
              unit: ing.unit,
              utensilEs: ing.unit === 'oz' ? 'Medida oficial' : 'Estándar de línea',
              utensilEn: ing.unit === 'oz' ? 'Official measure' : 'Line standard',
            }));

      const variantsIncluded = groupItems
        .map((g) => g.name)
        .sort((a, b) => {
          const aAsada = a.toLowerCase().includes('asada') ? 0 : 1;
          const bAsada = b.toLowerCase().includes('asada') ? 0 : 1;
          if (aAsada !== bAsada) return aAsada - bAsada;
          return a.localeCompare(b);
        });

      return {
        guid: baseItem.guid,
        slug: effectiveSlug,
        name: rule.displayNameEs,
        baseProductName: baseItem.name,
        category: rule.displayCategoryEs,
        price: baseItem.price,
        positionKey: rule.positionKey,
        hasVideo: Boolean(linkedModule?.videoUrl),
        videoUrl: linkedModule?.videoUrl || null,
        sourceVideoFilename: linkedModule?.sourceVideoFilename || null,
        durationSeconds: linkedModule?.durationSeconds || Math.max(24, baseItem.ingredients.length * 6),
        targetPrepSeconds: linkedModule?.targetPrepSeconds || 45,
        grillTempFahrenheit: linkedModule?.grillTempFahrenheit ?? null,
        ingredients: baseItem.ingredients,
        steps: effectiveSteps,
        recipeSpecs: effectiveRecipeSpecs,
        variantCount: variantsIncluded.length,
        variantsIncluded,
      };
    }).filter((x): x is NonNullable<typeof x> => Boolean(x));

    return NextResponse.json({
      ok: true,
      modules,
      positions,
      jobRoles: JOB_ROLES_CERTIFICATION_CATALOG,
      stores,
      employees,
      recipeProducts,
    });
  } catch (err: any) {
    console.error('[GET /api/training/catalog] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error al cargar catálogo de entrenamiento' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      slug,
      positionKey,
      titleEs,
      titleEn,
      subtitleEs,
      subtitleEn,
      videoUrl,
      sourceVideoFilename,
      durationSeconds,
      targetPrepSeconds,
      grillTempFahrenheit,
      steps,
      recipeSpecs,
      quiz,
      voiceId,
      regenerateVoice = true,
    } = body || {};

    if (!slug || typeof slug !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Se requiere el identificador del módulo (slug)' },
        { status: 400 }
      );
    }

    const baseModule = TRAINING_SOP_VIDEOS.find((m) => m.slug === slug);
    const { data: existingRow } = await supabaseAdmin
      .from('training_sop_modules')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();

    const selectedVoice: TrainingVoiceId = isValidTrainingVoice(voiceId)
      ? voiceId
      : DEFAULT_TRAINING_VOICE;

    let updatedSteps: TrainingVideoStep[] = Array.isArray(steps)
      ? [...steps]
      : existingRow?.steps_json || baseModule?.steps || [];

    // Ordenar pasos cronológicamente por startSec y renumerar 1..N
    updatedSteps.sort((a, b) => Number(a.startSec || 0) - Number(b.startSec || 0));
    updatedSteps = updatedSteps.map((st, idx) => {
      const sSec = Math.max(0, Number(st.startSec || 0));
      const eSec = Math.max(sSec + 2, Number(st.endSec || sSec + 6));
      return {
        ...st,
        id: st.id || `${slug}-step-${idx + 1}`,
        stepNumber: idx + 1,
        startSec: sSec,
        endSec: eSec,
        timestampLabel: `${formatSecLabel(sSec)} - ${formatSecLabel(eSec)}`,
      };
    });

    if (regenerateVoice && updatedSteps.length > 0) {
      const syncedSteps: TrainingVideoStep[] = [];
      for (const st of updatedSteps) {
        let audioUrlEs = st.audioUrlEs;
        let audioUrlEn = st.audioUrlEn;

        if (st.narrationEs) {
          try {
            const ttsEs = await getTrainingStepSpeech(
              st.narrationEs,
              'es',
              selectedVoice
            );
            audioUrlEs = ttsEs.publicUrl;
          } catch (e) {
            console.warn('[PUT /api/training/catalog] TTS ES fallback:', e);
          }
        }

        if (st.narrationEn) {
          try {
            const ttsEn = await getTrainingStepSpeech(
              st.narrationEn,
              'en',
              selectedVoice
            );
            audioUrlEn = ttsEn.publicUrl;
          } catch (e) {
            console.warn('[PUT /api/training/catalog] TTS EN fallback:', e);
          }
        }

        syncedSteps.push({
          ...st,
          audioUrlEs,
          audioUrlEn,
        });
      }
      updatedSteps = syncedSteps;
    }

    const resolvedVideoUrl =
      videoUrl !== undefined
        ? videoUrl
        : existingRow?.video_url ?? baseModule?.videoUrl ?? null;

    const upsertPayload = {
      slug,
      position_key: positionKey || existingRow?.position_key || baseModule?.positionKey || 'BURRITOS',
      group_key: existingRow?.group_key || baseModule?.groupKey || 'cocina',
      title_es: titleEs ?? existingRow?.title_es ?? baseModule?.titleEs ?? slug,
      title_en: titleEn ?? existingRow?.title_en ?? baseModule?.titleEn ?? slug,
      subtitle_es: subtitleEs ?? existingRow?.subtitle_es ?? baseModule?.subtitleEs ?? '',
      subtitle_en: subtitleEn ?? existingRow?.subtitle_en ?? baseModule?.subtitleEn ?? '',
      source_video_filename:
        sourceVideoFilename !== undefined
          ? sourceVideoFilename
          : existingRow?.source_video_filename || baseModule?.sourceVideoFilename || null,
      video_slug: existingRow?.video_slug || baseModule?.videoSlug || slug,
      video_url: resolvedVideoUrl,
      duration_seconds:
        durationSeconds !== undefined
          ? Number(durationSeconds)
          : existingRow?.duration_seconds || baseModule?.durationSeconds || 60,
      target_prep_seconds:
        targetPrepSeconds !== undefined
          ? Number(targetPrepSeconds)
          : existingRow?.target_prep_seconds || baseModule?.targetPrepSeconds || 60,
      grill_temp_fahrenheit:
        grillTempFahrenheit !== undefined
          ? grillTempFahrenheit
          : existingRow?.grill_temp_fahrenheit ?? baseModule?.grillTempFahrenheit ?? null,
      steps_json: updatedSteps,
      recipe_specs_json:
        Array.isArray(recipeSpecs)
          ? recipeSpecs
          : existingRow?.recipe_specs_json || baseModule?.recipeSpecs || [],
      quiz_json:
        Array.isArray(quiz) ? quiz : existingRow?.quiz_json || baseModule?.quiz || [],
      day_plan_json:
        existingRow?.day_plan_json || baseModule?.dayPlan || DEFAULT_FOUR_DAY_METHOD,
      voice_id: selectedVoice,
      sort_order: existingRow?.sort_order ?? baseModule?.sortOrder ?? 50,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    const { data: savedRow, error: saveError } = await supabaseAdmin
      .from('training_sop_modules')
      .upsert(upsertPayload, { onConflict: 'slug' })
      .select('*')
      .single();

    if (saveError) {
      throw saveError;
    }

    return NextResponse.json({
      ok: true,
      module: savedRow,
      steps: updatedSteps,
    });
  } catch (err: any) {
    console.error('[PUT /api/training/catalog] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error al guardar módulo de entrenamiento' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get('slug');

    if (!slug) {
      return NextResponse.json(
        { ok: false, error: 'Se requiere el parámetro slug para eliminar el video.' },
        { status: 400 }
      );
    }

    const baseModule = TRAINING_SOP_VIDEOS.find((m) => m.slug === slug);
    const { data: existingRow } = await supabaseAdmin
      .from('training_sop_modules')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();

    const upsertPayload = {
      slug,
      position_key: existingRow?.position_key || baseModule?.positionKey || 'BURRITOS',
      group_key: existingRow?.group_key || baseModule?.groupKey || 'cocina',
      title_es: existingRow?.title_es || baseModule?.titleEs || slug,
      title_en: existingRow?.title_en || baseModule?.titleEn || slug,
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
    };

    const { data: updatedRow, error } = await supabaseAdmin
      .from('training_sop_modules')
      .upsert(upsertPayload, { onConflict: 'slug' })
      .select('*')
      .single();

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      message: 'Video eliminado del producto correctamente.',
      module: updatedRow,
    });
  } catch (err: any) {
    console.error('[DELETE /api/training/catalog] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error al eliminar el video del producto.' },
      { status: 500 }
    );
  }
}
