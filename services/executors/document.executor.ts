import { Injectable, Logger } from '@nestjs/common';
import { ConservativeResponseService } from '../conservative-response.service';
import { MetadataService } from '../metadata.service';
import { VectorSearchService } from '../vector-service';
import { WebSearchService } from '../web-search.service';
import { isDocumentScopedQuery } from '../document-scoped-query.util';
import { isExplicitWebSearchQuery } from '../explicit-web-search-query.util';
import { resolveRetrievalProfile } from '../retrieval-profile';
import {
  ExecutionCapability,
  ExecutionContext,
  ExecutionNode,
  ExecutionResult,
  ExecutionTrace,
} from '../../types/execution.interface';
import { Executor } from './executor.interface';
import { classifyRetrievalStrength } from '../retrieval-strength';
import { isClassifyAllDocumentsQuery } from '../platform-starter-query.util';
import { logDebug } from '../request-observability';

@Injectable()
export class DocumentFirstExecutor implements Executor {
  readonly name = 'DocumentFirstExecutor';
  private readonly logger = new Logger(DocumentFirstExecutor.name);

  constructor(
    private readonly vectorSearchService: VectorSearchService,
    private readonly webSearchService: WebSearchService,
    private readonly conservativeResponseService: ConservativeResponseService,
    private readonly metadataService: MetadataService,
  ) {}

  canHandle(capability: ExecutionCapability): boolean {
    return capability === 'DOCUMENT_FIRST';
  }

  async execute(
    node: ExecutionNode,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    if (context.hybridOrigin) {
      logDebug('DOCUMENT_FIRST_EXECUTOR', {
        hybrid_origin: context.hybridOrigin,
      });
    }

    const documentChats =
      context.documentChats ?? context.metadata?.documentChats ?? [];
    const caseName = context.caseName ?? context.caseId ?? '';
    const clientName = context.clientName ?? context.clientId ?? '';

    if (isClassifyAllDocumentsQuery(node.query)) {
      logDebug('DOCUMENT_FIRST_EXECUTOR', {
        route: 'document_classification_metadata',
        documentCount: documentChats.length,
      });

      const specificDocumentId = context.fileName
        ? documentChats.find(
            (dc: any) => dc.Document?.originalName === context.fileName,
          )?.documentId
        : undefined;

      const answer = await this.metadataService.getDocumentClassificationAnswer(
        documentChats,
        specificDocumentId,
        context.chatHistoryContext,
      );

      const references = documentChats.map((dc: any) => ({
        documentId: dc.documentId,
        originalName: dc.Document?.originalName,
        metadata: true,
      }));

      return this.withTrace(
        {
          answer,
          strategy: 'metadata',
          references,
          confidence: 0.9,
        },
        node.capability,
        'YES',
        false,
        'metadata',
        context.hybridOrigin,
      );
    }

    const documentIds = documentChats.map((dc: any) => dc.documentId);

    let chunks = context.chunks ?? [];
    const retrievalProfile = await resolveRetrievalProfile(node.query);
    const retrievalOptions = {
      executor: this.name,
      profile: retrievalProfile,
    };

    if (chunks.length === 0 && documentIds.length > 0) {
      chunks = await this.vectorSearchService.retrieveRankedChunks(
        node.query,
        documentIds,
        context.fileName,
        retrievalOptions,
      );
    }

    const { webSearchConfig } = await import('../web-search-config');
    const config = webSearchConfig;
    const isLegal =
      context.isLegal ??
      (await config.isLegalQuery(node.query).catch(() => false));
    const webSearchAllowed =
      context.webSearchEnabled &&
      config.enabled &&
      (!config.require_legal_domain || isLegal);

    let sufficiencyResult = context.precomputedSufficiency;
    if (!sufficiencyResult && chunks.length > 0) {
      sufficiencyResult = await this.webSearchService.checkSemanticSufficiency(
        chunks,
        node.query,
        { executor: this.name, capability: node.capability },
      );
    }

    const semanticSufficiency = sufficiencyResult?.sufficiency;
    const isDocumentScoped = isDocumentScopedQuery(node.query);
    const explicitWebSearch = isExplicitWebSearchQuery(node.query);
    const acceptedWebSearchOffer =
      context.rewriteIntent === 'accept_web_search_offer';
    const retrievalMetrics = classifyRetrievalStrength(chunks);

    if (
      isDocumentScoped &&
      !explicitWebSearch &&
      !acceptedWebSearchOffer &&
      (semanticSufficiency === 'NO' || chunks.length === 0)
    ) {
      const groundedResult =
        await this.webSearchService.generateDocumentGroundedInsufficiencyAnswer(
          node.query,
          chunks,
          {
            reason: sufficiencyResult?.reason,
          },
          documentChats,
          context.chatHistoryContext,
        );

      return this.withTrace(
        {
          answer: groundedResult.answer,
          strategy: 'vector',
          confidence: 0.6,
        },
        node.capability,
        semanticSufficiency ?? 'NO',
        isLegal,
        'document_insufficient',
        context.hybridOrigin,
        sufficiencyResult?.missingInfo ?? '',
      );
    }

    if (!webSearchAllowed) {
      if (
        retrievalMetrics.strength === 'STRONG' &&
        semanticSufficiency === 'NO'
      ) {
        const groundedResult =
          await this.webSearchService.generateDocumentGroundedInsufficiencyAnswer(
            node.query,
            chunks,
            {
              reason: sufficiencyResult?.reason,
              missingInfo: sufficiencyResult?.missingInfo,
            },
            documentChats,
            context.chatHistoryContext,
          );

        return this.withTrace(
          {
            answer: groundedResult.answer,
            strategy: 'vector',
            confidence: 0.6,
          },
          node.capability,
          semanticSufficiency ?? 'NO',
          isLegal,
          'document_insufficient',
          context.hybridOrigin,
          sufficiencyResult?.missingInfo ?? '',
        );
      }

      if (
        semanticSufficiency === 'NO' ||
        chunks.length === 0 ||
        retrievalMetrics.strength === 'NONE'
      ) {
        const answer = this.conservativeResponseService.getConservativeResponse(
          node.query,
          caseName,
          clientName,
          documentChats,
          context.chatHistoryContext,
        );

        return this.withTrace(
          {
            answer,
            strategy: 'conservative',
            confidence: 0.5,
          },
          node.capability,
          semanticSufficiency,
          isLegal,
          'conservative',
          context.hybridOrigin,
          sufficiencyResult?.missingInfo ?? '',
        );
      }

      const vectorResult = await this.vectorSearchService.processVectorQuery(
        node.query,
        documentIds,
        documentChats,
        context.fileName,
        context.emitPartial ?? (() => {}),
        context.chatHistoryContext,
        { ...retrievalOptions, preloadedChunks: chunks },
      );

      return this.withTrace(
        {
          answer: vectorResult.answer,
          strategy: 'vector',
          references: vectorResult.references,
          confidence: vectorResult.confidence,
        },
        node.capability,
        semanticSufficiency ?? 'YES',
        isLegal,
        'vector',
        context.hybridOrigin,
        sufficiencyResult?.missingInfo ?? '',
      );
    }

    const hybridResult = await this.webSearchService.generateHybridAnswer(
      node.query,
      chunks,
      context.caseId ?? '',
      context.clientId ?? '',
      caseName,
      clientName,
      context.chatHistoryContext,
      webSearchAllowed,
      documentChats,
      sufficiencyResult,
      {
        documentScoped: isDocumentScoped && !acceptedWebSearchOffer,
        skipContextualResolution: context.queryHistoryResolved === true,
      },
    );

    let finalStrategy = 'vector';
    let strategy: string = 'vector';
    if (hybridResult.source_info === 'web_search_only') {
      strategy = 'web_search';
      finalStrategy = 'web_search';
    } else if (hybridResult.source_info === 'vector_search + web_search') {
      strategy = 'vector + web_search';
      finalStrategy = 'vector + web_search';
    } else if (hybridResult.source_info === 'document_insufficient') {
      finalStrategy = 'document_insufficient';
    }

    return this.withTrace(
      {
        answer: hybridResult.answer,
        strategy,
        confidence: 0.8,
      },
      node.capability,
      semanticSufficiency,
      isLegal,
      finalStrategy,
      context.hybridOrigin,
      sufficiencyResult?.missingInfo ?? '',
    );
  }

  private withTrace(
    result: ExecutionResult,
    plannerDecision: ExecutionCapability,
    sufficiency: ExecutionTrace['sufficiency'],
    legalQuery: boolean,
    finalStrategy: string,
    hybridOrigin?: ExecutionContext['hybridOrigin'],
    missingInfo: string = '',
  ): ExecutionResult {
    const trace: ExecutionTrace = {
      plannerDecision,
      executor: this.name,
      sufficiency: sufficiency ?? 'UNSET',
      legalQuery,
      finalStrategy,
    };
    this.logExecutionTrace(trace, hybridOrigin);
    return { ...result, trace };
  }

  private logExecutionTrace(
    trace: ExecutionTrace,
    hybridOrigin?: ExecutionContext['hybridOrigin'],
  ): void {
    logDebug('EXECUTION_TRACE', {
      plannerDecision: trace.plannerDecision,
      executor: trace.executor,
      sufficiency: trace.sufficiency,
      legalQuery: trace.legalQuery,
      finalStrategy: trace.finalStrategy,
      hybridOrigin: hybridOrigin ?? null,
    });
  }
}
