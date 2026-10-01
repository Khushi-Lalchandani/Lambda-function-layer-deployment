"use strict";
/** Platform-generated starter questions from the case UI. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePlatformStarterQuery = normalizePlatformStarterQuery;
exports.normalizeClassifyAllDocumentsQuery = normalizeClassifyAllDocumentsQuery;
exports.isPlatformStarterQuery = isPlatformStarterQuery;
exports.isClassifyAllDocumentsQuery = isClassifyAllDocumentsQuery;
const PLATFORM_STARTER_QUERIES = [
    'classify each and every document',
    'pull out key information',
    'what are the key facts and issues of this case',
];
const CLASSIFY_ALL_DOCUMENTS_QUERY = 'classify each and every document';
const CLASSIFY_VERB_PATTERN = /\b(classif(?:y|ication|ying|ies)|categor(?:ize|ise|izing|isation|ization))\b/;
const CLASSIFY_ALL_POSITIVE_PATTERNS = [
    /\bclassif\w*\b[\s\S]*\b(all|every|each(?:\s+and\s+every)?)\b[\s\S]*\b(documents?|files?|papers?|records?)\b/,
    /\b(all|every)\b[\s\S]*\b(documents?|files?|papers?|records?)\b[\s\S]*\bclassif\w*\b/,
    /\bcategor\w*\b[\s\S]*\b(all|every|each)\b[\s\S]*\b(documents?|files?|papers?|records?)\b/,
    /\bclassif\w*\b[\s\S]*\beach\s+and\s+every\b[\s\S]*\b(documents?|files?)\b/,
    /\bclassif\w*\b[\s\S]*\b(these|those|the)\b[\s\S]*\b(documents|files|papers|records)\b/,
    /\bclassif\w*\b[\s\S]*\b(documents|files|papers|records)\b/,
];
const CLASSIFY_ALL_NEGATIVE_PATTERNS = [
    /\bclassif\w*\b[\s\S]*\bthe\b[\s\S]*\b(notice|order|petition|return|appeal|assessment|reply|rejoinder|affidavit|application|memo|memorandum|letter|invoice|contract|agreement)\b/,
    /\bclassif\w*\b[\s\S]*\bthis\b[\s\S]*\b(document|file|paper|record)\b/,
    /\bclassif\w*\b[\s\S]*\bthe\b[\s\S]*\b(document|file|paper|record)\b/,
];
function normalizePlatformStarterQuery(query) {
    return query
        .trim()
        .toLowerCase()
        .replace(/[.?!]+$/g, '')
        .replace(/\s+/g, ' ');
}
/** Strips polite filler so paraphrased classify-all intents normalize consistently. */
function normalizeClassifyAllDocumentsQuery(query) {
    return query
        .trim()
        .toLowerCase()
        .replace(/[.?!,;:]+$/g, '')
        .replace(/\b(please|pls|kindly|thanks|thank you)\b/g, '')
        .replace(/^\b(can you|could you|would you|will you|i want you to|i need you to|help me|i'd like you to)\b\s*/g, '')
        .replace(/\b(in this case|in the case|for this case|for the case|in this matter|for this matter)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function isPlatformStarterQuery(query) {
    const normalized = normalizePlatformStarterQuery(query);
    return PLATFORM_STARTER_QUERIES.includes(normalized);
}
/** User wants a classification row for every uploaded file (starter click or paraphrase). */
function isClassifyAllDocumentsQuery(query) {
    const normalized = normalizeClassifyAllDocumentsQuery(query);
    if (!normalized) {
        return false;
    }
    if (normalized === CLASSIFY_ALL_DOCUMENTS_QUERY) {
        return true;
    }
    if (!CLASSIFY_VERB_PATTERN.test(normalized)) {
        return false;
    }
    if (CLASSIFY_ALL_NEGATIVE_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return false;
    }
    return CLASSIFY_ALL_POSITIVE_PATTERNS.some((pattern) => pattern.test(normalized));
}
//# sourceMappingURL=platform-starter-query.util.js.map