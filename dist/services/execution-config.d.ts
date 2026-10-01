/**
 * Execution graph rollout flags.
 *
 * Production defaults: graph active, legacy disabled.
 * Set USE_LEGACY_ROUTING=true for emergency rollback only.
 */
export declare const executionConfig: {
    readonly enableExecutionGraph: boolean;
    readonly enableExecutionGraphShadow: boolean;
    readonly useLegacyRouting: boolean;
    /** Legacy shadow comparison — disabled in production; enable only for rollback validation. */
    readonly enableLegacyShadow: boolean;
};
//# sourceMappingURL=execution-config.d.ts.map