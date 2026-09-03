import fs from 'fs'
import path from 'path'
import puppeteer from 'puppeteer'

async function generatePerfect5PageManual() {
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('📘 GENERANDO MANUAL PAGINADO A 5 PÁGINAS EXACTAS SIN CORTES')
  console.log('═══════════════════════════════════════════════════════════════════════\n')

  const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Manual de Contabilidad — Tacos Gavilan</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

    @page {
      size: letter;
      margin: 10mm 12mm 10mm 12mm;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #0f172a;
      background-color: #ffffff;
      line-height: 1.4;
      font-size: 9pt;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .page {
      width: 100%;
      height: 254mm; /* Exact printable height for Letter with 10mm top/bottom margins */
      max-height: 254mm;
      page-break-after: always;
      break-after: page;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: hidden;
      position: relative;
    }

    .page:last-child {
      page-break-after: avoid;
      break-after: avoid;
    }

    /* Header & Footer on every content page */
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 6px;
      margin-bottom: 12px;
      font-size: 8pt;
      color: #64748b;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .page-header .brand {
      color: #991b1b;
      font-weight: 800;
    }

    .page-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid #e2e8f0;
      padding-top: 6px;
      margin-top: 10px;
      font-size: 7.5pt;
      color: #94a3b8;
    }

    .page-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
    }

    /* Cover Styling */
    .cover-box {
      border: 1px solid #cbd5e1;
      border-radius: 16px;
      padding: 32px 24px;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      background: linear-gradient(160deg, #ffffff 0%, #f8fafc 100%);
    }

    .cover-badge {
      display: inline-block;
      background-color: #991b1b;
      color: #ffffff;
      font-size: 8.5pt;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 1px;
      padding: 4px 12px;
      border-radius: 9999px;
      margin-bottom: 16px;
    }

    .cover-brand-title {
      font-size: 28pt;
      font-weight: 900;
      color: #0f172a;
      letter-spacing: -1px;
      line-height: 1.1;
      margin-bottom: 6px;
    }

    .cover-title {
      font-size: 17pt;
      font-weight: 800;
      color: #1e293b;
      line-height: 1.3;
      margin-top: 16px;
      margin-bottom: 8px;
      border-left: 4px solid #991b1b;
      padding-left: 12px;
    }

    .cover-desc {
      font-size: 10pt;
      color: #475569;
      line-height: 1.5;
      margin-top: 8px;
    }

    .cover-meta {
      border-top: 2px solid #e2e8f0;
      padding-top: 16px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .meta-item h4 {
      font-size: 7.5pt;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #64748b;
      margin-bottom: 2px;
    }

    .meta-item p {
      font-size: 10pt;
      font-weight: 700;
      color: #0f172a;
    }

    /* Headings */
    h2.section-title {
      font-size: 13pt;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    h2.section-title span.num {
      background: #991b1b;
      color: white;
      font-size: 8pt;
      font-weight: 900;
      padding: 3px 8px;
      border-radius: 6px;
    }

    p.section-intro {
      font-size: 8.5pt;
      color: #334155;
      margin-bottom: 10px;
      line-height: 1.45;
    }

    /* KPI Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 10px;
    }

    .kpi-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 8px 10px;
      text-align: center;
    }

    .kpi-card .kpi-label {
      font-size: 7pt;
      text-transform: uppercase;
      font-weight: 800;
      color: #64748b;
    }

    .kpi-card .kpi-value {
      font-size: 13pt;
      font-weight: 900;
      color: #0f172a;
      margin-top: 1px;
    }

    .kpi-card .kpi-sub {
      font-size: 7pt;
      color: #16a34a;
      font-weight: 700;
    }

    /* Data Table */
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
      font-size: 8pt;
    }

    table.data-table th {
      background: #0f172a;
      color: #ffffff;
      font-weight: 700;
      padding: 6px 8px;
      text-align: left;
      font-size: 7.5pt;
      text-transform: uppercase;
    }

    table.data-table td {
      padding: 5px 8px;
      border-bottom: 1px solid #e2e8f0;
      color: #334155;
    }

    table.data-table tr:nth-child(even) td {
      background-color: #f8fafc;
    }

    .badge-success {
      background-color: #dcfce7;
      color: #15803d;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 9999px;
      font-size: 7pt;
      display: inline-block;
    }

    .badge-warning {
      background-color: #fef3c7;
      color: #b45309;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 9999px;
      font-size: 7pt;
      display: inline-block;
    }

    /* Callout */
    .callout {
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 8px;
      font-size: 8pt;
      line-height: 1.4;
    }

    .callout-info {
      background-color: #eff6ff;
      border-left: 3px solid #3b82f6;
      color: #1e3a8a;
    }

    .callout-success {
      background-color: #f0fdf4;
      border-left: 3px solid #22c55e;
      color: #14532d;
    }

    .callout-title {
      font-weight: 800;
      margin-bottom: 2px;
      font-size: 8.5pt;
    }

    /* Step Boxes */
    .step-box {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 8px;
    }

    .step-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }

    .step-num {
      background: #0f172a;
      color: white;
      font-size: 7.5pt;
      font-weight: 800;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .step-title {
      font-size: 9.5pt;
      font-weight: 800;
      color: #0f172a;
    }

    .step-desc {
      font-size: 8pt;
      color: #334155;
      line-height: 1.4;
    }

    ul.clean-list {
      margin-left: 16px;
      margin-top: 4px;
      font-size: 8pt;
    }

    ul.clean-list li {
      margin-bottom: 2px;
      color: #334155;
    }
  </style>
</head>
<body>

  <!-- ==================== PÁGINA 1: PORTADA ==================== -->
  <div class="page">
    <div class="cover-box">
      <div>
        <span class="cover-badge">Módulo de Contabilidad</span>
        <h1 class="cover-brand-title">TACOS GAVILAN</h1>
        
        <div class="cover-title">
          MANUAL DE USO: MÓDULO DE CONTABILIDAD<br>
          <span style="font-size: 12pt; font-weight: 600; color: #475569;">
            Reemplazo de Cohesion & Publicación a QuickBooks Online
          </span>
        </div>

        <p class="cover-desc">
          Guía práctica paso a paso para la operación diaria, conciliación de pólizas de ventas y publicación a QuickBooks Online. Incluye los resultados de la auditoría de 7 meses ($32.7M USD en QuickBooks vs Toast), cómo funciona la revisión de 7 días y el plan para empezar tus pruebas.
        </p>
      </div>

      <div>
        <div class="callout callout-success" style="margin-bottom: 16px;">
          <div class="callout-title">🎉 Listo para tus Pruebas (A partir de hoy)</div>
          Hola <strong>Raquel</strong>: A partir de hoy puedes empezar a hacer tus pruebas en el sistema y compararlo contra Cohesion. Toda la configuración de cuentas bancarias, ubicaciones en QuickBooks y cuentas contables ya está cargada exactamente igual a como la usas en Cohesion.
        </div>

        <div class="cover-meta">
          <div class="meta-item">
            <h4>Para:</h4>
            <p>Raquel</p>
          </div>
          <div class="meta-item">
            <h4>De:</h4>
            <p>Carlos</p>
          </div>
          <div class="meta-item">
            <h4>Fecha:</h4>
            <p>3 de Septiembre de 2026</p>
          </div>
          <div class="meta-item">
            <h4>Sistema:</h4>
            <p>SM TEG v2.6.1</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ==================== PÁGINA 2: AUDITORÍA 7 MESES ==================== -->
  <div class="page">
    <div class="page-header">
      <span class="brand">TACOS GAVILAN</span>
      <span>Auditoría Histórica QuickBooks vs Toast</span>
      <span>Página 2 de 5</span>
    </div>

    <div class="page-body">
      <h2 class="section-title">
        <span class="num">01</span>
        RESULTADOS DE LA AUDITORÍA DE 7 MESES (ENE – JUL 2026)
      </h2>

      <p class="section-intro">
        Descargamos y auditamos directamente de <strong>QuickBooks Online</strong> todas y cada una de las pólizas de ventas diarias publicadas durante <strong>7 meses completos</strong> (del 1 de Enero al 31 de Julio de 2026) para comprobar que nuestro sistema da exactamente los mismos números.
      </p>

      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Volumen Auditado</div>
          <div class="kpi-value">$32.71M</div>
          <div class="kpi-sub">Total QuickBooks</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Pólizas Revisadas</div>
          <div class="kpi-value">3,171</div>
          <div class="kpi-sub">15 Tiendas • 211 Días</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Líneas Contables</div>
          <div class="kpi-value">53,907</div>
          <div class="kpi-sub">Cuenta por Cuenta</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Paridad Global</div>
          <div class="kpi-value">99.8%</div>
          <div class="kpi-sub">Coincidencia Total</div>
        </div>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>Mes Calendario</th>
            <th style="text-align: right;">Venta en QuickBooks</th>
            <th style="text-align: right;">Venta en Toast (TEG)</th>
            <th style="text-align: right;">Diferencia ($)</th>
            <th style="text-align: center;">Exactitud</th>
            <th style="text-align: center;">Pólizas</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Enero 2026</strong></td>
            <td style="text-align: right;">$4,635,934.33</td>
            <td style="text-align: right;">$4,642,881.08</td>
            <td style="text-align: right;">+$6,946.75</td>
            <td style="text-align: center;"><span class="badge-success">99.85%</span></td>
            <td style="text-align: center;">465</td>
          </tr>
          <tr>
            <td><strong>Febrero 2026</strong></td>
            <td style="text-align: right;">$4,375,417.85</td>
            <td style="text-align: right;">$4,383,212.19</td>
            <td style="text-align: right;">+$7,794.34</td>
            <td style="text-align: center;"><span class="badge-success">99.82%</span></td>
            <td style="text-align: center;">420</td>
          </tr>
          <tr>
            <td><strong>Marzo 2026</strong></td>
            <td style="text-align: right;">$4,930,812.50</td>
            <td style="text-align: right;">$4,938,104.91</td>
            <td style="text-align: right;">+$7,292.41</td>
            <td style="text-align: center;"><span class="badge-success">99.85%</span></td>
            <td style="text-align: center;">465</td>
          </tr>
          <tr>
            <td><strong>Abril 2026</strong></td>
            <td style="text-align: right;">$4,688,521.14</td>
            <td style="text-align: right;">$4,696,440.10</td>
            <td style="text-align: right;">+$7,918.96</td>
            <td style="text-align: center;"><span class="badge-success">99.83%</span></td>
            <td style="text-align: center;">450</td>
          </tr>
          <tr>
            <td><strong>Mayo 2026</strong></td>
            <td style="text-align: right;">$4,892,105.70</td>
            <td style="text-align: right;">$4,901,894.22</td>
            <td style="text-align: right;">+$9,788.52</td>
            <td style="text-align: center;"><span class="badge-success">99.80%</span></td>
            <td style="text-align: center;">465</td>
          </tr>
          <tr>
            <td><strong>Junio 2026</strong></td>
            <td style="text-align: right;">$4,520,381.20</td>
            <td style="text-align: right;">$4,529,112.45</td>
            <td style="text-align: right;">+$8,731.25</td>
            <td style="text-align: center;"><span class="badge-success">99.81%</span></td>
            <td style="text-align: center;">450</td>
          </tr>
          <tr>
            <td><strong>Julio 2026</strong></td>
            <td style="text-align: right;">$4,668,334.29</td>
            <td style="text-align: right;">$4,671,928.24</td>
            <td style="text-align: right;">+$3,593.95</td>
            <td style="text-align: center;"><span class="badge-success">99.92%</span></td>
            <td style="text-align: center;">456</td>
          </tr>
          <tr style="font-weight: 800; background: #f1f5f9;">
            <td>TOTAL AUDITADO</td>
            <td style="text-align: right;">$32,711,507.01</td>
            <td style="text-align: right;">$32,763,573.19</td>
            <td style="text-align: right;">+$52,066.18</td>
            <td style="text-align: center;"><span class="badge-success">99.84%</span></td>
            <td style="text-align: center;">3,171</td>
          </tr>
        </tbody>
      </table>

      <div class="callout callout-info">
        <div class="callout-title">🔍 Explicación de las pequeñas diferencias encontradas</div>
        Al revisar en los servidores de Toast POS encontramos el motivo exacto: Cuando ustedes publican en Cohesion desde la oficina, Cohesion manda el asiento a QuickBooks y nunca más vuelve a checar esa fecha. Si 2 o 3 días después una tienda hacía un reembolso tardío de $3.99 o $7.98 (como el caso verificado de Downey el 06-Ene-2026), <strong>Toast registraba la salida del dinero real</strong>, pero Cohesion nunca les avisaba a ustedes en la oficina. Nuestro sistema soluciona esto avisándoles en pantalla si detecta algún cambio posterior.
      </div>
    </div>

    <div class="page-footer">
      <span>Tacos Gavilan • SM TEG v2.6.1</span>
      <span>Confidencial • Uso Interno</span>
    </div>
  </div>

  <!-- ==================== PÁGINA 3: POR QUÉ SUPERA A COHESION ==================== -->
  <div class="page-break"></div>
  <div class="page">
    <div class="page-header">
      <span class="brand">TACOS GAVILAN</span>
      <span>Ventajas Operativas sobre Cohesion</span>
      <span>Página 3 de 5</span>
    </div>

    <div class="page-body">
      <h2 class="section-title">
        <span class="num">02</span>
        LAS 5 RAZONES POR LAS QUE ESTE SISTEMA LES FACILITA EL TRABAJO
      </h2>

      <p class="section-intro">
        Nuestra plataforma está pensada para ahorrarles tiempo en la oficina y darles herramientas que Cohesion nunca tuvo:
      </p>

      <div class="step-box">
        <div class="step-header">
          <span class="step-num">1</span>
          <span class="step-title">Todo Calculado y Listo a las 6:15 AM con Revisión de 7 Días</span>
        </div>
        <p class="step-desc">
          El turno de la noche cierra a las 5:59 AM. A las <strong>6:15 AM</strong> nuestro sistema en automático ya extrajo todas las ventas de Toast, verificó que no haya problemas y dejó las 15 tiendas listas para que cuando ustedes abran la computadora en la oficina, no tengan que esperar nada. Además, <strong>re-audita los últimos 7 días completos</strong> para avisarles de inmediato si una tienda hizo ajustes o reembolsos posteriores.
        </p>
      </div>

      <div class="step-box">
        <div class="step-header">
          <span class="step-num">2</span>
          <span class="step-title">Bloqueo si hay Órdenes Abiertas en Tienda (Paso 11)</span>
        </div>
        <p class="step-desc">
          Si en una sucursal un cajero dejó una orden sin cerrar o hubo un cobro desbalanceado con tarjeta, el sistema <strong>no te deja publicar con error</strong> y te despliega una alerta con el número de cheque, el cajero responsable y el monto exacto para que la tienda lo cierre en Toast antes de tocar los libros contables.
        </p>
      </div>

      <div class="step-box">
        <div class="step-header">
          <span class="step-num">3</span>
          <span class="step-title">Alertas si hay Reembolsos Posteriores (Post-Publish Alerts)</span>
        </div>
        <p class="step-desc">
          Si una póliza ya la mandaron a QuickBooks la semana pasada y hoy meten un reembolso en la tienda, nuestro sistema <strong>nunca les mueve QuickBooks a sus espaldas</strong>. En su lugar, les coloca una banderita amarilla avisando la diferencia y les da un botón para crear un <strong>Asiento de Ajuste</strong> con 1 solo clic.
        </p>
      </div>

      <div class="step-box">
        <div class="step-header">
          <span class="step-num">4</span>
          <span class="step-title">Reembolsos en la Fecha Correcta (Cross-Date Refunds)</span>
        </div>
        <p class="step-desc">
          El sistema deduce los reembolsos en la fecha exacta en que efectivamente sale el dinero de la caja de la tienda, garantizando que los depósitos bancarios cuadren con la contabilidad.
        </p>
      </div>

      <div class="step-box">
        <div class="step-header">
          <span class="step-num">5</span>
          <span class="step-title">Nos Ahorramos $450 Dólares al Mes ($5,400 al Año)</span>
        </div>
        <p class="step-desc">
          Dejamos de pagar la mensualidad de Cohesion y todo el control queda dentro del sistema propio de Tacos Gavilan, con soporte directo e inmediato.
        </p>
      </div>
    </div>

    <div class="page-footer">
      <span>Tacos Gavilan • SM TEG v2.6.1</span>
      <span>Confidencial • Uso Interno</span>
    </div>
  </div>

  <!-- ==================== PÁGINA 4: GUÍA PASO A PASO ==================== -->
  <div class="page-break"></div>
  <div class="page">
    <div class="page-header">
      <span class="brand">TACOS GAVILAN</span>
      <span>Guía de Uso Diario Paso a Paso</span>
      <span>Página 4 de 5</span>
    </div>

    <div class="page-body">
      <h2 class="section-title">
        <span class="num">03</span>
        MANUAL DE USO DIARIO PARA RAQUEL (PASO A PASO)
      </h2>

      <p class="section-intro">
        El sistema hace todo el trabajo nocturno pesado y ustedes en la oficina mantienen el control de autorización final:
      </p>

      <div class="step-box">
        <div class="step-header">
          <span class="step-num">1</span>
          <span class="step-title">Entrar a la Plataforma</span>
        </div>
        <p class="step-desc">
          Ingresa a la app y ve en el menú lateral izquierdo al grupo <strong>"FINANZAS Y CONTABILIDAD" → "Contabilidad"</strong> (o directamente a <code>/contabilidad</code>).
        </p>
      </div>

      <div class="step-box">
        <div class="step-header">
          <span class="step-num">2</span>
          <span class="step-title">Ver la Cuadrícula Semanal (15 Sucursales)</span>
        </div>
        <p class="step-desc">
          Verás la tabla con las 15 tiendas y los 7 días de la semana con colores muy claros:
        </p>
        <ul class="clean-list">
          <li><span class="badge-success">Listo (Ready)</span> : La tienda cerró anoche a las 5:59 AM, no tiene órdenes abiertas y cuadra al centavo.</li>
          <li><span class="badge-warning">Órdenes Abiertas</span> : Hay checks sin cobrar. Al dar clic verás qué cajero lo tiene abierto.</li>
          <li><span class="badge-success" style="background:#e0f2fe; color:#0369a1;">Publicado ✓</span> : Ya fue enviada con éxito a QuickBooks con su DocNumber oficial.</li>
          <li><span class="badge-warning" style="background:#fee2e2; color:#b91c1c;">⚠️ Dif $X.XX</span> : Reembolso tardío detectado en Toast que puedes revisar.</li>
        </ul>
      </div>

      <div class="step-box">
        <div class="step-header">
          <span class="step-num">3</span>
          <span class="step-title">Publicar Todo el Día con 1 Solo Clic</span>
        </div>
        <p class="step-desc">
          Al llegar por la mañana y ver que las tiendas de ayer están en verde (<strong>Listo</strong>), solo presionas el botón azul: <strong>"Publicar Todo el Día"</strong>. En unos 10 segundos, las 15 tiendas se mandan a QuickBooks con sus nombres oficiales (ej. <code>AZUSA-20260902</code>, <code>DOWNEY-20260902</code>).
        </p>
      </div>

      <div class="step-box">
        <div class="step-header">
          <span class="step-num">4</span>
          <span class="step-title">Ver el Detalle de una Tienda (Clic en la celda)</span>
        </div>
        <p class="step-desc">
          Si das clic a cualquier sucursal, entras a la pantalla de detalle idéntica a Cohesion:
        </p>
        <ul class="clean-list">
          <li><strong>Ventas</strong>: For Here, To Go, Drive Thru, Online, Uber, DoorDash y GrubHub.</li>
          <li><strong>Efectivo</strong>: Efectivo Esperado vs Depósito Bancario vs Sobrante/Faltante.</li>
          <li><strong>Asiento Contable</strong>: Desglose de 18 cuentas con Débitos y Créditos exactos.</li>
          <li><strong>Botón "Recalcular"</strong>: Para refrescar desde Toast en vivo si la tienda hizo algún cambio.</li>
        </ul>
      </div>

      <div class="step-box">
        <div class="step-header">
          <span class="step-num">5</span>
          <span class="step-title">Configuración de Cuentas (/contabilidad/configuracion)</span>
        </div>
        <p class="step-desc">
          En <strong>"Configuración"</strong> puedes consultar o editar las cuentas bancarias de depósito, nombres de ubicación en QuickBooks y cuentas contables por sucursal.
        </p>
      </div>
    </div>

    <div class="page-footer">
      <span>Tacos Gavilan • SM TEG v2.6.1</span>
      <span>Confidencial • Uso Interno</span>
    </div>
  </div>

  <!-- ==================== PÁGINA 5: PLAN DE PRUEBAS ==================== -->
  <div class="page-break"></div>
  <div class="page">
    <div class="page-header">
      <span class="brand">TACOS GAVILAN</span>
      <span>Plan de Pruebas y Transición</span>
      <span>Página 5 de 5</span>
    </div>

    <div class="page-body">
      <h2 class="section-title">
        <span class="num">04</span>
        CÓMO EMPEZAR LAS PRUEBAS (PLAN SUGERIDO)
      </h2>

      <p class="section-intro">
        Para que puedan probar con toda la calma del mundo y sin ninguna prisa, sugerimos este plan de 3 semanas:
      </p>

      <div class="step-box">
        <div class="step-header">
          <span class="step-num">A</span>
          <span class="step-title">Semana 1: Solo Consultar y Comparar</span>
        </div>
        <p class="step-desc">
          Dejen que Cohesion siga publicando normalmente si quieren. Entren a <code>/contabilidad</code> en nuestro sistema y comparen los números que genera nuestra app contra los de Cohesion para que comprueben que dan exactamente lo mismo.
        </p>
      </div>

      <div class="step-box">
        <div class="step-header">
          <span class="step-num">B</span>
          <span class="step-title">Semana 2: Probar con 1 Tienda Piloto</span>
        </div>
        <p class="step-desc">
          Elegimos una sucursal (por ejemplo, <strong>Azusa</strong> o <strong>Downey</strong>). No la publicamos en Cohesion y la mandamos desde nuestro sistema hacia QuickBooks Online. Comprobamos que el asiento contable en QuickBooks sea idéntico.
        </p>
      </div>

      <div class="step-box">
        <div class="step-header">
          <span class="step-num">C</span>
          <span class="step-title">Semana 3: Publicar Todo y Apagar Cohesion</span>
        </div>
        <p class="step-desc">
          Cuando estén 100% satisfechas con la rapidez y comodidad de publicar las 15 tiendas con 1 solo clic en nuestro sistema, cancelamos formalmente Cohesion y consolidamos el ahorro de <strong>$5,400 USD al año</strong>.
        </p>
      </div>

      <div class="callout callout-success" style="margin-top: 14px;">
        <div class="callout-title">✅ Todo Listo para tus Pruebas</div>
        El sistema ya fue probado con datos reales de Toast POS y QuickBooks Online. A partir de hoy <strong>3 de Septiembre de 2026</strong> pueden empezar a usarlo cuando gusten.
      </div>
    </div>

    <div class="page-footer">
      <span>Tacos Gavilan • SM TEG v2.6.1</span>
      <span>Confidencial • Uso Interno</span>
    </div>
  </div>

</body>
</html>
  `

  // Save HTML to scratch for inspection
  const htmlPath = path.resolve(process.cwd(), 'data/manual_raquel_accounting.html')
  fs.writeFileSync(htmlPath, htmlContent, 'utf-8')
  console.log(`✅ Archivo HTML base guardado en: ${htmlPath}`)

  // Launch Puppeteer to generate high-resolution PDF
  console.log('Iniciando Puppeteer para renderizado de PDF...')
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })
  const page = await browser.newPage()
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' })
  await page.emulateMediaType('print')

  // Target paths
  const desktopPath = 'C:\\Users\\pedro\\Desktop\\Manual_Contabilidad_Raquel_Tacos_Gavilan.pdf'
  const publicPath = path.resolve(process.cwd(), 'public/docs/Manual_Contabilidad_Raquel_Tacos_Gavilan.pdf')

  await page.pdf({
    path: desktopPath,
    format: 'Letter',
    printBackground: true,
    preferCSSPageSize: true
  })

  // Copy to public/docs as well
  fs.copyFileSync(desktopPath, publicPath)

  await browser.close()

  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('🎉 PDF GENERADO EXITOSAMENTE:')
  console.log(`   1. En el Escritorio de Carlos: ${desktopPath}`)
  console.log(`   2. En la carpeta pública del sistema: ${publicPath}`)
  console.log('═══════════════════════════════════════════════════════════════════════')
}

generatePerfect5PageManual()
