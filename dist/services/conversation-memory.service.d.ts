import { ChatMessage, ConversationMemory } from '../types/chat.interface';
import { BackendService } from './backend.service';
import { PromptTemplateService } from './prompt-template.service';
export declare class ConversationMemoryService {
    private readonly backendService;
    private readonly promptTemplateService;
    private readonly logger;
    private readonly llm;
    constructor(backendService: BackendService, promptTemplateService: PromptTemplateService);
    getConversationMemory(chatId: string): Promise<ConversationMemory>;
    private summarizeAndPersist;
    generateUpdatedSummary(existingSummary: string | null, newMessages: ChatMessage[]): Promise<string>;
}
//# sourceMappingURL=conversation-memory.service.d.ts.map