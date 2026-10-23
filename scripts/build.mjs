import { rm, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await rm('dist', { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.lib.json'], { stdio: 'inherit' });
const { openapi } = await import('../dist/openapi.js');
const { agentGuide } = await import('../dist/agent-guide.js');
await mkdir('dist', { recursive: true });
await writeFile('dist/openapi.json', JSON.stringify(openapi, null, 2) + '\n');
await writeFile('dist/llms.txt', agentGuide);
