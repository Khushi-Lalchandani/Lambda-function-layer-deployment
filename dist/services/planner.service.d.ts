import { PlannerComparisonResult, PlannerResult } from '../types/planner.interface';
import { ChatMessage } from '../types/chat.interface';
import { PromptTemplateService } from './prompt-template.service';
export declare class PlannerService {
    private readonly promptTemplateService;
    private readonly logger;
    private openaiClient;
    constructor(promptTemplateService: PromptTemplateService);
    plan(originalQuery: string, subQuery: string, conversationHistory?: ChatMessage[], conversationSummary?: string | null): Promise<PlannerResult>;
    planAll(originalQuery: string, subQueries: string[], conversationHistory?: ChatMessage[], conversationSummary?: string | null): Promise<PlannerResult[]>;
    logPlannerResult(result: PlannerResult): void;
    logPlannerComparison(comparison: PlannerComparisonResult): void;
    buildComparison(query: string, existingStrategy: string, plannerResults: PlannerResult[]): PlannerComparisonResult;
    private getOpenAI;
    private buildMessages;
    private guardBareAssentMisroute;
    private guardScopedSummaryMisroute;
    private parseToolCalls;
    private parseToolArguments;
    private inferConfidence;
    private extractReasoning;
    private emptyPlan;
}
//# sourceMappingURL=planner.service.d.ts.map