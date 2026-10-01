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
exports.QueryDecompositionService = void 0;
const common_1 = require("@nestjs/common");
const request_observability_1 = require("./request-observability");
const llm_gateway_service_1 = require("./llm-gateway.service");
const llm_model_constants_1 = require("./llm-model.constants");
const conversation_history_util_1 = require("./conversation-history.util");
let QueryDecompositionService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var QueryDecompositionService = _classThis = class {
        constructor(promptTemplateService) {
            this.promptTemplateService = promptTemplateService;
            this.logger = new common_1.Logger(QueryDecompositionService.name);
            this.llm = (0, llm_gateway_service_1.getLlmGateway)();
        }
        async decompose(query, conversationHistory, caseContext) {
            const originalQuery = (query ?? '').trim();
            if (!originalQuery) {
                return this.noDecomposition(originalQuery);
            }
            if (!this.mightNeedDecomposition(originalQuery)) {
                return this.noDecomposition(originalQuery);
            }
            try {
                const llmResult = await this.decomposeWithLlm(originalQuery, conversationHistory, caseContext);
                return this.toDecompositionResult(originalQuery, llmResult);
            }
            catch (error) {
                this.logger.warn(`[QueryDecomposition] LLM decomposition failed, falling back: ${error.message}`);
                return this.noDecomposition(originalQuery);
            }
        }
        logDecompositionResult(result) {
            (0, request_observability_1.logQueryDecomposition)({
                originalQuery: result.originalQuery,
                shouldDecompose: result.shouldDecompose,
                subQueries: result.subQueries,
                reason: result.decompositionReason ?? 'none',
            });
        }
        mightNeedDecomposition(query) {
            const normalized = query.toLowerCase();
            const multiTaskPatterns = [
                /\band\b.+\b(explain|summari[sz]e|list|show|tell|describe|compare|what|whether|have)\b/i,
                /\b(explain|summari[sz]e|list|show|tell|describe|compare)\b.+\band\b/i,
                /\balso\b/i,
                /\bas well as\b/i,
            ];
            return multiTaskPatterns.some((pattern) => pattern.test(normalized));
        }
        async decomposeWithLlm(query, conversationHistory, caseContext) {
            const summarySection = (0, conversation_history_util_1.buildSummarySection)(caseContext?.conversationSummary);
            const historySection = (0, conversation_history_util_1.buildRecentConversationSection)(conversationHistory ?? []);
            const caseContextSection = caseContext
                ? [
                    caseContext.caseName ? `Case: ${caseContext.caseName}` : '',
                    caseContext.clientName ? `Client: ${caseContext.clientName}` : '',
                ]
                    .filter(Boolean)
                    .join('\n')
                : '';
            const prompt = this.promptTemplateService.renderTemplate('query-decomposition.txt', {
                query,
                historySection,
                summarySection,
                caseContextSection,
            });
            const response = await this.llm.generateContent({
                model: llm_model_constants_1.GEMINI_3_1_FLASH_LITE,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: {
                    temperature: 0,
                    topP: 0.95,
                    topK: 40,
                },
            });
            const responseText = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
            return this.parseLlmResponse(responseText);
        }
        toDecompositionResult(originalQuery, llmResult) {
            if (!llmResult.should_decompose) {
                return {
                    originalQuery,
                    shouldDecompose: false,
                    subQueries: [],
                    decompositionReason: llmResult.decomposition_reason?.trim() || 'single_intent',
                };
            }
            const subQueries = (llmResult.sub_queries ?? [])
                .map((subQuery) => subQuery.trim())
                .filter(Boolean);
            if (subQueries.length < 2) {
                return this.noDecomposition(originalQuery);
            }
            return {
                originalQuery,
                shouldDecompose: true,
                subQueries,
                decompositionReason: llmResult.decomposition_reason?.trim() ||
                    'multiple_independent_tasks',
            };
        }
        parseLlmResponse(responseText) {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return { should_decompose: false, sub_queries: [] };
            }
            try {
                return JSON.parse(jsonMatch[0]);
            }
            catch {
                return { should_decompose: false, sub_queries: [] };
            }
        }
        noDecomposition(originalQuery) {
            return {
                originalQuery,
                shouldDecompose: false,
                subQueries: [],
                decompositionReason: 'single_intent',
            };
        }
    };
    __setFunctionName(_classThis, "QueryDecompositionService");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        QueryDecompositionService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return QueryDecompositionService = _classThis;
})();
exports.QueryDecompositionService = QueryDecompositionService;
//# sourceMappingURL=query-decomposition.service.js.map