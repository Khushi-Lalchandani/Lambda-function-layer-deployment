/**
 * Phase 1 query decomposition feature flag.
 * Default true in Phase 1 rollout. Set ENABLE_QUERY_DECOMPOSITION=false to disable.
 */
export const queryDecompositionConfig = {
  get enableQueryDecomposition(): boolean {
    return (
      (process.env.ENABLE_QUERY_DECOMPOSITION ?? 'true').toLowerCase() ===
      'true'
    );
  },
};
