/**
 * Offline store (§13).
 *
 * The network is not there. Everything is written to IndexedDB first and uploaded later,
 * and the app is fully usable with the radio off from session open to session close.
 *
 * Three properties the schema is built around:
 *
 *   - **Durability.** A reading is persisted before the operator is told it was
 *     captured. A browser killed between those two moments must not lose the probe.
 *   - **Append-only.** Readings are immutable and keyed by a content hash. Nothing is
 *     ever edited, so there is nothing for a sync to conflict over (see sync.ts).
 *   - **Resumability.** Pattern progress is persisted on every transition, so reopening
 *     the app lands the operator on the point they were about to probe.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { QualityFlag } from '@harrow/shared';

import type { PointProgress } from './pattern.js';

export type OutboxState = 'PENDING' | 'IN_FLIGHT' | 'SENT' | 'FAILED';

export interface StoredSession {
  /** Client-generated, so a session can be opened with no network. */
  localId: string;
  /** Server id, once the session has been registered. Null until then. */
  remoteId: string | null;
  trackCode: string;
  surfaceType: 'DIRT' | 'TURF' | 'SYNTHETIC';
  date: string;
  samplingPattern: string;
  operatorRef: string;
  instrumentSerial: string;
  officialGoingLabel: string | null;
  /** §13 requires these at session level; Phase 6's latency model is useless without. */
  maintenanceLog: string | null;
  weatherNotes: string | null;
  notes: string | null;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  progress: PointProgress[];
}

export interface StoredReading {
  /** sha256 of the raw bytes plus identity. Primary key, and the idempotency token. */
  sourceHash: string;
  sessionLocalId: string;
  pointId: string;
  attempt: number;
  accepted: boolean;
  takenAt: string;
  surfaceType: 'DIRT' | 'TURF' | 'SYNTHETIC';
  pathSegment: 'RAIL' | 'MID' | 'OUTSIDE';
  latitude: number | null;
  longitude: number | null;
  gpsAccuracy: number | null;
  forceDepthCurve: ArrayBuffer;
  forceDepthSampleCount: number;
  driveRateProfile: ArrayBuffer;
  driveRateSampleCount: number;
  vwc: number | null;
  surfaceTempC: number | null;
  ambientTempC: number | null;
  humidity: number | null;
  qualityFlags: QualityFlag[];
  gateReasons: string[];
}

export interface OutboxEntry {
  sourceHash: string;
  sessionLocalId: string;
  state: OutboxState;
  attempts: number;
  lastError: string | null;
  queuedAt: string;
  nextAttemptAt: string;
}

interface HarrowDB extends DBSchema {
  sessions: { key: string; value: StoredSession; indexes: { status: string } };
  readings: {
    key: string;
    value: StoredReading;
    indexes: { sessionLocalId: string };
  };
  outbox: {
    key: string;
    value: OutboxEntry;
    indexes: { state: string; sessionLocalId: string };
  };
}

const DB_NAME = 'harrow-field';
const DB_VERSION = 1;

export async function openStore(name = DB_NAME): Promise<IDBPDatabase<HarrowDB>> {
  return openDB<HarrowDB>(name, DB_VERSION, {
    upgrade(db) {
      const sessions = db.createObjectStore('sessions', { keyPath: 'localId' });
      sessions.createIndex('status', 'status');

      const readings = db.createObjectStore('readings', { keyPath: 'sourceHash' });
      readings.createIndex('sessionLocalId', 'sessionLocalId');

      const outbox = db.createObjectStore('outbox', { keyPath: 'sourceHash' });
      outbox.createIndex('state', 'state');
      outbox.createIndex('sessionLocalId', 'sessionLocalId');
    },
  });
}

export class Store {
  constructor(private readonly db: IDBPDatabase<HarrowDB>) {}

  static async open(name?: string): Promise<Store> {
    return new Store(await openStore(name));
  }

  close(): void {
    this.db.close();
  }

  async putSession(session: StoredSession): Promise<void> {
    await this.db.put('sessions', session);
  }

  async getSession(localId: string): Promise<StoredSession | undefined> {
    return this.db.get('sessions', localId);
  }

  async openSessions(): Promise<StoredSession[]> {
    return this.db.getAllFromIndex('sessions', 'status', 'OPEN');
  }

  async allSessions(): Promise<StoredSession[]> {
    return this.db.getAll('sessions');
  }

  /**
   * Persist a reading and queue it, in one transaction.
   *
   * Both stores or neither. A reading saved without an outbox entry would never sync;
   * an outbox entry without a reading would fail forever. Re-saving the same hash is a
   * no-op rather than an error, because a retry of an interrupted save is expected.
   */
  async saveReading(reading: StoredReading): Promise<{ stored: boolean }> {
    const tx = this.db.transaction(['readings', 'outbox'], 'readwrite');
    const existing = await tx.objectStore('readings').get(reading.sourceHash);
    if (existing) {
      await tx.done;
      return { stored: false };
    }
    await tx.objectStore('readings').put(reading);
    await tx.objectStore('outbox').put({
      sourceHash: reading.sourceHash,
      sessionLocalId: reading.sessionLocalId,
      state: 'PENDING',
      attempts: 0,
      lastError: null,
      queuedAt: new Date().toISOString(),
      nextAttemptAt: new Date().toISOString(),
    });
    await tx.done;
    return { stored: true };
  }

  async readingsFor(sessionLocalId: string): Promise<StoredReading[]> {
    return this.db.getAllFromIndex('readings', 'sessionLocalId', sessionLocalId);
  }

  async getReading(sourceHash: string): Promise<StoredReading | undefined> {
    return this.db.get('readings', sourceHash);
  }

  /** Entries that are due for an attempt, oldest first. */
  async dueOutbox(now = new Date()): Promise<OutboxEntry[]> {
    const all = await this.db.getAll('outbox');
    return all
      .filter((e) => e.state !== 'SENT' && new Date(e.nextAttemptAt) <= now)
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }

  async putOutbox(entry: OutboxEntry): Promise<void> {
    await this.db.put('outbox', entry);
  }

  async outboxFor(sessionLocalId: string): Promise<OutboxEntry[]> {
    return this.db.getAllFromIndex('outbox', 'sessionLocalId', sessionLocalId);
  }

  async pendingCount(): Promise<number> {
    const all = await this.db.getAll('outbox');
    return all.filter((e) => e.state !== 'SENT').length;
  }

  /**
   * Integrity check over a session's stored data.
   *
   * Verifies that every reading has an outbox entry and vice versa, and that byte
   * lengths agree with the declared sample counts. Run before closing a session, so a
   * corrupt local store is discovered while the operator can still do something.
   */
  async verify(sessionLocalId: string): Promise<{ ok: boolean; problems: string[] }> {
    const problems: string[] = [];
    const readings = await this.readingsFor(sessionLocalId);
    const outbox = await this.outboxFor(sessionLocalId);
    const outboxHashes = new Set(outbox.map((e) => e.sourceHash));

    for (const r of readings) {
      if (!outboxHashes.has(r.sourceHash)) {
        problems.push(`reading ${r.sourceHash.slice(0, 8)} has no outbox entry`);
      }
      const expectedCurve = r.forceDepthSampleCount * 16;
      if (r.forceDepthCurve.byteLength !== expectedCurve) {
        problems.push(
          `reading ${r.sourceHash.slice(0, 8)}: curve is ${r.forceDepthCurve.byteLength} bytes, ` +
            `expected ${expectedCurve}`,
        );
      }
      const expectedDrive = r.driveRateSampleCount * 16;
      if (r.driveRateProfile.byteLength !== expectedDrive) {
        problems.push(
          `reading ${r.sourceHash.slice(0, 8)}: drive profile is ${r.driveRateProfile.byteLength} ` +
            `bytes, expected ${expectedDrive}`,
        );
      }
    }

    const readingHashes = new Set(readings.map((r) => r.sourceHash));
    for (const e of outbox) {
      if (!readingHashes.has(e.sourceHash)) {
        problems.push(`outbox entry ${e.sourceHash.slice(0, 8)} has no reading`);
      }
    }

    return { ok: problems.length === 0, problems };
  }
}
