"use strict";
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __setFunctionName = (this && this.__setFunctionName) || function (f, name, prefix) {
    if (typeof name === "symbol") name = name.description ? "[".concat(name.description, "]") : "";
    return Object.defineProperty(f, "name", { configurable: true, value: prefix ? "".concat(prefix, " ", name) : name });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionOrchestratorService = void 0;
const common_1 = require("@nestjs/common");
const request_observability_1 = require("./request-observability");
let ExecutionOrchestratorService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var ExecutionOrchestratorService = _classThis = class {
        constructor(executorRegistry, aggregationService, answerRefinementService) {
            this.executorRegistry = executorRegistry;
            this.aggregationService = aggregationService;
            this.answerRefinementService = answerRefinementService;
            this.logger = new common_1.Logger(ExecutionOrchestratorService.name);
        }
        async executeGraph(graph, context) {
            const executorResults = [];
            const canRunNodesInParallel = graph.decomposed &&
                graph.nodes.length > 1 &&
                graph.nodes.every((node) => node.dependencies.length === 0);
            if (canRunNodesInParallel) {
                const parallelResults = await Promise.all(graph.nodes.map((node) => this.executeNode(node, context, true)));
                executorResults.push(...parallelResults.filter((result) => result != null));
            }
            else {
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
                ? await this.answerRefinementService.refineAnswerForDisplay(aggregated.answer, graph.originalQuery)
                : aggregated.answer;
            (0, request_observability_1.logDebug)('EXECUTION_ORCHESTRATOR', {
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
        async executeNode(node, context, isolated) {
            const executor = this.executorRegistry.getExecutor(node.capability);
            if (!executor) {
                this.logger.warn(`[ExecutionOrchestrator] No executor for capability ${node.capability}`);
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
        singleExecutorAggregate(results) {
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
        toExecutorResult(result, executorName, node) {
            return {
                executor: result.trace?.executor ?? executorName,
                strategy: result.strategy ?? result.trace?.finalStrategy ?? 'unknown',
                answer: result.answer,
                purpose: node?.subQuery ?? node?.query,
            };
        }
        logValidationTrace(trace) {
            (0, request_observability_1.logDebug)('EXECUTION_VALIDATION', {
                plannerCapability: trace.plannerDecision,
                executor: trace.executor,
                sufficiency: trace.sufficiency ?? 'UNSET',
                finalStrategy: trace.finalStrategy,
            });
        }
    };
    __setFunctionName(_classThis, "ExecutionOrchestratorService");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        ExecutionOrchestratorService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return ExecutionOrchestratorService = _classThis;
})();
exports.ExecutionOrchestratorService = ExecutionOrchestratorService;
//# sourceMappingURL=execution-orchestrator.service.js.map