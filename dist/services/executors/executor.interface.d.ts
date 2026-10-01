import { ExecutionCapability, ExecutionContext, ExecutionNode, ExecutionResult } from '../../types/execution.interface';
export interface Executor {
    readonly name: string;
    canHandle(capability: ExecutionCapability): boolean;
    execute(node: ExecutionNode, context: ExecutionContext): Promise<ExecutionResult>;
}
//# sourceMappingURL=executor.interface.d.ts.map