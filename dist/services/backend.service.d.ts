export declare class BackendService {
    private baseUrl;
    constructor();
    getChatForAI(chatId: string): Promise<any>;
    storeChatHistory(payload: {
        chatId: string;
        question: string;
        answer: string;
        strategy: string;
        confidence: number;
        fileName?: string;
        sessionId: string;
    }): Promise<any>;
    getChatHistory(chatId: string, limit?: number, offset?: number): Promise<any>;
    getPaginatedChatHistory(chatId: string, offset?: number, limit?: number): Promise<{
        success: boolean;
        history: any;
    }>;
    getConversationMemoryMetadata(chatId: string): Promise<any>;
    updateConversationSummary(chatId: string, payload: {
        conversationSummary: string;
        lastSummarizedMessageCount: number;
    }): Promise<any>;
    getSimilarChunks(payload: {
        queryEmbedding: number[];
        documentIds: string[];
        topK: number;
        fileName?: string;
    }): Promise<any>;
    updateChatTitle(chatId: string, title: string): Promise<any>;
}
//# sourceMappingURL=backend.service.d.ts.map