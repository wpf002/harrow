/**
 * Instrument source.
 *
 * The real implementation is Web Bluetooth against the Phase 3 firmware, which does not
 * exist — Phase 3 was closed out by the Phase 2 positioning decision. The interface is
 * defined here so the capture flow is written against a contract rather than a
 * simulator, and so swapping one in later touches this file only.
 *
 * `SimulatedInstrument` exists to exercise the app end to end. It is clearly labelled in
 * the UI, because a field app that cannot tell you whether the number came from a probe
 * or from a random number generator is worse than no field app.
 */
import type { DriveRateProfile, ForceDepthCurve } from '@harrow/shared';

export interface Traverse {
  curve: ForceDepthCurve;
  drive: DriveRateProfile;
  takenAt: Date;
}

export interface Instrument {
  readonly kind: 'ble' | 'simulated';
  readonly label: string;
  connected(): boolean;
  connect(): Promise<void>;
  /** Run one traverse. Resolves when the probe reaches target depth. */
  traverse(onProgress?: (partial: ForceDepthCurve) => void): Promise<Traverse>;
}

export class SimulatedInstrument implements Instrument {
  readonly kind = 'simulated' as const;
  readonly label = 'SIMULATED — not a real probe';
  private isConnected = false;
  private seed: number;

  constructor(seed = 1) {
    this.seed = seed >>> 0;
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 0x1_0000_0000;
  }

  connected(): boolean {
    return this.isConnected;
  }

  async connect(): Promise<void> {
    this.isConnected = true;
  }

  async traverse(onProgress?: (partial: ForceDepthCurve) => void): Promise<Traverse> {
    const n = 240;
    const cushionMm = 50 + this.rand() * 40;
    const baseSlope = 8 + this.rand() * 6;
    const ragged = this.rand() < 0.15;

    const depthMm = new Float64Array(n);
    const forceN = new Float64Array(n);
    const timeMs = new Float64Array(n);
    const driveDepth = new Float64Array(n);

    let d = 0;
    for (let i = 0; i < n; i++) {
      const step = ragged && i % 2 === 0 ? 0.05 : 190 / (n - 1);
      d = Math.min(190, d + step);
      depthMm[i] = d;
      forceN[i] =
        (d < cushionMm ? d * 1.6 : cushionMm * 1.6 + (d - cushionMm) * baseSlope) +
        (this.rand() - 0.5) * 5;
      timeMs[i] = (d / 20) * 1000; // 20 mm/s
      driveDepth[i] = d;
      if (onProgress && i % 12 === 0) {
        onProgress({ depthMm: depthMm.slice(0, i + 1), forceN: forceN.slice(0, i + 1) });
      }
    }

    if (ragged) {
      // A ragged drive is a rate problem, not a depth problem: the same depths arrive
      // at uneven times.
      for (let i = 0; i < n; i++) timeMs[i] = i * (i % 2 === 0 ? 4 : 28);
    }

    return {
      curve: { depthMm, forceN },
      drive: { timeMs, depthMm: driveDepth },
      takenAt: new Date(),
    };
  }
}
