/**
 * Units are part of the type, not part of the variable name.
 *
 * Every stored quantity is SI or a stated SI multiple, and the column name says which.
 * These helpers exist so that a conversion is a function call that can be grepped, not
 * a bare multiplication someone has to trust.
 */

export const MM_PER_M = 1000;
export const KG_TO_N = 9.80665;

export const mmToM = (mm: number): number => mm / MM_PER_M;
export const mToMm = (m: number): number => m * MM_PER_M;

/** Force exerted by a known mass under standard gravity — used in force calibration. */
export const massKgToForceN = (kg: number): number => kg * KG_TO_N;

/** Pressure in kPa from a force in newtons over a tip area in mm². */
export const forceToKPa = (forceN: number, tipAreaMm2: number): number =>
  forceN / (tipAreaMm2 / 1e6) / 1000;

/** Volumetric water content is a fraction in storage; percent only for display. */
export const vwcFractionToPercent = (fraction: number): number => fraction * 100;
export const vwcPercentToFraction = (percent: number): number => percent / 100;
