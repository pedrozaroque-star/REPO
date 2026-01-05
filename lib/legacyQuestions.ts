
// Legacy Question Mappings for Historical Record Viewing
// New checklists use dynamic templates from the database.

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

export const RECORRIDO_LEGACY_KEYS: Record<string, string> = {
    'quitar_publicidad': 'Quitar publicidad y promociones vencidas',
    'barrer_areas': 'Barrer todas las áreas',
    'barrer_trapear_cocinas': 'Barrer y trapear cocinas',
    'cambiar_bolsas': 'Cambiar bolsas de basura',
    'limpieza_banos': 'Limpieza de baños',
    'limpiar_ventanas': 'Limpiar ventanas y puertas',
    'limpiar_mesas_sillas': 'Limpiar mesas y sillas',
    'organizar_basura': 'Organizar área de basura',
    'limpiar_refrigeradores': 'Limpiar refrigeradores',
    'limpiar_estufas': 'Limpiar estufas y planchas',
    'limpiar_campanas': 'Limpiar campanas',
    'revisar_inventario': 'Revisar inventario de limpieza',
    'reportar_reparaciones': 'Reportar reparaciones necesarias'
}

export const APERTURA_LEGACY_KEYS: Record<string, string> = {
    'safety_check': 'Inspección de seguridad inicial',
    'equipment_startup': 'Encendido de equipos (Parrilla/Freidoras)',
    'prep_materials': 'Preparación de materiales y utensilios',
    'stock_levels': 'Verificación de niveles de stock inicial',
    'cleanliness_check': 'Revisión de limpieza general apertura'
}

export const CIERRE_LEGACY_KEYS: Record<string, string> = {
    'lock_doors': 'Asegurar todas las puertas de salida',
    'shutdown_equipment': 'Apagado de equipos y gas',
    'cleaning_kitchen': 'Limpieza profunda de cocina',
    'waste_disposal': 'Disposición final de basura',
    'final_inspection': 'Inspección final de supervisor'
}

export const MANAGER_QUESTIONS: any = {
    sections: [
        {
            id: 's0',
            title: 'Cocina y Línea de Preparación',
            questions: [
                'No hay basura ni aceite debajo de las parrillas y equipos',
                'Todos los productos están a la temperatura adecuada',
                'Los protectores contra estornudos están limpios',
                'Todo el acero inoxidable está limpio y pulido',
                'Todas las campanas están limpias y en buen estado',
                'Las parrillas están limpias',
                'Todos los botes de basura están limpios',
                'Las paredes y todas las puertas están limpias',
                'La máquina de queso para nachos está limpia',
                'La comida está fresca y se ve apetitosa',
                'Se usan cubetas a 200ppm',
                'Paredes, pisos y zócalos del Walk-in limpios',
                'Todos los artículos están a 6" del suelo',
                'Las estaciones de preparación están limpias',
                'Todo el equipo está en funcionamiento',
                'La entrega está guardada y organizada',
                'Toda la iluminación y ventilación funcionan',
                'Los empaques están limpios y no rotos',
                'Las boquillas de refresco están limpias',
                'La máquina de hielo está limpia',
                'Tijeras/Tomate/Lima limpios',
                'Todos los drenajes están limpios',
                'El baño de empleados está limpio',
                'Todas las bolsas abiertas están almacenadas'
            ]
        },
        {
            id: 's1',
            title: 'Comedor y Áreas de Clientes',
            questions: [
                'Limpiar/sacudir muebles, TVs, etc.',
                'Las ventanas y marcos están limpios',
                'Los baños están limpios y funcionales',
                'Saludo de 5 segundos y venta sugestiva',
                'Música y AC a nivel apropiado',
                'El comedor está limpio / Estacionamiento',
                'Paredes y estaciones de bebida limpias',
                'Ventilas y plafones limpios',
                'Los uniformes están limpios',
                'Los tableros de menú funcionan',
                'El área de botes de basura está limpia',
                'Visitas a mesas (Table touching)',
                'Estacionamiento y botes limpios',
                'Puertas de entrada limpias'
            ]
        }
    ]
}

export function getManagerQuestionText(key: string): string {
    const match = key.match(/[sS](\d+)[\s_]+(\d+)/)
    if (!match) return key
    const [, sIdx, qIdx] = match
    const section = MANAGER_QUESTIONS.sections[parseInt(sIdx)]
    if (!section) return key
    return section.questions[parseInt(qIdx)] || key
}

export function getAssistantQuestionText(type: string, key: string): string {
    const t = (type || '').toLowerCase()
    const k = key.toLowerCase()

    if (t === 'daily') return DAILY_LEGACY_KEYS[k] || key
    if (t === 'recorrido') return RECORRIDO_LEGACY_KEYS[k] || key
    if (t === 'apertura') return APERTURA_LEGACY_KEYS[k] || key
    if (t === 'cierre') return CIERRE_LEGACY_KEYS[k] || key

    if (k.includes('_')) {
        return k.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    }
    return key
}

export function getChecklistTitle(type: string): string {
    switch ((type || '').toLowerCase()) {
        case 'daily': return 'Daily Checklist';
        case 'temperaturas': return 'Control de Temperaturas';
        case 'sobrante': return 'Producto Sobrante';
        case 'recorrido': return 'Recorrido de Limpieza';
        case 'cierre': return 'Inspección de Cierre';
        case 'apertura': return 'Inspección de Apertura';
        default: return 'Checklist';
    }
}
