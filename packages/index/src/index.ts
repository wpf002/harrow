// Phase 0 placeholder.
//
// Rule §2.2: this package computes physical_index ONLY — physics-based, published,
// immutable per version, fit to nothing. The fitted predictive_feature lives in the
// modeling layer (analysis/ + Phase 6b) and must never be computed here.
// Rule §2.4: a published version is frozen. Improvements ship as a new version.
export const INDEX_VERSIONS = [] as const;
