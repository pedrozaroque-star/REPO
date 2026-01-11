require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Error: No se encontraron las variables NEXT_PUBLIC_SUPABASE_URL o KEY en .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkStorage() {
    console.log("Conectando a Supabase...");

    const { data: buckets, error } = await supabase.storage.listBuckets();

    if (error) {
        console.error("Error al listar buckets:", error.message);
        return;
    }

    console.log(`Encontrados ${buckets.length} buckets.`);

    let grandTotalSize = 0;

    for (const bucket of buckets) {
        console.log(`Escaneando bucket: ${bucket.name}... (Puede tardar si hay muchos archivos)`);

        // Función recursiva para escanear carpetas
        async function scanFolder(path = '') {
            let folderSize = 0;
            let count = 0;
            let page = 0;
            let pageSize = 100;
            let hasMore = true;

            // Loop para paginación (aunque list() tiene limites raros, 100 es seguro)
            // Nota: Supabase list() no siempre pagina bien en carpetas profundas, pero intentamos.
            const { data: items, error: listError } = await supabase.storage.from(bucket.name).list(path, {
                limit: 1000,
                offset: 0
            });

            if (listError) {
                console.error(`  Error leyendo ${path || 'root'}: ${listError.message}`);
                return { size: 0, count: 0 };
            }

            if (!items) return { size: 0, count: 0 };

            for (const item of items) {
                if (!item.id) {
                    // Es carpeta
                    const subPath = path ? `${path}/${item.name}` : item.name;
                    // console.log(`    Entrando a carpeta: ${subPath}`);
                    const subResult = await scanFolder(subPath);
                    folderSize += subResult.size;
                    count += subResult.count;
                } else {
                    // Es archivo
                    if (item.metadata && item.metadata.size) {
                        folderSize += item.metadata.size;
                        count++;
                    }
                }
            }
            return { size: folderSize, count };
        }

        const result = await scanFolder('');
        const mb = (result.size / (1024 * 1024)).toFixed(2);
        console.log(`  -> Bucket [${bucket.name}]: ${result.count} archivos, ${mb} MB`);
        grandTotalSize += result.size;
    }

    const totalMB = (grandTotalSize / (1024 * 1024)).toFixed(2);
    const totalGB = (grandTotalSize / (1024 * 1024 * 1024)).toFixed(3);

    console.log("==========================================");
    console.log(`ESPACIO TOTAL USADO: ${totalMB} MB`);
    console.log(`EQUIVALENTE: ${totalGB} GB`);
    console.log("==========================================");
}

checkStorage();
