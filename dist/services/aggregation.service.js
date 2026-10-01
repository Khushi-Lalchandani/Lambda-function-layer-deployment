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
exports.AggregationService = void 0;
const common_1 = require("@nestjs/common");
const request_observability_1 = require("./request-observability");
// Decomposed aggregation packs sub-answers; final polish runs in ExecutionOrchestratorService.
const EXECUTOR_SECTION_TITLES = {
    TimelineExecutor: 'Case Timeline',
    SummaryExecutor: 'Case Summary',
    DocumentFirstExecutor: 'Document Findings',
    WebFirstExecutor: 'Legal Context',
};
const STRATEGY_PURPOSE_LABELS = {
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
];
let AggregationService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var AggregationService = _classThis = class {
        constructor() {
            this.logger = new common_1.Logger(AggregationService.name);
        }
        /** Pack sub-query executor results for the final answer-refinement pass. */
        aggregateDecomposedResults(results) {
            const validResults = results.filter((result) => result.answer?.trim().length > 0);
            if (validResults.length === 0) {
                return this.emptyResponse();
            }
            if (validResults.length === 1) {
                return this.singleResultResponse(validResults[0], validResults);
            }
            const greetingResult = validResults.find((result) => result.strategy === 'greeting');
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
            const response = {
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
        emptyResponse() {
            return {
                answer: '',
                strategies: [],
                executors: [],
                sections: [],
                segments: [],
                duplicatesRemoved: 0,
            };
        }
        singleResultResponse(result, logInput) {
            const response = {
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
        dropConservativeWhenBetterExists(results) {
            const nonConservative = results.filter((result) => result.strategy !== 'conservative');
            return nonConservative.length > 0 ? nonConservative : results;
        }
        buildSegments(results) {
            const orderedResults = [...results].sort((left, right) => {
                const leftIndex = EXECUTOR_DISPLAY_ORDER.indexOf(left.executor);
                const rightIndex = EXECUTOR_DISPLAY_ORDER.indexOf(right.executor);
                const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
                const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
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
        resolvePurpose(result) {
            if (result.purpose?.trim()) {
                return result.purpose.trim();
            }
            return (EXECUTOR_SECTION_TITLES[result.executor] ??
                STRATEGY_PURPOSE_LABELS[result.strategy] ??
                'Relevant information');
        }
        orderSegments(segments) {
            return [...segments].sort((left, right) => {
                const leftIsMetadata = left.strategy === 'metadata' ? 0 : 1;
                const rightIsMetadata = right.strategy === 'metadata' ? 0 : 1;
                return leftIsMetadata - rightIsMetadata;
            });
        }
        deduplicateSegments(segments) {
            const unique = [];
            for (const segment of segments) {
                const isDuplicate = unique.some((existing) => this.isDuplicateAnswer(existing.answer, segment.answer));
                if (!isDuplicate) {
                    unique.push(segment);
                }
            }
            return unique;
        }
        isDuplicateAnswer(left, right) {
            const normalizedLeft = this.normalizeForDedup(left);
            const normalizedRight = this.normalizeForDedup(right);
            if (!normalizedLeft || !normalizedRight) {
                return false;
            }
            if (normalizedLeft === normalizedRight) {
                return true;
            }
            const shorter = normalizedLeft.length <= normalizedRight.length
                ? normalizedLeft
                : normalizedRight;
            const longer = normalizedLeft.length > normalizedRight.length
                ? normalizedLeft
                : normalizedRight;
            return shorter.length >= 50 && longer.includes(shorter);
        }
        normalizeForDedup(text) {
            return text.toLowerCase().replace(/\s+/g, ' ').trim();
        }
        joinSegmentBodies(segments) {
            return segments
                .map((segment) => segment.answer)
                .filter(Boolean)
                .join('\n\n');
        }
        logAggregation(inputResults, response) {
            const resultLines = inputResults
                .map((result) => `${result.executor.padEnd(24)} → ${result.strategy}`)
                .join('\n');
            (0, request_observability_1.logDebug)('AGGREGATOR_DECOMPOSITION', {
                resultsReceived: inputResults.length,
                resultLines,
                segmentCount: response.segments?.length ?? 0,
                executors: response.executors,
                strategies: response.strategies,
            });
        }
    };
    __setFunctionName(_classThis, "AggregationService");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        AggregationService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return AggregationService = _classThis;
})();
exports.AggregationService = AggregationService;
//# sourceMappingURL=aggregation.service.js.map