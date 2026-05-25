const run = async () => {
  const r = await fetch('http://localhost:3000/api/projections/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storeId: '4b5e30f1-6a00-4946-8e20-83a522027b37', weekStart: '2026-05-19', days: 1 })
  });
  const d = await r.json();
  const day = d.meta?.dailyDetails?.[0];
  if (!day || !day.hourly_breakdown) { console.log('No projection data'); return; }

  console.log('MARTES 19-May Downey - Proyecciones por hora:');
  console.log('-'.repeat(60));

  let maxAm = 0, maxPm = 0;
  day.hourly_breakdown.forEach(h => {
    const hr = Number(h.hour);
    const s = Number(h.projected_sales || 0);
    if (hr >= 6 && hr < 17 && s > maxAm) maxAm = s;
    if (hr >= 17 && s > maxPm) maxPm = s;
  });

  day.hourly_breakdown.sort((a, b) => Number(a.hour) - Number(b.hour)).forEach(h => {
    const hr = Number(h.hour);
    const s = Number(h.projected_sales || 0);
    const isAm = hr >= 6 && hr < 17;
    const mx = isAm ? maxAm : maxPm;
    const intensity = mx > 0 ? s / mx : 0;
    const bar = '#'.repeat(Math.round(intensity * 20));
    const label = intensity >= 0.95 ? ' << MAX RUSH' : intensity >= 0.85 ? ' << RUSH' : intensity >= 0.70 ? ' << HIGH' : '';
    const ampm = hr >= 12 ? (hr > 12 ? hr - 12 : 12) + 'pm' : (hr || 12) + 'am';
    console.log(`  ${ampm.padStart(5)}  $${s.toFixed(0).padStart(6)}  ${bar.padEnd(22)} ${(intensity * 100).toFixed(0).padStart(3)}%${label}`);
  });
};
run().catch(e => console.log('ERR', e.message));
