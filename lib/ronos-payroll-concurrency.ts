/**
 * @module lib/ronos-payroll-concurrency
 * @description Ejecuta cálculos independientes de nómina RONOS con concurrencia limitada y conserva el orden de entrada.
 *
 * @businessRules
 *   - La cadena no debe ejecutar una solicitud pesada por las 16 ubicaciones de forma serial.
 *   - El límite de concurrencia protege a RONOS, Simplify HR y Supabase de picos de consultas.
 *   - El resultado conserva el orden de las tiendas para que los fallos se puedan presentar de forma consistente.
 *
 * @dataFlow
 *   Lista de tiendas -> pool limitado de workers -> resultados indexados -> consolidado de nómina RONOS.
 *
 * @notes
 *   - No implementa timeouts artificiales: cancelar una promesa sin cancelar su consulta subyacente aumentaría la carga.
 *   - Los errores de cada tienda se devuelven al llamador para que el consolidado los marque como parciales.
 */

export async function mapWithConcurrency<T, TResult>(
  items: readonly T[],
  maxConcurrency: number,
  worker: (item: T, index: number) => Promise<TResult>
): Promise<TResult[]> {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new Error('maxConcurrency debe ser un entero mayor que cero.')
  }

  const results = new Array<TResult>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(maxConcurrency, items.length)

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  }))

  return results
}
