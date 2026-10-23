import type { FaceChooser, State } from '../domain/types.js';
export interface FaceRule { when: (state: State) => boolean; face: string }
/** First matching rule wins. Rules report no statistical confidence. */
export function createRuleChooser(rules: readonly FaceRule[], fallbackFace: string): FaceChooser {
  return {
    name: 'rules',
    async choose(state) {
      return { face: rules.find(rule => rule.when(state))?.face ?? fallbackFace };
    },
  };
}
