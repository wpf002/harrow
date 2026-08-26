/**
 * Phase 7 exit condition: a full track session captured start to finish, offline,
 * synced clean.
 *
 * The transport here fails for the whole capture phase — the network is simply not
 * there, which is the normal case at 07:00 on a racecourse — and only comes back
 * afterwards. Nothing in the capture path is allowed to care.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import type { IngestResult, ReadingPayload } from '@harrow/shared';

import { capture, CaptureBlocked, preflight } from './capture.js';
import { GOOD_FIX, POOR_FIX, layeredCurve, raggedDrive, steadyDrive } from './fixtures.js';
import { getPattern, PatternRun } from './pattern.js';
import { Store, type StoredSession } from './store.js';
import { canCloseRemotely, syncSession, type SyncTransport } from './sync.js';

const pattern = getPattern('grid_20pt_3segment_v1');

function newSession(localId: string): StoredSession {
  return {
    localId,
    remoteId: null,
    trackCode: 'ASC',
    surfaceType: 'TURF',
    date: '2026-07-01',
    samplingPattern: pattern.name,
    operatorRef: 'OP-001',
    instrumentSerial: 'HR-0001',
    officialGoingLabel: 'GOOD',
    maintenanceLog: 'harrowed 06:00, 8 mm overnight rain',
    weatherNotes: 'overcast, 14 C, light SW',
    notes: null,
    status: 'OPEN',
    openedAt: '2026-07-01T06:45:00.000Z',
    closedAt: null,
    progress: new PatternRun(pattern).snapshot(),
  };
}

/** Records what it was asked to do, and can be told to be offline. */
class FakeTransport implements SyncTransport {
  online = true;
  seen = new Set<string>();
  batches: ReadingPayload[][] = [];
  openCalls = 0;
  rejectAtIndex: number | null = null;
  /** Go offline after this many successful batches — a signal drop mid-sync. */
  failAfterBatches: number | null = null;

  async openSession(): Promise<string> {
    if (!this.online) throw new Error('offline');
    this.openCalls++;
    return 'remote-session-1';
  }

  async ingest(_id: string, _s: StoredSession, batch: ReadingPayload[]): Promise<IngestResult> {
    if (!this.online) throw new Error('offline');
    if (this.failAfterBatches !== null && this.batches.length >= this.failAfterBatches) {
      this.online = false;
      throw new Error('offline');
    }
    this.batches.push(batch);
    let accepted = 0;
    let duplicates = 0;
    const rejected: IngestResult['rejected'] = [];
    for (const [i, r] of batch.entries()) {
      if (this.rejectAtIndex === i) {
        rejected.push({ index: i, reason: 'malformed' });
        continue;
      }
      const key = `${r.takenAt.toISOString()}|${r.forceDepthCurve.slice(0, 32)}`;
      if (this.seen.has(key)) duplicates++;
      else {
        this.seen.add(key);
        accepted++;
      }
    }
    return { accepted, duplicates, rejected };
  }

  async closeSession(): Promise<void> {
    if (!this.online) throw new Error('offline');
  }
}

let store: Store;
let dbCounter = 0;

beforeEach(async () => {
  store = await Store.open(`harrow-field-test-${dbCounter++}`);
});

describe('a full session, captured with no network', () => {
  test('21 points, offline throughout, then a clean sync', async () => {
    const transport = new FakeTransport();
    transport.online = false;

    const session = newSession('s1');
    await store.putSession(session);
    const run = new PatternRun(pattern, session.progress);

    // Capture the whole card with the radio off.
    let t = Date.parse('2026-07-01T07:00:00Z');
    while (!run.complete) {
      const point = run.next();
      expect(point).not.toBeNull();
      t += 90_000;
      const outcome = await capture(store, session, run, point!.point.id, {
        curve: layeredCurve(58 + (point!.point.index % 5) * 2),
        drive: steadyDrive(),
        fix: GOOD_FIX,
        takenAt: new Date(t),
        vwc: 0.24,
        surfaceTempC: 15,
      });
      expect(outcome.accepted).toBe(true);
    }

    expect(run.captured).toBe(21);
    expect(run.readyToClose().ok).toBe(true);
    expect(await store.pendingCount()).toBe(21);

    // Local integrity holds before anything has been uploaded.
    expect(await store.verify('s1')).toEqual({ ok: true, problems: [] });

    // A sync attempt while still offline must change nothing but the retry schedule.
    const offlineReport = await syncSession(store, transport, 's1');
    expect(offlineReport.accepted).toBe(0);
    expect(offlineReport.errors.join(' ')).toMatch(/offline/);
    expect(await store.pendingCount()).toBe(21);

    // Back in signal.
    transport.online = true;
    const report = await syncSession(store, transport, 's1');
    expect(report.accepted).toBe(21);
    expect(report.rejected).toBe(0);
    expect(await store.pendingCount()).toBe(0);

    const outbox = await store.outboxFor('s1');
    expect(canCloseRemotely(outbox)).toEqual({ ok: true });
  });
});

describe('resumability', () => {
  test('a killed app resumes on the point it was about to probe', async () => {
    const session = newSession('s2');
    await store.putSession(session);
    const run = new PatternRun(pattern, session.progress);

    for (let i = 0; i < 5; i++) {
      const point = run.next()!;
      await capture(store, session, run, point.point.id, {
        curve: layeredCurve(),
        drive: steadyDrive(),
        fix: GOOD_FIX,
        takenAt: new Date(Date.parse('2026-07-01T07:00:00Z') + i * 90_000),
      });
    }

    // Simulate the browser being killed: nothing survives but IndexedDB.
    store.close();
    store = await Store.open(`harrow-field-test-${dbCounter - 1}`);

    const restored = await store.getSession('s2');
    const restoredRun = new PatternRun(pattern, restored!.progress);
    expect(restoredRun.captured).toBe(5);
    expect(restoredRun.next()?.point.id).toBe('RAIL-06');
    expect(await store.readingsFor('s2')).toHaveLength(5);
  });

  test('re-syncing a session that already synced is harmless', async () => {
    const transport = new FakeTransport();
    const session = newSession('s3');
    await store.putSession(session);
    const run = new PatternRun(pattern, session.progress);

    for (let i = 0; i < 9; i++) {
      const point = run.next()!;
      await capture(store, session, run, point.point.id, {
        curve: layeredCurve(),
        drive: steadyDrive(),
        fix: GOOD_FIX,
        takenAt: new Date(Date.parse('2026-07-01T07:00:00Z') + i * 90_000),
      });
    }

    const first = await syncSession(store, transport, 's3');
    expect(first.accepted).toBe(9);

    const second = await syncSession(store, transport, 's3');
    expect(second.attempted).toBe(0);
    expect(transport.openCalls).toBe(1);
  });

  test('a partial sync resumes rather than restarting', async () => {
    const transport = new FakeTransport();
    const session = newSession('s4');
    await store.putSession(session);
    const run = new PatternRun(pattern, session.progress);

    for (let i = 0; i < 12; i++) {
      const point = run.next()!;
      await capture(store, session, run, point.point.id, {
        curve: layeredCurve(),
        drive: steadyDrive(),
        fix: GOOD_FIX,
        takenAt: new Date(Date.parse('2026-07-01T07:00:00Z') + i * 90_000),
      });
    }

    // One batch lands, then the signal drops mid-sync.
    transport.failAfterBatches = 1;
    await syncSession(store, transport, 's4', { batchSize: 5 });
    const sentAfterFirst = (await store.outboxFor('s4')).filter((e) => e.state === 'SENT').length;
    expect(sentAfterFirst).toBeGreaterThan(0);
    expect(sentAfterFirst).toBeLessThan(12);

    transport.online = true;
    transport.failAfterBatches = null;
    const finish = await syncSession(store, transport, 's4', {
      batchSize: 5,
      now: () => new Date(Date.now() + 600_000),
    });
    expect(finish.attempted).toBe(12 - sentAfterFirst);
    expect(await store.pendingCount()).toBe(0);
  });
});

describe('gates during capture', () => {
  test('a poor GPS fix blocks before the probe goes in', async () => {
    const session = newSession('s5');
    await store.putSession(session);
    const run = new PatternRun(pattern, session.progress);

    expect(preflight(POOR_FIX).verdict).toBe('BLOCKED');
    await expect(
      capture(store, session, run, 'RAIL-01', {
        curve: layeredCurve(),
        drive: steadyDrive(),
        fix: POOR_FIX,
        takenAt: new Date('2026-07-01T07:00:00Z'),
      }),
    ).rejects.toThrow(CaptureBlocked);

    expect(await store.readingsFor('s5')).toHaveLength(0);
    expect(run.at('RAIL-01').state).toBe('PENDING');
  });

  test('an override captures the reading and records that it was overridden', async () => {
    const session = newSession('s6');
    await store.putSession(session);
    const run = new PatternRun(pattern, session.progress);

    const outcome = await capture(store, session, run, 'RAIL-01', {
      curve: layeredCurve(),
      drive: steadyDrive(),
      fix: POOR_FIX,
      takenAt: new Date('2026-07-01T07:00:00Z'),
      overrideGps: true,
    });

    expect(outcome.accepted).toBe(true);
    expect(outcome.flags).toEqual(expect.arrayContaining(['GPS_POOR', 'MANUAL_OVERRIDE']));
  });

  test('a ragged drive is stored, flagged, and offered a retake on fresh ground', async () => {
    const session = newSession('s7');
    await store.putSession(session);
    const run = new PatternRun(pattern, session.progress);

    const outcome = await capture(store, session, run, 'RAIL-01', {
      curve: layeredCurve(),
      drive: raggedDrive(),
      fix: GOOD_FIX,
      takenAt: new Date('2026-07-01T07:00:00Z'),
    });

    expect(outcome.accepted).toBe(false);
    expect(outcome.flags).toContain('RATE_OUTLIER');
    expect(outcome.retake?.canRetake).toBe(true);
    expect(outcome.retake?.reason).toMatch(/fresh ground, not the same hole/);

    // §2.1: the rejected reading is kept. It is evidence, not a mistake to erase.
    const stored = await store.readingsFor('s7');
    expect(stored).toHaveLength(1);
    expect(stored[0]!.accepted).toBe(false);

    // And the retake goes somewhere else.
    expect(run.targetFor('RAIL-01').offsetM).toBeCloseTo(1.5 + pattern.retakeOffsetM, 6);
  });

  test('probing an already-captured point is refused', async () => {
    const session = newSession('s8');
    await store.putSession(session);
    const run = new PatternRun(pattern, session.progress);
    const input = {
      curve: layeredCurve(),
      drive: steadyDrive(),
      fix: GOOD_FIX,
      takenAt: new Date('2026-07-01T07:00:00Z'),
    };
    await capture(store, session, run, 'RAIL-01', input);
    await expect(capture(store, session, run, 'RAIL-01', input)).rejects.toThrow(CaptureBlocked);
  });
});

describe('sync integrity', () => {
  test('an identical reading saved twice is stored once', async () => {
    const session = newSession('s9');
    await store.putSession(session);
    const run = new PatternRun(pattern, session.progress);
    const input = {
      curve: layeredCurve(),
      drive: steadyDrive(),
      fix: GOOD_FIX,
      takenAt: new Date('2026-07-01T07:00:00Z'),
    };
    const a = await capture(store, session, run, 'RAIL-01', input);
    const b = await capture(store, session, run, 'RAIL-02', input);
    // Same bytes, same instant, same instrument -> same hash by construction.
    expect(b.sourceHash).toBe(a.sourceHash);
    expect(await store.readingsFor('s9')).toHaveLength(1);
  });

  test('a server-rejected reading is parked, not retried forever', async () => {
    const transport = new FakeTransport();
    transport.rejectAtIndex = 0;
    const session = newSession('s10');
    await store.putSession(session);
    const run = new PatternRun(pattern, session.progress);

    for (let i = 0; i < 3; i++) {
      const point = run.next()!;
      await capture(store, session, run, point.point.id, {
        curve: layeredCurve(),
        drive: steadyDrive(),
        fix: GOOD_FIX,
        takenAt: new Date(Date.parse('2026-07-01T07:00:00Z') + i * 90_000),
      });
    }

    const report = await syncSession(store, transport, 's10');
    expect(report.rejected).toBe(1);
    const outbox = await store.outboxFor('s10');
    expect(outbox.filter((e) => e.state === 'FAILED')).toHaveLength(1);
    expect(canCloseRemotely(outbox).ok).toBe(false);
    expect(canCloseRemotely(outbox).reason).toMatch(/permanently failed/);
  });

  test('a session with anything outstanding cannot be closed remotely', async () => {
    const session = newSession('s11');
    await store.putSession(session);
    const run = new PatternRun(pattern, session.progress);
    await capture(store, session, run, 'RAIL-01', {
      curve: layeredCurve(),
      drive: steadyDrive(),
      fix: GOOD_FIX,
      takenAt: new Date('2026-07-01T07:00:00Z'),
    });
    expect(canCloseRemotely(await store.outboxFor('s11')).ok).toBe(false);
  });

  test('local verification catches a corrupted curve', async () => {
    const session = newSession('s12');
    await store.putSession(session);
    const run = new PatternRun(pattern, session.progress);
    await capture(store, session, run, 'RAIL-01', {
      curve: layeredCurve(),
      drive: steadyDrive(),
      fix: GOOD_FIX,
      takenAt: new Date('2026-07-01T07:00:00Z'),
    });

    const [reading] = await store.readingsFor('s12');
    await store.saveReading({ ...reading!, forceDepthSampleCount: 9999 });
    // saveReading is a no-op on an existing hash, so corrupt it the only way that can
    // actually happen: a partial write. Simulated by shrinking the declared count.
    const corrupted = { ...reading!, sourceHash: 'deadbeef', forceDepthSampleCount: 9999 };
    await store.saveReading(corrupted);

    const verdict = await store.verify('s12');
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(' ')).toMatch(/expected/);
  });
});
