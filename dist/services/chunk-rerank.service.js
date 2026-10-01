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
exports.ChunkRerankService = void 0;
const common_1 = require("@nestjs/common");
const llm_gateway_service_1 = require("./llm-gateway.service");
const llm_model_constants_1 = require("./llm-model.constants");
const retrieval_config_1 = require("./retrieval-config");
const retrieval_log_util_1 = require("./retrieval-log.util");
const web_search_model_tier_1 = require("./web-search-model-tier");
let ChunkRerankService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var ChunkRerankService = _classThis = class {
        constructor(promptTemplateService) {
            this.promptTemplateService = promptTemplateService;
            this.logger = new common_1.Logger(ChunkRerankService.name);
            this.llm = (0, llm_gateway_service_1.getLlmGateway)();
            this.model = llm_model_constants_1.GEMINI_3_1_FLASH_LITE;
        }
        /**
         * Reranks merged retrieval candidates with Gemini 3.1 Flash Lite.
         * Falls back to existing fusion order on API/parse errors.
         */
        async rerank(query, candidates, finalTopK, queryIntent = 'REASONING') {
            if (!candidates.length) {
                return [];
            }
            if (queryIntent === 'FACT_LOOKUP') {
                this.logger.log('[RERANK] Skipped LLM rerank for FACT_LOOKUP intent; using fusion ranking');
                return candidates.slice(0, finalTopK);
            }
            if (candidates.length <= finalTopK) {
                this.logger.log(`[RERANK] Skipped LLM rerank: only ${candidates.length} candidate(s), need > ${finalTopK}`);
                return candidates.slice(0, finalTopK);
            }
            const fusionBefore = candidates.slice(0, retrieval_config_1.retrievalConfig.llmRerankPoolMax);
            (0, retrieval_log_util_1.logRetrievalRankTable)(this.logger, 'LLM_RERANK_INPUT', query, fusionBefore.map((chunk) => ({
                id: chunk.id,
                documentId: chunk.documentId,
                denseScore: chunk.denseScore,
                bm25Score: chunk.bm25Score,
                rerankScore: chunk.rerankScore,
                content: chunk.content,
            })), { limit: 15 });
            const pool = fusionBefore;
            const candidatesText = pool
                .map((chunk, index) => {
                const excerpt = chunk.content.slice(0, 500).replace(/\s+/g, ' ');
                const fusion = chunk.rerankScore?.toFixed(3) ?? 'n/a';
                return `${index + 1}. id=${chunk.id} fusion=${fusion}\n${excerpt}`;
            })
                .join('\n\n');
            const prompt = this.promptTemplateService.renderTemplate('chunk-rerank.txt', {
                query,
                candidates: candidatesText,
                maxResults: String(finalTopK),
            });
            try {
                const response = await this.withRerankTimeout(this.llm.generateContent({
                    model: this.model,
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    config: {
                        temperature: 0,
                        topP: 0.95,
                        topK: 64,
                    },
                }), retrieval_config_1.retrievalConfig.llmRerankTimeoutMs);
                const orderedIds = this.parseOrderedChunkIds(response);
                if (retrieval_config_1.retrievalConfig.debugRetrievalLogs) {
                    this.logger.log(`[RERANK] Gemini ${this.model} raw order (${orderedIds.length} ids): ${orderedIds.map((id) => id.slice(0, 8)).join(', ')}`);
                }
                if (!orderedIds.length) {
                    if (retrieval_config_1.retrievalConfig.debugRetrievalLogs) {
                        this.logger.warn(`Rerank returned no valid chunk IDs; using fusion order (raw=${(0, web_search_model_tier_1.extractLlmText)(response).slice(0, 200) || 'empty'})`);
                    }
                    else {
                        this.logger.warn('Rerank returned no valid chunk IDs; using fusion order');
                    }
                    return candidates.slice(0, finalTopK);
                }
                const byId = new Map(pool.map((chunk) => [chunk.id, chunk]));
                const reranked = [];
                for (const id of orderedIds) {
                    const chunk = byId.get(id);
                    if (chunk) {
                        reranked.push(chunk);
                    }
                }
                for (const chunk of pool) {
                    if (!reranked.some((item) => item.id === chunk.id)) {
                        reranked.push(chunk);
                    }
                }
                const final = reranked.slice(0, finalTopK);
                (0, retrieval_log_util_1.logRerankOrderChange)(this.logger, fusionBefore, final);
                (0, retrieval_log_util_1.logRetrievalRankTable)(this.logger, 'LLM_RERANK_OUTPUT', query, final.map((chunk) => ({
                    id: chunk.id,
                    documentId: chunk.documentId,
                    denseScore: chunk.denseScore,
                    bm25Score: chunk.bm25Score,
                    rerankScore: chunk.rerankScore,
                    content: chunk.content,
                })));
                this.logger.log(`[RERANK] Gemini ${this.model} ${fusionBefore.length} candidates → top ${finalTopK} in ${final.length} selected`);
                return final;
            }
            catch (error) {
                this.logger.warn(`Gemini rerank failed (${error.message}); using fusion order`);
                return candidates.slice(0, finalTopK);
            }
        }
        withRerankTimeout(promise, timeoutMs) {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new Error(`Rerank timed out after ${timeoutMs}ms`));
                }, timeoutMs);
                promise.then((value) => {
                    clearTimeout(timer);
                    resolve(value);
                }, (error) => {
                    clearTimeout(timer);
                    reject(error);
                });
            });
        }
        parseOrderedChunkIds(response) {
            const text = (0, web_search_model_tier_1.extractLlmText)(response).replace(/```json|```/g, '').trim();
            if (!text) {
                return [];
            }
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                return [];
            }
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (!Array.isArray(parsed)) {
                    return [];
                }
                return parsed.filter((id) => typeof id === 'string');
            }
            catch {
                return [];
            }
        }
    };
    __setFunctionName(_classThis, "ChunkRerankService");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        ChunkRerankService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return ChunkRerankService = _classThis;
})();
exports.ChunkRerankService = ChunkRerankService;
//# sourceMappingURL=chunk-rerank.service.js.map