import { Injectable, Logger } from '@nestjs/common';
import {
  AggregatedResponse,
  AggregationSegment,
  ExecutorResult,
} from '../types/execution.interface';
import { logDebug } from './request-observability';

// Decomposed aggregation packs sub-answers; final polish runs in ExecutionOrchestratorService.

const EXECUTOR_SECTION_TITLES: Record<string, string> = {
  TimelineExecutor: 'Case Timeline',
  SummaryExecutor: 'Case Summary',
  DocumentFirstExecutor: 'Document Findings',
  WebFirstExecutor: 'Legal Context',
};

const STRATEGY_PURPOSE_LABELS: Record<string, string> = {
  metadata: 'Case metadata',
  vector: 'Document findings',
  'vector + web_search': 'Document and legal research findings',
  web_search: 'Legal context',
  conservative: 'Scope guidance',
  greeting: 'Greeting',
};

const EXECUTOR_DISPLAY_ORDER = [
  'TimelineExecutor',
  'SummaryExecutor',
  'DocumentFirstExecutor',
  'WebFirstExecutor',
] as const;

@Injectable()
export class AggregationService {
  private readonly logger = new Logger(AggregationService.name);

  /** Pack sub-query executor results for the final answer-refinement pass. */
  aggregateDecomposedResults(results: ExecutorResult[]): AggregatedResponse {
    const validResults = results.filter(
      (result) => result.answer?.trim().length > 0,
    );

    if (validResults.length === 0) {
      return this.emptyResponse();
    }

    if (validResults.length === 1) {
      return this.singleResultResponse(validResults[0], validResults);
    }

    const greetingResult = validResults.find(
      (result) => result.strategy === 'greeting',
    );
    if (greetingResult) {
      return this.singleResultResponse(greetingResult, validResults);
    }

    const usefulResults = this.dropConservativeWhenBetterExists(validResults);
    if (usefulResults.length === 1) {
      return this.singleResultResponse(usefulResults[0], validResults);
    }

    const rawSegments = this.buildSegments(usefulResults);
    const segments = this.orderSegments(this.deduplicateSegments(rawSegments));
    const duplicatesRemoved = rawSegments.length - segments.length;

    const response: AggregatedResponse = {
      answer: this.joinSegmentBodies(segments),
      strategies: [...new Set(usefulResults.map((result) => result.strategy))],
      executors: usefulResults.map((result) => result.executor),
      sections: segments.map((segment) => segment.purpose),
      segments,
      duplicatesRemoved,
    };

    this.logAggregation(validResults, response);
    return response;
  }

  private emptyResponse(): AggregatedResponse {
    return {
      answer: '',
      strategies: [],
      executors: [],
      sections: [],
      segments: [],
      duplicatesRemoved: 0,
    };
  }

  private singleResultResponse(
    result: ExecutorResult,
    logInput: ExecutorResult[],
  ): AggregatedResponse {
    const response: AggregatedResponse = {
      answer: result.answer,
      strategies: [result.strategy],
      executors: [result.executor],
      sections: [],
      segments: [],
      duplicatesRemoved: 0,
    };
    this.logAggregation(logInput, response);
    return response;
  }

  private dropConservativeWhenBetterExists(
    results: ExecutorResult[],
  ): ExecutorResult[] {
    const nonConservative = results.filter(
      (result) => result.strategy !== 'conservative',
    );
    return nonConservative.length > 0 ? nonConservative : results;
  }

  private buildSegments(results: ExecutorResult[]): AggregationSegment[] {
    const orderedResults = [...results].sort((left, right) => {
      const leftIndex = EXECUTOR_DISPLAY_ORDER.indexOf(
        left.executor as (typeof EXECUTOR_DISPLAY_ORDER)[number],
      );
      const rightIndex = EXECUTOR_DISPLAY_ORDER.indexOf(
        right.executor as (typeof EXECUTOR_DISPLAY_ORDER)[number],
      );
      const normalizedLeft =
        leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
      const normalizedRight =
        rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
      return normalizedLeft - normalizedRight;
    });

    return orderedResults
      .filter((result) => result.answer?.trim())
      .map((result) => ({
        purpose: this.resolvePurpose(result),
        answer: result.answer.trim(),
        strategy: result.strategy,
      }));
  }

  private resolvePurpose(result: ExecutorResult): string {
    if (result.purpose?.trim()) {
      return result.purpose.trim();
    }

    return (
      EXECUTOR_SECTION_TITLES[result.executor] ??
      STRATEGY_PURPOSE_LABELS[result.strategy] ??
      'Relevant information'
    );
  }

  private orderSegments(
    segments: AggregationSegment[],
  ): AggregationSegment[] {
    return [...segments].sort((left, right) => {
      const leftIsMetadata = left.strategy === 'metadata' ? 0 : 1;
      const rightIsMetadata = right.strategy === 'metadata' ? 0 : 1;
      return leftIsMetadata - rightIsMetadata;
    });
  }

  private deduplicateSegments(
    segments: AggregationSegment[],
  ): AggregationSegment[] {
    const unique: AggregationSegment[] = [];

    for (const segment of segments) {
      const isDuplicate = unique.some((existing) =>
        this.isDuplicateAnswer(existing.answer, segment.answer),
      );
      if (!isDuplicate) {
        unique.push(segment);
      }
    }

    return unique;
  }

  private isDuplicateAnswer(left: string, right: string): boolean {
    const normalizedLeft = this.normalizeForDedup(left);
    const normalizedRight = this.normalizeForDedup(right);

    if (!normalizedLeft || !normalizedRight) {
      return false;
    }

    if (normalizedLeft === normalizedRight) {
      return true;
    }

    const shorter =
      normalizedLeft.length <= normalizedRight.length
        ? normalizedLeft
        : normalizedRight;
    const longer =
      normalizedLeft.length > normalizedRight.length
        ? normalizedLeft
        : normalizedRight;

    return shorter.length >= 50 && longer.includes(shorter);
  }

  private normalizeForDedup(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private joinSegmentBodies(segments: AggregationSegment[]): string {
    return segments
      .map((segment) => segment.answer)
      .filter(Boolean)
      .join('\n\n');
  }

  private logAggregation(
    inputResults: ExecutorResult[],
    response: AggregatedResponse,
  ): void {
    const resultLines = inputResults
      .map(
        (result) =>
          `${result.executor.padEnd(24)} → ${result.strategy}`,
      )
      .join('\n');

    logDebug('AGGREGATOR_DECOMPOSITION', {
      resultsReceived: inputResults.length,
      resultLines,
      segmentCount: response.segments?.length ?? 0,
      executors: response.executors,
      strategies: response.strategies,
    });
  }
}
