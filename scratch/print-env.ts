console.log('Printing system environment variables containing DB, URL, POSTGRES, SUPABASE, or KEY...');
for (const key of Object.keys(process.env)) {
  const upper = key.toUpperCase();
  if (upper.includes('DB') || upper.includes('URL') || upper.includes('POSTGRES') || upper.includes('SUPABASE') || upper.includes('KEY') || upper.includes('PASSWORD') || upper.includes('PWD')) {
    console.log(`${key}: ${process.env[key] ? 'FOUND (length=' + process.env[key]!.length + ')' : 'EMPTY'}`);
    if (upper.includes('URL') || upper.includes('PASSWORD') || upper.includes('DB') || upper.includes('CONN')) {
      console.log(`  Value: ${process.env[key]}`);
    }
  }
}
