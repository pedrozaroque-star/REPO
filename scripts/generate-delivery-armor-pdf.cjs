const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function generateExecutivePDF() {
    console.log('🚀 Iniciando generación de Propuesta Ejecutiva con Estándar Corporativo...');

    // Cargar el logo oficial en base64
    const logoPath = path.join(__dirname, '../public/logo.png');
    let logoBase64 = '';
    if (fs.existsSync(logoPath)) {
        const logoBuffer = fs.readFileSync(logoPath);
        logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;
        console.log('✅ Logo corporativo cargado en memoria.');
    }

    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Propuesta Ejecutiva: Blindaje Operativo y Tecnológico en Delivery — Tacos Gavilan</title>
    <style>
        @page {
            size: letter;
            margin: 0;
        }
        * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        }
        body {
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
            color: #1f2937;
            background: #ffffff;
            margin: 0;
            padding: 0;
            font-size: 12.5px;
            line-height: 1.48;
        }

        /* Portada Ejecutiva */
        .cover-page {
            width: 8.5in;
            height: 11in;
            padding: 2.2in 0.8in 0.9in 0.8in;
            background: linear-gradient(145deg, #111827 0%, #1f2937 55%, #2c1a1a 100%);
            color: #ffffff;
            position: relative;
            page-break-after: always;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }
        .cover-accent-bar {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 12px;
            background: linear-gradient(90deg, #b91c1c, #dc2626, #f59e0b);
        }
        .cover-logo {
            max-width: 220px;
            height: auto;
            margin-bottom: 22px;
            filter: drop-shadow(0 4px 6px rgba(0,0,0,0.4));
        }
        .cover-badge {
            display: inline-block;
            background: rgba(185, 28, 28, 0.4);
            border: 1px solid #ef4444;
            color: #fca5a5;
            padding: 5px 14px;
            border-radius: 20px;
            font-size: 10.5px;
            font-weight: 700;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            margin-bottom: 18px;
        }
        .cover-title {
            font-size: 30px;
            font-weight: 800;
            line-height: 1.2;
            color: #ffffff;
            margin: 0 0 14px 0;
            letter-spacing: -0.5px;
        }
        .cover-subtitle {
            font-size: 14.5px;
            color: #d1d5db;
            font-weight: 400;
            line-height: 1.45;
            max-width: 640px;
            margin: 0;
        }
        .cover-footer {
            border-top: 1px solid rgba(255,255,255,0.15);
            padding-top: 22px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            font-size: 11px;
            color: #9ca3af;
        }
        .cover-meta strong {
            color: #ffffff;
            font-size: 12.5px;
            display: block;
            margin-bottom: 4px;
        }

        /* Páginas interiores */
        .page {
            width: 8.5in;
            min-height: 11in;
            padding: 0.75in 0.8in 0.85in 0.8in;
            position: relative;
            page-break-after: always;
            background: #ffffff;
        }
        .page:last-child {
            page-break-after: avoid;
        }

        .page-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1.5px solid #e5e7eb;
            padding-bottom: 8px;
            margin-bottom: 18px;
            font-size: 9.5px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #6b7280;
        }
        .page-footer {
            position: absolute;
            bottom: 0.35in;
            left: 0.8in;
            right: 0.8in;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-top: 1px solid #e5e7eb;
            padding-top: 7px;
            font-size: 8.5px;
            color: #9ca3af;
        }

        h2 {
            font-size: 18px;
            margin-top: 0;
            margin-bottom: 12px;
            padding-bottom: 5px;
            border-bottom: 2px solid #b91c1c;
            color: #111827;
            font-weight: 800;
        }
        h3 {
            font-size: 13.5px;
            margin-top: 14px;
            margin-bottom: 6px;
            color: #111827;
            font-weight: 700;
        }
        p {
            margin: 0 0 9px 0;
            color: #374151;
        }

        /* Cajas de llamada */
        .callout-danger {
            background: #fef2f2;
            border-left: 4px solid #dc2626;
            padding: 10px 14px;
            border-radius: 0 6px 6px 0;
            margin-bottom: 12px;
            font-size: 12px;
        }
        .callout-success {
            background: #f0fdf4;
            border-left: 4px solid #16a34a;
            padding: 10px 14px;
            border-radius: 0 6px 6px 0;
            margin-bottom: 12px;
            font-size: 12px;
        }
        .callout-info {
            background: #eff6ff;
            border-left: 4px solid #2563eb;
            padding: 10px 14px;
            border-radius: 0 6px 6px 0;
            margin-bottom: 12px;
            font-size: 12px;
        }

        /* Glosario */
        .glossary-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 9px;
            margin-bottom: 12px;
        }
        .glossary-card {
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            padding: 8px 11px;
        }
        .glossary-term {
            font-weight: 700;
            color: #b91c1c;
            font-size: 11px;
            margin-bottom: 2px;
        }
        .glossary-trans {
            font-weight: 600;
            color: #111827;
            font-size: 10.5px;
            margin-bottom: 2px;
        }
        .glossary-desc {
            font-size: 10px;
            color: #4b5563;
            margin: 0;
            line-height: 1.35;
        }

        /* Bloques de análisis */
        .gap-box {
            background: #ffffff;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 10px 13px;
            margin-bottom: 10px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.04);
            page-break-inside: avoid;
        }
        .gap-title {
            font-size: 12px;
            font-weight: 700;
            color: #991b1b;
            margin-bottom: 3px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        /* Tarjeta de Checklist Interactivo */
        .checklist-demo {
            background: #1e293b;
            border: 1.5px solid #334155;
            border-radius: 8px;
            padding: 11px 13px;
            color: #ffffff;
            margin: 10px 0;
            page-break-inside: avoid;
        }
        .checklist-demo-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #334155;
            padding-bottom: 5px;
            margin-bottom: 7px;
            font-size: 10.5px;
            font-weight: 700;
            color: #cbd5e1;
        }
        .check-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: #0f172a;
            border: 1px solid #334155;
            border-radius: 5px;
            padding: 5px 9px;
            margin-bottom: 5px;
            font-size: 11px;
        }
        .check-row.matched {
            border-color: #10b981;
            background: rgba(16, 185, 129, 0.1);
            color: #a7f3d0;
        }
        .check-row.pending-alert {
            border-color: #f59e0b;
            background: rgba(245, 158, 11, 0.15);
            color: #fde68a;
        }
        .check-btn {
            display: inline-block;
            padding: 2px 7px;
            border-radius: 4px;
            font-size: 9px;
            font-weight: 700;
            text-transform: uppercase;
        }
        .btn-green { background: #10b981; color: #ffffff; }
        .btn-yellow { background: #f59e0b; color: #ffffff; }

        /* Tarjeta de Doble Foto */
        .dual-photo-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin: 12px 0;
            page-break-inside: avoid;
        }
        .photo-card {
            background: #ffffff;
            border: 1.5px solid #d1d5db;
            border-radius: 8px;
            padding: 11px 13px;
            position: relative;
        }
        .photo-card.card-1 { border-top: 4px solid #2563eb; }
        .photo-card.card-2 { border-top: 4px solid #16a34a; }
        .photo-badge {
            display: inline-block;
            font-size: 9px;
            font-weight: 800;
            padding: 2px 8px;
            border-radius: 10px;
            text-transform: uppercase;
            margin-bottom: 5px;
        }
        .badge-photo-1 { background: #dbeafe; color: #1e40af; }
        .badge-photo-2 { background: #dcfce7; color: #166534; }
        .photo-title {
            font-size: 12.5px;
            font-weight: 700;
            color: #111827;
            margin-bottom: 4px;
        }
        .photo-mission {
            font-size: 10.5px;
            color: #4b5563;
            line-height: 1.4;
        }

        /* Escenarios */
        .scenario-card {
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            padding: 8px 11px;
            margin-bottom: 9px;
            page-break-inside: avoid;
        }
        .scenario-title {
            font-size: 11.5px;
            font-weight: 700;
            color: #111827;
            margin-bottom: 3px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .scenario-tag {
            font-size: 8.5px;
            font-weight: 700;
            padding: 2px 5px;
            border-radius: 4px;
            text-transform: uppercase;
        }
        .tag-fraud { background: #fee2e2; color: #991b1b; }
        .tag-theft { background: #fef3c7; color: #92400e; }
        .tag-ops { background: #e0e7ff; color: #3730a3; }

        .scenario-before {
            background: #fef2f2;
            padding: 5px 7px;
            border-radius: 4px;
            font-size: 10px;
            margin-bottom: 4px;
            color: #7f1d1d;
            border-left: 3px solid #dc2626;
        }
        .scenario-after {
            background: #f0fdf4;
            padding: 5px 7px;
            border-radius: 4px;
            font-size: 10px;
            color: #14532d;
            border-left: 3px solid #16a34a;
        }

        /* Tablas */
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 10px 0;
            font-size: 10px;
            page-break-inside: avoid;
        }
        th, td {
            padding: 5px 7px;
            text-align: left;
            border-bottom: 1px solid #e5e7eb;
        }
        th {
            background-color: #1f2937;
            color: #ffffff;
            font-weight: 600;
            text-transform: uppercase;
            font-size: 8.5px;
            letter-spacing: 0.5px;
        }
        tr:nth-child(even) td {
            background-color: #f9fafb;
        }
        .badge-pill {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 10px;
            font-weight: 700;
            font-size: 8px;
        }
        .badge-green { background: #dcfce7; color: #166534; }
    </style>
</head>
<body>

    <!-- ========================================== -->
    <!-- PORTADA EJECUTIVA                         -->
    <!-- ========================================== -->
    <div class="cover-page">
        <div class="cover-accent-bar"></div>
        <div>
            ${logoBase64 ? `<img src="${logoBase64}" class="cover-logo" alt="Tacos Gavilan Logo">` : `<div style="font-size: 28px; font-weight: 900; letter-spacing: 2px; color: #ffffff; margin-bottom: 20px;">TACOS GAVILAN</div>`}
            <div class="cover-badge">Análisis Operativo & Tecnológico</div>
            <h1 class="cover-title">PROPUESTA DE BLINDAJE OPERATIVO:<br>VERIFICACIÓN ÍTEM POR ÍTEM & PROTOCOLO DE DOBLE EVIDENCIA</h1>
            <p class="cover-subtitle">
                Estrategia para eliminar contracargos infundados en plataformas de delivery (DoorDash & Uber Eats) mediante la integración de <strong>Checklist Digital de Conciliación (Match 100%)</strong> y <strong>Doble Registro Fotográfico Probatorio (Pre y Post-Sellado)</strong>.
            </p>
        </div>

        <div class="cover-footer">
            <div class="cover-meta">
                <strong>DIRIGIDO A:</strong>
                Presidencia & Dirección General<br>
                Tacos Gavilan
            </div>
            <div class="cover-meta" style="text-align: right;">
                <strong>FECHA & VERSIÓN:</strong>
                Octubre 2026 — Informe Ejecutivo v4.0<br>
                Evaluación Estratégica de Inversión y Control de Mermas
            </div>
        </div>
    </div>

    <!-- ========================================== -->
    <!-- PÁGINA 1: EL PROBLEMA REAL Y RECONOCIMIENTO -->
    <!-- ========================================== -->
    <div class="page">
        <div class="page-header">
            <span>Tacos Gavilan — Dirección General</span>
            <span>Módulo de Control y Seguridad en Delivery</span>
        </div>

        <h2>1. Diagnóstico Inicial: Reconocimiento a las Medidas Implementadas</h2>

        <div class="callout-info">
            <strong>Punto de Partida Operativo:</strong> La administración de Tacos Gavilan ya ha establecido dos directrices fundamentales:
            <br>1. <strong>Inversión en insumos:</strong> Se cuenta con bolsas de alta resistencia y sellos adhesivos de seguridad en todas las sucursales.
            <br>2. <strong>Directriz operativa:</strong> Se ha instruido al personal a solicitar confirmación de orden en el dispositivo móvil del repartidor antes de entregar.
        </div>

        <div class="callout-danger">
            <strong>Dilema Operativo y Financiero Central:</strong>
            <br><em>"Habiendo implementado empaques de seguridad e instruido verbalmente al personal sobre la confirmación de choferes... <strong>¿por qué la operación continúa registrando pérdidas mensuales recurrentes por sustracción de órdenes, reportes de ítems faltantes y contracargos en plataformas de delivery?</strong>"</em>
        </div>

        <p>
            La causa raíz radica en que los controles pasivos (el empaque) y las instrucciones verbales dependen exclusivamente de la memoria y disciplina del personal bajo alta presión de servicio. Cuando la cocina opera en horas pico (*rush hours*), la falta de un protocolo digital de validación sistemática permite que se sellen órdenes incompletas (ej. bebidas en refrigerador) y carece de evidencia fotográfica probatoria ante disputas con DoorDash y Uber Eats.
        </p>

        <h3 style="margin-top: 16px;">2. Glosario Técnico Operativo (Conceptos Clave)</h3>
        <div class="glossary-grid">
            <div class="glossary-card">
                <div class="glossary-term">Dual-Photo Protocol</div>
                <div class="glossary-trans">Protocolo de Doble Evidencia Fotográfica</div>
                <p class="glossary-desc">Foto 1 (Abierta): certifica el contenido exacto y ticket. Foto 2 (Sellada): certifica la salida hermética e inviolable del paquete.</p>
            </div>
            <div class="glossary-card">
                <div class="glossary-term">Item-by-Item Match</div>
                <div class="glossary-trans">Conciliación Ítem por Ítem</div>
                <p class="glossary-desc">Checklist digital en tablet: el empacador valida físicamente cada producto; el sistema bloquea el sellado hasta verificar 100% de concordancia.</p>
            </div>
            <div class="glossary-card">
                <div class="glossary-term">Ghost Pickup</div>
                <div class="glossary-trans">Sustracción No Autorizada de Pedido</div>
                <p class="glossary-desc">El repartidor aparenta confirmar en pantalla, cancela la asignación al salir del local y sustrae la orden sin trazabilidad inmediata.</p>
            </div>
            <div class="glossary-card">
                <div class="glossary-term">Shift Accountability & PIN</div>
                <div class="glossary-trans">Trazabilidad Individual por Turno y PIN</div>
                <p class="glossary-desc">Registro fidedigno de qué empleado ensambló y quién despachó, resolviendo discrepancias en el relevo de turno (5:00 PM).</p>
            </div>
        </div>

        <div class="page-footer">
            <span>Tacos Gavilan — Documento Estratégico Confidencial</span>
            <span>Página 1</span>
        </div>
    </div>

    <!-- ========================================== -->
    <!-- PÁGINA 2: POR QUÉ FALLA EL MÉTODO MANUAL   -->
    <!-- ========================================== -->
    <div class="page">
        <div class="page-header">
            <span>Tacos Gavilan — Dirección General</span>
            <span>Módulo de Control y Seguridad en Delivery</span>
        </div>

        <h2>3. Las 4 Brechas Críticas de Vulnerabilidad en el Esquema Manual Actual</h2>

        <div class="gap-box">
            <div class="gap-title">
                <span>⚠️ Brecha 1: Insuficiencia Probatoria del Empaque Cerrado frente a Reclamaciones de Contenido</span>
            </div>
            <p style="font-size: 10.5px; margin-bottom: 3px;">
                El empaque sellado protege la integridad física del paquete en tránsito; sin embargo, no constituye prueba documental del contenido empacado. Ante una reclamación de usuario por presunta entrega de producto incorrecto o faltante, las plataformas arbitran por defecto a favor del cliente final, asumiendo error de ensamblaje en cocina.
            </p>
            <p style="font-size: 10px; color: #4b5563; margin: 0;">
                Sin un registro fotográfico del producto antes del sellado vinculado al ticket de Toast, la resolución de la disputa requiere auditoría manual de grabaciones de circuito cerrado (CCTV), consumiendo valiosas horas de supervisión gerencial.
            </p>
        </div>

        <div class="gap-box">
            <div class="gap-title">
                <span>⚠️ Brecha 2: Margen de Omisión Humana en Ensamble de Orden (Bebidas y Complementos Refrigerados)</span>
            </div>
            <p style="font-size: 10.5px; margin-bottom: 3px;">
                En momentos de alta densidad operativa, el personal prioriza el flujo de alimentos calientes de línea y omite con frecuencia productos que requieren recolección en refrigerador (bebidas embotelladas y aguas frescas).
            </p>
            <p style="font-size: 10px; color: #4b5563; margin: 0;">
                Las bebidas representan históricamente más del <strong>50% de las incidencias reales</strong> de reclamación. Al no existir una validación interactiva obligatoria, el error humano se repite de manera involuntaria.
            </p>
        </div>

        <div class="gap-box">
            <div class="gap-title">
                <span>⚠️ Brecha 3: Vulnerabilidad en la Entrega Física y Validación Verbal del Repartidor</span>
            </div>
            <p style="font-size: 10.5px; margin-bottom: 3px;">
                La instrucción verbal de exigir confirmación en el dispositivo del chofer resulta vulnerable ante repartidores que simulan la aceptación en pantalla o aprovechan la saturación del mostrador para retirarse sin confirmar, cancelando la asignación (*unassign*) posterior al retiro del pedido.
            </p>
            <p style="font-size: 10px; color: #4b5563; margin: 0;">
                Al carecer de un registro biométrico o PIN de despacho en el sistema, la sustracción no se detecta hasta el arribo del segundo repartidor asignado por la plataforma, obligando a cocinar nuevamente la orden con doble costo para la empresa.
            </p>
        </div>

        <div class="gap-box">
            <div class="gap-title">
                <span>⚠️ Brecha 4: Dilución de Responsabilidad en el Relevo Operativo (Turno PM - 5:00 PM)</span>
            </div>
            <p style="font-size: 10.5px; margin-bottom: 3px;">
                El ciclo operativo de la marca (6:00 AM a 5:59 AM) presenta una zona de transición crítica en el relevo de las 5:00 PM. Una orden ensamblada en los últimos minutos del turno diurno puede ser despachada por personal del turno vespertino.
            </p>
            <p style="font-size: 10px; color: #4b5563; margin: 0;">
                Ante una disputa posterior, la ausencia de trazabilidad digital impide determinar la responsabilidad del ensamblaje o despacho, imposibilitando la retroalimentación correctiva y debilitando la rendición de cuentas del equipo.
            </p>
        </div>

        <div class="page-footer">
            <span>Tacos Gavilan — Documento Estratégico Confidencial</span>
            <span>Página 2</span>
        </div>
    </div>

    <!-- ========================================== -->
    <!-- PÁGINA 3: CHECKLIST MATCH & LAS 2 FOTOS    -->
    <!-- ========================================== -->
    <div class="page">
        <div class="page-header">
            <span>Tacos Gavilan — Dirección General</span>
            <span>Módulo de Control y Seguridad en Delivery</span>
        </div>

        <h2>4. La Solución: Conciliación Ítem por Ítem & Protocolo de Doble Evidencia</h2>

        <p>
            El blindaje operativo se fundamenta en la integración de dos controles digitales en la estación de empaque: la <strong>Conciliación Digital Ítem por Ítem (*100% Match*)</strong> y el <strong>Protocolo de Doble Evidencia Fotográfica</strong> (registro pre-sellado y certificación post-sellado).
        </p>

        <!-- Demostración Visual del Checklist -->
        <div class="checklist-demo">
            <div class="checklist-demo-header">
                <span>ORDEN DOORDASH #412 — CLIENTE: CARLOS M.</span>
                <span style="color: #f59e0b;">PROGRESO DE CONCILIACIÓN: 80%</span>
            </div>
            
            <div class="check-row matched">
                <span>[ ✓ ] 5x Tacos de Asada (Cebolla y Cilantro)</span>
                <span class="check-btn btn-green">CONCILIADO ✓</span>
            </div>
            <div class="check-row matched">
                <span>[ ✓ ] 3x Tacos de Pastor</span>
                <span class="check-btn btn-green">CONCILIADO ✓</span>
            </div>
            <div class="check-row pending-alert">
                <span>[ ! ] 2x Horchata 32oz (UBICACIÓN: REFRIGERADOR)</span>
                <span class="check-btn btn-yellow">VALIDACIÓN PENDIENTE</span>
            </div>
            <div class="check-row matched">
                <span>[ ✓ ] 1x Salsas Rojas, Limones y Cebollitas</span>
                <span class="check-btn btn-green">CONCILIADO ✓</span>
            </div>
            <div style="font-size: 10px; color: #fca5a5; font-weight: 700; margin-top: 4px;">
                ⛔ SELLADO BLOQUEADO: Confirme la inclusión de 2x Horchatas para continuar
            </div>
        </div>

        <h3 style="margin-top: 14px;">El Protocolo de Doble Evidencia: Función Estratégica de Cada Registro</h3>

        <div class="dual-photo-grid">
            <div class="photo-card card-1">
                <span class="photo-badge badge-photo-1">Foto 1: Pre-Sellado (Verificación de Contenido)</span>
                <div class="photo-title">Contenido Expuesto + Ticket Visible</div>
                <div class="photo-mission">
                    <strong>Objetivo Probatorio:</strong> Certificar fehacientemente los alimentos ensamblados, su correcta presentación y concordancia con el ticket de Toast.
                    <br><strong style="color: #1e40af;">Efecto Inmediato:</strong> Desvirtúa con evidencia irrefutable cualquier reclamación de cliente por producto incorrecto o faltante ante el panel de arbitraje de la plataforma.
                </div>
            </div>

            <div class="photo-card card-2">
                <span class="photo-badge badge-photo-2">Foto 2: Post-Sellado (Certificación de Salida)</span>
                <div class="photo-title">Empaque Cerrado + Sello de Seguridad Intacto</div>
                <div class="photo-mission">
                    <strong>Objetivo Probatorio:</strong> Demostrar que el pedido egresó de la sucursal herméticamente cerrado con el sello de seguridad liso e intacto.
                    <br><strong style="color: #166534;">Efecto Inmediato:</strong> Deslinda formalmente a Tacos Gavilan de cualquier daño, apertura o manipulación indebida atribuible al conductor durante el traslado.
                </div>
            </div>
        </div>

        <div class="callout-success" style="margin-top: 10px; font-size: 11px;">
            <strong>Impacto en Tiempo Operativo: Entre 4 y 6 Segundos por Orden</strong>
            <br>1. Empacador valida checklist táctil (100% Match) ➔ 2. Registro: <strong>Foto 1 (Contenido)</strong> ➔ 3. Sellado con adhesivo de seguridad ➔ 4. Registro: <strong>Foto 2 (Empaque cerrado)</strong>. El pedido queda formalmente certificado y resguardado en base de datos.
        </div>

        <div class="page-footer">
            <span>Tacos Gavilan — Documento Estratégico Confidencial</span>
            <span>Página 3</span>
        </div>
    </div>

    <!-- ========================================== -->
    <!-- PÁGINA 4: COMPARATIVA & CASOS REALES       -->
    <!-- ========================================== -->
    <div class="page">
        <div class="page-header">
            <span>Tacos Gavilan — Dirección General</span>
            <span>Módulo de Control y Seguridad en Delivery</span>
        </div>

        <h2>5. Comparativa Operativa: Esquema Actual vs. Módulo Digital Propuesto</h2>

        <table>
            <thead>
                <tr>
                    <th style="width: 24%;">Escenario Operativo</th>
                    <th style="width: 38%;">Esquema Actual (Empaque + Instrucción Verbal)</th>
                    <th style="width: 38%;">Con Módulo Digital TEG (Checklist + 2 Fotos + PIN)</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><strong>Reclamación infundada de producto incorrecto</strong></td>
                    <td>La plataforma debita el importe a la tienda. El gerente debe invertir hasta 2 horas en revisión de grabaciones de CCTV.</td>
                    <td><span class="badge-pill badge-green">Foto 1 (Contenido):</span> Certifica los productos reales y el ticket. Reembolso procedente en 24 horas.</td>
                </tr>
                <tr>
                    <td><strong>Manipulación o sustracción de producto en ruta</strong></td>
                    <td>El cliente reporta alimentos faltantes. Tacos Gavilan absorbe la penalización al no poder probar la integridad del despacho.</td>
                    <td><span class="badge-pill badge-green">Foto 2 (Sellada):</span> Acredita que el pedido salió herméticamente cerrado. La pérdida se transfiere al chofer.</td>
                </tr>
                <tr>
                    <td><strong>Sustracción no autorizada de pedido (*Ghost Pickup*)</strong></td>
                    <td>En horas pico el personal no puede verificar cada pantalla. El chofer cancela y la sucursal debe re-cocinar sin cobro.</td>
                    <td><span class="badge-pill badge-green">Validación de Despacho:</span> La orden no se libera del sistema sin la confirmación efectiva del chofer en pantalla.</td>
                </tr>
                <tr>
                    <td><strong>Omisión de bebidas o complementos refrigerados</strong></td>
                    <td>Ocurre por presión de servicio (representa más del 50% de las disputas reales de clientes).</td>
                    <td><span class="badge-pill badge-green">Validación Obligatoria:</span> El sistema restringe el paso a sellado hasta confirmar físicamente la bebida. Cero omisiones.</td>
                </tr>
                <tr>
                    <td><strong>Disputa de responsabilidad por relevo de turno (5:00 PM)</strong></td>
                    <td>Imposibilidad de identificar al responsable del ensamblaje o despacho. Pérdida de disciplina operativa.</td>
                    <td><span class="badge-pill badge-green">Trazabilidad Total:</span> Identificación precisa mediante PIN de quién empacó y quién entregó cada pedido.</td>
                </tr>
            </tbody>
        </table>

        <h3 style="margin-top: 14px;">6. Casos Operativos de Aplicación en Tienda</h3>

        <div class="scenario-card">
            <div class="scenario-title">
                <span>Caso 1: Reclamación Fraudulenta de Producto Inexistente</span>
                <span class="scenario-tag tag-fraud">Fraude de Usuario</span>
            </div>
            <div class="scenario-before">
                <strong>Esquema actual:</strong> El paquete salió cerrado, pero la plataforma reporta: <em>"El usuario recibió un artículo distinto al ordenado"</em>. Tacos Gavilan es penalizada financieramente a menos que gerencia localice manualmente el video del incidente.
            </div>
            <div class="scenario-after">
                <strong>Con Foto 1 (Contenido):</strong> Se remite de forma inmediata la captura fotográfica del pedido original con su ticket fechado. La plataforma resuelve a favor de Tacos Gavilan, reintegra los fondos y marca la cuenta del usuario por reporte fraudulento.
            </div>
        </div>

        <div class="scenario-card">
            <div class="scenario-title">
                <span>Caso 2: Vulneración del Sello de Seguridad en Ruta de Entrega</span>
                <span class="scenario-tag tag-theft">Incidencia de Traslado</span>
            </div>
            <div class="scenario-before">
                <strong>Esquema actual:</strong> El repartidor manipula o vulnera el empaque durante el trayecto. El usuario final recibe el paquete abierto y reporta faltantes. La plataforma imputa la penalización a la sucursal.
            </div>
            <div class="scenario-after">
                <strong>Con Foto 2 (Sellada):</strong> Tacos Gavilan acredita que el pedido egresó con el sello de seguridad perfectamente colocado e intacto. La plataforma asume el costo por mala praxis de su repartidor y deslinda a la marca de toda responsabilidad.
            </div>
        </div>

        <div class="scenario-card">
            <div class="scenario-title">
                <span>Caso 3: Omisión Operativa de Bebidas Refrigeradas</span>
                <span class="scenario-tag tag-ops">Control Interno</span>
            </div>
            <div class="scenario-before">
                <strong>Esquema actual:</strong> Durante el despacho rápido, el personal omite retirar las bebidas del refrigerador y sella el paquete. El cliente solicita reembolso y la sucursal pierde el costo del producto más penalización de servicio.
            </div>
            <div class="scenario-after">
                <strong>Con Conciliación Ítem por Ítem:</strong> La tablet impide avanzar a la fase de sellado y fotografía hasta que el empacador confirme físicamente las bebidas en pantalla, asegurando una orden 100% completa.
            </div>
        </div>

        <div class="page-footer">
            <span>Tacos Gavilan — Documento Estratégico Confidencial</span>
            <span>Página 4</span>
        </div>
    </div>

    <!-- ========================================== -->
    <!-- PÁGINA 5: PLAN DE ACCIÓN Y RETORNO (ROI)   -->
    <!-- ========================================== -->
    <div class="page">
        <div class="page-header">
            <span>Tacos Gavilan — Dirección General</span>
            <span>Módulo de Control y Seguridad en Delivery</span>
        </div>

        <h2>7. Evaluación Financiera: Inversión Requerida vs. Recuperación de Merma</h2>

        <div class="callout-success">
            <strong>Inversión Mínima / Retorno Financiero Inmediato:</strong>
            <br>• <strong>Costo de desarrollo e infraestructura:</strong> $0 adicionales en hardware al aprovechar las tablets operativas existentes en sucursal.
            <br>• <strong>Insumos requeridos:</strong> Los empaques y sellos ya forman parte del inventario operativo habitual de la empresa.
            <br>• <strong>Ahorro directo proyectado:</strong> Recuperación estimada de entre <strong>$3,500 y $6,000 mensuales</strong> en el consolidado de las 15 sucursales por concepto de contracargos improcedentes, órdenes duplicadas y mermas por delivery.
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin: 14px 0;">
            <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; text-align: center;">
                <div style="font-size: 9px; font-weight: 700; color: #6b7280; text-transform: uppercase;">Merma Mensual Estimada</div>
                <div style="font-size: 18px; font-weight: 800; color: #dc2626; margin: 5px 0;">-$4,500+</div>
                <div style="font-size: 9.5px; color: #4b5563;">Promedio consolidado en 15 sucursales por contracargos y pedidos duplicados</div>
            </div>
            <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; text-align: center;">
                <div style="font-size: 9px; font-weight: 700; color: #6b7280; text-transform: uppercase;">Inversión en Hardware</div>
                <div style="font-size: 18px; font-weight: 800; color: #2563eb; margin: 5px 0;">$0</div>
                <div style="font-size: 9.5px; color: #4b5563;">Integrado nativamente en la infraestructura de software de Tacos Gavilan</div>
            </div>
            <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; padding: 12px; text-align: center;">
                <div style="font-size: 9px; font-weight: 700; color: #166534; text-transform: uppercase;">Recuperación Neta Mensual</div>
                <div style="font-size: 18px; font-weight: 800; color: #16a34a; margin: 5px 0;">+$4,000+</div>
                <div style="font-size: 9.5px; color: #166534;">Fondos operativos recuperados directamente para la empresa</div>
            </div>
        </div>

        <h3 style="margin-top: 14px;">8. Cronograma de Implementación (Ruta Crítica: 7 Días)</h3>

        <div style="background: #eff6ff; border: 1.5px solid #93c5fd; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px;">
            <div style="font-size: 12px; font-weight: 700; color: #1e40af; margin-bottom: 4px;">
                Fase Única: Integración y Despliegue en Software
            </div>
            <p style="font-size: 10.5px; margin-bottom: 3px;">
                <strong>Días 1 al 3:</strong> Habilitación de la interfaz táctil de empaque (Conciliación Ítem por Ítem, alerta visual de refrigerados, captura de doble fotografía probatoria y control de acceso vía PIN de Toast).
            </p>
            <p style="font-size: 10.5px; margin-bottom: 3px;">
                <strong>Días 4 y 5:</strong> Configuración del módulo de resolución de disputas en TEG Admin, permitiendo la generación instantánea de expedientes documentales con ambas evidencias para su envío a DoorDash y Uber Eats.
            </p>
            <p style="font-size: 10.5px; margin: 0;">
                <strong>Días 6 y 7:</strong> Despliegue de pruebas piloto en las sucursales estratégicas de <strong>Slauson (#7)</strong> y <strong>LA Central (#6)</strong>, seleccionadas por su alto volumen y dinamismo operativo en delivery, evaluando la velocidad de empaque y la recuperación efectiva de contracargos antes de la homologación en las 15 unidades de negocio.
            </p>
        </div>

        <div class="callout-success" style="margin-top: 10px;">
            <strong>Dictamen Ejecutivo y Recomendación Estratégica:</strong>
            La implementación coordinada de la <strong>Conciliación Ítem por Ítem (Match 100%)</strong> y el <strong>Protocolo de Doble Evidencia Fotográfica (Pre y Post-Sellado)</strong> establece un marco de seguridad operativa y probatoria integral. El primer registro protege patrimonialmente a la empresa frente a reclamaciones infundadas de usuarios finales, mientras que el segundo traslada formalmente a la plataforma y a sus conductores la responsabilidad de cualquier alteración en ruta. Con el arranque del plan piloto en <strong>Slauson y LA Central</strong>, se obtendrán métricas inmediatas de ahorro neto sin interrumpir la operación ni incurrir en gastos de hardware para las 15 sucursales de Tacos Gavilan.
        </div>

        <div class="page-footer">
            <span>Tacos Gavilan — Documento Estratégico Confidencial</span>
            <span>Página 5</span>
        </div>
    </div>

</body>
</html>
    `;

    const outputPath = path.join(__dirname, '../Tacos_Gavilan_Sistema_Blindaje_Delivery.pdf');

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    await page.pdf({
        path: outputPath,
        format: 'Letter',
        printBackground: true,
        margin: {
            top: '0in',
            right: '0in',
            bottom: '0in',
            left: '0in'
        }
    });

    await browser.close();

    // Guardar versión v5 en escritorio con mención de Slauson y Central
    const desktopV5 = 'C:\\Users\\pedro\\Desktop\\Tacos_Gavilan_Sistema_Blindaje_Delivery_v5_Slauson_Central.pdf';
    fs.copyFileSync(outputPath, desktopV5);

    console.log(`🎉 ¡Propuesta Ejecutiva v5.0 (Piloto Slauson & Central) generada con éxito en: ${desktopV5}!`);
}

generateExecutivePDF().catch(err => {
    console.error('❌ Error generando PDF:', err);
    process.exit(1);
});
