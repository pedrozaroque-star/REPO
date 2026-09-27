/**
 * @module TimesFMAdapter
 * @description Adaptador desacoplado y seguro para ejecutar predicciones de series de tiempo
 * con Google TimesFM 2.5 (modelo Apache-2.0 de 200M parámetros) en modo sombra (Shadow Mode).
 * Soporta inferencia individual y por lote (batch inference).
 * @businessRules
 * - No modifica la tabla de cache de producción (sales_projections_cache).
 * - No altera las reglas operativas de horarios, eventos por distancia ni capacidades de Tacos Gavilan.
 * - El día operativo comprende de 6:00 AM a 5:59 AM del siguiente día.
 * - Toda llamada a Python está blindada con límite de tiempo (timeout) y manejo defensivo de errores.
 * @dataFlow Serie histórica (ventas/tickets) -> subproceso Python (.venv_timesfm) -> predicción TimesFM 2.5 estructurada.
 * @notes No usar TimesFM 3.0 por restricciones de licencia no comercial; se usa exclusivamente TimesFM 2.5 (Apache-2.0).
 */

import { execFile } from 'child_process'
import path from 'path'
import fs from 'fs'

export interface TimesFMForecastInput {
    storeId: string
    series: number[]
    horizon: number
    metricType?: 'sales' | 'tickets'
}

export interface TimesFMForecastOutput {
    success: boolean
    horizon: number
    mean: number[]
    quantiles?: number[][] | null
    inputPoints: number
    error?: string
}

export interface TimesFMBatchInputItem {
    id: string
    series: number[]
}

export interface TimesFMBatchOutputItem {
    id: string
    success: boolean
    mean: number[]
    quantiles?: number[][] | null
    inputPoints: number
    error?: string
}

const PYTHON_EXECUTABLE = path.resolve(process.cwd(), '.venv_timesfm', 'Scripts', 'python.exe')
const RUNNER_SCRIPT = path.resolve(process.cwd(), 'scripts', 'timesfm_runner.py')

/**
 * Ejecuta una predicción individual de serie de tiempo utilizando Google TimesFM 2.5.
 */
export async function predictWithTimesFM(input: TimesFMForecastInput): Promise<TimesFMForecastOutput> {
    if (!fs.existsSync(PYTHON_EXECUTABLE)) {
        throw new Error(`Python virtual environment not found at: ${PYTHON_EXECUTABLE}. Run setup first.`)
    }
    if (!fs.existsSync(RUNNER_SCRIPT)) {
        throw new Error(`TimesFM runner script not found at: ${RUNNER_SCRIPT}`)
    }

    if (!input.series || input.series.length < 8) {
        throw new Error(`TimesFM requires at least 8 historical observations, received ${input.series?.length ?? 0}`)
    }

    const payload = JSON.stringify({
        series: input.series,
        horizon: input.horizon || 7
    })

    return new Promise((resolve) => {
        const child = execFile(
            PYTHON_EXECUTABLE,
            [RUNNER_SCRIPT, '--horizon', String(input.horizon || 7)],
            {
                cwd: process.cwd(),
                timeout: 180000, // 3 minutes max timeout for CPU inference
                maxBuffer: 25 * 1024 * 1024
            },
            (error, stdout, stderr) => {
                if (error) {
                    console.error('❌ [TimesFM Adapter] Execution error:', error.message)
                    if (stderr) console.error('Python stderr:', stderr)
                    return resolve({
                        success: false,
                        horizon: input.horizon,
                        mean: [],
                        inputPoints: input.series.length,
                        error: error.message || stderr
                    })
                }

                try {
                    const trimmed = stdout.trim()
                    const jsonStart = trimmed.indexOf('{')
                    const jsonEnd = trimmed.lastIndexOf('}')
                    if (jsonStart === -1 || jsonEnd === -1) {
                        throw new Error(`Invalid JSON output from TimesFM runner: ${trimmed}`)
                    }
                    const jsonStr = trimmed.substring(jsonStart, jsonEnd + 1)
                    const parsed = JSON.parse(jsonStr)

                    if (!parsed.success) {
                        return resolve({
                            success: false,
                            horizon: input.horizon,
                            mean: [],
                            inputPoints: input.series.length,
                            error: parsed.error || 'Unknown TimesFM inference error'
                        })
                    }

                    resolve({
                        success: true,
                        horizon: parsed.horizon,
                        mean: parsed.mean || [],
                        quantiles: parsed.quantiles || null,
                        inputPoints: parsed.input_points || input.series.length
                    })
                } catch (parseErr: any) {
                    resolve({
                        success: false,
                        horizon: input.horizon,
                        mean: [],
                        inputPoints: input.series.length,
                        error: `Failed to parse TimesFM output: ${parseErr.message}`
                    })
                }
            }
        )

        child.stdin?.write(payload)
        child.stdin?.end()
    })
}

/**
 * Ejecuta una predicción en lote (batch) de múltiples series de tiempo en una sola pasada.
 * Acelera drásticamente el backtest al reutilizar los pesos del modelo en memoria.
 */
export async function predictBatchWithTimesFM(
    items: TimesFMBatchInputItem[],
    horizon: number = 7
): Promise<TimesFMBatchOutputItem[]> {
    if (!fs.existsSync(PYTHON_EXECUTABLE)) {
        throw new Error(`Python virtual environment not found at: ${PYTHON_EXECUTABLE}`)
    }
    if (!fs.existsSync(RUNNER_SCRIPT)) {
        throw new Error(`TimesFM runner script not found at: ${RUNNER_SCRIPT}`)
    }

    if (!items || items.length === 0) return []

    // Filter valid items
    const validItems = items.filter(it => it.series && it.series.length >= 8)
    if (validItems.length === 0) {
        return items.map(it => ({
            id: it.id,
            success: false,
            mean: [],
            inputPoints: it.series?.length ?? 0,
            error: 'Series length < 8'
        }))
    }

    const payload = JSON.stringify({
        batch: validItems.map(it => it.series),
        horizon
    })

    const tempFile = path.resolve(process.cwd(), 'reports', 'scratch', `batch_${Date.now()}_${Math.floor(Math.random() * 100000)}.json`)
    fs.writeFileSync(tempFile, payload, 'utf-8')

    return new Promise((resolve) => {
        const child = execFile(
            PYTHON_EXECUTABLE,
            [RUNNER_SCRIPT, '--horizon', String(horizon), '--input', tempFile],
            {
                cwd: process.cwd(),
                timeout: 300000, // 5 minutes max timeout for batch inference
                maxBuffer: 50 * 1024 * 1024
            },
            (error, stdout, stderr) => {
                // Safely cleanup scratch file
                try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile) } catch (_) { }

                if (error) {
                    console.error('❌ [TimesFM Batch Adapter] Execution error:', error.message)
                    if (stderr) console.error('Python stderr:', stderr)
                    return resolve(validItems.map(it => ({
                        id: it.id,
                        success: false,
                        mean: [],
                        inputPoints: it.series.length,
                        error: error.message || stderr
                    })))
                }

                try {
                    const trimmed = stdout.trim()
                    const jsonStart = trimmed.indexOf('{')
                    const jsonEnd = trimmed.lastIndexOf('}')
                    if (jsonStart === -1 || jsonEnd === -1) {
                        throw new Error(`Invalid JSON output: ${trimmed}`)
                    }
                    const jsonStr = trimmed.substring(jsonStart, jsonEnd + 1)
                    const parsed = JSON.parse(jsonStr)

                    if (!parsed.success || !parsed.means) {
                        return resolve(validItems.map(it => ({
                            id: it.id,
                            success: false,
                            mean: [],
                            inputPoints: it.series.length,
                            error: parsed.error || 'Batch inference failed'
                        })))
                    }

                    const results: TimesFMBatchOutputItem[] = validItems.map((it, idx) => ({
                        id: it.id,
                        success: true,
                        mean: parsed.means[idx] || [],
                        quantiles: parsed.quantiles ? parsed.quantiles[idx] : null,
                        inputPoints: it.series.length
                    }))

                    resolve(results)
                } catch (parseErr: any) {
                    resolve(validItems.map(it => ({
                        id: it.id,
                        success: false,
                        mean: [],
                        inputPoints: it.series.length,
                        error: `Parse error: ${parseErr.message}`
                    })))
                }
            }
        )
    })
}
