/**
 * @module TabletBlindajeDelivery
 * @description Acceso directo de tableta para la Mesa de Empaque de Blindaje Delivery en sucursales de Tacos Gavilan.
 * @businessRules Mismas reglas que app/admin/blindaje-delivery/empaque/page.tsx.
 * @dataFlow Reexporta el componente de empaque para acceso táctil rápido en iPad o tabletas de cocina.
 */

import BlindajeDeliveryEmpaquePage from '@/app/admin/blindaje-delivery/empaque/page'

export const dynamic = 'force-dynamic'

export default function TabletBlindajeDelivery() {
  return <BlindajeDeliveryEmpaquePage />
}
