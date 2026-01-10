const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

async function migrate() {
    console.log('🚀 Iniciando Migración...');

    // Config
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (!fs.existsSync(envPath)) {
        console.error('❌ .env.local not found');
        return;
    }

    const envContent = fs.readFileSync(envPath, 'utf8');
    const env = {};
    envContent.split('\n').forEach(l => {
        const p = l.split('=');
        if (p.length >= 2) env[p[0].trim()] = p.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
    });

    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
        console.error('❌ Missing keys in .env.local');
        return;
    }

    const supabase = createClient(url, key);

    // CSV
    const csvPath = path.resolve(process.cwd(), 'feedback clientes.csv');
    if (!fs.existsSync(csvPath)) {
        console.error('❌ CSV not found');
        return;
    }
    // Handle BOM if present
    let raw = fs.readFileSync(csvPath, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) {
        raw = raw.slice(1);
    }

    const rows = parseCSV(raw);
    const headers = rows[0];
    const data = rows.slice(1);

    console.log(`📊 ${data.length} filas leídas.`);

    // Stores
    const { data: stores } = await supabase.from('stores').select('id,name');
    const storeMap = new Map();
    stores?.forEach(s => storeMap.set(s.name.replace(/Tacos Gavilan /i, '').trim().toLowerCase(), s.id));
    storeMap.set('lynwood', 14);
    storeMap.set('south gate', 15);
    storeMap.set('santa ana', 9);

    // Map
    const payload = data.map(r => {
        if (r.length < 5) return null;

        const g = (k) => {
            const i = headers.indexOf(k);
            return i > -1 ? (r[i] ? r[i].trim() : '') : '';
        };

        const storeName = g('Sucursal').toLowerCase();
        const sId = storeMap.get(storeName) || null;

        // Date
        let subDate = new Date().toISOString();
        let vDate = null;
        let vTime = null;

        const rd = g('Fecha'); // YYYY-MM-DD
        const rt = g('Hora'); // HH:MM

        if (rd && rd.match(/^\d{4}-\d{2}-\d{2}$/)) {
            vDate = rd;
            vTime = rt.length === 5 ? rt + ':00' : (rt.length === 8 ? rt : null);
            if (vTime) subDate = new Date(`${vDate}T${vTime}`).toISOString();
            else subDate = new Date(vDate).toISOString();
        } else if (g('Timestamp')) {
            try {
                subDate = new Date(g('Timestamp')).toISOString();
                vDate = subDate.split('T')[0];
            } catch (e) { }
        }

        // NPS
        const nps = parseInt(g('NPS(0-10)')) || 0;
        let cat = 'passive';
        if (nps >= 9) cat = 'promoter';
        else if (nps <= 6) cat = 'detractor';

        // Photos
        const ph = g('FotosURLs');
        const urls = ph ? ph.split(/[\n,]+/).map(u => u.trim()).filter(u => u.startsWith('http')) : [];

        // Status
        const st = g('Estatus').toLowerCase();
        let rs = 'pending';
        if (st.includes('cerrado') || st.includes('aprobado')) rs = 'approved';

        return {
            store_id: sId,
            submission_date: subDate,
            visit_date: vDate,
            visit_time: vTime,
            customer_name: g('ClienteNick') || 'Anónimo',
            language: g('Idioma') || 'es',
            service_rating: parseInt(g('Caja(1-5)')) || 0,
            food_quality_rating: parseInt(g('Calidad(1-5)')) || 0,
            cleanliness_rating: parseInt(g('Limpieza(1-5)')) || 0,
            speed_rating: parseInt(g('Entrega(1-5)')) || 0,
            nps_score: nps,
            nps_category: cat,
            comments: g('Comentarios'),
            photo_urls: urls,
            ticket_url: g('FolderURL'),
            original_report_id: g('ID'),
            review_status: rs,
            admin_observation: g('Reviso') ? `Revisado por: ${g('Reviso')}` : null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
    }).filter(x => x);

    console.log(`🗑️  Truncando tabla con ${payload.length} nuevos registros listos...`);
    const { error: delErr } = await supabase.from('customer_feedback').delete().neq('id', 0);
    if (delErr) console.error('Error delete:', delErr);

    console.log(`📥 Insertando...`);
    for (let i = 0; i < payload.length; i += 50) {
        const { error } = await supabase.from('customer_feedback').insert(payload.slice(i, i + 50));
        if (error) console.error(error);
        else console.log(`✅ Batch ${Math.floor(i / 50) + 1} OK`);
    }
    console.log('🎉 Done.');
}

function parseCSV(text) {
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let insideQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];
        if (char === '"') {
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
            if (char === '\r' && nextChar === '\n') i++;
            currentRow.push(currentCell);
            rows.push(currentRow);
            currentRow = [];
            currentCell = '';
        } else {
            currentCell += char;
        }
    }
    if (currentCell || currentRow.length > 0) {
        currentRow.push(currentCell);
        rows.push(currentRow);
    }
    return rows;
}

migrate();
