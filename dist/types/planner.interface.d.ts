export type PlannerTool = 'GREETING' | 'CASE_TIMELINE' | 'CASE_SUMMARY' | 'DOCUMENT_FIRST' | 'WEB_FIRST' | 'REFUSE';
/** Alias used by execution graph and executors. */
export type ExecutionCapability = PlannerTool;
export type ExistingStrategy = 'greeting' | 'metadata' | 'vector' | 'web_search' | 'vector + web_search' | 'conservative';
export interface PlannerAction {
    tool: PlannerTool;
    query: string;
    reason?: string;
}
export interface PlannerResult {
    originalQuery: string;
    subQuery: string;
    actions: PlannerAction[];
    confidence: 'high' | 'medium' | 'low';
    reasoning?: string;
}
export interface PlannerComparisonResult {
    query: string;
    existingStrategy: string;
    plannerActions: PlannerTool[];
    mappedStrategies: string[];
    matched: boolean;
}
//# sourceMappingURL=planner.interface.d.ts.map