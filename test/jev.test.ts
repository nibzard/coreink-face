import { it, expect } from 'vitest';
import { createJevChooser, faces } from '../src/index.js';
import { readJson, BodyTooLarge } from '../src/adapters/bounded-json.js';
it('sends the documented Jev choice request and parses answers', async () => {
  const chooser = createJevChooser({ apiKey: 'test-only', fetch: async (url, init) => {
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    const body = JSON.parse(init!.body as string);
    expect(body.state).toEqual({ weather: 'sunny' });
    expect(body.questions.face.type).toBe('choice');
    expect(Object.keys(body.questions.face.criteria)).toHaveLength(35);
    return Response.json({ answers: { face: { type: 'choice', choice: 'hearts', confidence: 0.88 } } });
  } });
  expect(await chooser.choose({ weather: 'sunny' }, faces)).toEqual({ face: 'hearts', confidence: 0.88 });
});
it('rejects provider HTTP and malformed response errors', async () => {
  for (const response of [new Response('no', { status: 429 }), Response.json({ choices: {} }), Response.json({ answers: { face: { type: 'choice', choice: 'hearts', confidence: 2 } } })]) {
    await expect(createJevChooser({ apiKey: 'test', fetch: async () => response }).choose({}, faces)).rejects.toThrow();
  }
});
it('enforces body limits without trusting a Content-Length header', async () => {
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('123456')); controller.close(); } });
  await expect(readJson(stream, 5)).rejects.toBeInstanceOf(BodyTooLarge);
});
