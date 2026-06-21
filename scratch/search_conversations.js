const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain';
const keywords = [
  'pagina web',
  'landing page',
  'web publica',
  'public website',
  'sitio web',
  'expo',
  'react native',
  'app de tacos',
  'king taco',
  'kingtaco',
  'aplicacion movil'
];

async function search() {
  if (!fs.existsSync(brainDir)) {
    console.error('Brain directory does not exist:', brainDir);
    return;
  }

  const dirs = fs.readdirSync(brainDir);
  const results = [];

  for (const dir of dirs) {
    const dirPath = path.join(brainDir, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const transcriptPath = path.join(dirPath, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(transcriptPath)) continue;

    try {
      const content = fs.readFileSync(transcriptPath, 'utf8');
      const lines = content.split('\n');
      const matchedKeywords = new Set();
      const snippets = [];
      let title = '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          
          // Check user input or model output
          if (parsed.type === 'USER_INPUT' || parsed.type === 'PLANNER_RESPONSE' || parsed.type === 'STEP') {
            const text = parsed.content || '';
            const lowerText = text.toLowerCase();
            
            let foundInLine = false;
            for (const kw of keywords) {
              if (lowerText.includes(kw.toLowerCase())) {
                matchedKeywords.add(kw);
                foundInLine = true;
              }
            }

            if (foundInLine && snippets.length < 5) {
              // Extract a clean snippet
              const cleanText = text.replace(/[\r\n]+/g, ' ').substring(0, 150);
              snippets.push(`${parsed.source || 'AGENT'}: "${cleanText}..."`);
            }
          }

          if (parsed.type === 'CONVERSATION_TITLE') {
            title = parsed.content || '';
          }
          if (parsed.title) {
            title = parsed.title;
          }
        } catch (e) {
          // ignore
        }
      }

      if (matchedKeywords.size >= 2) {
        results.push({
          id: dir,
          matchesCount: matchedKeywords.size,
          matches: Array.from(matchedKeywords),
          title: title || 'Untitled',
          snippets: snippets
        });
      }
    } catch (err) {
      // ignore
    }
  }

  // Sort by matches count descending
  results.sort((a, b) => b.matchesCount - a.matchesCount);

  console.log(`\nFound ${results.length} highly relevant conversations:\n`);
  results.slice(0, 15).forEach(r => {
    console.log(`ID: ${r.id}`);
    console.log(`Title: ${r.title}`);
    console.log(`Matches (${r.matchesCount}): ${r.matches.join(', ')}`);
    console.log('Snippets:');
    r.snippets.forEach(s => console.log(`  - ${s}`));
    console.log('='.repeat(80));
  });
}

search();
