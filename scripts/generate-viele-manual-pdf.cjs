const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function generateManualPdf() {
  console.log('Iniciando generación de PDF del Manual Operativo Viele & Sons...');

  const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Manual de Operación Viele & Sons - Tacos Gavilan</title>
  <style>
    @page {
      size: letter;
      margin: 13mm 13mm 13mm 13mm;
      @bottom-right {
        content: counter(page) " de " counter(pages);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        font-size: 7.5pt;
        color: #64748b;
      }
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1e293b;
      line-height: 1.38;
      font-size: 8.7pt;
      background: #ffffff;
    }

    .header {
      border-bottom: 2px solid #0f172a;
      padding-bottom: 7px;
      margin-bottom: 9px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }

    .brand-title {
      font-size: 15pt;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #0f172a;
      text-transform: uppercase;
    }

    .doc-subtitle {
      font-size: 9.5pt;
      font-weight: 700;
      color: #059669;
      margin-top: 1px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .meta-box {
      text-align: right;
      font-size: 7.5pt;
      color: #64748b;
    }

    .meta-box strong {
      color: #0f172a;
    }

    .warning-card {
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-left: 4px solid #d97706;
      padding: 8px 11px;
      border-radius: 6px;
      margin-bottom: 9px;
    }

    .warning-card h3 {
      font-size: 8.9pt;
      font-weight: 800;
      color: #92400e;
      margin-bottom: 3px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .warning-card p {
      font-size: 8.1pt;
      color: #78350f;
      line-height: 1.35;
      margin-bottom: 0;
    }

    .highlight-card {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-left: 4px solid #059669;
      padding: 7px 11px;
      border-radius: 6px;
      margin-bottom: 9px;
    }

    .highlight-card h3 {
      font-size: 8.9pt;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 3px;
      text-transform: uppercase;
    }

    .highlight-card p {
      font-size: 8.1pt;
      color: #334155;
      line-height: 1.35;
      margin-bottom: 0;
    }

    .section {
      margin-bottom: 9px;
      page-break-inside: avoid;
    }

    .section-title {
      font-size: 9.8pt;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 3px;
      margin-bottom: 5px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .section-badge {
      background: #0f172a;
      color: #ffffff;
      font-size: 7pt;
      padding: 1px 5px;
      border-radius: 4px;
      font-weight: 700;
    }

    p {
      margin-bottom: 5px;
      color: #334155;
    }

    ul, ol {
      margin-left: 16px;
      margin-bottom: 5px;
    }

    li {
      margin-bottom: 3px;
      color: #334155;
    }

    li strong {
      color: #0f172a;
    }

    .formula-box {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      padding: 6px 10px;
      border-radius: 6px;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      font-size: 8.5pt;
      font-weight: 700;
      color: #0f172a;
      text-align: center;
      margin: 5px 0;
    }

    .info-table {
      width: 100%;
      border-collapse: collapse;
      margin: 5px 0 7px 0;
      font-size: 8pt;
    }

    .info-table th {
      background: #0f172a;
      color: #ffffff;
      text-align: left;
      padding: 5px 7px;
      font-weight: 600;
      font-size: 7.5pt;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .info-table td {
      border: 1px solid #e2e8f0;
      padding: 4.5px 7px;
      color: #334155;
    }

    .info-table tr:nth-child(even) {
      background: #f8fafc;
    }

    .split-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin: 5px 0;
    }

    .split-card {
      border: 1px solid #cbd5e1;
      padding: 6px 8px;
      border-radius: 6px;
      background: #f8fafc;
    }

    .split-card.sodas {
      border-left: 3px solid #3b82f6;
    }

    .split-card.general {
      border-left: 3px solid #f59e0b;
    }

    .split-card-title {
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      margin-bottom: 2px;
    }

    .split-card.sodas .split-card-title {
      color: #1d4ed8;
    }

    .split-card.general .split-card-title {
      color: #b45309;
    }

    .split-card p {
      font-size: 7.4pt;
      color: #475569;
      margin-bottom: 0;
      line-height: 1.28;
    }

    .page-break {
      page-break-before: always;
    }

    .contact-card {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-left: 4px solid #16a34a;
      padding: 6px 10px;
      border-radius: 6px;
      margin-top: 6px;
      margin-bottom: 6px;
    }

    .contact-card strong {
      color: #166534;
      font-size: 8.2pt;
    }

    .contact-card span {
      color: #15803d;
      font-size: 8.2pt;
    }

    .footer {
      margin-top: 8px;
      border-top: 1px solid #cbd5e1;
      padding-top: 5px;
      display: flex;
      justify-content: space-between;
      font-size: 7pt;
      color: #64748b;
    }
  </style>
</head>
<body>

  <!-- ENCABEZADO PRINCIPAL -->
  <div class="header">
    <div>
      <div class="brand-title">Tacos Gavilan</div>
      <div class="doc-subtitle">Manual de Operación: Compras e Inventario Viele & Sons</div>
    </div>
    <div class="meta-box">
      <div><strong>Versión:</strong> 2.0 (Captura Única)</div>
      <div><strong>Fecha:</strong> Septiembre 2026</div>
      <div><strong>Plataforma:</strong> tacosgavilan.vercel.app</div>
    </div>
  </div>

  <!-- AVISO CRÍTICO: PASO 1 REVISIÓN Y GUARDADO DE PAR -->
  <div class="warning-card">
    <h3>Paso 1 Obligatorio e Indispensable: Revisar y Guardar el PAR con Asistentes y Supervisores</h3>
    <p>
      Antes de imprimir la hoja física o contar en bodega, <strong>el Gerente debe revisar minuciosamente la columna PAR de cada artículo en conjunto con sus asistentes y/o supervisores</strong>, adaptándola al consumo semanal real de su sucursal. Al realizar cualquier cambio, el botón superior derecho <strong>"Guardar PARs"</strong> se iluminará en color naranja con un efecto parpadeante. <strong>Es obligatorio presionar "Guardar PARs" para salvar los niveles en el sistema</strong>. Si no se presiona este botón, los cambios no se guardan y la hoja impresa saldrá con valores desactualizados.
    </p>
  </div>

  <!-- TARJETA DE RESUMEN EJECUTIVO -->
  <div class="highlight-card">
    <h3>Nueva Captura Unificada: Un Solo Pedido para Todo el Almacén</h3>
    <p>
      Ya <strong>NO</strong> se capturan dos pedidos por separado. Todo el almacén (insumos, químicos y bebidas) se captura en una sola pantalla. El sistema divide automáticamente el pedido y genera las 2 facturas oficiales requeridas por Viele & Sons (Factura 1 para Jarabes de Soda BIB y Factura 2 para Insumos Generales).
    </p>
  </div>

  <!-- SECCIÓN 1: FLUJO DE OPERACIÓN GENERAL -->
  <div class="section">
    <div class="section-title">
      <span class="section-badge">1</span>
      Flujo Operativo Oficial de Trabajo (7 Pasos)
    </div>
    <ol>
      <li><strong>Paso 1 (Auditoría de PARs):</strong> Entrar a la plataforma, revisar los valores de la columna <em>PAR</em> junto con sus asistentes y supervisores, ajustar las cantidades necesarias y presionar el botón <strong>"Guardar PARs"</strong>.</li>
      <li><strong>Paso 2 (Impresión de Hoja):</strong> Con los PARs guardados, presionar <em>Imprimir Hoja de Conteo</em> (formato optimizado de 2 páginas).</li>
      <li><strong>Paso 3 (Conteo en Almacén):</strong> Recorrer la bodega anotando a mano en la hoja las cajas físicas existentes (sobrantes).</li>
      <li><strong>Paso 4 (Captura Digital):</strong> Ingresar los sobrantes contados en la columna <em>Sobrante (Leftover)</em> de la pantalla.</li>
      <li><strong>Paso 5 (Validación y Ajuste):</strong> El sistema calcula automáticamente el <em>Pedido Sugerido</em>. Si se prevé mayor consumo, incrementar cajas en la columna <em>Pedido Final</em>.</li>
      <li><strong>Paso 6 (Confirmación y Envío):</strong> Presionar <em>Enviar Pedido</em>, verificar los datos del comprador oficial (AFV) y la fecha de entrega asignada.</li>
      <li><strong>Paso 7 (Recepción de Facturas):</strong> La plataforma emite y muestra de inmediato los dos números de orden oficiales Sage 100 de Viele & Sons.</li>
    </ol>
  </div>

  <!-- SECCIÓN 2: DETALLES DE LA CONFIGURACIÓN Y GUARDADO DE PAR -->
  <div class="section">
    <div class="section-title">
      <span class="section-badge">2</span>
      Cómo Funciona la Columna PAR y el Botón "Guardar PARs"
    </div>
    <p>
      El <strong>PAR</strong> (Periodic Automatic Replenishment / Nivel Base de Reabastecimiento) es la cantidad óptima de cajas que su tienda debe tener para cubrir la semana sin riesgo de agotamiento:
    </p>
    <ul>
      <li><strong>Navegación Rápida:</strong> Haga clic en la casilla PAR del primer producto. Puede desplazarse verticalmente por toda la lista utilizando las teclas de <strong>Flecha Abajo (↓)</strong>, <strong>Flecha Arriba (↑)</strong> o la tecla <strong>Enter</strong>.</li>
      <li><strong>Detector de Modificaciones:</strong> Cada casilla editada cambia su fondo a tono ámbar resaltado para identificar visualmente qué valores fueron alterados.</li>
      <li><strong>Botón Guardar PARs:</strong> En la barra superior derecha, el botón <em>Guardar PARs (N)</em> muestra entre paréntesis la cantidad exacta de productos modificados y parpadea en color naranja llamativo.</li>
      <li><strong>Confirmación Permanente:</strong> Al hacer clic en <em>Guardar PARs</em>, los datos se graban en la base de datos central de Tacos Gavilan y quedan fijados para futuras semanas.</li>
    </ul>
  </div>

  <!-- SECCIÓN 3: IMPRESIÓN DE LA HOJA DE CONTEO FÍSICO -->
  <div class="section">
    <div class="section-title">
      <span class="section-badge">3</span>
      Impresión de la Hoja de Conteo Físico
    </div>
    <ul>
      <li>Hacer clic en el botón superior <strong>Imprimir Hoja de Conteo</strong> o acceder a la ruta <code>/admin/compras/viele/print-sheet</code>.</li>
      <li>El formato fue calibrado estrictamente a <strong>2 páginas tamaño Carta (Letter)</strong>, garantizando que no existan hojas sueltas ni renglones cortados.</li>
      <li>El orden de los productos en la hoja impresa coincide con la secuencia física personalizada de su sucursal.</li>
    </ul>
  </div>

  <!-- SALTO DE PÁGINA OBLIGATORIO PARA CONTROL EXACTO DE 2 PÁGINAS -->
  <div class="page-break"></div>

  <!-- ENCABEZADO PÁGINA 2 -->
  <div class="header">
    <div>
      <div class="brand-title">Tacos Gavilan</div>
      <div class="doc-subtitle">Manual de Operación: Compras Viele & Sons (Página 2)</div>
    </div>
    <div class="meta-box">
      <div><strong>Versión:</strong> 2.0 (Captura Única)</div>
      <div><strong>Documento:</strong> Uso Interno Confidencial</div>
    </div>
  </div>

  <!-- SECCIÓN 4: FÓRMULA DE CÁLCULO AUTOMÁTICO -->
  <div class="section">
    <div class="section-title">
      <span class="section-badge">4</span>
      Fórmula de Reabastecimiento y Reglas Matemáticas
    </div>
    <p>
      El sistema calcula el pedido sugerido aplicando la fórmula matemática de reposición de inventario:
    </p>
    <div class="formula-box">
      PEDIDO SUGERIDO = MAX(0, PAR - SOBRANTE)
    </div>
    <table class="info-table">
      <thead>
        <tr>
          <th>Situación en Almacén</th>
          <th>PAR</th>
          <th>Sobrante</th>
          <th>Resultado del Sistema</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Sobrante sin contar (vacío)</td>
          <td>10</td>
          <td>(vacío)</td>
          <td>Sugiere <strong>10 cajas</strong> (asume reposición completa).</td>
        </tr>
        <tr>
          <td>Sobrante menor al PAR</td>
          <td>10</td>
          <td>3</td>
          <td>Sugiere <strong>7 cajas</strong> (cubre exactamente la diferencia).</td>
        </tr>
        <tr>
          <td>Sobrante igual o mayor al PAR</td>
          <td>10</td>
          <td>12</td>
          <td>Sugiere <strong>0 cajas</strong> (evita sobreinventario innecesario).</td>
        </tr>
        <tr>
          <td>Cajas fraccionarias abiertas</td>
          <td>5</td>
          <td>2.5</td>
          <td>Sugiere <strong>3 cajas</strong> (redondea hacia arriba con Math.ceil para evitar faltantes).</td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>Ajuste en Pedido Final:</strong> Si la sucursal anticipa un fin de semana festivo con ventas extraordinarias, el Gerente puede aumentar directamente el número en la columna <em>Pedido Final</em> sin modificar el PAR base.
    </p>
  </div>

  <!-- SECCIÓN 5: DESGLOSE DE LAS 2 FACTURAS OFICIALES -->
  <div class="section">
    <div class="section-title">
      <span class="section-badge">5</span>
      Generación Automática de las 2 Facturas Oficiales
    </div>
    <p>
      Por regulaciones fiscales del Estado de California, las bebidas sujetas a depósito CRV (California Redemption Value) deben facturarse separadamente de los insumos exentos de impuestos:
    </p>
    <div class="split-grid">
      <div class="split-card sodas">
        <div class="split-card-title">Factura 1: Jarabes de Soda BIB</div>
        <p>• Productos: Coca-Cola, Diet Coke, Sprite, Fanta Naranja, Fuze Tea, Minute Maid Limonada/Naranja, Dr Pepper.</p>
        <p>• Presentación: Cajas Bag-in-Box de 5 galones.</p>
        <p>• Genera su propio número de orden independiente Sage 100 (ejemplo: W150364).</p>
      </div>
      <div class="split-card general">
        <div class="split-card-title">Factura 2: Insumos Generales y Químicos</div>
        <p>• Insumos: Vasos térmicos, tapas, platos Gavilan, bolsas Seal2Go, servilletas, cubiertos y aluminio.</p>
        <p>• Químicos IC: Desengrasantes, descalcificadores y detergentes Imperial Chemical.</p>
        <p>• Genera su segundo número de orden correlativo (ejemplo: W150365).</p>
      </div>
    </div>
    <p>
      En la barra inferior de la pantalla, el Gerente visualiza en tiempo real los subtotales independientes de cada factura y el gran total consolidado.
    </p>
  </div>

  <!-- SECCIÓN 6: PERSONALIZACIÓN DEL RECORRIDO DE BODEGA -->
  <div class="section">
    <div class="section-title">
      <span class="section-badge">6</span>
      Organización del Recorrido de Bodega (Arrastrar y Soltar)
    </div>
    <ul>
      <li><strong>Reordenar estanterías:</strong> Haga clic sobre el icono de puntos (⋮⋮) al inicio de cada fila y arrástrelo a la posición deseada para que el orden coincida con el recorrido físico de su almacén.</li>
      <li><strong>Guardado instantáneo:</strong> La posición se memoriza automáticamente en la base de datos para su sucursal.</li>
      <li><strong>Restablecer orden:</strong> Si desea volver al orden original del proveedor, haga clic en <em>Restablecer Orden Oficial</em>.</li>
    </ul>
  </div>

  <!-- SECCIÓN 7: PREGUNTAS FRECUENTES Y CONTACTO DIRECTO -->
  <div class="section">
    <div class="section-title">
      <span class="section-badge">7</span>
      Preguntas Frecuentes y Soporte Operativo
    </div>
    <ul>
      <li><strong>¿Qué ocurre si presiono dos veces el botón Enviar?</strong><br>
      El sistema cuenta con un candado de idempotencia a nivel de base de datos que bloquea envíos duplicados automáticamente.</li>
      <li><strong>¿Puedo guardar un borrador durante el turno?</strong><br>
      Sí. Al hacer clic en <em>Guardar Borrador</em>, la información se almacena en el sistema sin transmitir la orden a Viele & Sons.</li>
      <li><strong>¿Dónde consulto las órdenes enviadas?</strong><br>
      En el botón <em>Historial de Pedidos</em> ubicado en la barra superior se muestran las órdenes, montos y fechas de entrega de los últimos 2 años.</li>
    </ul>
    <div class="contact-card">
      <strong>Contacto y Soporte Directo:</strong>
      <span>Para cualquier duda, contingencia o aclaración durante la captura, comunicarse directamente con <strong>Carlos Velazquez</strong> al teléfono <strong>424-319-5019</strong>.</span>
    </div>
  </div>

  <!-- PIE DE PÁGINA -->
  <div class="footer">
    <div>Tacos Gavilan — Documento Operativo Confidencial de Uso Interno</div>
    <div>Soporte: Carlos Velazquez (424-319-5019) | Sistema de Gestión TEG</div>
  </div>

</body>
</html>
  `;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

  const rootPdfPath = path.resolve('Manual_Operativo_Viele_and_Sons_Tacos_Gavilan.pdf');
  const publicPdfPath = path.resolve('public/docs/Manual_Operativo_Viele_and_Sons_Tacos_Gavilan.pdf');

  await page.pdf({
    path: rootPdfPath,
    format: 'Letter',
    printBackground: true,
    margin: {
      top: '12mm',
      bottom: '12mm',
      left: '12mm',
      right: '12mm'
    }
  });

  fs.copyFileSync(rootPdfPath, publicPdfPath);
  await browser.close();

  console.log('PDF generado exitosamente en:');
  console.log('1. ' + rootPdfPath);
  console.log('2. ' + publicPdfPath);
}

generateManualPdf().catch(err => {
  console.error('Error generando PDF:', err);
  process.exit(1);
});
