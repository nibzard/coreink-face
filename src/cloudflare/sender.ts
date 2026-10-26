/** Informational metadata supplied by an authenticated writer, never an identity claim. */
export interface SenderMetadata {
  source: 'pebble-inbox';
  fingerprint: string | null;
  fingerprintDay: string | null;
  country: string | null;
  asn: number | null;
  browser: 'Chrome' | 'Firefox' | 'Safari' | 'Edge' | 'Other';
  device: 'mobile' | 'tablet' | 'desktop' | 'unknown';
}

/** Keep the forwarding contract bounded; do not accept arbitrary headers or raw identifiers. */
export function parseSenderMetadata(value: string | null): SenderMetadata | null {
  if (value === null) return null;
  if (value.length > 512) throw new Error('invalid_sender');
  const sender = JSON.parse(value);
  const keys = ['source', 'fingerprint', 'fingerprintDay', 'country', 'asn', 'browser', 'device'];
  if (!sender || typeof sender !== 'object' || Array.isArray(sender) ||
      Object.keys(sender).length !== keys.length || Object.keys(sender).some(key => !keys.includes(key)) ||
      sender.source !== 'pebble-inbox' ||
      !(sender.fingerprint === null ? sender.fingerprintDay === null :
        typeof sender.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(sender.fingerprint) &&
        typeof sender.fingerprintDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sender.fingerprintDay) &&
        new Date(sender.fingerprintDay).toISOString().slice(0, 10) === sender.fingerprintDay) ||
      !(sender.country === null || typeof sender.country === 'string' && /^[A-Z]{2}$/.test(sender.country)) ||
      !(sender.asn === null || Number.isSafeInteger(sender.asn) && sender.asn > 0 && sender.asn <= 4294967295) ||
      !['Chrome', 'Firefox', 'Safari', 'Edge', 'Other'].includes(sender.browser) ||
      !['mobile', 'tablet', 'desktop', 'unknown'].includes(sender.device)) throw new Error('invalid_sender');
  return sender;
}
