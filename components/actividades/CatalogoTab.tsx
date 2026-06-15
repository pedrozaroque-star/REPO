'use client'

/**
 * @module CatalogoTab
 * @description Wrapper that renders the existing ProceduresTimeline component inside the Actividades module.
 * @businessRules
 * - Reuses ProceduresTimeline exactly as-is — no modifications needed.
 * - The ProceduresTimeline already handles CRUD for operating_procedures, realtime sync, filtering, and i18n.
 * @dataFlow
 * - ProceduresTimeline reads/writes operating_procedures via /api/procedimientos
 * @notes
 * - This is intentionally a thin wrapper to avoid duplicating code.
 * - The ProceduresTimeline component excludes procedures where role === 'ROLES_MODULE'.
 */

import ProceduresTimeline from '@/components/procedimientos/ProceduresTimeline'

export default function CatalogoTab() {
  return (
    <div className="pb-24">
      <ProceduresTimeline />
    </div>
  )
}
