import { faces as defaultFaces } from '../domain/catalog.js';
import { FaceError } from '../domain/errors.js';
import { parseInput, type RenderInput } from '../domain/input.js';
import { toFrame, type FaceFrame } from '../domain/frame.js';
import type { Face, FaceChooser } from '../domain/types.js';
import { createFaceEngine, type EngineOptions } from './face-engine.js';
export interface FaceOptions<Catalog extends readonly Face[]> {
  faces?: Catalog;
  fallbackFace?: Catalog[number]['id'];
  chooser?: FaceChooser;
  minimumHoldMs?: number;
  minimumConfidence?: number;
  failureMode?: EngineOptions['failureMode'];
  now?: () => Date;
}
export interface RenderOptions<Id extends string = string> {
  previous?: FaceFrame<Id>;
  signal?: AbortSignal;
}
/** No key, network, storage, or environment lookup is needed for explicit faces. */
export function createFace<const Catalog extends readonly Face[] = typeof defaultFaces>(options: FaceOptions<Catalog> = {}) {
  type Id = Catalog[number]['id'];
  const catalog: readonly Face[] = Object.freeze((options.faces ?? defaultFaces).map(face => Object.freeze({ ...face })));
  const fallback = options.fallbackFace ?? (options.faces ? catalog[0]?.id : 'small-dots');
  if (!fallback) throw new FaceError('invalid_configuration', 'Provide at least one face.');
  const neutral: FaceChooser = { name: 'neutral', async choose() { return { face: fallback }; } };
  const base = { ...options, faces: catalog, fallbackFace: fallback, chooser: options.chooser ?? neutral };
  const engine = createFaceEngine(base);
  return {
    faces: catalog,
    async render<Context extends object>(input: RenderInput<Id, Context>, renderOptions: RenderOptions<Id> = {}): Promise<FaceFrame<Id>> {
      renderOptions.signal?.throwIfAborted();
      const parsed = parseInput(input);
      if (parsed.face !== undefined && !catalog.some(face => face.id === parsed.face)) {
        throw new FaceError('unknown_face', `Unknown face "${parsed.face}". Choose an ID from the catalog.`, [{ path: '/face', message: 'Face is not in this catalog.' }]);
      }
      const selectedEngine = parsed.face === undefined ? engine : createFaceEngine({
        ...base, chooser: { name: 'explicit', async choose() { return { face: parsed.face! }; } },
      });
      const state = parsed.state ?? {};
      const previous = renderOptions.previous;
      const decision = await selectedEngine.decide(parsed.message === undefined ? state : { ...state, message: parsed.message }, previous, { signal: renderOptions.signal });
      // The engine validates both IDs against the configured catalog before returning.
      return toFrame(decision, parsed.message ?? previous?.message ?? '') as FaceFrame<Id>;
    },
  };
}
