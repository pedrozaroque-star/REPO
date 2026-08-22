const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = 'https://tnqbytrwudtrtrthhffz.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRucWJ5dHJ3dWR0cnRydGhoZmZ6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODk1MzA4MSwiZXhwIjoyMDU0NTI5MDgxfQ.m_u6A_M5qjRsk09fQffoA508QxXW9Y0h_3Gk1Q2k9x8';

// Let's also check all git commits with exact dates and times in August
const { execSync } = require('child_process');
const gitLog = execSync('git log --since="2026-08-01" --format="%h | %ai | %s" --all --no-merges', { encoding: 'utf-8' });

console.log('═══════════════════════════════════════════════════════════════');
console.log('🔍 COMMITS EN AGOSTO 2026 CON HORAS EXACTAS (HORA LOCAL -0700):');
console.log('═══════════════════════════════════════════════════════════════');
console.log(gitLog);
