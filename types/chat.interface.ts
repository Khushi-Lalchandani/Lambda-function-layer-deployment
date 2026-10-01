export type AssistantAnswerSource =
  | 'vector_search_only'
  | 'vector_search + web_search'
  | 'web_search_only'
  | 'document_insufficient'
  | 'no_results'
  | 'error';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  source?: AssistantAnswerSource;
}

export interface CaseContext {
  caseName?: string;
  clientName?: string;
  documentChats?: any[];
  conversationSummary?: string;
}

export interface ConversationMemory {
  summary?: string;
  recentMessages: ChatMessage[];
  recentHistoryText: string;
}

export interface ConversationMemoryState {
  conversationSummary: string | null;
  lastSummarizedMessageCount: number;
  totalMessageCount: number;
}

export interface ConversationContext {
  conversationSummary: string | null;
  recentMessages: ChatMessage[];
  recentHistoryText: string;
  combinedHistoryText: string;
}

export type QueryRewriteIntent = 'accept_web_search_offer';

export interface QueryRewriteResult {
  originalQuery: string;
  rewrittenQuery: string;
  wasRewritten: boolean;
  rewriteReason?: string;
  /** True when the rewrite layer consumed conversation history to resolve references. */
  historyUsed?: boolean;
  /** Set when bare assent accepts a prior offer (e.g. search outside documents). */
  intent?: QueryRewriteIntent;
}

export interface QueryDecompositionResult {
  originalQuery: string;
  shouldDecompose: boolean;
  subQueries: string[];
  decompositionReason?: string;
}

export interface ChunkResult {
  id: string;
  content: string;
  documentId: string;
  similarity?: number;
  bm25Score?: number;
  rerankScore?: number;
}

export interface UnifiedQueryAnalysis {
  original_query: string;
  enhanced_query: string;
  needs_document_context: boolean;
  query_type: 'factual' | 'analytical' | 'procedural' | 'greeting' | 'metadata' | 'chronological';
  strategy: 'vector' | 'metadata' | 'conservative' | 'greeting' | 'web_search' | 'vector + web_search';
  confidence: number;
  reasoning: string;
}