import { CaseContext, ChatMessage, QueryDecompositionResult } from '../types/chat.interface';
import { PromptTemplateService } from './prompt-template.service';
export declare class QueryDecompositionService {
    private readonly promptTemplateService;
    private readonly logger;
    private readonly llm;
    constructor(promptTemplateService: PromptTemplateService);
    decompose(query: string, conversationHistory?: ChatMessage[], caseContext?: CaseContext): Promise<QueryDecompositionResult>;
    logDecompositionResult(result: QueryDecompositionResult): void;
    mightNeedDecomposition(query: string): boolean;
    private decomposeWithLlm;
    private toDecompositionResult;
    private parseLlmResponse;
    private noDecomposition;
}
//# sourceMappingURL=query-decomposition.service.d.ts.map