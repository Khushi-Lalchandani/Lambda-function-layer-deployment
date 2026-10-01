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
exports.VectorSearchService = void 0;
const common_1 = require("@nestjs/common");
const llm_gateway_service_1 = require("./llm-gateway.service");
const web_search_model_tier_1 = require("./web-search-model-tier");
const retrieval_strength_1 = require("./retrieval-strength");
let VectorSearchService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var VectorSearchService = _classThis = class {
        constructor(backendService, hybridRetrievalService, promptBuilderService, answerRefinementService) {
            this.backendService = backendService;
            this.hybridRetrievalService = hybridRetrievalService;
            this.promptBuilderService = promptBuilderService;
            this.answerRefinementService = answerRefinementService;
            this.logger = new common_1.Logger(VectorSearchService.name);
            this.llm = (0, llm_gateway_service_1.getLlmGateway)();
        }
        async retrieveRankedChunks(query, documentIds, fileName, options) {
            try {
                return await this.hybridRetrievalService.retrieveRankedChunks(query, documentIds, fileName, options);
            }
            catch (error) {
                this.logger.error(`Hybrid retrieval failed, falling back to dense-only: ${error.message}`);
                const finalTopK = options?.finalTopK ?? 6;
                return this.getSimilarChunks(query, documentIds, finalTopK, fileName);
            }
        }
        async getSimilarChunks(query, documentIds, topK = 15, fileName) {
            try {
                const queryEmbedding = await this.hybridRetrievalService.getQueryEmbedding(query);
                const chunks = await this.hybridRetrievalService.fetchChunksByEmbedding(queryEmbedding, documentIds, topK, fileName);
                if (chunks.length > 0) {
                    return chunks;
                }
                return await this.getFallbackChunks(documentIds, topK, fileName);
            }
            catch (error) {
                this.logger.error(`Error in similarity search: ${error.message}`);
                return await this.getFallbackChunks(documentIds, topK, fileName);
            }
        }
        async getFallbackChunks(documentIds, topK = 15, fileName) {
            try {
                // For fallback, try to get chunks via REST API with empty embedding
                // This will return recent chunks as fallback
                const response = await this.backendService.getSimilarChunks({
                    queryEmbedding: [], // Empty embedding for fallback
                    documentIds,
                    topK,
                    fileName,
                });
                if (response.success && response.data && response.data.length > 0) {
                    return response.data.map((chunk) => ({
                        id: chunk.id,
                        content: chunk.content,
                        documentId: chunk.documentId,
                        similarity: chunk.similarity || 0.5,
                    }));
                }
                return [];
            }
            catch (error) {
                this.logger.error(`Fallback chunk retrieval failed: ${error.message}`);
                return [];
            }
        }
        async searchForExactMatch(query, documentIds, fileName) {
            const keywordMatch = query.match(/"([^"]+)"/);
            if (!keywordMatch)
                return null;
            const keyword = keywordMatch[1].toLowerCase();
            try {
                // Use vector search with keyword as query to find exact matches
                // The vector search will find chunks containing the keyword
                const chunks = await this.getSimilarChunks(keyword, documentIds, 5, // Only need a few results
                fileName);
                // Check if any chunk contains the keyword
                const matchingChunks = chunks.filter((chunk) => chunk.content.toLowerCase().includes(keyword));
                if (matchingChunks.length > 0) {
                    // Get document name from chat data (would need to be passed in)
                    // For now, return generic message
                    return `The word "${keyword.toUpperCase()}" is mentioned in the documents.`;
                }
                return null;
            }
            catch (error) {
                this.logger.error(`Error in exact match search: ${error.message}`);
                return null;
            }
        }
        async processVectorQuery(question, documentIds, documentChats, fileName, emitPartial, chatHistory, options) {
            const vectorStartTime = Date.now();
            try {
                const chunks = options?.preloadedChunks ??
                    (await this.retrieveRankedChunks(question, documentIds, fileName, options));
                let confidence;
                if (!chunks.length) {
                    const fallbackAnswer = `No relevant content found in ${fileName || 'the documents'}.`;
                    const exactMatch = await this.searchForExactMatch(question, documentIds, fileName);
                    if (exactMatch) {
                        confidence = 0.9;
                        const relevantChats = documentChats.filter((dc) => !fileName || dc.Document.originalName === fileName);
                        const references = relevantChats.map((dc) => ({
                            documentId: dc.documentId,
                            originalName: dc.Document.originalName,
                            relevance: 1.0,
                        }));
                        // Return raw answer - refinement will be done at the end of the pipeline
                        return {
                            answer: exactMatch,
                            references,
                            confidence,
                        };
                    }
                    throw new Error(fallbackAnswer);
                }
                const avgDistance = chunks.reduce((sum, c) => sum + (c.similarity || 0), 0) / chunks.length;
                confidence = 1 - avgDistance;
                const keywordMatch = question.match(/"([^"]+)"/);
                if (keywordMatch) {
                    const keyword = keywordMatch[1].toLowerCase();
                    if (chunks.some((chunk) => chunk.content.toLowerCase().includes(keyword))) {
                        confidence = 1.0;
                        const relevantChunks = chunks.filter((chunk) => chunk.content.toLowerCase().includes(keyword));
                        const docNames = [
                            ...new Set(relevantChunks.map((chunk) => documentChats.find((dc) => dc.documentId === chunk.documentId)?.Document.originalName)),
                        ].join(', ');
                        const references = relevantChunks.map((chunk) => ({
                            documentId: chunk.documentId,
                            originalName: documentChats.find((dc) => dc.documentId === chunk.documentId)?.Document.originalName,
                            chunkId: chunk.id,
                            relevance: 1.0,
                        }));
                        const keywordAnswer = `The word "${keyword.toUpperCase()}" is mentioned in ${docNames}.`;
                        // Return raw answer - refinement will be done at the end of the pipeline
                        return {
                            answer: keywordAnswer,
                            references,
                            confidence,
                        };
                    }
                }
                const prompt = await this.promptBuilderService.buildPrompt(question, chunks, documentChats, chatHistory, undefined, // caseId - not available in this context
                undefined, // clientId - not available in this context
                {
                    allowGeneralKnowledge: (0, retrieval_strength_1.isGeneralKnowledgeScenarioAllowed)(chunks),
                });
                const rawAnswer = await this.generateVectorResponse(prompt, emitPartial, question);
                // Return raw answer - refinement will be done at the end of the pipeline
                const answer = rawAnswer;
                const references = chunks.map((chunk) => ({
                    documentId: chunk.documentId,
                    originalName: documentChats.find((dc) => dc.documentId === chunk.documentId)?.Document.originalName,
                    chunkId: chunk.id,
                    relevance: chunk.similarity
                        ? Math.round((1 - chunk.similarity) * 100) / 100
                        : 0.5,
                }));
                this.logger.log(`[PROCESS] processVectorQuery completed in ${Date.now() - vectorStartTime}ms with query="${question}"`);
                return { answer, references, confidence };
            }
            catch (error) {
                this.logger.error(`Vector query processing failed: ${error.message}`);
                if (fileName) {
                    return this.processVectorQuery(question, documentIds, documentChats, undefined, emitPartial, chatHistory, options);
                }
                throw new Error(`Vector search failed: ${error.message}`);
            }
        }
        async generateVectorResponse(prompt, emitPartial, question) {
            let retryCount = 0;
            const maxRetries = 2;
            while (retryCount <= maxRetries) {
                try {
                    const tierResult = await (0, web_search_model_tier_1.invokeLegalAnswerGenerationTier)({
                        contents: [{ role: 'user', parts: [{ text: prompt }] }],
                        config: {
                            systemInstruction: 'Answer from the provided document chunks only. Be strictly factual and comprehensive. ' +
                                'When events have dates, preserve chronological order. Do not invent facts beyond the sources.',
                            topP: 0.95,
                            topK: 64,
                        },
                    }, this.llm);
                    const answer = (0, web_search_model_tier_1.extractLlmText)(tierResult.response)?.trim() ?? '';
                    if (!answer) {
                        throw new Error('Empty response from legal answer generation tier');
                    }
                    return answer;
                }
                catch (error) {
                    this.logger.error(`Attempt ${retryCount + 1} failed: ${error.message}`);
                    retryCount++;
                    if (retryCount > maxRetries) {
                        const errorMessage = `Failed to generate content after ${maxRetries} retries: ${error.message}`;
                        this.logger.error(errorMessage);
                        emitPartial({
                            answer: `Unable to generate a response due to repeated API failures. Please try again later.`,
                            isPartial: false,
                        });
                        throw new Error(errorMessage);
                    }
                    await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
                }
            }
            return '';
        }
        deduplicateAnswer(answer) {
            // Split by sentence endings, but preserve citations that might be on separate lines
            // First, temporarily replace citations with placeholders to protect them during deduplication
            const citationPlaceholders = [];
            let processedAnswer = answer;
            const citationRegex = /\[Source:\s*[^\]]+\]/g;
            let match;
            let placeholderIndex = 0;
            // Replace citations with placeholders
            while ((match = citationRegex.exec(answer)) !== null) {
                const placeholder = `__CITATION_PLACEHOLDER_${placeholderIndex}__`;
                citationPlaceholders.push(match[0]);
                processedAnswer = processedAnswer.replace(match[0], placeholder);
                placeholderIndex++;
            }
            // Now deduplicate sentences
            const sentences = processedAnswer.split(/(?<=[।.!])\s+/).filter((s) => s.trim());
            const seen = new Set();
            const deduplicated = sentences.filter((sentence) => {
                const normalized = sentence.replace(/\s+/g, ' ').trim();
                if (!seen.has(normalized)) {
                    seen.add(normalized);
                    return true;
                }
                return false;
            });
            // Join and restore citations
            let result = deduplicated.join(' ').replace(/([।])\s*/g, '$1 ');
            // Restore citations from placeholders
            citationPlaceholders.forEach((citation, index) => {
                result = result.replace(`__CITATION_PLACEHOLDER_${index}__`, citation);
            });
            return result;
        }
        safeExtractTextFromResponse(response) {
            try {
                if (typeof response.text === 'function') {
                    return response.text().trim();
                }
                if (Array.isArray(response)) {
                    const textParts = [];
                    for (const item of response) {
                        if (typeof item === 'string') {
                            textParts.push(item);
                        }
                        else if (item && typeof item.text === 'function') {
                            textParts.push(item.text());
                        }
                        else if (item && typeof item.text === 'string') {
                            textParts.push(item.text);
                        }
                        else if (item && typeof item === 'object' && 'text' in item) {
                            textParts.push(item.text);
                        }
                        else if (item && typeof item === 'object' && 'content' in item) {
                            textParts.push(item.content);
                        }
                        else if (item && typeof item === 'object' && 'parts' in item) {
                            // Handle Gemini response format with parts
                            const parts = item.parts;
                            for (const part of parts) {
                                if (typeof part === 'string') {
                                    textParts.push(part);
                                }
                                else if (part && typeof part === 'object' && 'text' in part) {
                                    textParts.push(part.text);
                                }
                            }
                        }
                        else {
                            textParts.push(String(item));
                        }
                    }
                    return textParts.join(' ').trim();
                }
                if (response && typeof response === 'object') {
                    // Try to extract text from common response formats
                    if ('text' in response && typeof response.text === 'string') {
                        return response.text.trim();
                    }
                    if ('content' in response && typeof response.content === 'string') {
                        return response.content.trim();
                    }
                    if ('candidates' in response && Array.isArray(response.candidates)) {
                        // Handle Gemini response format with candidates
                        const candidates = response.candidates;
                        if (candidates.length > 0) {
                            const candidate = candidates[0];
                            if ('content' in candidate) {
                                const content = candidate.content;
                                if ('parts' in content && Array.isArray(content.parts)) {
                                    const parts = content.parts;
                                    const textParts = [];
                                    for (const part of parts) {
                                        if ('text' in part) {
                                            textParts.push(part.text);
                                        }
                                    }
                                    return textParts.join(' ').trim();
                                }
                                else {
                                    return String(content).trim();
                                }
                            }
                            else {
                                return String(candidate).trim();
                            }
                        }
                        else {
                            return String(response).trim();
                        }
                    }
                }
                if (response && typeof response.text === 'string') {
                    return response.text.trim();
                }
                if (response && typeof response.content === 'string') {
                    return response.content.trim();
                }
                if (response && response.error) {
                    this.logger.error(`API error response: ${JSON.stringify(response.error)}`);
                    return '';
                }
                return String(response).trim();
            }
            catch (error) {
                this.logger.error(`Error extracting text from response: ${error.message}`);
                this.logger.error(`Response type: ${typeof response}`);
                this.logger.error(`Response content: ${JSON.stringify(response)}`);
                return '';
            }
        }
    };
    __setFunctionName(_classThis, "VectorSearchService");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        VectorSearchService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return VectorSearchService = _classThis;
})();
exports.VectorSearchService = VectorSearchService;
//# sourceMappingURL=vector-service.js.map