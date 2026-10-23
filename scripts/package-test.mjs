import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const temp = await mkdtemp(join(tmpdir(), 'coreink-consumer-'));
try {
  // Already built by the caller: validate exactly what a consumer receives.
  const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], { encoding: 'utf8' }));
  const result = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
  for (const file of result.files) assert.ok(!/(^|\/)(\.dev\.vars|\.env|\.deployment-secrets|\.wrangler|node_modules|worker-configuration)|src\/cloudflare/.test(file.path), `Unexpected package file: ${file.path}`);
  const secretsPath = resolve('.deployment-secrets.json');
  let secrets = [];
  try { secrets = Object.values(JSON.parse(await readFile(secretsPath, 'utf8'))); } catch {}
  for (const file of result.files) {
    const bytes = await readFile(file.path);
    for (const secret of secrets) assert.ok(!bytes.includes(secret), `Secret in ${file.path}`);
  }
  await writeFile(join(temp, 'package.json'), JSON.stringify({ type: 'module', private: true }));
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', join(temp, result.filename)], { cwd: temp, stdio: 'pipe' });
  const metadata = JSON.parse(await readFile(join(temp, 'node_modules/coreink-face/package.json'), 'utf8'));
  assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0);
  await writeFile(join(temp, 'consumer.mjs'), `
    import assert from 'node:assert/strict';
    import { readFile } from 'node:fs/promises';
    import { createFace } from 'coreink-face';
    import { createClient } from 'coreink-face/client';
    import { createJevChooser } from 'coreink-face/jev';
    const frame = await createFace().render({ face: 'hearts', message: 'Hello 🌱' });
    assert.equal(frame.face, 'hearts');
    assert.equal(frame.message, 'Hello 🌱');
    assert.equal(typeof createClient, 'function');
    assert.equal(typeof createJevChooser, 'function');
    assert.match(await readFile(new URL(import.meta.resolve('coreink-face/assets/hearts.svg')), 'utf8'), /<svg/);
    const contract = JSON.parse(await readFile(new URL(import.meta.resolve('coreink-face/openapi.json')), 'utf8'));
    assert.ok(contract.paths['/v1/render']);
  `);
  execFileSync(process.execPath, ['consumer.mjs'], { cwd: temp, stdio: 'inherit' });
  await writeFile(join(temp, 'consumer.ts'), `
    import { createFace, type FaceFrame } from 'coreink-face';
    import { createClient } from 'coreink-face/client';
    const renderer = createFace();
    interface Weather { temperature: number; raining: boolean }
    const weather: Weather = { temperature: 18, raining: true };
    await renderer.render({ state: weather });
    const frame: FaceFrame = await renderer.render({ face: 'hearts', message: 'Hello' });
    // @ts-expect-error Default face IDs are checked at compile time.
    renderer.render({ face: 'does-not-exist' });
    const custom = createFace({ faces: [{ id: 'wave', name: 'Wave', description: 'Greeting' }] });
    const result = await custom.render({ face: 'wave' });
    const inferred: 'wave' = result.face;
    // @ts-expect-error Custom catalogs infer their own IDs.
    custom.render({ face: 'hearts' });
    const api = createClient({ baseUrl: 'https://example.com', token: 'test' });
    const read = await api.device('pebble').read();
    if (read.status === 'modified') console.log(read.display.face);
    console.log(frame, inferred);
  `);
  await writeFile(join(temp, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, types: [], lib: ['ES2022', 'DOM'] }, include: ['consumer.ts'] }));
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', join(temp, 'tsconfig.json')], { stdio: 'inherit' });
  console.log(`Package consumer checks passed: ${result.files.length} files, ${result.size} packed bytes, no runtime dependencies; ESM imports, types, custom catalog inference, assets, and contract work outside the repo.`);
} finally { await rm(temp, { recursive: true, force: true }); }
