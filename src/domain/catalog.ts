import type { Face } from './types.js';

export const faces = [
  {
    "id": "small-dots",
    "name": "Small dots",
    "description": "Neutral, calm, quietly present; default when no other expression fits."
  },
  {
    "id": "large-dots",
    "name": "Large dots",
    "description": "Attentive, open and interested."
  },
  {
    "id": "mixed-dots",
    "name": "Mixed dots",
    "description": "A small unexpected detail draws curiosity."
  },
  {
    "id": "squares",
    "name": "Squares",
    "description": "Orderly, precise, composed."
  },
  {
    "id": "triangles",
    "name": "Triangles",
    "description": "Alert and upbeat anticipation."
  },
  {
    "id": "vertical-lines",
    "name": "Vertical lines",
    "description": "Awake, listening closely."
  },
  {
    "id": "horizontal-lines",
    "name": "Horizontal lines",
    "description": "Reserved, unimpressed, waiting patiently."
  },
  {
    "id": "less-than",
    "name": "Less-than",
    "description": "Looking back or left; reflecting on something past."
  },
  {
    "id": "greater-than",
    "name": "Greater-than",
    "description": "Looking ahead or right; anticipating the next thing."
  },
  {
    "id": "chevrons-up",
    "name": "Chevrons up",
    "description": "Content, cheerful, quietly delighted."
  },
  {
    "id": "chevrons-down",
    "name": "Chevrons down",
    "description": "Relaxed, peaceful, satisfied."
  },
  {
    "id": "teardrops",
    "name": "Teardrops",
    "description": "Moved or wistful; a gentle emotional moment."
  },
  {
    "id": "stars",
    "name": "Stars",
    "description": "Wonder and admiration at something special."
  },
  {
    "id": "hearts",
    "name": "Hearts",
    "description": "Warmth, affection and appreciation."
  },
  {
    "id": "diamonds",
    "name": "Diamonds",
    "description": "Something precious or sparkling captures attention."
  },
  {
    "id": "crosses",
    "name": "Crosses",
    "description": "Overwhelmed or a fictional character feels knocked out."
  },
  {
    "id": "spirals",
    "name": "Spirals",
    "description": "Dizzy, overloaded or bewildered."
  },
  {
    "id": "zigzags",
    "name": "Zigzags",
    "description": "A burst of energy or excitement."
  },
  {
    "id": "halflets-top",
    "name": "Halflets (top)",
    "description": "A soft, pleased smile."
  },
  {
    "id": "halflets-bottom",
    "name": "Halflets (bottom)",
    "description": "Drowsy, resting with half-closed eyes."
  },
  {
    "id": "square-dots",
    "name": "Square dots",
    "description": "Minimal, focused and composed."
  },
  {
    "id": "dot-line-horizontal",
    "name": "Dot line (horizontal)",
    "description": "Processing several small things in a sequence."
  },
  {
    "id": "dot-line-vertical",
    "name": "Dot line (vertical)",
    "description": "Pausing, contemplating or loading."
  },
  {
    "id": "one-eye-large-one-small",
    "name": "One eye large / one small",
    "description": "Intrigued by something unusual or surprising."
  },
  {
    "id": "wink",
    "name": "Wink (line + dot)",
    "description": "A friendly wink or shared joke."
  },
  {
    "id": "mischief",
    "name": "Mischief",
    "description": "A harmless cheeky plan or playful mischief."
  },
  {
    "id": "sleepy",
    "name": "Sleepy",
    "description": "Quiet time, sleepy or ready to rest."
  },
  {
    "id": "surprised",
    "name": "Surprised",
    "description": "A sudden surprise, wide-eyed astonishment."
  },
  {
    "id": "angry",
    "name": "Angry",
    "description": "Frustration or an obstacle; use sparingly."
  },
  {
    "id": "curious",
    "name": "Curious",
    "description": "Investigating, asking a question, curious uncertainty."
  },
  {
    "id": "playful",
    "name": "Playful",
    "description": "Playfulness, fun or a lighthearted game."
  },
  {
    "id": "determined",
    "name": "Determined",
    "description": "Concentrating with resolve on an ongoing task."
  },
  {
    "id": "confused",
    "name": "Confused",
    "description": "Unclear information, a puzzle or uncertainty."
  },
  {
    "id": "lovestruck",
    "name": "Lovestruck",
    "description": "Delighted affection with a playful spark."
  },
  {
    "id": "excited",
    "name": "Excited",
    "description": "Enthusiastic about good news or a new possibility."
  }
] as const satisfies readonly Face[];

export type FaceId = typeof faces[number]['id'];
