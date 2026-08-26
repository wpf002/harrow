/**
 * Canonical hashing.
 *
 * Every published number must be reproducible (§2.1, §14). `inputsHash` is how a
 * consumer proves the number they hold came from the inputs we claim. That only works
 * if the hash is stable across processes, machines and key orderings — hence the
 * canonical JSON below rather than JSON.stringify on an object literal.
 */
import { createHash } from 'node:crypto';

export type Hashable = string | number | boolean | null | Hashable[] | { [k: string]: Hashable };

/** Deterministic JSON: object keys sorted, no whitespace, -0 normalised to 0. */
export function canonicalJson(value: Hashable): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`cannot hash non-finite number: ${value}`);
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k]!)}`).join(',')}}`;
}

export function sha256Hex(input: string | Uint8Array<ArrayBufferLike>): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Hash of a structured value. Key order and object identity do not affect the result. */
export function hashInputs(value: Hashable): string {
  return sha256Hex(canonicalJson(value));
}

/**
 * Hash of a raw reading payload, used to make ingest idempotent (§11).
 *
 * Includes the raw bytes and the identifying facts, and deliberately excludes anything
 * derived: re-ingesting the same capture after a derivation change must be recognised
 * as the same reading, not stored twice.
 */
export function hashRawReading(input: {
  instrumentSerial: string;
  takenAt: Date | string;
  forceDepthCurve: Uint8Array<ArrayBufferLike>;
  driveRateProfile: Uint8Array<ArrayBufferLike>;
}): string {
  const h = createHash('sha256');
  h.update(input.instrumentSerial);
  h.update(' ');
  h.update(typeof input.takenAt === 'string' ? input.takenAt : input.takenAt.toISOString());
  h.update(' ');
  h.update(input.forceDepthCurve);
  h.update(' ');
  h.update(input.driveRateProfile);
  return h.digest('hex');
}
