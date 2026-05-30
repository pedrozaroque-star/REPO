const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://ywwwdcvgfculqmcfkihq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3d3dkY3ZnZmN1bHFtY2ZraWhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQyNDE4NiwiZXhwIjoyMDgyMDAwMTg2fQ.66P0FVgOuTV47tfSQ1r5FaFg8zSSwykw5DDIG33R_OA'
);

async function migrate() {
  console.log('=== FASE 1: Verificar columnas ===');
  
  const { data: testRow, error: testErr } = await supabase.from('operating_procedures').select('id, shift, overrides').limit(1);
  
  if (testErr && testErr.message.includes('shift')) {
    console.log('ERROR: Las columnas shift/overrides NO existen. Necesitas ejecutar este SQL en el SQL Editor de Supabase:');
    console.log("ALTER TABLE operating_procedures ADD COLUMN IF NOT EXISTS shift TEXT DEFAULT 'AMBOS';");
    console.log("ALTER TABLE operating_procedures ADD COLUMN IF NOT EXISTS overrides JSONB DEFAULT '{}'::jsonb;");
    process.exit(1);
  }
  
  console.log('Columnas OK');

  // Update shift values
  console.log('Actualizando shift para Apertura -> AM...');
  const { error: e1 } = await supabase.from('operating_procedures').update({ shift: 'AM' }).eq('shift_type', 'Apertura').eq('shift', 'AMBOS');
  console.log('Apertura->AM:', e1?.message || 'OK');
  const { error: e2 } = await supabase.from('operating_procedures').update({ shift: 'PM' }).eq('shift_type', 'Cierre').eq('shift', 'AMBOS');
  console.log('Cierre->PM:', e2?.message || 'OK');

  console.log('\n=== FASE 2: Migrar actividades de ROLES ===');
  const { data: rolesData } = await supabase.from('station_templates').select('data').eq('store_id', 'GLOBAL').eq('template_name', '__CONFIG_ACTIVITIES__').maybeSingle();
  const rolesActivities = rolesData?.data?.master_activities || [];
  console.log('ROLES tiene ' + rolesActivities.length + ' actividades');

  const { data: existingProcs } = await supabase.from('operating_procedures').select('activity');
  
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const stopWords = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'a', 'con', 'para', 'que', 'se', 'al', 'su', 'un', 'una', 'por']);
  const getKw = s => norm(s).split(' ').filter(w => w.length > 2 && !stopWords.has(w));
  const sim = (a, b) => { const ka = getKw(a), kb = getKw(b); if (!ka.length || !kb.length) return 0; let m = 0; for (const wa of ka) for (const wb of kb) { if (wa === wb || (wa.length > 4 && wb.length > 4 && (wa.includes(wb) || wb.includes(wa)))) { m++; break; } } return m / Math.max(ka.length, kb.length); };

  const toInsert = [];
  for (const role of rolesActivities) {
    let bestScore = 0;
    for (const proc of (existingProcs || [])) {
      const sc = sim(role.name, proc.activity);
      if (sc > bestScore) bestScore = sc;
    }
    if (bestScore < 0.45) {
      let shift_type = 'Regular';
      if (role.category === 'APERTURA') shift_type = 'Apertura';
      else if (role.category === 'CIERRE') shift_type = 'Cierre';

      let duration = null, start_time = null;
      if (role.startTime && role.endTime) {
        const [sh, sm] = role.startTime.split(':').map(Number);
        const [eh, em] = role.endTime.split(':').map(Number);
        let startMin = sh * 60 + sm, endMin = eh * 60 + em;
        if (endMin <= startMin) endMin += 24 * 60;
        duration = endMin - startMin;
        start_time = role.startTime + ':00';
      }

      toInsert.push({
        activity: role.name.trim(),
        shift_type, frequency: 'Diario', start_time,
        duration_minutes: duration, shift: role.shift || 'AMBOS',
        overrides: role.overrides || {}, role: null, description: null
      });
    }
  }

  console.log(toInsert.length + ' actividades nuevas a insertar');
  
  for (const item of toInsert) {
    const { error } = await supabase.from('operating_procedures').insert(item);
    if (error) console.log('  ERROR: ' + item.activity.substring(0, 60) + ': ' + error.message);
    else console.log('  OK: ' + item.activity.substring(0, 60));
  }

  const { data: finalData } = await supabase.from('operating_procedures').select('id');
  console.log('\nTotal actividades en operating_procedures: ' + (finalData?.length || 0));
}

migrate().catch(e => console.error('ERROR:', e.message));
