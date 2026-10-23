import { describe, it, expect } from 'vitest';
import { createFaceEngine, createRuleChooser, faces } from '../src/index.js';
const clock = () => new Date('2026-10-23T12:00:10Z');
const previous = { face: 'small-dots', changedAt: '2026-10-23T12:00:00Z' };
const make = (result: { face: string; confidence?: number }) => createFaceEngine({
  faces, fallbackFace: 'small-dots', now: clock, chooser: { name: 'test', async choose() { return result; } },
});
describe('face decision policy', () => {
  it('supports custom catalogs and arbitrary domain state', async () => {
    const engine = createFaceEngine({
      faces: [{ id: 'hello', name: 'Hello', description: 'Greeting' }, { id: 'rest', name: 'Rest', description: 'Rest' }],
      fallbackFace: 'rest', chooser: createRuleChooser([{ when: s => s.visitors === 1, face: 'hello' }], 'rest'),
    });
    expect((await engine.decide({ visitors: 1, weather: { rain: false } })).face).toBe('hello');
  });
  it('holds the displayed face while retaining the candidate', async () => {
    expect(await make({ face: 'hearts', confidence: 0.9 }).decide({}, previous)).toMatchObject({
      face: 'small-dots', candidate: 'hearts', reason: 'minimum-hold', changedAt: previous.changedAt,
    });
  });
  it('accepts a change after the hold period', async () => {
    expect((await make({ face: 'hearts' }).decide({}, { ...previous, changedAt: '2026-10-23T11:59:00Z' })).face).toBe('hearts');
  });
  it('does not reset the hold clock on unchanged input', async () => {
    expect(await make({ face: 'small-dots' }).decide({}, previous)).toMatchObject({ reason: 'unchanged', changedAt: previous.changedAt });
  });
  it('retains the previous face for low confidence', async () => {
    expect(await make({ face: 'hearts', confidence: 0.1 }).decide({}, previous)).toMatchObject({ reason: 'low-confidence', face: 'small-dots' });
  });
  it('rejects an unknown model choice', async () => {
    expect(await make({ face: 'invented-face' }).decide({})).toMatchObject({ reason: 'provider-unavailable', face: 'small-dots' });
  });
  it('keeps the previous face on provider failure', async () => {
    const engine = createFaceEngine({ faces, fallbackFace: 'small-dots', now: clock, chooser: { name: 'failed', async choose() { throw new Error('offline'); } } });
    expect(await engine.decide({}, { ...previous, face: 'curious' })).toMatchObject({ face: 'curious', reason: 'provider-unavailable' });
  });
  it('ignores invalid previous timestamps and IDs', async () => {
    expect((await make({ face: 'hearts' }).decide({}, { face: 'small-dots', changedAt: 'bad-date' })).face).toBe('hearts');
    expect((await make({ face: 'hearts' }).decide({}, { face: 'missing', changedAt: previous.changedAt })).face).toBe('hearts');
  });
  it('rejects invalid catalogs and policy', () => {
    expect(() => createFaceEngine({ faces: [], fallbackFace: 'missing', chooser: createRuleChooser([], 'missing') })).toThrow();
  });
});
