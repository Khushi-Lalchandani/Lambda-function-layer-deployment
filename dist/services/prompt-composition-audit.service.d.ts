import { PromptBreakdownInput } from './gemini-prompt-breakdown';
export type PromptComponent = 'system_prompt' | 'history' | 'retrieval' | 'query';
export interface RetrievalChunkAudit {
    source_document?: string;
    characters: number;
    tokens_estimated: number;
    content_preview: string;
    content_hash: string;
}
export interface PromptCompositionAnalysis {
    request_id: string;
    conversation_id?: string;
    model: string;
    system_prompt: {
        characters: number;
        tokens_estimated: number;
    };
    history: {
        messages_count: number;
        characters: number;
        tokens_estimated: number;
    };
    retrieval: {
        retrieved_documents_count: number;
        retrieved_chunks_count: number;
        characters: number;
        tokens_estimated: number;
        average_chunk_tokens: number;
        largest_chunk_tokens: number;
        duplicate_chunks_count: number;
        top_contributing_chunks: Array<{
            source_document?: string;
            tokens_estimated: number;
            characters: number;
            content_preview: string;
            is_duplicate: boolean;
        }>;
    };
    query: {
        characters: number;
        tokens_estimated: number;
    };
    totals: {
        total_estimated_tokens: number;
        actual_input_tokens_from_vertex?: number;
        estimation_error_percent?: number;
    };
    composition_percentages: {
        system_prompt_percentage: number;
        retrieval_percentage: number;
        history_percentage: number;
        query_percentage: number;
    };
    largest_component: PromptComponent;
    largest_component_tokens: number;
}
export interface PromptCompositionAuditLogPayload {
    event: 'prompt_composition_audit';
    timestamp: string;
    request_id: string;
    conversation_id?: string;
    model: string;
    system_prompt_characters: number;
    system_prompt_tokens_estimated: number;
    history_messages_count: number;
    history_characters: number;
    history_tokens_estimated: number;
    retrieved_documents_count: number;
    retrieved_chunks_count: number;
    retrieval_characters: number;
    retrieval_tokens_estimated: number;
    average_chunk_tokens: number;
    largest_chunk_tokens: number;
    duplicate_chunks_count: number;
    query_characters: number;
    query_tokens_estimated: number;
    total_estimated_tokens: number;
    actual_input_tokens_from_vertex?: number;
    estimation_error_percent?: number;
    system_prompt_percentage: number;
    retrieval_percentage: number;
    history_percentage: number;
    query_percentage: number;
    largest_component: PromptComponent;
    largest_component_tokens: number;
    top_contributing_chunks: PromptCompositionAnalysis['retrieval']['top_contributing_chunks'];
}
export interface PromptCompositionSnapshotPayload {
    event: 'prompt_composition_snapshot';
    timestamp: string;
    request_id: string;
    conversation_id?: string;
    model: string;
    largest_component: PromptComponent;
    largest_component_tokens: number;
    token_percentages: PromptCompositionAnalysis['composition_percentages'];
    actual_input_tokens_from_vertex: number;
    top_contributing_chunks: PromptCompositionAnalysis['retrieval']['top_contributing_chunks'];
}
export interface PromptTokenSourceReport {
    request_count: number;
    system_prompt_percentage: number;
    retrieval_percentage: number;
    history_percentage: number;
    query_percentage: number;
    where_are_tokens_coming_from: string;
}
export interface PromptCompositionAuditReport {
    generated_at: string;
    request_count: number;
    token_source_report: PromptTokenSourceReport;
    high_token_requests: Array<{
        request_id: string;
        model: string;
        actual_input_tokens_from_vertex: number;
        largest_component: PromptComponent;
        retrieval_percentage: number;
        system_prompt_percentage: number;
        duplicate_chunks_count: number;
    }>;
    retrieval_misclassification_signals: Array<{
        request_id: string;
        signal: string;
        actual_input_tokens_from_vertex: number;
        system_prompt_percentage: number;
        retrieval_percentage: number;
    }>;
}
export declare function getPromptCompositionAuditService(): PromptCompositionAuditService;
export declare function resetPromptCompositionAuditService(): void;
export declare function isPromptAuditEnabled(): boolean;
export declare class PromptCompositionAuditService {
    private readonly audits;
    private readonly debugSnapshots;
    analyzeRequest(input: {
        requestId: string;
        conversationId?: string;
        model: string;
        params: PromptBreakdownInput;
    }): PromptCompositionAnalysis;
    recordAudit(analysis: PromptCompositionAnalysis, actualInputTokens?: number): void;
    logCompositionAudit(analysis: PromptCompositionAnalysis): void;
    getTokenSourceReport(): PromptTokenSourceReport;
    buildAuditReport(): PromptCompositionAuditReport;
    getLargestRequestSnapshots(): PromptCompositionSnapshotPayload[];
    private storeAudit;
    private maybeCaptureDebugSnapshot;
}
//# sourceMappingURL=prompt-composition-audit.service.d.ts.map