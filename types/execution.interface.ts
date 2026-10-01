import { ChatMessage, QueryRewriteIntent } from './chat.interface';
import { ExecutionCapability } from './planner.interface';

export type { ExecutionCapability };

export interface ExecutionNode {
  id: string;
  capability: ExecutionCapability;
  query: string;
  reason?: string;
  subQuery?: string;
  dependencies: string[];
}

export interface ExecutionGraph {
  originalQuery: string;
  nodes: ExecutionNode[];
  decomposed: boolean;
}

export interface CaseMetadata {
  caseName?: string;
  clientName?: string;
  documentChats?: any[];
}

export interface ExecutionContext {
  userId: string;
  caseId?: string;
  clientId?: string;
  caseName?: string;
  clientName?: string;
  history: ChatMessage[];
  metadata?: CaseMetadata;
  documentChats?: any[];
  fileName?: string;
  sessionId?: string;
  webSearchEnabled: boolean;
  chatHistoryContext?: string;
  emitPartial?: (partial: any) => void;
  chunks?: any[];
  precomputedSufficiency?: {
    sufficiency: 'YES' | 'PARTIAL' | 'NO';
    reason: string;
    missingInfo?: string;
  };
  isLegal?: boolean;
  hybridOrigin?: 'probe_redirect';
  /** From query rewrite layer — e.g. bare assent accepting a web-search offer. */
  rewriteIntent?: QueryRewriteIntent;
  /** When true, skip redundant contextual-reference resolution in answer generation. */
  queryHistoryResolved?: boolean;
}

export interface ExecutionResult {
  answer: string;
  strategy?: string;
  references?: any[];
  confidence?: number;
  trace?: ExecutionTrace;
}

export interface ExecutionTrace {
  plannerDecision: ExecutionCapability;
  executor: string;
  sufficiency?: 'YES' | 'PARTIAL' | 'NO' | 'UNSET';
  legalQuery?: boolean;
  finalStrategy: string;
}

export interface ExecutionShadowLog {
  query: string;
  planner_actions: ExecutionCapability[];
  execution_graph: Array<{ capability: ExecutionCapability; query: string }>;
  executor_mapping: string[];
}

export interface ExecutorResult {
  executor: string;
  strategy: string;
  answer: string;
  /** User-facing label for what this result addresses (never an internal executor name). */
  purpose?: string;
}

export interface AggregationSegment {
  purpose: string;
  answer: string;
  strategy: string;
}

export interface AggregatedResponse {
  answer: string;
  strategies: string[];
  executors: string[];
  sections?: string[];
  segments?: AggregationSegment[];
  duplicatesRemoved?: number;
}

export interface OrchestrationResult {
  aggregated: AggregatedResponse;
  finalAnswer: string;
}
