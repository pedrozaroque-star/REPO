import nodemailer from 'nodemailer'
import dotenv from 'dotenv'
import path from 'path'

// Load env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function sendReportEmail() {
    console.log('\n📧 --- ENVIANDO REPORTE DOORDASH A CARLOS ---')

    if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
        console.error('❌ Error: Falta configurar SMTP_EMAIL o SMTP_PASSWORD en el .env.local')
        return
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.SMTP_EMAIL,
            pass: process.env.SMTP_PASSWORD
        }
    })

    const htmlContent = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; border: 1px solid #e5e5e5; border-radius: 8px;">
        
        <h1 style="color: #0c4a6e; border-bottom: 2px solid #0ea5e9; padding-bottom: 10px;">Informe Ejecutivo: Revisión Financiera de Campañas DoorDash</h1>
        
        <p><strong>Para:</strong> Roberto, Propietario de Tacos Gavilan<br/>
        <strong>De:</strong> Carlos<br/>
        <strong>Fecha:</strong> 9 de abril de 2026<br/>
        <strong>Asunto:</strong> Evaluación financiera de la propuesta de incremento de presupuesto publicitario de DoorDash</p>

        <hr style="margin: 30px 0;" />

        <h2 style="color: #0369a1;">1. Resumen Ejecutivo</h2>
        <p>DoorDash propuso incrementar el presupuesto diario de Sponsored Listings de $255 a $640 por día en las 15 sucursales de Tacos Gavilan, argumentando que dicho aumento podría generar mayor volumen, mejorar el retorno sobre inversión publicitaria y reducir el costo por orden.</p>
        <p>A partir de la revisión de los tableros de Merchant Portal y de los resultados observados en campañas recientes, la conclusión preliminar es la siguiente: <strong>no existe evidencia suficiente para justificar, en este momento, un incremento inmediato a $640 diarios a nivel cadena.</strong></p>
        
        <p>Los datos revisados muestran que:</p>
        <ul>
            <li>El desempeño varía fuertemente entre sucursales.</li>
            <li>Parte importante del volumen proviene de clientes existentes o reactivados, no exclusivamente de clientes nuevos.</li>
            <li>Algunos resultados observados parecen haber estado apoyados por componentes co-financiados o incentivos administrados por la plataforma.</li>
            <li>Y, sobre todo, los indicadores presentados por DoorDash describen ventas y ROAS brutos, pero no validan por sí mismos la rentabilidad incremental neta para Tacos Gavilan.</li>
        </ul>
        
        <p>Por lo anterior, la recomendación es: <strong>no aprobar todavía el escalamiento a $640/día y, en su lugar, solicitar una prueba controlada bajo condiciones más limpias y medibles antes de comprometer capital adicional.</strong></p>

        <h2 style="color: #0369a1;">2. Contexto de la propuesta</h2>
        <p>Rodrigo presentó una recomendación con los siguientes argumentos principales:</p>
        <ul>
            <li>Gasto actual: $255/día -> Gasto recomendado: $640/día</li>
            <li>Incremento estimado de ventas mensuales: $88,841</li>
            <li>ROI proyectado: 7.7x</li>
            <li>Reducción de costo por orden de $5.35 a $3.44</li>
            <li>Benchmark sugerido: aproximadamente 3% de ventas diarias invertidas.</li>
        </ul>
        <p>A primera vista, la propuesta parece atractiva. Sin embargo, al revisar los tableros operativos, se identifican varios puntos que requieren validación antes de considerar ese incremento como financieramente sano.</p>

        <h2 style="color: #0369a1;">3. Auditoría Financiera y Hallazgos Cuantitativos</h2>

        <h4>A. Tasa de Canibalización del 53.4%</h4>
        <p>De un porcentaje importante del volumen generado por esta campaña (1,321 clientes impactados), la plataforma reporta que solo 616 fueron estrictamente "New Customers". Esto implica que el sistema gastó casi la mitad del presupuesto en readquirir 494 clientes Vigentes y 211 Inactivos. Desde un punto de vista financiero, si más del 53% gasto está recapturando clientes ya familiarizados con Tacos Gavilan, el valor "incremental" de escalar de $255 a $640 diarios está sobreestimado.</p>

        <h4>B. Efecto "Co-funded" y Discrepancias en el ROAS de Florence/Atlantic</h4>
        <p>El desempeño en reportes recientes estuvo apoyado por créditos inyectados que inflaron las métricas de éxito. Al aislar la data cruda de la sucursal Florence/Atlantic obtenemos deficiencias operativas claras frente a una futura escalabilidad donde la empresa asuma el costo puro:</p>
        <ul>
            <li><strong>Métricas de éxito reportadas:</strong> Ventas de $1,305.26 tras un aparente costo de <strong>$65.69</strong> (Logrando un impresionante ROAS de 19.87x).</li>
            <li><strong>Verdad Matemática del Modelo:</strong> Analizando todas las celdas, el portal registra que esa sucursal realmente completó 52 órdenes con un Costo Promedio Reportado de <strong>$6.81 por clic/orden</strong>. Al multiplicar 52 órdenes por el costo de clics admitido ($6.81) el gasto generado real no fue de $65... fue de <strong>$354.12 dólares</strong>.</li>
            <li>La diferencia de esos costos ($288 USD) fue subsidiada internamente. </li>
            <li><strong>Implicación para Tacos Gavilan:</strong> Si Roberto acepta escalar al nuevo modelo propuesto por Rodrigo pagando de su propio flujo el costo orgánico (sin el crédito), en tiendas de comportamiento idéntico a Florence el ROAS decaería dramáticamente del <strong>19.87x artificial a un insostenible 3.68x</strong> (Ventas de $1305 entre Inversión Real de $354).</li>
        </ul>

        <h4>C. La Economía Unitaria prohíbe el "Auto-Opt-In"</h4>
        <p>El reporte también denota tácticas de "Incentivos Personalizados" que merman todavía más el ticket ya castigado por los $15 dólares teóricos que cuesta la comida y el 25% de la comisión natural del Marketplace.</p>

        <hr style="margin: 30px 0;" />

        <h2 style="color: #0369a1;">4. Borrador de Correo Ejecutivo para Rodrigo</h2>
        <p>La mejor postura para Roberto no es polemizar el algoritmo, es arrinconarlos con sus propios números exigiéndoles la rentabilidad neta probada antes de autorizar escalamientos masivos y de prohibir re-compras de la base existente.</p>

        <div style="background-color: #f0f9ff; border-left: 4px solid #0369a1; padding: 15px; margin-bottom: 20px;">
            <p><strong>OPCIÓN EN INGLÉS (Ideal para enviar hoy)</strong></p>
            <p><strong>Subject:</strong> Re: Sponsored Listings Scale-Up Proposal</p>
            <p>Hi Rodrigo,</p>
            <p>Thank you for sharing the scale-up recommendation and for outlining the projected upside across our 15 stores.</p>
            <p>We reviewed our recent campaign data. While the topline Gross Sales numbers are encouraging, our financial evaluation of the core Unit Economics prevents us from approving a full scale-up from $255/day to $640/day across the brand at this time.</p>
            <p>Our review team highlighted a few areas requiring structural changes before we invest additional capital:</p>
            <ul>
                <li><strong>Heavy Cannibalization:</strong> Our internal analysis of the platform data notes that out of the ~1,321 customers engaged under Smart Targeting, 53.4% were categorized as Existing or Lapsed (nearly 700 organic transactions). Scaling an algorithmic spend to aggressively re-acquire our own established volume lacks long-term incremental efficiency.</li>
                <li><strong>"Co-Funded" Artificial ROAS:</strong> Certain locations reported heavily subsidized returns that won't scale. For instance, Florence/Atlantic reported an unrealistic 19.87x ROAS based on a $65.69 charge. Yet, the dashboard explicitly acknowledges a true system-generated $6.81 Cost Per Order. Across its 52 orders, that's a true cumulative ad generation cost of over $354. If we assume the $640/day expense at that true CPA, Florence would output a poor 3.68x operational ROAS.</li>
                <li><strong>Automatic Margin Adjustments:</strong> The report notes <em>"Customer incentive: Personalized by DoorDash,"</em> which can compress thin restaurant net margins further if unchecked.</li>
            </ul>
            <p>At this point, our preference is to evaluate a cleaner, strict baseline test before we reassess expanding the budget. Under our current $255/day investment we require:</p>
            <ul>
                <li><strong>Restricted Targeting:</strong> Re-routing 100% of the funds strictly towards <strong>New Customers</strong>.</li>
                <li><strong>Zero Automatic Subsidies:</strong> Complete opt-out of "Personalized by DoorDash", DashPass BOGOs, or any platform-configured discounts impacting our bottom line during this evaluation.</li>
            </ul>
            <p>If your system can help configure a tight, highly incremental test under those two conditions, we are open to reviewing the results after a 30-day window.</p>
            <p>Best regards,<br/>Roberto / Tacos Gavilan</p>
        </div>

        <div style="background-color: #fdf4ff; border-left: 4px solid #c026d3; padding: 15px;">
            <p><strong>OPCIÓN EN ESPAÑOL (Traducción para Roberto)</strong></p>
            <p><strong>Asunto:</strong> Re: Propuesta de incremento de Sponsored Listings</p>
            <p>Hola Rodrigo,</p>
            <p>Gracias por compartir la recomendación de escalamiento y por detallar la oportunidad proyectada para nuestras 15 sucursales.</p>
            <p>Revisamos la información reciente, y aunque que los números globales de Ventas Brutas y el retorno sugerido de 7.7x suenan atractivos, una evaluación interna de la Economía Unitaria nos impide aprobar un incremento general de $255 a $640/día en este momento.</p>
            <p>Nuestro equipo resaltó deficiencias estructurales previas que requerimos solucionar antes de invertir más capital:</p>
            <ul>
                <li><strong>Canibalización Severa Orgánica:</strong> Notamos que de aproximadamente 1,321 clientes bajo "Smart Targeting", un 53.4% cayeron en la categoría de Existentes o Inactivos. Escalar masivamente un presupuesto para continuar recomprando a nuestros propios clientes base es estadísticamente ineficiente a nivel corporativo.</li>
                <li><strong>Inconsistencias "Co-Financiadas" del ROAS:</strong> El desempeño que proyectan no soporta ser escalado de manera orgánica. Por ejemplo, sucursal Florence/Atlantic presume un 19.87x de ROAS reflejando un gasto final de apenas $65 dólares; sin embargo, al mismo tiempo su plataforma declara que el verdadero Costo Por Orden de adquisición del algoritmo fue de $6.81. Sobre las 52 órdenes generadas allí, el gasto real fue superior a $354. Si asumimos esos verdaderos gastos algorítmicos sin protección de sus créditos promocionales (Co-Funded), el ROAS de Florence se estrellaría a un marginal 3.68x (Inapropiado para el margen alimenticio esperado).</li>
                <li><strong>Incentivos Automáticos:</strong> Observamos activaciones como <em>"Personalizado por DoorDash"</em> que comprimían aún más el verdadero margen neto al final del flujo.</li>
            </ul>
            <p>Por ahora, nuestra preferencia es no avanzar y en su lugar evaluar una prueba más limpia bajo un parámetro estricto para proteger la rentabilidad de las franquicias utilizando nuestro fondo base actual ($255/día):</p>
            <ul>
                <li><strong>Segmentación Estricta:</strong> Recalibrar que la pauta impacte 100% exclusivamente a clientes Nuevos.</li>
                <li><strong>Cero Descuentos Automáticos:</strong> Apagar o deshabilitar opciones ocultas personalizadas BOGO y ajustes DashPass durante dicho mes de prueba.</li>
            </ul>
            <p>Si tu tecnología dispone de las herramientas para probar bajo ese rigor estricto por 30 días, estaremos encantados de regresar a la mesa de discusión más adelante sobre crecimientos financieros sustentables.</p>
            <p>Saludos,<br/>Roberto / Tacos Gavilan</p>
        </div>
    </div>
    `

    try {
        await transporter.sendMail({
            from: `"Antigravity System" <${process.env.SMTP_EMAIL}>`,
            to: 'carlos@tacosgavilan.com',
            subject: 'Revisión Financiera DoorDash: Reporte Ejecutivo',
            html: htmlContent
        })
        console.log('✅ Correo enviado exitosamente a carlos@tacosgavilan.com')
    } catch (e: any) {
        console.error('❌ Error enviando correo:', e.message)
    }
}

sendReportEmail()
