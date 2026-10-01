import { Injectable, Logger } from '@nestjs/common';
import { QueryDecompositionResult } from '../types/chat.interface';
import { PlannerResult } from '../types/planner.interface';
import { ExecutionGraph, ExecutionShadowLog } from '../types/execution.interface';
import { ExecutionGraphBuilder } from './execution-graph-builder';
import { logDebug } from './request-observability';
import { ExecutorRegistry } from './executor-registry';

@Injectable()
export class ExecutionGraphService {
  private readonly logger = new Logger(ExecutionGraphService.name);

  constructor(
    private readonly graphBuilder: ExecutionGraphBuilder,
    private readonly executorRegistry: ExecutorRegistry,
  ) {}

  buildGraph(
    plannerResults: PlannerResult[],
    decompositionResult: QueryDecompositionResult,
  ): ExecutionGraph {
    return this.graphBuilder.build(plannerResults, decompositionResult);
  }

  buildShadowLog(
    query: string,
    plannerResults: PlannerResult[],
    decompositionResult: QueryDecompositionResult,
  ): ExecutionShadowLog {
    const graph = this.graphBuilder.build(
      plannerResults,
      decompositionResult,
    );

    const plannerActions = graph.nodes.map((node) => node.capability);
    const executorMapping = graph.nodes.map(
      (node) => this.executorRegistry.getExecutorName(node.capability) ?? 'Unknown',
    );

    return {
      query,
      planner_actions: plannerActions,
      execution_graph: graph.nodes.map((node) => ({
        capability: node.capability,
        query: node.query,
      })),
      executor_mapping: executorMapping,
    };
  }

  logShadowExecution(
    query: string,
    plannerResults: PlannerResult[],
    decompositionResult: QueryDecompositionResult,
  ): void {
    const shadowLog = this.buildShadowLog(
      query,
      plannerResults,
      decompositionResult,
    );

    logDebug('EXECUTION_GRAPH', shadowLog);
  }
}
