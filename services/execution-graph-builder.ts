import { QueryDecompositionResult } from '../types/chat.interface';
import { PlannerResult } from '../types/planner.interface';
import { ExecutionGraph, ExecutionNode } from '../types/execution.interface';

export class ExecutionGraphBuilder {
  build(
    plannerResults: PlannerResult[],
    decompositionResult?: QueryDecompositionResult,
  ): ExecutionGraph {
    const nodes: ExecutionNode[] = [];
    let idCounter = 1;

    for (const plannerResult of plannerResults) {
      for (const action of plannerResult.actions) {
        nodes.push({
          id: String(idCounter++),
          capability: action.tool,
          query: action.query,
          reason: action.reason,
          subQuery: plannerResult.subQuery,
          dependencies: [],
        });
      }
    }

    const originalQuery =
      plannerResults[0]?.originalQuery ??
      decompositionResult?.originalQuery ??
      '';

    return {
      originalQuery,
      nodes,
      decomposed: decompositionResult?.shouldDecompose ?? false,
    };
  }
}
