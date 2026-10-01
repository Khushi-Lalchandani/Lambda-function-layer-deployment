import { HybridRetrievalService } from '../hybrid-retrieval.service';
import { WebSearchService } from '../web-search.service';
import { ExecutionCapability, ExecutionContext, ExecutionNode, ExecutionResult } from '../../types/execution.interface';
import { DocumentFirstExecutor } from './document.executor';
import { Executor } from './executor.interface';
export declare class WebFirstExecutor implements Executor {
    private readonly webSearchService;
    private readonly hybridRetrievalService;
    private readonly documentFirstExecutor;
    readonly name = "WebFirstExecutor";
    private readonly logger;
    constructor(webSearchService: WebSearchService, hybridRetrievalService: HybridRetrievalService, documentFirstExecutor: DocumentFirstExecutor);
    canHandle(capability: ExecutionCapability): boolean;
    execute(node: ExecutionNode, context: ExecutionContext): Promise<ExecutionResult>;
    private logExecutionTrace;
}
//# sourceMappingURL=web.executor.d.ts.map