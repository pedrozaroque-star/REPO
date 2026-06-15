import fs from 'fs';
import readline from 'readline';
import path from 'path';

async function extractTranscript() {
    const logPath = 'C:\\Users\\pedro\\.gemini\\antigravity\\brain\\7f8d96b2-5c80-4156-a707-9b12d85ca4af\\.system_generated\\logs\\transcript.jsonl';
    const outputPath = 'scratch/transcript_summary.txt';

    const fileStream = fs.createReadStream(logPath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const outputStream = fs.createWriteStream(outputPath);

    console.log('Reading transcript...');

    for await (const line of rl) {
        if (!line.trim()) continue;
        try {
            const step = JSON.parse(line);
            const source = step.source;
            const type = step.type;
            const content = step.content;

            if (type === 'USER_INPUT') {
                outputStream.write(`\n=== USER INPUT (Step ${step.step_index}) ===\n`);
                outputStream.write(content + '\n');
            } else if (source === 'MODEL' && type === 'PLANNER_RESPONSE') {
                outputStream.write(`\n=== MODEL RESPONSE (Step ${step.step_index}) ===\n`);
                // limit model response length to keep it clean
                const trimmed = content.length > 500 ? content.substring(0, 500) + '...\n[TRUNCATED]' : content;
                outputStream.write(trimmed + '\n');
            }
        } catch (e) {
            // ignore malformed lines
        }
    }

    outputStream.end();
    console.log('Done! Summary written to', outputPath);
}

extractTranscript();
