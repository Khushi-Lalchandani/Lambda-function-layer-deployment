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
exports.WebSearchQueryOptimizerService = void 0;
const common_1 = require("@nestjs/common");
const llm_gateway_service_1 = require("./llm-gateway.service");
const request_observability_1 = require("./request-observability");
const web_search_tier_constants_1 = require("./web-search-tier.constants");
let WebSearchQueryOptimizerService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var WebSearchQueryOptimizerService = _classThis = class {
        constructor(promptTemplateService) {
            this.promptTemplateService = promptTemplateService;
            this.logger = new common_1.Logger(WebSearchQueryOptimizerService.name);
            this.llm = (0, llm_gateway_service_1.getLlmGateway)();
        }
        async optimizeWebSearchQuery(query) {
            const originalWebQuery = (query ?? '').trim();
            if (!originalWebQuery || originalWebQuery.length < 3) {
                return this.unchanged(originalWebQuery);
            }
            try {
                const prompt = this.promptTemplateService.renderTemplate('web-search-query-optimizer.txt', { query: originalWebQuery });
                const response = await this.llm.generateContent({
                    model: web_search_tier_constants_1.TIER_MODEL_SUFFICIENCY_PRIMARY,
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
                const optimizationApplied = parsed.optimization_applied === true &&
                    candidate.toLowerCase() !== originalWebQuery.toLowerCase();
                const result = {
                    originalWebQuery,
                    optimizedQuery: optimizationApplied ? candidate : originalWebQuery,
                    optimizationApplied,
                };
                (0, request_observability_1.logWebSearchQueryOptimization)({
                    originalWebQuery: result.originalWebQuery,
                    optimizedWebQuery: result.optimizedQuery,
                    optimizationApplied: result.optimizationApplied,
                });
                return result;
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.logger.warn(`[WebSearchQueryOptimizer] optimization failed (${message}); using original query`);
                return this.unchanged(originalWebQuery);
            }
        }
        unchanged(originalWebQuery) {
            return {
                originalWebQuery,
                optimizedQuery: originalWebQuery,
                optimizationApplied: false,
            };
        }
        parseOptimizerResponse(response) {
            const text = this.extractResponseText(response);
            if (!text) {
                return {};
            }
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return {};
            }
            try {
                return JSON.parse(jsonMatch[0]);
            }
            catch {
                return {};
            }
        }
        extractResponseText(response) {
            if (!response || typeof response !== 'object') {
                return '';
            }
            const res = response;
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
    };
    __setFunctionName(_classThis, "WebSearchQueryOptimizerService");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        WebSearchQueryOptimizerService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return WebSearchQueryOptimizerService = _classThis;
})();
exports.WebSearchQueryOptimizerService = WebSearchQueryOptimizerService;
//# sourceMappingURL=web-search-query-optimizer.service.js.map