import { Injectable, Logger } from '@nestjs/common';
import { getLlmGateway } from './llm-gateway.service';
import { PromptTemplateService } from './prompt-template.service';
import { logWebSearchQueryOptimization } from './request-observability';
import { TIER_MODEL_SUFFICIENCY_PRIMARY } from './web-search-tier.constants';

export interface WebSearchQueryOptimizationResult {
  originalWebQuery: string;
  optimizedQuery: string;
  optimizationApplied: boolean;
}

interface LlmOptimizerResponse {
  optimized_query?: string;
  optimization_applied?: boolean;
}

@Injectable()
export class WebSearchQueryOptimizerService {
  private readonly logger = new Logger(WebSearchQueryOptimizerService.name);
  private readonly llm = getLlmGateway();

  constructor(private readonly promptTemplateService: PromptTemplateService) {}

  async optimizeWebSearchQuery(
    query: string,
  ): Promise<WebSearchQueryOptimizationResult> {
    const originalWebQuery = (query ?? '').trim();
    if (!originalWebQuery || originalWebQuery.length < 3) {
      return this.unchanged(originalWebQuery);
    }

    try {
      const prompt = this.promptTemplateService.renderTemplate(
        'web-search-query-optimizer.txt',
        { query: originalWebQuery },
      );

      const response = await this.llm.generateContent({
        model: TIER_MODEL_SUFFICIENCY_PRIMARY,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          temperature: 0.1,
          topP: 0.95,
        },
      });

      const parsed = this.parseOptimizerResponse(response);
      const candidate = (parsed.optimized_query ?? '').trim();
      if (!candidate) {
        return this.unchanged(originalWebQuery);
      }

      const optimizationApplied =
        parsed.optimization_applied === true &&
        candidate.toLowerCase() !== originalWebQuery.toLowerCase();

      const result: WebSearchQueryOptimizationResult = {
        originalWebQuery,
        optimizedQuery: optimizationApplied ? candidate : originalWebQuery,
        optimizationApplied,
      };

      logWebSearchQueryOptimization({
        originalWebQuery: result.originalWebQuery,
        optimizedWebQuery: result.optimizedQuery,
        optimizationApplied: result.optimizationApplied,
      });

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[WebSearchQueryOptimizer] optimization failed (${message}); using original query`,
      );
      return this.unchanged(originalWebQuery);
    }
  }

  private unchanged(originalWebQuery: string): WebSearchQueryOptimizationResult {
    return {
      originalWebQuery,
      optimizedQuery: originalWebQuery,
      optimizationApplied: false,
    };
  }

  private parseOptimizerResponse(response: unknown): LlmOptimizerResponse {
    const text = this.extractResponseText(response);
    if (!text) {
      return {};
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {};
    }

    try {
      return JSON.parse(jsonMatch[0]) as LlmOptimizerResponse;
    } catch {
      return {};
    }
  }

  private extractResponseText(response: unknown): string {
    if (!response || typeof response !== 'object') {
      return '';
    }

    const res = response as {
      text?: string | (() => string);
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    if (typeof res.text === 'function') {
      return String(res.text()).trim();
    }
    if (typeof res.text === 'string') {
      return res.text.trim();
    }

    const parts = res.candidates?.[0]?.content?.parts ?? [];
    return parts
      .map((part) => part.text ?? '')
      .join('')
      .trim();
  }
}
