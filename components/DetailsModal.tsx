'use client'

import { useState } from 'react'
import { formatDateLA } from '@/lib/checklistPermissions'
import { getQuestionText } from '@/lib/managerQuestions'
import { X } from 'lucide-react'

interface DetailsModalProps {
  isOpen: boolean
  onClose: () => void
  checklist: any
  type: 'manager' | 'assistant' | 'supervisor'
}

const ASSISTANT_QUESTIONS: { [key: string]: string[] } = {
  daily: [
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
  ],
  recorrido: [
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
  ],
  apertura: [
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
    'Linea de produccion abastecida',
    'Apertura correcta de las cajas'
  ],
  cierre: [
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
}

const TEMPERATURE_LABELS: { [key: string]: string } = {
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

const PRODUCT_LABELS: { [key: string]: string } = {
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

// Función para convertir keys descriptivas a texto legible
const keyToReadableText = (key: string): string => {
  // Reemplazar guiones bajos con espacios
  let text = key.replace(/_/g, ' ')
  // Capitalizar primera letra de cada palabra
  text = text.split(' ').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ')
  return text
}

export default function DetailsModal({ isOpen, onClose, checklist, type }: DetailsModalProps) {
  const [activeTab, setActiveTab] = useState<'answers' | 'photos' | 'reviews'>('answers')

  if (!isOpen || !checklist) return null

  const getAnswerBadge = (value: string) => {
    if (!value) return 'bg-gray-100 text-gray-800'
    const upper = String(value).toUpperCase()
    if (upper === 'SI' || upper === 'YES') return 'bg-green-100 text-green-800'
    if (upper === 'NO') return 'bg-red-100 text-red-800'
    if (upper === 'N/A' || upper === 'NA') return 'bg-gray-100 text-gray-800'
    return 'bg-blue-100 text-blue-800'
  }

  const extractValue = (answer: any): string => {
    if (answer === null || answer === undefined) return ''
    if (typeof answer === 'object') {
      return answer.value || answer.answer || answer.response || ''
    }
    return String(answer)
  }

  const organizeAnswers = () => {
    if (!checklist.answers) {
      return []
    }

    // Si es Manager Checklist
    const firstKey = Object.keys(checklist.answers)[0]
    if (firstKey && firstKey.match(/s(\d+)_/)) {
      return organizeManagerAnswers()
    }

    return organizeAssistantAnswers()
  }

  const organizeManagerAnswers = () => {
    const sections: { [key: string]: { title: string; questions: any[] } } = {}

    Object.entries(checklist.answers).forEach(([key, answer]: [string, any]) => {
      const match = key.match(/s(\d+)_/)
      if (!match) return

      const sectionId = `s${match[1]}`

      if (!sections[sectionId]) {
        const sectionTitles: { [key: string]: string } = {
          's0': 'Cookline and Kitchen',
          's1': 'Dining Room & Guest Areas',
          's2': 'Checklist and Reports',
          's3': 'Additional'
        }
        sections[sectionId] = {
          title: sectionTitles[sectionId] || `Sección ${match[1]}`,
          questions: []
        }
      }

      sections[sectionId].questions.push({
        key,
        text: getQuestionText(key),
        value: extractValue(answer)
      })
    })

    return Object.values(sections)
  }

  const organizeAssistantAnswers = () => {
    const checklistType = checklist.checklist_type

    // TEMPERATURAS
    if (checklistType === 'temperaturas') {
      const questions = Object.entries(checklist.answers)
        .map(([key, answer]: [string, any]) => ({
          key,
          text: TEMPERATURE_LABELS[key] || keyToReadableText(key),
          value: extractValue(answer)
        }))
        .sort((a, b) => a.text.localeCompare(b.text))

      return [{
        title: 'Control de Temperaturas',
        questions
      }]
    }

    // SOBRANTE
    if (checklistType === 'sobrante') {
      const questions = Object.entries(checklist.answers)
        .map(([key, answer]: [string, any]) => ({
          key,
          text: PRODUCT_LABELS[key] || keyToReadableText(key),
          value: extractValue(answer) + ' lbs'
        }))

      return [{
        title: 'Producto Sobrante',
        questions
      }]
    }

    // DAILY, RECORRIDO, APERTURA, CIERRE
    const questionsList = ASSISTANT_QUESTIONS[checklistType] || []
    const answersArray: any[] = []

    Object.keys(checklist.answers).forEach((key) => {
      const answer = checklist.answers[key]
      let questionText: string
      let sortIndex: number

      // Intentar convertir a índice numérico
      let index: number
      if (key.startsWith('item_')) {
        index = parseInt(key.replace('item_', ''))
      } else {
        index = parseInt(key)
      }

      // Si es un índice numérico válido, usar el array de preguntas
      if (!isNaN(index) && questionsList[index]) {
        questionText = questionsList[index]
        sortIndex = index
      } else {
        // Si no es numérico, convertir la key a texto legible
        questionText = keyToReadableText(key)
        sortIndex = 9999 // Poner al final
      }

      answersArray.push({
        key,
        index: sortIndex,
        text: questionText,
        value: extractValue(answer)
      })
    })

    // Ordenar por índice
    answersArray.sort((a, b) => {
      if (a.index === 9999 && b.index === 9999) {
        // Si ambos son descriptivos, ordenar alfabéticamente por texto
        return a.text.localeCompare(b.text)
      }
      return a.index - b.index
    })

    const titles: { [key: string]: string } = {
      'daily': 'Daily Checklist',
      'recorrido': 'Recorrido de Limpieza',
      'apertura': 'Inspección de Apertura',
      'cierre': 'Inspección de Cierre'
    }

    return [{
      title: titles[checklistType] || 'Checklist',
      questions: answersArray
    }]
  }

  const sections = organizeAnswers()
  const photoUrls = checklist.photo_urls || []

  const reviewLevels = type === 'manager'
    ? ['supervisor', 'admin']
    : type === 'assistant'
      ? ['manager']
      : ['admin']

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 text-white p-6 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">Detalles del Checklist</h2>
              <p className="text-indigo-100 text-sm mt-1">
                {type === 'manager' ? 'Manager' : type === 'assistant' ? 'Asistente' : 'Supervisor'} •
                {formatDateLA(checklist.checklist_date || checklist.inspection_date || checklist.created_at)}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-white/80 hover:text-white hover:bg-white/10 rounded-full p-2 transition-colors">
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="p-6 bg-gray-50 border-b flex-shrink-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <p className="text-sm text-gray-600">Sucursal</p>
              <p className="text-lg font-bold text-gray-900">{checklist.store_name || 'N/A'}</p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <p className="text-sm text-gray-600">Usuario</p>
              <p className="text-lg font-bold text-gray-900">
                {checklist.manager_name || checklist.assistant_name || checklist.supervisor_name || 'N/A'}
              </p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <p className="text-sm text-gray-600">Score</p>
              <p className={`text-2xl font-bold ${checklist.score >= 80 ? 'text-green-600' :
                checklist.score >= 60 ? 'text-orange-600' : 'text-red-600'
                }`}>
                {checklist.score}%
              </p>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <p className="text-sm text-gray-600">Turno</p>
              <p className="text-lg font-bold text-gray-900">{checklist.shift || 'N/A'}</p>
            </div>
          </div>
        </div>

        <div className="border-b flex-shrink-0">
          <div className="flex">
            <button
              onClick={() => setActiveTab('answers')}
              className={`px-6 py-3 font-semibold transition-all ${activeTab === 'answers'
                ? 'border-b-2 border-indigo-600 text-indigo-600'
                : 'text-gray-600 hover:text-gray-900'
                }`}>
              Respuestas ({sections.reduce((acc, s) => acc + s.questions.length, 0)})
            </button>
            <button
              onClick={() => setActiveTab('photos')}
              className={`px-6 py-3 font-semibold transition-all ${activeTab === 'photos'
                ? 'border-b-2 border-indigo-600 text-indigo-600'
                : 'text-gray-600 hover:text-gray-900'
                }`}>
              Fotos ({photoUrls.length})
            </button>
            <button
              onClick={() => setActiveTab('reviews')}
              className={`px-6 py-3 font-semibold transition-all ${activeTab === 'reviews'
                ? 'border-b-2 border-indigo-600 text-indigo-600'
                : 'text-gray-600 hover:text-gray-900'
                }`}>
              Revisiones
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'answers' && (
            <div className="space-y-6">
              {sections.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-6xl mb-4">📋</div>
                  <p className="text-gray-600 mb-2">No se encontraron respuestas</p>
                </div>
              ) : (
                sections.map((section, idx) => (
                  <div key={idx} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <div className="bg-gray-100 px-4 py-3 border-b">
                      <h3 className="font-bold text-gray-900">{section.title}</h3>
                    </div>
                    <div className="divide-y">
                      {section.questions.map((q, qIdx) => (
                        <div key={qIdx} className="px-4 py-3 flex items-start justify-between gap-4 hover:bg-gray-50">
                          <p className="text-sm text-gray-700 flex-1">{q.text}</p>
                          <span className={`px-3 py-1 rounded-full text-xs font-bold flex-shrink-0 ${getAnswerBadge(q.value)}`}>
                            {q.value || 'N/A'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}

              {checklist.comments && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-bold text-blue-900 mb-2">Comentarios del Usuario</h4>
                  <p className="text-sm text-blue-800">{checklist.comments}</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'photos' && (
            <div>
              {photoUrls.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-6xl mb-4">📷</div>
                  <p className="text-gray-600">No hay fotos en este checklist</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {photoUrls.map((url: string, idx: number) => (
                    <div key={idx} className="relative group">
                      <img
                        src={url}
                        alt={`Foto ${idx + 1}`}
                        className="w-full h-48 object-cover rounded-lg shadow-md cursor-pointer hover:shadow-xl transition-all"
                        onClick={() => window.open(url, '_blank')}
                      />
                      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all rounded-lg flex items-center justify-center">
                        <span className="text-white opacity-0 group-hover:opacity-100 font-semibold text-sm">
                          Click para ampliar
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'reviews' && (
            <div className="space-y-4">
              {reviewLevels.map((level) => {
                const status = checklist[`estatus_${level}`]
                const reviewer = checklist[`reviso_${level}`]
                const comments = checklist[`comentarios_${level}`]
                const date = checklist[`fecha_revision_${level}`]

                const statusColors: { [key: string]: string } = {
                  'pendiente': 'bg-yellow-100 text-yellow-800',
                  'aprobado': 'bg-green-100 text-green-800',
                  'rechazado': 'bg-red-100 text-red-800',
                  'cerrado': 'bg-blue-100 text-blue-800'
                }

                const levelNames: { [key: string]: string } = {
                  'manager': 'Manager',
                  'supervisor': 'Supervisor',
                  'admin': 'Admin'
                }

                return (
                  <div key={level} className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-bold text-gray-900">Revisión de {levelNames[level]}</h4>
                      {status && (
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${statusColors[status] || 'bg-gray-100 text-gray-800'}`}>
                          {status.toUpperCase()}
                        </span>
                      )}
                    </div>

                    {reviewer ? (
                      <>
                        <div className="grid grid-cols-2 gap-4 mb-3">
                          <div>
                            <p className="text-xs text-gray-600">Revisado por:</p>
                            <p className="text-sm font-semibold text-gray-900">{reviewer}</p>
                          </div>
                          {date && (
                            <div>
                              <p className="text-xs text-gray-600">Fecha de revisión:</p>
                              <p className="text-sm font-semibold text-gray-900">{formatDateLA(date)}</p>
                            </div>
                          )}
                        </div>

                        {comments && (
                          <div className="bg-gray-50 rounded p-3">
                            <p className="text-xs text-gray-600 mb-1">Comentarios:</p>
                            <p className="text-sm text-gray-800">{comments}</p>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-gray-500 italic">Pendiente de revisión</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-t p-4 bg-gray-50 flex justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-semibold transition-all">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}