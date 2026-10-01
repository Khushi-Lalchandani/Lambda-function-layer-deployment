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
exports.ConservativeResponseService = void 0;
const common_1 = require("@nestjs/common");
let ConservativeResponseService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var ConservativeResponseService = _classThis = class {
        constructor() {
            this.logger = new common_1.Logger(ConservativeResponseService.name);
        }
        getConservativeResponse(query, caseName, clientName, documentChats, chatHistory) {
            try {
                const fileCount = documentChats.length;
                if (fileCount === 0) {
                    return `I can answer legal and case-related questions only. General knowledge queries (e.g., "What is the capital of India?") are out of scope.

Currently, I don't have any documents uploaded for this case. Please:
1. Upload some legal documents, or
2. Ask a legal/case-specific question (e.g., parties, sections, payment terms)

Examples you can try:
- "What documents do I have for this case?"
- "Summarize the payment terms in the contract"
- "Who are the parties mentioned in the documents?"`;
                }
                const fileTypes = [
                    ...new Set(documentChats.map((dc) => dc.Document.documentMetaData[0]?.document_type ||
                        dc.Document.documentMetaData[0]?.document_category ||
                        'Unknown')),
                ];
                const fileNames = documentChats
                    .slice(0, 3)
                    .map((dc) => dc.Document.originalName);
                return `I can answer legal and case-related questions only. General knowledge queries (e.g., "What is the capital of India?") are out of scope.

Currently, you have ${fileCount} document(s) uploaded:
- Document types: ${fileTypes.join(', ')}
- Files: ${fileNames.join(', ')}${fileCount > 3 ? '...' : ''}

Please ask a legal/case-specific question. For example:
- "What are the payment terms in the contract?"
- "Who are the parties involved in this case?"
- "What court handled this matter?"
- "What are the main legal issues discussed?"
- "Summarize the key points from [specific document name]"

What specific legal information would you like to know about your case?`;
            }
            catch (error) {
                this.logger.error(`Error generating conservative response: ${error.message}`);
                return `I'd be happy to help you with your case "${caseName}", but I need more specific information about what you're looking for.

Please be more specific about what information you need. For example:
- "What documents do I have for this case?"
- "What are the payment terms in the contract?"
- "Who are the parties involved?"
- "What court handled this matter?"

What specific information would you like to know?`;
            }
        }
        isGreetingQuery(query) {
            const normalized = query
                .toLowerCase()
                .trim()
                .replace(/[!?.]+$/g, '')
                .trim();
            if (!normalized) {
                return false;
            }
            const exactPatterns = [
                /^(hello|hi|hey|howdy|greetings|salutations|good morning|good afternoon|good evening)$/i,
                /^(how are you|how do you do|what's up|whats up)$/i,
                /^(thanks|thank you|thx)$/i,
                /^(bye|goodbye|see you|farewell)$/i,
            ];
            if (exactPatterns.some((pattern) => pattern.test(normalized))) {
                return true;
            }
            const conversationalPatterns = [
                /^(hello|hi|hey|howdy|good morning|good afternoon|good evening)\b[\s,!.~-]*(how are you|how do you do|there|everyone)?\s*$/i,
                /^(how are you|how do you do)\b/i,
                /^(thanks|thank you)\b/i,
                /^(good\s+(morning|afternoon|evening))\b/i,
                /^(nice to meet you|pleased to meet you)\b/i,
            ];
            if (!conversationalPatterns.some((pattern) => pattern.test(normalized))) {
                return false;
            }
            // Pure social phrases only — not "hello, what are the payment terms?"
            const substantiveQuestionIndicators = /\b(case|section|document|appeal|court|notice|filing|contract|petition|payment|terms|summary|what|when|where|why)\b/i;
            const actionableHow = /\bhow (to|do|can|should|much|many|long|will|would)\b/i;
            return (!substantiveQuestionIndicators.test(normalized) &&
                !actionableHow.test(normalized));
        }
        getGreetingResponse(query, caseName, clientName, documentChats) {
            try {
                const fileCount = documentChats.length;
                const fileTypes = [
                    ...new Set(documentChats.map((dc) => dc.Document.documentMetaData[0]?.document_category || 'Unknown')),
                ];
                const fileNames = documentChats
                    .slice(0, 3)
                    .map((dc) => dc.Document.originalName);
                if (fileCount > 0) {
                    return `**Welcome to SimplCase**

I'm your legal document analysis assistant for case "${caseName}" (Client: ${clientName}).

**Available Documents:** ${fileCount} file(s)
• Types: ${fileTypes.slice(0, 3).join(', ')}${fileTypes.length > 3 ? '...' : ''}
• Files: ${fileNames.join(', ')}

**How I can help:**
• Analyze document content and extract key information
• Answer specific questions about your legal documents
• Provide summaries and insights from case materials
• Identify relevant legal sections and precedents

What would you like to know about your case?`;
                }
                else {
                    return `**Welcome to SimplCase**

I'm your legal document analysis assistant for case "${caseName}" (Client: ${clientName}).

**Current Status:** No documents uploaded yet

**To get started:**
1. Upload legal documents (contracts, court orders, judgments, etc.)
2. Ask me about document management features
3. Get help with legal case organization

**Once documents are uploaded, I can help with:**
• Document analysis and semantic search
• Legal information extraction and summarization
• Case management and organization
• Answering specific questions about your documents

How can I assist you today?`;
                }
            }
            catch (error) {
                this.logger.error(`Error generating greeting response: ${error.message}`);
                return `Hello! I'm here to help you with your legal case management system for case "${caseName}". How can I assist you today?`;
            }
        }
    };
    __setFunctionName(_classThis, "ConservativeResponseService");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        ConservativeResponseService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return ConservativeResponseService = _classThis;
})();
exports.ConservativeResponseService = ConservativeResponseService;
//# sourceMappingURL=conservative-response.service.js.map