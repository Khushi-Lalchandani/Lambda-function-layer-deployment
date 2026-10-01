import { ConservativeResponseService } from '../conservative-response.service';
import { ExecutionCapability, ExecutionContext, ExecutionNode, ExecutionResult } from '../../types/execution.interface';
import { Executor } from './executor.interface';
export declare class GreetingExecutor implements Executor {
    private readonly conservativeResponseService;
    readonly name = "GreetingExecutor";
    private readonly logger;
    constructor(conservativeResponseService: ConservativeResponseService);
    canHandle(capability: ExecutionCapability): boolean;
    execute(node: ExecutionNode, context: ExecutionContext): Promise<ExecutionResult>;
}
//# sourceMappingURL=greeting.executor.d.ts.map