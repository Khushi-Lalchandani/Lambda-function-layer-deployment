import { describe, it, expect } from 'vitest';
import {
  buildCombinedHistoryText,
  buildSummarySection,
  formatNumberedTurnHistory,
  needsSummarization,
  stripSourceCitationsFromHistory,
  takeLastConversationTurns,
  toChatMessagesFromPaginatedHistory,
} from '../../services/conversation-history.util';

describe('conversation-history.util', () => {
  it('needs summarization every 10 new messages', () => {
    expect(needsSummarization(9, 0)).toBe(false);
    expect(needsSummarization(10, 0)).toBe(true);
    expect(needsSummarization(31, 20)).toBe(true);
    expect(needsSummarization(29, 20)).toBe(false);
  });

  it('builds summary section only when summary exists', () => {
    expect(buildSummarySection(null)).toBe('');
    expect(buildSummarySection('Prior discussion about Section 148A.')).toContain(
      'Conversation Summary:',
    );
  });

  it('combines summary with recent messages for answer context', () => {
    const combined = buildCombinedHistoryText('Earlier penalty discussion.', [
      { role: 'user', content: 'What about the notice?' },
      { role: 'assistant', content: 'The notice alleges concealment.' },
    ]);

    expect(combined).toContain('Conversation Summary:');
    expect(combined).toContain('Earlier penalty discussion.');
    expect(combined).toContain('Recent Conversation:');
    expect(combined).toContain('What about the notice?');
  });

  it('formats numbered turns with assistant source metadata', () => {
    const formatted = formatNumberedTurnHistory([
      { role: 'user', content: 'Give me a quick overview of this case.' },
      {
        role: 'assistant',
        content: 'This case concerns ...',
        source: 'vector_search_only',
      },
      { role: 'user', content: 'How to secure Form 4?' },
      {
        role: 'assistant',
        content: 'To obtain Form 4 ...',
        source: 'vector_search_only',
      },
    ]);

    expect(formatted).toContain('[Turn 1]');
    expect(formatted).toContain('[Turn 2]');
    expect(formatted).toContain('User:\nGive me a quick overview of this case.');
    expect(formatted).toContain('Assistant (source: vector_search_only):');
    expect(formatted).toContain('How to secure Form 4?');
    expect(formatted).not.toContain('[Turn 3]');
  });

  it('appends unverified to web_search_only assistant turns', () => {
    const formatted = formatNumberedTurnHistory([
      { role: 'user', content: 'What are other options?' },
      {
        role: 'assistant',
        content: 'You could also file a writ.',
        source: 'web_search_only',
      },
    ]);

    expect(formatted).toContain(
      'Assistant (source: web_search_only, unverified):',
    );
  });

  it('keeps only the last N conversation turns', () => {
    const messages = Array.from({ length: 8 }, (_, index) => {
      const turn = Math.floor(index / 2) + 1;
      if (index % 2 === 0) {
        return { role: 'user' as const, content: `Question ${turn}` };
      }
      return {
        role: 'assistant' as const,
        content: `Answer ${turn}`,
        source: 'vector_search_only' as const,
      };
    });

    const recent = takeLastConversationTurns(messages, 3);

    expect(recent).toHaveLength(6);
    expect(recent[0]?.content).toBe('Question 2');
    expect(recent[5]?.content).toBe('Answer 4');
    expect(formatNumberedTurnHistory(recent)).toContain('[Turn 1]');
    expect(formatNumberedTurnHistory(recent)).toContain('Question 2');
    expect(formatNumberedTurnHistory(recent)).not.toContain('Question 1');
  });

  it('strips inline and trailing source citations from history messages', () => {
    const cited =
      'Notice issued on 03-05-2024. [Source: notice.pdf] Demand followed. [Source: e68cf21a.pdf, 476b89a1.pdf]';
    expect(stripSourceCitationsFromHistory(cited)).toBe(
      'Notice issued on 03-05-2024. Demand followed.',
    );

    const messages = toChatMessagesFromPaginatedHistory([
      {
        messageType: 'assistant',
        messageContent:
          '| 03-05-2024 | Event [Source: file-1.pdf] |\n| 10-06-2024 | Hearing [Source: file-2.pdf, file-3.pdf] |',
        sourceInfo: 'vector_search_only',
      },
    ]);

    expect(messages[0]?.content).not.toMatch(/\[Source:/i);
    expect(messages[0]?.content).toContain('03-05-2024');
    expect(messages[0]?.source).toBe('vector_search_only');
  });

  it('omits source tag when assistant source is unavailable', () => {
    const formatted = formatNumberedTurnHistory([
      { role: 'user', content: 'What happened?' },
      { role: 'assistant', content: 'A notice was issued.' },
    ]);

    expect(formatted).toContain('Assistant:\nA notice was issued.');
    expect(formatted).not.toContain('(source:');
  });
});
