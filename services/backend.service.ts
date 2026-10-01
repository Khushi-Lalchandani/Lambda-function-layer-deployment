import axios from 'axios';

export class BackendService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.BACKEND_URL || 'http://localhost:3000';
  }

  async getChatForAI(chatId: string) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/database/chat/${chatId}`,
      );
      return response.data;
    } catch (error: any) {
      console.error('Error fetching chat for AI:', error.message);
      return { success: false, message: error.message };
    }
  }

  async storeChatHistory(payload: {
    chatId: string;
    question: string;
    answer: string;
    strategy: string;
    confidence: number;
    fileName?: string;
    sessionId: string;
  }) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/database/chat-history`,
        payload,
      );
      return response.data;
    } catch (error: any) {
      console.error('Error storing chat history:', error.message);
      return { success: false, message: error.message };
    }
  }

  async getChatHistory(chatId: string, limit: number = 12, offset: number = 0) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/database/chat-history/${chatId}`,
        { params: { limit, offset } },
      );
      return response.data;
    } catch (error: any) {
      console.error('Error fetching chat history:', error.message);
      return { success: false, data: [] };
    }
  }

  async getPaginatedChatHistory(
    chatId: string,
    offset: number = 0,
    limit: number = 6,
  ) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/database/chat/chat-history/${chatId}`,
        { params: { offset, limit } },
      );
      const history = response.data?.history ?? response.data?.data ?? [];
      return { success: true, history };
    } catch (error: any) {
      console.error('Error fetching paginated chat history:', error.message);
      return { success: false, history: [] };
    }
  }

  async getConversationMemoryMetadata(chatId: string) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/database/chat/${chatId}/conversation-memory`,
      );
      return response.data;
    } catch (error: any) {
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

  async updateConversationSummary(
    chatId: string,
    payload: {
      conversationSummary: string;
      lastSummarizedMessageCount: number;
    },
  ) {
    try {
      const response = await axios.patch(
        `${this.baseUrl}/database/chat/${chatId}/conversation-summary`,
        payload,
      );
      return response.data;
    } catch (error: any) {
      console.error('Error updating conversation summary:', error.message);
      return { success: false, message: error.message };
    }
  }

  async getSimilarChunks(payload: {
    queryEmbedding: number[];
    documentIds: string[];
    topK: number;
    fileName?: string;
  }) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/database/similar-chunks`,
        payload,
      );
      return response.data;
    } catch (error: any) {
      console.error('Error fetching similar chunks:', error.message);
      return { success: false, data: [] };
    }
  }
  async updateChatTitle(chatId: string, title: string) {
    try {
      const response = await axios.patch(
        `${this.baseUrl}/database/chat/${chatId}/title`,
        { title },
      );
      return response.data;
    } catch (error: any) {
      console.error('Error updating chat title:', error.message);
      return { success: false, message: error.message };
    }
  }
}
