import { Injectable, Logger } from '@nestjs/common';
import { logQueryDecomposition } from './request-observability';
import {
  CaseContext,
  ChatMessage,
  QueryDecompositionResult,
} from '../types/chat.interface';
import { getLlmGateway } from './llm-gateway.service';
import { GEMINI_3_1_FLASH_LITE } from './llm-model.constants';
import { PromptTemplateService } from './prompt-template.service';
import {
  buildRecentConversationSection,
  buildSummarySection,
} from './conversation-history.util';

interface LlmDecompositionResponse {
  should_decompose?: boolean;
  sub_queries?: string[];
  decomposition_reason?: string;
}

@Injectable()
export class QueryDecompositionService {
  private readonly logger = new Logger(QueryDecompositionService.name);
  private readonly llm = getLlmGateway();

  constructor(private readonly promptTemplateService: PromptTemplateService) {}

  async decompose(
    query: string,
    conversationHistory?: ChatMessage[],
    caseContext?: CaseContext,
  ): Promise<QueryDecompositionResult> {
    const originalQuery = (query ?? '').trim();
    if (!originalQuery) {
      return this.noDecomposition(originalQuery);
    }

    if (!this.mightNeedDecomposition(originalQuery)) {
      return this.noDecomposition(originalQuery);
    }

    try {
      const llmResult = await this.decomposeWithLlm(
        originalQuery,
        conversationHistory,
        caseContext,
      );

      return this.toDecompositionResult(originalQuery, llmResult);
    } catch (error: any) {
      this.logger.warn(
        `[QueryDecomposition] LLM decomposition failed, falling back: ${error.message}`,
      );
      return this.noDecomposition(originalQuery);
    }
  }

  logDecompositionResult(result: QueryDecompositionResult): void {
    logQueryDecomposition({
      originalQuery: result.originalQuery,
      shouldDecompose: result.shouldDecompose,
      subQueries: result.subQueries,
      reason: result.decompositionReason ?? 'none',
    });
  }

  mightNeedDecomposition(query: string): boolean {
    const normalized = query.toLowerCase();

    const multiTaskPatterns = [
      /\band\b.+\b(explain|summari[sz]e|list|show|tell|describe|compare|what|whether|have)\b/i,
      /\b(explain|summari[sz]e|list|show|tell|describe|compare)\b.+\band\b/i,
      /\balso\b/i,
      /\bas well as\b/i,
    ];

    return multiTaskPatterns.some((pattern) => pattern.test(normalized));
  }

  private async decomposeWithLlm(
    query: string,
    conversationHistory?: ChatMessage[],
    caseContext?: CaseContext,
  ): Promise<LlmDecompositionResponse> {
    const summarySection = buildSummarySection(caseContext?.conversationSummary);
    const historySection = buildRecentConversationSection(
      conversationHistory ?? [],
    );

    const caseContextSection = caseContext
      ? [
          caseContext.caseName ? `Case: ${caseContext.caseName}` : '',
          caseContext.clientName ? `Client: ${caseContext.clientName}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '';

    const prompt = this.promptTemplateService.renderTemplate(
      'query-decomposition.txt',
      {
        query,
        historySection,
        summarySection,
        caseContextSection,
      },
    );

    const response = await this.llm.generateContent({
      model: GEMINI_3_1_FLASH_LITE,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0,
        topP: 0.95,
        topK: 40,
      },
    });

    const responseText =
      response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';

    return this.parseLlmResponse(responseText);
  }

  private toDecompositionResult(
    originalQuery: string,
    llmResult: LlmDecompositionResponse,
  ): QueryDecompositionResult {
    if (!llmResult.should_decompose) {
      return {
        originalQuery,
        shouldDecompose: false,
        subQueries: [],
        decompositionReason:
          llmResult.decomposition_reason?.trim() || 'single_intent',
      };
    }

    const subQueries = (llmResult.sub_queries ?? [])
      .map((subQuery) => subQuery.trim())
      .filter(Boolean);

    if (subQueries.length < 2) {
      return this.noDecomposition(originalQuery);
    }

    return {
      originalQuery,
      shouldDecompose: true,
      subQueries,
      decompositionReason:
        llmResult.decomposition_reason?.trim() ||
        'multiple_independent_tasks',
    };
  }

  private parseLlmResponse(responseText: string): LlmDecompositionResponse {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { should_decompose: false, sub_queries: [] };
    }

    try {
      return JSON.parse(jsonMatch[0]) as LlmDecompositionResponse;
    } catch {
      return { should_decompose: false, sub_queries: [] };
    }
  }

  private noDecomposition(originalQuery: string): QueryDecompositionResult {
    return {
      originalQuery,
      shouldDecompose: false,
      subQueries: [],
      decompositionReason: 'single_intent',
    };
  }
}
