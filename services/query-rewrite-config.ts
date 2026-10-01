/**
 * Phase 1 query rewrite feature flag.
 * Default true in Phase 1 rollout. Set ENABLE_QUERY_REWRITE=false to disable.
 */
export const queryRewriteConfig = {
  get enableQueryRewrite(): boolean {
    return (
      (process.env.ENABLE_QUERY_REWRITE ?? 'true').toLowerCase() === 'true'
    );
  },
  model: process.env.QUERY_REWRITE_MODEL ?? 'gemini-3-flash-preview',
};
