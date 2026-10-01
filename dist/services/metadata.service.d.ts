import { BackendService } from './backend.service';
import { AnswerRefinementService } from './answer-refinement.service';
import { PromptTemplateService } from './prompt-template.service';
export declare class MetadataService {
    private readonly backendService;
    private readonly answerRefinementService;
    private readonly promptTemplateService;
    private readonly logger;
    private readonly llm;
    constructor(backendService: BackendService, answerRefinementService: AnswerRefinementService, promptTemplateService: PromptTemplateService);
    buildMetadataContext(documentChats: any[]): Promise<string>;
    buildDeterministicDocumentClassification(documentChats: any[]): string;
    private normalizeClassificationCitations;
    private classificationCoversAllDocuments;
    getDocumentClassificationAnswer(documentChats: any[], specificDocumentId?: string, chatHistory?: string): Promise<string>;
    /**
     * Fetches and formats chat history for a case and client, similar to Python's get_latest_chat_context.
     * Returns formatted string with "User: ..." and "Assistant: ..." format.
     */
    private getLatestChatContext;
    /**
     * Builds the chronological timeline table from document metadata.
     * Returns null when no timeline events are available.
     */
    getChronologicalTimelineAnswer(documentChats: any[], specificDocumentId?: string, queryType?: string, query?: string, caseId?: string, clientId?: string, chatHistory?: string): Promise<string | null>;
    getMetadataSearchAnswer(query: string, caseId: string, clientId: string, documentChats: any[], specificDocumentId?: string, queryType?: string, sessionId?: string, chatHistory?: string): Promise<string>;
    /**
     * Robustly extracts text from Gemini API response, handling all response formats
     * This matches the Python implementation's robust extraction
     */
    private extractTextFromGeminiResponse;
    private extractReadableSummary;
    private collectChronologicalEvents;
    private buildChronologicalTimeline;
    private generateRelevantChronologyAnswer;
    private prepareChronologicalEventsForTimeline;
    private curateChronologicalEventsWithLLM;
    private filterRelevantChronologicalEvents;
    private deduplicateChronologicalEvents;
    private normalizeEventDescription;
    private chooseMoreUsefulDate;
    private parseChronologyDateToTimestamp;
    private sortChronologicalEventsAsc;
    private normalizeFuzzyChronologyEvent;
    private getChronologyMonthName;
    private sanitizeTableText;
}
//# sourceMappingURL=metadata.service.d.ts.map