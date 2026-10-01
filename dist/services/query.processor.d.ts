import { BackendService } from './backend.service';
import { ConservativeResponseService } from './conservative-response.service';
import { VectorSearchService } from './vector-service';
import { MetadataService } from './metadata.service';
import { WebSearchService } from './web-search.service';
import { AnswerRefinementService } from './answer-refinement.service';
import { PromptTemplateService } from './prompt-template.service';
import { QueryRewriteService } from './query-rewrite.service';
import { QueryDecompositionService } from './query-decomposition.service';
import { PlannerService } from './planner.service';
import { ExecutionGraphService } from './execution-graph.service';
import { ExecutionOrchestratorService } from './execution-orchestrator.service';
import { ConversationMemoryService } from './conversation-memory.service';
import { AggregationService } from './aggregation.service';
import { RolloutObservabilityService } from './rollout-observability.service';
export declare class QueryProcessorService {
    private readonly backendService;
    private readonly conservativeResponseService;
    private readonly vectorSearchService;
    private readonly metaDataService;
    private readonly webSearchService;
    private readonly answerRefinementService;
    private readonly promptTemplateService;
    private readonly queryRewriteService;
    private readonly queryDecompositionService;
    private readonly plannerService;
    private readonly executionGraphService;
    private readonly executionOrchestratorService;
    private readonly conversationMemoryService;
    private readonly aggregationService;
    private readonly rolloutObservabilityService;
    private readonly logger;
    private readonly llm;
    private queryAnalysisCache;
    private metadataContextCache;
    private userCache;
    private chatCache;
    private readonly MAX_CACHE_SIZE;
    private logPipelineDebug;
    private logRolloutRuntime;
    constructor(backendService: BackendService, conservativeResponseService: ConservativeResponseService, vectorSearchService: VectorSearchService, metaDataService: MetadataService, webSearchService: WebSearchService, answerRefinementService: AnswerRefinementService, promptTemplateService: PromptTemplateService, queryRewriteService: QueryRewriteService, queryDecompositionService: QueryDecompositionService, plannerService: PlannerService, executionGraphService: ExecutionGraphService, executionOrchestratorService: ExecutionOrchestratorService, conversationMemoryService: ConversationMemoryService, aggregationService: AggregationService, rolloutObservabilityService?: RolloutObservabilityService);
    processQuery(chatId: string, question: string, user: any, firmId: string, caseId: string, clientId: string, fileName: string | undefined, sessionId: string, emitPartial: (partial: any) => void, emitError: (error: any) => void): Promise<{
        answer: string;
        references: any[];
        chatId: string;
        strategy: {
            strategy: string;
            reasoning: string;
            confidence: number;
        };
        original_query: string;
        enhanced_query: string;
        enhancement_applied: boolean;
        query_type: string;
    }>;
    private detectQueryIntentAndEnhance;
    private getFallbackQueryAnalysis;
    private validateQueryAnalysisResult;
    private adjustAnalysisForChronologyOnly;
    /**
     * Enforces generic safety constraints on the enhanced query:
     * - Preserves all meaningful original words (except pronouns explicitly resolved)
     * - Blocks introduction of new legal entities (schemes/sections/acts/years) not in original
     * If constraints are violated, falls back to the original query.
     */
    private enforceEnhancementConstraints;
    private generateMultipleRewrittenQueries;
    private processDecomposedLegacyQueries;
    /**
     * Processes a single query through the full pipeline (analysis → strategy selection → execution)
     * This is used for processing rewritten queries through the complete flow.
     */
    private processSingleQueryThroughPipeline;
    private processQueryWithMultipleRewrites;
    private robustJsonParse;
    /**
     * Checks if a query is asking for factual information from documents
     * (e.g., mobile numbers, addresses, client names, amounts, dates from documents)
     * These queries should be allowed even if not legal-domain queries.
     */
    private isDocumentFactualQuery;
    private isDocumentScopedRequest;
    /**
     * Checks if a query is asking for a summary
     */
    private isSummaryQuery;
    /**
     * Checks if metadata has summary data available
     */
    private hasMetadataSummary;
    /**
     * Calculates similarity between two strings using a simple word-based approach
     * Returns a value between 0 and 1, where 1 means identical
     */
    private calculateSimilarity;
    private logPlannerComparison;
    private setCacheValue;
    private respondWithDocumentClassification;
    private storeChatHistory;
}
//# sourceMappingURL=query.processor.d.ts.map