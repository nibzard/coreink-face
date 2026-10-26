import { it, expect } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { openapi } from '../src/openapi.js';
import { createFace, parseInput } from '../src/index.js';

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
it('keeps the documented input constraints consistent with runtime validation', () => {
  const ajv = new Ajv2020({ strict: false });
  const validate = ajv.compile(openapi.components.schemas.RenderInput);
  for (const input of [{ face: 'hearts' }, { message: '' }, { state: {} }, { message: '🌱'.repeat(120) }, {}, { message: 'x'.repeat(121) }, { message: '\t' }, { message: '\ud800' }, { message: '\udfff' }, { extra: true }, { state: [] }, { face: '../x' }]) {
    let accepted = true;
    try { parseInput(input); } catch { accepted = false; }
    expect(validate(input), JSON.stringify(input)).toBe(accepted);
  }
});
