import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryRewriteService } from '../../services/query-rewrite.service';
import { PromptTemplateService } from '../../services/prompt-template.service';
import { ChatMessage, QueryRewriteIntent } from '../../types/chat.interface';

const mockGenerateContent = vi.fn();

vi.mock('../../services/llm-gateway.service', () => ({
  getLlmGateway: () => ({
    generateContent: mockGenerateContent,
  }),
}));

function mockLlmResponse(payload: {
  rewritten_query: string;
  was_rewritten: boolean;
  rewrite_reason?: string | null;
  confidence: 'high' | 'low' | 'medium';
  intent?: QueryRewriteIntent | null;
}): void {
  mockGenerateContent.mockResolvedValue({
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                history_used: false,
                intent: null,
                ...payload,
              }),
            },
          ],
        },
      },
    ],
  });
}

function getPromptText(): string {
  return (
    mockGenerateContent.mock.calls[0]?.[0]?.contents?.[0]?.parts?.[0]?.text ??
    ''
  );
}

describe('QueryRewriteService', () => {
  let service: QueryRewriteService;

  beforeEach(() => {
    mockGenerateContent.mockReset();
    service = new QueryRewriteService(new PromptTemplateService());
  });

  describe('always invokes LLM', () => {
    it('calls the rewrite LLM for every non-empty query', async () => {
      mockLlmResponse({
        rewritten_query: 'what is the case about',
        was_rewritten: false,
        confidence: 'high',
      });

      await service.rewrite('what is the case about');

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('calls the rewrite LLM even without conversation history', async () => {
      mockLlmResponse({
        rewritten_query: 'summarize this notice',
        was_rewritten: false,
        confidence: 'low',
      });

      await service.rewrite('summarize this notice');

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });
  });

  describe('rewrite inputs', () => {
    it('passes only recent conversation history and query to the prompt', async () => {
      const history: ChatMessage[] = [
        { role: 'user', content: 'Summarize the account.' },
        {
          role: 'assistant',
          content:
            '1. Account Summary\n2. Fees and Charges\n3. Payments Received',
        },
      ];

      mockLlmResponse({
        rewritten_query: 'Tell me more about the Account Summary.',
        was_rewritten: true,
        confidence: 'high',
      });

      await service.rewrite('Tell me about the first point mentioned above.', history, {
        caseName: 'ABC vs ITO',
        clientName: 'ABC Pvt Ltd',
        conversationSummary: 'User discussed account details.',
      });

      const promptText = getPromptText();

      expect(promptText).toContain('[Turn 1]');
      expect(promptText).toContain('Account Summary');
      expect(promptText).toContain('Current query:');
      expect(promptText).not.toContain('Conversation Summary:');
      expect(promptText).not.toContain('Case:');
      expect(promptText).not.toContain('Most Recent Assistant Response:');
    });
  });

  describe('typo correction', () => {
    it('rewrites typos via LLM when no assistant reference is present', async () => {
      mockLlmResponse({
        rewritten_query: 'what are the allegations',
        was_rewritten: true,
        rewrite_reason: 'typo correction',
        confidence: 'high',
      });

      const result = await service.rewrite('wat r allegations');

      expect(result.wasRewritten).toBe(true);
      expect(result.rewrittenQuery).toBe('what are the allegations');
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });
  });

  describe('context resolution', () => {
    it('resolves conversational references using history', async () => {
      const history: ChatMessage[] = [
        {
          role: 'user',
          content: 'Explain Section 148A Notice dated 12 June 2024.',
        },
      ];

      mockLlmResponse({
        rewritten_query:
          'What about the Section 148A Notice dated 12 June 2024?',
        was_rewritten: true,
        rewrite_reason: 'resolved reference to prior notice',
        confidence: 'high',
      });

      const result = await service.rewrite('What about this notice?', history);

      expect(result.wasRewritten).toBe(true);
      expect(result.rewrittenQuery).toBe(
        'What about the Section 148A Notice dated 12 June 2024?',
      );
    });

    it('resolves first point references from assistant numbered lists', async () => {
      const history: ChatMessage[] = [
        { role: 'user', content: 'Summarize the account.' },
        {
          role: 'assistant',
          content:
            '1. Account Summary\n2. Fees and Charges\n3. Payments Received',
        },
      ];

      mockLlmResponse({
        rewritten_query: 'Tell me more about the Account Summary.',
        was_rewritten: true,
        rewrite_reason: 'resolved first point reference',
        confidence: 'high',
      });

      const result = await service.rewrite(
        'Tell me about the first point mentioned above.',
        history,
      );

      expect(result.wasRewritten).toBe(true);
      expect(result.rewrittenQuery).toBe('Tell me more about the Account Summary.');
    });

    it('rejects typo-only rewrites when a reference remains unresolved', async () => {
      const history: ChatMessage[] = [
        { role: 'user', content: 'Summarize the account.' },
        {
          role: 'assistant',
          content:
            '1. Account Summary\n2. Fees and Charges\n3. Payments Received',
        },
      ];

      mockLlmResponse({
        rewritten_query:
          'Tell me about the first point mentioned in the above answer.',
        was_rewritten: true,
        rewrite_reason: "Fixed typo 'fisrt' to 'first'.",
        confidence: 'high',
      });

      const result = await service.rewrite(
        'Tell me about the fisrt point mentioned in the above answer?',
        history,
      );

      expect(result.wasRewritten).toBe(false);
      expect(result.rewrittenQuery).toBe(
        'Tell me about the fisrt point mentioned in the above answer?',
      );
    });

    it('rejects bare proximity rewrites missing anchor turn citation in rewrite_reason', async () => {
      const history: ChatMessage[] = [
        { role: 'user', content: 'what is the demand notice?' },
        {
          role: 'assistant',
          content: 'A demand notice is a formal written communication...',
        },
        { role: 'user', content: 'i meant above as per document?' },
        {
          role: 'assistant',
          content:
            'Section 148 is a notice to reopen assessment; demand follows under Section 156.',
        },
      ];

      mockLlmResponse({
        rewritten_query:
          'Is the Section 148 notice a demand notice as per the case documents?',
        was_rewritten: true,
        rewrite_reason:
          "Resolved 'above' to Section 148 from earlier in the conversation.",
        confidence: 'high',
      });

      const result = await service.rewrite(
        'i meant above as per document ?',
        history,
      );

      expect(result.wasRewritten).toBe(false);
      expect(result.rewrittenQuery).toBe('i meant above as per document ?');
    });

    it('rejects rewrites that leave "i meant above" unresolved', async () => {
      const history: ChatMessage[] = [
        { role: 'user', content: 'who issued the section 148?' },
        {
          role: 'assistant',
          content: 'The Section 148 notice was issued on 03-05-2024.',
        },
        { role: 'user', content: 'what is the demand notice?' },
        {
          role: 'assistant',
          content: 'A demand notice is a formal written communication...',
        },
        { role: 'user', content: 'i meant as per document?' },
        {
          role: 'assistant',
          content: 'In this case, demand notices are issued under Section 156...',
        },
      ];

      mockLlmResponse({
        rewritten_query: 'i meant above as per document?',
        was_rewritten: true,
        rewrite_reason: 'could not resolve above',
        confidence: 'high',
      });

      const result = await service.rewrite(
        'i meant above as per document ?',
        history,
      );

      expect(result.wasRewritten).toBe(false);
      expect(result.rewrittenQuery).toBe('i meant above as per document ?');
    });
  });

  describe('intent preservation', () => {
    it('does not change intent when LLM reports low confidence', async () => {
      mockLlmResponse({
        rewritten_query: 'summarize this notice',
        was_rewritten: false,
        rewrite_reason: 'reference cannot be resolved',
        confidence: 'low',
      });

      const result = await service.rewrite('summarize this notice');

      expect(result.wasRewritten).toBe(false);
      expect(result.rewrittenQuery).toBe('summarize this notice');
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });
  });

  describe('confidence-based activation', () => {
    it('returns original query when LLM reports low confidence', async () => {
      const history: ChatMessage[] = [
        { role: 'user', content: 'Tell me about the case.' },
      ];

      mockLlmResponse({
        rewritten_query: 'what happened after the assessment?',
        was_rewritten: true,
        rewrite_reason: 'guess',
        confidence: 'low',
      });

      const result = await service.rewrite('what happened after that?', history);

      expect(result.wasRewritten).toBe(false);
      expect(result.rewrittenQuery).toBe('what happened after that?');
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('returns original query when high confidence but query unchanged', async () => {
      mockLlmResponse({
        rewritten_query: 'what are the allegations',
        was_rewritten: false,
        confidence: 'high',
      });

      const result = await service.rewrite('what are the allegations');

      expect(result.wasRewritten).toBe(false);
      expect(result.rewrittenQuery).toBe('what are the allegations');
    });
  });

  describe('bare assent resolution', () => {
    it('rewrites bare assent accepting a search-outside offer into explicit web search', async () => {
      const history: ChatMessage[] = [
        {
          role: 'user',
          content: 'What is Section 80C in the uploaded document?',
        },
        {
          role: 'assistant',
          content:
            'I could not find information about Section 80C in the uploaded document. Would you like me to search outside the uploaded document for Section 80C?',
          source: 'document_insufficient',
        },
      ];

      mockLlmResponse({
        rewritten_query: 'Search the web for Section 80C',
        was_rewritten: true,
        rewrite_reason:
          "Resolved bare assent to accept the Turn 1 offer to search outside the uploaded document for Section 80C.",
        confidence: 'high',
        history_used: true,
        intent: 'accept_web_search_offer',
      });

      const result = await service.rewrite('yes please', history);

      expect(result.wasRewritten).toBe(true);
      expect(result.rewrittenQuery).toBe('Search the web for Section 80C');
      expect(result.intent).toBe('accept_web_search_offer');
    });

    it('accepts bare assent rewrite for web search without intent when rewrite is explicit', async () => {
      const history: ChatMessage[] = [
        {
          role: 'assistant',
          content:
            'Would you like me to search outside the uploaded document for Section 80C?',
          source: 'document_insufficient',
        },
      ];

      mockLlmResponse({
        rewritten_query: 'Search the web for Section 80C',
        was_rewritten: true,
        rewrite_reason: 'Resolved assent at Turn 1.',
        confidence: 'high',
        intent: null,
      });

      const result = await service.rewrite('yes', history);

      expect(result.wasRewritten).toBe(true);
      expect(result.rewrittenQuery).toBe('Search the web for Section 80C');
      expect(result.intent).toBeUndefined();
    });

    it('accepts bare assent rewrite for non-web elaboration offers', async () => {
      const history: ChatMessage[] = [
        {
          role: 'assistant',
          content:
            'The notice alleges unexplained cash deposits. Would you like me to elaborate on how these relate to Section 68?',
          source: 'vector_search_only',
        },
      ];

      mockLlmResponse({
        rewritten_query:
          'Elaborate on how the unexplained cash deposit allegations relate to Section 68.',
        was_rewritten: true,
        rewrite_reason:
          'Resolved bare assent to accept the Turn 1 offer to elaborate on Section 68.',
        confidence: 'high',
        history_used: true,
        intent: null,
      });

      const result = await service.rewrite('yes', history);

      expect(result.wasRewritten).toBe(true);
      expect(result.rewrittenQuery).toContain('Section 68');
      expect(result.intent).toBeUndefined();
    });

    it('rejects bare assent rewrite that is not an explicit web search query', async () => {
      mockLlmResponse({
        rewritten_query: 'Tell me more about Section 80C',
        was_rewritten: true,
        rewrite_reason: 'Resolved assent at Turn 1.',
        confidence: 'high',
        intent: 'accept_web_search_offer',
      });

      const result = await service.rewrite('go ahead', [
        {
          role: 'assistant',
          content:
            'Would you like me to search outside the uploaded document for Section 80C?',
        },
      ]);

      expect(result.wasRewritten).toBe(false);
    });
  });

  describe('deliverable correction', () => {
    it('rewrites overview-not-timeline corrections into standalone overview requests', async () => {
      const history: ChatMessage[] = [
        { role: 'user', content: 'Give me an overview of this case.' },
        {
          role: 'assistant',
          content:
            '| Date | Event |\n| 01-04-2023 | Section 148 notice issued |',
          source: 'metadata',
        },
        { role: 'user', content: 'i asked for overview not timeline' },
        {
          role: 'assistant',
          content: 'Here is a date-wise sequence of key events in the case...',
          source: 'metadata',
        },
      ];

      mockLlmResponse({
        rewritten_query:
          'Give me an overview of this case without a chronological timeline or date-wise events.',
        was_rewritten: true,
        rewrite_reason:
          'Resolved deliverable correction: original overview request in Turn 1; user rejects timeline from Turn 2.',
        confidence: 'high',
        history_used: true,
      });

      const result = await service.rewrite(
        'i asked for overview not timeline',
        history,
      );

      expect(result.wasRewritten).toBe(true);
      expect(result.rewrittenQuery).toBe(
        'Give me an overview of this case without a chronological timeline or date-wise events.',
      );
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-3-flash-preview' }),
      );
    });

    it('does not apply deliverable correction rewrite when LLM returns low confidence', async () => {
      const history: ChatMessage[] = [
        { role: 'user', content: 'Give me an overview of this case.' },
        {
          role: 'assistant',
          content: 'Timeline of events...',
          source: 'metadata',
        },
      ];

      mockLlmResponse({
        rewritten_query: 'i asked for overview not timeline',
        was_rewritten: false,
        rewrite_reason: 'ambiguous correction',
        confidence: 'low',
      });

      const result = await service.rewrite(
        'i asked for overview not timeline',
        history,
      );

      expect(result.wasRewritten).toBe(false);
      expect(result.rewrittenQuery).toBe('i asked for overview not timeline');
    });
  });

  describe('LLM failure fallback', () => {
    it('returns original query when LLM call fails', async () => {
      mockGenerateContent.mockRejectedValue(new Error('LLM unavailable'));

      const result = await service.rewrite('what are the allegations');

      expect(result.wasRewritten).toBe(false);
      expect(result.rewrittenQuery).toBe('what are the allegations');
    });
  });
});
