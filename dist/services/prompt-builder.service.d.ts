import { ChunkResult } from '../types/chat.interface';
import { PromptTemplateService } from './prompt-template.service';
export interface BuildPromptOptions {
    /** When false, Scenario C (parametric general knowledge) is suppressed. */
    allowGeneralKnowledge?: boolean;
}
export declare class PromptBuilderService {
    private readonly promptTemplateService;
    constructor(promptTemplateService: PromptTemplateService);
    buildPrompt(question: string, chunks: ChunkResult[], documentChats: any[], chatHistory?: string, caseId?: string, clientId?: string, options?: BuildPromptOptions): Promise<string>;
}
//# sourceMappingURL=prompt-builder.service.d.ts.map