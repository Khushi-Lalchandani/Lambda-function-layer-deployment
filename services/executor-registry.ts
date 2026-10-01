import { Injectable } from '@nestjs/common';
import { ExecutionCapability } from '../types/execution.interface';
import { Executor } from './executors/executor.interface';
import { GreetingExecutor } from './executors/greeting.executor';
import { TimelineExecutor } from './executors/timeline.executor';
import { SummaryExecutor } from './executors/summary.executor';
import { DocumentFirstExecutor } from './executors/document.executor';
import { WebFirstExecutor } from './executors/web.executor';
import { RefuseExecutor } from './executors/refuse.executor';

@Injectable()
export class ExecutorRegistry {
  private readonly executors: Executor[];

  constructor(
    greetingExecutor: GreetingExecutor,
    timelineExecutor: TimelineExecutor,
    summaryExecutor: SummaryExecutor,
    documentFirstExecutor: DocumentFirstExecutor,
    webFirstExecutor: WebFirstExecutor,
    refuseExecutor: RefuseExecutor,
  ) {
    this.executors = [
      greetingExecutor,
      timelineExecutor,
      summaryExecutor,
      documentFirstExecutor,
      webFirstExecutor,
      refuseExecutor,
    ];
  }

  getExecutor(capability: ExecutionCapability): Executor | undefined {
    return this.executors.find((executor) => executor.canHandle(capability));
  }

  getExecutorName(capability: ExecutionCapability): string | undefined {
    return this.getExecutor(capability)?.name;
  }

  getAllExecutors(): Executor[] {
    return [...this.executors];
  }
}
