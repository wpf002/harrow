/** Curve and drive fixtures shared by the tests. Not shipped to the app. */
import type { DriveRateProfile, ForceDepthCurve } from '@harrow/shared';

export function layeredCurve(cushionMm = 60, baseSlope = 12, n = 240): ForceDepthCurve {
  const depthMm = new Float64Array(n);
  const forceN = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = (i / (n - 1)) * 190;
    depthMm[i] = d;
    forceN[i] = d < cushionMm ? d * 1.6 : cushionMm * 1.6 + (d - cushionMm) * baseSlope;
  }
  return { depthMm, forceN };
}

/** A steady 20 mm/s traverse — what a working constant-rate actuator produces. */
export function steadyDrive(n = 240, rateMmS = 20): DriveRateProfile {
  const dtMs = 1000 / 50;
  const timeMs = new Float64Array(n);
  const depthMm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    timeMs[i] = i * dtMs;
    depthMm[i] = (rateMmS * timeMs[i]!) / 1000;
  }
  return { timeMs, depthMm };
}

/** A hand-driven traverse: stop, shove, stop. What the actuator exists to prevent. */
export function raggedDrive(n = 240): DriveRateProfile {
  const timeMs = new Float64Array(n);
  const depthMm = new Float64Array(n);
  let d = 0;
  for (let i = 0; i < n; i++) {
    timeMs[i] = i * 20;
    d += i % 2 === 0 ? 0.02 : 0.78;
    depthMm[i] = d;
  }
  return { timeMs, depthMm };
}

export const GOOD_FIX = { latitude: 51.41, longitude: -0.74, accuracy: 0.4 };
export const POOR_FIX = { latitude: 51.41, longitude: -0.74, accuracy: 6.2 };
