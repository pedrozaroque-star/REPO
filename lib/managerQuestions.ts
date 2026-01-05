// Preguntas del Manager Checklist organizadas por sección

export const MANAGER_QUESTIONS = {
  sections: [
    {
      id: 's0',
      title: 'Cocina y Línea de Preparación', // Cookline and Kitchen
      questions: [
        'No hay basura ni aceite debajo de las parrillas y equipos', // No trash or oil under all grills equipment
        'Todos los productos están a la temperatura adecuada', // All products are at proper temperature
        'Los protectores contra estornudos están limpios (huellas, etc.)', // Sneeze Guards are cleaned (fingerprints etc)
        'Todo el acero inoxidable está limpio y pulido', // All stainless steel is clean and polished
        'Todas las campanas están limpias y en buen estado', // All hoods are clean and in working order
        'Las parrillas están limpias (paneles laterales sin acumulación)', // Grills are clean (panels on side no buildup)
        'Todos los botes de basura están limpios (por dentro y por fuera)', // All trash cans are clean (inside out)
        'Las paredes y todas las puertas están limpias', // Walls and all doors are clean
        'La máquina de queso para nachos está limpia', // Nacho cheese machine is clean
        'La comida está fresca y se ve apetitosa para el cliente', // Food is fresh and looks appetizing to guest
        'Se usan cubetas a 200ppm; los trapos no están sobre la línea', // Buckets @200ppm, are being utilized; towels not sitting on line
        'Paredes, pisos y zócalos del Walk-in están limpios y barridos', // Walk-in walls, floors and baseboards are clean and swept
        'Todos los artículos están a 6" del suelo (cajas, trapeadores, etc.)', // All items are 6" above ground (boxes, mops, etc.)
        'Las estaciones de preparación están limpias y sanitizadas', // Prep Stations are cleaned and sanitized
        'Todo el equipo está en funcionamiento', // All equipment is in working order
        'La entrega (delivery) está guardada y organizada', // Delivery is put away and is organized
        'Toda la iluminación y ventilación funcionan y están limpias', // All lighting and vents are working and clean
        'Los empaques (gaskets) están limpios y no rotos', // Gaskets are clean and not ripped
        'Las boquillas de refresco están limpias (sin moho)', // Soda nozzles are clean (no mildew)
        'La máquina de hielo está libre de moho y limpia', // Ice machine is free of mildew and wiped down
        'Tijeras/Tomate/Lima limpios y funcionando', // Scissors/Tomato/Lime clean and working
        'Todos los drenajes están limpios', // All drains are clean
        'El baño de empleados está limpio y surtido', // Employee restroom is clean and stocked
        'Todas las bolsas abiertas están almacenadas correctamente' // All open bags are stored properly
      ]
    },
    {
      id: 's1',
      title: 'Comedor y Áreas de Clientes', // Dining Room & Guest Areas
      questions: [
        'Limpiar/sacudir muebles, TVs, etc.', // Clean/dust furniture, TV's, etc.
        'Las ventanas y marcos de ventanas están limpios', // Windows and window seals are clean
        'Los baños están limpios y en funcionamiento', // Restrooms are clean and in working order
        'Saludo de 5 segundos y venta sugestiva (bienvenida a clientes)', // 5 Second greeting and upsell (welcoming guests)
        'Música y Aire Acondicionado a nivel apropiado', // Music and AC at appropriate level
        'El comedor está limpio / Estacionamiento', // Dining room is clean / Parking Lot
        'Paredes y estaciones de bebida están limpias', // Walls, drink stations are clean
        'Ventilas y plafones del techo están limpios y en buen estado', // Vents and ceiling tiles are clean and in working order
        'Los uniformes están limpios y sin manchas', // Uniforms are clean and free of stains
        'Los tableros de menú (Menuboards) funcionan', // Menuboards are working
        'El área de botes de basura está limpia', // Trash can area clean and wiped down
        'Visitas a mesas en el comedor (Table touching)', // Table touching guest in dining room
        'Estacionamiento y botes de basura limpios', // Parking Lot and trash cans clean
        'Puertas de entrada limpias (sin manchas)' // Entry doors clean (No smudges)
      ]
    },
    {
      id: 's2',
      title: 'Checklist y Reportes', // Checklist and Reports
      questions: [
        'Tarjetas de manejo de alimentos (Food handlers) en archivo', // Food handlers cards are on file
        '¿La tienda tiene personal completo?', // Is store fully staffed
        '¿Cuál es el % de labor de la semana?', // What is labor % for week
        '¿Cuántos asistentes? Shift leaders', // How many assistants? Shift leaders
        '¿Se están utilizando todos los checklists? Completos', // Are all checklists being utilized? Complete
        'Horario publicado y fácil de leer', // Schedule posted and clear to read
        '¿Los managers conocen los errores de reloj checador? (Ronos/Toast)', // Are managers aware of employees time clock errors? (Ronos/Toast)
        'Planes de acción vigentes para miembros del equipo (QUIÉN)', // Action plans in place for any team members (WHO)
        '¿Las ventas han subido respecto a semanas anteriores?', // Are sales up from prior weeks
        '¿Todos tienen al menos un día libre?', // Does everyone have at least one day off
        '¿Todos están entrenados en los nuevos procesos?', // Is everyone trained on new processes
        '¿Se han reportado todas las reparaciones en Basecamp?', // Has all repairs been reported on Basecamp
        'Se siguen los procedimientos de manejo de efectivo' // Cash handling procedures are being followed
      ]
    },
    {
      id: 's3',
      title: 'Adicional', // Additional
      questions: [
        'Se toma la temperatura de cada empleado en turno', // Temperature is taken of each employee on shift
        'Cualquier problema de empleado reportado al DM', // Any employee issues reported to DM
        'Soda CO2 está a 1/4 o menos, avisar al manager' // Soda CO2 is 1/4 or less, let manager know
      ]
    }
  ]
}

// Función helper para obtener el texto de una pregunta
export function getQuestionText(key: string): string {
  // Intenta coincidir con: s0_0, S0 0, s0 1, S2_4, etc.
  const match = key.match(/[sS](\d+)[\s_]+(\d+)/)
  if (!match) return key

  const [, sectionIndex, questionIndex] = match
  const section = MANAGER_QUESTIONS.sections[parseInt(sectionIndex)]

  if (!section) return key

  const question = section.questions[parseInt(questionIndex)]
  return question || key
}

// Función para obtener todas las preguntas con sus keys
export function getAllQuestions() {
  const allQuestions: { key: string; text: string; section: string }[] = []

  MANAGER_QUESTIONS.sections.forEach(section => {
    section.questions.forEach((question, index) => {
      allQuestions.push({
        key: `${section.id}_${index}`,
        text: question,
        section: section.title
      })
    })
  })

  return allQuestions
}