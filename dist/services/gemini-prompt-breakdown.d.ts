export interface GeminiPromptBreakdown {
    system_prompt_tokens: number;
    history_tokens: number;
    retrieval_tokens: number;
    query_tokens: number;
}
export interface PromptBreakdownMonitoringContext {
    prompt_breakdown?: Partial<GeminiPromptBreakdown>;
}
export interface PromptBreakdownInput {
    contents: string | Array<{
        role?: string;
        parts?: Array<{
            text?: string;
        }>;
    }>;
    config?: {
        systemInstruction?: string;
        [key: string]: unknown;
    };
    monitoring?: PromptBreakdownMonitoringContext;
}
export declare function extractPromptBreakdown(params: PromptBreakdownInput, actualPromptTokens?: number): GeminiPromptBreakdown;
//# sourceMappingURL=gemini-prompt-breakdown.d.ts.map