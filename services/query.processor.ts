import { Injectable, Logger } from '@nestjs/common';
import { getLlmGateway } from './llm-gateway.service';
import { GEMINI_3_1_FLASH_LITE } from './llm-model.constants';
import { BackendService } from './backend.service';
import { ConservativeResponseService } from './conservative-response.service';
import { VectorSearchService } from './vector-service';
import { MetadataService } from './metadata.service';
import { WebSearchService } from './web-search.service';
import { AnswerRefinementService } from './answer-refinement.service';
import {
  QueryDecompositionResult,
  UnifiedQueryAnalysis,
} from '../types/chat.interface';
import { PromptTemplateService } from './prompt-template.service';
import {
  hasChronologyIntent,
  isChronologyOnlyQuery,
} from './chronology-query.util';
import { QueryRewriteService } from './query-rewrite.service';
import { queryRewriteConfig } from './query-rewrite-config';
import { QueryDecompositionService } from './query-decomposition.service';
import { queryDecompositionConfig } from './query-decomposition-config';
import { PlannerService } from './planner.service';
import { plannerConfig } from './planner-config';
import { ExecutionGraphService } from './execution-graph.service';
import { executionConfig } from './execution-config';
import { ExecutionOrchestratorService } from './execution-orchestrator.service';
import { ConversationMemoryService } from './conversation-memory.service';
import { AggregationService } from './aggregation.service';
import { ExecutorResult, ExecutionContext } from '../types/execution.interface';
import { logRolloutStatus } from './rollout-config';
import { RolloutObservabilityService } from './rollout-observability.service';
import {
  buildCombinedHistoryText,
  buildSummarySection,
} from './conversation-history.util';
import { ChatMessage } from '../types/chat.interface';
import { PlannerResult } from '../types/planner.interface';
import { isClassifyAllDocumentsQuery, isPlatformStarterQuery } from './platform-starter-query.util';
import { isDebugEnabled } from './logging-config';
import {
  logDebug,
  logObservabilityError,
  getRequestContext,
  logPlannerDecision,
  logRequestEnd,
  logRequestStart,
  mapExecutorStrategyToFinalStrategy,
  recordTiming,
  runWithRequestObservability,
} from './request-observability';

@Injectable()
export class QueryProcessorService {
  private readonly logger = new Logger(QueryProcessorService.name);
  private readonly llm = getLlmGateway();

  // Simple in-memory cache for query analysis results
  private queryAnalysisCache = new Map<string, UnifiedQueryAnalysis>();
  private metadataContextCache = new Map<string, string>();
  private userCache = new Map<string, any>();
  private chatCache = new Map<string, any>();
  private readonly MAX_CACHE_SIZE = 1000; // Prevent memory leaks

  private logPipelineDebug(stage: string, payload: Record<string, unknown>): void {
    if (!isDebugEnabled()) {
      return;
    }
    try {
      logDebug(`DEBUG_PIPELINE_${stage}`, payload);
    } catch {
      logDebug(`DEBUG_PIPELINE_${stage}`, { error: 'serialization_failed' });
    }
  }

  private logRolloutRuntime(payload: {
    originalQuery: string;
    rewrittenQuery: string;
    rewriteApplied: boolean;
    decompositionApplied: boolean;
    subQueryCount: number;
  }): void {
    this.logPipelineDebug('ROLLOUT', {
      originalQuery: payload.originalQuery,
      rewrittenQuery: payload.rewrittenQuery,
      rewriteApplied: payload.rewriteApplied,
      decompositionApplied: payload.decompositionApplied,
      subQueryCount: payload.subQueryCount,
      executionGraphActive: executionConfig.enableExecutionGraph,
      legacyRoutingEnabled: executionConfig.useLegacyRouting,
    });
  }

  constructor(
    private readonly backendService: BackendService,
    private readonly conservativeResponseService: ConservativeResponseService,
    private readonly vectorSearchService: VectorSearchService,
    private readonly metaDataService: MetadataService,
    private readonly webSearchService: WebSearchService,
    private readonly answerRefinementService: AnswerRefinementService,
    private readonly promptTemplateService: PromptTemplateService,
    private readonly queryRewriteService: QueryRewriteService,
    private readonly queryDecompositionService: QueryDecompositionService,
    private readonly plannerService: PlannerService,
    private readonly executionGraphService: ExecutionGraphService,
    private readonly executionOrchestratorService: ExecutionOrchestratorService,
    private readonly conversationMemoryService: ConversationMemoryService,
    private readonly aggregationService: AggregationService,
    private readonly rolloutObservabilityService: RolloutObservabilityService = new RolloutObservabilityService(),
  ) {
    logRolloutStatus(this.logger);
  }

  async processQuery(
    chatId: string,
    question: string,
    user: any,
    firmId: string,
    caseId: string,
    clientId: string,
    fileName: string | undefined,
    sessionId: string,
    emitPartial: (partial: any) => void,
    emitError: (error: any) => void,
  ) {
    return runWithRequestObservability({ chatId, query: question }, async () => {
      try {
        logRequestStart();
      // Check cache first, then parallelize database calls for better performance
      const userCacheKey = `user_${user.id}`;
      const chatCacheKey = `chat_${chatId}`;

      let userRecord = this.userCache.get(userCacheKey);
      let chat = this.chatCache.get(chatCacheKey);

      // Fetch missing data - use BackendService REST API calls
      if (!chat) {
        const chatResponse = await this.backendService.getChatForAI(chatId);
        if (chatResponse.success && chatResponse.data) {
          chat = chatResponse.data;
          this.setCacheValue(this.chatCache, chatCacheKey, chat);
        }
      }

      // User validation - user object is already provided from token validation
      // Just verify firmId matches
      if (!user || !user.firmId || user.firmId !== firmId) {
        throw new Error(`User ${user?.id} not associated with firm ${firmId}`);
      }
      userRecord = user; // Use provided user object

      if (!chat) {
        throw new Error(`Chat ${chatId} not found`);
      }
      const documentIds = chat.documentChats.map((dc: any) => dc.documentId);
      if (!documentIds.length) {
        throw new Error(`No documents associated with chat ${chatId}`);
      }

      let caseName = caseId;
      let clientName = clientId;

      if (chat.documentChats.length > 0) {
        const firstDoc = chat.documentChats[0].Document;
        if (firstDoc.case) {
          caseName = firstDoc.case.caseName || caseId;
          if (firstDoc.case.client) {
            clientName = firstDoc.case.client.fullName?.trim() || '';
          }
        } else if (firstDoc.client) {
          clientName = firstDoc.client.fullName?.trim() || '';
        }
      }

      const conversationMemory =
        await this.conversationMemoryService.getConversationMemory(chatId);
      const conversationSummary = conversationMemory.summary ?? null;
      const chatMessages = conversationMemory.recentMessages;
      const recentHistoryText = conversationMemory.recentHistoryText;
      const chatHistoryContext = buildCombinedHistoryText(
        conversationSummary,
        chatMessages,
      );
      const chatHistoryContextLength = chatHistoryContext?.length ?? 0;
      const maxHistoryLogLength = 4000;
      const chatHistoryContextForLog =
        chatHistoryContextLength > maxHistoryLogLength
          ? `${chatHistoryContext.slice(0, maxHistoryLogLength)}\n...[truncated ${
              chatHistoryContextLength - maxHistoryLogLength
            } chars]`
          : chatHistoryContext;

      this.logPipelineDebug('CONVERSATION_MEMORY', {
        hasConversationSummary: Boolean(conversationSummary),
        recentMessageCount: chatMessages.length,
        summaryLength: conversationSummary?.length ?? 0,
        historyContextLength: chatHistoryContextLength,
        historyContext: chatHistoryContextForLog,
      });

      if (isClassifyAllDocumentsQuery(question)) {
        return this.respondWithDocumentClassification({
          chatId,
          question,
          documentChats: chat.documentChats,
          fileName,
          sessionId,
          chatHistoryContext: chatHistoryContext || undefined,
          emitPartial,
        });
      }

      const preprocessingStart = Date.now();

      const rewriteResult = await this.queryRewriteService.rewrite(
        question,
        chatMessages.length > 0 ? chatMessages : undefined,
        {
          caseName,
          clientName,
          documentChats: chat.documentChats,
          conversationSummary: conversationSummary ?? undefined,
        },
      );
      this.logPipelineDebug('QUERY_REWRITE', {
        originalQuery: rewriteResult.originalQuery,
        rewrittenQuery: rewriteResult.rewrittenQuery,
        wasRewritten: rewriteResult.wasRewritten,
        rewriteReason: rewriteResult.rewriteReason ?? null,
        rewriteIntent: rewriteResult.intent ?? null,
        historyUsed: rewriteResult.historyUsed ?? false,
        enableQueryRewrite: queryRewriteConfig.enableQueryRewrite,
      });

      const pipelineQuery =
        queryRewriteConfig.enableQueryRewrite && rewriteResult.wasRewritten
          ? rewriteResult.rewrittenQuery
          : rewriteResult.originalQuery;

      const decompositionEnabled =
        queryDecompositionConfig.enableQueryDecomposition;
      const decompositionResult: QueryDecompositionResult = decompositionEnabled
        ? await this.queryDecompositionService.decompose(
            pipelineQuery,
            chatMessages.length > 0 ? chatMessages : undefined,
            {
              caseName,
              clientName,
              documentChats: chat.documentChats,
              conversationSummary: conversationSummary ?? undefined,
            },
          )
        : {
            originalQuery: pipelineQuery,
            shouldDecompose: false,
            subQueries: [],
            decompositionReason: 'feature_disabled',
          };
      if (decompositionEnabled) {
        this.queryDecompositionService.logDecompositionResult(decompositionResult);
      }
      this.logPipelineDebug('QUERY_DECOMPOSITION', {
        originalQuery: decompositionResult.originalQuery,
        shouldDecompose: decompositionResult.shouldDecompose,
        subQueries: decompositionResult.subQueries,
        decompositionReason: decompositionResult.decompositionReason ?? null,
        enableQueryDecomposition: decompositionEnabled,
        pipelineQueryUnchanged: pipelineQuery,
      });

      const decompositionApplied =
        decompositionEnabled &&
        decompositionResult.shouldDecompose &&
        decompositionResult.subQueries.length >= 2;

      this.logRolloutRuntime({
        originalQuery: rewriteResult.originalQuery,
        rewrittenQuery: rewriteResult.rewrittenQuery,
        rewriteApplied:
          queryRewriteConfig.enableQueryRewrite && rewriteResult.wasRewritten,
        decompositionApplied,
        subQueryCount: decompositionApplied
          ? decompositionResult.subQueries.length
          : 1,
      });

      const plannerSubQueries = decompositionApplied
        ? decompositionResult.subQueries
        : [rewriteResult.rewrittenQuery];

      const plannerResults = await this.plannerService.planAll(
        rewriteResult.rewrittenQuery,
        plannerSubQueries,
        chatMessages.length > 0 ? chatMessages : undefined,
        conversationSummary,
      );
      const primaryPlannerAction = plannerResults
        .flatMap((result) => result.actions)[0];
      const primaryPlannerResult =
        plannerResults.find((result) => result.actions.length > 0) ??
        plannerResults[0];
      logPlannerDecision({
        plannerCapability: primaryPlannerAction?.tool ?? 'none',
        confidence: primaryPlannerResult?.confidence ?? 'low',
      });
      for (const plannerResult of plannerResults) {
        this.plannerService.logPlannerResult(plannerResult);
      }
      this.logPipelineDebug('PLANNER', {
        originalQuery: rewriteResult.rewrittenQuery,
        subQueries: plannerSubQueries,
        plannerResults: plannerResults.map((result) => ({
          subQuery: result.subQuery,
          actions: result.actions,
          confidence: result.confidence,
        })),
        enablePlanner: plannerConfig.enablePlanner,
        enablePlannerShadow: plannerConfig.enablePlannerShadow,
      });

      this.executionGraphService.logShadowExecution(
        rewriteResult.rewrittenQuery,
        plannerResults,
        decompositionResult,
      );
      this.logPipelineDebug('EXECUTION_GRAPH', {
        ...this.executionGraphService.buildShadowLog(
          rewriteResult.rewrittenQuery,
          plannerResults,
          decompositionResult,
        ),
        enableExecutionGraph: executionConfig.enableExecutionGraph,
        enableExecutionGraphShadow: executionConfig.enableExecutionGraphShadow,
        useLegacyRouting: executionConfig.useLegacyRouting,
        enableLegacyShadow: executionConfig.enableLegacyShadow,
      });

      const executionGraph = this.executionGraphService.buildGraph(
        plannerResults,
        decompositionResult,
      );

      recordTiming('preprocessingMs', Date.now() - preprocessingStart);

      const webSearchModule = await import('./web-search-config');
      const platformStarterQuery = isPlatformStarterQuery(question);
      const executionIsLegal = platformStarterQuery
        ? false
        : await webSearchModule.webSearchConfig
            .isLegalQuery(pipelineQuery)
            .catch(() => false);
      const executionContext: ExecutionContext = {
        userId: user.id,
        caseId,
        clientId,
        caseName,
        clientName,
        history: chatMessages,
        documentChats: chat.documentChats,
        fileName,
        sessionId,
        webSearchEnabled: platformStarterQuery
          ? false
          : webSearchModule.webSearchConfig.enabled,
        chatHistoryContext: chatHistoryContext || undefined,
        rewriteIntent: rewriteResult.intent,
        isLegal: executionIsLegal,
        queryHistoryResolved:
          rewriteResult.historyUsed === true || rewriteResult.wasRewritten,
      };
      if (!executionConfig.useLegacyRouting) {
        const orchestrationResult =
          await this.executionOrchestratorService.executeGraph(executionGraph, {
            ...executionContext,
            emitPartial,
          });

        const primaryStrategy =
          orchestrationResult.aggregated.strategies[0] ?? 'vector';
        const primaryExecutor =
          orchestrationResult.aggregated.executors[0] ?? 'unknown';

        emitPartial({
          answer: orchestrationResult.finalAnswer,
          references: [],
          chatId,
          isPartial: false,
          strategy: {
            strategy: primaryStrategy,
            reasoning: 'Execution graph orchestration',
            confidence: 0.85,
          },
        });

        this.storeChatHistory(
          chatId,
          question,
          orchestrationResult.finalAnswer,
          primaryStrategy,
          0.85,
          fileName,
          sessionId,
        ).catch((error) => {
          this.logger.error(
            `Failed to store orchestrated chat history: ${error.message}`,
          );
        });

        this.rolloutObservabilityService.observeExecutionOutcome(
          pipelineQuery,
          plannerResults,
          primaryStrategy,
          primaryExecutor,
        );

        const response = {
          answer: orchestrationResult.finalAnswer,
          references: [],
          chatId,
          strategy: {
            strategy: primaryStrategy,
            reasoning: 'Execution graph orchestration',
            confidence: 0.85,
          },
          original_query: question,
          enhanced_query: pipelineQuery,
          enhancement_applied: false,
          query_type: 'analytical',
          executors: orchestrationResult.aggregated.executors,
          strategies: orchestrationResult.aggregated.strategies,
        };
        logRequestEnd({
          finalStrategy: mapExecutorStrategyToFinalStrategy(primaryStrategy),
          executor: primaryExecutor,
          sourceInfo: getRequestContext()?.sourceInfo ?? primaryStrategy,
        });
        return response;
      }

      // Emergency rollback — legacy routing (USE_LEGACY_ROUTING=true)
      // Early return for simple greeting queries to avoid unnecessary processing
      if (this.conservativeResponseService.isGreetingQuery(pipelineQuery)) {
        const greetingAnswer =
          this.conservativeResponseService.getGreetingResponse(
            pipelineQuery,
            caseName,
            clientName,
            chat.documentChats,
          );

        emitPartial({
          answer: greetingAnswer,
          references: [],
          chatId,
          isPartial: false,
          strategy: {
            strategy: 'greeting',
            reasoning: 'Detected greeting pattern',
            confidence: 0.9,
          },
        });

        // Store in background
        this.storeChatHistory(
          chatId,
          question,
          greetingAnswer,
          'greeting',
          0.9,
          fileName,
          sessionId,
        ).catch((error) => {
          this.logger.error(
            `Failed to store greeting history in background: ${error.message}`,
          );
        });

        this.logPlannerComparison(pipelineQuery, 'greeting', plannerResults);

        const greetingResponse = {
          answer: greetingAnswer,
          references: [],
          chatId,
          strategy: {
            strategy: 'greeting',
            reasoning: 'Detected greeting pattern',
            confidence: 0.9,
          },
          original_query: question,
          enhanced_query: question,
          enhancement_applied: false,
          query_type: 'greeting',
        };
        logRequestEnd({
          finalStrategy: 'document_only',
          executor: 'GreetingExecutor',
          sourceInfo: 'greeting',
        });
        return greetingResponse;
      }

      if (decompositionApplied) {
        return this.processDecomposedLegacyQueries({
          chatId,
          question,
          pipelineQuery,
          subQueries: decompositionResult.subQueries,
          caseId,
          clientId,
          caseName,
          clientName,
          documentChats: chat.documentChats,
          fileName,
          sessionId,
          chatHistoryContext,
          conversationSummary,
          recentHistoryText,
          emitPartial,
          plannerResults,
        });
      }

      // Step 1: Unified query analysis and enhancement
      const analysisResult = await this.detectQueryIntentAndEnhance(
        pipelineQuery,
        caseName,
        clientName,
        chat.documentChats,
        emitError,
        recentHistoryText || undefined,
        conversationSummary,
      );
      let enhancedQuery = analysisResult.enhanced_query;
      let strategy = analysisResult.strategy;
      const llmSuggestedStrategy = analysisResult.strategy;
      const reasoning = analysisResult.reasoning;
      const confidence = analysisResult.confidence;
      const queryType = analysisResult.query_type;
      const enhancementApplied =
        analysisResult.enhanced_query !== analysisResult.original_query;
      const isDocumentScopedRequest = this.isDocumentScopedRequest(
        pipelineQuery,
        enhancedQuery,
        fileName,
      );

      const chronologyOnly = isChronologyOnlyQuery(pipelineQuery);

      if (chronologyOnly) {
        strategy = 'metadata';
      }
      const specificDocumentId = fileName
        ? chat.documentChats.find(
          (dc: any) => dc.Document.originalName === fileName,
        )?.documentId
        : undefined;

      // Check if query is asking for summary and if metadata has summary data
      // This should happen BEFORE vector search to match Python flow
      const isSummaryQuery = this.isSummaryQuery(pipelineQuery);
      const hasMetadataSummary = this.hasMetadataSummary(chat.documentChats);

      if (
        !chronologyOnly &&
        isSummaryQuery &&
        hasMetadataSummary
      ) {
        strategy = 'metadata';
      } else if (
        !chronologyOnly &&
        pipelineQuery.trim().toLowerCase() === 'summary'
      ) {
        strategy = 'metadata';
        enhancedQuery =
          'Provide a summary of the case based on the available documents.';
      }

      const postClassificationOverrideApplied = strategy !== llmSuggestedStrategy;
      this.logPipelineDebug('CLASSIFICATION', {
        query: pipelineQuery,
        enhancedQuery,
        queryType,
        llmSuggestedStrategy,
        effectiveStrategy: strategy,
        postClassificationOverrideApplied,
        chronologyOnly,
        isSummaryQuery,
        hasMetadataSummary,
        isDocumentScopedRequest,
      });

      // PARALLELIZATION: Fetch vector chunks and check legal query in parallel
      // These operations are independent and can run simultaneously
      const { webSearchConfig } = await import('./web-search-config');
      const config = webSearchConfig;

      let chunks: any[] = [];
      let isLegal = false;

      // FIX #2: ALWAYS run vector search first for non-greeting/metadata queries
      // Web search decision happens AFTER semantic sufficiency check, not before
      const shouldFetchChunks =
        strategy !== 'greeting' &&
        strategy !== 'metadata';
      // Note: Even if AI suggested web_search, we still fetch chunks first to check if vector can answer

      if (shouldFetchChunks) {
        const documentIds = chat.documentChats.map((dc: any) => dc.documentId);

        // Run vector search and legal query detection in parallel
        const [chunksResult, legalResult] = await Promise.allSettled([
          // Vector search
          documentIds.length > 0
            ? this.vectorSearchService.retrieveRankedChunks(
              enhancedQuery,
              documentIds,
              fileName,
            )
            : Promise.resolve([]),
          // Legal query detection
          config.isLegalQuery(enhancedQuery).catch(() => false),
        ]);

        // Process vector search results
        if (chunksResult.status === 'fulfilled') {
          chunks = chunksResult.value;
        }

        // Process legal query detection results
        if (legalResult.status === 'fulfilled') {
          isLegal = legalResult.value;
        } else {
          isLegal = false;
        }

      } else {
        // If we don't need chunks, still check legal query (might be needed for web search decision)
        try {
          isLegal = await config.isLegalQuery(enhancedQuery);
        } catch (error) {
          isLegal = false;
        }

      }

      // NOTE: Legal query detection is ONLY used for web search decisions.
      // All queries (except greetings) are allowed to search documents.
      // Legal query check is performed later when deciding whether to use web search.

      // STEP 3: Semantic Sufficiency Check (replaces chunk count/length gates)
      // Store the full result including missingInfo for reuse in hybrid answer generation
      let semanticSufficiency: 'YES' | 'PARTIAL' | 'NO' | undefined;
      let sufficiencyResult: { sufficiency: 'YES' | 'PARTIAL' | 'NO'; reason: string; missingInfo?: string } | undefined;
      if (shouldFetchChunks && chunks.length > 0) {
        sufficiencyResult = await this.webSearchService.checkSemanticSufficiency(
          chunks,
          enhancedQuery,
        );
        semanticSufficiency = sufficiencyResult.sufficiency;
      }

      // Keep chunk count/length as weak heuristic signal (not gate)
      const totalLength = chunks.reduce(
        (sum, chunk) => sum + (chunk?.content?.length || 0),
        0,
      );
      const chunksMeetThresholds =
        chunks.length >= config.min_chunks_threshold &&
        totalLength >= config.min_chunk_length;

      // FIX #3: Strategy decision happens ONLY AFTER semantic sufficiency check
      // Web search is NEVER decided before vector search
      // NOTE: Legal query detection is ONLY used for web search decisions, not for blocking document search
      let finalStrategy: 'greeting' | 'metadata' | 'vector' | 'web_search' | 'conservative' | 'vector + web_search' = strategy;
      if (strategy === 'greeting') {
        finalStrategy = 'greeting';
      } else if (strategy === 'metadata') {
        finalStrategy = 'metadata';
      } else {
        // For ALL other queries (including ones AI suggested as web_search),
        // decision is based on semantic sufficiency of vector search results
        if (semanticSufficiency === 'YES') {
          finalStrategy = 'vector';
        } else if (semanticSufficiency === 'PARTIAL') {
          // PARTIAL: Use vector but may trigger hybrid with web search
          finalStrategy = 'vector';
        } else if (semanticSufficiency === 'NO') {
          // NO: Documents don't have sufficient information
          // Still try vector search first (may provide partial answer)
          // Then fall back to web search if enabled and legal, otherwise conservative
          finalStrategy = 'vector'; // Always try documents first
        } else {
          // Fallback when sufficiency undefined: use chunk thresholds as weak signal
          // Always prefer documents (vector) over web search
          if (chunksMeetThresholds) {
            finalStrategy = 'vector';
          } else {
            // Even if chunks don't meet thresholds, try vector search first
            // Web search will be considered in hybrid answer generation if needed
            finalStrategy = 'vector';
          }
        }
      }
      this.logPipelineDebug('RETRIEVAL_ROUTING', {
        query: pipelineQuery,
        enhancedQuery,
        shouldFetchChunks,
        chunksCount: chunks.length,
        semanticSufficiency: semanticSufficiency ?? 'UNSET',
        semanticReason: sufficiencyResult?.reason ?? '',
        missingInfo: sufficiencyResult?.missingInfo ?? '',
        isLegal,
        strategyBeforeRouting: strategy,
        finalStrategyAfterRouting: finalStrategy,
      });

      let answer: string;
      let references: any[];
      let finalResult: any;

      // Step 2: Process based on final strategy
      switch (finalStrategy as 'greeting' | 'metadata' | 'vector' | 'web_search' | 'conservative' | 'vector + web_search') {
        case 'greeting':
          answer = this.conservativeResponseService.getGreetingResponse(
            enhancedQuery,
            caseName,
            clientName,
            chat.documentChats,
          );
          references = [];
          emitPartial({
            answer,
            references,
            chatId,
            isPartial: false,
            strategy: { strategy: finalStrategy, reasoning, confidence },
          });
          break;
        case 'vector':
          let multipleRewriteResult: {
            original_query: string;
            rewritten_queries: string[];
            answer: string;
            strategy: string;
            reasoning: string;
            confidence: number;
            queries_used: number;
          };

          // FIX #4: Rewrite ONLY when:
          // - strategy === 'vector' (already in this case)
          // - chunks.length > 0 (we have some document content)
          // - sufficiency === 'YES' (pure vector search - rewrites help find best query)
          // Skip rewrites for PARTIAL/NO since web search will be needed anyway
          // This reduces parallel vector load and Gemini API pressure
          const shouldRewrite =
            chunks.length > 0 &&
            semanticSufficiency === 'YES' &&
            !isDocumentScopedRequest;

          if (shouldRewrite) {
            // Full rewriting pipeline - generates multiple query variations
            // Pass already-retrieved chunks so the inner pipeline skips a second retrieval + LLM rerank
            multipleRewriteResult =
              await this.processQueryWithMultipleRewrites(
                enhancedQuery,
                caseId,
                clientId,
                caseName,
                clientName,
                chat.documentChats,
                fileName,
                chatHistoryContext || undefined,
                sessionId,
                chunks,
                isDocumentScopedRequest,
                conversationSummary,
                recentHistoryText,
              );
          } else {
            // Skip rewriting - use single query directly (saves LLM calls)
            // Pass already-retrieved chunks to avoid a second retrieval + LLM rerank
            const singleResult = await this.processSingleQueryThroughPipeline(
              enhancedQuery,
              caseId,
              clientId,
              caseName,
              clientName,
              chat.documentChats,
              fileName,
              chatHistoryContext || undefined,
              sessionId,
              false,
              chunks,
              isDocumentScopedRequest,
              conversationSummary,
              recentHistoryText,
            );
            multipleRewriteResult = {
              original_query: enhancedQuery,
              rewritten_queries: [enhancedQuery],
              answer: singleResult.answer,
              strategy: singleResult.strategy,
              reasoning: singleResult.reasoning,
              confidence: singleResult.confidence,
              queries_used: 1,
            };
          }

          answer = multipleRewriteResult.answer;

          // NOTE: processSingleQueryThroughPipeline already handles hybrid answers (web search + synthesis)
          // and answer refinement, so we don't need to call generateHybridAnswer again here.
          // The answer from multipleRewriteResult is already the final hybrid answer if needed.
          // Update finalStrategy based on the result from processSingleQueryThroughPipeline
          // which already handles hybrid answers and sets the strategy accordingly
          if (multipleRewriteResult.strategy === 'vector + web_search' ||
            multipleRewriteResult.strategy === 'web_search') {
            finalStrategy = multipleRewriteResult.strategy;
          }
          this.logPipelineDebug('ANSWER_MERGE', {
            mergeType: 'vector_pipeline_result',
            multipleRewriteStrategy: multipleRewriteResult.strategy,
            finalStrategy,
            queriesUsed: multipleRewriteResult.queries_used,
          });

          references = chat.documentChats.map((dc: any) => ({
            documentId: dc.documentId,
            originalName: dc.Document.originalName,
            relevance: multipleRewriteResult.confidence,
          }));
          finalResult = {
            ...multipleRewriteResult,
            strategy: { strategy: finalStrategy, reasoning, confidence },
          };
          emitPartial({
            answer,
            references,
            chatId,
            isPartial: false,
            strategy: { strategy: finalStrategy, reasoning, confidence },
            rewritten_queries: multipleRewriteResult.rewritten_queries,
            queries_used: multipleRewriteResult.queries_used,
          });
          break;
        case 'metadata':
          if (chronologyOnly || hasChronologyIntent(pipelineQuery, queryType)) {
            answer =
              (await this.metaDataService.getChronologicalTimelineAnswer(
                chat.documentChats,
                specificDocumentId,
                queryType,
                pipelineQuery,
                caseId,
                clientId,
                chatHistoryContext || undefined,
              )) ?? '';

            if (!answer.trim()) {
              const fallbackResult =
                await this.processSingleQueryThroughPipeline(
                  pipelineQuery,
                  caseId,
                  clientId,
                  caseName,
                  clientName,
                  chat.documentChats,
                  fileName,
                  chatHistoryContext || undefined,
                  sessionId,
                  false,
                  undefined,
                  isDocumentScopedRequest,
                  conversationSummary,
                  recentHistoryText,
                );
              answer = fallbackResult.answer;
              finalStrategy =
                fallbackResult.strategy as typeof finalStrategy;
            }
          } else {
            answer = await this.metaDataService.getMetadataSearchAnswer(
              enhancedQuery,
              caseId,
              clientId,
              chat.documentChats,
              specificDocumentId,
              queryType,
              sessionId,
              chatHistoryContext,
            );
          }
          references = chat.documentChats.map((dc: any) => ({
            documentId: dc.documentId,
            originalName: dc.Document.originalName,
            metadata: true,
          }));
          emitPartial({
            answer,
            references,
            chatId,
            isPartial: false,
            strategy: { strategy: finalStrategy, reasoning, confidence },
          });
          break;
        case 'web_search':
          answer = await this.webSearchService.searchWithGrounding(
            enhancedQuery,
            caseName,
            clientName,
            undefined,
            chatHistoryContext || undefined,
          );
          references = [];
          emitPartial({
            answer,
            references,
            chatId,
            isPartial: false,
            strategy: { strategy: finalStrategy, reasoning, confidence },
          });
          break;
        case 'conservative':
        default:
          answer = this.conservativeResponseService.getConservativeResponse(
            enhancedQuery,
            caseName,
            clientName,
            chat.documentChats,
            chatHistoryContext || undefined,
          );
          references = [];
          emitPartial({
            answer,
            references,
            chatId,
            isPartial: false,
            strategy: { strategy: finalStrategy, reasoning, confidence },
          });
          break;
      }

      this.logPlannerComparison(pipelineQuery, finalStrategy, plannerResults);

      this.storeChatHistory(
        chatId,
        question,
        answer,
        finalStrategy,
        confidence,
        fileName,
        sessionId,
      ).catch((error) => {
        this.logger.error(
          `Failed to store chat history in background: ${error.message}`,
        );
      });

      // Step 3: Clean answer for final result
      // NOTE: Answers from processSingleQueryThroughPipeline are already refined,
      // so we only need to deduplicate here (fast operation)
      answer = this.vectorSearchService.deduplicateAnswer(answer);
      const baseResult = {
        answer,
        references,
        chatId,
        strategy: { strategy: finalStrategy, reasoning, confidence },
        original_query: analysisResult.original_query,
        enhanced_query: enhancedQuery,
        enhancement_applied: enhancementApplied,
        query_type: queryType,
      };


      if (finalResult && finalResult.rewritten_queries) {
        const rewriteResponse = {
          ...baseResult,
          rewritten_queries: finalResult.rewritten_queries,
          queries_used: finalResult.queries_used,
        };
        logRequestEnd({
          finalStrategy: mapExecutorStrategyToFinalStrategy(finalStrategy),
          executor: 'LegacyRouting',
          sourceInfo: finalStrategy,
        });
        return rewriteResponse;
      }
      logRequestEnd({
        finalStrategy: mapExecutorStrategyToFinalStrategy(finalStrategy),
        executor: 'LegacyRouting',
        sourceInfo: finalStrategy,
      });
      return baseResult;
    } catch (error) {
      logObservabilityError('QueryProcessorService.processQuery', error);
      emitError({
        success: false,
        message: error.message || 'Failed to process query',
      });
      throw error;
    }
    });
  }

  private async detectQueryIntentAndEnhance(
    query: string,
    caseId: string,
    clientId: string,
    documentChats: any[],
    emitError: (error: any) => void,
    recentHistoryText?: string,
    conversationSummary?: string | null,
  ): Promise<UnifiedQueryAnalysis> {
    const historyCacheFragment = (recentHistoryText ?? '')
      .split('\n')
      .slice(-6)
      .join('\n')
      .toLowerCase()
      .trim();
    const cacheKey = `${query.toLowerCase().trim()}_${documentChats.length}_${historyCacheFragment}`;

    if (this.queryAnalysisCache.has(cacheKey)) {
      return this.queryAnalysisCache.get(cacheKey)!;
    }

    const maxRetries = 3;
    let retryCount = 0;
    let hasDocuments = documentChats.length > 0;
    while (retryCount <= maxRetries) {
      try {
      // Get case metadata for context with caching (for understanding only)
        const metadataContextKey = `${caseId}_${clientId}_${documentChats.length}`;
        let metadataContext: string;

        if (this.metadataContextCache.has(metadataContextKey)) {
          metadataContext = this.metadataContextCache.get(metadataContextKey)!;
        } else {
          metadataContext = await this.metaDataService.buildMetadataContext(
            documentChats,
          );
          this.setCacheValue(
            this.metadataContextCache,
            metadataContextKey,
            metadataContext,
          );
        }
        const summarySection = buildSummarySection(conversationSummary);
        const historySection = recentHistoryText
          ? this.promptTemplateService.renderTemplate(
            'query-history-section.txt',
            { chatHistory: recentHistoryText },
          )
          : '';

        // Single AI call to analyze and enhance the query
        const metadataContextSection = metadataContext
          ? `Case Context (for your understanding ONLY - DO NOT copy any specific names, scheme titles, section numbers, years, or party identifiers from this context into the enhanced_query unless they appear explicitly in the original query):\n${metadataContext}\n`
          : '';
        const prompt = this.promptTemplateService.renderTemplate(
          'query-analysis.txt',
          {
            query,
            caseId,
            clientId,
            metadataContextSection,
            summarySection,
            historySection,
          },
        );
        const result = await this.llm.generateContent({
          model: 'gemini-3-flash-preview',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            systemInstruction:
              'Analyze the user query for intent, retrieval needs, and chronology relevance. ' +
              'Return structured JSON only. Do not invent case facts beyond the provided context.',
            temperature: 0,
            topP: 0.95,
            topK: 64,
            thinkingConfig: {
              thinkingLevel: 'low' as any, // Forces the compiler to allow the valid string literal
            },
          },
        });
        const directText = (result as any)?.text;
        const responseText = directText
          ? String(directText)
          : this.vectorSearchService.safeExtractTextFromResponse(result);
        // Clean up the response
        let cleanedResponse = responseText;
        if (cleanedResponse.startsWith('```json')) {
          cleanedResponse = cleanedResponse.substring(7);
        }
        if (cleanedResponse.endsWith('```')) {
          cleanedResponse = cleanedResponse.slice(0, -3);
        }
        cleanedResponse = cleanedResponse.trim();
        // Parse JSON response
        let parsedResult: any;
        try {
          parsedResult = this.robustJsonParse(cleanedResponse);
        } catch (error) {
          parsedResult = this.getFallbackQueryAnalysis(query, hasDocuments);
        }
        // Validate and normalize the result
        const validatedResult = this.validateQueryAnalysisResult(
          parsedResult,
          query,
        );

        // Note: Removed aggressive summary override to match Python behavior
        // Summary queries should use vector search to get actual document content,
        // not just pre-generated metadata summaries. The AI will decide the strategy.

        // Cache the result with size management
        this.setCacheValue(this.queryAnalysisCache, cacheKey, validatedResult);

        return validatedResult;
      } catch (error) {
        this.logger.error(
          `Error in query analysis (attempt ${retryCount + 1}): ${error.message
          }`,
          error.stack,
        );
        retryCount++;
        if (retryCount > maxRetries) {
          return this.getFallbackQueryAnalysis(query, hasDocuments);
        }
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, retryCount) * 1000),
        );
      }
    }
    return this.getFallbackQueryAnalysis(query, hasDocuments);
  }

  private getFallbackQueryAnalysis(
    query: string,
    hasDocuments: boolean,
  ): UnifiedQueryAnalysis {
    const queryLower = query.toLowerCase().trim();

    if (this.conservativeResponseService.isGreetingQuery(query)) {
      return {
        original_query: query,
        enhanced_query: query,
        needs_document_context: false,
        query_type: 'greeting',
        strategy: 'greeting',
        confidence: 0.9,
        reasoning: 'Detected greeting pattern',
      };
    }
    // Check for general case summary queries (NOT chronological)
    // These should be treated as analytical queries, not chronological
    const caseSummaryPatterns = [
      /^tell me about (this )?case$/i,
      /^what is (this )?case (about)?$/i,
      /^give me (a )?summary (of )?(this )?case$/i,
      /^describe (this )?case$/i,
      /^explain (this )?case$/i,
    ];
    if (caseSummaryPatterns.some((pattern) => pattern.test(query))) {
      const enhancedQuery = hasDocuments
        ? `${query} as per the documents`
        : query;
      return {
        original_query: query,
        enhanced_query: enhancedQuery,
        needs_document_context: hasDocuments,
        query_type: 'analytical',
        strategy: 'vector',
        confidence: 0.85,
        reasoning: 'Detected general case summary query (not chronological)',
      };
    }
    if (hasChronologyIntent(query)) {
      if (isChronologyOnlyQuery(query)) {
        return {
          original_query: query,
          enhanced_query: query,
          needs_document_context: false,
          query_type: 'chronological',
          strategy: 'metadata',
          confidence: 0.8,
          reasoning: 'Detected chronology-only query pattern',
        };
      }
    }

    // Check for metadata queries
    const metadataKeywords = [
      'case number',
      'case id',
      'client id',
      'document',
      'file',
      'upload',
      'parties',
      'court',
      'judge',
      'what documents',
      'files',
    ];
    if (metadataKeywords.some((keyword) => queryLower.includes(keyword))) {
      return {
        original_query: query,
        enhanced_query: query,
        needs_document_context: false,
        query_type: 'metadata',
        strategy: 'metadata',
        confidence: 0.7,
        reasoning: 'Detected metadata query pattern',
      };
    }
    // Check for factual queries that need enhancement
    const factualKeywords = [
      'what is',
      'what are',
      'who is',
      'who are',
      'when is',
      'when was',
      'where is',
      'where are',
      'how much',
      'how many',
      'how long',
      'mobile number',
      'phone number',
      'email',
      'address',
      'amount',
      'price',
      'cost',
      'payment',
      'terms',
      'conditions',
    ];
    if (factualKeywords.some((keyword) => queryLower.includes(keyword))) {
      const enhancedQuery = hasDocuments
        ? `${query} as per the documents`
        : query;
      return {
        original_query: query,
        enhanced_query: enhancedQuery,
        needs_document_context: hasDocuments,
        query_type: 'factual',
        strategy: 'vector',
        confidence: 0.6,
        reasoning: 'Detected factual query pattern',
      };
    }
    // Default to conservative
    return {
      original_query: query,
      enhanced_query: query,
      needs_document_context: false,
      query_type: 'procedural',
      strategy: 'conservative',
      confidence: 0.5,
      reasoning: 'Fallback to conservative approach',
    };
  }

  private validateQueryAnalysisResult(
    result: any,
    originalQuery: string,
  ): UnifiedQueryAnalysis {
    if (!result || typeof result !== 'object') {
      result = {};
    }
    const defaults: UnifiedQueryAnalysis = {
      original_query: originalQuery,
      enhanced_query: originalQuery,
      needs_document_context: false,
      query_type: 'procedural',
      strategy: 'conservative',
      confidence: 0.5,
      reasoning: 'No reasoning provided',
    };
    for (const [key, defaultValue] of Object.entries(defaults)) {
      if (
        !(key in result) ||
        result[key] === null ||
        result[key] === undefined
      ) {
        result[key] = defaultValue;
      }
    }
    // Validate strategy
    const validStrategies = [
      'vector',
      'metadata',
      'conservative',
      'greeting',
      'web_search',
    ];
    if (!validStrategies.includes(result.strategy)) {
      result.strategy = 'conservative';
      result.reasoning = 'Invalid strategy, defaulting to conservative';
    }
    // Validate query_type
    const validQueryTypes = [
      'factual',
      'analytical',
      'procedural',
      'greeting',
      'metadata',
      'chronological',
    ];
    if (!validQueryTypes.includes(result.query_type)) {
      result.query_type = 'procedural';
    }
    // Validate confidence
    try {
      const confidence = parseFloat(result.confidence);
      if (isNaN(confidence) || confidence < 0.0 || confidence > 1.0) {
        result.confidence = 0.5;
      } else {
        result.confidence = confidence;
      }
    } catch (error) {
      result.confidence = 0.5;
    }
    // Ensure enhanced_query is not empty
    if (!result.enhanced_query || result.enhanced_query.trim() === '') {
      result.enhanced_query = originalQuery;
    }

    // Enforce post-constraints to avoid over-enhancement or intent drift
    result.enhanced_query = this.enforceEnhancementConstraints(
      originalQuery,
      String(result.enhanced_query),
    );

    // Adjust needs_document_context if no enhancement was made
    if (result.enhanced_query === result.original_query) {
      result.needs_document_context = false;
    }

    if (this.conservativeResponseService.isGreetingQuery(originalQuery)) {
      result.query_type = 'greeting';
      result.strategy = 'greeting';
      result.enhanced_query = originalQuery;
      result.needs_document_context = false;
      result.reasoning = 'Detected greeting';
    }

    return this.adjustAnalysisForChronologyOnly(
      result as UnifiedQueryAnalysis,
      originalQuery,
    );
  }

  private adjustAnalysisForChronologyOnly(
    result: UnifiedQueryAnalysis,
    originalQuery: string,
  ): UnifiedQueryAnalysis {
    if (!hasChronologyIntent(originalQuery, result.query_type)) {
      return result;
    }

    if (isChronologyOnlyQuery(originalQuery)) {
      result.query_type = 'chronological';
      result.strategy = 'metadata';
      result.needs_document_context = false;
    }

    return result;
  }

  /**
   * Enforces generic safety constraints on the enhanced query:
   * - Preserves all meaningful original words (except pronouns explicitly resolved)
   * - Blocks introduction of new legal entities (schemes/sections/acts/years) not in original
   * If constraints are violated, falls back to the original query.
   */
  private enforceEnhancementConstraints(
    originalQuery: string,
    enhancedQuery: string,
  ): string {
    const original = originalQuery || '';
    const enhanced = enhancedQuery || '';

    if (this.conservativeResponseService.isGreetingQuery(original)) {
      return original;
    }

    // Quick exits
    if (!original.trim()) {
      return enhanced;
    }
    if (!enhanced.trim()) {
      return original;
    }

    const tokenize = (text: string): string[] =>
      text
        .toLowerCase()
        .split(/[\s\.,;:!?()\[\]"'`]+/)
        .filter((t) => t.length > 0);

    const originalTokens = tokenize(original);
    const enhancedTokens = tokenize(enhanced);

    const enhancedSet = new Set(enhancedTokens);

    // Pronouns we explicitly allow to be removed/changed during resolution
    const pronouns = new Set<string>([
      'it',
      'he',
      'she',
      'they',
      'this',
      'that',
      'him',
      'her',
      'them',
      'his',
      'hers',
      'their',
      'theirs',
      'itself',
      'himself',
      'herself',
      'themselves',
    ]);

    // 1) Ensure all non-pronoun original tokens are still present
    const missingImportantTokens = originalTokens.filter(
      (token) => !pronouns.has(token) && !enhancedSet.has(token),
    );

    if (missingImportantTokens.length > 0) {
      // If we lost meaningful words like "now", "kindly", "other", etc., fall back
      return original;
    }

    // 2) Block introduction of new legal / case entities not present in the original
    const originalSet = new Set(originalTokens);

    const isPotentialLegalEntity = (token: string): boolean => {
      if (!token) return false;
      // Years like 2020, 2024, etc.
      if (/^(19|20)\d{2}$/.test(token)) {
        return true;
      }
      // Generic legal/case markers
      const legalKeywords = [
        'section',
        'sec',
        'article',
        'rule',
        'act',
        'code',
        'scheme',
        'chapter',
      ];
      if (legalKeywords.includes(token)) {
        return true;
      }
      return false;
    };

    const introducedLegalEntities = enhancedTokens.filter(
      (token) => !originalSet.has(token) && isPotentialLegalEntity(token),
    );

    if (introducedLegalEntities.length > 0) {
      // Enhanced query is trying to inject new legal entities not present in original
      return original;
    }

    // Passed checks – enhanced query is safe to use
    return enhanced;
  }

  private async generateMultipleRewrittenQueries(
    query: string,
    caseId: string,
    clientId: string,
    needsDocumentContext: boolean,
    chatHistory?: string,
  ): Promise<string[]> {
    const maxRetries = 3;
    let retryCount = 0;
    while (retryCount <= maxRetries) {
      try {
        const rewrittenQueries = [query];

        // Skip enhancement if not needed
        if (!needsDocumentContext) {
          return rewrittenQueries;
        }
        const documentContextPhrases = [
          'from the documents',
          'given in the documents',
          'given in the document',
          'as per document',
          'according to document',
          'in the document',
          'from the document',
          'based on document',
          'as per the document',
          'according to the document',
          'in the documents',
          'from the documents',
          'based on the documents',
          'as per documents',
          'according to documents',
        ];
        const queryLower = query.toLowerCase();
        if (
          documentContextPhrases.some((phrase) => queryLower.includes(phrase))
        ) {
          return rewrittenQueries;
        }
        // Build chat history context section with focused pronoun and reference resolution
        const historySection = chatHistory
          ? this.promptTemplateService.renderTemplate(
            'rewrite-history-section.txt',
            { chatHistory },
          )
          : '';

        // Generate multiple rewritten versions
        const prompt = this.promptTemplateService.renderTemplate(
          'query-rewrite.txt',
          {
            query,
            historySection,
            referenceResolutionRule: chatHistory
              ? 'FIRST: Resolve any pronouns (especially "it", "this", "that"), ordinal references (the 4th point, option 2, the first approach), and contextual references by replacing them with their actual referents from the conversation history. Look at the MOST RECENT assistant response first to identify what entity was being discussed. Do NOT leave any pronouns unresolved.'
              : 'Add document context in different ways',
            historyImportantNote: chatHistory
              ? 'IMPORTANT: In all rewritten queries, make sure pronouns are resolved by replacing them with the exact entities (forms, people, sections) mentioned in the most recent history.'
              : '',
          },
        );
        const result = await this.llm.generateContent({
          model: GEMINI_3_1_FLASH_LITE,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            temperature: 0.2,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 1024, // Limit for query rewriting
          },
        });
        const directText2 = (result as any)?.text;
        const responseText = directText2
          ? String(directText2)
          : this.vectorSearchService.safeExtractTextFromResponse(result);
        let cleanedResponse = responseText;
        if (cleanedResponse.startsWith('```json')) {
          cleanedResponse = cleanedResponse.substring(7);
        }
        if (cleanedResponse.endsWith('```')) {
          cleanedResponse = cleanedResponse.slice(0, -3);
        }
        cleanedResponse = cleanedResponse.trim();
        try {
          const generatedQueries = JSON.parse(cleanedResponse);
          if (Array.isArray(generatedQueries)) {
            rewrittenQueries.push(...generatedQueries);
          } else {
            rewrittenQueries.push(
              `${query} as per the documents`,
              `${query} according to the documents`,
              `${query} given in the documents`,
            );
          }
        } catch (error) {
          rewrittenQueries.push(
            `${query} as per the documents`,
            `${query} according to the documents`,
            `${query} given in the documents`,
          );
        }
        const seen = new Set<string>();
        const uniqueQueries: string[] = [];
        for (const q of rewrittenQueries) {
          if (!seen.has(q)) {
            seen.add(q);
            uniqueQueries.push(q);
          }
        }
        return uniqueQueries;
      } catch (error) {
        this.logger.error(
          `Error generating multiple rewritten queries (attempt ${retryCount + 1
          }): ${error.message}`,
          error.stack,
        );
        retryCount++;
        if (retryCount > maxRetries) {
          return [
            query,
            `${query} as per the documents`,
            `${query} according to the documents`,
            `${query} given in the documents`,
          ];
        }
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, retryCount) * 1000),
        );
      }
    }
    return [
      query,
      `${query} as per the documents`,
      `${query} according to the documents`,
      `${query} given in the documents`,
    ];
  }

  private async processDecomposedLegacyQueries(context: {
    chatId: string;
    question: string;
    pipelineQuery: string;
    subQueries: string[];
    caseId: string;
    clientId: string;
    caseName: string;
    clientName: string;
    documentChats: any[];
    fileName?: string;
    sessionId?: string;
    chatHistoryContext?: string;
    conversationSummary?: string | null;
    recentHistoryText?: string;
    emitPartial: (partial: any) => void;
    plannerResults: PlannerResult[];
  }) {
    const {
      chatId,
      question,
      pipelineQuery,
      subQueries,
      caseId,
      clientId,
      caseName,
      clientName,
      documentChats,
      fileName,
      sessionId,
      chatHistoryContext,
      conversationSummary,
      recentHistoryText,
      emitPartial,
      plannerResults,
    } = context;

    this.logPipelineDebug('DECOMPOSITION', {
      subQueryCount: subQueries.length,
      routing: 'legacy',
    });

    const executorResults: ExecutorResult[] = [];
    const subQueryDetails: Array<{
      query: string;
      strategy: string;
      confidence: number;
    }> = [];

    for (let index = 0; index < subQueries.length; index++) {
      const subQuery = subQueries[index];
      const result = await this.processSingleQueryThroughPipeline(
        subQuery,
        caseId,
        clientId,
        caseName,
        clientName,
        documentChats,
        fileName,
        chatHistoryContext,
        sessionId,
        true,
        undefined,
        false,
        conversationSummary ?? undefined,
        recentHistoryText,
      );

      executorResults.push({
        executor: 'DecomposedQuery',
        strategy: result.strategy,
        answer: result.answer,
        purpose: subQuery,
      });
      subQueryDetails.push({
        query: subQuery,
        strategy: result.strategy,
        confidence: result.confidence,
      });
    }

    // Decomposition only: pack sub-answers, then one pass through answer-refinement.txt
    const aggregated =
      this.aggregationService.aggregateDecomposedResults(executorResults);
    const answer = await this.answerRefinementService.refineAnswerForDisplay(
      aggregated.answer,
      question,
    );
    const primaryStrategy = aggregated.strategies[0] ?? 'vector';
    const avgConfidence =
      subQueryDetails.reduce((sum, detail) => sum + detail.confidence, 0) /
      Math.max(subQueryDetails.length, 1);
    const reasoning = `Decomposed into ${subQueries.length} sub-queries via legacy routing`;
    const references = documentChats.map((dc: any) => ({
      documentId: dc.documentId,
      originalName: dc.Document.originalName,
      relevance: avgConfidence,
    }));

    emitPartial({
      answer,
      references,
      chatId,
      isPartial: false,
      strategy: { strategy: primaryStrategy, reasoning, confidence: avgConfidence },
    });

    this.storeChatHistory(
      chatId,
      question,
      answer,
      primaryStrategy,
      avgConfidence,
      fileName,
      sessionId,
    ).catch((error) => {
      this.logger.error(
        `Failed to store decomposed chat history in background: ${error.message}`,
      );
    });

    this.logPlannerComparison(pipelineQuery, primaryStrategy, plannerResults);
    this.logPipelineDebug('DECOMPOSITION_LEGACY', {
      subQueryCount: subQueries.length,
      subQueries,
      strategies: aggregated.strategies,
      executors: aggregated.executors,
    });

    const decomposedResponse = {
      answer,
      references,
      chatId,
      strategy: { strategy: primaryStrategy, reasoning, confidence: avgConfidence },
      original_query: question,
      enhanced_query: pipelineQuery,
      enhancement_applied: pipelineQuery !== question,
      query_type: 'analytical',
      sub_queries: subQueries,
      decomposition_applied: true,
      strategies: aggregated.strategies,
    };
    logRequestEnd({
      finalStrategy: mapExecutorStrategyToFinalStrategy(primaryStrategy),
      executor: aggregated.executors.join(',') || 'DecomposedQuery',
      sourceInfo: primaryStrategy,
    });
    return decomposedResponse;
  }

  /**
   * Processes a single query through the full pipeline (analysis → strategy selection → execution)
   * This is used for processing rewritten queries through the complete flow.
   */
  private async processSingleQueryThroughPipeline(
    query: string,
    caseId: string,
    clientId: string,
    caseName: string,
    clientName: string,
    documentChats: any[],
    fileName?: string,
    chatHistoryContext?: string,
    sessionId?: string,
    skipRefinement: boolean = false,
    preloadedChunks?: any[],
    documentScopedOnly: boolean = false,
    conversationSummary?: string | null,
    recentHistoryText?: string,
  ): Promise<{
    answer: string;
    strategy: string;
    reasoning: string;
    confidence: number;
  }> {
    try {
      // Step 1: Analyze and enhance the query (using cached analysis if available)
      const analysisResult = await this.detectQueryIntentAndEnhance(
        query,
        caseName,
        clientName,
        documentChats,
        () => { }, // emitError - not needed for internal processing
        recentHistoryText || chatHistoryContext,
        conversationSummary,
      );

      const enhancedQuery = analysisResult.enhanced_query;
      let strategy = analysisResult.strategy;
      const llmSuggestedStrategy = analysisResult.strategy;
      const reasoning = analysisResult.reasoning;
      const confidence = analysisResult.confidence;
      const queryType = analysisResult.query_type;

      // Check if query is asking for summary and if metadata has summary data
      const isSummaryQuery = this.isSummaryQuery(query);
      const hasMetadataSummary = this.hasMetadataSummary(documentChats);
      const hasChronology = hasChronologyIntent(query, queryType);

      if (!hasChronology && isSummaryQuery && hasMetadataSummary) {
        strategy = 'metadata';
      } else if (!hasChronology && query.trim().toLowerCase() === 'summary') {
        strategy = 'metadata';
      }
      this.logPipelineDebug('CLASSIFICATION_SINGLE_QUERY', {
        query,
        enhancedQuery,
        llmSuggestedStrategy,
        effectiveStrategy: strategy,
        postClassificationOverrideApplied: strategy !== llmSuggestedStrategy,
        queryType,
        hasChronology,
        isSummaryQuery,
        hasMetadataSummary,
        documentScopedOnly,
      });

      // Step 2: Get chunks if needed for vector/conservative/web_search strategies
      // PARALLELIZATION: Fetch vector chunks and check legal query in parallel
      const { webSearchConfig } = await import('./web-search-config');
      const config = webSearchConfig;

      let chunks: any[] = [];
      let isLegal = false;

      // Only fetch chunks if strategy requires them
      const shouldFetchChunks =
        strategy === 'vector' ||
        strategy === 'conservative' ||
        strategy === 'web_search';

      if (shouldFetchChunks) {
        if (preloadedChunks) {
          // Reuse chunks already retrieved in the outer pipeline pass — skip second retrieval + LLM rerank
          chunks = preloadedChunks;
          isLegal = await config.isLegalQuery(enhancedQuery).catch(() => false);
        } else {
          const documentIds = documentChats.map((dc: any) => dc.documentId);

          // Run vector search and legal query detection in parallel
          const [chunksResult, legalResult] = await Promise.allSettled([
            // Vector search
            documentIds.length > 0
              ? this.vectorSearchService.retrieveRankedChunks(
                enhancedQuery,
                documentIds,
                fileName,
              )
              : Promise.resolve([]),
            // Legal query detection
            config.isLegalQuery(enhancedQuery).catch(() => false),
          ]);

          // Process vector search results
          if (chunksResult.status === 'fulfilled') {
            chunks = chunksResult.value;
          }

          // Process legal query detection results
          if (legalResult.status === 'fulfilled') {
            isLegal = legalResult.value;
          }

        }
      } else {
        // If we don't need chunks, still check legal query (might be needed for web search decision)
        try {
          isLegal = await config.isLegalQuery(enhancedQuery);
        } catch (error) {
          isLegal = false;
        }

      }

      // NOTE: Legal query detection is ONLY used for web search decisions.
      // All queries (except greetings) are allowed to search documents.
      // Legal query check is performed later when deciding whether to use web search.

      // Step 3: Semantic Sufficiency Check (replaces chunk count/length gates)
      // Store the full result including missingInfo for reuse in hybrid answer generation
      let semanticSufficiency: 'YES' | 'PARTIAL' | 'NO' | undefined;
      let sufficiencyResult: { sufficiency: 'YES' | 'PARTIAL' | 'NO'; reason: string; missingInfo?: string } | undefined;
      if (shouldFetchChunks && chunks.length > 0) {
        sufficiencyResult = await this.webSearchService.checkSemanticSufficiency(
          chunks,
          enhancedQuery,
        );
        semanticSufficiency = sufficiencyResult.sufficiency;
      }

      // Keep chunk count/length as weak heuristic signal (not gate)
      const totalLength = chunks.reduce(
        (sum, chunk) => sum + (chunk?.content?.length || 0),
        0,
      );
      const chunksMeetThresholds =
        chunks.length >= config.min_chunks_threshold &&
        totalLength >= config.min_chunk_length;

      let finalStrategy = strategy;
      if (strategy === 'greeting') {
        finalStrategy = 'greeting';
      } else if (strategy === 'metadata') {
        finalStrategy = 'metadata';
      } else if (strategy === 'web_search') {
        // If AI explicitly chose web_search, respect that decision ONLY
        // when web search is enabled AND the query is legal-domain (when required).
        if (
          config.enabled &&
          (!config.require_legal_domain || isLegal)
        ) {
          finalStrategy = 'web_search';
        } else {
          // Web search disabled or not allowed for non-legal queries:
          // fall back based on semantic sufficiency, preferring documents
          // and otherwise giving a conservative "out of scope" style answer.
          if (semanticSufficiency === 'YES') {
            finalStrategy = 'vector';
          } else {
            finalStrategy = 'conservative';
          }
        }
      } else {
        // Step 4: Strategy Decision based on semantic sufficiency
        if (semanticSufficiency === 'YES') {
          finalStrategy = 'vector';
        } else if (semanticSufficiency === 'PARTIAL' && isLegal && config.enabled) {
          finalStrategy = 'vector'; // Will trigger hybrid in vector case
        } else if (semanticSufficiency === 'NO') {
          // NO: Documents don't have sufficient information
          // Still try vector search first (may provide partial answer)
          // Web search will be considered in hybrid answer generation if enabled and legal
          finalStrategy = 'vector'; // Always try documents first
        } else {
          // Fallback: use chunk thresholds as weak signal
          // Always prefer documents (vector) over web search
          if (chunksMeetThresholds) {
            finalStrategy = 'vector';
          } else {
            // Even if chunks don't meet thresholds, try vector search first
            // Web search will be considered in hybrid answer generation if needed
            finalStrategy = 'vector';
          }
        }
      }
      this.logPipelineDebug('RETRIEVAL_ROUTING_SINGLE_QUERY', {
        query,
        enhancedQuery,
        shouldFetchChunks,
        chunksCount: chunks.length,
        semanticSufficiency: semanticSufficiency ?? 'UNSET',
        semanticReason: sufficiencyResult?.reason ?? '',
        missingInfo: sufficiencyResult?.missingInfo ?? '',
        isLegal,
        strategyBeforeRouting: strategy,
        finalStrategyAfterRouting: finalStrategy,
      });

      // Step 4: Execute based on final strategy
      let answer: string;

      switch (finalStrategy as 'greeting' | 'metadata' | 'vector' | 'web_search' | 'conservative' | 'vector + web_search') {
        case 'greeting':
          answer = this.conservativeResponseService.getGreetingResponse(
            enhancedQuery,
            caseName,
            clientName,
            documentChats,
          );
          break;

        case 'vector': {
          // Prefer hybrid approach: use documents first, then fall back to web search if needed
          try {
            const webSearchAllowed =
              !isPlatformStarterQuery(query) &&
              !documentScopedOnly &&
              config.enabled &&
              (!config.require_legal_domain || isLegal);

            // GUARD: If documents don't have sufficient information AND web search is not allowed
            // (non-legal query), return conservative response instead of generating answer
            // This prevents answering general knowledge questions like "Capital of India"
            if ((semanticSufficiency === 'NO' || chunks.length === 0) && !webSearchAllowed) {
              if (documentScopedOnly) {
                const groundedResult =
                  await this.webSearchService.generateDocumentGroundedInsufficiencyAnswer(
                    enhancedQuery,
                    chunks,
                    {
                      reason:
                        sufficiencyResult?.reason ??
                        'No relevant documents found in vector search',
                    },
                    documentChats,
                    chatHistoryContext,
                  );
                answer = groundedResult.answer;
                finalStrategy = 'vector';
              } else {
                answer = this.conservativeResponseService.getConservativeResponse(
                  enhancedQuery,
                  caseName,
                  clientName,
                  documentChats,
                  chatHistoryContext,
                );
                finalStrategy = 'conservative';
              }
            } else if (webSearchAllowed) {
              const hybridResult =
                await this.webSearchService.generateHybridAnswer(
                  enhancedQuery,
                  chunks,
                  caseId,
                  clientId,
                  caseName,
                  clientName,
                  chatHistoryContext || undefined,
                  webSearchAllowed,
                  documentChats,
                  sufficiencyResult, // Pass pre-computed sufficiency to avoid redundant LLM call
                  { documentScoped: documentScopedOnly },
                );

              answer = hybridResult.answer;
              this.logPipelineDebug('ANSWER_MERGE_SINGLE_QUERY', {
                mergeType: 'hybrid_answer_generation',
                sourceInfo: hybridResult.source_info ?? 'unknown',
                semanticSufficiency: semanticSufficiency ?? 'UNSET',
                webSearchAllowed,
              });

              if (hybridResult.source_info === 'web_search_only') {
                finalStrategy = 'web_search';
              } else if (
                hybridResult.source_info === 'vector_search + web_search'
              ) {
                finalStrategy = 'vector + web_search';
              } else if (
                hybridResult.source_info === 'document_insufficient'
              ) {
                finalStrategy = 'vector';
              } else {
                finalStrategy = 'vector';
              }
            } else {
              // KNOWN FOLLOW-UP: legacy path calls processVectorQuery directly when
              // web is disabled, bypassing generateHybridAnswer routing (no_topic_coverage, etc.).
              const vectorResult =
                await this.vectorSearchService.processVectorQuery(
                  enhancedQuery,
                  documentChats.map((dc: any) => dc.documentId),
                  documentChats,
                  fileName,
                  () => { },
                  chatHistoryContext,
                );
              answer = vectorResult.answer;
              finalStrategy = 'vector';
            }
          } catch (error) {
            // If hybrid/web search fails for any reason, fall back to pure vector search
            const vectorResult =
              await this.vectorSearchService.processVectorQuery(
                enhancedQuery,
                documentChats.map((dc: any) => dc.documentId),
                documentChats,
                fileName,
                () => { },
                chatHistoryContext,
              );
            answer = vectorResult.answer;
            finalStrategy = 'vector';
          }
          break;
        }

        case 'metadata':
          answer = await this.metaDataService.getMetadataSearchAnswer(
            enhancedQuery,
            caseId,
            clientId,
            documentChats,
            fileName
              ? documentChats.find(
                (dc: any) => dc.Document.originalName === fileName,
              )?.documentId
              : undefined,
            queryType,
            sessionId,
            chatHistoryContext,
          );
          break;

        case 'web_search':
          answer = await this.webSearchService.searchWithGrounding(
            enhancedQuery,
            caseName,
            clientName,
            undefined,
            chatHistoryContext || undefined,
          );
          break;

        case 'conservative':
        default:
          answer = this.conservativeResponseService.getConservativeResponse(
            enhancedQuery,
            caseName,
            clientName,
            documentChats,
            chatHistoryContext,
          );
          break;
      }

      // Refine the answer for display (matching Python's refine_answer_for_display)
      // Skip refinement if flag is set (useful when merging multiple answers - refine only final result)
      let finalAnswer = answer;
      if (!skipRefinement) {
        finalAnswer =
          await this.answerRefinementService.refineAnswerForDisplay(
            this.vectorSearchService.deduplicateAnswer(answer),
            query,
          );
      } else {
        // Still deduplicate even if skipping refinement
        finalAnswer = this.vectorSearchService.deduplicateAnswer(answer);
      }

      return {
        answer: finalAnswer,
        strategy: finalStrategy,
        reasoning,
        confidence,
      };
    } catch (error) {
      this.logger.error(
        `Error processing single query through pipeline: ${error.message}`,
      );
      // Fallback to conservative response
      const fallbackAnswer =
        this.conservativeResponseService.getConservativeResponse(
          query,
          caseId,
          clientId,
          documentChats,
          chatHistoryContext,
        );
      // Refine the answer for display (skip if flag is set)
      let finalFallbackAnswer = fallbackAnswer;
      if (!skipRefinement) {
        finalFallbackAnswer =
          await this.answerRefinementService.refineAnswerForDisplay(
            fallbackAnswer,
            query,
          );
      }
      return {
        answer: finalFallbackAnswer,
        strategy: 'conservative',
        reasoning: `Error occurred: ${error.message}`,
        confidence: 0.3,
      };
    }
  }

  private async processQueryWithMultipleRewrites(
    query: string,
    caseId: string,
    clientId: string,
    caseName: string,
    clientName: string,
    documentChats: any[],
    fileName?: string,
    chatHistoryContext?: string,
    sessionId?: string,
    preloadedChunks?: any[],
    documentScopedOnly: boolean = false,
    conversationSummary?: string | null,
    recentHistoryText?: string,
  ): Promise<{
    original_query: string;
    rewritten_queries: string[];
    answer: string;
    strategy: string;
    reasoning: string;
    confidence: number;
    queries_used: number;
  }> {
    try {
      const rewrittenQueries = await this.generateMultipleRewrittenQueries(
        query,
        caseId,
        clientId,
        true,
        chatHistoryContext,
      );

      // OPTIMIZATION: Select the best query first using vector search similarity scores
      // This avoids making multiple expensive LLM calls
      const documentIds = documentChats.map((dc: any) => dc.documentId);
      let bestQuery = query; // Fallback to original query
      let bestQueryScore = 0;

      if (preloadedChunks && preloadedChunks.length > 0) {
        // We already paid for retrieval + rerank in the outer pipeline.
        // Re-scoring rewritten variants here triggers duplicate vector retrieval.
        bestQuery = query;
      } else if (documentIds.length > 0) {
        // Evaluate each rewritten query by doing a quick vector search
        const queryScores = await Promise.all(
          rewrittenQueries.map(async (rewrittenQuery) => {
            try {
              // Quick vector search to get similarity scores (cheap operation)
              const chunks = await this.vectorSearchService.getSimilarChunks(
                rewrittenQuery,
                documentIds,
                5, // Only need top 5 for evaluation
                fileName,
              );

              if (chunks.length === 0) {
                return { query: rewrittenQuery, score: 0 };
              }

              // Calculate score: average of top 3 similarities
              // Note: similarity from DB is cosine distance (lower = more similar)
              // Convert distance to similarity score (1 - normalized_distance)
              const topSimilarities = chunks.slice(0, 3).map((chunk) => {
                const distance = chunk.similarity || 1;
                // Normalize distance (assuming max distance is 2 for cosine distance)
                // Convert to similarity where 1 = perfect match, 0 = no match
                const normalizedDistance = Math.min(distance / 2, 1);
                return 1 - normalizedDistance;
              });
              const avgSimilarity =
                topSimilarities.reduce((sum, sim) => sum + sim, 0) /
                topSimilarities.length;

              // Also consider number of chunks found (more chunks = better)
              const chunkCountBonus = Math.min(chunks.length / 5, 0.2); // Max 0.2 bonus
              const totalScore = avgSimilarity + chunkCountBonus;

              return { query: rewrittenQuery, score: totalScore };
            } catch (error) {
              return { query: rewrittenQuery, score: 0 };
            }
          }),
        );

        // Find the query with the best score
        const bestQueryResult = queryScores.reduce((best, current) =>
          current.score > best.score ? current : best,
        );

        if (bestQueryResult.score > 0) {
          bestQuery = bestQueryResult.query;
          bestQueryScore = bestQueryResult.score;
        }
      }

      // Process ONLY the best query through the full pipeline (single LLM call)
      // Pass preloadedChunks so the inner pipeline skips a second retrieval + LLM rerank
      const result = await this.processSingleQueryThroughPipeline(
        bestQuery,
        caseId,
        clientId,
        caseName,
        clientName,
        documentChats,
        fileName,
        chatHistoryContext,
        sessionId,
        false,
        preloadedChunks,
        documentScopedOnly,
        conversationSummary,
        recentHistoryText,
      );

      return {
        original_query: query,
        rewritten_queries: rewrittenQueries,
        answer: result.answer,
        strategy: result.strategy,
        reasoning: result.reasoning,
        confidence: result.confidence,
        queries_used: 1, // Only used 1 query for final answer generation
      };
    } catch (error) {
      this.logger.error(
        `Error in multiple rewrite processing: ${error.message}`,
      );
      // Fallback to single query processing
      const fallbackResult = await this.processSingleQueryThroughPipeline(
        query,
        caseId,
        clientId,
        caseName,
        clientName,
        documentChats,
        fileName,
        chatHistoryContext,
        sessionId,
        false,
        preloadedChunks,
        documentScopedOnly,
        conversationSummary,
        recentHistoryText,
      );
      return {
        original_query: query,
        rewritten_queries: [query],
        answer: fallbackResult.answer,
        strategy: fallbackResult.strategy,
        reasoning: 'Error fallback single query processing',
        confidence: fallbackResult.confidence,
        queries_used: 1,
      };
    }
  }

  private robustJsonParse(responseText: string): any {
    try {
      return JSON.parse(responseText);
    } catch (error) {
      // Direct JSON parse failed, try other methods
    }
    const jsonPatterns = [
      /\{[^}]*"strategy"[^}]*\}/s,
      /\{[^}]*"strategy"[^}]*"confidence"[^}]*\}/s,
      /\{[^}]*"strategy"[^}]*"reasoning"[^}]*\}/s,
      /\{[^}]*"strategy"[^}]*"confidence"[^}]*"reasoning"[^}]*\}/s,
      /\{[^}]*"original_query"[^}]*\}/s,
      /\{[^}]*"enhanced_query"[^}]*\}/s,
      /\{.*\}/s,
    ];
    for (const pattern of jsonPatterns) {
      const match = responseText.match(pattern);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (error) {
          continue;
        }
      }
    }
    let fixedText = responseText;
    fixedText = fixedText.replace(/,\s*}/g, '}');
    fixedText = fixedText.replace(/,\s*]/g, ']');
    try {
      return JSON.parse(fixedText);
    } catch (error) {
      // Fixed JSON parse failed, continue to regex extraction
    }
    const strategyMatch = responseText.match(/"strategy"\s*:\s*"([^"]*)"/s);
    const reasoningMatch = responseText.match(/"reasoning"\s*:\s*"([^"]*)/s);
    const confidenceMatch = responseText.match(/"confidence"\s*:\s*([0-9.]+)/s);
    const originalQueryMatch = responseText.match(
      /"original_query"\s*:\s*"([^"]*)/s,
    );
    const enhancedQueryMatch = responseText.match(
      /"enhanced_query"\s*:\s*"([^"]*)/s,
    );
    const needsContextMatch = responseText.match(
      /"needs_document_context"\s*:\s*(true|false)/s,
    );
    const queryTypeMatch = responseText.match(/"query_type"\s*:\s*"([^"]*)"/s);
    return {
      strategy: strategyMatch ? strategyMatch[1] : 'conservative',
      reasoning: reasoningMatch ? reasoningMatch[1] : 'JSON parsing failed',
      confidence: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.3,
      original_query: originalQueryMatch ? originalQueryMatch[1] : '',
      enhanced_query: enhancedQueryMatch ? enhancedQueryMatch[1] : '',
      needs_document_context: needsContextMatch
        ? needsContextMatch[1] === 'true'
        : false,
      query_type: queryTypeMatch ? queryTypeMatch[1] : 'procedural',
    };
  }

  /**
   * Checks if a query is asking for factual information from documents
   * (e.g., mobile numbers, addresses, client names, amounts, dates from documents)
   * These queries should be allowed even if not legal-domain queries.
   */
  private isDocumentFactualQuery(originalQuery: string, enhancedQuery: string): boolean {
    const queryLower = (enhancedQuery || originalQuery).toLowerCase();
    
    // Check if query contains document context indicators
    const documentContextIndicators = [
      'as per the documents',
      'as per document',
      'from the documents',
      'from the document',
      'in the documents',
      'in the document',
      'according to the documents',
      'according to the document',
      'given in the documents',
      'given in the document',
      'based on the documents',
      'based on the document',
    ];
    
    const hasDocumentContext = documentContextIndicators.some(indicator => 
      queryLower.includes(indicator)
    );
    
    // Check if query is asking for factual information that would be in documents
    const factualKeywords = [
      'mobile number',
      'phone number',
      'contact number',
      'email',
      'address',
      'client',
      'party',
      'amount',
      'payment',
      'date',
      'what is',
      'what are',
      'who is',
      'who are',
      'when was',
      'when is',
      'where is',
      'where are',
    ];
    
    const isFactualQuery = factualKeywords.some(keyword => queryLower.includes(keyword));
    
    // If query has document context OR is asking for factual info AND mentions client/case/party names,
    // it's likely asking about document content
    const mentionsEntity = /\b(client|party|case|vastimal|jain|assessee|appellant|respondent)\b/i.test(queryLower);
    
    return hasDocumentContext || (isFactualQuery && mentionsEntity);
  }

  private isDocumentScopedRequest(
    originalQuery: string,
    enhancedQuery: string,
    fileName?: string,
  ): boolean {
    if ((fileName ?? '').trim().length > 0) {
      return true;
    }

    const queryLower = `${originalQuery ?? ''} ${enhancedQuery ?? ''}`.toLowerCase();
    const documentIndicators = [
      'as per the documents',
      'as per document',
      'from the documents',
      'from the document',
      'in the documents',
      'in the document',
      'according to the documents',
      'according to the document',
      'given in the documents',
      'based on the documents',
      'uploaded document',
      'these documents',
      'this document',
      'case documents',
      'document',
      'documents',
      'file',
      'files',
    ];

    return documentIndicators.some((indicator) => queryLower.includes(indicator));
  }

  /**
   * Checks if a query is asking for a summary
   */
  private isSummaryQuery(query: string): boolean {
    const queryLower = query.toLowerCase().trim();

    // EXCLUDE queries asking for detail, depth, or specific information
    const detailKeywords = ['detail', 'detailed', 'comprehensive', 'depth', 'elaborate', 'full', 'in-depth', 'explain more'];
    if (detailKeywords.some((keyword) => queryLower.includes(keyword))) {
      return false;
    }

    const summaryKeywords = [
      'summary',
      'summarize',
      'summarise',
      'brief overview',
      'brief summary',
      'overview',
      'key points',
      'main points',
      'takeaways',
      'key takeaways',
      'simple summary',
    ];

    return summaryKeywords.some((keyword) => queryLower.includes(keyword));
  }

  /**
   * Checks if metadata has summary data available
   */
  private hasMetadataSummary(documentChats: any[]): boolean {
    if (!documentChats || documentChats.length === 0) {
      return false;
    }

    for (const docChat of documentChats) {
      const document = docChat.Document;
      const metadata = document?.documentMetaData?.[0];

      if (metadata?.summary) {
        const summary = metadata.summary;
        // Check if summary is not empty and not just placeholder text
        if (
          typeof summary === 'string' &&
          summary.trim().length > 0 &&
          summary.trim().toLowerCase() !== 'unknown' &&
          summary.trim().toLowerCase() !== 'no summary available'
        ) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Calculates similarity between two strings using a simple word-based approach
   * Returns a value between 0 and 1, where 1 means identical
   */
  private calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2) return 0.0;

    // Split into words for better comparison
    const words1 = new Set(str1.split(/\s+/).filter((w) => w.length > 0));
    const words2 = new Set(str2.split(/\s+/).filter((w) => w.length > 0));

    if (words1.size === 0 && words2.size === 0) return 1.0;
    if (words1.size === 0 || words2.size === 0) return 0.0;

    // Calculate Jaccard similarity (intersection over union)
    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  private logPlannerComparison(
    query: string,
    existingStrategy: string,
    plannerResults: PlannerResult[],
  ): void {
    const comparison = this.plannerService.buildComparison(
      query,
      existingStrategy,
      plannerResults,
    );
    this.plannerService.logPlannerComparison(comparison);
  }

  private setCacheValue<T>(cache: Map<string, T>, key: string, value: T): void {
    if (cache.size >= this.MAX_CACHE_SIZE) {
      // Remove oldest entries (first half of cache)
      const entriesToRemove = Math.floor(this.MAX_CACHE_SIZE / 2);
      const keysToRemove = Array.from(cache.keys()).slice(0, entriesToRemove);
      keysToRemove.forEach((k) => cache.delete(k));
    }
    cache.set(key, value);
  }

  private async respondWithDocumentClassification(params: {
    chatId: string;
    question: string;
    documentChats: any[];
    fileName?: string;
    sessionId: string;
    chatHistoryContext?: string;
    emitPartial: (partial: any) => void;
  }) {
    const specificDocumentId = params.fileName
      ? params.documentChats.find(
          (dc: any) => dc.Document?.originalName === params.fileName,
        )?.documentId
      : undefined;

    const answer = await this.metaDataService.getDocumentClassificationAnswer(
      params.documentChats,
      specificDocumentId,
      params.chatHistoryContext,
    );

    const references = params.documentChats.map((dc: any) => ({
      documentId: dc.documentId,
      originalName: dc.Document?.originalName,
      metadata: true,
    }));

    params.emitPartial({
      answer,
      references,
      chatId: params.chatId,
      isPartial: false,
      strategy: {
        strategy: 'metadata',
        reasoning: 'Classify-all-documents platform starter',
        confidence: 0.9,
      },
    });

    this.storeChatHistory(
      params.chatId,
      params.question,
      answer,
      'metadata',
      0.9,
      params.fileName,
      params.sessionId,
    ).catch((error) => {
      this.logger.error(
        `Failed to store document classification history: ${error.message}`,
      );
    });

    const response = {
      answer,
      references,
      chatId: params.chatId,
      strategy: {
        strategy: 'metadata',
        reasoning: 'Classify-all-documents platform starter',
        confidence: 0.9,
      },
      original_query: params.question,
      enhanced_query: params.question,
      enhancement_applied: false,
      query_type: 'metadata',
    };

    logRequestEnd({
      finalStrategy: 'document_only',
      executor: 'DocumentClassification',
      sourceInfo: 'metadata',
    });

    return response;
  }

  private async storeChatHistory(
    chatId: string,
    question: string,
    answer: string,
    strategy: string,
    confidence: number,
    fileName: string | undefined,
    sessionId: string,
  ): Promise<void> {
    try {
      const userEntry = {
        chatId,
        messageContent: question,
        messageType: 'user',
        queryStrategy: null,
        confidenceScore: null,
        fileName: fileName || null,
        sessionId,
      };

      const assistantEntry = {
        chatId,
        messageContent: answer,
        messageType: 'assistant',
        queryStrategy: strategy,
        confidenceScore: confidence,
        fileName: fileName || null,
        sessionId,
      };

      // Store chat history via REST API
      await this.backendService.storeChatHistory({
        chatId,
        question,
        answer,
        strategy,
        confidence,
        fileName: fileName || undefined,
        sessionId,
      });
    } catch (error) {
      this.logger.error(`❌ Failed to store chat history: ${error.message}`);
    }
  }
}
