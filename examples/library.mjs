import { createFace, createRuleChooser } from 'coreink-face';
const companion = createFace({
  chooser: createRuleChooser([
    { when: state => state.event === 'found-treasure', face: 'stars' },
    { when: state => state.quietHours === true, face: 'sleepy' },
  ], 'small-dots'),
});
console.log(await companion.render({ state: { event: 'found-treasure' }, message: 'Look what I found.' }));
