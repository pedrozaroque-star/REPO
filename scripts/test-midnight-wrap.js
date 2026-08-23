function intervalToPercentages(startDec, endDec) {
    const minRuler = 4.0;
    const maxRuler = 24.0;
    const totalRuler = 20.0;

    let s = startDec;
    let e = endDec;
    if (e < s) {
        e += 24; // Crosses midnight
    }

    s = Math.max(minRuler, Math.min(maxRuler, s));
    e = Math.max(minRuler, Math.min(maxRuler, e));
    if (e <= s) e = s + 0.5;

    const left = ((s - minRuler) / totalRuler) * 100;
    const width = Math.max(3.5, ((e - s) / totalRuler) * 100);

    return {
        left: left.toFixed(1) + '%',
        width: width.toFixed(1) + '%'
    };
}

console.log('9:15 PM to 12:50 AM ->', intervalToPercentages(21.25, 0.833));
