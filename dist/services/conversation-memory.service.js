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
exports.ConversationMemoryService = void 0;
const common_1 = require("@nestjs/common");
const llm_gateway_service_1 = require("./llm-gateway.service");
const llm_model_constants_1 = require("./llm-model.constants");
const conversation_history_util_1 = require("./conversation-history.util");
let ConversationMemoryService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var ConversationMemoryService = _classThis = class {
        constructor(backendService, promptTemplateService) {
            this.backendService = backendService;
            this.promptTemplateService = promptTemplateService;
            this.logger = new common_1.Logger(ConversationMemoryService.name);
            this.llm = (0, llm_gateway_service_1.getLlmGateway)();
        }
        async getConversationMemory(chatId) {
            const metadataResponse = await this.backendService.getConversationMemoryMetadata(chatId);
            const metadata = metadataResponse?.data ?? metadataResponse ?? {
                conversationSummary: null,
                lastSummarizedMessageCount: 0,
                totalMessageCount: 0,
            };
            let conversationSummary = metadata.conversationSummary ?? null;
            let lastSummarizedMessageCount = metadata.lastSummarizedMessageCount ?? 0;
            const totalMessageCount = metadata.totalMessageCount ?? 0;
            const shouldSummarize = (0, conversation_history_util_1.needsSummarization)(totalMessageCount, lastSummarizedMessageCount);
            this.logger.log(`[MEMORY] Summary Exists: ${Boolean(conversationSummary)} | Total Messages: ${totalMessageCount} | Last Summarized: ${lastSummarizedMessageCount} | Needs Summarization: ${shouldSummarize}`);
            if (shouldSummarize) {
                const previousCount = lastSummarizedMessageCount;
                const updated = await this.summarizeAndPersist(chatId, conversationSummary, lastSummarizedMessageCount, totalMessageCount);
                if (updated) {
                    conversationSummary = updated.conversationSummary;
                    lastSummarizedMessageCount = updated.lastSummarizedMessageCount;
                    this.logger.log(`[MEMORY] Updated Summary | Covered Messages: ${previousCount} → ${lastSummarizedMessageCount}`);
                }
            }
            const recentOffset = Math.max(totalMessageCount - conversation_history_util_1.RECENT_MESSAGE_FETCH_LIMIT, 0);
            const recentResponse = await this.backendService.getPaginatedChatHistory(chatId, recentOffset, conversation_history_util_1.RECENT_MESSAGE_FETCH_LIMIT);
            const fetchedMessages = (0, conversation_history_util_1.toChatMessagesFromPaginatedHistory)(recentResponse.history ?? []);
            const recentMessages = (0, conversation_history_util_1.takeLastConversationTurns)(fetchedMessages, conversation_history_util_1.RECENT_TURN_COUNT);
            const memory = (0, conversation_history_util_1.buildConversationMemory)(conversationSummary, recentMessages);
            this.logger.log(`[MEMORY] Recent Messages Loaded: ${memory.recentMessages.length} | Summary Length: ${memory.summary?.length ?? 0} chars`);
            return memory;
        }
        async summarizeAndPersist(chatId, existingSummary, lastSummarizedMessageCount, totalMessageCount) {
            try {
                const unsummarizedCount = totalMessageCount - lastSummarizedMessageCount;
                const historyResponse = await this.backendService.getPaginatedChatHistory(chatId, lastSummarizedMessageCount, Math.max(unsummarizedCount, SUMMARY_FETCH_LIMIT));
                const newMessages = (0, conversation_history_util_1.toChatMessagesFromPaginatedHistory)(historyResponse.history ?? []);
                if (newMessages.length === 0) {
                    this.logger.warn(`[MEMORY] Chat: ${chatId} Action: Failed - no unsummarized messages found`);
                    return null;
                }
                const updatedSummary = await this.generateUpdatedSummary(existingSummary, newMessages);
                const saveResponse = await this.backendService.updateConversationSummary(chatId, {
                    conversationSummary: updatedSummary,
                    lastSummarizedMessageCount: totalMessageCount,
                });
                if (!saveResponse.success) {
                    throw new Error(saveResponse.message ?? 'Failed to save summary');
                }
                return {
                    conversationSummary: updatedSummary,
                    lastSummarizedMessageCount: totalMessageCount,
                };
            }
            catch (error) {
                this.logger.warn(`[MEMORY] Chat: ${chatId} Action: Failed - ${error.message}`);
                return null;
            }
        }
        async generateUpdatedSummary(existingSummary, newMessages) {
            const prompt = this.promptTemplateService.renderTemplate('conversation-summary.txt', {
                existingSummary: existingSummary?.trim() || 'None',
                messages: (0, conversation_history_util_1.formatChatMessages)(newMessages),
            });
            const response = await this.llm.generateContent({
                model: llm_model_constants_1.GEMINI_3_5_FLASH_LITE,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: {
                    temperature: 0,
                    topP: 0.95,
                    topK: 40,
                },
            });
            const text = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
            if (!text) {
                throw new Error('Empty summary response from LLM');
            }
            return text;
        }
    };
    __setFunctionName(_classThis, "ConversationMemoryService");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        ConversationMemoryService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return ConversationMemoryService = _classThis;
})();
exports.ConversationMemoryService = ConversationMemoryService;
const SUMMARY_FETCH_LIMIT = 100;
//# sourceMappingURL=conversation-memory.service.js.map