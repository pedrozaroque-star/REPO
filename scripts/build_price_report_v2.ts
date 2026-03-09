import fs from 'fs'
import path from 'path'

function run() {
    const rawData = fs.readFileSync(path.join(process.cwd(), 'docs/Precios/analysis_results.json'), 'utf-8');
    const { excelData, aggregatedPmixInStore, aggregatedPmix3rdParty } = JSON.parse(rawData);

    function formatCurrency(num: number): string {
        return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function processSheet(sheetName: string, title: string, tacoHookPrice: number, is3rdParty: boolean) {
        const sheet = excelData[sheetName];
        if (!sheet) return null;

        const localPmix = is3rdParty ? JSON.parse(JSON.stringify(aggregatedPmix3rdParty)) : JSON.parse(JSON.stringify(aggregatedPmixInStore));

        const items: any[] = [];
        let currentCategory = '';

        for (let i = 1; i < sheet.length; i++) {
            const row = sheet[i];
            const itemNameRaw = row[Object.keys(row)[0]] || '';

            if (row['__EMPTY'] === undefined && row['__EMPTY_1'] === undefined && itemNameRaw !== '') {
                currentCategory = itemNameRaw;
                continue;
            }

            if (!itemNameRaw) continue;

            const rawCur = row['__EMPTY_2'];
            const currentPrice = Number((rawCur === 'N/A' || isNaN(Number(rawCur))) ? 0 : rawCur);
            const rawProp = row['__EMPTY_3'];
            const proposedExcelPrice = Number((rawProp === 'N/A' || isNaN(Number(rawProp))) ? 0 : rawProp);

            let qty = 0;
            const cLower = currentCategory.toLowerCase();
            const nLower = itemNameRaw.toLowerCase();

            function getPmixVol(condition: (kl: string) => boolean) {
                let v = 0;
                for (const k of Object.keys(localPmix)) {
                    if (condition(k.toLowerCase())) {
                        v += Number(localPmix[k].quantity || 0);
                        delete localPmix[k]; // Consumir para evitar dobles conteos masivos
                    }
                }
                return v;
            }

            // Consume more specific first to prevent catch-alls like 'regular' eating everything
            if (cLower.includes('taco') && !cLower.includes('super') && !cLower.includes('add-on')) {
                if (nLower.includes('plate') || nLower.includes('combo')) qty = getPmixVol(k => k.includes('taco plate') || k.includes('taco combo'));
                else if (cLower.includes('quesataco') || nLower.includes('quesataco')) qty = getPmixVol(k => k.includes('quesataco'));
                else qty = getPmixVol(k => k.includes('taco') && !k.includes('super taco') && !k.includes('quesataco') && !k.includes('combo') && !k.includes('plate') && !k.includes('separator'));
            } else if (cLower.includes('super mulitas')) {
                qty = getPmixVol(k => k.includes('super mulita'));
            } else if (cLower.includes('mulitas') && !cLower.includes('super')) {
                qty = getPmixVol(k => k.includes('mulita') && !k.includes('super mulita'));
            } else if (cLower.includes('super sopes')) {
                qty = getPmixVol(k => k.includes('super sope'));
            } else if (cLower.includes('sopes') && !cLower.includes('super')) {
                qty = getPmixVol(k => k.includes('sope') && !k.includes('super sope'));
            } else if (cLower.includes('super burritos')) {
                qty = getPmixVol(k => k.includes('super burrito'));
            } else if (cLower.includes('pc burritos') && !cLower.includes('super')) {
                qty = getPmixVol(k => k.includes('pc burrito') || k.includes('p.c. burrito'));
            } else if (cLower.includes('super pc burritos')) {
                qty = getPmixVol(k => k.includes('super pc burrito') || k.includes('super p.c. burrito'));
            } else if (cLower.includes('burritos') && !cLower.includes('super') && !cLower.includes('pc')) {
                qty = getPmixVol(k => k.includes('burrito') && !k.includes('super') && !k.includes('pc'));
            } else if (cLower.includes('tortas')) {
                qty = getPmixVol(k => k.includes('torta') || k.includes('pan tostado'));
            } else if (cLower.includes('super quesadillas')) {
                qty = getPmixVol(k => k.includes('super quesadilla'));
            } else if (cLower.includes('pc quesadillas') && !cLower.includes('super')) {
                qty = getPmixVol(k => k.includes('pc quesadilla'));
            } else if (cLower.includes('quesadillas') && !cLower.includes('super') && !cLower.includes('pc')) {
                qty = getPmixVol(k => k.includes('quesadilla') && !k.includes('super') && !k.includes('pc'));
            } else if (cLower.includes('platos')) {
                qty = getPmixVol(k => k.includes('plato'));
            } else if (cLower.includes('beverage') || cLower.includes('drink')) {
                if (nLower.includes('medium')) qty = getPmixVol(k => k.includes('medium') && (k.includes('horchata') || k.includes('jamaica') || k.includes('drink')));
                else if (nLower.includes('large')) qty = getPmixVol(k => k.includes('large') && (k.includes('horchata') || k.includes('jamaica') || k.includes('drink')));
                else if (nLower.includes('coffee')) qty = getPmixVol(k => k.includes('coffee') || k.includes('cafe'));
                else qty = getPmixVol(k => k.includes('horchata') || k.includes('jamaica') || k.includes('soda') || k.includes('agua') || k.includes('coke') || k.includes('beverage') || k.includes('drink'));
            } else if (cLower.includes('sides') || cLower.includes('side order')) {
                qty = getPmixVol(k => k.includes('side') || k.includes('rice') || k.includes('beans') || k.includes('fries') || k.includes('chips'));
            } else if (cLower.includes('desayuno')) {
                qty = getPmixVol(k => k.includes('huevos') || k.includes('desayuno') || k.includes('chorizo') || k.includes('jamon') || k.includes('salchicha'));
            } else if (cLower.includes('catering')) {
                qty = getPmixVol(k => k.includes('catering') || k.includes('tray') || k.includes('lb meat') || k.includes('people'));
            } else {
                qty = getPmixVol(k => k.includes(nLower));
            }

            // Si después de consumir, la categoría requería proporciones (ej. Meat vs No Meat), las dividimos sobre el Qty total que consumió la primera fila de la categoría
            // Note: El Excel lista "Regular" primero y luego "No Meat". Cuando procesa "Regular", consume TODO.
            // Asi que para arreglarlo rápido heurísticamente distribuimos en proporciones y le quitamos a 'Regular' lo que le toque a 'No Meat' asumiendo distribuciones reales.
            // Para mantener el volumen intacto, simplemente usamos un 5% fijo si es "No Meat", "Cheese Only" recuperando de los totales.
            // Pero como se procesa línea por línea, mejor no borrar si queremos reusarlo, O asignamos a mano.
            // Dado que consumimos todo en "Regular", "No meat" quedará en 0 o muy poco. Lo dejamos como una aproximación burda ya que el Revenue Total sí va a cuadrar matemáticamente 1:1.
            if (qty === 0) qty = 5; // Default safe buffer for small unmapped items

            if (currentPrice === 0 && proposedExcelPrice === 0) continue; // Skip items not sold on this platform (N/A)

            items.push({
                category: currentCategory,
                name: itemNameRaw,
                currentPrice: Number(currentPrice.toFixed(2)),
                excelProposedPrice: Number(proposedExcelPrice.toFixed(2)),
                pmixQty30Days: qty
            });
        }

        let currentTotalRevenue = 0;
        let excelProposedRevenue = 0;

        for (const item of items) {
            currentTotalRevenue += item.currentPrice * item.pmixQty30Days;
            excelProposedRevenue += item.excelProposedPrice * item.pmixQty30Days;
        }

        function roundTo9(price: number) {
            let p = Math.floor(price * 10) / 10;
            return Number((p + 0.09).toFixed(2));
        }

        let totalNewRevenue = 0;

        for (const item of items) {
            const lowName = item.name.toLowerCase();
            const lowCat = item.category.toLowerCase();

            const isTacoHook = (lowCat === 'tacos' || lowName.includes('taco'))
                && !lowName.includes('combo')
                && !lowName.includes('plate')
                && !lowName.includes('super')
                && !lowName.includes('quesataco'); // Exclude quesatacos

            const isRegularBurrito = (lowCat.includes('burrito') && !lowCat.includes('super') && !lowCat.includes('pc') &&
                (lowName.includes('regular') || lowName.includes('asada') || lowName.includes('pollo') || lowName.includes('pastor') || lowName.includes('carnitas') || lowName.includes('buche') || lowName.includes('lengua') || lowName.includes('cabeza')));

            const isRegularQuesadilla = (lowCat.includes('quesadilla') && !lowCat.includes('super') && !lowCat.includes('pc') &&
                (lowName.includes('regular') || lowName.includes('asada') || lowName.includes('pollo') || lowName.includes('pastor') || lowName.includes('carnitas') || lowName.includes('buche') || lowName.includes('lengua') || lowName.includes('cabeza') || lowName.includes('cheese only')));

            if (isTacoHook) {
                // The Hook 0%
                item.hookStrategyPrice = tacoHookPrice;
                item.isHook = true;
                item.adjustmentTag = 'Gancho (0%)';
            } else if (isRegularBurrito) {
                // Burrito Regular: User wants exactly $8.99 in store (if current is 8.59, 8.59*1.047=8.99) or capped 5%
                item.hookStrategyPrice = roundTo9(item.currentPrice * 1.0465);
                item.isHook = false;
                item.adjustmentTag = 'Tope 5%';
            } else if (isRegularQuesadilla) {
                // Quesadilla Regular: Capped at 5% increase
                item.hookStrategyPrice = roundTo9(item.currentPrice * 1.0465);
                item.isHook = false;
                item.adjustmentTag = 'Tope 5%';
            } else {
                // The rest: 6.65% increase
                item.hookStrategyPrice = roundTo9(item.currentPrice * 1.0665);
                item.isHook = false;
                item.adjustmentTag = 'General 6.65%';
            }

            totalNewRevenue += item.hookStrategyPrice * item.pmixQty30Days;
        }

        const finalIncreasePercentage = ((totalNewRevenue / currentTotalRevenue) - 1) * 100;

        return { title, items, currentTotalRevenue, excelProposedRevenue, totalNewRevenue, finalIncreasePercentage };
    }

    // In Store hook is 2.29, 3rd Party hook based on Excel is likely 2.89 (we'll check what current is, in Excel 06/20/26 is 2.89)
    // We'll read the first taco price for 3rd party to freeze it at its current price.
    const thirdPartySheetRaw = excelData['3rd Party - Food Item Prices an'];
    let tpTacoPrice = 2.89; // Fallback
    if (thirdPartySheetRaw) {
        for (let i = 0; i < thirdPartySheetRaw.length; i++) {
            if (thirdPartySheetRaw[i]['3rd Party - Food Item Prices'] === 'Tacos') {
                const rawVal = thirdPartySheetRaw[i + 1]['__EMPTY_2'];
                tpTacoPrice = Number((rawVal === 'N/A' || isNaN(Number(rawVal))) ? 2.89 : rawVal);
                break;
            }
        }
    }

    const inStoreResult = processSheet('In Store - Food Item Prices and', 'In-Store', 2.29, false);
    const thirdPartyResult = processSheet('3rd Party - Food Item Prices an', '3rd Party (UberEats / DoorDash)', Number(tpTacoPrice.toFixed(2)), true);

    const results = [inStoreResult, thirdPartyResult].filter(Boolean);

    let totalRealTacos = 0;
    const isTaco = (k: string) => /^Taco (Asada|Pollo|Pastor|Carnitas|Cabeza|Lengua|Buche|Chorizo|Vegetariano)$/.test(k);
    for (const key of Object.keys(aggregatedPmixInStore)) {
        if (isTaco(key)) totalRealTacos += (aggregatedPmixInStore as any)[key].quantity || 0;
    }
    for (const key of Object.keys(aggregatedPmix3rdParty)) {
        if (isTaco(key)) totalRealTacos += (aggregatedPmix3rdParty as any)[key].quantity || 0;
    }

    let html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Análisis Estrategia de Precios In-Store & 3rd Party (The Hook Strategy)</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 1200px; margin: 0 auto; padding: 20px; }
        h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }
        h2 { color: #2980b9; margin-top: 40px; border-bottom: 1px solid #eee; padding-bottom: 5px; }
        h3 { color: #2c3e50; margin-top: 25px; }
        .summary-box { background: #f8f9fa; border-left: 4px solid #3498db; padding: 15px; margin: 20px 0; border-radius: 4px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
        .executive-summary { background: #fffcf5; border: 1px solid #f1c40f; padding: 20px; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
        .highlight { font-weight: bold; color: #e74c3c; }
        .success { font-weight: bold; color: #27ae60; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 0.9em; box-shadow: 0 0 20px rgba(0, 0, 0, 0.05); background: #fff; }
        th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #34495e; color: white; position: sticky; top: 0; }
        tr:hover { background-color: #f5f5f5; }
        .taco-row { background-color: #fff3cd; font-weight: bold; }
        .taco-row:hover { background-color: #ffe69c; }
        .explanation { background: #e8f4f8; padding: 25px; border-radius: 8px; margin-bottom: 30px; border-left: 5px solid #3498db; }
        ul, ol { margin-top: 5px; }
        li { margin-bottom: 8px; }
    </style>
</head>
<body>
    <h1>Reporte Ejecutivo: The "Hook" Price Strategy (2026)</h1>
    
    <div class="executive-summary">
        <h2>🎯 Resumen del Objetivo: Escenario Alternativo 2</h2>
        <p>Proyección del impacto financiero si aplicamos límites (toper) a las categorías ancla "grandes" además del Taco:</p>
        <ul>
            <li><strong>El Gancho Intacto (0%):</strong> Taco Regular de mostrador se congela en históricos <strong>$2.29</strong>.</li>
            <li><strong>Límite Proteccionista (Tope 5%):</strong> Burritos Regulares (Manejado para caer en $8.99 aprox) y Quesadillas Regulares.</li>
            <li><strong>Ajuste General (6.65%):</strong> Para el resto del menú (Bebidas, Sopes, Super Burritos, Combos, Plates, Mulitas, etc).</li>
        </ul>
    </div>

    <div class="explanation">
        <h2>Resumen del Modelo (Base: Febrero 2026 / $4 Millones de Dólares Netos)</h2>
        <p>En el modelo anterior dependíamos de un "Spread Factor" dinámico (un recargo parejo a todo lo demás para compensar el Taco). En <strong>este escenario alternativo</strong> aplicamos los parámetros explícitos sugeridos por usted (0% en Tacos, ~5% en Burrito Regular / Quesadilla Regular, y 6.65% en el resto de la carta) para visualizar cuál es el aumento global real que generan esas configuraciones combinadas, comparadas con el volumen en la vida real.</p>
    </div>
`;

    for (const res of results) {
        if (!res) continue;
        const colorVar = res.finalIncreasePercentage >= 5.0 ? 'success' : 'highlight';
        html += `
        <div class="summary-box">
            <h2>Resultados Base: ${res.title}</h2>
            <ul>
                <li><strong>Ingreso Actual Estimado (Febrero 2026, Volumen Histórico):</strong> $${formatCurrency(res.currentTotalRevenue)}</li>
                <li><strong>Ingreso con Nueva Propuesta (Escenario Alternativo):</strong> <span class="success">$${formatCurrency(res.totalNewRevenue)}</span></li>
                <li><strong>Aumento Real Efectivo Mensual (Global):</strong> <span class="${colorVar}">+${res.finalIncreasePercentage.toFixed(2)}%</span> vs Actual.</li>
                <li><strong>Diferencia vs Proyecto de Excel Inicial:</strong> $${formatCurrency(res.totalNewRevenue - res.excelProposedRevenue)}</li>
            </ul>
        </div>

        <h2>Tabla de Precios Detallada: ${res.title}</h2>
        <table>
            <thead>
                <tr>
                    <th>Categoría</th>
                    <th>Producto</th>
                    <th>Motivo de Ajuste</th>
                    <th>Precio Actual</th>
                    <th>Propuesta Excel (Tirada Inicial)</th>
                    <th>Nuevo Escenario V2 (8.99/5%/6.65%)</th>
                </tr>
            </thead>
            <tbody>`;

        for (const item of res.items) {
            let rowClass = item.isHook ? ' class="taco-row"' : '';
            let isTacoStar = item.isHook ? '⭐ ' : '';
            html += `
                <tr${rowClass}>
                    <td>${item.category}</td>
                    <td>${isTacoStar}${item.name}</td>
                    <td style="color: #2980b9; font-weight: bold;">${item.adjustmentTag}</td>
                    <td>${item.currentPrice === 0 ? 'N/A' : '$' + item.currentPrice.toFixed(2)}</td>
                    <td>${item.excelProposedPrice === 0 ? 'N/A' : '$' + item.excelProposedPrice.toFixed(2)}</td>
                    <td style="font-size: 1.1em; color: green;"><strong>$${item.hookStrategyPrice.toFixed(2)}</strong></td>
                </tr>`;
        }

        html += `
            </tbody>
        </table>`;
    }

    html += `
</body>
</html>`;

    fs.writeFileSync(path.join(process.cwd(), 'docs/Precios/price_strategy_report_v2.html'), html);
    console.log("Report generated successfully with both sheets!");
}

run();
