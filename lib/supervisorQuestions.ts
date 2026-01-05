
// Preguntas de Inspección de Supervisor
// Secciones: Servicio, Carnes, Alimentos, Tortillas, Limpieza, Bitácoras, Aseo

export const SUPERVISOR_QUESTIONS = {
    servicio: {
        label: '🤝 Servicio al Cliente', color: 'blue', hint: 'Amabilidad, cortesía, rapidez',
        items: ['Saluda y despide cordialmente', 'Atiende con paciencia y respeto', 'Entrega órdenes con frase de cierre', 'Evita charlas personales en línea']
    },
    carnes: {
        label: '🥩 Procedimiento de Carnes', color: 'red', hint: 'Tiempos/temperaturas, limpieza',
        items: ['Controla temperatura (450°/300°) y tiempos', 'Utensilios limpios, no golpear espátulas', 'Escurre carnes y rota producto (FIFO)', 'Vigila cebolla asada y porciones']
    },
    alimentos: {
        label: '🌮 Preparación de Alimentos', color: 'orange', hint: 'Recetas, porciones, presentación',
        items: ['Respeta porciones estándar (cucharas)', 'Quesadillas bien calientes, sin quemar', 'Burritos bien enrollados, sin dorar de más', 'Stickers correctos donde aplica']
    },
    tortillas: {
        label: '🫓 Seguimiento a Tortillas', color: 'yellow', hint: 'Temperatura, textura y reposición',
        items: ['Tortillas bien calientes (aceite solo en orillas)', 'Máx 5 tacos por plato (presentación)', 'Reponer a tiempo y mantener frescura']
    },
    limpieza: {
        label: '✨ Limpieza General y Baños', color: 'green', hint: 'Estaciones, comedor, baños',
        items: ['Cubetas rojas con sanitizer tibio', 'Plancha limpia y sin residuos', 'Baños con insumos completos y sin olores', 'Exterior y basureros limpios']
    },
    bitacoras: {
        label: '📝 Checklists y Bitácoras', color: 'purple', hint: 'Registros al día y firmados',
        items: ['Checklist apertura/cierre completo', 'Bitácora de temperaturas al día', 'Registros de limpieza firmados']
    },
    aseo: {
        label: '🧼 Aseo Personal', color: 'cyan', hint: 'Uniforme, higiene y presentación',
        items: ['Uniforme limpio y completo', 'Uñas cortas, sin joyas/auriculares', 'Uso correcto de gorra y guantes']
    }
} as const

// Helper para obtener texto de pregunta de supervisor (si fuera necesario por key)
export function getSupervisorQuestionText(sectionKey: string, itemIdx: number): string {
    const section = (SUPERVISOR_QUESTIONS as any)[sectionKey]
    if (!section) return `Sección ${sectionKey}`
    return section.items[itemIdx] || `Item ${itemIdx}`
}
