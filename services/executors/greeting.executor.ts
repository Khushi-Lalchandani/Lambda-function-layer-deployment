import { Injectable, Logger } from '@nestjs/common';
import { ConservativeResponseService } from '../conservative-response.service';
import {
  logRetrievalSkipped,
  RETRIEVAL_SKIP_REASONS,
} from '../retrieval-profile';
import {
  ExecutionCapability,
  ExecutionContext,
  ExecutionNode,
  ExecutionResult,
} from '../../types/execution.interface';
import { Executor } from './executor.interface';

@Injectable()
export class GreetingExecutor implements Executor {
  readonly name = 'GreetingExecutor';
  private readonly logger = new Logger(GreetingExecutor.name);

  constructor(
    private readonly conservativeResponseService: ConservativeResponseService,
  ) {}

  canHandle(capability: ExecutionCapability): boolean {
    return capability === 'GREETING';
  }

  execute(node: ExecutionNode, context: ExecutionContext): Promise<ExecutionResult> {
    const documentChats =
      context.documentChats ?? context.metadata?.documentChats ?? [];

    logRetrievalSkipped(
      this.logger,
      this.name,
      RETRIEVAL_SKIP_REASONS.GREETING_RESPONSE,
    );

    const answer = this.conservativeResponseService.getGreetingResponse(
      node.query,
      context.caseName ?? context.caseId ?? '',
      context.clientName ?? context.clientId ?? '',
      documentChats,
    );

    return Promise.resolve({
      answer,
      strategy: 'greeting',
      confidence: 0.9,
    });
  }
}
