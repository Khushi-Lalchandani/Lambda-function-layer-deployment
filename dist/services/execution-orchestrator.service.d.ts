import { ExecutionContext, ExecutionGraph, OrchestrationResult } from '../types/execution.interface';
import { AnswerRefinementService } from './answer-refinement.service';
import { AggregationService } from './aggregation.service';
import { ExecutorRegistry } from './executor-registry';
export declare class ExecutionOrchestratorService {
    private readonly executorRegistry;
    private readonly aggregationService;
    private readonly answerRefinementService;
    private readonly logger;
    constructor(executorRegistry: ExecutorRegistry, aggregationService: AggregationService, answerRefinementService: AnswerRefinementService);
    executeGraph(graph: ExecutionGraph, context: ExecutionContext): Promise<OrchestrationResult>;
    private executeNode;
    private singleExecutorAggregate;
    private toExecutorResult;
    private logValidationTrace;
}
//# sourceMappingURL=execution-orchestrator.service.d.ts.map