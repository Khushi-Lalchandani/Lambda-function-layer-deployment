import { QueryDecompositionResult } from '../types/chat.interface';
import { PlannerResult } from '../types/planner.interface';
import { ExecutionGraph, ExecutionShadowLog } from '../types/execution.interface';
import { ExecutionGraphBuilder } from './execution-graph-builder';
import { ExecutorRegistry } from './executor-registry';
export declare class ExecutionGraphService {
    private readonly graphBuilder;
    private readonly executorRegistry;
    private readonly logger;
    constructor(graphBuilder: ExecutionGraphBuilder, executorRegistry: ExecutorRegistry);
    buildGraph(plannerResults: PlannerResult[], decompositionResult: QueryDecompositionResult): ExecutionGraph;
    buildShadowLog(query: string, plannerResults: PlannerResult[], decompositionResult: QueryDecompositionResult): ExecutionShadowLog;
    logShadowExecution(query: string, plannerResults: PlannerResult[], decompositionResult: QueryDecompositionResult): void;
}
//# sourceMappingURL=execution-graph.service.d.ts.map