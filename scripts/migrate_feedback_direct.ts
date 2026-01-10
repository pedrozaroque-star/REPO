
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

async function migrate() {
    console.log('🚀 Iniciando migración de Feedback...');

    // 1. Cargar Variables de Entorno
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (!fs.existsSync(envPath)) {
        console.error('❌ No se encontró .env.local');
        process.exit(1);
    }

    const envContent = fs.readFileSync(envPath, 'utf-8');
    const envVars: Record<string, string> = {};
    envContent.split('\n').forEach(line => {
        const [key, ...rest] = line.split('=');
        if (key && rest.length > 0) {
            const value = rest.join('=').trim().replace(/^["']|["']$/g, '');
            envVars[key.trim()] = value;
        }
    });

    const SUPABASE_URL = envVars.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        console.error('❌ Faltan claves en .env.local (NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY)');
        process.exit(1);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // 2. Leer CSV
    const csvPath = path.resolve(process.cwd(), 'feedback clientes.csv');
    if (!fs.existsSync(csvPath)) {
        console.error('❌ No se encontró feedback clientes.csv');
        process.exit(1);
    }

    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    console.log(`📂 Archivo leído: ${csvContent.length} bytes`);

    // 3. Parsear CSV (Custom Parser para manejar comillas y saltos de línea)
    const rows = parseCSV(csvContent);
    const headers = rows[0]; // Timestamp,Fecha,Hora,Sucursal...
    const dataRows = rows.slice(1);

    console.log(`📊 Filas encontradas: ${dataRows.length}`);

    // 4. Obtener Tiendas
    const { data: stores, error: storesError } = await supabase.from('stores').select('id, name');
    if (storesError) {
        console.error('❌ Error obteniendo tiendas:', storesError);
        process.exit(1);
    }

    // Mapa de normalización de nombres de tiendas
    const storeMap = new Map();
    stores.forEach(s => {
        // Normalizar nombre db para matching (ej: "Tacos Gavilan Lynwood" -> "LINWOOD"?)
        // CSV tiene "Lynwood", "South Gate", "Santa Ana".
        // DB tiene "Tacos Gavilan Lynwood", etc.
        const simplifiedName = s.name.replace('Tacos Gavilan ', '').trim().toLowerCase();
        storeMap.set(simplifiedName, s.id);
    });

    // Fallback manual por si acaso
    storeMap.set('lynwood', 14);
    storeMap.set('south gate', 15);
    storeMap.set('santa ana', 9);

    // 5. Transformar Datos
    const payload = [];

    for (const row of dataRows) {
        if (row.length < 5) continue; // Skip filas vacías

        const getVal = (headerName: string) => {
            const idx = headers.indexOf(headerName);
            return idx !== -1 ? row[idx]?.trim() : '';
        };

        const storeName = getVal('Sucursal');
        const storeId = storeMap.get(storeName.toLowerCase()) || null;

        if (!storeId) {
            console.warn(`⚠️ Tienda no encontrada: ${storeName}`);
        }

        // Ratings
        const service = parseInt(getVal('Caja(1-5)')) || 0;
        const quality = parseInt(getVal('Calidad(1-5)')) || 0;
        const clean = parseInt(getVal('Limpieza(1-5)')) || 0;
        const speed = parseInt(getVal('Entrega(1-5)')) || 0;
        const nps = parseInt(getVal('NPS(0-10)')) || 0;

        // NPS Category
        let npsCategory = 'passive';
        if (nps >= 9) npsCategory = 'promoter';
        if (nps <= 6) npsCategory = 'detractor';

        // Fechas
        const rawDate = getVal('Fecha'); // YYYY-MM-DD
        const rawTime = getVal('Hora');  // HH:MM

        let submissionDate = null;
        let visitDate = null;
        let visitTime = null;

        if (rawDate && rawDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
            visitDate = rawDate;
            if (rawTime) {
                visitTime = rawTime + ':00';
                submissionDate = new Date(`${rawDate}T${rawTime}:00`).toISOString();
            } else {
                submissionDate = new Date(rawDate).toISOString();
            }
        } else {
            // Try timestamp column as fallback
            const ts = getVal('Timestamp');
            if (ts) {
                submissionDate = new Date(ts).toISOString();
                visitDate = submissionDate.split('T')[0];
            }
        }

        // Fotos: Limpiar y convertir a array
        const fotosRaw = getVal('FotosURLs');
        let photoUrls: string[] = [];
        if (fotosRaw) {
            // CSV a veces tiene saltos de linea en urls
            photoUrls = fotosRaw.split(/[\n,]+/).map(u => u.trim()).filter(u => u.startsWith('http'));
        }

        // Folder URL -> Ticket URL
        const folderUrl = getVal('FolderURL');

        // Status
        const statusRaw = getVal('Estatus').toLowerCase();
        let reviewStatus = 'pending';
        if (statusRaw.includes('cerrado') || statusRaw.includes('aprobado')) reviewStatus = 'approved';
        if (statusRaw.includes('pendiente')) reviewStatus = 'pending';

        // ID Original
        const originalId = getVal('ID'); // UUID del CSV

        // Admin Review
        const reviewer = getVal('Reviso');

        payload.push({
            store_id: storeId,
            submission_date: submissionDate,
            visit_date: visitDate,
            visit_time: visitTime,
            customer_name: getVal('ClienteNick') || 'Anónimo',
            language: getVal('Idioma') || 'es',
            service_rating: service,
            food_quality_rating: quality,
            cleanliness_rating: clean,
            speed_rating: speed,
            nps_score: nps,
            nps_category: npsCategory,
            comments: getVal('Comentarios'),
            photo_urls: photoUrls,
            ticket_url: folderUrl, // Guardamos Folder Link aquí
            original_report_id: originalId,
            review_status: reviewStatus,
            admin_observation: reviewer ? `Revisado por: ${reviewer}` : null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });
    }

    // 6. TRUNCATE (Borrar Todo)
    console.log('🗑️  Borrando tabla customer_feedback...');
    const { error: deleteError } = await supabase.from('customer_feedback').delete().neq('id', 0); // Borra todo
    if (deleteError) {
        console.error('❌ Error borrando tabla:', deleteError);
        process.exit(1);
    }

    // 7. INSERT (En lotes)
    console.log(`📥 Insertando ${payload.length} registros...`);

    const BATCH_SIZE = 50;
    for (let i = 0; i < payload.length; i += BATCH_SIZE) {
        const batch = payload.slice(i, i + BATCH_SIZE);
        const { error: insertError } = await supabase.from('customer_feedback').insert(batch);

        if (insertError) {
            console.error(`❌ Error insertando lote ${i}:`, insertError);
        } else {
            console.log(`✅ Lote ${i / BATCH_SIZE + 1} insertado (${batch.length} filas)`);
        }
    }

    console.log('🎉 Migración completada con éxito.');
}

// CSV Parser Helper
function parseCSV(text: string) {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let insideQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
            // Handle escaped quotes "" -> "
            if (insideQuotes && nextChar === '"') {
                currentCell += '"';
                i++;
            } else {
                insideQuotes = !insideQuotes;
            }
        } else if (char === ',' && !insideQuotes) {
            currentRow.push(currentCell);
            currentCell = '';
        } else if ((char === '\r' || char === '\n') && !insideQuotes) {
            if (char === '\r' && nextChar === '\n') i++; // Skip \n in \r\n
            currentRow.push(currentCell);
            rows.push(currentRow);
            currentRow = [];
            currentCell = '';
        } else {
            currentCell += char;
        }
    }
    // Push last cell/row
    if (currentCell || currentRow.length > 0) {
        currentRow.push(currentCell);
        rows.push(currentRow);
    }
    return rows;
}

migrate();
