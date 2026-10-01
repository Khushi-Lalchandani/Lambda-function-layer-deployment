"use strict";
/** Detects when the user explicitly asks about uploaded document content. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDocumentScopedQuery = isDocumentScopedQuery;
const DOCUMENT_SCOPED_PATTERNS = [
    /\bthis document\b/i,
    /\bthese documents\b/i,
    /\bin the document\b/i,
    /\bin the documents\b/i,
    /\bfrom the document\b/i,
    /\bfrom the documents\b/i,
    /\baccording to the document\b/i,
    /\baccording to the documents\b/i,
    /\bwhat does the document say\b/i,
    /\bwhat do the documents say\b/i,
    /\buploaded document\b/i,
    /\buploaded documents\b/i,
    /\bthe uploaded document\b/i,
    /\bin the uploaded document\b/i,
    /\bfrom the uploaded document\b/i,
    /\baccording to the uploaded document\b/i,
    /\bprovided document\b/i,
    /\bthe provided document\b/i,
    /\bin the provided document\b/i,
    /\bfrom the provided document\b/i,
    /\baccording to the provided document\b/i,
    /\bbased on (?:the )?(?:uploaded |provided )?document\b/i,
    /\b(?:from|form) the document\b/i,
    /\b(?:from|form) (?:the )?(?:uploaded |provided )?document\b/i,
    /\bthis case file\b/i,
    /\bfrom this case file\b/i,
    /\bin this case file\b/i,
    /\bin these records\b/i,
    /\bfrom these records\b/i,
    /\bthese records\b/i,
    /\bfrom these papers\b/i,
    /\bthese papers\b/i,
    /\bin these papers\b/i,
];
function isDocumentScopedQuery(query) {
    const trimmed = (query ?? '').trim();
    if (!trimmed) {
        return false;
    }
    return DOCUMENT_SCOPED_PATTERNS.some((pattern) => pattern.test(trimmed));
}
//# sourceMappingURL=document-scoped-query.util.js.map