import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import {
  PlannerAction,
  PlannerComparisonResult,
  PlannerResult,
  PlannerTool,
} from '../types/planner.interface';
import { ChatMessage } from '../types/chat.interface';
import { PromptTemplateService } from './prompt-template.service';
import { plannerConfig } from './planner-config';
import {
  comparePlannerWithExisting,
  mapPlannerActionsToStrategies,
} from './planner-strategy-mapper';
import { buildPlannerTools, isPlannerToolName } from './planner-tools';
import {
  buildNumberedTurnHistorySection,
  buildSummarySection,
} from './conversation-history.util';
import { isBareAssentQuery } from './bare-assent-query.util';
import { isPlatformStarterQuery } from './platform-starter-query.util';
import { isDocumentScopedSummaryQuery } from './summary-query.util';
import { logDebug } from './request-observability';

@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);
  private openaiClient: OpenAI | null = null;

  constructor(private readonly promptTemplateService: PromptTemplateService) {}

  async plan(
    originalQuery: string,
    subQuery: string,
    conversationHistory?: ChatMessage[],
    conversationSummary?: string | null,
  ): Promise<PlannerResult> {
    const trimmedSubQuery = (subQuery ?? '').trim();
    if (!trimmedSubQuery) {
      return this.emptyPlan(originalQuery, subQuery);
    }

    if (
      isPlatformStarterQuery(trimmedSubQuery) ||
      isPlatformStarterQuery(originalQuery)
    ) {
      return {
        originalQuery,
        subQuery: trimmedSubQuery,
        actions: [
          {
            tool: 'DOCUMENT_FIRST',
            query: trimmedSubQuery,
            reason: 'Platform-generated starter question',
          },
        ],
        confidence: 'high',
        reasoning: 'Forced DOCUMENT_FIRST for platform starter question',
      };
    }

    try {
      const response = await this.getOpenAI().chat.completions.create({
        model: plannerConfig.model,
        messages: this.buildMessages(
          trimmedSubQuery,
          conversationHistory,
          conversationSummary,
        ),
        tools: buildPlannerTools(),
        tool_choice: 'required',
        reasoning_effort: 'medium',
      });

      const actions = this.guardScopedSummaryMisroute(
        trimmedSubQuery,
        this.guardBareAssentMisroute(
          trimmedSubQuery,
          this.parseToolCalls(response, trimmedSubQuery),
          conversationHistory,
        ),
      );
      if (actions.length === 0) {
        return this.emptyPlan(originalQuery, trimmedSubQuery, 'low');
      }

      return {
        originalQuery,
        subQuery: trimmedSubQuery,
        actions,
        confidence: this.inferConfidence(actions),
        reasoning: this.extractReasoning(response),
      };
    } catch (error: any) {
      this.logger.warn(
        `[Planner] Planning failed for "${trimmedSubQuery}": ${error.message}`,
      );
      return this.emptyPlan(originalQuery, trimmedSubQuery, 'low');
    }
  }

  async planAll(
    originalQuery: string,
    subQueries: string[],
    conversationHistory?: ChatMessage[],
    conversationSummary?: string | null,
  ): Promise<PlannerResult[]> {
    const queries =
      subQueries.length > 0 ? subQueries : [originalQuery.trim()].filter(Boolean);

    return Promise.all(
      queries.map((subQuery) =>
        this.plan(
          originalQuery,
          subQuery,
          conversationHistory,
          conversationSummary,
        ),
      ),
    );
  }

  logPlannerResult(result: PlannerResult): void {
    const mappedStrategies = mapPlannerActionsToStrategies(result.actions);

    for (const action of result.actions) {
      logDebug('PLANNER_ACTION', {
        query: action.query,
        capability: action.tool,
        reason: action.reason ?? result.reasoning ?? 'not provided',
      });
    }

    logDebug('PLANNER_RESULT', {
      originalQuery: result.originalQuery,
      subQuery: result.subQuery,
      actions: result.actions.map((action) => action.tool),
      confidence: result.confidence,
      mappedStrategies,
    });
  }

  logPlannerComparison(comparison: PlannerComparisonResult): void {
    const primaryCapability = comparison.plannerActions[0] ?? 'none';
    logDebug('PLANNER_COMPARISON', {
      legacyStrategy: comparison.existingStrategy,
      plannerCapability: primaryCapability,
      matched: comparison.matched,
      comparison,
    });
  }

  buildComparison(
    query: string,
    existingStrategy: string,
    plannerResults: PlannerResult[],
  ): PlannerComparisonResult {
    const actions = plannerResults.flatMap((result) => result.actions);
    return comparePlannerWithExisting(query, existingStrategy, actions);
  }

  private getOpenAI(): OpenAI {
    if (!this.openaiClient) {
      const apiKey = process.env.OPENAI_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_KEY is required for planner service');
      }
      this.openaiClient = new OpenAI({ apiKey });
    }
    return this.openaiClient;
  }

  private buildMessages(
    query: string,
    conversationHistory?: ChatMessage[],
    conversationSummary?: string | null,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const systemPrompt = this.promptTemplateService.getTemplate(
      'planner-system.txt',
    );
    const summarySection = buildSummarySection(conversationSummary);
    const historySection = buildNumberedTurnHistorySection(
      conversationHistory ?? [],
    );

    const followUpNote =
      isBareAssentQuery(query) && (conversationHistory?.length ?? 0) > 0
        ? '\n\nNote: This is a bare affirmative follow-up. Resolve it from the immediately preceding assistant turn — do NOT select GREETING.'
        : '';

    return [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `User query: "${query}"${followUpNote}${summarySection ? `\n\n${summarySection}` : ''}${historySection ? `\n\n${historySection}` : ''}`,
      },
    ];
  }

  private guardBareAssentMisroute(
    query: string,
    actions: PlannerAction[],
    conversationHistory?: ChatMessage[],
  ): PlannerAction[] {
    if (!isBareAssentQuery(query) || !(conversationHistory?.length ?? 0)) {
      return actions;
    }

    const withoutGreeting = actions.filter((action) => action.tool !== 'GREETING');
    if (withoutGreeting.length > 0) {
      return withoutGreeting;
    }

    if (actions.length === 0) {
      return actions;
    }

    return [
      {
        tool: 'DOCUMENT_FIRST',
        query,
        reason:
          'Bare assent follow-up with conversation context; GREETING is not applicable',
      },
    ];
  }

  private guardScopedSummaryMisroute(
    query: string,
    actions: PlannerAction[],
  ): PlannerAction[] {
    const isSingleScopedSummary =
      actions.length === 1 && isDocumentScopedSummaryQuery(query);

    return actions.map((action) => {
      if (
        action.tool !== 'CASE_SUMMARY' ||
        (!isDocumentScopedSummaryQuery(action.query) && !isSingleScopedSummary)
      ) {
        return action;
      }

      return {
        ...action,
        tool: 'DOCUMENT_FIRST',
        reason:
          'Section- or clause-specific summary requires document retrieval, not whole-document summary',
      };
    });
  }

  private parseToolCalls(
    response: OpenAI.Chat.Completions.ChatCompletion,
    fallbackQuery: string,
  ): PlannerAction[] {
    const toolCalls = response.choices?.[0]?.message?.tool_calls ?? [];
    const actions: PlannerAction[] = [];

    for (const toolCall of toolCalls) {
      if (toolCall.type !== 'function') {
        continue;
      }

      const toolName = toolCall.function.name;
      if (!isPlannerToolName(toolName)) {
        continue;
      }

      const parsedArgs = this.parseToolArguments(
        toolCall.function.arguments,
        fallbackQuery,
      );
      actions.push({
        tool: toolName,
        query: parsedArgs.query,
        reason: parsedArgs.reason,
      });
    }

    return actions;
  }

  private parseToolArguments(
    rawArguments: string,
    fallbackQuery: string,
  ): { query: string; reason?: string } {
    try {
      const parsed = JSON.parse(rawArguments) as {
        query?: string;
        reason?: string;
      };

      return {
        query: parsed.query?.trim() || fallbackQuery,
        reason: parsed.reason?.trim(),
      };
    } catch {
      return { query: fallbackQuery };
    }
  }

  private inferConfidence(
    actions: PlannerAction[],
  ): 'high' | 'medium' | 'low' {
    if (actions.length === 0) {
      return 'low';
    }

    if (actions.length === 1) {
      return 'high';
    }

    return 'medium';
  }

  private extractReasoning(
    response: OpenAI.Chat.Completions.ChatCompletion,
  ): string | undefined {
    const content = response.choices?.[0]?.message?.content?.trim();
    return content || undefined;
  }

  private emptyPlan(
    originalQuery: string,
    subQuery: string,
    confidence: 'high' | 'medium' | 'low' = 'low',
  ): PlannerResult {
    return {
      originalQuery,
      subQuery,
      actions: [],
      confidence,
    };
  }
}
