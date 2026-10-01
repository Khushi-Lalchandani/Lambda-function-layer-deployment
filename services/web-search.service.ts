import { Injectable, Logger } from '@nestjs/common';
import { getLlmGateway } from './llm-gateway.service';
import { webSearchConfig } from './web-search-config';
import { PromptBuilderService } from './prompt-builder.service';
import { AnswerRefinementService } from './answer-refinement.service';
import { PromptTemplateService } from './prompt-template.service';
import {
  extractLlmText,
  invokeDocumentInsufficiencyTier,
  invokeLegalAnswerGenerationTier,
  invokeWebSearchTier,
} from './web-search-model-tier';
import { getWebSearchTierMetrics } from './web-search-tier-metrics';
import { isDocumentScopedQuery } from './document-scoped-query.util';
import {
  isExplicitWebSearchQuery,
  stripExplicitWebSearchFraming,
} from './explicit-web-search-query.util';
import { WebSearchQueryOptimizerService } from './web-search-query-optimizer.service';
import {
  logDebug,
  logObservabilityError,
  logSufficiency,
  logTrace,
  logWebSearchInvocation,
  markGuardrailTriggered,
  recordTiming,
  setSourceInfo,
} from './request-observability';
import {
  classifyRetrievalStrength,
  isGeneralKnowledgeScenarioAllowed,
  NO_TOPIC_COVERAGE_WEB_DISABLED_MESSAGE,
  normalizeChunkSimilarity,
  resolveHybridAnswerRoute,
  RetrievalStrength,
} from './retrieval-strength';

interface CacheEntry {
  result: string;
  timestamp: number;
}

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

const ORIGINAL_QUERY_GROUNDING_OPTIONS: WebSearchGroundingOptions = {
  useOriginalQueryOnly: true,
  skipContextualResolution: true,
};

export interface DocumentInsufficiencyInput {
  missingInfo?: string;
  reason?: string;
}

interface SufficiencyAuditPayload {
  query: string;
  sufficiency: 'YES' | 'PARTIAL' | 'NO';
  topSimilarity: number;
  chunkCount: number;
  reason: string;
  missingInfo?: string;
}

const PARTIAL_UPGRADE_MIN_SIMILARITY = 0.8;
const PARTIAL_UPGRADE_MIN_CHUNK_COUNT = 2;
const SUFFICIENCY_DEFAULT_PREVIEW_CHARS = 800;
const SUFFICIENCY_EXTENDED_PREVIEW_CHARS = 2000;
/** Normalized similarity at which extended preview is used (production FACT_LOOKUP often lands ~0.65–0.75). */
const SUFFICIENCY_EXTENDED_PREVIEW_SIMILARITY = 0.65;
const FULL_CHUNK_RECHECK_TOP_N = 2;

const VAGUE_MISSING_INFO_PATTERN =
  /\b(more detail|additional context|further information|broader explanation|comprehensive discussion|more comprehensive|additional detail|extra context|more context)\b/i;

const WEB_SEARCH_PREFIX_MAX_LEN = 60;

interface EnhancedWebSearchQueryResult {
  enhancedQuery: string;
  missingInfoUsed: boolean;
}

@Injectable()
export class WebSearchService {
  private readonly logger = new Logger(WebSearchService.name);
  private readonly llm = getLlmGateway();
  private webSearchCache = new Map<string, CacheEntry>();
  private readonly MAX_CACHE_SIZE = 100;

  constructor(
    private readonly promptBuilderService: PromptBuilderService,
    private readonly answerRefinementService: AnswerRefinementService,
    private readonly promptTemplateService: PromptTemplateService,
    private readonly webSearchQueryOptimizerService: WebSearchQueryOptimizerService,
  ) {}

  /**
   * Removes document-specific phrases from queries before web search
   * These phrases don't make sense for web search since web search doesn't have access to "provided documents"
   */
  private cleanQueryForWebSearch(query: string): string {
    const documentContextPhrases = [
      'as per the provided documents',
      'as per provided documents',
      'as per the documents',
      'as per documents',
      'as per document',
      'as per the document',
      'according to the provided documents',
      'according to provided documents',
      'according to the documents',
      'according to documents',
      'according to document',
      'according to the document',
      'given in the provided documents',
      'given in provided documents',
      'given in the documents',
      'given in documents',
      'given in the document',
      'given in document',
      'from the provided documents',
      'from provided documents',
      'from the documents',
      'from documents',
      'from the document',
      'from document',
      'in the provided documents',
      'in provided documents',
      'in the documents',
      'in documents',
      'in the document',
      'in document',
      'based on the provided documents',
      'based on provided documents',
      'based on the documents',
      'based on documents',
      'based on document',
      'based on the document',
      'in the uploaded documents',
      'from the uploaded documents',
      'as per the uploaded documents',
      'according to the uploaded documents',
      'from the case documents',
      'in the case documents',
    ];

    let cleanedQuery = query;
    
    // Remove document context phrases (case-insensitive)
    for (const phrase of documentContextPhrases) {
      // Match phrase with optional punctuation and whitespace
      const regex = new RegExp(`\\s*${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'gi');
      cleanedQuery = cleanedQuery.replace(regex, ' ');
    }

    // Clean up multiple spaces and trim
    cleanedQuery = cleanedQuery.replace(/\s+/g, ' ').trim();

    return cleanedQuery;
  }

  /**
   * Strips drafting/instruction framing so the query is search-shaped, not task-shaped.
   * Keeps legal/factual subject matter (case type, AY, authority names, relief sought).
   */
  private stripInstructionFramingForWebSearch(query: string): string {
    let result = query.trim();

    result = result.replace(
      /^(?:please\s+)?(?:(?:help\s+me\s+)?(?:to\s+)?)?(?:draft|write|prepare|create|file|compile|generate|make|produce|draw up)\s+(?:a|an|the)\s+/i,
      '',
    );
    result = result.replace(
      /^(?:please\s+)?(?:give\s+me|provide\s+me\s+with)\s+(?:a|an|the)\s+/i,
      '',
    );

    const instructionBoilerplatePhrases = [
      'based on the case documents and facts provided for',
      'based on the case documents and facts provided',
      'based on the case documents and facts',
      'based on the documents and facts provided for',
      'based on the documents and facts provided',
      'based on the facts provided for',
      'based on the facts provided',
      'as per the case documents and facts',
      'according to the case documents and facts',
      'from the case documents and facts',
      'in the case documents and facts',
      'using the case documents and facts',
      'with reference to the case documents and facts',
    ];

    for (const phrase of instructionBoilerplatePhrases) {
      const regex = new RegExp(
        `\\s*${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`,
        'gi',
      );
      result = result.replace(regex, ' ');
    }

    result = result.replace(
      /\b((?:writ\s+)?petition|appeal|suit|plaint|application|complaint|revision|reference|counter[- ]affidavit|affidavit|reply|rejoinder|memorandum)\s+for\s+.+?\s+against\s+/gi,
      '$1 against ',
    );

    return result.replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  }

  private prepareQueryForWebSearchEnhancement(query: string): string {
    let preparedQuery = this.cleanQueryForWebSearch(query);
    preparedQuery = stripExplicitWebSearchFraming(preparedQuery);
    preparedQuery = this.stripInstructionFramingForWebSearch(preparedQuery);
    if (!preparedQuery || preparedQuery.trim().length < 3) {
      return query.trim();
    }
    return preparedQuery.replace(/\s+/g, ' ').trim();
  }

  private truncateForWebSearchPrefix(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length <= WEB_SEARCH_PREFIX_MAX_LEN) {
      return trimmed;
    }
    return `${trimmed.slice(0, WEB_SEARCH_PREFIX_MAX_LEN - 1)}…`;
  }

  private buildEnhancedWebSearchQuery(
    preparedQuery: string,
    caseName?: string,
    clientName?: string,
    missingInformation?: string,
  ): EnhancedWebSearchQueryResult {
    let enhancedQuery = preparedQuery;
    const missingInfoUsed =
      !!missingInformation?.trim() &&
      !this.isVagueMissingInformation(missingInformation);

    if (missingInfoUsed) {
      enhancedQuery = `${preparedQuery}. Specifically need information about: ${missingInformation!.trim()}`;
    }

    if (caseName?.trim() && clientName?.trim()) {
      const truncatedCaseName = this.truncateForWebSearchPrefix(caseName);
      const truncatedClientName = this.truncateForWebSearchPrefix(clientName);
      enhancedQuery = `Legal query for case ${truncatedCaseName}, client ${truncatedClientName}: ${enhancedQuery}`;
    }

    return { enhancedQuery, missingInfoUsed };
  }

  /**
   * Logging-only preview of the sync enhancement path inside searchWithGrounding.
   * Excludes async contextual-reference resolution; used to compare missingInfo vs searched query.
   */
  private buildWebSearchEnhancedQueryPreview(
    query: string,
    caseName?: string,
    clientName?: string,
    missingInformation?: string,
  ): EnhancedWebSearchQueryResult {
    const preparedQuery = this.prepareQueryForWebSearchEnhancement(query);
    return this.buildEnhancedWebSearchQuery(
      preparedQuery,
      caseName,
      clientName,
      missingInformation,
    );
  }

  private logHybridWebSearchInvocation(
    branch: 'PARTIAL' | 'NO',
    missingInfo: string | undefined,
    normalizedQuery: string,
    caseName?: string,
    clientName?: string,
  ): void {
    if (branch === 'NO') {
      logDebug('WEB_SEARCH_TRIGGER', {
        message:
          'Web search triggered because sufficiency result was NO.',
        branch,
        queryMode: 'original',
      });
      return;
    }

    const { enhancedQuery: previewEnhancedQuery, missingInfoUsed } =
      this.buildWebSearchEnhancedQueryPreview(
        normalizedQuery,
        caseName,
        clientName,
        missingInfo,
      );
    logDebug('WEB_SEARCH_TRIGGER', {
      message:
        'Web search triggered because sufficiency result was PARTIAL.',
      branch,
      queryMode: missingInfoUsed ? 'enhanced' : 'original',
    });
    logTrace('WEB_SEARCH_QUERY_PREVIEW', {
      previewEnhancedQuery,
      missingInfoUsed,
    });
  }

  async searchWithGrounding(
    query: string,
    caseName?: string,
    clientName?: string,
    missingInformation?: string,
    chatHistory?: string,
    groundingOptions?: WebSearchGroundingOptions,
  ): Promise<string> {
    const webSearchStartTime = Date.now();
    const config = webSearchConfig;

    // Safety check: if web search is disabled, return error message
    if (!config.enabled) {
      return `Web search is currently disabled. Please enable it in the configuration to use this feature.`;
    }

    const useOriginalQueryOnly = groundingOptions?.useOriginalQueryOnly ?? false;
    const isDocumentScoped =
      groundingOptions?.documentScoped ?? isDocumentScopedQuery(query);

    let workingQuery = query.trim();

    // Resolve contextual references from chat history (e.g., "the 4th point", "option 2")
    if (
      !groundingOptions?.skipContextualResolution &&
      chatHistory &&
      this.hasContextualReferences(workingQuery)
    ) {
      workingQuery = await this.resolveContextualReferences(
        workingQuery,
        chatHistory,
        'searchWithGrounding',
      );
    }

    const optimizationResult = isDocumentScoped
      ? {
          originalWebQuery: workingQuery,
          optimizedQuery: workingQuery,
          optimizationApplied: false,
        }
      : await this.webSearchQueryOptimizerService.optimizeWebSearchQuery(
          workingQuery,
        );

    let queryForEnhancement = optimizationResult.optimizedQuery;
    if (!useOriginalQueryOnly && isDocumentScoped) {
      queryForEnhancement = this.prepareQueryForWebSearchEnhancement(
        optimizationResult.optimizedQuery,
      );
    }

    const cleanedQuery = queryForEnhancement;

    const historyCacheFragment = (chatHistory ?? '')
      .split('\n')
      .slice(-6)
      .join('\n')
      .toLowerCase()
      .trim();
    const cacheKey = `${cleanedQuery}_${caseName ?? ''}_${clientName ?? ''}_${historyCacheFragment}`;
    if (config.cache_enabled && this.webSearchCache.has(cacheKey)) {
      const cached = this.webSearchCache.get(cacheKey)!;
      const now = Date.now();
      if (now - cached.timestamp < config.cache_ttl_seconds * 1000) {
        return cached.result;
      }
    }

    try {
      // Get query completion requirements (use cleaned query)
      const queryRequirements = this.getQueryCompletionRequirements(cleanedQuery);

      // Build query-specific completeness guidance
      const completenessGuidance = `
${
  queryRequirements.requiresSteps
          ? `
STEP-BY-STEP REQUIREMENTS:
- Structure answer as numbered steps (1., 2., 3., etc.)
- Each step should be clear and detailed
- Provide AT LEAST ${queryRequirements.minPointsRequired} steps, but include ALL relevant steps - do NOT limit yourself to only ${queryRequirements.minPointsRequired} if more steps are needed for a comprehensive answer
- Include any prerequisites or important notes before steps
- Add tips or important considerations after steps
- Ensure the answer is COMPREHENSIVE and covers all relevant aspects
`
          : ''
        }
${
  queryRequirements.requiresEnumeration
          ? `
ENUMERATION REQUIREMENTS:
- Use numbered or bulleted lists
- Provide AT LEAST ${queryRequirements.minPointsRequired} items, but include ALL relevant items - do NOT limit yourself to only ${queryRequirements.minPointsRequired} if more items are needed for a comprehensive answer
- Include brief explanation for each item
- Group related items together
- Ensure the answer is COMPREHENSIVE and covers all relevant aspects
`
          : ''
        }
${
  
  queryRequirements.requiresExamples
          ? `
EXAMPLE REQUIREMENTS:
- Include AT LEAST ${queryRequirements.minPointsRequired} practical examples, but include ALL relevant examples - do NOT limit yourself to only ${queryRequirements.minPointsRequired} if more examples are needed for a comprehensive answer
- Make examples relevant to the query
- Explain what each example demonstrates
- Ensure the answer is COMPREHENSIVE and covers all relevant aspects
`
          : ''
        }
`;

      const languageInstruction = `
${completenessGuidance}${this.buildLanguageInstructionStaticBlock(config.legacy_language_instruction)}
`;

      const { enhancedQuery, missingInfoUsed } = useOriginalQueryOnly
        ? {
            enhancedQuery: optimizationResult.optimizedQuery,
            missingInfoUsed: false,
          }
        : this.buildEnhancedWebSearchQuery(
            cleanedQuery,
            caseName,
            clientName,
            missingInformation,
          );

      const domainInstruction =
        config.allowed_domains.length > 0
          ? `Only use reputable legal sources and prefer domains: ${config.allowed_domains.join(', ')}.`
          : '';
      const missingInformationLine = missingInfoUsed
        ? `- Pay special attention to finding comprehensive information about: ${missingInformation!.trim()}`
        : '';

      const contextQuery = this.promptTemplateService.renderTemplate(
        'web-search-grounding.txt',
        {
          languageInstruction,
          missingInformationLine,
          domainInstruction,
          enhancedQuery,
        },
      );

      const tierResult = await invokeWebSearchTier(
        {
          contents: contextQuery,
          config: {
            topP: config.gemini_top_p,
            topK: config.gemini_top_k,
            tools: [{ googleSearch: {} }],
          },
        },
        'web_grounding',
        this.llm,
      );

      const rawResult = extractLlmText(tierResult.response);

      // Remove any citations from web search result
      // Refinement will be done at the end of the pipeline
      const result = this.removeCitations(rawResult);

      if (config.cache_enabled) {
        this.setCacheValue(cacheKey, result);
      }

      const webSearchLatencyMs = Date.now() - webSearchStartTime;
      logWebSearchInvocation({
        triggerReason: groundingOptions?.triggerReason ?? 'DIRECT',
        queryMode:
          useOriginalQueryOnly || !missingInformation?.trim()
            ? 'original'
            : 'enhanced',
        latencyMs: webSearchLatencyMs,
        model: tierResult.modelUsed,
        missingInfo: missingInformation,
        originalWebQuery: optimizationResult.originalWebQuery,
        optimizedWebQuery: optimizationResult.optimizedQuery,
        enhancedWebQuery: enhancedQuery,
        optimizationApplied: optimizationResult.optimizationApplied,
        missingInfoUsed,
      });
      logDebug('WEB_SEARCH_GROUNDING', {
        finalQuery: cleanedQuery,
        latencyMs: webSearchLatencyMs,
      });
      return result;
    } catch (error) {
      logObservabilityError('WebSearchService.searchWithGrounding', error);
      return `I encountered an error while searching the web for information about '${cleanedQuery}'. Please try rephrasing your question or check your internet connection.`;
    }
  }

  /**
   * Static response-guidance block appended after query-specific completenessGuidance.
   * Toggle via WEB_SEARCH_LEGACY_LANGUAGE_INSTRUCTION for short-term A/B comparison.
   */
  private buildLanguageInstructionStaticBlock(useLegacy: boolean): string {
    return useLegacy
      ? this.buildLegacyLanguageInstructionStaticBlock()
      : this.buildTightenedLanguageInstructionStaticBlock();
  }

  private buildTightenedLanguageInstructionStaticBlock(): string {
    return `
  LANGUAGE: Respond in English by default, translating source materials as needed. Only use another language if explicitly requested (e.g., "answer in Hindi").
  
  ACCURACY: Verify against authoritative sources. Prioritize official legal texts, active statutes, and government gazettes.
  
  SCOPE & PRESENTATION: Extract raw, high-density factual information. Start directly with the facts; omit conversational intros, conclusions, or narrative fluff. Do NOT include any HTML formatting, markdown sections, or citations. Keep the response compact and purely informational.
  `;
  }

  /**
   * TEMPORARY — pre-tightening static block retained for A/B comparison.
   * Remove this method once WEB_SEARCH_LEGACY_LANGUAGE_INSTRUCTION is no longer needed.
   */
//   private buildLegacyLanguageInstructionStaticBlock(): string {
//     return `
// CRITICAL INSTRUCTIONS: 
// 1. The user's question may be in any language.
// 2. By default, always respond in **English**, regardless of the language used in the question or knowledge base.
// 3. Only respond in another language **if the user explicitly requests it**, for example:
//    - "Answer in Hindi"
//    - "Respond in Gujarati"
//    - "Give the output in Kannada"
// 4. The knowledge base content can be in any language — translate or interpret it as needed to produce a clear, fluent English answer unless instructed otherwise.

// **CRITICAL: FOCUS ONLY ON CURRENT QUESTION - NO REPETITION:**
// 5. **CRITICAL: Provide ACCURATE and VERIFIED information only**
// 6. Search for and cross-reference information from multiple authoritative sources before answering
// 7. For legal queries, prioritize official legal documents, statutes, case law, and government websites
// 8. If information conflicts between sources, mention the discrepancy and cite the most authoritative source
// 9. If you cannot find accurate information, state that clearly rather than guessing
// 10. Focus on finding the EXACT information requested in the query
// 11. For legal sections/codes (IPC, CRPC, CPC), search for the official text and detailed explanations
// 12 **If the user asks a follow-up question, answer ONLY that specific follow-up - do NOT re-explain what was already covered**

// RESPONSE GUIDELINES:
// 13.**CRITICAL: Provide COMPREHENSIVE and DETAILED answers**
// 14.**COMPLETENESS REQUIREMENTS:**
//     - Provide thorough explanations that fully address the user's query
//     - Explain key concepts, terms, and implications clearly
//     - If the query asks about a legal provision, provide: the exact text, explanation, when it applies, penalties/consequences (if applicable), and relevant examples
//     - Structure your answer with clear sections, headings, and subsections for complex topics
// 15. **DETAIL LEVEL:**
//     - Be thorough and detailed - it's better to provide comprehensive information than to be too brief
//     - Include all relevant details, nuances, and important aspects of the topic
//     - For legal queries, provide complete information including definitions, scope, exceptions, and practical implications
//     - Use bullet points, numbered lists, and clear formatting for better readability
// 16. **CRITICAL: ABSOLUTELY NO SOURCE CITATIONS IN WEB SEARCH RESPONSES**
//     - Do NOT include [Source: ...] citations anywhere in your response
//     - Do NOT mention "Document Sources", "Chunk", or any source references
//     - Do NOT include URLs, website names, or any attribution in the answer
//     - Provide the information directly without any citation formatting
//     - This is web search information and should appear without citations
// 17. Structure your answer clearly with proper headings, sections, and formatting to make it easy to read and understand, It should be a answer for the user's question so lawyer should understand the answer.
// 18. If the answer covers multiple aspects, organize them into distinct sections with clear headings.
// `;
//   }

private buildLegacyLanguageInstructionStaticBlock(): string {
  return `
## LANGUAGE & OVERRIDES
- Default to **English** for all outputs unless the user explicitly requests another language (e.g., "Answer in Hindi"). Translate source materials fluently as needed.

## LEGAL GROUNDING & STATUTORY PRECISION (CRITICAL)
- **Official Texts:** For legal codes and provisions (e.g., IPC, CrPC, CPC), retrieve and extract the official, exact statutory text and precise explanations.
- **Completeness Elements:** For any legal provision, extract:
  1. The exact operative text and definitions.
  2. The precise scope of application and legal exceptions.
  3. Associated penalties, liabilities, or procedural consequences.
  4. Real-world legal examples or applications when available.
- **Audience:** Present facts with technical legal precision. The output must be clear, nuanced, and detailed enough for a lawyer to utilize directly.

## CONFLICT HANDLING & VERIFICATION
- Search and cross-verify from multiple authoritative sources (prioritize official statutes, government websites, and court precedents).
- If sources conflict, explicitly mention the discrepancy and reference the most recent/authoritative source.
- Do NOT guess or speculate. If information cannot be verified from reliable legal sources, state that directly.
- Focus ONLY on the active query requirements. If this is a follow-up, answer ONLY the specific follow-up—do NOT re-explain previous facts.

## STYLE & NO-CITATION GATING (LATENCY REDUCTION)
- **Extraction Over Prose:** Focus strictly on extracting dense, raw factual data. Do NOT waste tokens on conversational greetings, preambles, or transition text. Start directly with the legal facts. Use plain section labels ending with ':' when listing multiple topics so a later display pass can convert them to Markdown headings.
- **No HTML/Structure Bloat:** Do NOT format the grounding output into HTML tables or long essays. Prefer dense facts with recoverable plain section labels and numbered lists over flat unmarked paragraphs.
- **ABSOLUTELY NO CITATIONS:** Web search responses must appear as plain, un-cited text. Do NOT include [Source: ...], URL links, website names, "Chunk" references, or any attribution tags.
`;
}

  /**
   * Detects query completion requirements (steps, enumeration, examples)
   */
  private getQueryCompletionRequirements(query: string): {
    requiresEnumeration: boolean;
    requiresSteps: boolean;
    requiresExamples: boolean;
    minPointsRequired: number;
  } {
    const queryLower = query.toLowerCase();

    // Detect query type
    const requiresEnumeration = /\b(list|all|what are|enumerate|name|provide)\b/i.test(queryLower);
    const requiresSteps = /\b(how to|steps|procedure|process|method|way|secure|file|submit|apply)\b/i.test(queryLower);
    const requiresExamples = /\b(example|instance|case|for instance)\b/i.test(queryLower);

    // Minimum expected points
    let minPointsRequired = 2;
    if (requiresEnumeration) minPointsRequired = 5;
    if (requiresSteps) minPointsRequired = 4;
    if (requiresExamples) minPointsRequired = 3;

    return {
      requiresEnumeration,
      requiresSteps,
      requiresExamples,
      minPointsRequired,
    };
  }

  private buildQueryRequirementHints(queryRequirements: {
    requiresEnumeration: boolean;
    requiresSteps: boolean;
    requiresExamples: boolean;
    minPointsRequired: number;
  }): string {
    const hints: string[] = [];

    if (queryRequirements.requiresEnumeration) {
      hints.push(
        'This query appears to require an enumerated or list-style answer. Verify that retrieved chunks contain enough relevant items to answer the question from the documents.',
      );
    }
    if (queryRequirements.requiresSteps) {
      hints.push(
        'This query appears to require a step-by-step or procedural answer. Verify that retrieved chunks contain enough steps to answer the question from the documents.',
      );
    }
    if (queryRequirements.requiresExamples) {
      hints.push(
        'This query appears to require examples. Verify that retrieved chunks contain enough examples to answer the question from the documents.',
      );
    }

    return hints.length > 0 ? hints.join('\n') : 'None';
  }

  private normalizeChunkSimilarity(similarity: number): number {
    return normalizeChunkSimilarity(similarity);
  }

  private logRetrievalStrengthDecision(
    strength: RetrievalStrength,
    metrics: ReturnType<typeof classifyRetrievalStrength>,
    sufficiency: 'YES' | 'PARTIAL' | 'NO',
    fallback: string,
  ): void {
    logDebug('RETRIEVAL_STRENGTH', {
      strength,
      maxSimilarity: metrics.maxSimilarity,
      chunkCount: metrics.chunkCount,
      relevantChunkCount: metrics.relevantChunkCount,
      sufficiency,
      fallback,
    });
  }

  private async generateVectorAnswerFromChunks(
    normalizedQuery: string,
    chunks: any[],
    documentChats: any[] | undefined,
    chatHistory: string | undefined,
    caseId: string,
    clientId: string,
  ): Promise<string> {
    const prompt = await this.promptBuilderService.buildPrompt(
      normalizedQuery,
      chunks,
      documentChats ?? [],
      chatHistory,
      caseId,
      clientId,
      {
        allowGeneralKnowledge: isGeneralKnowledgeScenarioAllowed(chunks),
      },
    );

    const tierResult = await invokeLegalAnswerGenerationTier(
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          topP: 0.95,
        },
      },
      this.llm,
    );

    return (
      extractLlmText(tierResult.response) ||
      'I could not find any relevant information in the provided documents to answer your question.'
    );
  }

  private async executeWebSearchOnlyFallback(
    normalizedQuery: string,
    caseName: string | undefined,
    clientName: string | undefined,
    chatHistory: string | undefined,
    triggerReason: 'NO' | 'PARTIAL',
  ): Promise<string> {
    const webResult = await this.searchWithGrounding(
      normalizedQuery,
      caseName,
      clientName,
      undefined,
      chatHistory,
      {
        ...ORIGINAL_QUERY_GROUNDING_OPTIONS,
        triggerReason,
      },
    );

    let cleanedWebResult = this.removeCitations(webResult);
    cleanedWebResult = cleanedWebResult.replace(/\[Source:\s*[^\]]+\]/gi, '');
    cleanedWebResult = cleanedWebResult.replace(/Document Sources?:\s*\[[^\]]+\]/gi, '');
    cleanedWebResult = cleanedWebResult.replace(/Chunk\s+\d+/gi, '');
    return cleanedWebResult.replace(/\n{3,}/g, '\n\n').trim();
  }

  private getSufficiencyPreviewLimit(normalizedSimilarity: number): number {
    return normalizedSimilarity >= SUFFICIENCY_EXTENDED_PREVIEW_SIMILARITY
      ? SUFFICIENCY_EXTENDED_PREVIEW_CHARS
      : SUFFICIENCY_DEFAULT_PREVIEW_CHARS;
  }

  private buildSufficiencyChunksPreview(
    chunks: any[],
    getChunkContent: (chunk: any) => string,
    previewLimit: number,
    options?: { fullText?: boolean },
  ): string {
    return chunks
      .map((chunk, i) => {
        const fullText = getChunkContent(chunk);
        const text = options?.fullText ? fullText : fullText.slice(0, previewLimit);
        const similarity = chunk?.similarity ?? 0;
        const normalizedSim = this.normalizeChunkSimilarity(similarity);
        const truncated = !options?.fullText && fullText.length > previewLimit;
        return `[Chunk ${i + 1}] (similarity: ${normalizedSim.toFixed(2)})\n${text}${truncated ? '...' : ''}`;
      })
      .join('\n\n---\n\n');
  }

  private async evaluateSemanticSufficiency(
    retrievedChunks: any[],
    query: string,
    queryRequirements: ReturnType<WebSearchService['getQueryCompletionRequirements']>,
    context: SemanticSufficiencyContext | undefined,
    options: {
      previewLimit: number;
      fullText?: boolean;
    },
  ): Promise<{ sufficiency: 'YES' | 'PARTIAL' | 'NO'; reason: string; missingInfo?: string }> {
    const config = webSearchConfig;
    const getChunkContent = (chunk: any) =>
      typeof chunk === 'string' ? chunk : chunk?.content || '';

    const retrievedChunksText = this.buildSufficiencyChunksPreview(
      retrievedChunks,
      getChunkContent,
      options.previewLimit,
      { fullText: options.fullText },
    );

    const decisionPrompt = this.promptTemplateService.renderTemplate(
      'semantic-sufficiency-check.txt',
      {
        query,
        retrievedChunksCount: retrievedChunks.length,
        retrievedChunksText,
        executorName: context?.executor ?? 'Not specified',
        executorCapability: context?.capability ?? 'Not specified',
        queryRequirementHints: this.buildQueryRequirementHints(queryRequirements),
      },
    );

    const tierResult = await invokeWebSearchTier(
      {
        contents: decisionPrompt,
        config: {
          topP: config.gemini_top_p,
        },
      },
      'sufficiency_routing',
      this.llm,
    );

    let text = extractLlmText(tierResult.response);
    text = text.replace(/```json|```/g, '').trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      text = jsonMatch[0];
    }

    const result = JSON.parse(text);
    const sufficiency = (result.sufficiency ?? 'NO').toUpperCase();
    const validSufficiency = ['YES', 'PARTIAL', 'NO'].includes(sufficiency)
      ? (sufficiency as 'YES' | 'PARTIAL' | 'NO')
      : 'NO';

    return {
      sufficiency: validSufficiency,
      reason: result.reason ?? 'AI semantic sufficiency check',
      missingInfo: result.missing_information,
    };
  }

  private applyFullChunkRecheckGuardrail(
    query: string,
    retrievedChunks: any[],
    initialResult: { sufficiency: 'YES' | 'PARTIAL' | 'NO'; reason: string; missingInfo?: string },
    normalizedSimilarity: number,
    chunkCount: number,
    similarityThreshold: number,
    queryRequirements: ReturnType<WebSearchService['getQueryCompletionRequirements']>,
    context?: SemanticSufficiencyContext,
  ): Promise<{ sufficiency: 'YES' | 'PARTIAL' | 'NO'; reason: string; missingInfo?: string }> {
    if (
      initialResult.sufficiency !== 'NO' ||
      normalizedSimilarity < similarityThreshold ||
      chunkCount < 1
    ) {
      return Promise.resolve(initialResult);
    }

    const recheckChunks = retrievedChunks.slice(0, FULL_CHUNK_RECHECK_TOP_N);

    return this.evaluateSemanticSufficiency(
      recheckChunks,
      query,
      queryRequirements,
      context,
      { previewLimit: SUFFICIENCY_DEFAULT_PREVIEW_CHARS, fullText: true },
    ).then((recheckResult) => {
      logDebug('SUFFICIENCY_GUARDRAIL', {
        action: 'full_chunk_recheck',
        topSimilarity: normalizedSimilarity,
        chunkCount,
        originalSufficiency: initialResult.sufficiency,
        newSufficiency: recheckResult.sufficiency,
      });
      markGuardrailTriggered();

      if (recheckResult.sufficiency === 'YES' || recheckResult.sufficiency === 'PARTIAL') {
        return recheckResult;
      }

      return initialResult;
    });
  }

  private isVagueMissingInformation(missingInfo?: string): boolean {
    const trimmed = missingInfo?.trim() ?? '';
    if (!trimmed) {
      return true;
    }
    return VAGUE_MISSING_INFO_PATTERN.test(trimmed);
  }

  private logSufficiencyAudit(
    payload: SufficiencyAuditPayload,
    latencyMs: number,
    guardrailTriggered: boolean,
  ): void {
    logSufficiency({
      result: payload.sufficiency,
      topSimilarity: payload.topSimilarity,
      chunkCount: payload.chunkCount,
      guardrailTriggered,
      latencyMs,
      missingInfo: payload.missingInfo,
    });
    logTrace('SUFFICIENCY_DETAIL', {
      query: payload.query,
      reason: payload.reason,
      missingInfo: payload.missingInfo ?? '',
    });
  }

  private applyPartialUpgradeGuardrail(
    query: string,
    result: {
      sufficiency: 'YES' | 'PARTIAL' | 'NO';
      reason: string;
      missingInfo?: string;
    },
    normalizedSimilarity: number,
    chunkCount: number,
  ): { sufficiency: 'YES' | 'PARTIAL' | 'NO'; reason: string; missingInfo?: string } {
    if (result.sufficiency !== 'PARTIAL') {
      return result;
    }

    const shouldUpgrade =
      normalizedSimilarity >= PARTIAL_UPGRADE_MIN_SIMILARITY &&
      chunkCount >= PARTIAL_UPGRADE_MIN_CHUNK_COUNT &&
      this.isVagueMissingInformation(result.missingInfo);

    if (!shouldUpgrade) {
      return result;
    }

    markGuardrailTriggered();
    logDebug('SUFFICIENCY_GUARDRAIL', {
      action: 'upgrade_partial_to_yes',
      query,
      topSimilarity: normalizedSimilarity,
      chunkCount,
      originalReason: result.reason,
    });

    return {
      sufficiency: 'YES',
      reason: `Guardrail upgrade: strong document match (similarity ${normalizedSimilarity.toFixed(2)}, ${chunkCount} chunks) with vague or empty missing_information. Original: ${result.reason}`,
      missingInfo: undefined,
    };
  }

  private finalizeSufficiencyResult(
    query: string,
    result: {
      sufficiency: 'YES' | 'PARTIAL' | 'NO';
      reason: string;
      missingInfo?: string;
    },
    normalizedSimilarity: number,
    chunkCount: number,
    latencyMs = 0,
  ): { sufficiency: 'YES' | 'PARTIAL' | 'NO'; reason: string; missingInfo?: string } {
    const beforeGuardrail = result.sufficiency;
    const guarded = this.applyPartialUpgradeGuardrail(
      query,
      result,
      normalizedSimilarity,
      chunkCount,
    );
    const guardrailTriggered =
      beforeGuardrail === 'PARTIAL' && guarded.sufficiency === 'YES';

    if (guarded.sufficiency === 'PARTIAL' || guarded.sufficiency === 'NO') {
      this.logSufficiencyAudit(
        {
          query,
          sufficiency: guarded.sufficiency,
          topSimilarity: normalizedSimilarity,
          chunkCount,
          missingInfo: guarded.missingInfo ?? '',
          reason: guarded.reason,
        },
        latencyMs,
        guardrailTriggered,
      );
    }

    return guarded;
  }

  /**
   * Semantic Sufficiency Judge - evaluates if chunks can fully answer the query
   * Returns: YES (sufficient), PARTIAL (some info but incomplete), NO (insufficient)
   */
  async checkSemanticSufficiency(
    retrievedChunks: any[],
    query: string,
    context?: SemanticSufficiencyContext,
  ): Promise<{ sufficiency: 'YES' | 'PARTIAL' | 'NO'; reason: string; missingInfo?: string }> {
    const sufficiencyStart = Date.now();
    const config = webSearchConfig;
    const elapsed = () => Date.now() - sufficiencyStart;

    const getChunkContent = (chunk: any) =>
      typeof chunk === 'string' ? chunk : chunk?.content || '';

    // No chunks → NO
    if (!retrievedChunks?.length) {
      return this.finalizeSufficiencyResult(
        query,
        {
          sufficiency: 'NO',
          reason: 'No chunks retrieved from document search',
        },
        0,
        0,
        elapsed(),
      );
    }

    const queryRequirements = this.getQueryCompletionRequirements(query);

    // Early guard: Check top similarity score
    const topSimilarity = retrievedChunks[0]?.similarity ?? 1.0;
    const normalizedSimilarity = this.normalizeChunkSimilarity(topSimilarity);
    const chunkCount = retrievedChunks.length;

    const similarityThreshold =
      queryRequirements.requiresSteps || queryRequirements.requiresEnumeration
        ? config.sufficiency_completeness_similarity_threshold
        : config.sufficiency_normal_similarity_threshold;

    if (normalizedSimilarity < similarityThreshold) {
      return this.finalizeSufficiencyResult(
        query,
        {
          sufficiency: 'NO',
          reason:
            'Retrieved chunks did not satisfy semantic sufficiency requirements',
        },
        normalizedSimilarity,
        chunkCount,
        elapsed(),
      );
    }

    try {
      const previewLimit = this.getSufficiencyPreviewLimit(normalizedSimilarity);

      const initialResult = await this.evaluateSemanticSufficiency(
        retrievedChunks,
        query,
        queryRequirements,
        context,
        { previewLimit },
      );

      const sufficiencyResult = await this.applyFullChunkRecheckGuardrail(
        query,
        retrievedChunks,
        initialResult,
        normalizedSimilarity,
        chunkCount,
        similarityThreshold,
        queryRequirements,
        context,
      );

      return this.finalizeSufficiencyResult(
        query,
        sufficiencyResult,
        normalizedSimilarity,
        chunkCount,
        elapsed(),
      );
    } catch (err) {
      this.logger.warn(`Semantic sufficiency check error; fallback used: ${err.message}`);

      // Fallback: use chunk count/length as weak heuristic
      const totalLength = retrievedChunks.reduce((sum, c) => sum + getChunkContent(c).length, 0);
      if (retrievedChunks.length >= config.min_chunks_threshold && totalLength >= config.min_chunk_length) {
        return this.finalizeSufficiencyResult(
          query,
          {
            sufficiency: 'PARTIAL',
            reason: 'Fallback: Chunks meet minimum thresholds but semantic check failed',
          },
          normalizedSimilarity,
          chunkCount,
          elapsed(),
        );
      }

      return this.finalizeSufficiencyResult(
        query,
        {
          sufficiency: 'NO',
          reason: 'Fallback: Chunks below minimum thresholds',
        },
        normalizedSimilarity,
        chunkCount,
        elapsed(),
      );
    }
  }

  clearCache(): void {
    this.webSearchCache.clear();
  }

  getCacheStats(): {
    cachedQueries: number;
    cacheSize: number;
    cacheEnabled: boolean;
    cacheTtl: number;
  } {
    const config = webSearchConfig;
    if (!config.cache_enabled) {
      return {
        cachedQueries: 0,
        cacheSize: 0,
        cacheEnabled: false,
        cacheTtl: 0,
      };
    }

    return {
      cachedQueries: this.webSearchCache.size,
      cacheSize: 0,
      cacheEnabled: true,
      cacheTtl: config.cache_ttl_seconds,
    };
  }

  private setCacheValue(key: string, value: string): void {
    if (this.webSearchCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.webSearchCache.keys().next().value;
      this.webSearchCache.delete(firstKey);
    }
    this.webSearchCache.set(key, { result: value, timestamp: Date.now() });
  }

  private buildDocumentChunksText(
    chunks: any[],
    documentChats?: any[],
  ): string {
    const documentMap = new Map<string, string>();
    if (documentChats && documentChats.length > 0) {
      documentChats.forEach((dc: any) => {
        if (dc.Document?.originalName) {
          documentMap.set(dc.documentId, dc.Document.originalName);
        }
      });
    }

    const validChunks = chunks.filter((chunk) => {
      if (typeof chunk === 'string') {
        return false;
      }
      const documentId = chunk.documentId ?? '';
      return documentId && documentMap.has(documentId);
    });

    return validChunks
      .map((chunk) => {
        const text = typeof chunk === 'string' ? chunk : chunk.content;
        const documentId =
          typeof chunk === 'string' ? '' : (chunk.documentId ?? '');
        const documentName = documentMap.get(documentId);
        if (documentName == null) {
          return null;
        }
        return `[Source: ${documentName}]\n${text.slice(0, 500)}${text.length >= 500 ? '...' : ''}`;
      })
      .filter((part) => part !== null)
      .join('\n\n---\n\n');
  }

  private async generateDocumentInsufficiencyFollowUp(
    query: string,
    missingInfo: string,
    documentChunksText: string,
    partialAnswer: string,
  ): Promise<string> {
    const prompt = this.promptTemplateService.renderTemplate(
      'document-insufficiency-followup.txt',
      {
        query,
        missingInfo: missingInfo || 'Not specified',
        documentChunksText: documentChunksText || 'No relevant excerpts retrieved.',
        partialAnswer,
      },
    );

    try {
      const tierResult = await invokeDocumentInsufficiencyTier(
        {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            topP: 0.95,
          },
        },
        this.llm,
      );
      const followUp = (extractLlmText(tierResult.response) ?? '').trim();
      if (followUp) {
        return followUp.endsWith('?') ? followUp : `${followUp}?`;
      }
    } catch (error: any) {
      this.logger.warn(
        `[WEB_SEARCH_TIER] document insufficiency follow-up generation failed (${error.message})`,
      );
    }

    return 'Would you like me to search outside the uploaded document for this information?';
  }

  /**
   * Document-grounded response when retrieval is insufficient and web search must not run.
   */
  async generateDocumentGroundedInsufficiencyAnswer(
    query: string,
    retrievedChunks: any[],
    sufficiency: DocumentInsufficiencyInput,
    documentChats?: any[],
    chatHistory?: string,
  ): Promise<{ answer: string; source_info: string }> {
    let normalizedQuery = query;
    if (chatHistory && this.hasContextualReferences(query)) {
      normalizedQuery = await this.resolveContextualReferences(
        query,
        chatHistory,
        'generateHybridAnswer',
      );
    }

    const chunks = (retrievedChunks ?? []).map((chunk, idx) =>
      typeof chunk === 'string'
        ? {
            id: `chunk-${idx}`,
            content: chunk,
            documentId: '',
            similarity: 0,
          }
        : chunk,
    );
    const documentChunksText = this.buildDocumentChunksText(
      chunks,
      documentChats,
    );
    const missingInfo = sufficiency.missingInfo ?? '';

    const prompt = this.promptTemplateService.renderTemplate(
      'document-grounded-insufficiency.txt',
      {
        query: normalizedQuery,
        missingInfo: missingInfo || 'Not specified',
        documentChunksText:
          documentChunksText || 'No relevant excerpts were retrieved.',
      },
    );

    try {
      const tierResult = await invokeDocumentInsufficiencyTier(
        {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            topP: 0.95,
          },
        },
        this.llm,
      );
      const answer =
        extractLlmText(tierResult.response) ??
        this.buildFallbackDocumentInsufficiencyAnswer(
          normalizedQuery,
          missingInfo,
          documentChunksText,
        );

      this.logger.log(
        `[PROCESS] generateDocumentGroundedInsufficiencyAnswer completed for query="${normalizedQuery}"`,
      );
      return {
        answer: answer.replace(/\n{3,}/g, '\n\n').trim(),
        source_info: 'document_insufficient',
      };
    } catch (error: any) {
      this.logger.warn(
        `[WEB_SEARCH_TIER] document grounded insufficiency generation failed (${error.message})`,
      );
      return {
        answer: this.buildFallbackDocumentInsufficiencyAnswer(
          normalizedQuery,
          missingInfo,
          documentChunksText,
        ),
        source_info: 'document_insufficient',
      };
    }
  }

  private buildFallbackDocumentInsufficiencyAnswer(
    query: string,
    missingInfo: string,
    documentChunksText: string,
  ): string {
    const subject = missingInfo || 'the requested information';
    const relatedInfo = documentChunksText
      ? ' I did find some related content in the retrieved excerpts, but it does not directly answer your question.'
      : '';
    return `I could not find information about ${subject} in the uploaded document.${relatedInfo} Would you like me to search outside the uploaded document?`;
  }

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
  async generateHybridAnswer(
    query: string,
    retrievedChunks: string[] | any[],
    caseId: string,
    clientId: string,
    caseName?: string,
    clientName?: string,
    chatHistory?: string,
    webSearchEnabled: boolean = true,
    documentChats?: any[],
    precomputedSufficiency?: { sufficiency: 'YES' | 'PARTIAL' | 'NO'; reason: string; missingInfo?: string },
    options?: HybridAnswerOptions,
  ): Promise<{ answer: string; source_info: string }> {
    const hybridStartTime = Date.now();
    let normalizedQuery = query;
    const completeHybrid = (
      sourceInfo: string,
      answer: string,
    ): { answer: string; source_info: string } => {
      const latencyMs = Date.now() - hybridStartTime;
      recordTiming('answerGenerationMs', latencyMs);
      setSourceInfo(sourceInfo);
      logDebug('HYBRID_ANSWER', {
        sourceInfo,
        latencyMs,
        query: normalizedQuery,
      });
      return { answer, source_info: sourceInfo };
    };

    let isDocumentScoped =
      options?.documentScoped ?? isDocumentScopedQuery(query);
    const explicitWebSearch = isExplicitWebSearchQuery(query);
    let chunks: any[] = [];

    try {
      if (chatHistory && this.shouldResolveContextualReferences(query, options)) {
        normalizedQuery = await this.resolveContextualReferences(
          query,
          chatHistory,
          'generateHybridAnswer',
        );
      }

      if (explicitWebSearch) {
        normalizedQuery =
          stripExplicitWebSearchFraming(normalizedQuery) || normalizedQuery;
      }

      isDocumentScoped =
        options?.documentScoped ?? isDocumentScopedQuery(query);

      // Check if chunks are ChunkResult[] or string[]
      const isChunkResultArray =
        retrievedChunks.length > 0 &&
        typeof retrievedChunks[0] === 'object' &&
        'content' in retrievedChunks[0];

      // Convert to ChunkResult format if needed
      chunks = isChunkResultArray
        ? (retrievedChunks as any[])
        : retrievedChunks.map((content, idx) => ({
          id: `chunk-${idx}`,
          content: content as string,
          documentId: '',
          similarity: 0,
        }));

      // STEP 1: Judge semantic sufficiency BEFORE generating any answer
      if (!retrievedChunks || retrievedChunks.length === 0) {
        if (isDocumentScoped && !explicitWebSearch) {
          const insufficiencyResult =
            await this.generateDocumentGroundedInsufficiencyAnswer(
              query,
              chunks,
              {
                reason:
                  precomputedSufficiency?.reason ??
                  'No relevant documents found in vector search',
              },
              documentChats,
              chatHistory,
            );
          return completeHybrid(
            insufficiencyResult.source_info,
            insufficiencyResult.answer,
          );
        }

        // RETRIEVAL_NONE: corpus has no topical match → web when allowed
        if (webSearchEnabled) {
          const cleanedWebResult = await this.executeWebSearchOnlyFallback(
            normalizedQuery,
            caseName,
            clientName,
            chatHistory,
            'NO',
          );
          return completeHybrid('web_search_only', cleanedWebResult);
        }

        return completeHybrid(
          'no_results',
          'I could not find any relevant information in the provided documents to answer your question.',
        );
      }

      // STEP 2: Retrieval-evidence-first routing (sufficiency is advisory)
      const sufficiencyCheck =
        precomputedSufficiency ??
        (await this.checkSemanticSufficiency(chunks, normalizedQuery));

      const retrievalMetrics = classifyRetrievalStrength(chunks);
      const route = resolveHybridAnswerRoute(
        retrievalMetrics.strength,
        sufficiencyCheck.sufficiency,
        {
          documentScoped: isDocumentScoped,
          webSearchEnabled,
          explicitWebSearch,
        },
      );

      this.logRetrievalStrengthDecision(
        retrievalMetrics.strength,
        retrievalMetrics,
        sufficiencyCheck.sufficiency,
        route,
      );

      if (route === 'web_search_only') {
        if (explicitWebSearch) {
          logDebug('WEB_SEARCH_TRIGGER', {
            message:
              'Web search triggered because the user explicitly requested web search.',
            branch: 'EXPLICIT',
            queryMode: 'original',
          });
        } else {
          this.logHybridWebSearchInvocation(
            sufficiencyCheck.sufficiency === 'PARTIAL' ? 'PARTIAL' : 'NO',
            sufficiencyCheck.missingInfo,
            normalizedQuery,
            caseName,
            clientName,
          );
        }

        const cleanedWebResult = await this.executeWebSearchOnlyFallback(
          normalizedQuery,
          caseName,
          clientName,
          chatHistory,
          sufficiencyCheck.sufficiency === 'PARTIAL' ? 'PARTIAL' : 'NO',
        );
        return completeHybrid('web_search_only', cleanedWebResult);
      }

      if (route === 'document_answer') {
        const vectorAnswerText = await this.generateVectorAnswerFromChunks(
          normalizedQuery,
          chunks,
          documentChats,
          chatHistory,
          caseId,
          clientId,
        );
        return completeHybrid('vector_search_only', vectorAnswerText);
      }

      if (route === 'no_topic_coverage') {
        return completeHybrid(
          'no_results',
          NO_TOPIC_COVERAGE_WEB_DISABLED_MESSAGE,
        );
      }

      if (route === 'hybrid') {
        // Chunks are partial → fetch web + prepare chunk context in parallel, then synthesize
        const buildDocumentChunksText = (): string =>
          this.buildDocumentChunksText(chunks, documentChats);

        this.logHybridWebSearchInvocation(
          'PARTIAL',
          sufficiencyCheck.missingInfo,
          normalizedQuery,
          caseName,
          clientName,
        );

        const [webResult, documentChunksText] = await Promise.all([
          this.searchWithGrounding(
            normalizedQuery,
            caseName,
            clientName,
            sufficiencyCheck.missingInfo,
            chatHistory,
            {
              documentScoped: isDocumentScoped,
              triggerReason: 'PARTIAL',
            },
          ),
          Promise.resolve(buildDocumentChunksText()),
        ]);

        // Single final synthesis combining both sources
        const queryRequirements = this.getQueryCompletionRequirements(normalizedQuery);

        const requiredFormatSteps = queryRequirements.requiresSteps
  ? `REQUIRED FORMAT:
- STRUCTURE: Provide a numbered step-by-step sequence (1., 2., 3., ...).
- QUANTITY: List AT LEAST ${queryRequirements.minPointsRequired} steps. If more steps are legally/procedurally required, include them.
- FLOW: If applicable, list key prerequisites immediately before Step 1, and brief tips/considerations immediately after the final step.
- STYLE: Keep each step highly dense, crisp, and concise (maximum 2-3 sentences per step). Do NOT add conversational filler or repeat background facts.
- CITATIONS: Apply dual-source citation rules to every step (append [Source: doc.pdf] for internal facts; use NO citations for web facts).`
  : '';

    const requiredFormatEnumeration = queryRequirements.requiresEnumeration
  ? `REQUIRED FORMAT:
- STRUCTURE: Provide a clean numbered or bulleted list.
- QUANTITY: Include AT LEAST ${queryRequirements.minPointsRequired} distinct items. If more are needed to be legally complete, include them.
- ORGANIZATION: Group highly related legal items together under bold subheadings.
- STYLE: For each item, provide a crisp, 1-2 sentence explanation. Keep the language precise, direct, and free of fluff.
- CITATIONS: Apply dual-source citation rules to every item (append [Source: doc.pdf] for internal facts; use NO citations for web facts).`
  : '';
        const synthesisPrompt = this.promptTemplateService.renderTemplate(
          'hybrid-synthesis.txt',
          {
            query: normalizedQuery,
            requiredFormatSteps,
            requiredFormatEnumeration,
            documentChunksText,
            webSearchResults: this.removeCitations(webResult),
          },
        );

        let synthesisResult: Awaited<ReturnType<typeof invokeWebSearchTier>> | null =
          null;
        let finalAnswer = webResult;

        try {
          synthesisResult = await invokeWebSearchTier(
            {
              contents: [{ role: 'user', parts: [{ text: synthesisPrompt }] }],
              config: {
          topP: 0.95,
              },
            },
            'hybrid_synthesis',
            this.llm,
          );
          finalAnswer = extractLlmText(synthesisResult.response) || webResult;
        } catch (error: any) {
          this.logger.warn(
            `[WEB_SEARCH_TIER] hybrid_synthesis exhausted model chain; using web-only answer (${error.message})`,
          );
        }

        getWebSearchTierMetrics().recordHybridQuality(
          documentChunksText,
          finalAnswer,
          {
            query: normalizedQuery,
            model: synthesisResult?.modelUsed,
          },
        );

        // Clean up any chunk number references that might have been generated
        // Replace patterns like "Document Sources: [Chunk 1, 2, 15]" or "[Source: Chunk 1]"
        finalAnswer = finalAnswer.replace(/\[Source:\s*Chunk\s+\d+\]/gi, '');
        finalAnswer = finalAnswer.replace(/Document Sources?:\s*\[Chunk\s+[\d,\s]+\]/gi, '');
        finalAnswer = finalAnswer.replace(/\[Source:\s*Document\s+Chunk\s+\d+\]/gi, '');
        // Remove any remaining chunk references
        finalAnswer = finalAnswer.replace(/\bChunk\s+\d+\b/gi, '');
        finalAnswer = finalAnswer.replace(/\n{3,}/g, '\n\n').trim();

        if (options?.documentScoped) {
          const followUp = await this.generateDocumentInsufficiencyFollowUp(
            normalizedQuery,
            sufficiencyCheck.missingInfo ?? '',
            documentChunksText,
            finalAnswer,
          );
          finalAnswer = `${finalAnswer}\n\n${followUp}`;
        }

        return completeHybrid('vector_search + web_search', finalAnswer);
      }

      if (route === 'document_insufficient') {
        const insufficiencyResult =
          await this.generateDocumentGroundedInsufficiencyAnswer(
            query,
            chunks,
            {
              reason: sufficiencyCheck.reason,
              missingInfo: sufficiencyCheck.missingInfo,
            },
            documentChats,
            chatHistory,
          );
        return completeHybrid(
          insufficiencyResult.source_info,
          insufficiencyResult.answer,
        );
      }

      const vectorAnswerText = await this.generateVectorAnswerFromChunks(
        normalizedQuery,
        chunks,
        documentChats,
        chatHistory,
        caseId,
        clientId,
      );
      return completeHybrid('vector_search_only', vectorAnswerText);
    } catch (error) {
      logObservabilityError('WebSearchService.generateHybridAnswer', error);

      const retrievalMetrics = classifyRetrievalStrength(chunks);
      const errorRoute = resolveHybridAnswerRoute(
        retrievalMetrics.strength,
        precomputedSufficiency?.sufficiency ?? 'NO',
        {
          documentScoped: isDocumentScoped,
          webSearchEnabled,
          explicitWebSearch,
        },
      );

      if (errorRoute === 'no_topic_coverage') {
        return completeHybrid(
          'no_results',
          NO_TOPIC_COVERAGE_WEB_DISABLED_MESSAGE,
        );
      }

      if (errorRoute === 'web_search_only' && webSearchEnabled) {
        try {
          const cleanedWebResult = await this.executeWebSearchOnlyFallback(
            normalizedQuery,
            caseName,
            clientName,
            chatHistory,
            'NO',
          );
          return completeHybrid('web_search_only', cleanedWebResult);
        } catch (webError) {
          logObservabilityError(
            'WebSearchService.generateHybridAnswer.webFallback',
            webError,
          );
        }
      }

      if (
        errorRoute === 'document_insufficient' &&
        chunks.length > 0
      ) {
        try {
          const insufficiencyResult =
            await this.generateDocumentGroundedInsufficiencyAnswer(
              query,
              chunks,
              {
                reason:
                  precomputedSufficiency?.reason ??
                  'Unable to generate answer from documents',
              },
              documentChats,
              chatHistory,
            );
          return completeHybrid(
            insufficiencyResult.source_info,
            insufficiencyResult.answer,
          );
        } catch (insufficiencyError) {
          logObservabilityError(
            'WebSearchService.generateHybridAnswer.insufficiencyFallback',
            insufficiencyError,
          );
        }
      }

      return completeHybrid(
        'error',
        'I encountered an error while processing your query. Please try again.',
      );
    }
  }

  /**
   * Checks if query contains contextual references that need resolution
   */
  private shouldResolveContextualReferences(
    query: string,
    options?: HybridAnswerOptions,
  ): boolean {
    if (options?.skipContextualResolution) {
      return false;
    }
    if (!this.hasContextualReferences(query)) {
      return false;
    }
    if (this.hasExplicitEnumeratedEntities(query)) {
      return false;
    }
    return true;
  }

  /** Query already names concrete items (e.g. multiple dates) — no history resolution needed. */
  private hasExplicitEnumeratedEntities(query: string): boolean {
    const dateMatches = query.match(/\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/g);
    return (dateMatches?.length ?? 0) >= 2;
  }

  private hasContextualReferences(query: string): boolean {
    const referencePatterns = [
      // Ordinal references with numbers (1st, 2nd, 3rd, 4th, etc.)
      /\b(the\s+)?(\d+)(st|nd|rd|th)\s+(point|option|approach|way|method|step|item|one|suggestion|remedy|solution|alternative)\b/i,
      // "option 1", "point 2", "step 3" patterns
      /\b(option|point|step|item|suggestion|remedy|solution|alternative)\s+\d+\b/i,
      // Word ordinals (first, second, third, etc.)
      /\b(the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)\s+(point|option|approach|way|method|step|item|one|suggestion|remedy|solution|alternative)\b/i,
      // Short ordinals without noun ("the 4th", "the first", "the last")
      /\b(the\s+)(\d+)(st|nd|rd|th)\b/i,
      /\b(the\s+)(first|second|third|fourth|fifth|last)\b/i,
      // Follow-up indicators
      /\b(tell me more|explain more|more about|more on|elaborate|expand on|go deeper|think harder|what about)\b/i,
      // Reference to previous discussion
      /\b(as (I|you) (said|mentioned)|previously|earlier|above|the same)\b/i,
      // Follow-ups indicating prior remedies already attempted
      /\b(already (did|done|tried|used|approached)|i have already|why are you giving me)\b/i,
      // "I like/fancy/prefer the..." patterns
      /\b(I\s+)?(like|fancy|prefer|choose|want|pick)\s+(the\s+)?\d/i,
      /\b(I\s+)?(like|fancy|prefer|choose|want|pick)\s+(the\s+)?(first|second|third|fourth|fifth|last)\b/i,
    ];
    return referencePatterns.some(pattern => pattern.test(query));
  }

  /**
   * Resolves contextual references (e.g., "the 4th point") from chat history
   */
  private async resolveContextualReferences(
    query: string,
    chatHistory: string,
    caller: 'searchWithGrounding' | 'generateHybridAnswer',
  ): Promise<string> {
    try {
      const resolutionPrompt = this.promptTemplateService.renderTemplate(
        'context-resolution.txt',
        {
          chatHistory,
          query,
        },
      );

      const tierResult = await invokeWebSearchTier(
        {
          contents: [{ role: 'user', parts: [{ text: resolutionPrompt }] }],
          config: {
            topP: 0.95,
          },
        },
        'web_grounding',
        this.llm,
      );

      const resolvedQuery = extractLlmText(tierResult.response) || query;
      
      // If resolution failed or returned something weird, use original query
      if (!resolvedQuery || resolvedQuery.length < 3 || resolvedQuery.toLowerCase().includes('i cannot')) {
        this.logger.warn(`[WEB SEARCH] Failed to resolve contextual references, using original query`);
        return query;
      }

      if (resolvedQuery !== query.trim()) {
        this.logger.log(
          `[WEB SEARCH] Context reference resolved via ${caller}: original="${query}" resolved="${resolvedQuery}"`,
        );
      }

      return resolvedQuery;
    } catch (error) {
      this.logger.error(`Error resolving contextual references: ${error.message}`);
      return query; // Fallback to original query
    }
  }

  /**
   * Removes citation patterns from text (e.g., [Source: ...])
   * This is used to clean web search results that shouldn't have citations
   */
  private removeCitations(text: string): string {
    if (!text) return text;

    // Remove [Source: ...] patterns (case insensitive)
    let cleaned = text.replace(/\[Source:\s*[^\]]+\]/gi, '');

    // Remove multiple consecutive newlines that might result from citation removal
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Trim whitespace
    return cleaned.trim();
  }
}
