'use client'

import { useEffect, useState } from 'react'

export default function Page() {
  const [results, setResults] = useState<any>({})

  useEffect(() => {
    const testDate = '2025-12-23T10:00:00.000Z' // 23 de dic, 10am UTC
    const date = new Date(testDate)

    // Método 1: toLocaleDateString con timezone
    const method1 = date.toLocaleDateString('es-MX', { 
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })

    // Método 2: Manual UTC-8
    const utc = date.getTime()
    const offset = -8 * 60 * 60 * 1000
    const laDate = new Date(utc + offset)
    const day = String(laDate.getUTCDate()).padStart(2, '0')
    const month = String(laDate.getUTCMonth() + 1).padStart(2, '0')
    const year = laDate.getUTCFullYear()
    const method2 = `${day}/${month}/${year}`

    // Método 3: Sin timezone
    const method3 = date.toLocaleDateString('es-MX')

    // Método 4: Directamente de la base de datos
    const method4 = testDate.split('T')[0] // YYYY-MM-DD

    setResults({
      originalDate: testDate,
      method1Name: 'toLocaleDateString con timezone LA',
      method1,
      method2Name: 'Ajuste manual UTC-8',
      method2,
      method3Name: 'toLocaleDateString SIN timezone',
      method3,
      method4Name: 'String directo (YYYY-MM-DD)',
      method4,
      utcTime: date.toISOString(),
      localTime: date.toString()
    })
  }, [])

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">🔍 Test de Formato de Fechas</h1>
      
      <div className="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-4 mb-6">
        <p className="font-bold">Fecha de prueba:</p>
        <p className="text-2xl">{results.originalDate}</p>
        <p className="text-sm text-gray-600 mt-2">
          Esto representa: 23 de Diciembre 2025, 10:00 AM UTC<br/>
          En Los Angeles (UTC-8) debería ser: 23 de Diciembre 2025, 2:00 AM
        </p>
      </div>

      <div className="space-y-4">
        <div className="bg-white border-2 border-blue-400 rounded-lg p-4">
          <p className="font-bold text-blue-600">{results.method1Name}</p>
          <p className="text-3xl font-mono">{results.method1}</p>
          <p className="text-sm text-gray-600 mt-2">
            {results.method1?.includes('23') 
              ? '✅ CORRECTO - Muestra día 23' 
              : '❌ INCORRECTO - Muestra día diferente'}
          </p>
        </div>

        <div className="bg-white border-2 border-green-400 rounded-lg p-4">
          <p className="font-bold text-green-600">{results.method2Name}</p>
          <p className="text-3xl font-mono">{results.method2}</p>
          <p className="text-sm text-gray-600 mt-2">
            {results.method2?.includes('23') 
              ? '✅ CORRECTO - Muestra día 23' 
              : '❌ INCORRECTO - Muestra día diferente'}
          </p>
        </div>

        <div className="bg-white border-2 border-orange-400 rounded-lg p-4">
          <p className="font-bold text-orange-600">{results.method3Name}</p>
          <p className="text-3xl font-mono">{results.method3}</p>
          <p className="text-sm text-gray-600 mt-2">
            Usa la zona horaria del sistema operativo
          </p>
        </div>

        <div className="bg-white border-2 border-purple-400 rounded-lg p-4">
          <p className="font-bold text-purple-600">{results.method4Name}</p>
          <p className="text-3xl font-mono">{results.method4}</p>
          <p className="text-sm text-gray-600 mt-2">
            Fecha sin conversión (siempre correcta pero sin formato)
          </p>
        </div>
      </div>

      <div className="mt-8 bg-gray-100 rounded-lg p-4">
        <p className="font-bold mb-2">Información adicional:</p>
        <pre className="text-xs overflow-auto">
          {JSON.stringify(results, null, 2)}
        </pre>
      </div>

      <div className="mt-6 bg-red-50 border-2 border-red-400 rounded-lg p-4">
        <p className="font-bold text-red-600 mb-2">📸 Por favor toma screenshot de esta página</p>
        <p className="text-sm">
          Necesito ver qué métodos funcionan en tu navegador para darte la solución correcta.
        </p>
      </div>
    </div>
  )
}