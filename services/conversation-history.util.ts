import {
  AssistantAnswerSource,
  ChatMessage,
  ConversationMemory,
} from '../types/chat.interface';

export const SUMMARY_UPDATE_MESSAGE_THRESHOLD = 10;
export const RECENT_TURN_COUNT = 6;
/** Raw messages fetched from DB before slicing to the last N turns. */
export const RECENT_MESSAGE_FETCH_LIMIT = RECENT_TURN_COUNT * 3;

interface ConversationTurn {
  user?: string;
  assistant?: string;
  assistantSource?: AssistantAnswerSource;
}

function formatAssistantHeader(source?: AssistantAnswerSource): string {
  if (!source) {
    return 'Assistant:';
  }
  if (source === 'web_search_only') {
    return 'Assistant (source: web_search_only, unverified):';
  }
  return `Assistant (source: ${source}):`;
}

function groupMessagesIntoTurns(messages: ChatMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      turns.push({ user: message.content });
      continue;
    }

    const lastTurn = turns[turns.length - 1];
    if (lastTurn && lastTurn.assistant === undefined) {
      lastTurn.assistant = message.content;
      lastTurn.assistantSource = message.source;
      continue;
    }

    turns.push({
      assistant: message.content,
      assistantSource: message.source,
    });
  }

  return turns;
}

function formatConversationTurn(
  turnNumber: number,
  turn: ConversationTurn,
): string {
  const lines = [`[Turn ${turnNumber}]`];

  if (turn.user !== undefined) {
    lines.push('User:', turn.user);
  }

  if (turn.assistant !== undefined) {
    if (turn.user !== undefined) {
      lines.push('');
    }
    lines.push(formatAssistantHeader(turn.assistantSource), turn.assistant);
  }

  return lines.join('\n');
}

export function countConversationTurns(messages: ChatMessage[]): number {
  if (!messages.length) {
    return 0;
  }

  return groupMessagesIntoTurns(messages).length;
}

export function takeLastConversationTurns(
  messages: ChatMessage[],
  turnCount: number,
): ChatMessage[] {
  if (!messages.length || turnCount <= 0) {
    return [];
  }

  const recentTurns = groupMessagesIntoTurns(messages).slice(-turnCount);
  const result: ChatMessage[] = [];

  for (const turn of recentTurns) {
    if (turn.user !== undefined) {
      result.push({ role: 'user', content: turn.user });
    }
    if (turn.assistant !== undefined) {
      result.push({
        role: 'assistant',
        content: turn.assistant,
        ...(turn.assistantSource ? { source: turn.assistantSource } : {}),
      });
    }
  }

  return result;
}

export function formatNumberedTurnHistory(messages: ChatMessage[]): string {
  if (!messages.length) {
    return '';
  }

  return groupMessagesIntoTurns(messages)
    .map((turn, index) => formatConversationTurn(index + 1, turn))
    .join('\n\n')
    .trim();
}

export function buildNumberedTurnHistorySection(
  messages: ChatMessage[],
): string {
  const historyText = formatNumberedTurnHistory(messages);
  if (!historyText) {
    return '';
  }

  return `${historyText}\n`;
}

export function needsSummarization(
  totalMessageCount: number,
  lastSummarizedMessageCount: number,
): boolean {
  return (
    totalMessageCount - lastSummarizedMessageCount >=
    SUMMARY_UPDATE_MESSAGE_THRESHOLD
  );
}

export function formatChatMessages(messages: ChatMessage[]): string {
  return messages
    .map(
      (message) =>
        `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`,
    )
    .join('\n')
    .trim();
}

// export function toChatMessagesFromPaginatedHistory(records: any[]): ChatMessage[] {
//   return records.map((message) => {
//     const role =
//       message.messageType === 'assistant'
//         ? ('assistant' as const)
//         : ('user' as const);
//     const source = message.sourceInfo ?? message.source_info;

//     return {
//       role,
//       content: message.messageContent ?? '',
//       ...(source ? { source } : {}),
//     };
//   });
// }

/** Removes document citation tags from stored chat text before LLM history context. */
export function stripSourceCitationsFromHistory(content: string): string {
  return content.replace(/\s*\[Source:\s*[^\]]+\]/gi, '').trim();
}

export function toChatMessagesFromPaginatedHistory(records: any[]): ChatMessage[] {
  return records.map((message) => {
    const role =
      message.messageType === 'assistant'
        ? ('assistant' as const)
        : ('user' as const);
    const source = message.sourceInfo ?? message.source_info;
    const cleanContent = stripSourceCitationsFromHistory(
      message.messageContent ?? '',
    );

    return {
      role,
      content: cleanContent,
      ...(source ? { source } : {}),
    };
  });
}

export function buildRecentHistoryText(messages: ChatMessage[]): string {
  return formatChatMessages(messages);
}

export function buildSummarySection(
  conversationSummary?: string | null,
): string {
  const summary = conversationSummary?.trim();
  if (!summary) {
    return '';
  }

  return `Conversation Summary:\n${summary}\n`;
}

export function buildRecentConversationSection(messages: ChatMessage[]): string {
  if (!messages.length) {
    return '';
  }

  return `Recent Conversation:\n${formatChatMessages(messages)}\n`;
}

export function buildCombinedHistoryText(
  conversationSummary: string | null | undefined,
  recentMessages: ChatMessage[],
): string {
  const recentHistoryText = buildRecentHistoryText(recentMessages);
  const summary = conversationSummary?.trim();

  if (!summary) {
    return recentHistoryText;
  }

  if (!recentHistoryText) {
    return `Conversation Summary:\n${summary}`;
  }

  return `Conversation Summary:\n${summary}\n\nRecent Conversation:\n${recentHistoryText}`;
}

export function buildConversationMemory(
  summary: string | null | undefined,
  recentMessages: ChatMessage[],
): ConversationMemory {
  const normalizedSummary = summary?.trim() || undefined;
  const recentHistoryText = buildRecentHistoryText(recentMessages);

  return {
    summary: normalizedSummary,
    recentMessages,
    recentHistoryText,
  };
}
