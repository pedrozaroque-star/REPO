/**
 * @module scripts/run-weekly-email-audit
 * @description Script ejecutable para correr la auditoría semanal completa de correos de empleados activos
 * con soporte directo de TCP Puerto 25 (`SMTP RCPT TO` contra `gmail-smtp-in.l.google.com`), sincronización
 * en vivo desde Toast POS en las 15 sucursales, persistencia de `smtpCache` en Supabase (`integrations`) y
 * despacho automático de alertas a cada Store Manager involucrado (CC Supervisor de Zona) + resumen a Carlos.
 *
 * @businessRules
 * - Programado localmente los sábados a la 1:30 PM hora LA California (30 minutos antes del Vercel Cron
 *   de respaldo `0 22 * * 6` de las 2:00 PM PST / 3:00 PM PDT).
 * - Si se ejecuta y despacha a la 1:30 PM, estampa `lastDispatchedDateLA` en Supabase para que el Vercel Cron
 *   de las 2:00 PM detecte la ejecución del día y no duplique ningún correo.
 * - Si la computadora está apagada el sábado, Vercel Cron ejecuta automáticamente la auditoría en la nube a las 2:00 PM.
 *
 * @dataFlow
 * - `tsx --env-file=.env.local scripts/run-weekly-email-audit.ts [--dry-run] [--seed-cache] [--skip-toast-sync] [--force]`
 *   -> `runEmployeeEmailAudit()` (`lib/employee-email-auditor.ts`).
 *
 * @notes
 * - Uso de prueba sin enviar correos: `npx tsx --env-file=.env.local scripts/run-weekly-email-audit.ts --dry-run`
 */

import { runEmployeeEmailAudit } from '../lib/employee-email-auditor'

async function main() {
    const args = process.argv.slice(2)
    const dryRun = args.includes('--dry-run')
    const seedCacheOnly = args.includes('--seed-cache')
    const skipToastSync = args.includes('--skip-toast-sync')
    const force = args.includes('--force')
    const testToArg = args.find((a) => a.startsWith('--test-to='))
    const testTo = testToArg ? testToArg.split('=')[1] : null

    console.log(
        `[TEG Weekly Email Audit] Starting (${
            seedCacheOnly ? 'SEED_CACHE_ONLY' : dryRun ? 'DRY_RUN' : 'LIVE_DISPATCH'
        })...`
    )

    const result = await runEmployeeEmailAudit({
        dryRun,
        seedCacheOnly,
        syncToastFirst: !skipToastSync,
        force,
        testTo,
    })

    console.log(
        JSON.stringify(
            {
                executedAt: result.executedAt,
                dateLA: result.dateLA,
                port25Available: result.port25Available,
                toastSyncedStores: result.toastSyncedStores,
                toastSyncedEmployees: result.toastSyncedEmployees,
                totalActiveEmployeesAudited: result.totalActiveEmployeesAudited,
                uniqueEmailsVerified: result.uniqueEmailsVerified,
                validEmployeesCount: result.validEmployeesCount,
                flaggedEmployeesCount: result.flaggedEmployeesCount,
                affectedStoresCount: result.affectedStoresCount,
                cleanStores: result.cleanStores,
                skippedDuplicateSameDay: result.skippedDuplicateSameDay,
                managerEmailsSent: result.managerEmailsSent,
                summaryEmailMessageId: result.summaryEmailMessageId,
                affectedSummary: result.storeGroups.map((g) => ({
                    store: g.storeName,
                    manager: `${g.managerName} <${g.managerEmail}>`,
                    ccSupervisor: `${g.supervisorName} <${g.supervisorEmail}>`,
                    employees: g.employees.map(
                        (e) => `${e.name} | ${e.currentEmail} | ${e.issueBadge}`
                    ),
                })),
            },
            null,
            2
        )
    )
}

main().catch((err) => {
    console.error('[TEG Weekly Email Audit] FATAL:', err)
    process.exit(1)
})
