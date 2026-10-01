import { Injectable, Logger } from '@nestjs/common';
import { getLlmGateway } from './llm-gateway.service';
import {
  GEMINI_3_5_FLASH_LITE,
  GPT_5_MINI,
} from './llm-model.constants';
import { isChronologyOnlyQuery } from './chronology-query.util';
import { PromptTemplateService } from './prompt-template.service';
import { recordTiming } from './request-observability';

const PRESERVED_TABLE_PLACEHOLDER_PREFIX = '<<<PRESERVED_TABLE_';
const PRESERVED_TABLE_PLACEHOLDER_SUFFIX = '>>>';

interface ExtractedMarkdownTable {
  content: string;
  originalContent: string;
  dataRowCount: number;
}

const REFINEMENT_OPENAI_MODEL = GPT_5_MINI;
const REFINEMENT_GEMINI_FALLBACK_MODEL = GEMINI_3_5_FLASH_LITE;

@Injectable()
export class AnswerRefinementService {
  private readonly logger = new Logger(AnswerRefinementService.name);
  private readonly llm = getLlmGateway();
  constructor(
    private readonly promptTemplateService: PromptTemplateService,
  ) {}

  async refineAnswerForDisplay(
    answer: string,
    query?: string,
  ): Promise<string> {
    const refinementStartTime = Date.now();
    if (!answer || !answer.trim()) {
      return answer;
    }

    this.logger.log(
      `[AnswerRefinement] Starting refinement | query: ${query ?? 'not provided'} | answerLength: ${answer.length}`,
    );

    try {
      const preservedTables = this.extractPopulatedMarkdownTables(answer);

      if (
        query &&
        isChronologyOnlyQuery(query) &&
        this.isMetadataChronologyAnswer(answer, preservedTables)
      ) {
        this.logger.log(
          '[AnswerRefinement] Skipping LLM refinement for metadata chronology answer',
        );
        return this.finalizeAnswerForDisplay(answer);
      }

      const { answerWithPlaceholders, placeholders } =
        this.replaceTablesWithPlaceholders(answer, preservedTables);

      const refinementPrompt = this.promptTemplateService.renderTemplate(
        'answer-refinement.txt',
        {
          query: query?.trim() || 'Not provided',
          answer: answerWithPlaceholders,
        },
      );

      const response = await this.llm.generateContentOpenAiFirst(
        {
          model: REFINEMENT_GEMINI_FALLBACK_MODEL,
          contents: [{ role: 'user', parts: [{ text: refinementPrompt }] }],
          config: {
            reasoning_effort: 'low',
          },
        },
        {
          openAiModel: REFINEMENT_OPENAI_MODEL,
          geminiFallbackModel: REFINEMENT_GEMINI_FALLBACK_MODEL,
        },
      );

      let refinedAnswer = this.extractTextFromResponse(response) || '';

      // Fallback to original if refinement fails or returns empty — still structure it
      if (!refinedAnswer) {
        return this.finalizeAnswerForDisplay(answer);
      }

      if (preservedTables.length > 0) {
        refinedAnswer = this.stripMarkdownTablesFromText(refinedAnswer);
      }

      refinedAnswer = this.restorePreservedTables(
        refinedAnswer,
        placeholders,
        preservedTables,
      );

      if (this.refinedAnswerIntroducesUnsupportedFacts(answer, refinedAnswer)) {
        this.logger.warn(
          '[AnswerRefinement] Rejecting refined answer — unsupported facts detected; using original',
        );
        return this.finalizeAnswerForDisplay(answer);
      }

      this.logger.log(
        `[AnswerRefinement] Completed refinement in ${Date.now() - refinementStartTime}ms`,
      );
      recordTiming('refinementMs', Date.now() - refinementStartTime);
      return this.finalizeAnswerForDisplay(refinedAnswer);
    } catch (error) {
      this.logger.error(`Error refining answer for display: ${error.message}`);
      // Return original answer if refinement fails — still apply structural markdown
      return this.finalizeAnswerForDisplay(answer);
    }
  }

  /** Populated markdown tables are extracted before LLM refinement and restored verbatim after. */
  extractPopulatedMarkdownTables(text: string): ExtractedMarkdownTable[] {
    if (!text?.includes('|')) {
      return [];
    }

    const lines = text.split('\n');
    const tables: ExtractedMarkdownTable[] = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (!this.isMarkdownTableRow(line)) {
        index++;
        continue;
      }

      const tableStart = index;
      const tableLines: string[] = [];
      let dataRowCount = 0;
      let isHeaderRow = true;

      while (index < lines.length) {
        const currentLine = lines[index];
        const trimmedLine = currentLine.trim();

        if (!trimmedLine.includes('|') || !this.isMarkdownTableRow(trimmedLine)) {
          break;
        }

        if (isHeaderRow) {
          tableLines.push(currentLine);
          isHeaderRow = false;
          index++;
          continue;
        }

        if (this.isMarkdownTableSeparatorRow(trimmedLine)) {
          tableLines.push(currentLine);
          index++;
          continue;
        }

        if (this.isMarkdownTableDataRow(trimmedLine)) {
          dataRowCount++;
          tableLines.push(currentLine);
          index++;
          continue;
        }

        break;
      }

      if (dataRowCount > 0 && tableLines.length >= 2) {
        const originalContent = tableLines.join('\n');
        tables.push({
          content: this.normalizeMarkdownTable(originalContent),
          originalContent,
          dataRowCount,
        });
        continue;
      }

      index = Math.max(index, tableStart + 1);
    }

    return tables;
  }

  private replaceTablesWithPlaceholders(
    answer: string,
    tables: ExtractedMarkdownTable[],
  ): { answerWithPlaceholders: string; placeholders: string[] } {
    if (tables.length === 0) {
      return { answerWithPlaceholders: answer, placeholders: [] };
    }

    let answerWithPlaceholders = answer;
    const placeholders: string[] = [];

    tables.forEach((table, tableIndex) => {
      const placeholder = `${PRESERVED_TABLE_PLACEHOLDER_PREFIX}${tableIndex}${PRESERVED_TABLE_PLACEHOLDER_SUFFIX}`;
      placeholders.push(placeholder);
      answerWithPlaceholders = answerWithPlaceholders.replace(
        table.originalContent,
        placeholder,
      );
    });

    return { answerWithPlaceholders, placeholders };
  }

  private isMetadataChronologyAnswer(
    answer: string,
    tables: ExtractedMarkdownTable[],
  ): boolean {
    if (tables.length !== 1) {
      return false;
    }

    const table = tables[0];
    if (
      !table.content.includes('Date') ||
      !table.content.includes('Event Description')
    ) {
      return false;
    }

    return (
      answer.includes('Below is the chronological sequence') ||
      answer.includes(
        'chronological sequence of events extracted from the document',
      ) ||
      answer.includes('Please let me know if you need further details')
    );
  }

  private finalizeAnswerForDisplay(answer: string): string {
    let finalized = answer;
    finalized = this.removeEmptyTables(finalized);
    finalized = this.normalizeAllMarkdownTablesInText(finalized);
    finalized = this.removeChunkReferences(finalized);
    finalized = this.ensureStructuralMarkdown(finalized);
    finalized = this.stripAwkwardMetaHeadings(finalized);
    finalized = this.cleanWhitespace(finalized);
    return finalized;
  }

  /**
   * Drops filler meta headings the LLM invents (e.g. "## Brief introduction").
   * Content under the heading is kept.
   */
  stripAwkwardMetaHeadings(answer: string): string {
    if (!answer?.trim()) {
      return answer;
    }

    const awkwardHeading =
      /^(#{1,6}\s*)?(Brief\s+(?:introduction|intro|answer|response|overview|summary)|Introduction|Answer|Response|Overview|Key\s+points|Notes|Relevant\s+document\s+excerpt|Document\s+excerpt)\s*:?\s*$/i;

    return answer
      .split('\n')
      .filter((line) => !awkwardHeading.test(line.trim()))
      .join('\n');
  }

  /**
   * Deterministic markdown polish for answers the LLM left as plain section dumps
   * (common for web_search / judgment lists). Does not invent facts.
   */
  ensureStructuralMarkdown(answer: string): string {
    if (!answer?.trim()) {
      return answer;
    }

    const awkwardPlainTitle =
      /^(Brief\s+(?:introduction|intro|answer|response|overview|summary)|Introduction|Answer|Response|Overview|Key\s+points|Notes|Relevant\s+document\s+excerpt|Document\s+excerpt)$/i;

    const lines = answer.split('\n');
    const outputLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('|') || trimmed.startsWith('[')) {
        outputLines.push(line);
        continue;
      }

      if (/^#{1,6}\s+\S/.test(trimmed)) {
        outputLines.push(line);
        continue;
      }

      // Plain section title: "Relevant Judicial Precedents:" → ## heading
      const sectionTitleMatch = trimmed.match(
        /^([A-Z][A-Za-z0-9][^:\n]{1,90}):\s*$/,
      );
      if (sectionTitleMatch && !/^\d+[\.\)]\s/.test(trimmed)) {
        const title = sectionTitleMatch[1].trim();
        // Skip converting awkward meta labels into headings — strip later
        if (awkwardPlainTitle.test(title)) {
          continue;
        }
        outputLines.push(`## ${title}`);
        continue;
      }

      // Numbered case/precedent lines: "1. Name vs. Name (Court): Holding..."
      const numberedCaseMatch = trimmed.match(
        /^(\d+)[\.\)]\s+([^:]{5,120}?)\s*:\s+(.+)$/,
      );
      if (
        numberedCaseMatch &&
        /\b(vs\.?|v\.|versus)\b/i.test(numberedCaseMatch[2]) &&
        /\([^)]*(?:High Court|Supreme Court|Court|Tribunal|ITAT|NCLT|Bench)[^)]*\)/i.test(
          numberedCaseMatch[2],
        )
      ) {
        outputLines.push(
          `${numberedCaseMatch[1]}. **${numberedCaseMatch[2].trim()}:** ${numberedCaseMatch[3].trim()}`,
        );
        continue;
      }

      // Star bullets with a label: "*  Application of Mind: ..."
      const starLabelMatch = trimmed.match(/^\*\s+([^:]{2,60}):\s*(.*)$/);
      if (starLabelMatch) {
        const remainder = starLabelMatch[2]?.trim() ?? '';
        outputLines.push(
          remainder
            ? `- **${starLabelMatch[1].trim()}:** ${remainder}`
            : `- **${starLabelMatch[1].trim()}:**`,
        );
        continue;
      }

      outputLines.push(line);
    }

    return outputLines.join('\n');
  }

  /** Removes populated markdown tables — used to drop LLM-hallucinated tables before restore. */
  private stripMarkdownTablesFromText(text: string): string {
    if (!text?.includes('|')) {
      return text;
    }

    const lines = text.split('\n');
    const outputLines: string[] = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (!this.isMarkdownTableRow(line)) {
        outputLines.push(line);
        index++;
        continue;
      }

      const tableStart = index;
      const tableLines: string[] = [];
      let dataRowCount = 0;
      let isHeaderRow = true;

      while (index < lines.length) {
        const currentLine = lines[index];
        const trimmedLine = currentLine.trim();

        if (
          !trimmedLine.includes('|') ||
          !this.isMarkdownTableRow(trimmedLine)
        ) {
          break;
        }

        if (isHeaderRow) {
          tableLines.push(currentLine);
          isHeaderRow = false;
          index++;
          continue;
        }

        if (this.isMarkdownTableSeparatorRow(trimmedLine)) {
          tableLines.push(currentLine);
          index++;
          continue;
        }

        if (this.isMarkdownTableDataRow(trimmedLine)) {
          dataRowCount++;
          tableLines.push(currentLine);
          index++;
          continue;
        }

        break;
      }

      if (dataRowCount > 0 && tableLines.length >= 2) {
        continue;
      }

      outputLines.push(lines[tableStart]);
      index = tableStart + 1;
    }

    return outputLines.join('\n');
  }

  private restorePreservedTables(
    refinedAnswer: string,
    placeholders: string[],
    tables: ExtractedMarkdownTable[],
  ): string {
    if (tables.length === 0) {
      return refinedAnswer;
    }

    let restoredAnswer = refinedAnswer;

    placeholders.forEach((placeholder, tableIndex) => {
      const tableContent = tables[tableIndex]?.content ?? '';
      if (!tableContent) {
        return;
      }

      if (restoredAnswer.includes(placeholder)) {
        restoredAnswer = restoredAnswer.replace(placeholder, tableContent);
        return;
      }

      this.logger.warn(
        `[AnswerRefinement] Missing placeholder ${placeholder}; appending preserved table`,
      );
      restoredAnswer = `${restoredAnswer.trim()}\n\n${tableContent}`;
    });

    return restoredAnswer;
  }

  private isMarkdownTableRow(line: string): boolean {
    const pipeMatches = line.match(/\|/g);
    return Boolean(line.includes('|') && pipeMatches && pipeMatches.length >= 2);
  }

  private parseMarkdownTableRowCells(line: string): string[] {
    const trimmedLine = line.trim();
    const withoutLeadingPipe = trimmedLine.startsWith('|')
      ? trimmedLine.slice(1)
      : trimmedLine;
    const withoutTrailingPipe = withoutLeadingPipe.endsWith('|')
      ? withoutLeadingPipe.slice(0, -1)
      : withoutLeadingPipe;

    return withoutTrailingPipe.split('|').map((cell) => cell.trim());
  }

  private getMarkdownTableColumnCount(headerLine: string): number {
    return this.parseMarkdownTableRowCells(headerLine).filter(
      (cell) => cell.length > 0,
    ).length;
  }

  private isMarkdownTableSeparatorRow(line: string): boolean {
    if (!line.includes('|')) {
      return false;
    }

    const cells = this.parseMarkdownTableRowCells(line);
    if (cells.length === 0) {
      return false;
    }

    return cells.every(
      (cell) => cell.length === 0 || /^:?-{1,}:?$/.test(cell),
    );
  }

  private isMarkdownTableDataRow(line: string): boolean {
    if (this.isMarkdownTableSeparatorRow(line)) {
      return false;
    }

    const cells = this.parseMarkdownTableRowCells(line);
    return cells.some((cell) => {
      const cleaned = cell.replace(/[\s-|:]/g, '');
      return cleaned.length > 0;
    });
  }

  private buildStandardSeparatorRow(columnCount: number): string {
    const cells = Array.from({ length: columnCount }, () => '---');
    return `| ${cells.join(' | ')} |`;
  }

  private normalizeTableRow(line: string, columnCount: number): string {
    const cells = this.parseMarkdownTableRowCells(line);

    while (cells.length < columnCount) {
      cells.push('');
    }

    if (cells.length > columnCount) {
      const overflow = cells.splice(columnCount - 1);
      cells.push(overflow.join(' | '));
    }

    return `| ${cells.join(' | ')} |`;
  }

  private normalizeMarkdownTable(tableContent: string): string {
    const lines = tableContent
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      return tableContent;
    }

    const columnCount = this.getMarkdownTableColumnCount(lines[0]);
    if (columnCount === 0) {
      return tableContent;
    }

    const normalizedLines: string[] = [
      this.normalizeTableRow(lines[0], columnCount),
    ];
    let dataStartIndex = 1;

    if (lines.length > 1 && this.isMarkdownTableSeparatorRow(lines[1])) {
      normalizedLines.push(this.buildStandardSeparatorRow(columnCount));
      dataStartIndex = 2;
    }

    for (let index = dataStartIndex; index < lines.length; index++) {
      const line = lines[index];
      if (!this.isMarkdownTableRow(line)) {
        break;
      }

      if (this.isMarkdownTableSeparatorRow(line)) {
        continue;
      }

      if (this.isMarkdownTableDataRow(line)) {
        normalizedLines.push(this.normalizeTableRow(line, columnCount));
      }
    }

    return normalizedLines.join('\n');
  }

  private normalizeAllMarkdownTablesInText(text: string): string {
    if (!text?.includes('|')) {
      return text;
    }

    const lines = text.split('\n');
    const processedLines: string[] = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];

      if (!this.isMarkdownTableRow(line)) {
        processedLines.push(line);
        index++;
        continue;
      }

      const tableStart = index;
      const tableLines: string[] = [];
      let dataRowCount = 0;
      let isHeaderRow = true;

      while (index < lines.length) {
        const currentLine = lines[index];
        const trimmedLine = currentLine.trim();

        if (!trimmedLine.includes('|') || !this.isMarkdownTableRow(trimmedLine)) {
          break;
        }

        if (isHeaderRow) {
          tableLines.push(currentLine);
          isHeaderRow = false;
          index++;
          continue;
        }

        if (this.isMarkdownTableSeparatorRow(trimmedLine)) {
          tableLines.push(currentLine);
          index++;
          continue;
        }

        if (this.isMarkdownTableDataRow(trimmedLine)) {
          dataRowCount++;
          tableLines.push(currentLine);
          index++;
          continue;
        }

        break;
      }

      if (dataRowCount > 0 && tableLines.length >= 2) {
        processedLines.push(
          this.normalizeMarkdownTable(tableLines.join('\n')),
        );
        continue;
      }

      processedLines.push(lines[tableStart]);
      index = tableStart + 1;
    }

    return processedLines.join('\n');
  }

  /**
   * Detects refined answers that introduce facts absent from the original —
   * new source citations, legal section refs, or significant numbers/dates.
   */
  private refinedAnswerIntroducesUnsupportedFacts(
    originalAnswer: string,
    refinedAnswer: string,
  ): boolean {
    const originalCitationParts = this.extractSourceCitationParts(originalAnswer);
    const refinedCitationParts = this.extractSourceCitationParts(refinedAnswer);

    for (const citation of refinedCitationParts) {
      if (!originalCitationParts.has(citation)) {
        this.logger.warn(
          `[AnswerRefinement] Unsupported source citation in refined answer: ${citation}`,
        );
        return true;
      }
    }

    const originalSections = this.extractLegalSectionKeys(originalAnswer);
    const refinedSections = this.extractLegalSectionKeys(refinedAnswer);

    for (const section of refinedSections) {
      if (!this.sectionKeyIsSupported(section, originalSections)) {
        this.logger.warn(
          `[AnswerRefinement] Unsupported section reference in refined answer: ${section}`,
        );
        return true;
      }
    }

    const originalNumbers = this.extractSignificantNumbers(originalAnswer);
    const refinedNumbers = this.extractSignificantNumbers(refinedAnswer);

    for (const number of refinedNumbers) {
      if (!originalNumbers.has(number)) {
        this.logger.warn(
          `[AnswerRefinement] Unsupported number/date in refined answer: ${number}`,
        );
        return true;
      }
    }

    return false;
  }

  /** Section keys without parenthetical suffixes — "section 148a(d)" → "148a". */
  private extractLegalSectionKeys(text: string): Set<string> {
    const keys = new Set<string>();
    for (const match of text.matchAll(/\bSection\s+(\d+[A-Za-z]?)/gi)) {
      keys.add(match[1].toLowerCase());
    }
    return keys;
  }

  /**
   * Allow refined "Section 148" when original already cites 148A / 148A(d), etc.
   * Still rejects entirely new section numbers (e.g. 270A when absent from original).
   */
  private sectionKeyIsSupported(
    refinedKey: string,
    originalKeys: Set<string>,
  ): boolean {
    if (originalKeys.has(refinedKey)) {
      return true;
    }
    for (const originalKey of originalKeys) {
      if (
        originalKey.startsWith(refinedKey) ||
        refinedKey.startsWith(originalKey)
      ) {
        return true;
      }
    }
    return false;
  }

  /** Individual document names inside [Source: ...] blocks (comma-separated lists are split). */
  private extractSourceCitationParts(text: string): Set<string> {
    const parts = new Set<string>();

    for (const match of text.matchAll(/\[Source:\s*([^\]]+)\]/gi)) {
      for (const segment of match[1].split(',')) {
        const normalized = segment.trim().toLowerCase();
        if (normalized) {
          parts.add(normalized);
        }
      }
    }

    return parts;
  }

  private extractSignificantNumbers(text: string): Set<string> {
    const withoutCitations = text.replace(/\[Source:[^\]]+\]/gi, '');
    const numbers = new Set<string>();

    for (const match of withoutCitations.matchAll(
      /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g,
    )) {
      // Normalize so DD/MM/YYYY and DD-MM-YYYY compare equal
      numbers.add(match[0].replace(/\//g, '-'));
    }

    for (const match of withoutCitations.matchAll(/\b\d{4,}\b/g)) {
      numbers.add(match[0]);
    }

    for (const match of withoutCitations.matchAll(
      /(?:Rs\.?|INR)\s*[\d,]+(?:\.\d+)?/gi,
    )) {
      numbers.add(match[0].replace(/,/g, '').toLowerCase());
    }

    return numbers;
  }

  /**
   * Extracts text from OpenAI API response
   */
  private extractTextFromResponse(response: unknown): string {
    try {
      const normalizeContent = (value: string): string => {
        const trimmedValue = value.trim();
        if (!trimmedValue) {
          return '';
        }

        try {
          if (
            (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
            (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
          ) {
            return JSON.parse(trimmedValue).trim();
          }
        } catch {
          // Keep original value if quoted JSON parsing fails
        }

        if (trimmedValue.includes('\\n') && !trimmedValue.includes('\n')) {
          return trimmedValue
            .replace(/\\r\\n/g, '\n')
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .trim();
        }

        return trimmedValue;
      };

      const typedResponse = response as {
        text?: string | (() => string);
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
        choices?: Array<{ message?: { content?: string } }>;
        content?: string;
      };

      if (typeof typedResponse?.text === 'function') {
        return normalizeContent(typedResponse.text());
      }

      if (typeof typedResponse?.text === 'string') {
        return normalizeContent(typedResponse.text);
      }

      const geminiText =
        typedResponse?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof geminiText === 'string') {
        return normalizeContent(geminiText);
      }

      const openAiText = typedResponse?.choices?.[0]?.message?.content;
      if (typeof openAiText === 'string') {
        return normalizeContent(openAiText);
      }

      if (typeof typedResponse?.content === 'string') {
        return normalizeContent(typedResponse.content);
      }

      this.logger.warn('Could not extract text from refinement response');
      return '';
    } catch (error) {
      this.logger.error(
        `Error extracting text from refinement response: ${error instanceof Error ? error.message : String(error)}`,
      );
      return '';
    }
  }

  private removeEmptyTables(text: string): string {
    if (!text || !text.includes('|')) {
      return text;
    }

    const lines = text.split('\n');
    const processedLines: string[] = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];

      if (!this.isMarkdownTableRow(line)) {
        processedLines.push(line);
        index++;
        continue;
      }

      const tableStart = index;
      const tableLines: string[] = [];
      let dataRowCount = 0;
      let isHeaderRow = true;

      while (index < lines.length) {
        const currentLine = lines[index];
        const trimmedLine = currentLine.trim();

        if (!trimmedLine.includes('|') || !this.isMarkdownTableRow(trimmedLine)) {
          break;
        }

        if (isHeaderRow) {
          tableLines.push(currentLine);
          isHeaderRow = false;
          index++;
          continue;
        }

        if (this.isMarkdownTableSeparatorRow(trimmedLine)) {
          tableLines.push(currentLine);
          index++;
          continue;
        }

        if (this.isMarkdownTableDataRow(trimmedLine)) {
          dataRowCount++;
          tableLines.push(currentLine);
          index++;
          continue;
        }

        break;
      }

      if (dataRowCount > 0) {
        processedLines.push(...tableLines);
        continue;
      }

      // Drop header-only or header+separator tables (no data rows)
      index = Math.max(index, tableStart + 1);
    }

    return processedLines.join('\n');
  }

  /**
   * Removes chunk number references from the answer text
   * This ensures that invalid citations like [Source: Chunk 1] or "Document Sources: [Chunk 1, 2, 15]" are removed
   */
  private removeChunkReferences(text: string): string {
    if (!text) return text;

    let cleaned = text;

    // Remove citations with chunk references, document numbers, or file numbers
    cleaned = cleaned.replace(/\[Source:\s*Chunk\s+\d+\]/gi, '');
    cleaned = cleaned.replace(/\[Source:\s*Document\s+Chunk\s+\d+\]/gi, '');
    cleaned = cleaned.replace(/\[Source:\s*Document\s+\d+\]/gi, '');
    cleaned = cleaned.replace(/\[Source:\s*File\s+\d+\]/gi, '');
    // Remove "File X, File Y" patterns in citations (multiple files)
    cleaned = cleaned.replace(/\[Source:\s*File\s+\d+(?:\s*,\s*File\s+\d+)*\]/gi, '');

    // Remove "Document Sources: [Chunk X, Y, Z]" patterns
    cleaned = cleaned.replace(/Document\s+Sources?:\s*\[Chunk\s+[\d,\s]+\]/gi, '');
    cleaned = cleaned.replace(/Document\s+Sources?:\s*\[Document\s+Chunk\s+[\d,\s]+\]/gi, '');

    // Remove standalone chunk references in text
    cleaned = cleaned.replace(/\bChunk\s+\d+\b/gi, '');
    cleaned = cleaned.replace(/\bDocument\s+Chunk\s+\d+\b/gi, '');

    // Clean up multiple consecutive newlines that might result from removal
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Trim whitespace
    return cleaned.trim();
  }

  /**
   * Cleans up unnecessary whitespace and newlines for better frontend display
   */
  private cleanWhitespace(text: string): string {
    if (!text) return text;

    let cleaned = text;

    // Remove trailing spaces from each line
    cleaned = cleaned.split('\n').map(line => line.replace(/\s+$/, '')).join('\n');

    // Remove multiple consecutive spaces (more than 2) within lines
    cleaned = cleaned.replace(/[ \t]{3,}/g, '  ');

    // Remove multiple consecutive newlines (more than 2) - keep max 2 newlines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Remove newlines at the very beginning
    cleaned = cleaned.replace(/^\n+/, '');

    // Remove newlines at the very end (but keep one if it's intentional)
    cleaned = cleaned.replace(/\n+$/, '');

    // Remove spaces before newlines
    cleaned = cleaned.replace(/ +\n/g, '\n');

    // Remove newlines before spaces
    cleaned = cleaned.replace(/\n +/g, '\n');

    // Final trim
    return cleaned.trim();
  }
}
  