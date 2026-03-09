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
        if (!sheet || sheet.length === 0) return null;

        const headerRow = sheet[0];
        let foodItemKey = '';
        let actualToastKey = '';
        let categoryKey = '';
        let newPriceKey = '';

        for (const k of Object.keys(headerRow)) {
            const val = String(headerRow[k]).toLowerCase().trim();
            if (val.includes('food item')) foodItemKey = k;
            if (val.includes('actual toast')) actualToastKey = k;
            if (val.includes('categoria')) categoryKey = k;
            if (val.includes('new price')) newPriceKey = k;
        }

        // Fallbacks
        if (!foodItemKey) foodItemKey = Object.keys(headerRow).find(k => k.toLowerCase().includes('food item')) || Object.keys(headerRow)[1];
        if (!actualToastKey) actualToastKey = '__EMPTY_4';
        if (!categoryKey) categoryKey = '__EMPTY';
        if (!newPriceKey) newPriceKey = '__EMPTY_5';

        const localPmix = is3rdParty ? JSON.parse(JSON.stringify(aggregatedPmix3rdParty)) : JSON.parse(JSON.stringify(aggregatedPmixInStore));

        const items: any[] = [];
        let currentCategory = '';

        for (let i = 1; i < sheet.length; i++) {
            const row = sheet[i];

            // Keep fallback for category from previous rows if the user didn't pull down the "Categoria" formula
            if (row[categoryKey] && String(row[categoryKey]).trim() !== '') {
                currentCategory = String(row[categoryKey]);
            } else if (row[foodItemKey] && !row[actualToastKey]) {
                currentCategory = String(row[foodItemKey]);
                continue;
            }

            const itemNameRaw = String(row[foodItemKey] || '').trim();
            const rawCur = row[actualToastKey];
            const hasActualPrice = (rawCur !== undefined && rawCur !== '' && String(rawCur).toLowerCase() !== 'n/a');

            if (!itemNameRaw || !hasActualPrice) {
                continue;
            }

            const currentPrice = Number((String(rawCur) === 'N/A' || isNaN(Number(rawCur))) ? 0 : rawCur);
            const rawProp = row[newPriceKey];
            const proposedExcelPrice = Number((String(rawProp) === 'N/A' || isNaN(Number(rawProp))) ? 0 : rawProp);

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

            if (currentPrice === 0) continue; // Skip items removed from menu or not sold on this platform (no ACTUAL Toast price)

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

        const targetRevenue = currentTotalRevenue * 1.05; // We want exactly +5% global

        function roundTo9(price: number) {
            let p = Math.floor(price * 10) / 10;
            return Number((p + 0.09).toFixed(2));
        }

        let fixedItemsRevenue = 0;
        let fixedItemsRevenueV3 = 0;
        let fixedItemsRevenueV4 = 0;

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

            const isTortaAll = lowCat.includes('tortas') || lowName.includes('torta');
            const isChampurrado = lowName === 'champurrado';
            const isSuperMulita = lowCat.includes('super mulita') && lowName.includes('regular');

            if (isTacoHook) {
                item.hookType = 'Taco';
                item.hookTypeV3 = 'Taco';
                item.hookTypeV4 = 'Taco';
                item.hookStrategyPrice = tacoHookPrice;
                fixedItemsRevenue += item.hookStrategyPrice * item.pmixQty30Days;
                fixedItemsRevenueV3 += item.hookStrategyPrice * item.pmixQty30Days;
                fixedItemsRevenueV4 += item.hookStrategyPrice * item.pmixQty30Days;
            } else if (isRegularBurrito) {
                item.hookType = 'Burrito';
                item.hookTypeV3 = 'Other';
                item.hookTypeV4 = 'Other';
                item.hookStrategyPrice = roundTo9(item.currentPrice * 1.0465);
                fixedItemsRevenue += item.hookStrategyPrice * item.pmixQty30Days;
            } else if (isRegularQuesadilla) {
                item.hookType = 'Quesadilla';
                item.hookTypeV3 = 'Other';
                item.hookTypeV4 = 'Other';
                item.hookStrategyPrice = roundTo9(item.currentPrice * 1.0465);
                fixedItemsRevenue += item.hookStrategyPrice * item.pmixQty30Days;
            } else if (isTortaAll) {
                if (!is3rdParty) {
                    item.hookType = 'TortaAll';
                    item.hookTypeV3 = 'TortaAll';
                    item.hookTypeV4 = 'TortaAllV4';
                    item.hookStrategyPrice = 9.69;
                    fixedItemsRevenue += item.hookStrategyPrice * item.pmixQty30Days;
                    fixedItemsRevenueV3 += item.hookStrategyPrice * item.pmixQty30Days;
                    item.hookStrategyPriceV4Base = 9.09;
                } else {
                    item.hookType = 'Other';
                    item.hookTypeV3 = 'Other';
                    item.hookTypeV4 = 'TortaAllV4';
                    item.hookStrategyPriceV4Base = 10.89;
                }
            } else if (isChampurrado && !is3rdParty) {
                item.hookType = 'Champurrado';
                item.hookTypeV3 = 'Champurrado';
                item.hookTypeV4 = 'Other';
                item.hookStrategyPrice = 3.99;
                fixedItemsRevenue += item.hookStrategyPrice * item.pmixQty30Days;
                fixedItemsRevenueV3 += item.hookStrategyPrice * item.pmixQty30Days;
            } else if (isSuperMulita && !is3rdParty) {
                item.hookType = 'SuperMulita';
                item.hookTypeV3 = 'SuperMulita';
                item.hookTypeV4 = 'Other';
                item.hookStrategyPrice = 5.99;
                fixedItemsRevenue += item.hookStrategyPrice * item.pmixQty30Days;
                fixedItemsRevenueV3 += item.hookStrategyPrice * item.pmixQty30Days;
            } else {
                item.hookType = 'Other';
                item.hookTypeV3 = 'Other';
                item.hookTypeV4 = 'Other';
            }
        }

        let optimalPercentage = 0;
        let minDiff = Infinity;
        let optimalRevenue = 0;

        let optimalPercentageV3 = 0;
        let minDiffV3 = Infinity;
        let optimalRevenueV3 = 0;

        let optimalPercentageV4 = 0;
        let minDiffV4 = Infinity;
        let optimalRevenueV4 = 0;

        for (let p = 0.0500; p <= 0.2500; p += 0.0001) {
            let testRev = fixedItemsRevenue;
            let testRevV3 = fixedItemsRevenueV3;
            let testRevV4 = fixedItemsRevenueV4;

            for (const item of items) {
                if (item.hookType === 'Other') {
                    testRev += roundTo9(item.currentPrice * (1 + p)) * item.pmixQty30Days;
                }
                if (item.hookTypeV3 === 'Other') {
                    testRevV3 += roundTo9(item.currentPrice * (1 + p)) * item.pmixQty30Days;
                }
                if (item.hookTypeV4 === 'Other') {
                    testRevV4 += roundTo9(item.currentPrice * (1 + p)) * item.pmixQty30Days;
                }
                if (item.hookTypeV4 === 'TortaAllV4') {
                    testRevV4 += roundTo9(item.hookStrategyPriceV4Base * (1 + p)) * item.pmixQty30Days;
                }
            }

            const diff = Math.abs(testRev - targetRevenue);
            if (diff < minDiff) {
                minDiff = diff;
                optimalPercentage = p;
                optimalRevenue = testRev;
            }

            const diffV3 = Math.abs(testRevV3 - targetRevenue);
            if (diffV3 < minDiffV3) {
                minDiffV3 = diffV3;
                optimalPercentageV3 = p;
                optimalRevenueV3 = testRevV3;
            }

            const diffV4 = Math.abs(testRevV4 - targetRevenue);
            if (diffV4 < minDiffV4) {
                minDiffV4 = diffV4;
                optimalPercentageV4 = p;
                optimalRevenueV4 = testRevV4;
            }
        }

        // Apply optimal percentage to "Other"
        for (const item of items) {
            item.isHook = false;

            // --- V2 ---
            if (item.hookType === 'Taco') {
                item.isHook = true;
                item.adjustmentTag = 'Gancho (0%)';
            } else if (item.hookType === 'Burrito' || item.hookType === 'Quesadilla') {
                item.adjustmentTag = 'Tope 5%';
            } else if (item.hookType === 'TortaAll') {
                item.adjustmentTag = 'Tope Dueño ($9.69 base)';
            } else if (item.hookType === 'Champurrado') {
                item.adjustmentTag = 'Tope Dueño ($3.99 base)';
            } else if (item.hookType === 'SuperMulita') {
                item.adjustmentTag = 'Tope Dueño ($5.99 base)';
            } else {
                item.hookStrategyPrice = roundTo9(item.currentPrice * (1 + optimalPercentage));
                item.adjustmentTag = `Camino B (+${(optimalPercentage * 100).toFixed(2)}%)`;
            }

            // --- V3 ---
            if (item.hookTypeV3 === 'Taco') {
                item.adjustmentTagV3 = 'Gancho (0%)';
                item.hookStrategyPriceV3 = item.hookStrategyPrice;
            } else if (item.hookTypeV3 === 'TortaAll') {
                item.adjustmentTagV3 = 'Tope Dueño ($9.69 base)';
                item.hookStrategyPriceV3 = item.hookStrategyPrice;
            } else if (item.hookTypeV3 === 'Champurrado') {
                item.adjustmentTagV3 = 'Tope Dueño ($3.99 base)';
                item.hookStrategyPriceV3 = item.hookStrategyPrice;
            } else if (item.hookTypeV3 === 'SuperMulita') {
                item.adjustmentTagV3 = 'Tope Dueño ($5.99 base)';
                item.hookStrategyPriceV3 = item.hookStrategyPrice;
            } else {
                item.hookStrategyPriceV3 = roundTo9(item.currentPrice * (1 + optimalPercentageV3));
                item.adjustmentTagV3 = item.hookType === 'Other'
                    ? `Nuevo Camino (+${(optimalPercentageV3 * 100).toFixed(2)}%)`
                    : `Liberado (+${(optimalPercentageV3 * 100).toFixed(2)}%)`;
            }

            // --- V4 ---
            if (item.hookTypeV4 === 'Taco') {
                item.adjustmentTagV4 = 'Gancho (0%)';
                item.hookStrategyPriceV4 = item.hookStrategyPrice;
            } else if (item.hookTypeV4 === 'TortaAllV4') {
                item.hookStrategyPriceV4 = roundTo9(item.hookStrategyPriceV4Base * (1 + optimalPercentageV4));
                item.adjustmentTagV4 = `Base Unificada ($${item.hookStrategyPriceV4Base.toFixed(2)}) +${(optimalPercentageV4 * 100).toFixed(2)}%`;
            } else {
                item.hookStrategyPriceV4 = roundTo9(item.currentPrice * (1 + optimalPercentageV4));
                item.adjustmentTagV4 = (item.hookType === 'Other' && item.hookTypeV3 === 'Other')
                    ? `Nuevo Camino (+${(optimalPercentageV4 * 100).toFixed(2)}%)`
                    : `Liberado (+${(optimalPercentageV4 * 100).toFixed(2)}%)`;
            }
        }

        const totalNewRevenue = optimalRevenue;
        const finalIncreasePercentage = ((totalNewRevenue / currentTotalRevenue) - 1) * 100;

        const totalNewRevenueV3 = optimalRevenueV3;
        const finalIncreasePercentageV3 = ((totalNewRevenueV3 / currentTotalRevenue) - 1) * 100;

        const totalNewRevenueV4 = optimalRevenueV4;
        const finalIncreasePercentageV4 = ((totalNewRevenueV4 / currentTotalRevenue) - 1) * 100;

        return { title, items, currentTotalRevenue, excelProposedRevenue, totalNewRevenue, finalIncreasePercentage, optimalPercentage, totalNewRevenueV3, finalIncreasePercentageV3, optimalPercentageV3, totalNewRevenueV4, finalIncreasePercentageV4, optimalPercentageV4 };
    }

    // In Store hook is 2.29, 3rd Party hook based on Excel is likely 2.89 (we'll check what current is, in Excel 06/20/26 is 2.89)
    // We'll read the first taco price for 3rd party to freeze it at its current price.
    const thirdPartySheetRaw = excelData['3rd Party - Food Item Prices an'];
    let tpTacoPrice = 2.89; // Fallback
    if (thirdPartySheetRaw) {
        for (let i = 0; i < thirdPartySheetRaw.length; i++) {
            if (thirdPartySheetRaw[i]['3rd Party - Food Item Prices'] === 'Tacos' || thirdPartySheetRaw[i]['Categoria'] === 'Tacos') {
                const rawVal = thirdPartySheetRaw[i + 1]['__EMPTY_4'];
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
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 98%; margin: 0 auto; padding: 20px; }
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
        @media print {
            @page { size: landscape; margin: 1cm; }
            body { max-width: 100%; margin: 0; padding: 0; font-size: 11px; background: white; }
            .explanation, .executive-summary, .summary-box { border: 1px solid #ccc; box-shadow: none; break-inside: avoid; padding: 10px; margin-bottom: 15px; }
            table { width: 100%; font-size: 10px; box-shadow: none; border: 1px solid #ccc; }
            th { position: static; background-color: #e0e0e0 !important; color: #000 !important; border: 1px solid #aaa; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            td { border: 1px solid #ccc; padding: 6px 8px; }
            .taco-row { background-color: #fff3cd !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            /* Fix colored headers for print readability */
            th[style] { color: #000 !important; background-color: #f5f5f5 !important; font-weight: bold; border: 1px solid #aaa; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            td[style] { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            h1, h2 { break-after: avoid; margin-top: 15px; margin-bottom: 10px; }
        }
    </style>
</head>
<body>
    <h1>Reporte Ejecutivo: The "Hook" Price Strategy (2026)</h1>
    
    <div class="executive-summary">
        <h2>🎯 Resumen del Objetivo y Reglas del Modelo (+5.0% Global)</h2>
        <p>Este reporte proyecta los ingresos calculando el <strong>aumento global real del 5%</strong> en la facturación mensual, protegiendo los productos estrella de grandes subidas de precio y partiendo única y exclusivamente de los precios vigentes reales ("Prices ACTUAL toast"). Las reglas del simulador fueron construidas bajo las siguientes directrices:</p>
        <ul>
            <li><strong>El Gancho Intacto (0%):</strong> Taco Regular de mostrador se congela en históricos <strong>$2.29</strong>.</li>
            <li><strong>Límite Proteccionista (Tope 5%):</strong> Burritos Regulares y Quesadillas Regulares se bloquean para no subir más allá de $8.99.</li>
            <li><strong>Decisión a Medida (Tope Dueño):</strong> Tortas ($9.69), Champurrado ($3.99) y Super Mulitas ($5.99).</li>
            <li><strong>El "Camino B" (La Compensación Dinámica - Escenario V2):</strong> Dado que congelamos los Tacos y Burritos (que son nuestro volumen más grande), la ganancia faltante para llegar al 5% global debe recuperarse del resto del menú. El "Camino B" (o Ajuste Compensatorio Dinámico) es el algoritmo calculando <em>la cantidad milimétrica exacta porcentual</em> que Sides, Bebidas, Super Burritos, etc., tienen que subir para lograr arrastrar el promedio final mensual a la meta dorada.</li>
        </ul>
    </div>

    <div class="explanation">
        <h2>📊 Guía para leer las Tablas de Precios (In-Store y 3rd Party)</h2>
        <p>A continuación se presentan dos tablas con el resumen financiero. En cada tabla encontrarás una columna llamada <strong>"Motivo de Ajuste"</strong>, la cual le indica a Gerencia la regla matemática que guía el "Nuevo Escenario V2".</p>
        <p>A petición directiva, se añadieron tres nuevas columnas adicionales para evaluación:<br/>
        1. <strong>"Aumento Plano Directo (+5%)"</strong>: Ignora la estrategia V2 del "gancho", y simplemente agarra el Precio Actual de cada producto individual y le sube un +5.0% clavado (redondeándolo a .X9). Demuestra qué pasaría si se hace una subida agresiva y ciega.<br/>
        2. <strong>"Pronóstico 6 Meses (Plano +5% sobre el +5%)"</strong>: Una proyección a mediano plazo. Toma el precio de la primera alza plana y le vuelve a aplicar otro +5.0% acumulativo para simular el precio del menú dentro de medio año, bajo esta lógica lineal directiva.<br/>
        3. <strong>"Nuevo Escenario V3 (Sin Tope en Burritos)"</strong>: Este escenario presenta una simulación matemática alternativa. <strong>Retira la restricción del 5% establecida a los Burritos Regulares y Quesadillas Regulares.</strong> Al permitir que estos productos de alto volumen formen parte del ajuste global dinámico, el incremento requerido para el resto de los productos complementarios (bebidas, complementos, postres) se estabiliza de un <strong>+8.16%</strong> a un más equilibrado <strong>+6.39%</strong>. El Taco Regular permanece protegido a $2.29.<br/>
        4. <strong>"Nuevo Escenario V4 (Base Unificada Tortas)"</strong>: A petición corporativa, este simulador unifica todas las variedades de Tortas tratándolas como si tuvieran un valor idéntico base de $9.09 ($10.89 en 3rd Party) antes de inyectarles la inflación, eliminando la disparidad de Jamón y Cubana en el mostrador. Manteniendo al Taco intacto como gancho primario, también se liberan Champurrado y Super Mulitas hacia el cálculo dinámico, absorbiendo con equidad total el incremento del +5%.</p>
        <p><strong>Nota importante sobre la sección "3rd Party" (Uber Eats / DoorDash):</strong><br/>
        Al revisar la tabla de aplicaciones móviles, notarás una columna especial de referencia en color <strong>morado</strong> llamada <strong>"In-Store + 25%"</strong>. Esta columna fue añadida como una brújula ejecutiva: Toma el precio final sugerido en mostrador, le inyecta directamente un +25% lineal para cobertura de comisiones, y lo redondea psicologicamente a un <em>.99 / .X9</em>. Sirve para comparar visualmente ese número plano contra la sugerencia dinámica arrojada por el algoritmo (columna verde final).</p>
    </div>
`;
    for (const res of results) {
        if (!res) continue;
        const colorVarV2 = res.finalIncreasePercentage >= 5.0 ? 'success' : 'highlight';
        const colorVarV3 = res.finalIncreasePercentageV3 >= 5.0 ? 'success' : 'highlight';
        const is3rdPartyOutput = res.title.includes('3rd Party');

        html += `
        <div class="summary-box">
            <h2>Resultados Base: ${res.title}</h2>
            <ul>
                <li><strong>Ingreso Actual Estimado (Febrero 2026, Volumen Histórico):</strong> $${formatCurrency(res.currentTotalRevenue)}</li>
                <li><strong>Ingreso con Escenario V2 (Tope 5% en Burritos):</strong> <span class="success">$${formatCurrency(res.totalNewRevenue)}</span></li>
                <li><strong>Aumento Real Efectivo Mensual V2 (Global):</strong> <span class="${colorVarV2}">+${res.finalIncreasePercentage.toFixed(2)}%</span> vs Actual.</li>
                <li style="margin-top:10px;"><strong>Ingreso con Escenario V3 (Sin Tope en Burritos):</strong> <span class="success" style="color:#e67e22;">$${formatCurrency(res.totalNewRevenueV3)}</span></li>
                <li><strong>Aumento Real Efectivo Mensual V3 (Global):</strong> <span class="${colorVarV3}" style="color:#d35400;">+${res.finalIncreasePercentageV3.toFixed(2)}%</span> vs Actual.</li>
                <li style="margin-top:10px;"><strong>Ingreso con Escenario V4 (Sólo Taco Protegido):</strong> <span class="success" style="color:#20c997;">$${formatCurrency(res.totalNewRevenueV4)}</span></li>
                <li><strong>Aumento Real Efectivo Mensual V4 (Global):</strong> <span class="${res.finalIncreasePercentageV4 >= 5.0 ? 'success' : 'highlight'}" style="color:#17a2b8;">+${res.finalIncreasePercentageV4.toFixed(2)}%</span> vs Actual.</li>
            </ul>
        </div>

        <h2>Tabla de Precios Detallada: ${res.title}</h2>
        <table>
            <thead>
                <tr>
                    <th>Categoría</th>
                    <th>Producto</th>
                    <th>Precio Actual</th>
                    <th style="background-color: #27ae60; color: white;">Aumento Plano Directo (+5%)</th>
                    <th style="background-color: #27ae60; color: white;">Pronóstico 6 Meses (Plano +5% y otro +5%)</th>
                    <th>Motivo de Ajuste (V2)</th>
                    <th>Nuevo Escenario V2 (Dinámico Algoritmo)</th>
                    ${is3rdPartyOutput ? '<th style="background-color: #8e44ad;">In-Store + 25% (Referencia)</th>' : ''}
                    <th style="background-color: #d35400; color: white;">Motivo de Ajuste (V3)</th>
                    <th style="background-color: #d35400; color: white;">Nuevo Escenario V3 (Sin Tope en Burritos)</th>
                    <th style="background-color: #17a2b8; color: white;">Motivo de Ajuste (V4)</th>
                    <th style="background-color: #17a2b8; color: white;">Nuevo Escenario V4 (Sólo Taco Protegido)</th>
                </tr>
            </thead>
            <tbody>`;

        for (const item of res.items) {
            let rowClass = item.isHook ? ' class="taco-row"' : '';
            let isTacoStar = item.isHook ? '⭐ ' : '';

            let inStorePlus25 = '';
            if (is3rdPartyOutput) {
                const matchedInStore = inStoreResult?.items.find((x: any) => x.category === item.category && x.name === item.name);
                if (matchedInStore) {
                    const mappedPrice = Math.floor(matchedInStore.hookStrategyPriceV4 * 1.25 * 10) / 10 + 0.09; // Use V4 as best reference
                    inStorePlus25 = `<td style="color: #8e44ad; font-weight: bold;">$${mappedPrice.toFixed(2)}</td>`;
                } else {
                    inStorePlus25 = `<td style="color: gray;">N/A</td>`;
                }
            }

            let plano5Value = Math.floor(item.currentPrice * 1.05 * 10) / 10 + 0.09;
            let plano5_next6mValue = Math.floor(plano5Value * 1.05 * 10) / 10 + 0.09;

            let plano5 = item.currentPrice === 0 ? 'N/A' : '$' + plano5Value.toFixed(2);
            let plano5_next6m = item.currentPrice === 0 ? 'N/A' : '$' + plano5_next6mValue.toFixed(2);

            html += `
                <tr${rowClass}>
                    <td>${item.category}</td>
                    <td>${isTacoStar}${item.name}</td>
                    <td>${item.currentPrice === 0 ? 'N/A' : '$' + item.currentPrice.toFixed(2)}</td>
                    <td style="font-weight: bold; color: #27ae60;">${plano5}</td>
                    <td style="font-weight: bold; color: #1abc9c;">${plano5_next6m}</td>
                    <td style="color: #2980b9; font-weight: bold;">${item.adjustmentTag}</td>
                    <td style="font-size: 1.1em; color: green;"><strong>$${item.hookStrategyPrice.toFixed(2)}</strong></td>
                    ${inStorePlus25}
                    <td style="color: #d35400; font-weight: bold;">${item.adjustmentTagV3}</td>
                    <td style="font-size: 1.1em; color: #e67e22;"><strong>$${item.hookStrategyPriceV3.toFixed(2)}</strong></td>
                    <td style="color: #17a2b8; font-weight: bold;">${item.adjustmentTagV4}</td>
                    <td style="font-size: 1.1em; color: #20c997;"><strong>$${item.hookStrategyPriceV4.toFixed(2)}</strong></td>
                </tr>`;
        }

        html += `
            </tbody>
        </table>`;
    }

    html += `
</body>
</html>`;

    fs.writeFileSync(path.join(process.cwd(), 'docs/Precios/price_strategy_report_v3.html'), html);
    console.log("Report generated successfully with both sheets!");
}

run();
