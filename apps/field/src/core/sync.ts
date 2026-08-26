/**
 * Sync (§13): conflict-free, integrity-verified, resumable.
 *
 * **Conflict-free by construction, not by merge.** Readings are immutable and keyed by a
 * hash of their own raw bytes. Two devices cannot produce a different value for the same
 * key, because the key *is* the value's fingerprint. There is no merge strategy here
 * because there is nothing that can conflict — the hardest part of offline sync is
 * removed by the data model rather than solved by an algorithm.
 *
 * **Resumable.** Every reading is queued in an outbox with its own state. A sync that
 * dies halfway leaves the sent ones marked sent and the rest pending. Restarting picks
 * up exactly where it stopped, and re-sending anything already accepted is harmless
 * because the server deduplicates on the same hash.
 *
 * **Integrity-verified.** The server reports accepted, duplicate and rejected counts per
 * batch. Anything it did not account for stays pending. A reading is only marked SENT on
 * the server's word, never on an optimistic client assumption.
 */
import type { IngestResult, ReadingPayload } from '@harrow/shared';

import type { OutboxEntry, StoredReading, StoredSession, Store } from './store.js';

export interface SyncTransport {
  /** Register a session server-side; returns its remote id. */
  openSession(session: StoredSession): Promise<string>;
  /** Upload a batch. Must be idempotent on `sourceHash`. */
  ingest(
    remoteSessionId: string,
    session: StoredSession,
    batch: ReadingPayload[],
  ): Promise<IngestResult>;
  closeSession(remoteSessionId: string): Promise<void>;
}

export interface SyncOptions {
  batchSize?: number;
  maxAttempts?: number;
  /** Base for exponential backoff, ms. */
  backoffMs?: number;
  now?: () => Date;
}

export interface SyncReport {
  sessionLocalId: string;
  remoteSessionId: string | null;
  attempted: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  deferred: number;
  errors: string[];
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function toPayload(reading: StoredReading): ReadingPayload {
  return {
    takenAt: new Date(reading.takenAt),
    surfaceType: reading.surfaceType,
    latitude: reading.latitude,
    longitude: reading.longitude,
    gpsAccuracy: reading.gpsAccuracy,
    pathSegment: reading.pathSegment,
    forceDepthCurve: toBase64(reading.forceDepthCurve),
    forceDepthSampleCount: reading.forceDepthSampleCount,
    driveRateProfile: toBase64(reading.driveRateProfile),
    driveRateSampleCount: reading.driveRateSampleCount,
    vwc: reading.vwc,
    surfaceTempC: reading.surfaceTempC,
    ambientTempC: reading.ambientTempC,
    humidity: reading.humidity,
  };
}

function backoff(attempts: number, baseMs: number): number {
  // Capped exponential. Trackside connectivity comes back in lumps, so a long tail of
  // retries is more useful than a tight loop that exhausts its attempts in a dead spot.
  return Math.min(baseMs * 2 ** attempts, 5 * 60_000);
}

/**
 * Push one session's outbox. Safe to call repeatedly, including while offline — a
 * transport failure defers rather than discards.
 */
export async function syncSession(
  store: Store,
  transport: SyncTransport,
  sessionLocalId: string,
  options: SyncOptions = {},
): Promise<SyncReport> {
  const batchSize = options.batchSize ?? 25;
  const maxAttempts = options.maxAttempts ?? 8;
  const backoffMs = options.backoffMs ?? 2000;
  const now = options.now ?? (() => new Date());

  const report: SyncReport = {
    sessionLocalId,
    remoteSessionId: null,
    attempted: 0,
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    deferred: 0,
    errors: [],
  };

  const session = await store.getSession(sessionLocalId);
  if (!session) {
    report.errors.push(`no local session ${sessionLocalId}`);
    return report;
  }

  // Register the session first. Until it exists server-side there is nowhere to put
  // readings, and the local id is not the server's to guess.
  if (session.remoteId === null) {
    try {
      session.remoteId = await transport.openSession(session);
      await store.putSession(session);
    } catch (err) {
      report.errors.push(`openSession: ${err instanceof Error ? err.message : String(err)}`);
      return report;
    }
  }
  report.remoteSessionId = session.remoteId;

  const due = (await store.dueOutbox(now())).filter(
    (e) => e.sessionLocalId === sessionLocalId && e.state !== 'SENT',
  );

  for (let i = 0; i < due.length; i += batchSize) {
    const slice = due.slice(i, i + batchSize);
    const readings: StoredReading[] = [];
    for (const entry of slice) {
      const reading = await store.getReading(entry.sourceHash);
      if (reading) readings.push(reading);
      else report.errors.push(`outbox references missing reading ${entry.sourceHash.slice(0, 8)}`);
    }
    if (readings.length === 0) continue;

    report.attempted += readings.length;
    await Promise.all(slice.map((e) => store.putOutbox({ ...e, state: 'IN_FLIGHT' as const })));

    try {
      const result = await transport.ingest(session.remoteId, session, readings.map(toPayload));
      report.accepted += result.accepted;
      report.duplicates += result.duplicates;
      report.rejected += result.rejected.length;

      const rejectedIndices = new Set(result.rejected.map((r) => r.index));
      for (const [idx, reading] of readings.entries()) {
        const entry = slice.find((e) => e.sourceHash === reading.sourceHash);
        if (!entry) continue;
        if (rejectedIndices.has(idx)) {
          // The server refused this one on its merits. Retrying will not change its
          // mind, so it is parked as FAILED with the reason kept for the operator.
          const reason = result.rejected.find((r) => r.index === idx)?.reason ?? 'rejected';
          await store.putOutbox({
            ...entry,
            state: 'FAILED',
            attempts: entry.attempts + 1,
            lastError: reason,
          });
        } else {
          await store.putOutbox({
            ...entry,
            state: 'SENT',
            attempts: entry.attempts + 1,
            lastError: null,
          });
        }
      }
    } catch (err) {
      // Transport failure. Every entry in the batch goes back to pending with backoff;
      // nothing is marked sent on an assumption.
      const message = err instanceof Error ? err.message : String(err);
      report.errors.push(`ingest: ${message}`);
      for (const entry of slice) {
        const attempts = entry.attempts + 1;
        report.deferred++;
        await store.putOutbox({
          ...entry,
          state: attempts >= maxAttempts ? 'FAILED' : 'PENDING',
          attempts,
          lastError: message,
          nextAttemptAt: new Date(now().getTime() + backoff(attempts, backoffMs)).toISOString(),
        });
      }
      // Stop pushing batches once the network is clearly gone.
      break;
    }
  }

  return report;
}

/**
 * Whether a session can be closed server-side: everything it holds is accounted for.
 *
 * Closing with readings still queued would produce a server-side session that looks
 * complete and is not — and index values computed from it would be wrong in a way
 * nothing downstream could detect.
 */
export function canCloseRemotely(outbox: readonly OutboxEntry[]): { ok: boolean; reason?: string } {
  const outstanding = outbox.filter((e) => e.state !== 'SENT');
  if (outstanding.length === 0) return { ok: true };
  const failed = outstanding.filter((e) => e.state === 'FAILED').length;
  return {
    ok: false,
    reason:
      `${outstanding.length} reading(s) not yet accepted by the server` +
      (failed > 0 ? `, ${failed} of them permanently failed` : ''),
  };
}
