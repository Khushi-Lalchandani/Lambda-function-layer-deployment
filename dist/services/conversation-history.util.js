"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECENT_MESSAGE_FETCH_LIMIT = exports.RECENT_TURN_COUNT = exports.SUMMARY_UPDATE_MESSAGE_THRESHOLD = void 0;
exports.countConversationTurns = countConversationTurns;
exports.takeLastConversationTurns = takeLastConversationTurns;
exports.formatNumberedTurnHistory = formatNumberedTurnHistory;
exports.buildNumberedTurnHistorySection = buildNumberedTurnHistorySection;
exports.needsSummarization = needsSummarization;
exports.formatChatMessages = formatChatMessages;
exports.stripSourceCitationsFromHistory = stripSourceCitationsFromHistory;
exports.toChatMessagesFromPaginatedHistory = toChatMessagesFromPaginatedHistory;
exports.buildRecentHistoryText = buildRecentHistoryText;
exports.buildSummarySection = buildSummarySection;
exports.buildRecentConversationSection = buildRecentConversationSection;
exports.buildCombinedHistoryText = buildCombinedHistoryText;
exports.buildConversationMemory = buildConversationMemory;
exports.SUMMARY_UPDATE_MESSAGE_THRESHOLD = 10;
exports.RECENT_TURN_COUNT = 6;
/** Raw messages fetched from DB before slicing to the last N turns. */
exports.RECENT_MESSAGE_FETCH_LIMIT = exports.RECENT_TURN_COUNT * 3;
function formatAssistantHeader(source) {
    if (!source) {
        return 'Assistant:';
    }
    if (source === 'web_search_only') {
        return 'Assistant (source: web_search_only, unverified):';
    }
    return `Assistant (source: ${source}):`;
}
function groupMessagesIntoTurns(messages) {
    const turns = [];
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
function formatConversationTurn(turnNumber, turn) {
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
function countConversationTurns(messages) {
    if (!messages.length) {
        return 0;
    }
    return groupMessagesIntoTurns(messages).length;
}
function takeLastConversationTurns(messages, turnCount) {
    if (!messages.length || turnCount <= 0) {
        return [];
    }
    const recentTurns = groupMessagesIntoTurns(messages).slice(-turnCount);
    const result = [];
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
function formatNumberedTurnHistory(messages) {
    if (!messages.length) {
        return '';
    }
    return groupMessagesIntoTurns(messages)
        .map((turn, index) => formatConversationTurn(index + 1, turn))
        .join('\n\n')
        .trim();
}
function buildNumberedTurnHistorySection(messages) {
    const historyText = formatNumberedTurnHistory(messages);
    if (!historyText) {
        return '';
    }
    return `${historyText}\n`;
}
function needsSummarization(totalMessageCount, lastSummarizedMessageCount) {
    return (totalMessageCount - lastSummarizedMessageCount >=
        exports.SUMMARY_UPDATE_MESSAGE_THRESHOLD);
}
function formatChatMessages(messages) {
    return messages
        .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
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
function stripSourceCitationsFromHistory(content) {
    return content.replace(/\s*\[Source:\s*[^\]]+\]/gi, '').trim();
}
function toChatMessagesFromPaginatedHistory(records) {
    return records.map((message) => {
        const role = message.messageType === 'assistant'
            ? 'assistant'
            : 'user';
        const source = message.sourceInfo ?? message.source_info;
        const cleanContent = stripSourceCitationsFromHistory(message.messageContent ?? '');
        return {
            role,
            content: cleanContent,
            ...(source ? { source } : {}),
        };
    });
}
function buildRecentHistoryText(messages) {
    return formatChatMessages(messages);
}
function buildSummarySection(conversationSummary) {
    const summary = conversationSummary?.trim();
    if (!summary) {
        return '';
    }
    return `Conversation Summary:\n${summary}\n`;
}
function buildRecentConversationSection(messages) {
    if (!messages.length) {
        return '';
    }
    return `Recent Conversation:\n${formatChatMessages(messages)}\n`;
}
function buildCombinedHistoryText(conversationSummary, recentMessages) {
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
function buildConversationMemory(summary, recentMessages) {
    const normalizedSummary = summary?.trim() || undefined;
    const recentHistoryText = buildRecentHistoryText(recentMessages);
    return {
        summary: normalizedSummary,
        recentMessages,
        recentHistoryText,
    };
}
//# sourceMappingURL=conversation-history.util.js.map