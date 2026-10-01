import { Injectable } from '@nestjs/common';
import { ChunkResult } from '../types/chat.interface';
import { PromptTemplateService } from './prompt-template.service';
import { classifyQueryIntent } from './query-intent-classifier';

export interface BuildPromptOptions {
  /** When false, Scenario C (parametric general knowledge) is suppressed. */
  allowGeneralKnowledge?: boolean;
}

const SCENARIO_C_ENABLED_RULE =
  '- **Scenario C (General Knowledge Query Override):** Only if the user explicitly asks a general, non-case-specific legal question (e.g., "What is Section 270A of the Income Tax Act?"), you may answer using your general knowledge. In this case, do NOT use citations, and clearly append: *"Note: This information is based on general legal knowledge and is not derived from the provided case documents."*';

const SCENARIO_C_DISABLED_RULE =
  '- **Scenario C (Disabled — documents lack topical coverage):** Do NOT answer from general legal knowledge or parametric training. If the answer is not in the provided documents, you MUST use Scenario B only.';

@Injectable()
export class PromptBuilderService {
  constructor(
    private readonly promptTemplateService: PromptTemplateService,
  ) {}

  public async buildPrompt(
    question: string,
    chunks: ChunkResult[],
    documentChats: any[],
    chatHistory?: string,
    caseId?: string,
    clientId?: string,
    options?: BuildPromptOptions,
  ): Promise<string> {
    const allowGeneralKnowledge = options?.allowGeneralKnowledge ?? true;
    const queryIntent = await classifyQueryIntent(question);
    const answerStyleInstructions =
  queryIntent === 'FACT_LOOKUP'
    ? `- MODE: FACT_LOOKUP (Extremely concise, verbatim extraction).
- CRITICAL: Provide ONLY direct, literal extractions. DO NOT add legal interpretation, commentary, or context.
- FORMAT: Return information in short, crisp bullet points. Keep each bullet under 15 words.
- LATENCY: Start directly with the extracted facts. No introductory or trailing filler text.`
    : `- MODE: LEGAL REASONING (High-density analytical synthesis).
- STRUCTURE: Present a clear, step-by-step application of the legal provision or rule to the case facts.
- SYNTHESIS: Synthesize across relevant passages, explicitly highlighting exceptions, conditions, and key nuances.
- CITATIONS: Every analytical step or legal assertion must be backed by an exact source citation.
- STYLE: Avoid verbose prose. Maintain a formal, high-density, precise legal tone.`;

    // Create a map of documentId to document name for quick lookup
    const documentMap = new Map<string, string>();
    documentChats.forEach((dc: any) => {
      if (dc.Document && dc.Document.originalName) {
        documentMap.set(dc.documentId, dc.Document.originalName);
      }
    });

    // Build context from chunks with document names
    // Filter out chunks without valid documentIds to avoid "Unknown Document"
    const validChunks = chunks.filter((chunk) => {
      // Only include chunks that have a documentId and it exists in documentMap
      return chunk.documentId && documentMap.has(chunk.documentId);
    });

    const contextParts = validChunks
      .map((chunk) => {
        const documentName = documentMap.get(chunk.documentId);
        // At this point, documentName should always exist due to filtering above
        if (!documentName) {
          // Fallback: skip this chunk if somehow documentName is still missing
          return null;
        }
        return `[Source: ${documentName}]\n${chunk.content}`;
      })
      .filter((part) => part !== null);

    const context = contextParts.join('\n\n---\n\n');

    // Build context information for legal cases (optional, like Python)
    let caseContext = '';
    if (caseId && clientId) {
      caseContext = `\nThis query is related to Case ID: ${caseId} and Client ID: ${clientId}.`;
    }

    // Build chat history context (summary + recent conversation)
    let historyContext = '';
    if (chatHistory) {
      historyContext = `
${chatHistory}

Current question: ${question}
`;
    }

    // Build prompt matching Python's exact structure
    const prompt = `
    You are a helpful legal assistant. Answer the following question based on the provided context from legal documents and any previous conversation history.
    If the answer is not in the context, clearly say that the documents do not contain the answer.
    Do not speculate or fabricate information beyond the provided context.
  **RESPONSE LENGTH RULES (HIGH PRIORITY):**
  1. If the user specifies a word limit (example: "in 50 words", "within 100 words", "summarize in 75 words"), you MUST strictly follow it.
  2. The response MUST NOT exceed the requested word limit.
  
    CRITICAL: 
    1. The user's question may be in any language.
    2. By default, always respond in **English**, regardless of the language used in the question or knowledge base.
    3. Only respond in another language **if the user explicitly requests it**, for example:
    - "Answer in Hindi"
    - "Respond in Gujarati"
    - "Give the output in Kannada"
    4. The knowledge base content can be in any language — translate or interpret it as needed to produce a clear, fluent English answer unless instructed otherwise.
    5. Whenever you mention dates, convert them to and display them in **DD-MM-YYYY** format (e.g., 05-09-2025) regardless of how they appear in the sources.
    
    **MANDATORY CITATION REQUIREMENTS:**
    1. After EVERY point, fact, or piece of information you mention, you MUST add a citation in the following format:
       [Source: document_name.pdf]
    
    2. If a point comes from multiple documents, list all sources separated by commas:
       [Source: document1.pdf, document2.pdf]
    
    3. Use the EXACT document names provided in the context (they appear as [Source: ...] before each chunk).
    
    4. Citation format examples:
       - For bullet points:
         • Point content here.
           [Source: document_name.pdf]
       
       - For numbered lists:
         1. Point content here.
            [Source: document_name.pdf]
       
       - For paragraphs:
         Paragraph content here. [Source: document_name.pdf]
    5. DO NOT skip citations. Every substantive point must have a source reference.
    
    6. If information comes from your general knowledge (not from the provided context), do not add a citation, but clearly state that it's not from the documents.
    
    **CRITICAL: AVOID REDUNDANCY AND UNNECESSARY INFORMATION:**
    - DO NOT provide information that the user has NOT asked for.
    - DO NOT repeat background facts (PAN, business description, filing history) unless directly relevant to the current question.
    - DO NOT explain the entire scheme or law unless explicitly asked.
    - DO NOT restate information from previous conversation unless necessary for context.
    - Answer ONLY what is asked - if the question is specific, provide a specific answer without adding extra context.
    - If the answer would be lengthy, provide key points and add a brief **Conclusion: ...** at the end.
    - Use bullet points or numbered lists for clarity when presenting multiple items.
    - Prioritize the most relevant information and strictly avoid redundancy.
 
    ${caseContext}
    Context from legal documents:
    ${context}

    ${historyContext || `Question: ${question}`}
    
    Answer:
    `;

    return this.promptTemplateService.renderTemplate(
      'legal-answer-generation.txt',
      {
        caseContext,
        context,
        questionOrHistoryContext: historyContext || `Question: ${question}`,
        answerStyleInstructions,
        scenarioCRule: allowGeneralKnowledge
          ? SCENARIO_C_ENABLED_RULE
          : SCENARIO_C_DISABLED_RULE,
      },
    );
  }
}
