/** Shared chronology intent detection for query routing. */
export declare const CHRONOLOGY_INTENT_PATTERN: RegExp;
export declare function hasChronologyIntent(query: string, queryType?: string): boolean;
export declare function isGeneralCaseSummaryQuery(query: string): boolean;
/**
 * True when the user asks ONLY for dates/timeline/chronology (metadata path).
 * Example: "Give me the chronology of the entire case."
 */
export declare function isChronologyOnlyQuery(query: string): boolean;
export declare function hasAdditionalDocumentIntents(query: string): boolean;
/** Full = user wants entire case timeline; scoped = filter to query-relevant events only. */
export declare function resolveChronologyScope(query: string): 'full' | 'scoped';
//# sourceMappingURL=chronology-query.util.d.ts.map