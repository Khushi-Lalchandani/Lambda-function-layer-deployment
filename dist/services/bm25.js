"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreBm25 = scoreBm25;
exports.rankByBm25 = rankByBm25;
const DEFAULT_K1 = 1.2;
const DEFAULT_B = 0.75;
function tokenize(text) {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((token) => token.length > 1);
}
/**
 * Okapi BM25 over a fixed document set (chunk contents).
 */
function scoreBm25(query, documents, k1 = DEFAULT_K1, b = DEFAULT_B) {
    if (!documents.length) {
        return [];
    }
    const queryTerms = [...new Set(tokenize(query))];
    if (!queryTerms.length) {
        return documents.map(() => 0);
    }
    const docTokens = documents.map((doc) => tokenize(doc));
    const docLengths = docTokens.map((tokens) => tokens.length);
    const avgDocLength = docLengths.reduce((sum, length) => sum + length, 0) / documents.length || 1;
    const docTermFreqs = docTokens.map((tokens) => {
        const frequencies = new Map();
        for (const token of tokens) {
            frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
        }
        return frequencies;
    });
    const docCount = documents.length;
    const idfByTerm = new Map();
    for (const term of queryTerms) {
        const docsWithTerm = docTermFreqs.filter((freq) => freq.has(term)).length;
        const idf = Math.log(1 + (docCount - docsWithTerm + 0.5) / (docsWithTerm + 0.5));
        idfByTerm.set(term, idf);
    }
    return documents.map((_, docIndex) => {
        const docLength = docLengths[docIndex] ?? 0;
        const termFreqs = docTermFreqs[docIndex];
        let score = 0;
        for (const term of queryTerms) {
            const termFrequency = termFreqs.get(term) ?? 0;
            if (termFrequency === 0) {
                continue;
            }
            const idf = idfByTerm.get(term) ?? 0;
            const numerator = termFrequency * (k1 + 1);
            const denominator = termFrequency + k1 * (1 - b + (b * docLength) / avgDocLength);
            score += idf * (numerator / denominator);
        }
        return score;
    });
}
function rankByBm25(query, items, topK) {
    const scores = scoreBm25(query, items.map((item) => item.content));
    return items
        .map((item, index) => ({ id: item.id, score: scores[index] ?? 0 }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}
//# sourceMappingURL=bm25.js.map