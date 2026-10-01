import { CaseContext, ChatMessage, QueryRewriteResult } from '../types/chat.interface';
import { PromptTemplateService } from './prompt-template.service';
export declare class QueryRewriteService {
    private readonly promptTemplateService;
    private readonly logger;
    private readonly llm;
    constructor(promptTemplateService: PromptTemplateService);
    rewrite(query: string, conversationHistory?: ChatMessage[], _caseContext?: CaseContext): Promise<QueryRewriteResult>;
    logRewriteResult(result: QueryRewriteResult, conversationHistory?: ChatMessage[]): void;
    private buildHistoryContext;
    private logRewriteOutcome;
    private rewriteWithLlm;
    private parseLlmResponse;
    private hasUnresolvedReference;
    private isBareProximityQuery;
    private citesAnchorTurn;
    private validateBareAssentRewrite;
    private noRewrite;
}
//# sourceMappingURL=query-rewrite.service.d.ts.map