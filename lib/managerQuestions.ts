// Preguntas del Manager Checklist organizadas por sección

export const MANAGER_QUESTIONS = {
  sections: [
    {
      id: 's0',
      title: 'Cookline and Kitchen',
      questions: [
        'No trash or oil under all grills equipment',
        'All products are at proper temperature',
        'Sneeze Guards are cleaned (fingerprints etc)',
        'All stainless steel is clean and polished',
        'All hoods are clean and in working order',
        'Grills are clean (panels on side no buildup)',
        'All trash cans are clean (inside out)',
        'Walls and all doors are clean',
        'Nacho cheese machine is clean',
        'Food is fresh and looks appetizing to guest',
        'Buckets @200ppm, are being utilized; towels not sitting on line',
        'Walk-in walls, floors and baseboards are clean and swept',
        'All items are 6" above ground (boxes, mops, etc.)',
        'Prep Stations are cleaned and sanitized',
        'All equipment is in working order',
        'Delivery is put away and is organized',
        'All lighting and vents are working and clean',
        'Gaskets are clean and not ripped',
        'Soda nozzles are clean (no mildew)',
        'Ice machine is free of mildew and wiped down',
        'Scissors/Tomato/Lime clean and working',
        'All drains are clean',
        'Employee restroom is clean and stocked',
        'All open bags are stored properly'
      ]
    },
    {
      id: 's1',
      title: 'Dining Room & Guest Areas',
      questions: [
        'Clean/dust furniture, TV\'s, etc.',
        'Windows and window seals are clean',
        'Restrooms are clean and in working order',
        '5 Second greeting and upsell (welcoming guests)',
        'Music and AC at appropriate level',
        'Dining room is clean / Parking Lot',
        'Walls, drink stations are clean',
        'Vents and ceiling tiles are clean and in working order',
        'Uniforms are clean and free of stains',
        'Menuboards are working',
        'Trash can area clean and wiped down',
        'Table touching guest in dining room',
        'Parking Lot and trash cans clean',
        'Entry doors clean (No smudges)'
      ]
    },
    {
      id: 's2',
      title: 'Checklist and Reports',
      questions: [
        'Food handlers cards are on file',
        'Is store fully staffed',
        'What is labor % for week',
        'How many assistants? Shift leaders',
        'Are all checklists being utilized? Complete',
        'Schedule posted and clear to read',
        'Are managers aware of employees time clock errors? (Ronos/Toast)',
        'Action plans in place for any team members (WHO)',
        'Are sales up from prior weeks',
        'Does everyone have at least one day off',
        'Is everyone trained on new processes',
        'Has all repairs been reported on Basecamp',
        'Cash handling procedures are being followed'
      ]
    },
    {
      id: 's3',
      title: 'Additional',
      questions: [
        'Temperature is taken of each employee on shift',
        'Any employee issues reported to DM',
        'Soda CO2 is 1/4 or less, let manager know'
      ]
    }
  ]
}

// Función helper para obtener el texto de una pregunta
export function getQuestionText(key: string): string {
  const match = key.match(/s(\d+)_(\d+)/)
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