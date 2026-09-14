/**
 * AI SENSE temporary storage client (PRD §4).
 *
 * Endpoint: https://aisenseapi.com/services/v1/storage (unauthenticated).
 *   POST            → { storage_id, expire_timestamp, expire_datetime }
 *   GET /{storage_id} → the stored JSON object (404 {"error":"Storage id unknown"})
 *
 * Objects expire after 24h. ANYONE holding the UUID can read the object, so:
 *   - the storage_id is treated as an unguessable, sensitive capability;
 *   - we store ONLY the minimum OTP state, with the OTP HASHED (never the code);
 *   - records carry their own 10-minute logical expiry and are refused after it.
 *
 * AI SENSE documented limits: 5,000 requests/IP/24h, no durability/SLA —
 * this is strictly TEMPORARY OTP state, never permanent app data.
 *
 * Calls are bounded (8s) and NEVER logged with their contents.
 */

const AISENSE_BASE = process.env.AISENSE_STORAGE_URL || 'https://aisenseapi.com/services/v1/storage';
const TIMEOUT_MS = 8000;

export class AiSenseError extends Error {
  constructor(
    message: string,
    public readonly code: 'timeout' | 'network' | 'bad_status' | 'bad_body' | 'not_found'
  ) {
    super(message);
    this.name = 'AiSenseError';
  }
}

export interface AiSensePutResult {
  storageId: string;
  expireTimestamp?: number;
}

/**
 * Store a JSON object. Returns the storage UUID.
 * The object must be small (an OTP record) — never put secrets or PII
 * beyond the hashed email/otp fields defined in lib/otp.ts.
 */
export async function put(object: Record<string, unknown>): Promise<AiSensePutResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(AISENSE_BASE, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(object),
    });
    if (!res.ok) {
      throw new AiSenseError(`AI SENSE store returned HTTP ${res.status}`, 'bad_status');
    }
    const data = (await res.json().catch(() => null)) as
      | { storage_id?: string; expire_timestamp?: number }
      | null;
    if (!data || typeof data.storage_id !== 'string' || !data.storage_id) {
      throw new AiSenseError('AI SENSE store returned no storage_id', 'bad_body');
    }
    return { storageId: data.storage_id, expireTimestamp: data.expire_timestamp };
  } catch (err) {
    if (err instanceof AiSenseError) throw err;
    if (err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message))) {
      throw new AiSenseError('AI SENSE store timed out', 'timeout');
    }
    throw new AiSenseError(
      `AI SENSE store network error: ${err instanceof Error ? err.message : String(err)}`,
      'network'
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retrieve an object by its storage UUID.
 * Throws AiSenseError('not_found') for unknown/expired ids.
 */
export async function get<T = Record<string, unknown>>(storageId: string): Promise<T> {
  // UUID shape guard — never interpolate arbitrary user input into a path.
  if (!/^[A-Za-z0-9-]{8,64}$/.test(storageId)) {
    throw new AiSenseError('Malformed storage id', 'not_found');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${AISENSE_BASE}/${encodeURIComponent(storageId)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (res.status === 404) {
      throw new AiSenseError('Storage id unknown (expired or never existed)', 'not_found');
    }
    if (!res.ok) {
      throw new AiSenseError(`AI SENSE fetch returned HTTP ${res.status}`, 'bad_status');
    }
    const data = (await res.json().catch(() => null)) as T | null;
    if (data === null || data === undefined) {
      throw new AiSenseError('AI SENSE fetch returned an unparseable body', 'bad_body');
    }
    return data;
  } catch (err) {
    if (err instanceof AiSenseError) throw err;
    if (err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message))) {
      throw new AiSenseError('AI SENSE fetch timed out', 'timeout');
    }
    throw new AiSenseError(
      `AI SENSE fetch network error: ${err instanceof Error ? err.message : String(err)}`,
      'network'
    );
  } finally {
    clearTimeout(timer);
  }
}
