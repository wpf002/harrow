/**
 * The capture app. Offline-first: nothing here waits on the network, and every screen
 * works with the radio off.
 *
 * The app is the protocol (§13). The operator does not choose which point to probe —
 * the declared pattern does. The only decisions on offer are: capture, override a gate
 * (which sets a flag), or abandon the point.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { capture, CaptureBlocked, preflight } from './core/capture.js';
import type { GateResult, GpsFix } from './core/gate.js';
import { getPattern, PATTERNS, PatternRun } from './core/pattern.js';
import { Store, type StoredSession } from './core/store.js';
import { canCloseRemotely, syncSession } from './core/sync.js';
import { SimulatedInstrument, type Instrument } from './instrument.js';
import { HttpTransport } from './transport.js';
import { CurvePlot } from './ui/CurvePlot.jsx';
import type { ForceDepthCurve } from '@harrow/shared';

const API_BASE = import.meta.env['VITE_API_BASE'] ?? 'http://localhost:3000';

function useGps(): GpsFix | null {
  const [fix, setFix] = useState<GpsFix | null>(null);
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) =>
        setFix({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      () => setFix(null),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return fix;
}

function Value({ n, unit, digits = 1 }: { n: number | null; unit: string; digits?: number }) {
  return (
    <span className="value">
      {n === null ? '—' : n.toFixed(digits)}
      <span className="unit">{unit}</span>
    </span>
  );
}

export function App() {
  const [store, setStore] = useState<Store | null>(null);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [run, setRun] = useState<PatternRun | null>(null);
  const [live, setLive] = useState<ForceDepthCurve | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<GateResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const instrument = useRef<Instrument>(new SimulatedInstrument(Date.now() & 0xffff));
  const fix = useGps();

  useEffect(() => {
    void Store.open().then(async (s) => {
      setStore(s);
      const open = await s.openSessions();
      if (open[0]) {
        setSession(open[0]);
        setRun(new PatternRun(getPattern(open[0].samplingPattern), open[0].progress));
      }
      setPending(await s.pendingCount());
    });
  }, []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const refreshPending = useCallback(async () => {
    if (store) setPending(await store.pendingCount());
  }, [store]);

  const doCapture = useCallback(
    async (overrideGps: boolean) => {
      if (!store || !session || !run) return;
      const point = run.next();
      if (!point) return;
      setBusy(true);
      setBlocked(null);
      setMessage(null);
      try {
        await instrument.current.connect();
        const traverse = await instrument.current.traverse(setLive);
        setLive(traverse.curve);
        const outcome = await capture(store, session, run, point.point.id, {
          curve: traverse.curve,
          drive: traverse.drive,
          fix,
          takenAt: traverse.takenAt,
          overrideGps,
        });
        setRun(new PatternRun(run.pattern, run.snapshot()));
        setMessage(
          outcome.accepted
            ? `Captured ${point.point.id}.`
            : `Rejected: ${outcome.reasons.join(' ')} ${outcome.retake?.reason ?? ''}`,
        );
        await refreshPending();
      } catch (err) {
        if (err instanceof CaptureBlocked) setBlocked(err.gate);
        else setMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [store, session, run, fix, refreshPending],
  );

  const doSync = useCallback(async () => {
    if (!store || !session) return;
    setBusy(true);
    try {
      const report = await syncSession(store, new HttpTransport(API_BASE), session.localId);
      setMessage(
        report.errors.length
          ? `Sync deferred: ${report.errors[0]}`
          : `Synced ${report.accepted} reading(s), ${report.duplicates} already held.`,
      );
      setSession((await store.getSession(session.localId)) ?? session);
      await refreshPending();
    } finally {
      setBusy(false);
    }
  }, [store, session, refreshPending]);

  const startSession = useCallback(
    async (
      form: Omit<
        StoredSession,
        'localId' | 'remoteId' | 'status' | 'openedAt' | 'closedAt' | 'progress'
      >,
    ) => {
      if (!store) return;
      const pattern = getPattern(form.samplingPattern);
      const created: StoredSession = {
        ...form,
        localId: crypto.randomUUID(),
        remoteId: null,
        status: 'OPEN',
        openedAt: new Date().toISOString(),
        closedAt: null,
        progress: new PatternRun(pattern).snapshot(),
      };
      await store.putSession(created);
      setSession(created);
      setRun(new PatternRun(pattern, created.progress));
    },
    [store],
  );

  const closeSession = useCallback(async () => {
    if (!store || !session || !run) return;
    const local = await store.verify(session.localId);
    const remote = canCloseRemotely(await store.outboxFor(session.localId));
    const ready = run.readyToClose();
    if (!ready.ok || !local.ok || !remote.ok) {
      setMessage([...ready.problems, ...local.problems, remote.reason].filter(Boolean).join(' · '));
      return;
    }
    await store.putSession({ ...session, status: 'CLOSED', closedAt: new Date().toISOString() });
    setSession(null);
    setRun(null);
    setMessage('Session closed and fully synced.');
  }, [store, session, run]);

  if (!store) return <div className="app">Opening local store…</div>;

  if (!session || !run) {
    return (
      <div className="app">
        <h1>Harrow Field</h1>
        <SessionForm onStart={startSession} />
        {message && <p className="muted">{message}</p>}
      </div>
    );
  }

  const point = run.next();
  const target = point ? run.targetFor(point.point.id) : null;
  const gps = preflight(fix);

  return (
    <div className="app">
      <div className="syncbar row">
        <span className="muted">
          {online ? 'online' : 'offline'} · <span className="value">{pending}</span> queued
        </span>
        <button onClick={() => void doSync()} disabled={busy || pending === 0}>
          Sync
        </button>
      </div>

      <div className="card">
        <div className="row">
          <div>
            <h1>
              {session.trackCode} · {session.surfaceType}
            </h1>
            <span className="muted">{session.samplingPattern}</span>
          </div>
          <span className="value">
            {run.captured}
            <span className="unit">/ {run.pattern.points.length}</span>
          </span>
        </div>
        <div className="bar" style={{ marginTop: 10 }}>
          <span style={{ width: `${(run.captured / run.pattern.points.length) * 100}%` }} />
        </div>
        {instrument.current.kind === 'simulated' && (
          <p className="chip flag" style={{ marginTop: 10 }}>
            {instrument.current.label}
          </p>
        )}
      </div>

      {point && target ? (
        <>
          <div className="card">
            <label>Next point</label>
            <div className="row">
              <h2 className={`segment-${point.point.segment}`}>{point.point.id}</h2>
              {target.isRetake && <span className="chip flag">RETAKE — fresh ground</span>}
            </div>
            <div className="grid2">
              <div>
                <label>Along</label>
                <Value n={target.alongM} unit="m" digits={2} />
              </div>
              <div>
                <label>From rail</label>
                <Value n={target.offsetM} unit="m" digits={2} />
              </div>
            </div>
          </div>

          <div className={`card ${gps.verdict === 'BLOCKED' ? 'blocked' : ''}`}>
            <label>GPS</label>
            <Value n={fix?.accuracy ?? null} unit="m" digits={1} />
            {gps.verdict === 'BLOCKED' && <p className="muted">{gps.reasons.join(' ')}</p>}
          </div>

          <div className="card">
            <CurvePlot curve={live} />
          </div>

          <button
            className="primary wide"
            onClick={() => void doCapture(false)}
            disabled={busy || gps.verdict === 'BLOCKED'}
          >
            {busy ? 'Capturing…' : `Capture ${point.point.id}`}
          </button>

          {blocked?.overridable && (
            <div className="card blocked" style={{ marginTop: 12 }}>
              <p>{blocked.reasons.join(' ')}</p>
              <button className="danger wide" onClick={() => void doCapture(true)}>
                Override — record anyway, flagged
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="card">
          <h2>Pattern complete</h2>
          <p className="muted">
            {run.captured} captured, {run.spent} spent. Segments:{' '}
            {run.segmentsCovered().join(', ') || 'none'}.
          </p>
          <button className="primary wide" onClick={() => void closeSession()} disabled={busy}>
            Close session
          </button>
        </div>
      )}

      {message && (
        <div className="card flagged">
          <p>{message}</p>
        </div>
      )}
    </div>
  );
}

function SessionForm({
  onStart,
}: {
  onStart: (
    form: Omit<
      StoredSession,
      'localId' | 'remoteId' | 'status' | 'openedAt' | 'closedAt' | 'progress'
    >,
  ) => void | Promise<void>;
}) {
  const [trackCode, setTrackCode] = useState('ASC');
  const [surfaceType, setSurfaceType] = useState<StoredSession['surfaceType']>('TURF');
  const [samplingPattern, setSamplingPattern] = useState('grid_20pt_3segment_v1');
  const [operatorRef, setOperatorRef] = useState('OP-001');
  const [instrumentSerial, setInstrumentSerial] = useState('HR-0001');
  const [officialGoingLabel, setOfficialGoingLabel] = useState('GOOD');
  const [maintenanceLog, setMaintenanceLog] = useState('');
  const [weatherNotes, setWeatherNotes] = useState('');

  return (
    <div className="card">
      <h2>Open a session</h2>
      <p className="muted" style={{ fontSize: 13 }}>
        The sampling pattern is declared now, before any capture. It cannot be changed afterwards —
        that is what makes it a protocol rather than a description.
      </p>

      <div className="grid2">
        <div>
          <label>Track</label>
          <input value={trackCode} onChange={(e) => setTrackCode(e.target.value.toUpperCase())} />
        </div>
        <div>
          <label>Surface</label>
          <select
            value={surfaceType}
            onChange={(e) => setSurfaceType(e.target.value as StoredSession['surfaceType'])}
          >
            <option>TURF</option>
            <option>DIRT</option>
            <option>SYNTHETIC</option>
          </select>
        </div>
      </div>

      <label>Sampling pattern</label>
      <select value={samplingPattern} onChange={(e) => setSamplingPattern(e.target.value)}>
        {Object.values(PATTERNS).map((p) => (
          <option key={p.name} value={p.name}>
            {p.name} — {p.points.length} points
          </option>
        ))}
      </select>
      <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
        {getPattern(samplingPattern).description}
      </p>

      <div className="grid2">
        <div>
          <label>Operator</label>
          <input value={operatorRef} onChange={(e) => setOperatorRef(e.target.value)} />
        </div>
        <div>
          <label>Instrument</label>
          <input value={instrumentSerial} onChange={(e) => setInstrumentSerial(e.target.value)} />
        </div>
      </div>

      <label>Official going label</label>
      <input value={officialGoingLabel} onChange={(e) => setOfficialGoingLabel(e.target.value)} />

      <label>Maintenance log</label>
      <textarea
        rows={2}
        placeholder="harrowed 06:00, watered 12 mm overnight"
        value={maintenanceLog}
        onChange={(e) => setMaintenanceLog(e.target.value)}
      />

      <label>Weather</label>
      <textarea
        rows={2}
        placeholder="overcast, 14 C, light SW, 8 mm rain since 22:00"
        value={weatherNotes}
        onChange={(e) => setWeatherNotes(e.target.value)}
      />

      <button
        className="primary wide"
        onClick={() =>
          void onStart({
            trackCode,
            surfaceType,
            date: new Date().toISOString().slice(0, 10),
            samplingPattern,
            operatorRef,
            instrumentSerial,
            officialGoingLabel: officialGoingLabel || null,
            maintenanceLog: maintenanceLog || null,
            weatherNotes: weatherNotes || null,
            notes: null,
          })
        }
      >
        Declare pattern and open
      </button>
    </div>
  );
}
