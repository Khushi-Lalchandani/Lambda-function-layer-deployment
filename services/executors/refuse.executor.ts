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
export class RefuseExecutor implements Executor {
  readonly name = 'RefuseExecutor';
  private readonly logger = new Logger(RefuseExecutor.name);

  constructor(
    private readonly conservativeResponseService: ConservativeResponseService,
  ) {}

  canHandle(capability: ExecutionCapability): boolean {
    return capability === 'REFUSE';
  }

  execute(node: ExecutionNode, context: ExecutionContext): Promise<ExecutionResult> {
    const documentChats =
      context.documentChats ?? context.metadata?.documentChats ?? [];

    logRetrievalSkipped(
      this.logger,
      this.name,
      RETRIEVAL_SKIP_REASONS.CONSERVATIVE_RESPONSE,
    );

    const answer = this.conservativeResponseService.getConservativeResponse(
      node.query,
      context.caseName ?? context.caseId ?? '',
      context.clientName ?? context.clientId ?? '',
      documentChats,
      context.chatHistoryContext,
    );

    return Promise.resolve({
      answer,
      strategy: 'conservative',
      confidence: 0.6,
    });
  }
}
