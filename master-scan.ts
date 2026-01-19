
import { spawn } from 'child_process'
import path from 'path'

// Definir los bloques de trabajo (Semestrales para proteger RAM)
const TASKS = [
    // 2020
    { start: '2020-01-01', end: '2020-06-30' },
    { start: '2020-07-01', end: '2020-12-31' },
    // 2021
    { start: '2021-01-01', end: '2021-06-30' },
    { start: '2021-07-01', end: '2021-12-31' },
    // 2022
    { start: '2022-01-01', end: '2022-06-30' },
    { start: '2022-07-01', end: '2022-12-31' },
    // 2023
    { start: '2023-01-01', end: '2023-06-30' },
    { start: '2023-07-01', end: '2023-12-31' },
    // 2024 (Ya casi lleno, pero por si acaso repasamos)
    { start: '2024-01-01', end: '2024-06-30' },
    { start: '2024-07-01', end: '2024-12-31' },
    // 2025
    { start: '2025-01-01', end: '2025-12-31' } // Año en curso (menos datos)
]

async function runTask(start: string, end: string, index: number, total: number) {
    return new Promise<void>((resolve, reject) => {
        console.log(`\n🎬 [MAESTRO] Iniciando bloque ${index + 1}/${total}: ${start} al ${end}`)
        console.log(`Memory Check: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB usados.`)

        // En Windows usamos 'npx.cmd', en Mac/Linux 'npx'
        const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'

        const child = spawn(command, ['tsx', 'populate-range.ts', start, end], {
            stdio: 'inherit', // Heredar colores y logs a la consola principal
            shell: true
        })

        child.on('close', (code) => {
            if (code === 0) {
                console.log(`✅ [MAESTRO] Bloque ${start}-${end} TERMINADO con éxito.`)
                resolve()
            } else {
                console.error(`❌ [MAESTRO] Bloque ${start}-${end} FALLÓ con código ${code}`)
                // Decidir si abortar o continuar. Continuamos por robustez.
                resolve()
            }
        })

        child.on('error', (err) => {
            console.error(`❌ [MAESTRO] Error al lanzar proceso:`, err)
            reject(err)
        })
    })
}

async function startOrchestra() {
    console.log('🎼 INICIANDO ORQUESTA DE POBLACIÓN DE DATOS (2020-2025)')
    console.log('🛡️  Estrategia: Procesos aislados por semestre para gestión de RAM.\n')

    for (let i = 0; i < TASKS.length; i++) {
        const task = TASKS[i]
        await runTask(task.start, task.end, i, TASKS.length)

        // Pausa de enfriamiento entre procesos
        console.log('❄️  Enfriando motores (5s)...')
        await new Promise(r => setTimeout(r, 5000))
    }

    console.log('\n🏁🏁🏁 ¡MISIÓN CUMPLIDA! TODOS LOS AÑOS PROCESADOS 🏁🏁🏁')
}

startOrchestra()
