import { MetadataService } from '../metadata.service';
import { VectorSearchService } from '../vector-service';
import { WebSearchService } from '../web-search.service';
import { ExecutionCapability, ExecutionContext, ExecutionNode, ExecutionResult } from '../../types/execution.interface';
import { Executor } from './executor.interface';
export declare class SummaryExecutor implements Executor {
    private readonly metadataService;
    private readonly vectorSearchService;
    private readonly webSearchService;
    readonly name = "SummaryExecutor";
    private readonly logger;
    constructor(metadataService: MetadataService, vectorSearchService: VectorSearchService, webSearchService: WebSearchService);
    canHandle(capability: ExecutionCapability): boolean;
    execute(node: ExecutionNode, context: ExecutionContext): Promise<ExecutionResult>;
    private logExecutionTrace;
}
//# sourceMappingURL=summary.executor.d.ts.map