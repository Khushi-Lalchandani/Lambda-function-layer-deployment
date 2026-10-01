import { PromptTemplateService } from './prompt-template.service';
export interface WebSearchQueryOptimizationResult {
    originalWebQuery: string;
    optimizedQuery: string;
    optimizationApplied: boolean;
}
export declare class WebSearchQueryOptimizerService {
    private readonly promptTemplateService;
    private readonly logger;
    private readonly llm;
    constructor(promptTemplateService: PromptTemplateService);
    optimizeWebSearchQuery(query: string): Promise<WebSearchQueryOptimizationResult>;
    private unchanged;
    private parseOptimizerResponse;
    private extractResponseText;
}
//# sourceMappingURL=web-search-query-optimizer.service.d.ts.map