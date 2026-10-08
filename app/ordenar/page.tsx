/**
 * @module app/ordenar/page
 * @description Ruta alternativa para la aplicación móvil de pedidos de Tacos Gavilan (/ordenar).
 * Redirige o renderiza el mismo componente inmersivo de /app.
 * 
 * @businessRules
 * - Proporciona un enlace corto y semántico (/ordenar) para clientes y comensales.
 * 
 * @dataFlow
 * - Reutiliza MobileAppPage de app/app/page.
 */

'use client'

export { default } from '../app/page'
