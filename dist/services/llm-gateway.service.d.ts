import { type LlmGenerateContentParams } from './gemini-provider';
export type { LlmGenerateContentParams };
export declare function getLlmGateway(): LlmGatewayService;
export declare function resetLlmGateway(): void;
export declare class LlmGatewayService {
    private readonly logger;
    private readonly gemini;
    private openaiClient;
    private getOpenAI;
    generateContent(params: LlmGenerateContentParams): Promise<any>;
    /**
     * Tries Gemini with params.model first; on failure retries with an explicit OpenAI model.
     */
    generateContentWithExplicitOpenAiFallback(params: LlmGenerateContentParams, openAiFallbackModel: string): Promise<{
        response: unknown;
        modelUsed: string;
        fallbackUsed: boolean;
    }>;
    generateContentOpenAiFirst(params: LlmGenerateContentParams, options?: {
        openAiModel?: string;
        geminiFallbackModel?: string;
    }): Promise<any>;
    private generateWithOpenAI;
    private buildOpenAiMessages;
    private isInvalidResponse;
    private extractText;
    private describeError;
}
//# sourceMappingURL=llm-gateway.service.d.ts.map