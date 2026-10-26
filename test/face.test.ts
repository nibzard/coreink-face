import { it, expect } from 'vitest';
import { createFace, FaceError, parseInput } from '../src/index.js';

it('renders a face and exact message without invoking a provider', async () => {
  const renderer = createFace({ chooser: { name: 'must-not-run', async choose() { throw new Error('Should not run'); } } });
  expect(await renderer.render({ face: 'hearts', message: 'Hello 🌱' })).toMatchObject({ face: 'hearts', message: 'Hello 🌱', selection: { source: 'explicit', reason: 'selected' } });
});
it('has useful keyless defaults and supports an arbitrary custom catalog', async () => {
  expect((await createFace().render({ message: 'Hello' })).face).toBe('small-dots');
  const renderer = createFace({ faces: [{ id: 'wave', name: 'Wave', description: 'Greeting' }] });
  expect((await renderer.render({ face: 'wave' })).face).toBe('wave');
});
it('preserves and clears previous messages while holding a face', async () => {
  const renderer = createFace({ now: () => new Date('2026-10-23T12:00:00Z') });
  const previous = await renderer.render({ face: 'hearts', message: 'Keep me' });
  const frame = await renderer.render({ face: 'stars' }, { previous });
  expect(frame).toMatchObject({ face: 'hearts', message: 'Keep me', selection: { candidate: 'stars', reason: 'minimum-hold' } });
  expect((await renderer.render({ message: '' }, { previous })).message).toBe('');
});
it('reports actionable input errors for JavaScript as well as TypeScript callers', async () => {
  await expect(createFace().render({ face: 'not-a-face' as 'hearts' })).rejects.toMatchObject({ code: 'unknown_face', issues: [{ path: '/face', message: expect.any(String) }] });
  for (const input of [{}, { message: 'x'.repeat(121) }, { message: '\t' }, { state: { value: Infinity } }, { caption: 'wrong field' }]) {
    expect(() => parseInput(input)).toThrow(FaceError);
  }
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  expect(() => parseInput({ state: cycle })).toThrow(FaceError);
  expect(() => parseInput({ state: { date: new Date() } })).toThrow(FaceError);
  expect(() => parseInput({ state: { large: 'x'.repeat(17_000) } })).toThrow(FaceError);
  expect(parseInput({ message: '🌱'.repeat(120) }).message).toHaveLength(240);
});
it('passes message to the chooser as data and never rewrites the display text', async () => {
  const renderer = createFace({ chooser: { name: 'test', async choose(state) { expect(state.message).toBe('Hello!'); return { face: 'hearts' }; } } });
  expect((await renderer.render({ state: { message: 'old' }, message: 'Hello!' })).message).toBe('Hello!');
});
it('offers strict provider failures and never disguises caller cancellation as a fallback', async () => {
  const renderer = createFace({ failureMode: 'throw', chooser: { name: 'broken', async choose() { throw new Error('offline'); } } });
  await expect(renderer.render({ state: {} })).rejects.toMatchObject({ code: 'provider_unavailable' });
  const controller = new AbortController();
  const cancelled = createFace({ chooser: { name: 'cancel', async choose(_state, _faces, options) { expect(options?.signal).toBe(controller.signal); controller.abort(); return { face: 'stars' }; } } });
  await expect(cancelled.render({ state: {} }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
});
it('rejects unpaired surrogates but preserves valid Unicode pairs', () => {
  for (const message of ['\ud800', '\udfff', 'a\ud800b', '\ud800'.repeat(120)]) {
    expect(() => parseInput({ message })).toThrow(FaceError);
  }
  expect(parseInput({ message: '🌱'.repeat(120) }).message).toBe('🌱'.repeat(120));
});
