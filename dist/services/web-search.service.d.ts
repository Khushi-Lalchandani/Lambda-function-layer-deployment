import { PromptBuilderService } from './prompt-builder.service';
import { AnswerRefinementService } from './answer-refinement.service';
import { PromptTemplateService } from './prompt-template.service';
import { WebSearchQueryOptimizerService } from './web-search-query-optimizer.service';
export interface SemanticSufficiencyContext {
    executor?: string;
    capability?: string;
}
export interface HybridAnswerOptions {
    documentScoped?: boolean;
    skipContextualResolution?: boolean;
}
export interface WebSearchGroundingOptions {
    /** Use the query as-is for grounding (no missingInfo suffix, prefix, or instruction stripping). */
    useOriginalQueryOnly?: boolean;
    /** Skip contextual-reference resolution when the caller already normalized the query. */
    skipContextualResolution?: boolean;
    /** Skip search-intent optimization for document-scoped queries. */
    documentScoped?: boolean;
    /** Observability: why web search was triggered. */
    triggerReason?: 'PARTIAL' | 'NO' | 'DIRECT';
}
export interface DocumentInsufficiencyInput {
    missingInfo?: string;
    reason?: string;
}
export declare class WebSearchService {
    private readonly promptBuilderService;
    private readonly answerRefinementService;
    private readonly promptTemplateService;
    private readonly webSearchQueryOptimizerService;
    private readonly logger;
    private readonly llm;
    private webSearchCache;
    private readonly MAX_CACHE_SIZE;
    constructor(promptBuilderService: PromptBuilderService, answerRefinementService: AnswerRefinementService, promptTemplateService: PromptTemplateService, webSearchQueryOptimizerService: WebSearchQueryOptimizerService);
    /**
     * Removes document-specific phrases from queries before web search
     * These phrases don't make sense for web search since web search doesn't have access to "provided documents"
     */
    private cleanQueryForWebSearch;
    /**
     * Strips drafting/instruction framing so the query is search-shaped, not task-shaped.
     * Keeps legal/factual subject matter (case type, AY, authority names, relief sought).
     */
    private stripInstructionFramingForWebSearch;
    private prepareQueryForWebSearchEnhancement;
    private truncateForWebSearchPrefix;
    private buildEnhancedWebSearchQuery;
    /**
     * Logging-only preview of the sync enhancement path inside searchWithGrounding.
     * Excludes async contextual-reference resolution; used to compare missingInfo vs searched query.
     */
    private buildWebSearchEnhancedQueryPreview;
    private logHybridWebSearchInvocation;
    searchWithGrounding(query: string, caseName?: string, clientName?: string, missingInformation?: string, chatHistory?: string, groundingOptions?: WebSearchGroundingOptions): Promise<string>;
    /**
     * Static response-guidance block appended after query-specific completenessGuidance.
     * Toggle via WEB_SEARCH_LEGACY_LANGUAGE_INSTRUCTION for short-term A/B comparison.
     */
    private buildLanguageInstructionStaticBlock;
    private buildTightenedLanguageInstructionStaticBlock;
    /**
     * TEMPORARY — pre-tightening static block retained for A/B comparison.
     * Remove this method once WEB_SEARCH_LEGACY_LANGUAGE_INSTRUCTION is no longer needed.
     */
    private buildLegacyLanguageInstructionStaticBlock;
    /**
     * Detects query completion requirements (steps, enumeration, examples)
     */
    private getQueryCompletionRequirements;
    private buildQueryRequirementHints;
    private normalizeChunkSimilarity;
    private logRetrievalStrengthDecision;
    private generateVectorAnswerFromChunks;
    private executeWebSearchOnlyFallback;
    private getSufficiencyPreviewLimit;
    private buildSufficiencyChunksPreview;
    private evaluateSemanticSufficiency;
    private applyFullChunkRecheckGuardrail;
    private isVagueMissingInformation;
    private logSufficiencyAudit;
    private applyPartialUpgradeGuardrail;
    private finalizeSufficiencyResult;
    /**
     * Semantic Sufficiency Judge - evaluates if chunks can fully answer the query
     * Returns: YES (sufficient), PARTIAL (some info but incomplete), NO (insufficient)
     */
    checkSemanticSufficiency(retrievedChunks: any[], query: string, context?: SemanticSufficiencyContext): Promise<{
        sufficiency: 'YES' | 'PARTIAL' | 'NO';
        reason: string;
        missingInfo?: string;
    }>;
    clearCache(): void;
    getCacheStats(): {
        cachedQueries: number;
        cacheSize: number;
        cacheEnabled: boolean;
        cacheTtl: number;
    };
    private setCacheValue;
    private buildDocumentChunksText;
    private generateDocumentInsufficiencyFollowUp;
    /**
     * Document-grounded response when retrieval is insufficient and web search must not run.
     */
    generateDocumentGroundedInsufficiencyAnswer(query: string, retrievedChunks: any[], sufficiency: DocumentInsufficiencyInput, documentChats?: any[], chatHistory?: string): Promise<{
        answer: string;
        source_info: string;
    }>;
    private buildFallbackDocumentInsufficiencyAnswer;
    /**
     * Generates an answer using both vector search results and web search fallback.
     * This intelligently combines both sources similar to Python's generate_hybrid_answer.
     *
     * @param query The user's query
     * @param retrievedChunks Chunks from vector search (can be string[] or ChunkResult[])
     * @param caseId Case identifier
     * @param clientId Client identifier
     * @param caseName Case name for context
     * @param clientName Client name for context
     * @param chatHistory Optional chat history context
     * @param webSearchEnabled Whether to enable web search fallback
     * @param documentChats Optional documentChats array for proper document name mapping
     * @returns Object with answer and source_info indicating the source(s) used
     */
    generateHybridAnswer(query: string, retrievedChunks: string[] | any[], caseId: string, clientId: string, caseName?: string, clientName?: string, chatHistory?: string, webSearchEnabled?: boolean, documentChats?: any[], precomputedSufficiency?: {
        sufficiency: 'YES' | 'PARTIAL' | 'NO';
        reason: string;
        missingInfo?: string;
    }, options?: HybridAnswerOptions): Promise<{
        answer: string;
        source_info: string;
    }>;
    /**
     * Checks if query contains contextual references that need resolution
     */
    private shouldResolveContextualReferences;
    /** Query already names concrete items (e.g. multiple dates) — no history resolution needed. */
    private hasExplicitEnumeratedEntities;
    private hasContextualReferences;
    /**
     * Resolves contextual references (e.g., "the 4th point") from chat history
     */
    private resolveContextualReferences;
    /**
     * Removes citation patterns from text (e.g., [Source: ...])
     * This is used to clean web search results that shouldn't have citations
     */
    private removeCitations;
}
//# sourceMappingURL=web-search.service.d.ts.map