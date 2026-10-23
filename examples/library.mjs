import { createFaceEngine, createRuleChooser, createJevChooser, faces } from '../dist/index.js';

// Application-specific meaning stays outside the core library.
const rules = createRuleChooser([
  { when: state => state.event === 'found-treasure', face: 'stars' },
  { when: state => state.quietHours === true, face: 'sleepy' },
  { when: state => state.visitors > 0, face: 'hearts' },
], 'small-dots');

const chooser = process.env.TYPESAFE_API_KEY
  ? createJevChooser({ apiKey: process.env.TYPESAFE_API_KEY })
  : rules;
const companion = createFaceEngine({ faces, chooser, fallbackFace: 'small-dots' });
console.log(await companion.decide({ event: 'found-treasure', description: 'A tiny stone creature finds its first shiny pebble.' }));
