import { Injectable, Logger } from '@nestjs/common';
import { MetadataService } from '../metadata.service';
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
export class TimelineExecutor implements Executor {
  readonly name = 'TimelineExecutor';
  private readonly logger = new Logger(TimelineExecutor.name);

  constructor(private readonly metadataService: MetadataService) {}

  canHandle(capability: ExecutionCapability): boolean {
    return capability === 'CASE_TIMELINE';
  }

  async execute(
    node: ExecutionNode,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const documentChats =
      context.documentChats ?? context.metadata?.documentChats ?? [];

    logRetrievalSkipped(
      this.logger,
      this.name,
      RETRIEVAL_SKIP_REASONS.METADATA_ONLY,
    );

    const answer =
      (await this.metadataService.getChronologicalTimelineAnswer(
        documentChats,
        context.fileName
          ? documentChats.find(
              (dc: any) => dc.Document?.originalName === context.fileName,
            )?.documentId
          : undefined,
        'chronological',
        node.query,
        context.caseId,
        context.clientId,
        context.chatHistoryContext,
      )) ?? 'No chronological timeline information is available.';

    return {
      answer,
      strategy: 'metadata',
      confidence: 0.8,
    };
  }
}
