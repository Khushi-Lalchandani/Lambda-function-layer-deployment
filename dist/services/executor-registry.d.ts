import { ExecutionCapability } from '../types/execution.interface';
import { Executor } from './executors/executor.interface';
import { GreetingExecutor } from './executors/greeting.executor';
import { TimelineExecutor } from './executors/timeline.executor';
import { SummaryExecutor } from './executors/summary.executor';
import { DocumentFirstExecutor } from './executors/document.executor';
import { WebFirstExecutor } from './executors/web.executor';
import { RefuseExecutor } from './executors/refuse.executor';
export declare class ExecutorRegistry {
    private readonly executors;
    constructor(greetingExecutor: GreetingExecutor, timelineExecutor: TimelineExecutor, summaryExecutor: SummaryExecutor, documentFirstExecutor: DocumentFirstExecutor, webFirstExecutor: WebFirstExecutor, refuseExecutor: RefuseExecutor);
    getExecutor(capability: ExecutionCapability): Executor | undefined;
    getExecutorName(capability: ExecutionCapability): string | undefined;
    getAllExecutors(): Executor[];
}
//# sourceMappingURL=executor-registry.d.ts.map