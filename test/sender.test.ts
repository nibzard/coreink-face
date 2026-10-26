import { it, expect } from 'vitest';
import { parseSenderMetadata } from '../src/cloudflare/sender.js';

const sender = { source: 'pebble-inbox', fingerprint: 'a'.repeat(64), fingerprintDay: '2026-10-26', country: 'HR', asn: 13335, browser: 'Firefox', device: 'desktop' };
it('accepts bounded writer-supplied diagnostics and missing legacy metadata', () => {
  expect(parseSenderMetadata(JSON.stringify(sender))).toEqual(sender);
  expect(parseSenderMetadata(null)).toBeNull();
  expect(parseSenderMetadata(JSON.stringify({ ...sender, fingerprint: null, fingerprintDay: null, country: null, asn: null }))).not.toBeNull();
});
it('rejects malformed metadata and raw connection fields', () => {
  for (const value of [[], {}, { ...sender, ip: '192.0.2.1' }, { ...sender, userAgent: 'raw' }, { ...sender, country: 'Croatia' },
    { ...sender, fingerprint: 'raw IP' }, { ...sender, fingerprintDay: '2026-02-31' }, { ...sender, fingerprint: null },
    { ...sender, asn: -1 }, { ...sender, browser: 'arbitrary unbounded text' }, { ...sender, device: 'raw' }]) {
    expect(() => parseSenderMetadata(JSON.stringify(value))).toThrow();
  }
  expect(() => parseSenderMetadata('x'.repeat(513))).toThrow();
  expect(() => parseSenderMetadata('{')).toThrow();
});
