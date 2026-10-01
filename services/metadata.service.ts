import { Injectable, Logger } from '@nestjs/common';
import { getLlmGateway } from './llm-gateway.service';
import { GEMINI_3_5_FLASH_LITE, GEMINI_3_1_FLASH_LITE } from './llm-model.constants';
import { BackendService } from './backend.service';
import { AnswerRefinementService } from './answer-refinement.service';
import { PromptTemplateService } from './prompt-template.service';
import {
  CHRONOLOGY_INTENT_PATTERN,
  isGeneralCaseSummaryQuery,
  resolveChronologyScope,
} from './chronology-query.util';

@Injectable()
export class MetadataService {
  private readonly logger = new Logger(MetadataService.name);
  private readonly llm = getLlmGateway();

  constructor(
    private readonly backendService: BackendService,
    private readonly answerRefinementService: AnswerRefinementService,
    private readonly promptTemplateService: PromptTemplateService,
  ) {}

  public async buildMetadataContext(documentChats: any[]): Promise<string> {
    let metadataContext = '\n\nAvailable case metadata:\n';
    if (!documentChats.length) {
      return '\n\nNo documents found for this case. The case appears to be empty.';
    }
    for (let i = 0; i < documentChats.length; i++) {
      const docChat = documentChats[i];
      const document = docChat.Document;
      const metadata = document.documentMetaData[0];
      metadataContext += `\n--- File ${i + 1}: ${document.originalName} ---\n`;
      metadataContext += `Document Type: ${
        metadata?.document_type || metadata?.document_category || 'Unknown'
      }\n`;
      metadataContext += `Document Category: ${
        metadata?.document_category || 'Unknown'
      }\n`;
      metadataContext += `Document Date: ${
        metadata?.document_date || 'Unknown'
      }\n`;
      metadataContext += `Parties: ${
        metadata?.parties?.join(', ') || 'Unknown'
      }\n`;
      metadataContext += `Main Issues: ${
        metadata?.main_issues?.join(', ') || 'Unknown'
      }\n`;
      metadataContext += `Sections Mentioned: ${
        metadata?.sections_mentioned?.join(', ') || 'Unknown'
      }\n`;
      metadataContext += `Court Name: ${metadata?.court_name || 'Unknown'}\n`;
      metadataContext += `Case Number: ${metadata?.case_number || 'Unknown'}\n`;
      metadataContext += `Summary: ${this.extractReadableSummary(metadata?.summary)}\n`;

      // NOTE: Date-wise events are NOT included in general metadata context
      // They are only included when explicitly requested via chronological queries

      metadataContext += `Uploaded At: ${
        document.createdAt?.toISOString() || 'Unknown'
      }\n`;
    }
    return metadataContext;
  }

  public buildDeterministicDocumentClassification(documentChats: any[]): string {
    if (!documentChats.length) {
      return 'No documents found for this case.';
    }

    const sections = documentChats.map((docChat, index) => {
      const document = docChat.Document;
      const metadata = document?.documentMetaData?.[0];
      const name = document?.originalName ?? 'Unknown';
      const docType = metadata?.document_type ?? 'Unknown';
      const category = metadata?.document_category ?? 'Unknown';
      const date = metadata?.document_date ?? 'Unknown';
      const parties = metadata?.parties?.join(', ') ?? 'Unknown';
      const summary = this.extractReadableSummary(metadata?.summary);
      const summaryLine =
        summary && summary !== 'Unknown'
          ? `\n   - Summary: ${summary}`
          : '';

      return `${index + 1}. **${name}**\n   - Document Type: ${docType}\n   - Category: ${category}\n   - Date: ${date}\n   - Parties: ${parties}${summaryLine} [Source: ${name}]`;
    });

    return `Classification of all ${documentChats.length} document(s) in this case:\n\n${sections.join('\n\n')}`;
  }

  private normalizeClassificationCitations(answer: string): string {
    return answer
      .replace(/\[Source:\s*`([^`]+)`\s*\]/gi, '[Source: $1]')
      .replace(/\[Source:\s*"([^"]+)"\s*\]/gi, '[Source: $1]')
      .replace(/\[Source:\s*'([^']+)'\s*\]/gi, '[Source: $1]');
  }

  private classificationCoversAllDocuments(
    answer: string,
    documentChats: any[],
  ): boolean {
    const answerLower = answer.toLowerCase();
    return documentChats.every((docChat) => {
      const name = docChat.Document?.originalName;
      return typeof name === 'string' && name.length > 0
        ? answerLower.includes(name.toLowerCase())
        : false;
    });
  }

  public async getDocumentClassificationAnswer(
    documentChats: any[],
    specificDocumentId?: string,
    chatHistory?: string,
  ): Promise<string> {
    let filteredDocumentChats = documentChats;
    if (specificDocumentId) {
      const specificDocChat = documentChats.find(
        (dc) => dc.documentId === specificDocumentId,
      );
      if (specificDocChat) {
        filteredDocumentChats = [specificDocChat];
      } else {
        return `No file found for document ID ${specificDocumentId}`;
      }
    }

    if (!filteredDocumentChats.length) {
      return 'No documents found for this case.';
    }

    const totalCount = filteredDocumentChats.length;
    const metadataText = await this.buildMetadataContext(filteredDocumentChats);
    const historySection = chatHistory
      ? `\nPrevious conversation context:\n${chatHistory}\n`
      : '';

    try {
      const prompt = this.promptTemplateService.renderTemplate(
        'document-classification.txt',
        {
          historySection,
          metadataText,
          totalDocumentCount: String(totalCount),
        },
      );

      const result = await this.llm.generateContent({
        model: GEMINI_3_5_FLASH_LITE,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          temperature: 0.1,
          topP: 0.95,
        },
      });

      const rawAnswer = this.extractTextFromGeminiResponse(result);
      const normalizedAnswer = rawAnswer?.trim()
        ? this.normalizeClassificationCitations(rawAnswer.trim())
        : '';
      if (
        normalizedAnswer &&
        this.classificationCoversAllDocuments(
          normalizedAnswer,
          filteredDocumentChats,
        )
      ) {
        return normalizedAnswer;
      }

      if (rawAnswer?.trim()) {
        this.logger.warn(
          `Document classification LLM omitted some files (expected ${totalCount}); using deterministic fallback`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Document classification LLM failed: ${error?.message ?? error}`,
      );
    }

    return this.buildDeterministicDocumentClassification(filteredDocumentChats);
  }

  /**
   * Fetches and formats chat history for a case and client, similar to Python's get_latest_chat_context.
   * Returns formatted string with "User: ..." and "Assistant: ..." format.
   */
  private async getLatestChatContext(
    caseId: string,
    clientId: string,
    limit: number = 10,
    sessionId?: string,
  ): Promise<string> {
    try {
      // Note: This method is used for metadata context
      // Since we don't have direct access to all chats for a case via REST API,
      // we'll use the chat history from the current chat
      // The chat history is already provided in the chat object from getChatForAI
      // So this method may not be called, but if it is, return empty or use provided chatHistory

      // For now, return empty string as chat history context is typically
      // provided from the main query processor via the chat object
      return '';
    } catch (error) {
      return '';
    }
  }

  /**
   * Builds the chronological timeline table from document metadata.
   * Returns null when no timeline events are available.
   */
  public async getChronologicalTimelineAnswer(
    documentChats: any[],
    specificDocumentId?: string,
    queryType?: string,
    query?: string,
    caseId?: string,
    clientId?: string,
    chatHistory?: string,
  ): Promise<string | null> {
    let filteredDocumentChats = documentChats;
    if (specificDocumentId) {
      const specificDocChat = documentChats.find(
        (dc) => dc.documentId === specificDocumentId,
      );
      if (!specificDocChat) {
        return null;
      }
      filteredDocumentChats = [specificDocChat];
    }
    if (!filteredDocumentChats.length) {
      return null;
    }

    const isGeneralCaseSummary = query
      ? isGeneralCaseSummaryQuery(query)
      : false;
    const isChronologicalQuery =
      !isGeneralCaseSummary &&
      (queryType === 'chronological' ||
        (query ? CHRONOLOGY_INTENT_PATTERN.test(query) : false));

    if (!isChronologicalQuery || !query?.trim()) {
      return null;
    }

    const flattenedChronologicalEvents = await this.collectChronologicalEvents(
      filteredDocumentChats,
      query,
    );

    if (!flattenedChronologicalEvents.length) {
      return null;
    }

    const historySection = chatHistory
      ? `\nPrevious conversation context:\n${chatHistory}\n`
      : '';

    return this.generateRelevantChronologyAnswer(
      query,
      flattenedChronologicalEvents,
    );
  }

  public async getMetadataSearchAnswer(
    query: string,
    caseId: string,
    clientId: string,
    documentChats: any[],
    specificDocumentId?: string,
    queryType?: string,
    sessionId?: string,
    chatHistory?: string,
  ): Promise<string> {
    const startTime = Date.now();
    try {
      let filteredDocumentChats = documentChats;
      if (specificDocumentId) {
        const specificDocChat = documentChats.find(
          (dc) => dc.documentId === specificDocumentId,
        );
        if (specificDocChat) {
          filteredDocumentChats = [specificDocChat];
        } else {
          return `No file found for document ID ${specificDocumentId}`;
        }
      }
      if (!filteredDocumentChats.length) {
        return `No documents found for case ${caseId} and client ${clientId}.`;
      }
      const contextStartTime = Date.now();
      const metadataText = await this.buildMetadataContext(
        filteredDocumentChats,
      );
      this.logger.log(
        `[PROCESS] getMetadataSearchAnswer buildMetadataContext completed in ${Date.now() - contextStartTime}ms`,
      );

      // Pull latest chat history context (up to 10 messages) - like Python does
      let chatContext = '';
      if (chatHistory) {
        // Use provided chat history if available
        chatContext = chatHistory;
      } else {
        // Fetch chat history by caseId and clientId (like Python)
        try {
          chatContext = await this.getLatestChatContext(
            caseId,
            clientId,
            10,
            sessionId,
          );
        } catch (error) {
          chatContext = '';
        }
      }

      const historySection = chatContext
        ? `\nPrevious conversation context:\n${chatContext}\n`
        : '';

      // Check if this is a chronological query
      // Only detect if explicitly asking for chronological/timeline information
      // IMPORTANT: Exclude general case summary queries like "tell me about this case"
      const isGeneralCaseSummary = isGeneralCaseSummaryQuery(query);
      const isChronologicalQuery =
        !isGeneralCaseSummary &&
        (queryType === 'chronological' ||
          CHRONOLOGY_INTENT_PATTERN.test(query));

      let hasDateWiseEvents = false;
      if (isChronologicalQuery) {
        const chronologyStartTime = Date.now();
        const flattenedChronologicalEvents =
          await this.collectChronologicalEvents(filteredDocumentChats, query);
        this.logger.log(
          `[PROCESS] getMetadataSearchAnswer collectChronologicalEvents completed in ${Date.now() - chronologyStartTime}ms`,
        );
        hasDateWiseEvents = flattenedChronologicalEvents.length > 0;

        if (hasDateWiseEvents) {
          return this.generateRelevantChronologyAnswer(
            query,
            flattenedChronologicalEvents,
          );
        }
      }

      const chronologicalContext =
        isChronologicalQuery && !hasDateWiseEvents
          ? `

NOTE: The user is asking about chronological information, but no date-wise events were found in the metadata.
Inform the user clearly and directly that chronological event information is not available in the documents. Do not create empty tables or placeholder content.
`
          : '';

      const chronologicalInstruction = isChronologicalQuery && !hasDateWiseEvents
    ? '7. CRITICAL: No legally material dates or chronological events exist in the provided source text. Inform the user directly that chronological event data is unavailable in these files rather than summarizing general background text.'
    : '7. IMPORTANT: The user is asking a direct question, not requesting a case history timeline. Focus entirely on answering the specific question asked using the most relevant contextual facts.';
      const prompt = this.promptTemplateService.renderTemplate(
        'metadata-answer.txt',
        {
          caseId,
          clientId,
          historySection,
          query,
          chronologicalContext,
          metadataText,
          chronologicalInstruction,
        },
      );

      const llmStartTime = Date.now();
      const result = await this.llm.generateContent({
        model: GEMINI_3_5_FLASH_LITE,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          temperature:0.1,
          topP: 0.95,
        },
      });
      this.logger.log(
        `[PROCESS] getMetadataSearchAnswer metadataLlm (${GEMINI_3_5_FLASH_LITE}) completed in ${Date.now() - llmStartTime}ms`,
      );

      // Extract raw answer using robust extraction method
      const rawAnswer = this.extractTextFromGeminiResponse(result) || '';
      this.logger.log(
        `[PROCESS] getMetadataSearchAnswer completed in ${Date.now() - startTime}ms with query="${query}"`,
      );

      if (!rawAnswer || !rawAnswer.trim()) {
        this.logger.warn('Empty response from Gemini API for metadata query');
        return `I couldn't generate a response for your query. Please try rephrasing your question or contact support if the issue persists.`;
      }

      // Return raw answer - refinement will be done at the end of the pipeline
      return rawAnswer;
    } catch (error) {
      this.logger.error(
        `Error generating metadata answer: ${error.message}`,
        error.stack,
      );
      return `Unable to retrieve metadata information due to a temporary API issue (Error: ${error.message}). Please try again later or contact support if the issue persists.`;
    }
  }

  /**
   * Robustly extracts text from Gemini API response, handling all response formats
   * This matches the Python implementation's robust extraction
   */
  private extractTextFromGeminiResponse(response: any): string {
    try {
      // Handle function-based text property (most common)
      if (typeof response.text === 'function') {
        const text = response.text();
        return typeof text === 'string' ? text.trim() : String(text).trim();
      }

      // Handle direct text property
      if (response && typeof response.text === 'string') {
        return response.text.trim();
      }

      // Handle Gemini response format with candidates
      if (
        response &&
        typeof response === 'object' &&
        'candidates' in response
      ) {
        const candidates = response.candidates;
        if (Array.isArray(candidates) && candidates.length > 0) {
          const candidate = candidates[0];
          if (candidate && 'content' in candidate) {
            const content = candidate.content;
            if (content && 'parts' in content && Array.isArray(content.parts)) {
              const textParts: string[] = [];
              for (const part of content.parts) {
                if (part && typeof part === 'object' && 'text' in part) {
                  textParts.push(part.text);
                } else if (typeof part === 'string') {
                  textParts.push(part);
                }
              }
              return textParts.join('').trim();
            } else if (typeof content === 'string') {
              return content.trim();
            } else if (content && 'text' in content) {
              return String(content.text).trim();
            }
          }
        }
      }

      // Handle direct content property
      if (response && typeof response === 'object' && 'content' in response) {
        if (typeof response.content === 'string') {
          return response.content.trim();
        }
        if (
          response.content &&
          typeof response.content === 'object' &&
          'parts' in response.content
        ) {
          const parts = response.content.parts;
          if (Array.isArray(parts)) {
            const textParts: string[] = [];
            for (const part of parts) {
              if (part && typeof part === 'object' && 'text' in part) {
                textParts.push(part.text);
              } else if (typeof part === 'string') {
                textParts.push(part);
              }
            }
            return textParts.join('').trim();
          }
        }
      }

      // Try to extract from response object directly
      if (response && typeof response === 'object') {
        // Check for nested text properties
        if ('response' in response && response.response) {
          const extracted = this.extractTextFromGeminiResponse(
            response.response,
          );
          if (extracted) return extracted;
        }
        if ('data' in response && response.data) {
          const extracted = this.extractTextFromGeminiResponse(response.data);
          if (extracted) return extracted;
        }
      }

      // Fallback: try to stringify and extract (but avoid [object Object])
      const responseStr = String(response);
      if (
        responseStr &&
        responseStr !== '[object Object]' &&
        responseStr.length > 0
      ) {
        return responseStr.trim();
      }

      this.logger.warn('Could not extract text from Gemini response', {
        responseType: typeof response,
        hasText: 'text' in response,
        hasCandidates: 'candidates' in response,
        hasContent: 'content' in response,
      });

      return '';
    } catch (error) {
      this.logger.error(
        `Error extracting text from Gemini response: ${error.message}`,
        error.stack,
      );
      return '';
    }
  }

  private extractReadableSummary(summary: string | null | undefined): string {
    const raw = (summary ?? '').trim();
    if (!raw) {
      return 'No summary available';
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed !== 'object' || parsed === null) {
        return raw;
      }

      const textFields = [
        parsed.summary,
        parsed.document_summary,
        parsed.overview,
        parsed.text,
      ];
      for (const field of textFields) {
        if (typeof field === 'string' && field.trim().length > 0) {
          return field.trim();
        }
      }

      return 'No summary available';
    } catch {
      return raw;
    }
  }

  private async collectChronologicalEvents(
    filteredDocumentChats: any[],
    query?: string,
  ): Promise<ChronologicalEvent[]> {
    const allEvents: Array<{
      date: string | null;
      event_description: string;
      file_name: string;
    }> = [];

    for (const docChat of filteredDocumentChats) {
      const document = docChat.Document;
      const metadata = document.documentMetaData[0];
      let dateWiseEvents: any[] | null = null;

      if (metadata?.date_wise_events) {
        try {
          let parsedEvents = metadata.date_wise_events;

          if (typeof parsedEvents === 'string') {
            try {
              parsedEvents = JSON.parse(parsedEvents);
            } catch (parseError) {
              this.logger.warn(
                `Failed to parse date_wise_events as JSON string: ${parseError}`,
              );
              parsedEvents = null;
            }
          }

          if (parsedEvents) {
            if (Array.isArray(parsedEvents)) {
              dateWiseEvents = parsedEvents as any[];
            } else if (
              typeof parsedEvents === 'object' &&
              parsedEvents !== null
            ) {
              dateWiseEvents = [parsedEvents as any];
            }
          }
        } catch (e) {
          this.logger.warn(`Error parsing date_wise_events: ${e}`);
        }
      }

      if (!dateWiseEvents && metadata?.summary) {
        try {
          const summaryData = JSON.parse(metadata.summary);
          if (
            summaryData.date_wise_events_full &&
            Array.isArray(summaryData.date_wise_events_full)
          ) {
            dateWiseEvents = summaryData.date_wise_events_full;
          } else if (
            summaryData.date_wise_events &&
            Array.isArray(summaryData.date_wise_events)
          ) {
            dateWiseEvents = summaryData.date_wise_events;
          }
        } catch {
          // Not JSON or doesn't contain date_wise_events, ignore
        }
      }

      if (
        dateWiseEvents &&
        Array.isArray(dateWiseEvents) &&
        dateWiseEvents.length > 0
      ) {
        for (const event of dateWiseEvents) {
          allEvents.push(
            this.normalizeFuzzyChronologyEvent({
              date: event.date || null,
              event_description: event.event_description || '',
              file_name: document.originalName || 'Unknown',
            }),
          );
        }
      }
    }

    if (!allEvents.length) {
      return [];
    }

    const scope = query ? resolveChronologyScope(query) : 'full';
    const processedChronologicalEvents =
      await this.prepareChronologicalEventsForTimeline(allEvents, query, scope);

    return this.sortChronologicalEventsAsc(processedChronologicalEvents);
  }

  private buildChronologicalTimeline(events: ChronologicalEvent[]): string {
    if (!events.length) {
      return 'No chronological events could be extracted from the provided documents.';
    }

    let markdown =
      'Below is the chronological sequence of events extracted from the document, arranged from the earliest to the most recent. Each entry includes a source citation for your reference.\n\n';

    markdown += '| Date | Event Description |\n';
    markdown += '| :--- | :--- |\n';

    for (const event of events) {
      const displayDate = this.sanitizeTableText(event.date ?? 'Undated');
      const cleanDescription = this.sanitizeTableText(
        event.event_description ?? '',
      );
      const sourceFiles = event.source_files ?? [];
      const citations =
        sourceFiles.length > 0
          ? ` [Source: ${sourceFiles
              .map((fileName) => this.sanitizeTableText(fileName))
              .join(', ')}]`
          : '';

      markdown += `| ${displayDate} | ${cleanDescription}${citations} |\n`;
    }

    markdown +=
      '\nPlease let me know if you need further details or assistance with this case chronology.';
    return markdown;
  }

  private async generateRelevantChronologyAnswer(
    query: string,
    events: ChronologicalEvent[],
  ): Promise<string> {
    const relevantEvents = this.filterRelevantChronologicalEvents(events);
    const finalEvents = this.sortChronologicalEventsAsc(
      relevantEvents.length ? relevantEvents : events,
    );

    this.logger.log(
      `[PROCESS] generateRelevantChronologyAnswer: timeline built from single curation pass with ${events.length} events for query="${query}"`,
    );

    return this.buildChronologicalTimeline(finalEvents);
  }

  private async prepareChronologicalEventsForTimeline(
    events: ChronologicalEvent[],
    query?: string,
    scope: 'full' | 'scoped' = 'full',
  ): Promise<ChronologicalEvent[]> {
    const deduplicatedEvents = this.deduplicateChronologicalEvents(events);
    return this.curateChronologicalEventsWithLLM(
      deduplicatedEvents,
      query,
      scope,
    );
  }

  private async curateChronologicalEventsWithLLM(
    events: ChronologicalEvent[],
    query?: string,
    scope: 'full' | 'scoped' = 'full',
  ): Promise<ChronologicalEvent[]> {
    if (!events.length) {
      return events;
    }

    const prompt = this.promptTemplateService.renderTemplate(
      'chronological-events-curation.txt',
      {
        userQuery: query?.trim() ?? 'Give me the case chronology',
        scope,
        eventsJson: JSON.stringify(
          events.map((event) => ({
            date: event.date,
            event_description: event.event_description,
            source_files: event.source_files ?? [event.file_name],
          })),
        ),
      },
    );

    try {
      const result = await this.llm.generateContent({
        model: 'gemini-3.1-flash-lite', // Extremely fast and highly cost-effective
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          temperature: 0,
          topP: 0.95,
          topK: 40,
          responseMimeType: 'application/json', // Keep this, but without the slow responseSchema
        },
      });

      const rawText = this.extractTextFromGeminiResponse(result) ?? '';
      const parsed = JSON.parse(rawText) as {
        curated_events?: Array<{
          date: string | null;
          event_description: string;
          source_files: string[];
        }>;
      };

      const curatedEvents = (parsed?.curated_events ?? [])
        .map((event) => {
          const sourceFiles = Array.from(
            new Set((event?.source_files ?? []).filter((file) => !!file?.trim())),
          );
          return {
            date: event?.date ?? null,
            event_description: (event?.event_description ?? '').trim(),
            file_name: sourceFiles[0] ?? 'Unknown',
            source_files: sourceFiles,
          } as ChronologicalEvent;
        })
        .filter(
          (event) =>
            !!event.event_description &&
            event.event_description.length >= 8 &&
            (event.source_files?.length ?? 0) > 0,
        );

      if (!curatedEvents.length) {
        this.logger.warn(
          'LLM chronological curation returned no events; falling back to rule-based output',
        );
        return this.sortChronologicalEventsAsc(
          this.filterRelevantChronologicalEvents(events),
        );
      }

      return this.sortChronologicalEventsAsc(curatedEvents);
    } catch (error) {
      this.logger.warn(
        `LLM chronological curation failed, falling back to rule-based output: ${error?.message ?? error}`,
      );
      return this.sortChronologicalEventsAsc(
        this.filterRelevantChronologicalEvents(
          this.deduplicateChronologicalEvents(events),
        ),
      );
    }
  }

  private filterRelevantChronologicalEvents(
    events: ChronologicalEvent[],
  ): ChronologicalEvent[] {
    const nonMaterialKeywords = [
      'uploaded',
      'upload',
      'downloaded',
      'download',
      'generated',
      'draft saved',
      'internal note',
      'reminder',
      'system update',
      'status update',
      'acknowledged',
      'acknowledgement',
      'forwarded',
      'shared',
      'received copy',
    ];

    return events.filter((event) => {
      const description = (event.event_description ?? '').trim();
      if (description.length < 8) {
        return false;
      }

      const normalizedDescription = description.toLowerCase();
      const hasNonMaterialKeyword = nonMaterialKeywords.some((keyword) =>
        normalizedDescription.includes(keyword),
      );
      if (hasNonMaterialKeyword) {
        return false;
      }

      // Trust chronology extraction + curation prompts for relevance decisions.
      // Keep only lightweight sanity and anti-noise guards here.
      return true;
    });
  }

  private deduplicateChronologicalEvents(
    events: ChronologicalEvent[],
  ): ChronologicalEvent[] {
    const deduplicatedEvents = new Map<string, ChronologicalEvent>();

    for (const event of events) {
      const normalizedDescription = this.normalizeEventDescription(
        event.event_description,
      );
      if (!normalizedDescription) {
        continue;
      }

      const existingEvent = deduplicatedEvents.get(normalizedDescription);
      if (!existingEvent) {
        deduplicatedEvents.set(normalizedDescription, {
          ...event,
          source_files: [event.file_name],
        });
        continue;
      }

      const mergedSources = new Set<string>([
        ...(existingEvent.source_files ?? [existingEvent.file_name]),
        event.file_name,
      ]);
      const bestDate = this.chooseMoreUsefulDate(existingEvent.date, event.date);

      deduplicatedEvents.set(normalizedDescription, {
        ...existingEvent,
        date: bestDate,
        source_files: Array.from(mergedSources),
      });
    }

    return Array.from(deduplicatedEvents.values());
  }

  private normalizeEventDescription(description: string): string {
    return (description ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private chooseMoreUsefulDate(
    existingDate: string | null,
    candidateDate: string | null,
  ): string | null {
    if (existingDate && candidateDate) {
      const existingTimestamp = this.parseChronologyDateToTimestamp(existingDate);
      const candidateTimestamp = this.parseChronologyDateToTimestamp(candidateDate);
      if (existingTimestamp !== null && candidateTimestamp !== null) {
        return existingTimestamp <= candidateTimestamp
          ? existingDate
          : candidateDate;
      }
      return existingDate;
    }
    return existingDate ?? candidateDate ?? null;
  }

  private parseChronologyDateToTimestamp(date: string | null): number | null {
    const trimmed = date?.trim();
    if (!trimmed) {
      return null;
    }

    const ddMmYyyy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
    if (ddMmYyyy) {
      const [, day, month, year] = ddMmYyyy;
      const timestamp = Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
      );
      return Number.isNaN(timestamp) ? null : timestamp;
    }

    if (/^\d{4}$/.test(trimmed)) {
      const timestamp = Date.UTC(Number(trimmed), 0, 1);
      return Number.isNaN(timestamp) ? null : timestamp;
    }

    const mmYyyy = /^(\d{2})-(\d{4})$/.exec(trimmed);
    if (mmYyyy) {
      const [, month, year] = mmYyyy;
      const timestamp = Date.UTC(Number(year), Number(month) - 1, 1);
      return Number.isNaN(timestamp) ? null : timestamp;
    }

    return null;
  }

  private sortChronologicalEventsAsc(
    events: ChronologicalEvent[],
  ): ChronologicalEvent[] {
    return [...events].sort((a, b) => {
      const timestampA = this.parseChronologyDateToTimestamp(a.date);
      const timestampB = this.parseChronologyDateToTimestamp(b.date);

      if (timestampA === null && timestampB === null) {
        return 0;
      }
      if (timestampA === null) {
        return 1;
      }
      if (timestampB === null) {
        return -1;
      }

      return timestampA - timestampB;
    });
  }

  private normalizeFuzzyChronologyEvent(
    event: ChronologicalEvent,
  ): ChronologicalEvent {
    let date = event.date?.trim() ?? null;
    let description = (event.event_description ?? '').trim();
    const hasDateQualifierPrefix = /^\[(Year|Approx\.|DISCREPANCY|CONFLICT)/i.test(
      description,
    );

    if (!date) {
      return { ...event, event_description: description };
    }

    if (/^\d{4}$/.test(date)) {
      const year = date;
      date = `01-01-${year}`;
      if (!hasDateQualifierPrefix) {
        description = `[Year ${year}] ${description}`;
      }
      return { ...event, date, event_description: description };
    }

    const monthYearMatch = /^(\d{2})-(\d{4})$/.exec(date);
    if (monthYearMatch) {
      const [, month, year] = monthYearMatch;
      date = `01-${month}-${year}`;
      if (!hasDateQualifierPrefix) {
        const monthName = this.getChronologyMonthName(Number(month));
        description = `[Approx. ${monthName} ${year}] ${description}`;
      }
      return { ...event, date, event_description: description };
    }

    return { ...event, date, event_description: description };
  }

  private getChronologyMonthName(month: number): string {
    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    return monthNames[month - 1] ?? `Month ${month}`;
  }

  private sanitizeTableText(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
  }
}

type ChronologicalEvent = {
  date: string | null;
  event_description: string;
  file_name: string;
  source_files?: string[];
};
