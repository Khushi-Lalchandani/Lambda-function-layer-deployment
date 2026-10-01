"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackendService = void 0;
const axios_1 = __importDefault(require("axios"));
class BackendService {
    constructor() {
        this.baseUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    }
    async getChatForAI(chatId) {
        try {
            const response = await axios_1.default.get(`${this.baseUrl}/database/chat/${chatId}`);
            return response.data;
        }
        catch (error) {
            console.error('Error fetching chat for AI:', error.message);
            return { success: false, message: error.message };
        }
    }
    async storeChatHistory(payload) {
        try {
            const response = await axios_1.default.post(`${this.baseUrl}/database/chat-history`, payload);
            return response.data;
        }
        catch (error) {
            console.error('Error storing chat history:', error.message);
            return { success: false, message: error.message };
        }
    }
    async getChatHistory(chatId, limit = 12, offset = 0) {
        try {
            const response = await axios_1.default.get(`${this.baseUrl}/database/chat-history/${chatId}`, { params: { limit, offset } });
            return response.data;
        }
        catch (error) {
            console.error('Error fetching chat history:', error.message);
            return { success: false, data: [] };
        }
    }
    async getPaginatedChatHistory(chatId, offset = 0, limit = 6) {
        try {
            const response = await axios_1.default.get(`${this.baseUrl}/database/chat/chat-history/${chatId}`, { params: { offset, limit } });
            const history = response.data?.history ?? response.data?.data ?? [];
            return { success: true, history };
        }
        catch (error) {
            console.error('Error fetching paginated chat history:', error.message);
            return { success: false, history: [] };
        }
    }
    async getConversationMemoryMetadata(chatId) {
        try {
            const response = await axios_1.default.get(`${this.baseUrl}/database/chat/${chatId}/conversation-memory`);
            return response.data;
        }
        catch (error) {
            console.error('Error fetching conversation memory:', error.message);
            return {
                success: false,
                data: {
                    conversationSummary: null,
                    lastSummarizedMessageCount: 0,
                    totalMessageCount: 0,
                },
            };
        }
    }
    async updateConversationSummary(chatId, payload) {
        try {
            const response = await axios_1.default.patch(`${this.baseUrl}/database/chat/${chatId}/conversation-summary`, payload);
            return response.data;
        }
        catch (error) {
            console.error('Error updating conversation summary:', error.message);
            return { success: false, message: error.message };
        }
    }
    async getSimilarChunks(payload) {
        try {
            const response = await axios_1.default.post(`${this.baseUrl}/database/similar-chunks`, payload);
            return response.data;
        }
        catch (error) {
            console.error('Error fetching similar chunks:', error.message);
            return { success: false, data: [] };
        }
    }
    async updateChatTitle(chatId, title) {
        try {
            const response = await axios_1.default.patch(`${this.baseUrl}/database/chat/${chatId}/title`, { title });
            return response.data;
        }
        catch (error) {
            console.error('Error updating chat title:', error.message);
            return { success: false, message: error.message };
        }
    }
}
exports.BackendService = BackendService;
//# sourceMappingURL=backend.service.js.map