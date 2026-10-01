import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationMemoryService } from '../../services/conversation-memory.service';
import { PromptTemplateService } from '../../services/prompt-template.service';
import { RECENT_MESSAGE_FETCH_LIMIT } from '../../services/conversation-history.util';

vi.mock('../../services/llm-gateway.service', () => ({
  getLlmGateway: () => ({
    generateContent: vi.fn().mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'Updated summary text.' }] } }],
    }),
  }),
}));

describe('ConversationMemoryService', () => {
  const backendService = {
    getConversationMemoryMetadata: vi.fn(),
    getPaginatedChatHistory: vi.fn(),
    updateConversationSummary: vi.fn(),
  };
  const service = new ConversationMemoryService(
    backendService as any,
    new PromptTemplateService(),
  );
  const loggerSpy = vi.spyOn((service as any).logger, 'log');
  const warnSpy = vi.spyOn((service as any).logger, 'warn');

  beforeEach(() => {
    vi.clearAllMocks();
    backendService.updateConversationSummary.mockResolvedValue({ success: true });
  });

  it('loads recent messages without summarization when threshold not met', async () => {
    backendService.getConversationMemoryMetadata.mockResolvedValue({
      success: true,
      data: {
        conversationSummary: 'Existing summary.',
        lastSummarizedMessageCount: 20,
        totalMessageCount: 25,
      },
    });
    backendService.getPaginatedChatHistory.mockResolvedValue({
      success: true,
      history: [
        { messageType: 'user', messageContent: 'Latest question' },
        { messageType: 'assistant', messageContent: 'Latest answer' },
      ],
    });

    const memory = await service.getConversationMemory('chat-1');

    expect(backendService.getPaginatedChatHistory).toHaveBeenLastCalledWith(
      'chat-1',
      25 - RECENT_MESSAGE_FETCH_LIMIT,
      RECENT_MESSAGE_FETCH_LIMIT,
    );
    expect(backendService.updateConversationSummary).not.toHaveBeenCalled();
    expect(memory.summary).toBe('Existing summary.');
    expect(memory.recentMessages).toHaveLength(2);
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('Needs Summarization: false'),
    );
  });

  it('summarizes and loads memory when threshold is met', async () => {
    backendService.getConversationMemoryMetadata.mockResolvedValue({
      success: true,
      data: {
        conversationSummary: 'Existing summary.',
        lastSummarizedMessageCount: 20,
        totalMessageCount: 31,
      },
    });
    backendService.getPaginatedChatHistory
      .mockResolvedValueOnce({
        success: true,
        history: Array.from({ length: 11 }, (_, index) => ({
          messageType: index % 2 === 0 ? 'user' : 'assistant',
          messageContent: `Message ${index + 21}`,
        })),
      })
      .mockResolvedValueOnce({
        success: true,
        history: [
          { messageType: 'user', messageContent: 'Recent user' },
          { messageType: 'assistant', messageContent: 'Recent assistant' },
        ],
      });

    const memory = await service.getConversationMemory('chat-1');

    expect(backendService.updateConversationSummary).toHaveBeenCalledWith(
      'chat-1',
      {
        conversationSummary: 'Updated summary text.',
        lastSummarizedMessageCount: 31,
      },
    );
    expect(memory.summary).toBe('Updated summary text.');
    expect(memory.recentMessages).toHaveLength(2);
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('Updated Summary | Covered Messages: 20 → 31'),
    );
  });

  it('continues with existing summary when summarization fails', async () => {
    backendService.getConversationMemoryMetadata.mockResolvedValue({
      success: true,
      data: {
        conversationSummary: 'Existing summary.',
        lastSummarizedMessageCount: 20,
        totalMessageCount: 31,
      },
    });
    backendService.getPaginatedChatHistory
      .mockResolvedValueOnce({ success: true, history: [] })
      .mockResolvedValueOnce({
        success: true,
        history: [{ messageType: 'user', messageContent: 'Recent user' }],
      });

    const memory = await service.getConversationMemory('chat-1');

    expect(warnSpy).toHaveBeenCalled();
    expect(memory.summary).toBe('Existing summary.');
  });
});
