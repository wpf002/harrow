import { describe, expect, test } from 'vitest';

import { getPattern, PatternRun, PatternViolation } from './pattern.js';

const pattern = getPattern('grid_20pt_3segment_v1');

function run(): PatternRun {
  return new PatternRun(pattern);
}

describe('pattern definition', () => {
  test('covers all three path segments', () => {
    expect(pattern.segments).toEqual(['RAIL', 'MID', 'OUTSIDE']);
    expect(pattern.points).toHaveLength(21);
  });

  test('points are on the declared spacing', () => {
    const rail = pattern.points.filter((p) => p.segment === 'RAIL');
    expect(rail.map((p) => p.alongM)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
  });

  test('an unknown pattern is refused, not silently defaulted', () => {
    expect(() => getPattern('whatever_we_did_today')).toThrow(/unknown sampling pattern/);
  });
});

describe('order enforcement', () => {
  test('hands out points in declared order', () => {
    const r = run();
    expect(r.next()?.point.id).toBe('RAIL-01');
    r.accept('RAIL-01');
    expect(r.next()?.point.id).toBe('RAIL-02');
  });

  test('a point outside the pattern is refused', () => {
    expect(() => run().accept('NOWHERE-01')).toThrow(PatternViolation);
  });
});

describe('the first reading destroys the point (§9)', () => {
  test('an accepted point cannot be probed again', () => {
    const r = run();
    r.accept('RAIL-01');
    expect(() => r.accept('RAIL-01')).toThrow(/measures the hole/);
  });

  test('a retake is displaced onto fresh ground, not back into the hole', () => {
    const r = run();
    const before = r.targetFor('RAIL-01');
    expect(before.isRetake).toBe(false);

    r.reject('RAIL-01', 'ragged drive');
    const after = r.targetFor('RAIL-01');
    expect(after.isRetake).toBe(true);
    expect(after.offsetM).toBeCloseTo(before.offsetM + pattern.retakeOffsetM, 6);
    expect(after.alongM).toBe(before.alongM);
  });

  test('a point can be retaken once and then it is spent', () => {
    const r = run();
    expect(r.reject('RAIL-01', 'ragged').canRetake).toBe(true);
    const second = r.reject('RAIL-01', 'ragged again');
    expect(second.canRetake).toBe(false);
    expect(second.reason).toMatch(/spent/);
    expect(r.at('RAIL-01').state).toBe('SPENT');
  });

  test('a pending retake jumps the queue', () => {
    const r = run();
    r.accept('RAIL-01');
    r.reject('RAIL-02', 'ragged');
    r.accept('RAIL-03');
    expect(r.next()?.point.id).toBe('RAIL-02');
  });

  test('rejecting an already-accepted point is a violation', () => {
    const r = run();
    r.accept('RAIL-01');
    expect(() => r.reject('RAIL-01', 'second thoughts')).toThrow(PatternViolation);
  });
});

describe('resume', () => {
  test('a snapshot restores progress exactly', () => {
    const r = run();
    r.accept('RAIL-01');
    r.reject('RAIL-02', 'ragged');
    const restored = new PatternRun(pattern, r.snapshot());
    expect(restored.next()?.point.id).toBe('RAIL-02');
    expect(restored.captured).toBe(1);
    expect(restored.at('RAIL-02').retakeUsed).toBe(true);
  });

  test('a snapshot is a copy, not a live reference', () => {
    const r = run();
    const snap = r.snapshot();
    r.accept('RAIL-01');
    expect(snap[0]!.state).toBe('PENDING');
  });
});

describe('readiness to close', () => {
  test('a rail-only session is refused', () => {
    const r = run();
    for (let i = 1; i <= 7; i++) r.accept(`RAIL-0${i}`);
    const verdict = r.readyToClose();
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(' ')).toMatch(/path segment/);
  });

  test('too few readings is refused', () => {
    const r = run();
    r.accept('RAIL-01');
    r.accept('MID-01');
    expect(r.readyToClose().ok).toBe(false);
  });

  test('a complete pattern is ready', () => {
    const r = run();
    for (const p of pattern.points) r.accept(p.id);
    expect(r.complete).toBe(true);
    expect(r.readyToClose()).toEqual({ ok: true, problems: [] });
    expect(r.segmentsCovered()).toEqual(['MID', 'OUTSIDE', 'RAIL']);
  });

  test('spent points count as complete but not as captured', () => {
    const r = run();
    for (const p of pattern.points) {
      if (p.id === 'MID-01') {
        r.reject(p.id, 'ragged');
        r.reject(p.id, 'ragged again');
      } else {
        r.accept(p.id);
      }
    }
    expect(r.complete).toBe(true);
    expect(r.captured).toBe(20);
    expect(r.spent).toBe(1);
    expect(r.readyToClose().ok).toBe(true);
  });
});
