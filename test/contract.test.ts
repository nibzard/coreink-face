import { it, expect } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { openapi } from '../src/openapi.js';
import { createFace, parseInput } from '../src/index.js';
import { parseSenderMetadata } from '../src/cloudflare/sender.js';

it('compiles public JSON schemas and validates actual library frames', async () => {
  const ajv = new Ajv2020({ strict: false });
  ajv.addFormat('date-time', { type: 'string', validate: value => Number.isFinite(Date.parse(value)) });
  ajv.addSchema({ $id: 'contract', components: openapi.components });
  for (const name of Object.keys(openapi.components.schemas)) {
    expect(ajv.getSchema(`contract#/components/schemas/${name}`)).toBeTypeOf('function');
  }
  const validate = ajv.getSchema('contract#/components/schemas/FaceFrame')!;
  expect(validate(await createFace().render({ face: 'hearts', message: 'Hello' }))).toBe(true);
});
it('keeps sender metadata schema consistent with runtime validation', () => {
  const ajv = new Ajv2020({ strict: false });
  ajv.addFormat('date', { type: 'string', validate: value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value });
  const validate = ajv.compile(openapi.components.schemas.SenderMetadata);
  const sender = { source: 'pebble-inbox', fingerprint: 'a'.repeat(64), fingerprintDay: '2026-10-26', country: 'HR', asn: 13335, browser: 'Firefox', device: 'desktop' };
  for (const input of [sender, { ...sender, fingerprint: null, fingerprintDay: null },
    { ...sender, fingerprint: null }, { ...sender, fingerprintDay: '2026-02-31' },
    { ...sender, ip: '192.0.2.1' }, { ...sender, asn: -1 }, { ...sender, country: 'Croatia' }]) {
    let accepted = true;
    try { parseSenderMetadata(JSON.stringify(input)); } catch { accepted = false; }
    expect(validate(input)).toBe(accepted);
  }
});
it('keeps the documented input constraints consistent with runtime validation', () => {
  const ajv = new Ajv2020({ strict: false });
  const validate = ajv.compile(openapi.components.schemas.RenderInput);
  for (const input of [{ face: 'hearts' }, { message: '' }, { state: {} }, { message: '🌱'.repeat(120) }, {}, { message: 'x'.repeat(121) }, { message: '\t' }, { extra: true }, { state: [] }, { face: '../x' }]) {
    let accepted = true;
    try { parseInput(input); } catch { accepted = false; }
    expect(validate(input), JSON.stringify(input)).toBe(accepted);
  }
});
