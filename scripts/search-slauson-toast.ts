import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { supabaseAdmin } from '../lib/supabase';

async function searchSlausonNamesInToast() {
  console.log('='.repeat(70));
  console.log('       BÚSQUEDA DE EMPLEADOS DE SLAUSON EN TOAST_EMPLOYEES       ');
  console.log('='.repeat(70));

  const namesToSearch = [
    'Abigail', 'Mendoza', 'Alberto', 'Romero', 'Alexander', 'Chiguil',
    'Alfonso', 'Alarcon', 'Arturo', 'Juarez', 'Brandon', 'Lopez',
    'Carlos', 'Roca', 'Daisy', 'Ramirez', 'Bautista', 'Felix', 'Reimundez',
    'Hector', 'Flores', 'Jennifer', 'Baltazar', 'Jesus', 'Ramos',
    'Juan', 'Hernandez', 'Justin', 'Rodriguez', 'Lorenzo', 'Marcos',
    'Maria', 'Moreno', 'Oscar', 'Tiguila', 'Rosalinda', 'Gutierrez',
    'Sandra', 'Gonon', 'Teresa', 'Gabarrete', 'Veronica', 'Osorio', 'William', 'Salgado'
  ];

  const { data: allEmps } = await supabaseAdmin
    .from('toast_employees')
    .select('id, first_name, last_name, email, wage_data, job_references, deleted, store_ids')
    .limit(3000);

  console.log(`Total Toast employees in DB: ${allEmps?.length || 0}`);

  for (const name of ['Romero', 'Alarcon', 'Chiguil', 'Mendoza', 'Tiguila', 'Osorio', 'Ramos', 'Reimundez', 'Gabarrete']) {
    const matches = (allEmps || []).filter(e => 
      e.first_name.toLowerCase().includes(name.toLowerCase()) || 
      e.last_name.toLowerCase().includes(name.toLowerCase())
    );
    console.log(`\nMatches for "${name}" (${matches.length}):`);
    for (const m of matches) {
      console.log(`  ${m.first_name} ${m.last_name} | Deleted: ${m.deleted} | Wage: ${JSON.stringify(m.wage_data)} | StoreIDs: ${JSON.stringify(m.store_ids)}`);
    }
  }
}

searchSlausonNamesInToast().catch(console.error);
