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
exports.HybridRetrievalService = void 0;
const common_1 = require("@nestjs/common");
const openai_1 = require("openai");
const bm25_1 = require("./bm25");
const retrieval_config_1 = require("./retrieval-config");
const retrieval_profile_1 = require("./retrieval-profile");
const request_observability_1 = require("./request-observability");
let HybridRetrievalService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var HybridRetrievalService = _classThis = class {
        constructor(backendService, chunkRerankService) {
            this.backendService = backendService;
            this.chunkRerankService = chunkRerankService;
            this.logger = new common_1.Logger(HybridRetrievalService.name);
            this.openai = new openai_1.OpenAI({
                apiKey: process.env.OPENAI_KEY,
            });
        }
        /**
         * Dense + BM25 → merge → dedupe → fusion score → Gemini 2.5 Flash rerank → top K.
         */
        async retrieveRankedChunks(query, documentIds, fileName, options) {
            const profileParams = await (0, retrieval_profile_1.resolveRetrievalParameters)(query, options);
            const { queryIntent, poolSize, finalTopK, denseCandidateK, bm25CandidateK, } = profileParams;
            const isFactLookup = queryIntent === 'FACT_LOOKUP';
            const startTime = Date.now();
            (0, retrieval_profile_1.logRetrievalProfile)(this.logger, options?.executor, profileParams);
            (0, request_observability_1.logDebug)('RETRIEVAL_CLASSIFIER_ROUTING', {
                intent: queryIntent,
                isFactLookup,
                embeddingModel: retrieval_config_1.retrievalConfig.embeddingModel,
                embeddingDimensions: retrieval_config_1.retrievalConfig.embeddingDimensions,
                poolSize,
                finalTopK,
                denseCandidateK,
                bm25CandidateK,
            });
            if (!documentIds.length) {
                return [];
            }
            const denseStart = Date.now();
            const queryEmbedding = await this.getQueryEmbedding(query);
            const densePool = await this.fetchChunksByEmbedding(queryEmbedding, documentIds, poolSize, fileName);
            const corpus = densePool;
            if (!corpus.length) {
                this.logger.warn(`[RETRIEVAL] Dense search returned zero chunks (poolSize=${poolSize})`);
                (0, request_observability_1.logRetrievalSummary)({
                    intent: queryIntent,
                    chunkCount: 0,
                    topSimilarity: 0,
                    retrievalMs: Date.now() - startTime,
                    profile: profileParams.profile,
                });
                return [];
            }
            const denseTop = [...densePool]
                .sort((a, b) => this.normalizeDenseScore(b.similarity) -
                this.normalizeDenseScore(a.similarity))
                .slice(0, denseCandidateK);
            const denseMs = Date.now() - denseStart;
            const bm25Start = Date.now();
            const bm25Ranked = (0, bm25_1.rankByBm25)(query, corpus.map((chunk) => ({ id: chunk.id, content: chunk.content })), bm25CandidateK);
            const bm25TopIds = new Set(bm25Ranked.map((item) => item.id));
            const bm25Top = corpus.filter((chunk) => bm25TopIds.has(chunk.id));
            const bm25Ms = Date.now() - bm25Start;
            const mergeStart = Date.now();
            const mergedById = new Map();
            const upsertChunk = (chunk, denseScore, bm25Score) => {
                const existing = mergedById.get(chunk.id);
                if (!existing) {
                    mergedById.set(chunk.id, { ...chunk, denseScore, bm25Score });
                    return;
                }
                mergedById.set(chunk.id, {
                    ...existing,
                    denseScore: Math.max(existing.denseScore, denseScore),
                    bm25Score: Math.max(existing.bm25Score, bm25Score),
                    similarity: chunk.similarity ?? existing.similarity,
                });
            };
            for (const chunk of denseTop) {
                upsertChunk(chunk, this.normalizeDenseScore(chunk.similarity), 0);
            }
            const bm25Scores = (0, bm25_1.scoreBm25)(query, corpus.map((chunk) => chunk.content));
            const bm25ScoreById = new Map(corpus.map((chunk, index) => [chunk.id, bm25Scores[index] ?? 0]));
            const maxBm25 = Math.max(...bm25Scores, 1e-6);
            for (const chunk of bm25Top) {
                const rawBm25 = bm25ScoreById.get(chunk.id) ?? 0;
                upsertChunk(chunk, this.normalizeDenseScore(chunk.similarity), rawBm25 / maxBm25);
            }
            const fusionRanked = Array.from(mergedById.values())
                .map((chunk) => ({
                ...chunk,
                rerankScore: retrieval_config_1.retrievalConfig.denseWeight * chunk.denseScore +
                    retrieval_config_1.retrievalConfig.bm25Weight * chunk.bm25Score,
            }))
                .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));
            const mergeMs = Date.now() - mergeStart;
            const isRerankEnabledForQuery = retrieval_config_1.retrievalConfig.useLlmRerank && !isFactLookup;
            const rerankStart = Date.now();
            const reranked = isRerankEnabledForQuery
                ? await this.chunkRerankService.rerank(query, fusionRanked, finalTopK, queryIntent)
                : fusionRanked.slice(0, finalTopK);
            const rerankMs = Date.now() - rerankStart;
            const latencyMs = Date.now() - startTime;
            const topSimilarity = this.normalizeDenseScore(reranked[0]?.similarity);
            (0, request_observability_1.logRetrievalSummary)({
                intent: queryIntent,
                chunkCount: reranked.length,
                topSimilarity,
                retrievalMs: latencyMs,
                profile: profileParams.profile,
            });
            (0, request_observability_1.logDebug)('RETRIEVAL_RESULT', {
                chunks_total_pool: corpus.length,
                chunks_merged: mergedById.size,
                chunks_final: reranked.length,
                rerank: isRerankEnabledForQuery,
                denseMs,
                bm25Ms,
                mergeMs,
                rerankMs,
                latencyMs,
            });
            return reranked.map((chunk) => ({
                id: chunk.id,
                content: chunk.content,
                documentId: chunk.documentId,
                similarity: chunk.similarity,
                bm25Score: chunk.bm25Score,
                rerankScore: chunk.rerankScore,
            }));
        }
        async getQueryEmbedding(query) {
            const embedResp = await this.openai.embeddings.create({
                model: retrieval_config_1.retrievalConfig.embeddingModel,
                input: query,
                dimensions: retrieval_config_1.retrievalConfig.embeddingDimensions,
            });
            return embedResp.data[0]?.embedding ?? [];
        }
        async fetchChunksByEmbedding(queryEmbedding, documentIds, topK, fileName) {
            const response = await this.backendService.getSimilarChunks({
                queryEmbedding,
                documentIds,
                topK,
                fileName,
            });
            if (!response.success || !response.data) {
                return [];
            }
            return this.mapRawChunks(response.data);
        }
        mapRawChunks(chunks) {
            return (chunks ?? []).map((chunk) => ({
                id: chunk.id,
                content: chunk.content,
                documentId: chunk.documentId,
                similarity: chunk.similarity,
            }));
        }
        normalizeDenseScore(distance) {
            const value = distance ?? 1;
            return Math.max(0, Math.min(1, 1 - Math.min(value / 2, 1)));
        }
    };
    __setFunctionName(_classThis, "HybridRetrievalService");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        HybridRetrievalService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return HybridRetrievalService = _classThis;
})();
exports.HybridRetrievalService = HybridRetrievalService;
//# sourceMappingURL=hybrid-retrieval.service.js.map