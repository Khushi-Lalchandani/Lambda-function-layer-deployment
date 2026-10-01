import { ConservativeResponseService } from '../conservative-response.service';
import { MetadataService } from '../metadata.service';
import { VectorSearchService } from '../vector-service';
import { WebSearchService } from '../web-search.service';
import { ExecutionCapability, ExecutionContext, ExecutionNode, ExecutionResult } from '../../types/execution.interface';
import { Executor } from './executor.interface';
export declare class DocumentFirstExecutor implements Executor {
    private readonly vectorSearchService;
    private readonly webSearchService;
    private readonly conservativeResponseService;
    private readonly metadataService;
    readonly name = "DocumentFirstExecutor";
    private readonly logger;
    constructor(vectorSearchService: VectorSearchService, webSearchService: WebSearchService, conservativeResponseService: ConservativeResponseService, metadataService: MetadataService);
    canHandle(capability: ExecutionCapability): boolean;
    execute(node: ExecutionNode, context: ExecutionContext): Promise<ExecutionResult>;
    private withTrace;
    private logExecutionTrace;
}
//# sourceMappingURL=document.executor.d.ts.map