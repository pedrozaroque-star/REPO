
export const DAILY_QUESTIONS = [
    'Todo el equipo alcanza la temperatura adecuada',
    'Cubeta roja de sanitizante bajo línea @ 200ppm',
    'Máquina de hielo limpia',
    'Área del trapeador limpia',
    'Microondas está limpio',
    'Estaciones de champurrado limpias',
    'Baño de empleados limpio',
    'Tanque de gas de refrescos lleno',
    'Checklists siendo usados',
    'Food Handler visible',
    'Se saluda a clientes dentro de 5 segundos',
    'Hacemos contacto visual con el cliente',
    'Ventanas limpias',
    'Baños limpios',
    'Estacionamiento limpio',
    'TVs funcionando',
    'Toda la iluminación funciona',
    'Mesas y sillas limpias',
    'Todas las luces funcionan',
    'Acero inoxidable limpio',
    'Rebanadoras y tijeras limpias',
    'Drenajes limpios',
    'Pisos y zócalos limpios',
    'Lavado de manos frecuente',
    'Área de escoba organizada',
    'Se utiliza FIFO',
    'Trapos en sanitizante',
    'Expedidor anuncia órdenes',
    'Cámaras funcionando',
    'SOS/DT Time visible',
    'Management consciente',
    'Manejo de efectivo correcto',
    'Reparaciones reportadas',
    'AC limpio'
]

export const DAILY_LEGACY_KEYS: Record<string, string> = {
    'temp_equipment': 'Todo el equipo alcanza la temperatura adecuada',
    'lights_working': 'Toda la iluminación funciona',
    'steel_clean': 'Acero inoxidable limpio',
    'sanitizer_bucket': 'Cubeta roja de sanitizante bajo línea @ 200ppm',
    'slicers_scissors': 'Rebanadoras y tijeras limpias',
    'ice_machine': 'Máquina de hielo limpia',
    'drains_clean': 'Drenajes limpios',
    'floors_baseboards': 'Pisos y zócalos limpios',
    'mop_sink': 'Área del trapeador limpia',
    'microwave': 'Microondas está limpio',
    'handwashing': 'Lavado de manos frecuente',
    'broom_area': 'Área de escoba organizada',
    'champurrado': 'Estaciones de champurrado limpias',
    'employee_bathroom': 'Baño de empleados limpio',
    'fifo': 'Se utiliza FIFO',
    'towels_sanitizer': 'Trapos en sanitizante',
    'expediter': 'Expedidor anuncia órdenes',
    'soda_tank': 'Tanque de gas de refrescos lleno',
    'greeting_5sec': 'Se saluda a clientes dentro de 5 segundos',
    'eye_contact': 'Hacemos contacto visual con el cliente',
    'windows_clean': 'Ventanas limpias',
    'bathrooms': 'Baños limpios',
    'parking_lot': 'Estacionamiento limpio',
    'tv_ac': 'TVs funcionando y AC limpio',
    'lighting': 'Todas las luces funcionan',
    'tables_chairs': 'Mesas y sillas limpias',
    'cameras': 'Cámaras funcionando',
    'food_handler': 'Food Handler visible',
    'checklists_used': 'Checklists siendo usados',
    'mgmt_aware': 'Management consciente',
    'sos_dt_time': 'SOS/DT Time visible',
    'cash_handling': 'Manejo de efectivo correcto',
    'repairs_reported': 'Reparaciones reportadas',
    'soda_co2': 'Soda CO2'
}

/**
 * @deprecated Legacy static questions. New checklists use dynamic templates from Supabase.
 * Kept for viewing historical records.
 */
export const RECORRIDO_QUESTIONS = [
    'Quitar publicidad y promociones vencidas',
    'Barrer todas las áreas',
    'Barrer y trapear cocinas',
    'Cambiar bolsas de basura',
    'Limpieza de baños',
    'Limpiar ventanas y puertas',
    'Limpiar mesas y sillas',
    'Organizar área de basura',
    'Limpiar refrigeradores',
    'Limpiar estufas y planchas',
    'Limpiar campanas',
    'Revisar inventario de limpieza',
    'Reportar reparaciones necesarias'
]

export const RECORRIDO_LEGACY_KEYS: Record<string, string> = {
    'quitar_publicidad': 'Quitar publicidad y promociones vencidas',
    'barrer_areas': 'Barrer todas las áreas',
    'barrer_trapear_cocinas': 'Barrer y trapear cocinas',
    'cambiar_bolsas': 'Cambiar bolsas de basura',
    'limpieza_banos': 'Limpieza de baños',
    'limpieza_parking': 'Limpieza de estacionamiento'
}

/**
 * @deprecated Legacy static questions. New checklists use dynamic templates from Supabase.
 * Kept for viewing historical records.
 */
export const CIERRE_QUESTIONS = [
    'Vaporera lavada',
    'Olla del champurrado',
    'Ollas de los frijoles',
    'Refrigerador limpio y acomodado el producto',
    'Cocina barrida y trapeada',
    'Coladeras limpias y poner cloro',
    'Charolas rojas limpias y secas',
    'Trastes acomodados y limpios',
    'Botes de basura vacios y con bolsa',
    'Trapeadores lavados y limpios',
    'Contenedor de la grasa limpio y tapado',
    'Contenedor de basura limpio y tapado',
    'Trapos en agua caliente y con jabon (no cloro)',
    'Cuarto de descanso limpio (Lockers)',
    'Refrigerador de empleados limpio',
    'Bote de champurrado limpio',
    'Ollas de cafe limpias',
    'Productos de limpieza en su lugar asignado',
    'Planchas apagadas y lavadas',
    'Vaporera de tortillas limpia y apagada',
    'Filtros en acido y ventana de plastico limpia',
    'Contenedores de grasa vacios',
    'Refrijerador de planchas limpios',
    'Utencilios acomodados en las planchas',
    'Charolas de grasa de plachas limpias',
    'No trapos y platos debajo de planchas',
    'Productos sobrandes cerrados o guardados',
    'Vaporeras limpias y apagadas',
    'Trastes acomodados en vaporeras y salsa bar',
    'Contenedor de basura vacios y con bolsa (Vaporeras)',
    'Refrijeradores de salsa Bar limpios y apagados',
    'Vidrios limpios',
    'Linea barrida y lavada',
    'Coladeras limpias y poner cloro (Piso)',
    'Area de cajas limpia',
    'Basureros limpios',
    'Baños limpios',
    'Botes de basura vacios y con bolsa (Salon)',
    'Tvs apagada',
    'Puertas cerradas y confirmadas',
    'Salon limpio (no charolas y comida en mesas)',
    'Luces apagadas',
    'Parking barrido',
    'Candados cerrados',
    'Contenedores de basura cerrados',
    'Basura no rebase los contenedores'
]

export const CIERRE_LEGACY_KEYS: Record<string, string> = {
    'cocina_vaporera_lavada': 'Vaporera lavada',
    'cocina_olla_champurrado': 'Olla del champurrado',
    'cocina_ollas_frijoles': 'Ollas de los frijoles',
    'cocina_refrigerador_limpio': 'Refrigerador limpio y acomodado el producto',
    'cocina_barrida_trapeada': 'Cocina barrida y trapeada',
    'cocina_coladeras_cloro': 'Coladeras limpias y poner cloro',
    'cocina_charolas_rojas': 'Charolas rojas limpias y secas',
    'cocina_trastes_acomodados': 'Trastes acomodados y limpios',
    'cocina_botes_basura': 'Botes de basura vacios y con bolsa',
    'cocina_trapeadores': 'Trapeadores lavados y limpios',
    'cocina_contenedor_grasa': 'Contenedor de la grasa limpio y tapado',
    'cocina_contenedor_basura': 'Contenedor de basura limpio y tapado',
    'cocina_trapos_agua_jabon': 'Trapos en agua caliente y con jabon (no cloro)',
    'cocina_cuarto_descanso': 'Cuarto de descanso limpio (Lockers)',
    'cocina_refri_empleados': 'Refrigerador de empleados limpio',
    'cocina_bote_champurrado': 'Bote de champurrado limpio',
    'cocina_ollas_cafe': 'Ollas de cafe limpias',
    'cocina_productos_limpieza': 'Productos de limpieza en su lugar asignado',
    'planchas_apagadas_lavadas': 'Planchas apagadas y lavadas',
    'planchas_vaporera_tortillas': 'Vaporera de tortillas limpia y apagada',
    'planchas_filtros_acido': 'Filtros en acido y ventana de plastico limpia',
    'planchas_contenedores_grasa': 'Contenedores de grasa vacios',
    'planchas_refri_planchas': 'Refrijerador de planchas limpios',
    'planchas_utencilios_acomodados': 'Utencilios acomodados en las planchas',
    'planchas_charolas_grasa': 'Charolas de grasa de plachas limpias',
    'planchas_no_trapos_debajo': 'No trapos y platos debajo de planchas',
    'planchas_productos_sobrantes': 'Productos sobrandes cerrados o guardados',
    'vaporeras_limpias_apagadas': 'Vaporeras limpias y apagadas',
    'vaporeras_trastes_acomodados': 'Trastes acomodados en vaporeras y salsa bar',
    'vaporeras_basura_vacia': 'Contenedor de basura vacios y con bolsa (Vaporeras)',
    'vaporeras_refri_salsa_bar': 'Refrijeradores de salsa Bar limpios y apagados',
    'vaporeras_vidrios_limpios': 'Vidrios limpios',
    'piso_linea_barrida_lavada': 'Linea barrida y lavada',
    'piso_coladeras_cloro': 'Coladeras limpias y poner cloro (Piso)',
    'salon_area_cajas_limpia': 'Area de cajas limpia',
    'salon_basureros_limpios': 'Basureros limpios',
    'salon_banos_limpios': 'Baños limpios',
    'salon_botes_basura_vacios': 'Botes de basura vacios y con bolsa (Salon)',
    'salon_tvs_apagadas': 'Tvs apagada',
    'salon_puertas_cerradas': 'Puertas cerradas y confirmadas',
    'salon_salon_limpio': 'Salon limpio (no charolas y comida en mesas)',
    'salon_luces_apagadas': 'Luces apagadas',
    'parking_barrido': 'Parking barrido',
    'parking_candados_cerrados': 'Candados cerrados',
    'parking_contenedores_cerrados': 'Contenedores de basura cerrados',
    'parking_basura_no_rebase': 'Basura no rebase los contenedores'
}

/**
 * @deprecated Legacy static questions. New checklists use dynamic templates from Supabase.
 * Kept for viewing historical records.
 */
export const APERTURA_QUESTIONS = [
    'Desarmar alarma y validar que estaba activada',
    'Encendido de vaporeras',
    'Encendido de refrigeradores',
    'Encendido de planchas',
    'Encendido de luces en linea y salon',
    'Encendido de pantallas y TVs',
    'Revision de baños, salon y parking',
    'Recepcion de mercancias adecuado',
    'Ordenar todas las mercancias en su lugar correspondiente',
    'Limpieza de Walking',
    'Apertura de Restaurante en tiempo',
    'linea de produccion abastecida',
    'Apertura correcta de las cajas'
]

export const APERTURA_LEGACY_KEYS: Record<string, string> = {
    'desarmar_alarma': 'Desarmar alarma y validar que estaba activada',
    'encender_vaporeras': 'Encendido de vaporeras',
    'encender_refrigeradores': 'Encendido de refrigeradores',
    'encender_planchas': 'Encendido de planchas',
    'encender_luces': 'Encendido de luces en linea y salon',
    'encender_pantallas': 'Encendido de pantallas y TVs',
    'revision_areas': 'Revision de baños, salon y parking',
    'recepcion_mercancias': 'Recepcion de mercancias adecuado',
    'ordenar_mercancias': 'Ordenar todas las mercancias en su lugar correspondiente',
    'limpieza_walking': 'Limpieza de Walking',
    'apertura_tiempo': 'Apertura de Restaurante en tiempo',
    'linea_produccion_abastecida': 'linea de produccion abastecida',
    'apertura_cajas': 'Apertura correcta de las cajas'
}

export const SOBRANTE_ITEMS: Record<string, string> = {
    'arroz': 'Arroz',
    'frijol': 'Frijol',
    'asada': 'Asada',
    'pastor': 'Pastor',
    'pollo': 'Pollo',
    'carnitas': 'Carnitas',
    'buche': 'Buche',
    'chorizo': 'Chorizo',
    'cabeza': 'Cabeza',
    'lengua': 'Lengua',
    'frijoles_olla': 'Frijoles de olla'
}

export const TEMPERATURA_ITEMS: Record<string, string> = {
    'refrig1_papelitos_mayo': 'Refrig 1 - Papelitos con mayo',
    'refrig1_papelitos_no_mayo': 'Refrig 1 - Papelitos sin mayo',
    'refrig1_quesadillas': 'Refrig 1 - Quesadillas',
    'refrig2_carnes_cocinar': 'Refrig 2 - Carnes para cocinar',
    'refrig2_asada_pollo': 'Refrig 2 - Asada y pollo',
    'refrig3_queso_monterrey': 'Refrig 3 - Queso monterrey',
    'refrig3_queso_cotija': 'Refrig 3 - Queso cotija',
    'refrig4_salsas': 'Refrig 4 - Salsas',
    'refrig4_lechuga': 'Refrig 4 - Lechuga',
    'vapor1_cabeza': 'Vapor 1 - Cabeza',
    'vapor1_lengua': 'Vapor 1 - Lengua',
    'vapor2_asada': 'Vapor 2 - Asada',
    'vapor2_pastor': 'Vapor 2 - Pastor',
    'vapor3_chorizo': 'Vapor 3 - Chorizo',
    'vapor3_salsa_huevo': 'Vapor 3 - Salsa de huevo',
    'vapor4_pollo': 'Vapor 4 - Pollo',
    'vapor4_buche': 'Vapor 4 - Buche',
    'vapor5_arroz': 'Vapor 5 - Arroz',
    'vapor5_frijol': 'Vapor 5 - Frijol',
    'vapor7_chile_asado': 'Vapor 7 - Chile asado',
    'vapor7_frijol_entero': 'Vapor 7 - Frijol entero'
}

export function getAssistantQuestionText(type: string, key: string | number): string {
    const t = (type || '').toLowerCase()
    const k = String(key)

    if (t === 'daily') {
        if (DAILY_LEGACY_KEYS[k]) return DAILY_LEGACY_KEYS[k]
        const idx = parseInt(k)
        if (!isNaN(idx) && DAILY_QUESTIONS[idx]) return DAILY_QUESTIONS[idx]
    }

    if (t === 'cierre' || t === 'inspeccion_cierre') {
        if (CIERRE_LEGACY_KEYS[k]) return CIERRE_LEGACY_KEYS[k]
        const idx = parseInt(k)
        if (!isNaN(idx) && CIERRE_QUESTIONS[idx]) return CIERRE_QUESTIONS[idx]
    }

    if (t === 'recorrido') {
        // Handle "horario_X_Ypm" pattern
        if (k.startsWith('horario_')) {
            const parts = k.replace('horario_', '').replace('am', ' AM').replace('pm', ' PM').replace('_', '-')
            return `Horario ${parts}`
        }

        // Try legacy string map
        if (RECORRIDO_LEGACY_KEYS[k]) return RECORRIDO_LEGACY_KEYS[k]

        // Try numeric index (current system)
        const idx = parseInt(k)
        if (!isNaN(idx) && RECORRIDO_QUESTIONS[idx]) return RECORRIDO_QUESTIONS[idx]
    }

    if (t === 'apertura' || t === 'inspeccion_apertura') {
        if (APERTURA_LEGACY_KEYS[k]) return APERTURA_LEGACY_KEYS[k]
        const idx = parseInt(k)
        if (!isNaN(idx) && APERTURA_QUESTIONS[idx]) return APERTURA_QUESTIONS[idx]
    }

    if (t === 'sobrante' || t === 'producto_sobrante') {
        if (SOBRANTE_ITEMS[k]) return SOBRANTE_ITEMS[k]
    }

    if (t === 'temperaturas') {
        if (TEMPERATURA_ITEMS[k]) return TEMPERATURA_ITEMS[k]
    }

    // Generic formatter for other snake_case keys if no match found
    if (k.includes('_')) {
        return k.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    }

    return k // Fallback to key if not found
}

export function getChecklistTitle(type: string): string {
    switch ((type || '').toLowerCase()) {
        case 'daily': return 'Daily Checklist';
        case 'temperaturas': return 'Control de Temperaturas';
        case 'sobrante': return 'Producto Sobrante';
        case 'recorrido': return 'Recorrido de Limpieza';
        case 'cierre': return 'Inspección de Cierre';
        case 'inspeccion_cierre': return 'Inspección de Cierre';
        case 'apertura': return 'Inspección de Apertura';
        case 'inspeccion_apertura': return 'Inspección de Apertura';
        default: return 'Checklist';
    }
}
