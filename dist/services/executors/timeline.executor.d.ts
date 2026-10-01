import { MetadataService } from '../metadata.service';
import { ExecutionCapability, ExecutionContext, ExecutionNode, ExecutionResult } from '../../types/execution.interface';
import { Executor } from './executor.interface';
export declare class TimelineExecutor implements Executor {
    private readonly metadataService;
    readonly name = "TimelineExecutor";
    private readonly logger;
    constructor(metadataService: MetadataService);
    canHandle(capability: ExecutionCapability): boolean;
    execute(node: ExecutionNode, context: ExecutionContext): Promise<ExecutionResult>;
}
//# sourceMappingURL=timeline.executor.d.ts.map