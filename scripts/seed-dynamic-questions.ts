
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

// Cargar variables de entorno
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
// INTENTO CRÍTICO: Usar la Service Key si existe para saltar RLS (Row Level Security)
// Si no, usar la Anon Key (que podría fallar si RLS bloquea inserts)
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Faltan credenciales de Supabase en .env.local')
    process.exit(1)
}

const isServiceKey = supabaseKey === process.env.SUPABASE_SERVICE_ROLE_KEY
console.log(`🔑 Usando llave: ${isServiceKey ? 'SERVICE_ROLE (Admin)' : 'ANON (Público)'}`)

const supabase = createClient(supabaseUrl, supabaseKey)

// --- 1. IMPORTAR PREGUNTAS LEGACY (SIMULADO PARA SCRIPT) ---
// Copio las constantes aquí para evitar problemas de importación con módulos de Next.js en entorno Node puro

const APERTURA_QUESTIONS = [
    "Verificar que el sistema de alarma esté desactivado.",
    "Encender todas las luces del restaurante (comedor, cocina, baños).",
    "Encender equipos de cocina (freidoras, planchas, hornos) y verificar pilotos.",
    "Revisar temperaturas de refrigeradores y congeladores (Walk-in, linea fría).",
    "Verificar que la caja fuerte esté cerrada y sin señales de forzadura.",
    "Contar el fondo de caja inicial y registrar en el sistema POS.",
    "Revisar que los baños estén limpios y con suministros (papel, jabón).",
    "Verificar que no haya plagas o evidencia de roedores.",
    "Encender sistema de música y aire acondicionado a temperatura adecuada.",
    "Revisar inventario crítico para el turno (pan, carne, verduras)."
]

const CIERRE_QUESTIONS = [
    "Apagar equipos de cocina no esenciales.",
    "Limpiar y desengrasar planchas y freidoras.",
    "Guardar alimentos en contenedores herméticos y etiquetados.",
    "Barrer y trapear pisos de cocina y comedor.",
    "Sacar la basura y limpiar los botes.",
    "Contar ventas del día y realizar corte de caja.",
    "Guardar dinero en la caja fuerte.",
    "Apagar luces y aire acondicionado.",
    "Activar sistema de alarma y cerrar puertas con llave.",
    "Verificar que no quede personal dentro del establecimiento."
]

// Manager Questions (Simplified structure from legacy)
const MANAGER_SECTIONS = [
    {
        title: 'Cocina y Línea de Preparación',
        questions: [
            "¿Pisos de cocina limpios y secos?",
            "¿Parrillas y freidoras limpias?",
            "¿Campanas de extracción limpias?",
            "¿Temperatura de Walk-in Cooler correcta (33-41°F)?",
            "¿Temperatura de Congelador correcta (-10 a 0°F)?",
            "¿Contenedores de comida etiquetados y fechados?",
            "¿Utensilios limpios y en buen estado?",
            "¿Uso correcto de guantes por parte del personal?",
            "¿Lavamanos con jabón y toallas?",
            "¿Basureros no desbordados?",
            "¿Productos químicos almacenados separadamente?",
            "¿No hay contaminación cruzada visible?",
            "¿Tiempos de retención de fritos respetados?",
            "¿Carnes crudas almacenadas abajo de cocidas?",
            "¿Termómetros visibles en refrigeradores?",
            "¿Sanitizante a la concentración correcta (200ppm)?",
            "¿Trapos de limpieza en solución sanitizante?",
            "¿Área de lavado de platos ordenada?",
            "¿Máquina de hielo limpia por dentro?",
            "¿Bebidas de empleados en área designada?",
            "¿Personal sin joyas/relojes en cocina?",
            "¿Cabello cubierto (red/gorra)?",
            "¿Uñas cortas y limpias?"
        ]
    },
    {
        title: 'Comedor y Servicio',
        questions: [
            "¿Mesas y sillas limpias y ordenadas?",
            "¿Pisos de comedor barridos y trapeados?",
            "¿Ventanas y puertas de vidrio limpias?",
            "¿Baños limpios y con olor agradable?",
            "¿Espejos y lavabos de baños limpios?",
            "¿Estación de bebidas limpia y surtida?",
            "¿Salsas y servilletas surtidas?",
            "¿Música a volumen adecuado?",
            "¿Temperatura del comedor confortable?",
            "¿Iluminación funcionando al 100%?",
            "¿Personal saluda a clientes al entrar?",
            "¿Tiempo de espera razonable?",
            "¿Uniformes de cajeros completos y limpios?",
            "¿Personal sonriente y amable?",
            "¿Paredes y estaciones de bebida limpias?",
            "¿Ventilas y plafones del techo limpios?",
            "¿Tableros de menú funcionan?",
            "¿Área de botes de basura limpia?",
            "¿Visitas a mesas (Table touching)?",
            "¿Estacionamiento limpio?",
            "¿Puertas de entrada limpias?"
        ]
    },
    {
        title: 'Checklist y Reportes',
        questions: [
            "Tarjetas de manejo de alimentos (Food handlers) en archivo",
            "¿La tienda tiene personal completo?",
            "¿Cuál es el % de labor de la semana?",
            "¿Cuántos asistentes? Shift leaders",
            "¿Se están utilizando todos los checklists? Completos",
            "Horario publicado y fácil de leer",
            "¿Los managers conocen los errores de reloj checador?",
            "Planes de acción vigentes para miembros del equipo (QUIÉN)",
            "¿Las ventas han subido respecto a semanas anteriores?",
            "¿Todos tienen al menos un día libre?",
            "¿Todos están entrenados en los nuevos procesos?",
            "¿Se han reportado todas las reparaciones en Basecamp?",
            "Se siguen los procedimientos de manejo de efectivo"
        ]
    },
    {
        title: 'Adicional',
        questions: [
            "Se toma la temperatura de cada empleado en turno",
            "Cualquier problema de empleado reportado al DM",
            "Soda CO2 está a 1/4 o menos, avisar al manager"
        ]
    }
]

// Supervisor Questions
const SUPERVISOR_AREAS = {
    servicio: {
        label: 'Servicio y Velocidad', color: 'blue', items: [
            "Saludo inmediato (5s)", "Sonrisa genuina", "Uniforme impecable", "Tiempo entrega < 5min", "Despedida amable"
        ]
    },
    calidad: {
        label: 'Calidad de Comida', color: 'red', items: [
            "Temperatura correcta", "Presentación visual estándar", "Sabor fresco", "Empaque limpio", "Porciones correctas"
        ]
    },
    limpieza: {
        label: 'Limpieza General', color: 'green', items: [
            "Pisos comedor", "Mesas", "Baños impecables", "Estación de bebidas", "Ventanas"
        ]
    },
    seguridad: {
        label: 'Seguridad Alimentaria', color: 'orange', items: [
            "Lavado de manos frecuente", "Uso de guantes", "Etiquetado fechas", "Temperaturas logueadas", "No contaminación cruzada"
        ]
    },
    mantenimiento: {
        label: 'Mantenimiento', color: 'purple', items: [
            "Iluminación", "AC/Temperatura", "Música ambiente", "Estado mobiliario", "Pintura/Paredes"
        ]
    },
    personal: {
        label: 'Personal (Grooming)', color: 'yellow', items: [
            "Afeitado/Maquillaje discreto", "Uñas cortas", "Zapatos antideslizantes", "Gorra/Red bien puesta", "Actitud positiva"
        ]
    },
    marketing: {
        label: 'Marketing/Entorno', color: 'cyan', items: [
            "Promociones vigentes visibles", "Menú board limpio/iluminado", "Exterior limpio", "Estacionamiento limpio", "Señalización correcta"
        ]
    }
}

const DAILY_QUESTIONS = [
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

const RECORRIDO_QUESTIONS = [
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

// --- CORRECCIÓN CRÍTICA: Definir explícitamente los arrays de items para Sobrante y Temperaturas
// ya que en el archivo original son Objetos (Record<string, string>), no Arrays.
const SOBRANTE_ITEMS_ARRAY = [
    'Arroz', 'Frijol', 'Asada', 'Pastor', 'Pollo', 'Carnitas', 'Buche',
    'Chorizo', 'Cabeza', 'Lengua', 'Frijoles de olla'
]

const TEMPERATURA_ITEMS_ARRAY = [
    'Refrig 1 - Papelitos con mayo',
    'Refrig 1 - Papelitos sin mayo',
    'Refrig 1 - Quesadillas',
    'Refrig 2 - Carnes para cocinar',
    'Refrig 2 - Asada y pollo',
    'Refrig 3 - Queso monterrey',
    'Refrig 3 - Queso cotija',
    'Refrig 4 - Salsas',
    'Refrig 4 - Lechuga',
    'Vapor 1 - Cabeza',
    'Vapor 1 - Lengua',
    'Vapor 2 - Asada',
    'Vapor 2 - Pastor',
    'Vapor 3 - Chorizo',
    'Vapor 3 - Salsa de huevo',
    'Vapor 4 - Pollo',
    'Vapor 4 - Buche',
    'Vapor 5 - Arroz',
    'Vapor 5 - Frijol',
    'Vapor 7 - Chile asado',
    'Vapor 7 - Frijol entero'
]

// --- 2. FUNCIÓN PRINCIPAL DE MIGRACIÓN ---

async function migrate() {
    console.log('🚀 Iniciando migración de preguntas dinámicas...')

    // --- A. ASISTENTE (Apertura) ---
    await createTemplateWithSections(
        'checklist_apertura',
        'Inspección de Apertura',
        'standard',
        [{ title: 'Procedimientos Generales', questions: APERTURA_QUESTIONS }]
    )

    // --- B. ASISTENTE (Cierre) ---
    await createTemplateWithSections(
        'checklist_cierre',
        'Inspección de Cierre',
        'standard',
        [{ title: 'Procedimientos de Cierre', questions: CIERRE_QUESTIONS }]
    )

    // --- C. ASISTENTE (Daily) ---
    await createTemplateWithSections(
        'checklist_daily',
        'Daily Checklist',
        'standard',
        [{ title: 'Tareas Diarias', questions: DAILY_QUESTIONS }]
    )

    // --- D. ASISTENTE (Recorrido) ---
    await createTemplateWithSections(
        'checklist_recorrido',
        'Recorrido de Limpieza',
        'standard',
        [{ title: 'Puntos de Recorrido', questions: RECORRIDO_QUESTIONS }]
    )

    // --- E. ASISTENTE (Sobrante) ---
    await createTemplateWithSections(
        'checklist_sobrante',
        'Producto Sobrante',
        'standard',
        [{ title: 'Productos a Contar', questions: SOBRANTE_ITEMS_ARRAY }]
    )

    // --- F. ASISTENTE (Temperaturas) ---
    await createTemplateWithSections(
        'checklist_temperaturas',
        'Control de Temperaturas',
        'standard',
        [{ title: 'Equipos y Alimentos', questions: TEMPERATURA_ITEMS_ARRAY }]
    )

    // --- G. MANAGER ---
    await createTemplateWithSections(
        'manager_checklist_v1',
        'Manager Daily Checklist',
        'standard',
        MANAGER_SECTIONS.map(s => ({ title: s.title, questions: s.questions }))
    )

    // --- H. SUPERVISOR ---
    const supervisorSections = Object.values(SUPERVISOR_AREAS).map((area: any) => ({
        title: area.label,
        color: area.color,
        questions: area.items,
        type: 'semaforo' // Indicar que estas usan semáforo (100/60/0)
    }))

    await createTemplateWithSections(
        'supervisor_inspection_v1',
        'Inspección de Supervisor',
        'inspection',
        supervisorSections
    )

    // --- I. FEEDBACK PUBLICO ---
    const feedbackQuestions = [
        { text: 'Atención en caja', type: 'rating_5' },
        { text: 'Tiempo de entrega', type: 'rating_5' },
        { text: 'Calidad de alimentos', type: 'rating_5' },
        { text: 'Limpieza del local', type: 'rating_5' },
        { text: '¿Nos recomendarías? (NPS)', type: 'nps_10' }
    ]

    // Custom logic for feedback (single section)
    await createTemplateWithSections(
        'public_feedback_v1',
        'Feedback Público Clientes',
        'feedback',
        [{ title: 'Encuesta General', questions: feedbackQuestions, isCustomObj: true }]
    )

    // --- J. EVALUACIÓN DE PERSONAL ---
    const evalQuestions = [
        { text: '¿Se comunica de manera clara?', type: 'rating_5', section: 'Trabajo en equipo' },
        { text: '¿Escucha a los demás?', type: 'rating_5', section: 'Trabajo en equipo' },
        { text: '¿Apoya cuando está ocupado?', type: 'rating_5', section: 'Trabajo en equipo' },
        { text: '¿Fomenta ambiente positivo?', type: 'rating_5', section: 'Trabajo en equipo' },
        { text: '¿Resuelve conflictos? (Líder)', type: 'rating_5', section: 'Trabajo en equipo' },

        { text: '¿Motiva al equipo?', type: 'rating_5', section: 'Liderazgo' },
        { text: '¿Da feedback constructivo?', type: 'rating_5', section: 'Liderazgo' },
        { text: '¿Es justo asignando tareas?', type: 'rating_5', section: 'Liderazgo' },
        { text: '¿Apoya en dificultades?', type: 'rating_5', section: 'Liderazgo' },
        { text: '¿Es ejemplo a seguir?', type: 'rating_5', section: 'Liderazgo' },

        { text: '¿Cumple sin supervisión?', type: 'rating_5', section: 'Desempeño' },
        { text: '¿Mantiene limpieza?', type: 'rating_5', section: 'Desempeño' },
        { text: '¿Sigue procedimientos?', type: 'rating_5', section: 'Desempeño' },
        { text: '¿Rápido y preciso?', type: 'rating_5', section: 'Desempeño' },
        { text: '¿Tiene iniciativa? (Líder)', type: 'rating_5', section: 'Desempeño' },

        { text: '¿Actitud positiva?', type: 'rating_5', section: 'Actitud' },
        { text: '¿Respetuoso sin favoritismos?', type: 'rating_5', section: 'Actitud' },
        { text: '¿Representa bien la marca?', type: 'rating_5', section: 'Actitud' },
        { text: '¿Recibe críticas bien?', type: 'rating_5', section: 'Actitud' },
        { text: '¿Contribuye al ambiente?', type: 'rating_5', section: 'Actitud' },

        { text: '¿Interés en aprender?', type: 'rating_5', section: 'Desarrollo' },
        { text: '¿Busca crecer?', type: 'rating_5', section: 'Desarrollo' },
        { text: '¿Ayuda a entrenar?', type: 'rating_5', section: 'Desarrollo' },
        { text: '¿Aplica lo aprendido?', type: 'rating_5', section: 'Desarrollo' },
        { text: '¿Abierto a cambios?', type: 'rating_5', section: 'Desarrollo' }
    ]

    // Group by section for creation
    const groupedEval = evalQuestions.reduce((acc: any, curr) => {
        if (!acc[curr.section]) acc[curr.section] = []
        acc[curr.section].push(curr)
        return acc
    }, {})

    const evalSections = Object.keys(groupedEval).map(key => ({
        title: key,
        questions: groupedEval[key],
        isCustomObj: true
    }))

    await createTemplateWithSections(
        'staff_evaluation_v1',
        'Evaluación de Personal',
        'evaluation',
        evalSections
    )

    console.log('✅ ¡Migración Completa! Base de datos poblada.')
}

async function createTemplateWithSections(code: string, title: string, type: string, sections: any[]) {
    console.log(`\n📄 Creando plantilla: ${title} (${code})...`)

    // 1. Crear Template
    const { data: template, error: tErr } = await supabase
        .from('templates')
        .upsert({ code, title, type, active: true }, { onConflict: 'code' })
        .select()
        .single()

    if (tErr) { console.error('Error template:', tErr); return }
    if (!template) return

    // 2. Iterar Secciones
    for (let i = 0; i < sections.length; i++) {
        const secData = sections[i]

        // Crear Sección
        const { data: section, error: sErr } = await supabase
            .from('template_sections')
            .insert({
                template_id: template.id,
                title: secData.title,
                color_theme: secData.color || 'gray',
                order_index: i
            })
            .select()
            .single()

        if (sErr) { console.error('Error section:', sErr); continue }

        // 3. Insertar Preguntas
        const questionsPayload = secData.isCustomObj
            ? secData.questions.map((q: any, idx: number) => ({
                section_id: section.id,
                text: q.text,
                type: q.type,
                order_index: idx
            }))
            : secData.questions.map((qText: string, idx: number) => ({
                section_id: section.id,
                text: qText,
                type: secData.type === 'semaforo' ? 'score_100' : 'yes_no',
                order_index: idx
            }))

        const { error: qErr } = await supabase.from('template_questions').insert(questionsPayload)
        if (qErr) console.error('Error questions:', qErr)
        else console.log(`   └─ Sección "${secData.title}": ${questionsPayload.length} preguntas insertadas.`)
    }
}

migrate()
