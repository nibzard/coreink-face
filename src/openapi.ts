import { limits } from './domain/input.js';
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const content = (name: string) => ({ 'application/json': { schema: ref(name) } });
const errorResponse = (description: string) => ({ description, content: content('Error') });
const errors = {
  '400': errorResponse('Invalid input; correct issues before retrying.'),
  '401': errorResponse('Missing or incorrect bearer token.'),
  '404': errorResponse('Device not initialized or route not found.'),
  '405': errorResponse('Wrong HTTP method. See Allow header.'),
  '409': errorResponse('A newer state update superseded this one. Read current state.'),
  '413': errorResponse('Input too large.'),
  '415': errorResponse('Content-Type must be application/json.'),
  '500': errorResponse('Internal failure; use requestId for diagnosis.'),
  '503': errorResponse('Provider configuration is missing or invalid.'),
};
const body = { required: true, content: { 'application/json': {
  schema: ref('RenderInput'), examples: {
    explicit: { value: { face: 'hearts', message: 'Hello!' } },
    inferred: { value: { state: { event: 'Found a shiny pebble' }, message: 'A little discovery.' } },
    clear: { value: { message: '' } },
  },
} } };
const etag = { ETag: { description: 'Opaque display revision validator. Return unchanged in If-None-Match.', schema: { type: 'string' } } };
export const openapi = {
  openapi: '3.1.1',
  info: { title: 'CoreInk Face API', version: '0.2.0', description: 'Domain-neutral face and message selection. No tool execution. Device tokens are deployment-wide readers; API tokens are writers.' },
  servers: [{ url: '/' }],
  security: [{ bearerAuth: [] }],
  paths: {
    '/health': { get: { operationId: 'health', security: [], responses: { '200': { description: 'Service is running.' } } } },
    '/v1/faces': { get: { operationId: 'listFaces', summary: 'Discover available faces', responses: { '200': { description: 'Catalog', content: content('Catalog') }, '401': errors['401'] } } },
    '/v1/render': { post: { operationId: 'renderFace', summary: 'Render a stateless frame (writer)', requestBody: body, responses: { '200': { description: 'Frame; inspect selection.reason for fallback.', content: content('FaceFrame') }, ...errors } } },
    '/v1/decide': { post: { deprecated: true, operationId: 'legacyDecide', requestBody: body, responses: { '200': { description: 'Legacy flattened decision plus message.', content: content('LegacyDecision') }, ...errors } } },
    '/v1/devices/{id}/state': { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' } }], put: { deprecated: true, operationId: 'legacyUpdateState', requestBody: body, responses: { '200': { description: 'Legacy snapshot.', content: content('LegacySnapshot') }, ...errors } } },
    '/v1/devices/{id}/face': { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' } }], get: { deprecated: true, operationId: 'legacyReadFace', parameters: [{ name: 'If-None-Match', in: 'header', schema: { type: 'string' } }], responses: { '200': { description: 'Legacy snapshot.', content: content('LegacySnapshot'), headers: etag }, '304': { description: 'Unchanged', headers: etag }, '401': errors['401'], '404': errors['404'] } } },
    '/v1/devices/{id}/messages': {
      parameters: [{name:'id',in:'path',required:true,schema:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,64}$'}}],
      post:{operationId:'enqueueMessage',summary:'Queue a display message (writer)',description:'FIFO by acceptance order. Classified once when enqueued; retained offline until acknowledged. At most 256 pending messages. Do not blindly retry a submission.',requestBody:body,responses:{'202':{description:'Durably queued',content:{'application/json':{schema:{type:'object',required:['queued','id'],properties:{queued:{const:true},id:{type:'integer',minimum:1}}}}}},...errors}},
    },
    '/v1/devices/{id}/display/ack': {
      parameters: [{name:'id',in:'path',required:true,schema:{type:'string'}}],
      post:{operationId:'acknowledgeDisplay',summary:'Acknowledge a completed device redraw (reader or writer)',description:'Send only after rendering or verifying identical pixels. Matching ACKs are idempotent. The next device-token display poll advances the queue.',requestBody:{required:true,content:{'application/json':{schema:{type:'object',additionalProperties:false,required:['revision'],properties:{revision:{type:'integer',minimum:0}}}}}},responses:{...errors,'204':{description:'Acknowledged; no body'},'409':{description:'Stale revision; poll again'}}},
    },
    '/v1/devices/{id}/display': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' } }],
      put: { operationId: 'updateDisplay', summary: 'Choose and persist a display (writer)', description: 'Omitted message preserves the previous text. Explicit face bypasses inference. Writes are not deduplicated; do not blindly retry.', requestBody: body, responses: { '200': { description: 'Current display', headers: etag, content: content('DeviceDisplay') }, ...errors } },
      get: { operationId: 'readDisplay', summary: 'Poll a display without inference (reader or writer)', description:'Device-token polls promote the next queued item only after the current item is acknowledged. Writer-token reads inspect without consuming. Return requiresAck revisions after completed rendering to POST display/ack.', parameters: [{ name: 'If-None-Match', in: 'header', schema: { type: 'string' } }], responses: { '200': { description: 'Current display', headers: etag, content: content('DeviceDisplay') }, '304': { description: 'Unchanged. No body.', headers: etag }, '401': errors['401'], '404': errors['404'] } },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'API_TOKEN for writers; DEVICE_TOKEN for read-only access to all devices.' } },
    schemas: {
      RenderInput: { type: 'object', additionalProperties: false, minProperties: 1, description: `At most ${limits.inputBytes} UTF-8 bytes. Undefined fields are omitted in JavaScript.`, properties: {
        face: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$', description: 'Exact catalog ID; skips the chooser.' },
        message: { type: 'string', maxLength: limits.messageCodePoints, pattern: '^[^\\u0000-\\u0009\\u000B-\\u001F\\u007F]*$', description: 'Exact display text. Omit to preserve, empty string to clear. Unicode code points, not grapheme clusters.' },
        state: { type: 'object', additionalProperties: true, description: 'JSON observations, max depth 32. Explicit message is also passed to the chooser as state.message.' },
      } },
      Face: { type: 'object', required: ['id', 'name', 'description'], properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' } } },
      Catalog: { type: 'object', required: ['faces'], properties: { faces: { type: 'array', items: ref('Face') } } },
      Selection: { type: 'object', required: ['candidate', 'source', 'reason'], properties: {
        candidate: { type: 'string' }, source: { type: 'string' }, reason: { enum: ['selected', 'unchanged', 'minimum-hold', 'low-confidence', 'provider-unavailable'] }, confidence: { type: 'number', minimum: 0, maximum: 1 },
      } },
      FaceFrame: { type: 'object', required: ['face', 'message', 'changedAt', 'decidedAt', 'selection'], properties: {
        face: { type: 'string' }, message: { type: 'string' }, changedAt: { type: 'string', format: 'date-time', description: 'Time the displayed face last changed.' }, decidedAt: { type: 'string', format: 'date-time' }, selection: ref('Selection'),
      } },
      DeviceDisplay: { allOf: [ref('FaceFrame'), { type: 'object', required: ['revision', 'nextPollSeconds'], properties: { revision: { type: 'integer', minimum: 0 }, nextPollSeconds: { type: 'number', exclusiveMinimum: 0 }, requiresAck:{type:'boolean',description:'Acknowledge this revision after completed rendering.'} } }] },
      LegacyDecision: { allOf: [ref('Selection'), { type: 'object', required: ['face', 'changedAt', 'decidedAt'], properties: { face: { type: 'string' }, changedAt: { type: 'string', format: 'date-time' }, decidedAt: { type: 'string', format: 'date-time' }, message: { type: 'string' } } }] },
      LegacySnapshot: { type: 'object', required: ['revision', 'decision', 'message', 'nextPollSeconds'], properties: { revision: { type: 'integer', minimum: 0 }, decision: ref('LegacyDecision'), message: { type: 'string' }, nextPollSeconds: { type: 'number', exclusiveMinimum: 0 }, requiresAck:{type:'boolean',description:'Acknowledge this revision after completed rendering.'} } },
      Error: { type: 'object', required: ['error', 'requestId', 'retryable'], properties: {
        error: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' }, retryable: { type: 'boolean' },
        issues: { type: 'array', items: { type: 'object', required: ['path', 'message'], properties: { path: { type: 'string', description: 'JSON pointer to the invalid field.' }, message: { type: 'string' } } } },
      } },
    },
  },
} as const;
