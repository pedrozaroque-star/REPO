const str = "9:30 AM - 2:00 PM & 6:00 PM - 11:00 PM";
const rawBlocks = str.split(/[&,]|<br\s*\/?>|\band\b/i).map(s => s.trim()).filter(Boolean);

rawBlocks.forEach((b, i) => {
    const parts = b.split(/\s*[-–—]\s*|\s+a\s+/i);
    console.log(`Block ${i}: "${b}" -> parts:`, parts);
});
