/**
 * @module scripts/backfill-ronos-assignment
 * @description Ejecuta una carga de cuatro semanas RONOS para persistir assignmentId en el período bisemanal operativo.
 * @businessRules No vincula por nombre; conserva la llave nativa extraída de las ponchadas y usa upserts idempotentes.
 * @dataFlow syncAllStoresRonos(4) -> auditoría RONOS -> ronos_employee_timecards_cache.
 * @notes Cubre las semanas requeridas por el período Cingular cerrado 2026-08-24 a 2026-09-06 sin modificar datos de nómina manualmente.
 */
import { syncAllStoresRonos } from './sync-all-stores-ronos'

syncAllStoresRonos(4).catch(error => {
  console.error(error)
  process.exitCode = 1
})
