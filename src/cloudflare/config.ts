import { createFace } from '../application/create-face.js';
import { createJevChooser } from '../adapters/jev-chooser.js';
import { createRuleChooser } from '../adapters/rule-chooser.js';
import { faces } from '../domain/catalog.js';
export type AppEnv = Env & { API_TOKEN?: string; DEVICE_TOKEN?: string; TYPESAFE_API_KEY?: string };
/** Configure integrations here. Explicit face inputs always bypass the provider. */
export function renderer(env: AppEnv) {
  const chooser = (env.FACE_PROVIDER === 'jev' || (env.FACE_PROVIDER === 'auto' && !!env.TYPESAFE_API_KEY))
    ? createJevChooser({ apiKey: env.TYPESAFE_API_KEY ?? '', model: env.JEV_MODEL })
    : createRuleChooser(faces.map(face => ({ face: face.id, when: state => state.expression === face.id })), 'small-dots');
  return createFace({ faces: faces as readonly import('../domain/types.js').Face[], chooser });
}
