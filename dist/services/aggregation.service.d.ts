import { AggregatedResponse, ExecutorResult } from '../types/execution.interface';
export declare class AggregationService {
    private readonly logger;
    /** Pack sub-query executor results for the final answer-refinement pass. */
    aggregateDecomposedResults(results: ExecutorResult[]): AggregatedResponse;
    private emptyResponse;
    private singleResultResponse;
    private dropConservativeWhenBetterExists;
    private buildSegments;
    private resolvePurpose;
    private orderSegments;
    private deduplicateSegments;
    private isDuplicateAnswer;
    private normalizeForDedup;
    private joinSegmentBodies;
    private logAggregation;
}
//# sourceMappingURL=aggregation.service.d.ts.map