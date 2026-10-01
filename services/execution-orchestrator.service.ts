import { Injectable, Logger } from '@nestjs/common';
import {
  AggregatedResponse,
  ExecutionContext,
  ExecutionGraph,
  ExecutionNode,
  ExecutionResult,
  ExecutionTrace,
  ExecutorResult,
  OrchestrationResult,
} from '../types/execution.interface';
import { AnswerRefinementService } from './answer-refinement.service';
import { AggregationService } from './aggregation.service';
import { ExecutorRegistry } from './executor-registry';
import { logDebug } from './request-observability';

@Injectable()
export class ExecutionOrchestratorService {
  private readonly logger = new Logger(ExecutionOrchestratorService.name);

  constructor(
    private readonly executorRegistry: ExecutorRegistry,
    private readonly aggregationService: AggregationService,
    private readonly answerRefinementService: AnswerRefinementService,
  ) {}

  async executeGraph(
    graph: ExecutionGraph,
    context: ExecutionContext,
  ): Promise<OrchestrationResult> {
    const executorResults: ExecutorResult[] = [];
    const canRunNodesInParallel =
      graph.decomposed &&
      graph.nodes.length > 1 &&
      graph.nodes.every((node) => node.dependencies.length === 0);

    if (canRunNodesInParallel) {
      const parallelResults = await Promise.all(
        graph.nodes.map((node) => this.executeNode(node, context, true)),
      );
      executorResults.push(
        ...parallelResults.filter(
          (result): result is ExecutorResult => result != null,
        ),
      );
    } else {
      for (const node of graph.nodes) {
        const result = await this.executeNode(node, context, false);
        if (result) {
          executorResults.push(result);
        }
      }
    }

    const aggregated = graph.decomposed
      ? this.aggregationService.aggregateDecomposedResults(executorResults)
      : this.singleExecutorAggregate(executorResults);

    const finalAnswer = aggregated.answer?.trim()
      ? await this.answerRefinementService.refineAnswerForDisplay(
          aggregated.answer,
          graph.originalQuery,
        )
      : aggregated.answer;

    logDebug('EXECUTION_ORCHESTRATOR', {
      nodes: graph.nodes.length,
      decomposed: graph.decomposed,
      parallelExecution: canRunNodesInParallel,
      executors: aggregated.executors.join(', ') || 'none',
      refined: Boolean(aggregated.answer?.trim()),
    });

    return {
      aggregated,
      finalAnswer,
    };
  }

  private async executeNode(
    node: ExecutionNode,
    context: ExecutionContext,
    isolated: boolean,
  ): Promise<ExecutorResult | null> {
    const executor = this.executorRegistry.getExecutor(node.capability);
    if (!executor) {
      this.logger.warn(
        `[ExecutionOrchestrator] No executor for capability ${node.capability}`,
      );
      return null;
    }

    const nodeContext = isolated
      ? {
          ...context,
          chunks: undefined,
          precomputedSufficiency: undefined,
        }
      : context;

    const result = await executor.execute(node, nodeContext);
    if (result.trace) {
      this.logValidationTrace(result.trace);
    }
    return this.toExecutorResult(result, executor.name, node);
  }

  private singleExecutorAggregate(
    results: ExecutorResult[],
  ): AggregatedResponse {
    const first = results.find((result) => result.answer?.trim());
    if (!first) {
      return {
        answer: '',
        strategies: [],
        executors: [],
        sections: [],
        segments: [],
        duplicatesRemoved: 0,
      };
    }

    return {
      answer: first.answer,
      strategies: [...new Set(results.map((result) => result.strategy))],
      executors: results.map((result) => result.executor),
      sections: [],
      segments: [],
      duplicatesRemoved: 0,
    };
  }

  private toExecutorResult(
    result: ExecutionResult,
    executorName: string,
    node?: { subQuery?: string; query: string },
  ): ExecutorResult {
    return {
      executor: result.trace?.executor ?? executorName,
      strategy: result.strategy ?? result.trace?.finalStrategy ?? 'unknown',
      answer: result.answer,
      purpose: node?.subQuery ?? node?.query,
    };
  }

  private logValidationTrace(trace: ExecutionTrace): void {
    logDebug('EXECUTION_VALIDATION', {
      plannerCapability: trace.plannerDecision,
      executor: trace.executor,
      sufficiency: trace.sufficiency ?? 'UNSET',
      finalStrategy: trace.finalStrategy,
    });
  }
}
