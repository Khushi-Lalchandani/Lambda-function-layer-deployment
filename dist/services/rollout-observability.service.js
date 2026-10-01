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
exports.RolloutObservabilityService = void 0;
const common_1 = require("@nestjs/common");
const request_observability_1 = require("./request-observability");
const PLANNER_CAPABILITIES = [
    'DOCUMENT_FIRST',
    'WEB_FIRST',
    'CASE_SUMMARY',
    'CASE_TIMELINE',
    'REFUSE',
    'none',
];
let RolloutObservabilityService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var RolloutObservabilityService = _classThis = class {
        constructor() {
            this.logger = new common_1.Logger(RolloutObservabilityService.name);
            this.plannerDistribution = new Map();
            this.totalRequests = 0;
        }
        recordPlannerDecision(payload) {
            this.incrementPlannerDistribution(payload.plannerCapability);
            (0, request_observability_1.logDebug)('ROLLOUT_PLANNER_DECISION', payload);
        }
        buildPlannerDecision(query, plannerResults) {
            const primaryAction = plannerResults.flatMap((result) => result.actions)[0];
            const primaryResult = plannerResults.find((result) => result.actions.length > 0) ??
                plannerResults[0];
            return {
                query,
                plannerCapability: primaryAction?.tool ?? 'none',
                confidence: primaryResult?.confidence ?? 'low',
            };
        }
        observeExecutionOutcome(query, plannerResults, executionGraphStrategy, executor) {
            const plannerDecision = this.buildPlannerDecision(query, plannerResults);
            this.recordPlannerDecision(plannerDecision);
            const activePipeline = {
                pipeline: 'execution_graph',
                plannerCapability: plannerDecision.plannerCapability,
                executor,
                finalStrategy: executionGraphStrategy,
            };
            (0, request_observability_1.logDebug)('ROLLOUT_ACTIVE_PIPELINE', activePipeline);
            this.totalRequests += 1;
            (0, request_observability_1.logDebug)('ROLLOUT_METRICS_SUMMARY', this.getMetricsSnapshot());
        }
        getMetricsSnapshot() {
            const plannerDistribution = Object.fromEntries(PLANNER_CAPABILITIES.map((capability) => [
                capability,
                this.plannerDistribution.get(capability) ?? 0,
            ]));
            return {
                plannerDistribution,
                totalRequests: this.totalRequests,
            };
        }
        incrementPlannerDistribution(capability) {
            this.plannerDistribution.set(capability, (this.plannerDistribution.get(capability) ?? 0) + 1);
        }
    };
    __setFunctionName(_classThis, "RolloutObservabilityService");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        RolloutObservabilityService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return RolloutObservabilityService = _classThis;
})();
exports.RolloutObservabilityService = RolloutObservabilityService;
//# sourceMappingURL=rollout-observability.service.js.map