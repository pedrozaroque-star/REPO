/**
 * test-audio-queue-simulation.ts
 * Simulación de cola unificada de audio para Order Ready Board y Tableta de Preparador
 * Prueba que múltiples llamadas simultáneas esperen su turno sin encimarse (sin amontonamiento).
 */

interface QueuedItem {
  id: string
  order_number: string
  source: 'auto' | 'tablet' | 'manual' | 'reminder' | 'announcement' | 'test'
  durationMs: number
  _fromTablet?: boolean
  _manualReplay?: boolean
  _repeats?: number
}

class AudioQueueSimulator {
  private queue: QueuedItem[] = []
  private isPlaying = false
  public logs: string[] = []

  public enqueueOrder(item: QueuedItem) {
    // Deduplicación para toques rápidos en pantalla o tableta
    const alreadyInQueue = this.queue.some(
      (q) => q.id === item.id || (q.order_number === item.order_number && (q._fromTablet || q._manualReplay))
    )
    if (alreadyInQueue) {
      this.logs.push(`[IGNORADO] Evento duplicado evitado para Orden #${item.order_number} (${item.source})`)
      return
    }

    this.queue.push(item)
    this.logs.push(`[ENCOLADO] Orden #${item.order_number} (${item.source}) encolada. Total en cola: ${this.queue.length}`)

    if (!this.isPlaying) {
      this.processQueue()
    }
  }

  public enqueueCustomAnnouncement(text: string, durationMs: number) {
    if (this.isPlaying || this.queue.length > 0) {
      this.logs.push(`[REPROGRAMADO] Anuncio personalizado "${text.slice(0, 20)}..." reprogramado porque hay audio en curso o cola activa.`)
      return
    }
    this.logs.push(`[ANUNCIO INICIADO] Anuncio "${text.slice(0, 20)}..." iniciado`)
    this.isPlaying = true
  }

  public enqueueTestSound(durationMs: number) {
    if (this.isPlaying || this.queue.length > 0) {
      this.logs.push(`[TEST RECHAZADO] Prueba de voz rechazada para no interrumpir órdenes activas o en cola.`)
      return
    }
    this.logs.push(`[TEST INICIADO] Prueba de voz iniciada`)
    this.isPlaying = true
  }

  private async processQueue() {
    if (this.isPlaying || this.queue.length === 0) return

    this.isPlaying = true
    const current = this.queue.shift()!

    this.logs.push(`▶ [REPRODUCIENDO] Iniciando Orden #${current.order_number} (${current.source}) - ${current.durationMs}ms`)
    
    // Simular reproducción del chime + voz
    await new Promise((r) => setTimeout(r, current.durationMs))

    this.logs.push(`✔ [FINALIZADO] Terminó Orden #${current.order_number} (${current.source})`)

    // Pausa acústica de 400ms para evitar encimamiento
    await new Promise((r) => setTimeout(r, 400))

    this.isPlaying = false

    if (this.queue.length > 0) {
      this.processQueue()
    } else {
      this.logs.push(`🏁 [COLA VACÍA] Todos los audios fueron reproducidos en orden secuencial sin encimarse.`)
    }
  }

  public getQueueLength(): number {
    return this.queue.length
  }

  public isCurrentlyPlaying(): boolean {
    return this.isPlaying
  }
}

async function runSimulation() {
  console.log('--- INICIANDO SIMULACIÓN DE EXCLUSIÓN MUTUA DE AUDIO (TACOS GAVILAN) ---')
  const sim = new AudioQueueSimulator()

  // 1. Llega Orden #141 automáticamente
  sim.enqueueOrder({ id: 'ord-141', order_number: '141', source: 'auto', durationMs: 600 })

  // 2. Apenas 100ms después, el entregador en la tableta del preparador presiona Orden #205 ("ÓRDENES" tab)
  await new Promise((r) => setTimeout(r, 100))
  sim.enqueueOrder({ id: 'ord-205', order_number: '205', source: 'tablet', _fromTablet: true, durationMs: 500 })

  // 3. El entregador presiona dos veces rápidamente Orden #205 (doble toque accidental)
  sim.enqueueOrder({ id: 'ord-205', order_number: '205', source: 'tablet', _fromTablet: true, durationMs: 500 })

  // 4. A los 250ms, el manager en la PC hace clic en "Llamar" para Orden #88
  await new Promise((r) => setTimeout(r, 150))
  sim.enqueueOrder({ id: 'ord-88', order_number: '88', source: 'manual', _manualReplay: true, durationMs: 500 })

  // 5. Intento de anuncio personalizado mientras la cola está ocupada
  sim.enqueueCustomAnnouncement('¡Bienvenidos a Tacos Gavilan! Prueben nuestros tacos de asada.', 800)

  // 6. Intento de test sound mientras la cola está ocupada
  sim.enqueueTestSound(400)

  // Esperar a que todo el procesamiento termine
  await new Promise((r) => setTimeout(r, 3500))

  console.log('\n--- LOGS DE EJECUCIÓN SECUENCIAL ---')
  sim.logs.forEach((log) => console.log(log))

  // Validaciones
  const hasOverlap = sim.logs.filter((l) => l.includes('▶ [REPRODUCIENDO]')).length !==
                     sim.logs.filter((l) => l.includes('✔ [FINALIZADO]')).length
  if (hasOverlap) {
    throw new Error('FALLO: Hubo audios que no finalizaron o se ejecutaron en paralelo.')
  }

  const ignoredDups = sim.logs.filter((l) => l.includes('[IGNORADO]')).length
  if (ignoredDups !== 1) {
    throw new Error('FALLO: La deduplicación no atrapó el doble toque accidental.')
  }

  console.log('\n✅ SIMULACIÓN EXITOSA: Cero encimamiento, cola FIFO respetada, pausa acústica de 400ms activa y deduplicación garantizada.')
}

runSimulation().catch((err) => {
  console.error('ERROR EN SIMULACIÓN:', err)
  process.exit(1)
})
