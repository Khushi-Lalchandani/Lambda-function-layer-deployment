"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __setFunctionName = (this && this.__setFunctionName) || function (f, name, prefix) {
    if (typeof name === "symbol") name = name.description ? "[".concat(name.description, "]") : "";
    return Object.defineProperty(f, "name", { configurable: true, value: prefix ? "".concat(prefix, " ", name) : name });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentFirstExecutor = void 0;
const common_1 = require("@nestjs/common");
const document_scoped_query_util_1 = require("../document-scoped-query.util");
const explicit_web_search_query_util_1 = require("../explicit-web-search-query.util");
const retrieval_profile_1 = require("../retrieval-profile");
const retrieval_strength_1 = require("../retrieval-strength");
const platform_starter_query_util_1 = require("../platform-starter-query.util");
const request_observability_1 = require("../request-observability");
let DocumentFirstExecutor = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var DocumentFirstExecutor = _classThis = class {
        constructor(vectorSearchService, webSearchService, conservativeResponseService, metadataService) {
            this.vectorSearchService = vectorSearchService;
            this.webSearchService = webSearchService;
            this.conservativeResponseService = conservativeResponseService;
            this.metadataService = metadataService;
            this.name = 'DocumentFirstExecutor';
            this.logger = new common_1.Logger(DocumentFirstExecutor.name);
        }
        canHandle(capability) {
            return capability === 'DOCUMENT_FIRST';
        }
        async execute(node, context) {
            if (context.hybridOrigin) {
                (0, request_observability_1.logDebug)('DOCUMENT_FIRST_EXECUTOR', {
                    hybrid_origin: context.hybridOrigin,
                });
            }
            const documentChats = context.documentChats ?? context.metadata?.documentChats ?? [];
            const caseName = context.caseName ?? context.caseId ?? '';
            const clientName = context.clientName ?? context.clientId ?? '';
            if ((0, platform_starter_query_util_1.isClassifyAllDocumentsQuery)(node.query)) {
                (0, request_observability_1.logDebug)('DOCUMENT_FIRST_EXECUTOR', {
                    route: 'document_classification_metadata',
                    documentCount: documentChats.length,
                });
                const specificDocumentId = context.fileName
                    ? documentChats.find((dc) => dc.Document?.originalName === context.fileName)?.documentId
                    : undefined;
                const answer = await this.metadataService.getDocumentClassificationAnswer(documentChats, specificDocumentId, context.chatHistoryContext);
                const references = documentChats.map((dc) => ({
                    documentId: dc.documentId,
                    originalName: dc.Document?.originalName,
                    metadata: true,
                }));
                return this.withTrace({
                    answer,
                    strategy: 'metadata',
                    references,
                    confidence: 0.9,
                }, node.capability, 'YES', false, 'metadata', context.hybridOrigin);
            }
            const documentIds = documentChats.map((dc) => dc.documentId);
            let chunks = context.chunks ?? [];
            const retrievalProfile = await (0, retrieval_profile_1.resolveRetrievalProfile)(node.query);
            const retrievalOptions = {
                executor: this.name,
                profile: retrievalProfile,
            };
            if (chunks.length === 0 && documentIds.length > 0) {
                chunks = await this.vectorSearchService.retrieveRankedChunks(node.query, documentIds, context.fileName, retrievalOptions);
            }
            const { webSearchConfig } = await Promise.resolve().then(() => __importStar(require('../web-search-config')));
            const config = webSearchConfig;
            const isLegal = context.isLegal ??
                (await config.isLegalQuery(node.query).catch(() => false));
            const webSearchAllowed = context.webSearchEnabled &&
                config.enabled &&
                (!config.require_legal_domain || isLegal);
            let sufficiencyResult = context.precomputedSufficiency;
            if (!sufficiencyResult && chunks.length > 0) {
                sufficiencyResult = await this.webSearchService.checkSemanticSufficiency(chunks, node.query, { executor: this.name, capability: node.capability });
            }
            const semanticSufficiency = sufficiencyResult?.sufficiency;
            const isDocumentScoped = (0, document_scoped_query_util_1.isDocumentScopedQuery)(node.query);
            const explicitWebSearch = (0, explicit_web_search_query_util_1.isExplicitWebSearchQuery)(node.query);
            const acceptedWebSearchOffer = context.rewriteIntent === 'accept_web_search_offer';
            const retrievalMetrics = (0, retrieval_strength_1.classifyRetrievalStrength)(chunks);
            if (isDocumentScoped &&
                !explicitWebSearch &&
                !acceptedWebSearchOffer &&
                (semanticSufficiency === 'NO' || chunks.length === 0)) {
                const groundedResult = await this.webSearchService.generateDocumentGroundedInsufficiencyAnswer(node.query, chunks, {
                    reason: sufficiencyResult?.reason,
                }, documentChats, context.chatHistoryContext);
                return this.withTrace({
                    answer: groundedResult.answer,
                    strategy: 'vector',
                    confidence: 0.6,
                }, node.capability, semanticSufficiency ?? 'NO', isLegal, 'document_insufficient', context.hybridOrigin, sufficiencyResult?.missingInfo ?? '');
            }
            if (!webSearchAllowed) {
                if (retrievalMetrics.strength === 'STRONG' &&
                    semanticSufficiency === 'NO') {
                    const groundedResult = await this.webSearchService.generateDocumentGroundedInsufficiencyAnswer(node.query, chunks, {
                        reason: sufficiencyResult?.reason,
                        missingInfo: sufficiencyResult?.missingInfo,
                    }, documentChats, context.chatHistoryContext);
                    return this.withTrace({
                        answer: groundedResult.answer,
                        strategy: 'vector',
                        confidence: 0.6,
                    }, node.capability, semanticSufficiency ?? 'NO', isLegal, 'document_insufficient', context.hybridOrigin, sufficiencyResult?.missingInfo ?? '');
                }
                if (semanticSufficiency === 'NO' ||
                    chunks.length === 0 ||
                    retrievalMetrics.strength === 'NONE') {
                    const answer = this.conservativeResponseService.getConservativeResponse(node.query, caseName, clientName, documentChats, context.chatHistoryContext);
                    return this.withTrace({
                        answer,
                        strategy: 'conservative',
                        confidence: 0.5,
                    }, node.capability, semanticSufficiency, isLegal, 'conservative', context.hybridOrigin, sufficiencyResult?.missingInfo ?? '');
                }
                const vectorResult = await this.vectorSearchService.processVectorQuery(node.query, documentIds, documentChats, context.fileName, context.emitPartial ?? (() => { }), context.chatHistoryContext, { ...retrievalOptions, preloadedChunks: chunks });
                return this.withTrace({
                    answer: vectorResult.answer,
                    strategy: 'vector',
                    references: vectorResult.references,
                    confidence: vectorResult.confidence,
                }, node.capability, semanticSufficiency ?? 'YES', isLegal, 'vector', context.hybridOrigin, sufficiencyResult?.missingInfo ?? '');
            }
            const hybridResult = await this.webSearchService.generateHybridAnswer(node.query, chunks, context.caseId ?? '', context.clientId ?? '', caseName, clientName, context.chatHistoryContext, webSearchAllowed, documentChats, sufficiencyResult, {
                documentScoped: isDocumentScoped && !acceptedWebSearchOffer,
                skipContextualResolution: context.queryHistoryResolved === true,
            });
            let finalStrategy = 'vector';
            let strategy = 'vector';
            if (hybridResult.source_info === 'web_search_only') {
                strategy = 'web_search';
                finalStrategy = 'web_search';
            }
            else if (hybridResult.source_info === 'vector_search + web_search') {
                strategy = 'vector + web_search';
                finalStrategy = 'vector + web_search';
            }
            else if (hybridResult.source_info === 'document_insufficient') {
                finalStrategy = 'document_insufficient';
            }
            return this.withTrace({
                answer: hybridResult.answer,
                strategy,
                confidence: 0.8,
            }, node.capability, semanticSufficiency, isLegal, finalStrategy, context.hybridOrigin, sufficiencyResult?.missingInfo ?? '');
        }
        withTrace(result, plannerDecision, sufficiency, legalQuery, finalStrategy, hybridOrigin, missingInfo = '') {
            const trace = {
                plannerDecision,
                executor: this.name,
                sufficiency: sufficiency ?? 'UNSET',
                legalQuery,
                finalStrategy,
            };
            this.logExecutionTrace(trace, hybridOrigin);
            return { ...result, trace };
        }
        logExecutionTrace(trace, hybridOrigin) {
            (0, request_observability_1.logDebug)('EXECUTION_TRACE', {
                plannerDecision: trace.plannerDecision,
                executor: trace.executor,
                sufficiency: trace.sufficiency,
                legalQuery: trace.legalQuery,
                finalStrategy: trace.finalStrategy,
                hybridOrigin: hybridOrigin ?? null,
            });
        }
    };
    __setFunctionName(_classThis, "DocumentFirstExecutor");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        DocumentFirstExecutor = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return DocumentFirstExecutor = _classThis;
})();
exports.DocumentFirstExecutor = DocumentFirstExecutor;
//# sourceMappingURL=document.executor.js.map