"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionGraphBuilder = void 0;
class ExecutionGraphBuilder {
    build(plannerResults, decompositionResult) {
        const nodes = [];
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
        const originalQuery = plannerResults[0]?.originalQuery ??
            decompositionResult?.originalQuery ??
            '';
        return {
            originalQuery,
            nodes,
            decomposed: decompositionResult?.shouldDecompose ?? false,
        };
    }
}
exports.ExecutionGraphBuilder = ExecutionGraphBuilder;
//# sourceMappingURL=execution-graph-builder.js.map