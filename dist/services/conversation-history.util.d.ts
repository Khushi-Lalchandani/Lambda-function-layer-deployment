import { ChatMessage, ConversationMemory } from '../types/chat.interface';
export declare const SUMMARY_UPDATE_MESSAGE_THRESHOLD = 10;
export declare const RECENT_TURN_COUNT = 6;
/** Raw messages fetched from DB before slicing to the last N turns. */
export declare const RECENT_MESSAGE_FETCH_LIMIT: number;
export declare function countConversationTurns(messages: ChatMessage[]): number;
export declare function takeLastConversationTurns(messages: ChatMessage[], turnCount: number): ChatMessage[];
export declare function formatNumberedTurnHistory(messages: ChatMessage[]): string;
export declare function buildNumberedTurnHistorySection(messages: ChatMessage[]): string;
export declare function needsSummarization(totalMessageCount: number, lastSummarizedMessageCount: number): boolean;
export declare function formatChatMessages(messages: ChatMessage[]): string;
/** Removes document citation tags from stored chat text before LLM history context. */
export declare function stripSourceCitationsFromHistory(content: string): string;
export declare function toChatMessagesFromPaginatedHistory(records: any[]): ChatMessage[];
export declare function buildRecentHistoryText(messages: ChatMessage[]): string;
export declare function buildSummarySection(conversationSummary?: string | null): string;
export declare function buildRecentConversationSection(messages: ChatMessage[]): string;
export declare function buildCombinedHistoryText(conversationSummary: string | null | undefined, recentMessages: ChatMessage[]): string;
export declare function buildConversationMemory(summary: string | null | undefined, recentMessages: ChatMessage[]): ConversationMemory;
//# sourceMappingURL=conversation-history.util.d.ts.map