import { Injectable, Logger } from '@nestjs/common';
import { HybridRetrievalService } from '../hybrid-retrieval.service';
import { WebSearchService } from '../web-search.service';
import {
  logRetrievalSkipped,
  RETRIEVAL_SKIP_REASONS,
} from '../retrieval-profile';
import { resolveWebFirstStrategy } from '../web-first-probe';
import {
  ExecutionCapability,
  ExecutionContext,
  ExecutionNode,
  ExecutionResult,
  ExecutionTrace,
} from '../../types/execution.interface';
import { DocumentFirstExecutor } from './document.executor';
import { Executor } from './executor.interface';
import { logDebug } from '../request-observability';

@Injectable()
export class WebFirstExecutor implements Executor {
  readonly name = 'WebFirstExecutor';
  private readonly logger = new Logger(WebFirstExecutor.name);

  constructor(
    private readonly webSearchService: WebSearchService,
    private readonly hybridRetrievalService: HybridRetrievalService,
    private readonly documentFirstExecutor: DocumentFirstExecutor,
  ) {}

  canHandle(capability: ExecutionCapability): boolean {
    return capability === 'WEB_FIRST';
  }

  async execute(
    node: ExecutionNode,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const documentChats =
      context.documentChats ?? context.metadata?.documentChats ?? [];
    const documentIds = documentChats.map((dc: any) => dc.documentId);

    const resolution = await resolveWebFirstStrategy(
      node.query,
      documentIds,
      context.fileName,
      this.hybridRetrievalService,
    );
    logDebug('WEB_FIRST_PROBE', resolution.probe);

    if (resolution.action === 'redirect_document_first') {
      return this.documentFirstExecutor.execute(node, {
        ...context,
        hybridOrigin: 'probe_redirect',
      });
    }

    logRetrievalSkipped(
      this.logger,
      this.name,
      RETRIEVAL_SKIP_REASONS.WEB_SEARCH_ONLY,
    );

    const answer = await this.webSearchService.searchWithGrounding(
      node.query,
      context.caseName ?? context.caseId,
      context.clientName ?? context.clientId,
      undefined,
      context.chatHistoryContext,
    );

    const trace: ExecutionTrace = {
      plannerDecision: node.capability,
      executor: this.name,
      finalStrategy: 'web_search',
    };
    this.logExecutionTrace(trace);

    return {
      answer,
      strategy: 'web_search',
      confidence: 0.75,
      trace,
    };
  }

  private logExecutionTrace(trace: ExecutionTrace): void {
    logDebug('EXECUTION_TRACE', trace);
  }
}
