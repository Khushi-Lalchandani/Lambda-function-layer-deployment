import { PromptTemplateService } from './prompt-template.service';
interface ExtractedMarkdownTable {
    content: string;
    originalContent: string;
    dataRowCount: number;
}
export declare class AnswerRefinementService {
    private readonly promptTemplateService;
    private readonly logger;
    private readonly llm;
    constructor(promptTemplateService: PromptTemplateService);
    refineAnswerForDisplay(answer: string, query?: string): Promise<string>;
    /** Populated markdown tables are extracted before LLM refinement and restored verbatim after. */
    extractPopulatedMarkdownTables(text: string): ExtractedMarkdownTable[];
    private replaceTablesWithPlaceholders;
    private isMetadataChronologyAnswer;
    private finalizeAnswerForDisplay;
    /**
     * Drops filler meta headings the LLM invents (e.g. "## Brief introduction").
     * Content under the heading is kept.
     */
    stripAwkwardMetaHeadings(answer: string): string;
    /**
     * Deterministic markdown polish for answers the LLM left as plain section dumps
     * (common for web_search / judgment lists). Does not invent facts.
     */
    ensureStructuralMarkdown(answer: string): string;
    /** Removes populated markdown tables — used to drop LLM-hallucinated tables before restore. */
    private stripMarkdownTablesFromText;
    private restorePreservedTables;
    private isMarkdownTableRow;
    private parseMarkdownTableRowCells;
    private getMarkdownTableColumnCount;
    private isMarkdownTableSeparatorRow;
    private isMarkdownTableDataRow;
    private buildStandardSeparatorRow;
    private normalizeTableRow;
    private normalizeMarkdownTable;
    private normalizeAllMarkdownTablesInText;
    /**
     * Detects refined answers that introduce facts absent from the original —
     * new source citations, legal section refs, or significant numbers/dates.
     */
    private refinedAnswerIntroducesUnsupportedFacts;
    /** Section keys without parenthetical suffixes — "section 148a(d)" → "148a". */
    private extractLegalSectionKeys;
    /**
     * Allow refined "Section 148" when original already cites 148A / 148A(d), etc.
     * Still rejects entirely new section numbers (e.g. 270A when absent from original).
     */
    private sectionKeyIsSupported;
    /** Individual document names inside [Source: ...] blocks (comma-separated lists are split). */
    private extractSourceCitationParts;
    private extractSignificantNumbers;
    /**
     * Extracts text from OpenAI API response
     */
    private extractTextFromResponse;
    private removeEmptyTables;
    /**
     * Removes chunk number references from the answer text
     * This ensures that invalid citations like [Source: Chunk 1] or "Document Sources: [Chunk 1, 2, 15]" are removed
     */
    private removeChunkReferences;
    /**
     * Cleans up unnecessary whitespace and newlines for better frontend display
     */
    private cleanWhitespace;
}
export {};
//# sourceMappingURL=answer-refinement.service.d.ts.map