import fs from 'fs';
import path from 'path';

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
  console.log('Searching past conversations for app and website details...');
  if (!fs.existsSync(brainDir)) {
    console.error('Brain directory does not exist:', brainDir);
    return;
  }

  const dirs = fs.readdirSync(brainDir);
  const results: { id: string; matches: string[]; title?: string }[] = [];

  for (const dir of dirs) {
    const dirPath = path.join(brainDir, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    // Look for transcript.jsonl
    const transcriptPath = path.join(dirPath, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(transcriptPath)) continue;

    try {
      const content = fs.readFileSync(transcriptPath, 'utf8');
      const lines = content.split('\n');
      const matchedKeywords = new Set<string>();

      // Also try to find a title from the logs
      let title = '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          
          // Check if this line is user input or text that matches keywords
          const text = JSON.stringify(parsed).toLowerCase();
          for (const kw of keywords) {
            if (text.includes(kw.toLowerCase())) {
              matchedKeywords.add(kw);
            }
          }

          // Try to extract title from conversation metadata if present
          if (parsed.type === 'CONVERSATION_TITLE' || parsed.title) {
            title = parsed.title || parsed.content;
          }
        } catch (e) {
          // ignore parsing error for individual lines
        }
      }

      if (matchedKeywords.size > 0) {
        results.push({
          id: dir,
          matches: Array.from(matchedKeywords),
          title: title || 'Untitled'
        });
      }
    } catch (err) {
      // console.error(`Error reading ${dir}:`, err);
    }
  }

  console.log(`\nFound ${results.length} conversations with matching keywords:\n`);
  results.forEach(r => {
    console.log(`ID: ${r.id}`);
    console.log(`Title: ${r.title}`);
    console.log(`Matched Keywords: ${r.matches.join(', ')}`);
    console.log('-'.repeat(40));
  });
}

search();
