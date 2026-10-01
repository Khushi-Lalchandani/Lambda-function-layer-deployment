import { Injectable, Logger } from '@nestjs/common';
import { MetadataService } from '../metadata.service';
import { VectorSearchService } from '../vector-service';
import { WebSearchService } from '../web-search.service';
import { shouldUseMetadataSummaryPath } from '../summary-query.util';
import {
  logRetrievalSkipped,
  resolveRetrievalProfile,
  RETRIEVAL_SKIP_REASONS,
} from '../retrieval-profile';
import {
  ExecutionCapability,
  ExecutionContext,
  ExecutionNode,
  ExecutionResult,
  ExecutionTrace,
} from '../../types/execution.interface';
import { Executor } from './executor.interface';
import { logDebug } from '../request-observability';

@Injectable()
export class SummaryExecutor implements Executor {
  readonly name = 'SummaryExecutor';
  private readonly logger = new Logger(SummaryExecutor.name);

  constructor(
    private readonly metadataService: MetadataService,
    private readonly vectorSearchService: VectorSearchService,
    private readonly webSearchService: WebSearchService,
  ) {}

  canHandle(capability: ExecutionCapability): boolean {
    return capability === 'CASE_SUMMARY';
  }

  async execute(
    node: ExecutionNode,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const documentChats =
      context.documentChats ?? context.metadata?.documentChats ?? [];

    if (shouldUseMetadataSummaryPath(node.query, documentChats)) {
      logRetrievalSkipped(
        this.logger,
        this.name,
        RETRIEVAL_SKIP_REASONS.METADATA_SUMMARY_AVAILABLE,
      );

      const answer = await this.metadataService.getMetadataSearchAnswer(
        node.query,
        context.caseId ?? '',
        context.clientId ?? '',
        documentChats,
        context.fileName
          ? documentChats.find(
              (dc: any) => dc.Document?.originalName === context.fileName,
            )?.documentId
          : undefined,
        'analytical',
        context.sessionId,
        context.chatHistoryContext,
      );

      return {
        answer,
        strategy: 'metadata',
        confidence: 0.85,
      };
    }

    const documentIds = documentChats.map((dc: any) => dc.documentId);
    const retrievalProfile = await resolveRetrievalProfile(node.query);
    const retrievalOptions = {
      executor: this.name,
      profile: retrievalProfile,
    };

    const chunks = await this.vectorSearchService.retrieveRankedChunks(
      node.query,
      documentIds,
      context.fileName,
      retrievalOptions,
    );

    let sufficiencyResult:
      | { sufficiency: 'YES' | 'PARTIAL' | 'NO'; reason: string; missingInfo?: string }
      | undefined;
    if (chunks.length > 0) {
      sufficiencyResult = await this.webSearchService.checkSemanticSufficiency(
        chunks,
        node.query,
        { executor: this.name, capability: node.capability },
      );
    }

    const vectorResult = await this.vectorSearchService.processVectorQuery(
      node.query,
      documentIds,
      documentChats,
      context.fileName,
      context.emitPartial ?? (() => {}),
      context.chatHistoryContext,
      {
        ...retrievalOptions,
        preloadedChunks: chunks,
      },
    );

    const trace: ExecutionTrace = {
      plannerDecision: node.capability,
      executor: this.name,
      sufficiency: sufficiencyResult?.sufficiency ?? 'UNSET',
      finalStrategy: 'vector',
    };
    this.logExecutionTrace(trace);

    return {
      answer: vectorResult.answer,
      strategy: 'vector',
      references: vectorResult.references,
      confidence: vectorResult.confidence,
      trace,
    };
  }

  private logExecutionTrace(trace: ExecutionTrace): void {
    logDebug('EXECUTION_TRACE', trace);
  }
}
