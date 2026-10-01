"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_TOPIC_COVERAGE_WEB_DISABLED_MESSAGE = void 0;
exports.isGeneralKnowledgeScenarioAllowed = isGeneralKnowledgeScenarioAllowed;
exports.normalizeChunkSimilarity = normalizeChunkSimilarity;
exports.classifyRetrievalStrength = classifyRetrievalStrength;
exports.resolveHybridAnswerRoute = resolveHybridAnswerRoute;
exports.resolveNoSufficiencyFallback = resolveNoSufficiencyFallback;
const retrieval_config_1 = require("./retrieval-config");
/** Honest response when retrieval is NONE and web search is unavailable. */
exports.NO_TOPIC_COVERAGE_WEB_DISABLED_MESSAGE = 'The uploaded documents do not appear to cover this topic, and web search is currently disabled. Please ask about content in your uploaded documents, or enable web search to look outside them.';
/** Scenario C (parametric general knowledge) is only allowed when retrieval found topical evidence. */
function isGeneralKnowledgeScenarioAllowed(chunks) {
    return classifyRetrievalStrength(chunks).strength !== 'NONE';
}
/** Converts raw vector distance to a 0–1 relevance score (higher = more relevant). */
function normalizeChunkSimilarity(similarity) {
    return 1 - Math.min(similarity / 2, 1);
}
function classifyRetrievalStrength(chunks) {
    const chunkCount = chunks?.length ?? 0;
    if (chunkCount === 0) {
        return {
            strength: 'NONE',
            maxSimilarity: 0,
            chunkCount: 0,
            relevantChunkCount: 0,
        };
    }
    const topSimilarity = chunks[0]?.similarity ?? 1.0;
    const maxSimilarity = normalizeChunkSimilarity(topSimilarity);
    const relevanceFloor = retrieval_config_1.retrievalConfig.retrievalStrengthRelevanceFloor;
    const relevantChunkCount = chunks.filter((chunk) => normalizeChunkSimilarity(chunk?.similarity ?? 1.0) >= relevanceFloor).length;
    const weakThreshold = retrieval_config_1.retrievalConfig.retrievalStrengthWeakThreshold;
    const strongThreshold = retrieval_config_1.retrievalConfig.retrievalStrengthStrongThreshold;
    let strength;
    if (maxSimilarity < weakThreshold) {
        strength = 'NONE';
    }
    else if (maxSimilarity < strongThreshold) {
        strength = 'WEAK';
    }
    else {
        strength = 'STRONG';
    }
    return {
        strength,
        maxSimilarity,
        chunkCount,
        relevantChunkCount,
    };
}
/**
 * Retrieval-evidence-first routing matrix.
 *
 * NONE  → web when enabled (corpus has no topical coverage)
 * WEAK  → NO: web | PARTIAL: hybrid | YES: documents
 * STRONG → NO: document insufficiency | PARTIAL: hybrid | YES: documents
 *
 * Document-scoped + NO always → document insufficiency (overrides strength tier).
 */
function resolveHybridAnswerRoute(retrievalStrength, sufficiency, options) {
    if (options.explicitWebSearch && options.webSearchEnabled) {
        return 'web_search_only';
    }
    if (options.documentScoped && sufficiency === 'NO') {
        return 'document_insufficient';
    }
    if (retrievalStrength === 'NONE') {
        return options.webSearchEnabled ? 'web_search_only' : 'no_topic_coverage';
    }
    if (retrievalStrength === 'WEAK') {
        if (sufficiency === 'NO') {
            return options.webSearchEnabled ? 'web_search_only' : 'vector_search_only';
        }
        if (sufficiency === 'PARTIAL') {
            return options.webSearchEnabled ? 'hybrid' : 'document_answer';
        }
        return 'document_answer';
    }
    // STRONG
    if (sufficiency === 'NO') {
        return 'document_insufficient';
    }
    if (sufficiency === 'PARTIAL') {
        return options.webSearchEnabled ? 'hybrid' : 'document_answer';
    }
    return 'document_answer';
}
/**
 * @deprecated Prefer resolveHybridAnswerRoute — kept for NO-only call sites.
 */
function resolveNoSufficiencyFallback(retrievalStrength, options) {
    const route = resolveHybridAnswerRoute(retrievalStrength, 'NO', options);
    if (route === 'hybrid' ||
        route === 'document_answer' ||
        route === 'no_topic_coverage') {
        return 'vector_search_only';
    }
    return route;
}
//# sourceMappingURL=retrieval-strength.js.map