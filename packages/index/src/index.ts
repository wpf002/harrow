/**
 * Physical index computation. Pure functions, versioned, immutable on publish.
 *
 * Rule §2.2 draws a hard line through this package: everything here is a MEASUREMENT
 * derived from physics. Nothing here is fitted to an outcome. The fitted quantity —
 * `predictive_feature` — lives in the modelling layer (analysis/, Phase 6b) and is
 * stored in its own table so that no query against published values can return one.
 */
export * from './derivation/v1.js';
export * from './physical/v1.js';
export * from './session.js';

import { DERIVATION_VERSION_V1 } from './derivation/v1.js';
import { PHYSICAL_INDEX_NAME, PHYSICAL_INDEX_VERSION_V1 } from './physical/v1.js';

/**
 * Every published index version. Append-only (§2.4): a version that has shipped is
 * never edited or removed, and both old and new are computed going forward.
 */
export const INDEX_VERSIONS = [
  { indexName: PHYSICAL_INDEX_NAME, version: PHYSICAL_INDEX_VERSION_V1, publishedAt: '2026-08-26' },
] as const;

/** Every derivation version, same rule. */
export const DERIVATION_VERSIONS = [DERIVATION_VERSION_V1] as const;

export const CURRENT_DERIVATION_VERSION = DERIVATION_VERSION_V1;
