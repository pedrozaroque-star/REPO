/**
 * @module ContabilidadLayout
 * @description Layout and route protection for the Accounting (Contabilidad) module.
 * @businessRules
 * - Access is strictly restricted to 'admin' users only.
 * @dataFlow ProtectedRoute wraps all subpages (/contabilidad, /contabilidad/[packetId], /contabilidad/configuracion).
 */

'use client'

import ProtectedRoute from '@/components/ProtectedRoute'

export default function ContabilidadLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      {children}
    </ProtectedRoute>
  )
}
