import { Injectable, Logger } from '@nestjs/common';
import { ChatMessage, ConversationMemory } from '../types/chat.interface';
import { BackendService } from './backend.service';
import { PromptTemplateService } from './prompt-template.service';
import { getLlmGateway } from './llm-gateway.service';
import { GEMINI_3_5_FLASH_LITE } from './llm-model.constants';
import {
  buildConversationMemory,
  formatChatMessages,
  needsSummarization,
  RECENT_MESSAGE_FETCH_LIMIT,
  RECENT_TURN_COUNT,
  takeLastConversationTurns,
  toChatMessagesFromPaginatedHistory,
} from './conversation-history.util';

@Injectable()
export class ConversationMemoryService {
  private readonly logger = new Logger(ConversationMemoryService.name);
  private readonly llm = getLlmGateway();

  constructor(
    private readonly backendService: BackendService,
    private readonly promptTemplateService: PromptTemplateService,
  ) {}

  async getConversationMemory(chatId: string): Promise<ConversationMemory> {
    const metadataResponse =
      await this.backendService.getConversationMemoryMetadata(chatId);
    const metadata = metadataResponse?.data ?? metadataResponse ?? {
      conversationSummary: null,
      lastSummarizedMessageCount: 0,
      totalMessageCount: 0,
    };

    let conversationSummary = metadata.conversationSummary ?? null;
    let lastSummarizedMessageCount = metadata.lastSummarizedMessageCount ?? 0;
    const totalMessageCount = metadata.totalMessageCount ?? 0;
    const shouldSummarize = needsSummarization(
      totalMessageCount,
      lastSummarizedMessageCount,
    );

    this.logger.log(
      `[MEMORY] Summary Exists: ${Boolean(conversationSummary)} | Total Messages: ${totalMessageCount} | Last Summarized: ${lastSummarizedMessageCount} | Needs Summarization: ${shouldSummarize}`,
    );

    if (shouldSummarize) {
      const previousCount = lastSummarizedMessageCount;
      const updated = await this.summarizeAndPersist(
        chatId,
        conversationSummary,
        lastSummarizedMessageCount,
        totalMessageCount,
      );

      if (updated) {
        conversationSummary = updated.conversationSummary;
        lastSummarizedMessageCount = updated.lastSummarizedMessageCount;
        this.logger.log(
          `[MEMORY] Updated Summary | Covered Messages: ${previousCount} → ${lastSummarizedMessageCount}`,
        );
      }
    }

    const recentOffset = Math.max(
      totalMessageCount - RECENT_MESSAGE_FETCH_LIMIT,
      0,
    );
    const recentResponse = await this.backendService.getPaginatedChatHistory(
      chatId,
      recentOffset,
      RECENT_MESSAGE_FETCH_LIMIT,
    );
    const fetchedMessages = toChatMessagesFromPaginatedHistory(
      recentResponse.history ?? [],
    );
    const recentMessages = takeLastConversationTurns(
      fetchedMessages,
      RECENT_TURN_COUNT,
    );
    const memory = buildConversationMemory(conversationSummary, recentMessages);

    this.logger.log(
      `[MEMORY] Recent Messages Loaded: ${memory.recentMessages.length} | Summary Length: ${memory.summary?.length ?? 0} chars`,
    );

    return memory;
  }

  private async summarizeAndPersist(
    chatId: string,
    existingSummary: string | null,
    lastSummarizedMessageCount: number,
    totalMessageCount: number,
  ): Promise<{
    conversationSummary: string;
    lastSummarizedMessageCount: number;
  } | null> {
    try {
      const unsummarizedCount = totalMessageCount - lastSummarizedMessageCount;
      const historyResponse = await this.backendService.getPaginatedChatHistory(
        chatId,
        lastSummarizedMessageCount,
        Math.max(unsummarizedCount, SUMMARY_FETCH_LIMIT),
      );
      const newMessages = toChatMessagesFromPaginatedHistory(
        historyResponse.history ?? [],
      );

      if (newMessages.length === 0) {
        this.logger.warn(
          `[MEMORY] Chat: ${chatId} Action: Failed - no unsummarized messages found`,
        );
        return null;
      }

      const updatedSummary = await this.generateUpdatedSummary(
        existingSummary,
        newMessages,
      );
      const saveResponse = await this.backendService.updateConversationSummary(
        chatId,
        {
          conversationSummary: updatedSummary,
          lastSummarizedMessageCount: totalMessageCount,
        },
      );

      if (!saveResponse.success) {
        throw new Error(saveResponse.message ?? 'Failed to save summary');
      }

      return {
        conversationSummary: updatedSummary,
        lastSummarizedMessageCount: totalMessageCount,
      };
    } catch (error: any) {
      this.logger.warn(
        `[MEMORY] Chat: ${chatId} Action: Failed - ${error.message}`,
      );
      return null;
    }
  }

  async generateUpdatedSummary(
    existingSummary: string | null,
    newMessages: ChatMessage[],
  ): Promise<string> {
    const prompt = this.promptTemplateService.renderTemplate(
      'conversation-summary.txt',
      {
        existingSummary: existingSummary?.trim() || 'None',
        messages: formatChatMessages(newMessages),
      },
    );

    const response = await this.llm.generateContent({
      model: GEMINI_3_5_FLASH_LITE,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0,
        topP: 0.95,
        topK: 40,
      },
    });

    const text =
      response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';

    if (!text) {
      throw new Error('Empty summary response from LLM');
    }

    return text;
  }
}

const SUMMARY_FETCH_LIMIT = 100;
