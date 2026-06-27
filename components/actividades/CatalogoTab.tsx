'use client'

/**
 * @module CatalogoTab
 * @description Wrapper that renders the existing ProceduresTimeline component inside the Actividades module,
 *   plus a "Checklist" button that opens a fullscreen interactive checklist for tablet use.
 * @businessRules
 * - Reuses ProceduresTimeline exactly as-is — no modifications needed.
 * - The ProceduresTimeline already handles CRUD for operating_procedures, realtime sync, filtering, and i18n.
 * - The Checklist button opens ChecklistMode in fullscreen portal for manager/assistant use on tablets.
 * @dataFlow
 * - ProceduresTimeline reads/writes operating_procedures via /api/procedimientos
 * - ChecklistMode reads operating_procedures + reads/writes checklist_completions
 * @notes
 * - This is intentionally a thin wrapper to avoid duplicating code.
 * - The ProceduresTimeline component excludes procedures where role === 'ROLES_MODULE'.
 */

import { useState } from 'react'
import ProceduresTimeline from '@/components/procedimientos/ProceduresTimeline'
import ChecklistMode from '@/components/actividades/ChecklistMode'
import { useLanguage } from '@/lib/i18n'
import { ClipboardCheck } from 'lucide-react'

export default function CatalogoTab() {
  const [showChecklist, setShowChecklist] = useState(false)
  const { t } = useLanguage()

  return (
    <div className="pb-24">
      {/* Checklist floating button */}
      <div style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 1000,
      }}>
        <button
          onClick={() => setShowChecklist(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '14px 24px',
            borderRadius: '16px',
            border: 'none',
            background: 'linear-gradient(135deg, #ea580c 0%, #f97316 100%)',
            color: '#fff',
            fontSize: '16px',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 8px 32px rgba(234,88,12,0.4), 0 2px 8px rgba(0,0,0,0.2)',
            transition: 'all 0.2s ease',
            fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
          }}
          onMouseOver={e => {
            e.currentTarget.style.transform = 'translateY(-2px) scale(1.03)'
            e.currentTarget.style.boxShadow = '0 12px 40px rgba(234,88,12,0.5), 0 4px 12px rgba(0,0,0,0.3)'
          }}
          onMouseOut={e => {
            e.currentTarget.style.transform = 'translateY(0) scale(1)'
            e.currentTarget.style.boxShadow = '0 8px 32px rgba(234,88,12,0.4), 0 2px 8px rgba(0,0,0,0.2)'
          }}
        >
          <ClipboardCheck size={22} />
          {t('actividades.checklist.btn')}
        </button>
      </div>

      <ProceduresTimeline />

      {showChecklist && (
        <ChecklistMode onClose={() => setShowChecklist(false)} />
      )}
    </div>
  )
}
