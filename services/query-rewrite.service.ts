import { Injectable, Logger } from '@nestjs/common';
import {
  CaseContext,
  ChatMessage,
  QueryRewriteIntent,
  QueryRewriteResult,
} from '../types/chat.interface';
import {
  buildNumberedTurnHistorySection,
  countConversationTurns,
  formatNumberedTurnHistory,
} from './conversation-history.util';
import { getLlmGateway } from './llm-gateway.service';
import { isBareAssentQuery } from './bare-assent-query.util';
import { isExplicitWebSearchQuery } from './explicit-web-search-query.util';
import { PromptTemplateService } from './prompt-template.service';
import { queryRewriteConfig } from './query-rewrite-config';
import {
  logQueryRewrite,
  logQueryRewriteHistory,
} from './request-observability';

interface LlmRewriteResponse {
  rewritten_query: string;
  was_rewritten: boolean;
  rewrite_reason: string | null;
  history_used: boolean;
  confidence: 'high' | 'low' | 'medium';
  intent?: QueryRewriteIntent | null;
}

@Injectable()
export class QueryRewriteService {
  private readonly logger = new Logger(QueryRewriteService.name);
  private readonly llm = getLlmGateway();

  constructor(private readonly promptTemplateService: PromptTemplateService) {}

  async rewrite(
    query: string,
    conversationHistory?: ChatMessage[],
    _caseContext?: CaseContext,
  ): Promise<QueryRewriteResult> {
    const originalQuery = (query ?? '').trim();
    if (!originalQuery) {
      return this.noRewrite(originalQuery);
    }

    const messages = conversationHistory ?? [];
    const historyContext = this.buildHistoryContext(messages);

    try {
      const llmResult = await this.rewriteWithLlm(
        originalQuery,
        messages,
        historyContext,
      );

      const confidence = llmResult.confidence ?? 'low';

      if (confidence !== 'high' || !llmResult.rewritten_query?.trim()) {
        const result = this.noRewrite(originalQuery);
        this.logRewriteOutcome(result, historyContext, {
          llmInvoked: true,
          confidence,
          reason: llmResult.rewrite_reason ?? 'low confidence or empty rewrite',
          historyUsed: llmResult.history_used,
        });
        return result;
      }

      const rewrittenQuery = llmResult.rewritten_query.trim();
      const wasRewritten =
        llmResult.was_rewritten === true &&
        rewrittenQuery.toLowerCase() !== originalQuery.toLowerCase();

      if (
        wasRewritten &&
        this.hasUnresolvedReference(originalQuery) &&
        this.hasUnresolvedReference(rewrittenQuery)
      ) {
        const result = this.noRewrite(originalQuery);
        this.logRewriteOutcome(result, historyContext, {
          llmInvoked: true,
          confidence,
          reason: 'reference still unresolved after rewrite',
          historyUsed: llmResult.history_used,
        });
        return result;
      }

      if (!wasRewritten) {
        const result = this.noRewrite(originalQuery);
        this.logRewriteOutcome(result, historyContext, {
          llmInvoked: true,
          confidence,
          reason: llmResult.rewrite_reason ?? 'unchanged query',
          historyUsed: llmResult.history_used,
        });
        return result;
      }

      if (
        this.isBareProximityQuery(originalQuery) &&
        !this.citesAnchorTurn(llmResult.rewrite_reason)
      ) {
        const result = this.noRewrite(originalQuery);
        this.logRewriteOutcome(result, historyContext, {
          llmInvoked: true,
          confidence,
          reason: 'bare proximity rewrite missing anchor turn citation',
          historyUsed: llmResult.history_used,
        });
        return result;
      }

      if (isBareAssentQuery(originalQuery)) {
        const assentValidation = this.validateBareAssentRewrite(
          llmResult,
          rewrittenQuery,
        );
        if (!assentValidation.valid) {
          const result = this.noRewrite(originalQuery);
          this.logRewriteOutcome(result, historyContext, {
            llmInvoked: true,
            confidence,
            reason: assentValidation.reason,
            historyUsed: llmResult.history_used,
          });
          return result;
        }
      }

      const result: QueryRewriteResult = {
        originalQuery,
        rewrittenQuery,
        wasRewritten: true,
        rewriteReason: llmResult.rewrite_reason?.trim() || 'LLM rewrite',
        historyUsed: llmResult.history_used === true,
        intent:
          llmResult.intent === 'accept_web_search_offer'
            ? 'accept_web_search_offer'
            : undefined,
      };
      this.logRewriteOutcome(result, historyContext, {
        llmInvoked: true,
        confidence,
        reason: result.rewriteReason ?? 'LLM rewrite',
        historyUsed: llmResult.history_used,
      });
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[QueryRewrite] LLM rewrite failed, falling back: ${message}`,
      );

      const result = this.noRewrite(originalQuery);
      this.logRewriteOutcome(result, historyContext, {
        llmInvoked: true,
        confidence: 'low',
        reason: 'LLM failure fallback',
      });
      return result;
    }
  }

  logRewriteResult(
    result: QueryRewriteResult,
    conversationHistory?: ChatMessage[],
  ): void {
    this.logRewriteOutcome(
      result,
      this.buildHistoryContext(conversationHistory ?? []),
      {
        llmInvoked: true,
        confidence: result.wasRewritten ? 'high' : 'low',
        reason: result.rewriteReason ?? 'none',
      },
    );
  }

  private buildHistoryContext(messages: ChatMessage[]): {
    messageCount: number;
    turnCount: number;
    historySent: string;
  } {
    const historySent = formatNumberedTurnHistory(messages);
    return {
      messageCount: messages.length,
      turnCount: countConversationTurns(messages),
      historySent,
    };
  }

  private logRewriteOutcome(
    result: QueryRewriteResult,
    historyContext: {
      messageCount: number;
      turnCount: number;
      historySent: string;
    },
    details: {
      llmInvoked: boolean;
      confidence: string;
      reason: string;
      historyUsed?: boolean;
    },
  ): void {
    const finalPipelineQuery = result.wasRewritten
      ? result.rewrittenQuery
      : result.originalQuery;

    logQueryRewrite({
      originalQuery: result.originalQuery,
      rewrittenQuery: finalPipelineQuery,
      wasRewritten: result.wasRewritten,
      reason: details.reason,
      historyMessageCount: historyContext.messageCount,
      historyTurnCount: historyContext.turnCount,
      historyUsed: details.historyUsed ?? false,
      historyChars: historyContext.historySent.length,
    });
  }

  private async rewriteWithLlm(
    query: string,
    messages: ChatMessage[],
    historyContext: {
      messageCount: number;
      turnCount: number;
      historySent: string;
    },
  ): Promise<LlmRewriteResponse> {
    const historySection = buildNumberedTurnHistorySection(messages);

    const systemInstruction = this.promptTemplateService.renderTemplate(
      'query-pre-rewrite.txt',
      {},
    );

    const userPrompt = `
[History]
${historySection}
Current query:
${query}
`;

    logQueryRewriteHistory({
      historySent: historyContext.historySent,
      llmUserPrompt: userPrompt.trim(),
    });

    const jsonSchema = {
      type: 'object',
      properties: {
        rewritten_query: {
          type: 'string',
          description:
            'The rewritten query or the original query if unchanged.',
        },
        was_rewritten: {
          type: 'boolean',
          description:
            'Whether the query was modified using history or grammar.',
        },
        rewrite_reason: {
          type: 'string',
          nullable: true,
          description:
            'A brief description of why the rewrite happened, or null.',
        },
        history_used: {
          type: 'boolean',
          description:
            'True if history was used to resolve references, false otherwise.',
        },
        confidence: {
          type: 'string',
          enum: ['high', 'low', 'medium'],
          description:
            'High if references are resolved with certainty, including explicit deliverable corrections (e.g. overview not timeline). Medium or low only for ambiguous bare-proximity dissatisfaction or when unchanged.',
        },
        intent: {
          type: 'string',
          nullable: true,
          enum: ['accept_web_search_offer'],
          description:
            'Set to accept_web_search_offer ONLY when resolving bare assent to a prior Assistant offer to search outside documents or search the web. For other bare assent resolutions, set null.',
        },
      },
      required: [
        'rewritten_query',
        'was_rewritten',
        'rewrite_reason',
        'history_used',
        'confidence',
        'intent',
      ],
    };

    const response = await this.llm.generateContent({
      model: queryRewriteConfig.model,
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction,
        temperature: 0,
        topP: 0.1,
        topK: 1,
        responseMimeType: 'application/json',
        responseSchema: jsonSchema,
      },
    });

    const responseText =
      response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';

    return this.parseLlmResponse(responseText);
  }

  private parseLlmResponse(responseText: string): LlmRewriteResponse {
    try {
      return JSON.parse(responseText) as LlmRewriteResponse;
    } catch (error) {
      this.logger.warn(
        `Failed parsing raw JSON response: ${responseText}. Falling back to regex parser.`,
      );

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          rewritten_query: '',
          was_rewritten: false,
          rewrite_reason: 'Parsing failed',
          history_used: false,
          confidence: 'low',
        };
      }
      try {
        return JSON.parse(jsonMatch[0]) as LlmRewriteResponse;
      } catch {
        return {
          rewritten_query: '',
          was_rewritten: false,
          rewrite_reason: 'Parsing failed',
          history_used: false,
          confidence: 'low',
        };
      }
    }
  }

  private hasUnresolvedReference(query: string): boolean {
    const referencePatterns = [
      /\b(first|second|third|fourth|fifth|last|\d+(?:st|nd|rd|th))\s+point\b/i,
      /\b(above|previous|earlier)\s+(?:answer|explanation|question)\b/i,
      /\b(?:i\s+)?meant\s+above\b/i,
      /\bmentioned\s+(?:above|earlier|in\s+the\s+above)\b/i,
      /\bin\s+the\s+above\s+answer\b/i,
      /\bmentioned\s+above\b/i,
      /\bas\s+per\s+(?:the\s+)?above\b/i,
    ];

    return referencePatterns.some((pattern) => pattern.test(query));
  }

  private isBareProximityQuery(query: string): boolean {
    const bareProximityPatterns = [
      /\b(?:i\s+)?meant\s+(?:above|that|this|previous|earlier)\b/i,
      /^\s*(?:i\s+meant\s+)?(?:above|that|this)\s+as\s+per\b/i,
      /\b(?:no,?\s+)?(?:above|that|this|previous|earlier)\s+as\s+per\b/i,
    ];

    return bareProximityPatterns.some((pattern) => pattern.test(query));
  }

  private citesAnchorTurn(reason: string | null | undefined): boolean {
    return /\bTurn\s+\d+\b/i.test(reason ?? '');
  }

  private validateBareAssentRewrite(
    llmResult: LlmRewriteResponse,
    rewrittenQuery: string,
  ): { valid: boolean; reason: string } {
    if (!this.citesAnchorTurn(llmResult.rewrite_reason)) {
      return {
        valid: false,
        reason: 'bare assent rewrite missing anchor turn citation',
      };
    }

    if (isBareAssentQuery(rewrittenQuery)) {
      return {
        valid: false,
        reason: 'bare assent rewrite still unresolved',
      };
    }

    if (llmResult.intent === 'accept_web_search_offer') {
      if (!isExplicitWebSearchQuery(rewrittenQuery)) {
        return {
          valid: false,
          reason:
            'bare assent rewrite must produce an explicit web search query',
        };
      }
      return { valid: true, reason: '' };
    }

    return { valid: true, reason: '' };
  }

  private noRewrite(originalQuery: string): QueryRewriteResult {
    return {
      originalQuery,
      rewrittenQuery: originalQuery,
      wasRewritten: false,
    };
  }
}
