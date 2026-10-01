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
exports.WebFirstExecutor = void 0;
const common_1 = require("@nestjs/common");
const retrieval_profile_1 = require("../retrieval-profile");
const web_first_probe_1 = require("../web-first-probe");
const request_observability_1 = require("../request-observability");
let WebFirstExecutor = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var WebFirstExecutor = _classThis = class {
        constructor(webSearchService, hybridRetrievalService, documentFirstExecutor) {
            this.webSearchService = webSearchService;
            this.hybridRetrievalService = hybridRetrievalService;
            this.documentFirstExecutor = documentFirstExecutor;
            this.name = 'WebFirstExecutor';
            this.logger = new common_1.Logger(WebFirstExecutor.name);
        }
        canHandle(capability) {
            return capability === 'WEB_FIRST';
        }
        async execute(node, context) {
            const documentChats = context.documentChats ?? context.metadata?.documentChats ?? [];
            const documentIds = documentChats.map((dc) => dc.documentId);
            const resolution = await (0, web_first_probe_1.resolveWebFirstStrategy)(node.query, documentIds, context.fileName, this.hybridRetrievalService);
            (0, request_observability_1.logDebug)('WEB_FIRST_PROBE', resolution.probe);
            if (resolution.action === 'redirect_document_first') {
                return this.documentFirstExecutor.execute(node, {
                    ...context,
                    hybridOrigin: 'probe_redirect',
                });
            }
            (0, retrieval_profile_1.logRetrievalSkipped)(this.logger, this.name, retrieval_profile_1.RETRIEVAL_SKIP_REASONS.WEB_SEARCH_ONLY);
            const answer = await this.webSearchService.searchWithGrounding(node.query, context.caseName ?? context.caseId, context.clientName ?? context.clientId, undefined, context.chatHistoryContext);
            const trace = {
                plannerDecision: node.capability,
                executor: this.name,
                finalStrategy: 'web_search',
            };
            this.logExecutionTrace(trace);
            return {
                answer,
                strategy: 'web_search',
                confidence: 0.75,
                trace,
            };
        }
        logExecutionTrace(trace) {
            (0, request_observability_1.logDebug)('EXECUTION_TRACE', trace);
        }
    };
    __setFunctionName(_classThis, "WebFirstExecutor");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        WebFirstExecutor = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return WebFirstExecutor = _classThis;
})();
exports.WebFirstExecutor = WebFirstExecutor;
//# sourceMappingURL=web.executor.js.map